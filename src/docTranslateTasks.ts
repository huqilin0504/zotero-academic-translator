import {
  DocTranslateOptions,
  DocTranslateProgress,
  PluginConfig,
} from './types';
import { getAbortController } from './env';
import {
  attachTranslatedPdfToItem,
  getExpectedOutputPdfPath,
  openAttachmentInReader,
  translateDocument,
} from './docTranslator';
import { normalizeModelForEndpoint } from './config';

export type DocumentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DocumentTranslationTaskSnapshot {
  id: string;
  title: string;
  inputPdfPath: string;
  mode: 'mono' | 'dual';
  pages?: string;
  status: DocumentTaskStatus;
  progress: DocTranslateProgress;
  error?: string;
  targetPdfPath?: string;
  attachmentReady: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface DocumentTranslationTaskRequest {
  doc?: Document;
  item: any;
  inputPdfPath: string;
  mode: 'mono' | 'dual';
  pages?: string;
  config: PluginConfig;
  title?: string;
}

export interface DocumentTranslationTaskDependencies {
  translate?: typeof translateDocument;
  attach?: typeof attachTranslatedPdfToItem;
  open?: typeof openAttachmentInReader;
}

type TaskListener = (tasks: DocumentTranslationTaskSnapshot[]) => void;

interface TaskEntry {
  snapshot: DocumentTranslationTaskSnapshot;
  request: DocumentTranslationTaskRequest;
  controller: any;
  fingerprint: string;
  outputPath: string;
  attachment: any | null;
  cancelRequested: boolean;
}

function cloneSnapshot(snapshot: DocumentTranslationTaskSnapshot): DocumentTranslationTaskSnapshot {
  return {
    ...snapshot,
    progress: { ...snapshot.progress },
  };
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function fileTitle(inputPdfPath: string): string {
  const filename = inputPdfPath.split(/[\\/]/).pop() || '当前 PDF';
  return filename.replace(/\.pdf$/i, '') || '当前 PDF';
}

function taskFingerprint(request: DocumentTranslationTaskRequest): string {
  return JSON.stringify({
    inputPdfPath: request.inputPdfPath,
    pages: request.pages?.trim() || '',
    mode: request.mode,
    endpointType: request.config.endpointType,
    apiBaseUrl: request.config.apiBaseUrl,
    // 旧版 chat/reasoner 与当前 deepseek-flash 是同一条迁移路径；
    // 统一后，重启或升级不会因为模型别名不同而错过同一输出任务的去重。
    model: normalizeModelForEndpoint(request.config.endpointType, request.config.model),
    targetLanguage: request.config.targetLanguage,
  });
}

/**
 * 全文翻译后台任务管理器。
 *
 * 它只持有进程和 Zotero 附件对象，不把 PDF 内容复制进内存；关闭配置弹窗
 * 不会触发 AbortController，只有用户在状态栏点击取消或插件卸载时才会中止。
 */
export class DocumentTranslationManager {
  private readonly entries = new Map<string, TaskEntry>();
  private readonly listeners = new Set<TaskListener>();
  private readonly outputQueues = new Map<string, TaskEntry[]>();
  private readonly outputQueueRunning = new Set<string>();
  private sequence = 0;
  private readonly dependencies: Required<DocumentTranslationTaskDependencies>;

  constructor(dependencies: DocumentTranslationTaskDependencies = {}) {
    this.dependencies = {
      translate: dependencies.translate || translateDocument,
      attach: dependencies.attach || attachTranslatedPdfToItem,
      open: dependencies.open || openAttachmentInReader,
    };
  }

  subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshots());
    return () => this.listeners.delete(listener);
  }

  getSnapshots(): DocumentTranslationTaskSnapshot[] {
    return [...this.entries.values()]
      .sort((a, b) => b.snapshot.startedAt - a.snapshot.startedAt)
      .map((entry) => cloneSnapshot(entry.snapshot));
  }

  getSnapshot(id: string): DocumentTranslationTaskSnapshot | null {
    const entry = this.entries.get(id);
    return entry ? cloneSnapshot(entry.snapshot) : null;
  }

  start(request: DocumentTranslationTaskRequest): DocumentTranslationTaskSnapshot {
    const normalizedRequest: DocumentTranslationTaskRequest = {
      ...request,
      mode: request.mode || 'mono',
      pages: request.pages?.trim() || undefined,
    };
    const fingerprint = taskFingerprint(normalizedRequest);
    const existing = [...this.entries.values()].find(
      (entry) => entry.fingerprint === fingerprint
        && (entry.snapshot.status === 'queued' || entry.snapshot.status === 'running')
    );
    if (existing) return cloneSnapshot(existing.snapshot);

    const AbortControllerClass = getAbortController(normalizedRequest.doc);
    const controller = new AbortControllerClass();
    const now = Date.now();
    const id = `document-${now.toString(36)}-${(++this.sequence).toString(36)}`;
    const title = normalizedRequest.title
      || normalizedRequest.item?.getField?.('title')
      || fileTitle(normalizedRequest.inputPdfPath);
    const entry: TaskEntry = {
      fingerprint,
      request: normalizedRequest,
      controller,
      outputPath: getExpectedOutputPdfPath(normalizedRequest.inputPdfPath, normalizedRequest.mode),
      attachment: null,
      cancelRequested: false,
      snapshot: {
        id,
        title,
        inputPdfPath: normalizedRequest.inputPdfPath,
        mode: normalizedRequest.mode,
        pages: normalizedRequest.pages,
        status: 'queued',
        progress: {
          stage: 'prepare',
          percent: 0,
          message: '已加入后台翻译队列',
        },
        attachmentReady: false,
        startedAt: now,
      },
    };

    this.entries.set(id, entry);
    this.pruneFinished();
    this.emit();
    // 让调用方先拿到 queued 状态，再在下一个微任务进入“按最终输出路径”
    // 的队列。同一 PDF 的不同页段会共享同一输出路径，因此绝不会同时
    // 启动两个 pdf2zh 去覆盖同一个文件。
    this.enqueue(entry);
    return cloneSnapshot(entry.snapshot);
  }

  cancel(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || ['completed', 'failed', 'cancelled'].includes(entry.snapshot.status)) {
      return false;
    }
    entry.cancelRequested = true;
    try {
      entry.controller.abort();
    } catch (_) {}
    this.update(entry, {
      status: 'cancelled',
      error: '已取消',
      progress: {
        ...entry.snapshot.progress,
        stage: 'error',
        message: '后台翻译已取消',
      },
      finishedAt: Date.now(),
    });
    return true;
  }

  cancelAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.snapshot.status === 'queued' || entry.snapshot.status === 'running') {
        this.cancel(entry.snapshot.id);
      }
    }
  }

  async open(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry?.attachment) return false;
    await this.dependencies.open(entry.attachment);
    return true;
  }

  clearFinished(): void {
    for (const [id, entry] of this.entries) {
      if (['completed', 'failed', 'cancelled'].includes(entry.snapshot.status)) {
        this.entries.delete(id);
      }
    }
    this.emit();
  }

  private async run(entry: TaskEntry): Promise<void> {
    // 用户可能在 queued 微任务启动前就点击了取消；不要让任务被取消后又
    // 短暂切回 running，更不能在取消后启动 pdf2zh 子进程。
    if (entry.cancelRequested || entry.controller.signal?.aborted || entry.snapshot.status === 'cancelled') {
      return;
    }
    this.update(entry, {
      status: 'running',
      progress: {
        stage: 'prepare',
        percent: 5,
        message: '正在后台准备翻译环境',
      },
    });

    try {
      const result = await this.dependencies.translate(
        {
          inputPdfPath: entry.request.inputPdfPath,
          mode: entry.request.mode,
          pages: entry.request.pages,
          signal: entry.controller.signal,
          onProgress: (progress) => this.updateProgress(entry, progress),
        },
        entry.request.config
      );

      if (entry.cancelRequested || entry.controller.signal?.aborted) {
        return;
      }

      this.update(entry, {
        progress: {
          stage: 'typesetting',
          percent: Math.max(entry.snapshot.progress.percent, 92),
          message: '正在整理排版并生成 PDF',
        },
      });

      if (entry.cancelRequested || entry.controller.signal?.aborted) return;

      const attachment = await this.dependencies.attach(
        entry.request.item,
        result.targetPdfPath,
        entry.request.mode
      );
      if (!attachment) {
        throw new Error(`译文已生成，但无法导入 Zotero 附件：${result.targetPdfPath}`);
      }
      entry.attachment = attachment;

      // 取消可能发生在附件导入期间。附件导入已经是不可安全回滚的外部
      // Zotero 操作，因此保留已导入附件，但任务只能进入 cancelled，不能
      // 被错误地标记为 completed；用户仍可从条目中看到这个译本。
      if (entry.cancelRequested || entry.controller.signal?.aborted) {
        this.update(entry, {
          status: 'cancelled',
          targetPdfPath: result.targetPdfPath,
          attachmentReady: true,
          error: '已取消（译文附件已导入）',
          progress: {
            ...entry.snapshot.progress,
            stage: 'error',
            message: '已取消，但译文附件已导入 Zotero',
          },
          finishedAt: Date.now(),
        });
        return;
      }

      this.update(entry, {
        status: 'completed',
        targetPdfPath: result.targetPdfPath,
        attachmentReady: true,
        progress: {
          stage: 'done',
          percent: 100,
          message: '翻译完成，译本已添加到 Zotero',
        },
        finishedAt: Date.now(),
      });

      // 后台运行不强制抢占阅读器；保留已有设置，让用户可选择自动打开。
      if (entry.request.config.docAutoOpen) {
        await this.dependencies.open(attachment);
      }
    } catch (err: any) {
      if (entry.cancelRequested || entry.controller.signal?.aborted) {
        this.update(entry, {
          status: 'cancelled',
          error: '已取消',
          progress: {
            ...entry.snapshot.progress,
            stage: 'error',
            message: '后台翻译已取消',
          },
          finishedAt: Date.now(),
        });
        return;
      }
      const message = err?.message || String(err) || '未知错误';
      this.update(entry, {
        status: 'failed',
        error: message,
        progress: {
          ...entry.snapshot.progress,
          stage: 'error',
          message: `翻译失败：${message}`,
        },
        finishedAt: Date.now(),
      });
    }
  }

  private enqueue(entry: TaskEntry): void {
    const queue = this.outputQueues.get(entry.outputPath) || [];
    queue.push(entry);
    this.outputQueues.set(entry.outputPath, queue);
    void Promise.resolve().then(() => this.pumpOutputQueue(entry.outputPath));
  }

  private async pumpOutputQueue(outputPath: string): Promise<void> {
    if (this.outputQueueRunning.has(outputPath)) return;
    this.outputQueueRunning.add(outputPath);
    try {
      while (true) {
        const queue = this.outputQueues.get(outputPath);
        if (!queue || queue.length === 0) break;
        const entry = queue.shift()!;
        if (queue.length === 0) this.outputQueues.delete(outputPath);
        if (entry.cancelRequested || entry.snapshot.status === 'cancelled') continue;
        if (queue.length > 0) {
          const waiting = queue[0];
          this.update(waiting, {
            progress: {
              ...entry.snapshot.progress,
              stage: 'prepare',
              percent: 0,
              message: '等待相同译本输出路径空闲...',
            },
          });
        }
        await this.run(entry);
      }
    } finally {
      this.outputQueueRunning.delete(outputPath);
      const queue = this.outputQueues.get(outputPath);
      if (queue && queue.length > 0) void this.pumpOutputQueue(outputPath);
    }
  }

  private updateProgress(entry: TaskEntry, progress: DocTranslateProgress): void {
    if (entry.snapshot.status === 'cancelled') return;
    // pdf2zh 在子进程退出、附件尚未导入时也会发出 done；后台任务的
    // terminal 状态必须由 translate + attach 全部成功后统一设置，避免
    // “第 9/17 页”或“正在整理排版”时提前显示 100%。
    if (progress.stage === 'done') return;
    const percent = Math.max(entry.snapshot.progress.percent, clampPercent(progress.percent));
    this.update(entry, {
      progress: {
        ...progress,
        percent,
      },
    });
  }

  private update(entry: TaskEntry, update: Partial<DocumentTranslationTaskSnapshot>): void {
    if (!this.entries.has(entry.snapshot.id)) return;
    entry.snapshot = {
      ...entry.snapshot,
      ...update,
      progress: update.progress
        ? {
            ...entry.snapshot.progress,
            ...update.progress,
            percent: clampPercent(update.progress.percent),
          }
        : entry.snapshot.progress,
    };
    this.emit();
  }

  private pruneFinished(): void {
    const maxTasks = 10;
    if (this.entries.size <= maxTasks) return;
    const finished = [...this.entries.values()]
      .filter((entry) => ['completed', 'failed', 'cancelled'].includes(entry.snapshot.status))
      .sort((a, b) => a.snapshot.startedAt - b.snapshot.startedAt);
    while (this.entries.size > maxTasks && finished.length > 0) {
      this.entries.delete(finished.shift()!.snapshot.id);
    }
  }

  private emit(): void {
    const snapshots = this.getSnapshots();
    for (const listener of this.listeners) {
      try {
        listener(snapshots);
      } catch (_) {}
    }
  }
}

export const documentTranslationManager = new DocumentTranslationManager();
