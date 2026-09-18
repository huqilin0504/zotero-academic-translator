import {
  DocumentTranslationManager,
  DocumentTranslationTaskSnapshot,
  DocumentTaskStatus,
  documentTranslationManager,
} from './docTranslateTasks';
import { clearChildren } from './env';

const STATUS_BAR_ID = 'gemini-document-task-status';
const mountedBars = new WeakMap<Document, { destroy: () => void }>();

function resolveStatusDocument(doc: Document): Document {
  try {
    const mainDocument = (globalThis as any).Zotero?.getMainWindow?.()?.document;
    return mainDocument || doc;
  } catch (_) {
    return doc;
  }
}

function statusLabel(status: DocumentTaskStatus): string {
  if (status === 'queued') return '排队中';
  if (status === 'running') return '翻译中';
  if (status === 'completed') return '已完成';
  if (status === 'cancelled') return '已取消';
  return '失败';
}

function activeTask(tasks: DocumentTranslationTaskSnapshot[]): DocumentTranslationTaskSnapshot | null {
  return tasks.find((task) => task.status === 'running' || task.status === 'queued') || null;
}

function createProgressBar(doc: Document, percent: number): HTMLElement {
  const track = doc.createElement('div');
  track.className = 'gemini-task-progress';
  const fill = doc.createElement('span');
  fill.className = 'gemini-task-progress-fill';
  fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  track.appendChild(fill);
  return track;
}

function createTaskRow(
  doc: Document,
  task: DocumentTranslationTaskSnapshot,
  manager: DocumentTranslationManager
): HTMLElement {
  const row = doc.createElement('div');
  row.className = `gemini-task-row is-${task.status}`;

  const top = doc.createElement('div');
  top.className = 'gemini-task-row-top';
  const title = doc.createElement('span');
  title.className = 'gemini-task-row-title';
  title.textContent = task.title;
  title.title = task.title;
  const state = doc.createElement('span');
  state.className = 'gemini-task-row-state';
  state.textContent = statusLabel(task.status);
  top.appendChild(title);
  top.appendChild(state);

  const progressLine = doc.createElement('div');
  progressLine.className = 'gemini-task-row-progress';
  progressLine.appendChild(createProgressBar(doc, task.progress.percent));
  const percent = doc.createElement('span');
  percent.className = 'gemini-task-row-percent';
  percent.textContent = `${task.progress.percent}%`;
  progressLine.appendChild(percent);

  const message = doc.createElement('div');
  message.className = 'gemini-task-row-message';
  message.textContent = task.error || task.progress.message;
  message.title = message.textContent;

  const actions = doc.createElement('div');
  actions.className = 'gemini-task-row-actions';
  if (task.status === 'running' || task.status === 'queued') {
    const cancel = doc.createElement('button');
    cancel.className = 'gemini-task-action';
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', (event) => {
      event.stopPropagation();
      manager.cancel(task.id);
    });
    actions.appendChild(cancel);
  } else if (task.status === 'completed' && task.attachmentReady) {
    const open = doc.createElement('button');
    open.className = 'gemini-task-action is-primary';
    open.type = 'button';
    open.textContent = '打开译本';
    open.addEventListener('click', (event) => {
      event.stopPropagation();
      void manager.open(task.id);
    });
    actions.appendChild(open);
  }

  row.appendChild(top);
  row.appendChild(progressLine);
  row.appendChild(message);
  if (actions.childElementCount > 0) row.appendChild(actions);
  return row;
}

/**
 * 在 Zotero 阅读器/主窗口中挂载一个轻量的全文任务下拉栏。
 * 同一 Document 只挂载一次，任务进度由全局管理器推送。
 */
export function ensureDocumentTaskStatusBar(
  doc: Document,
  manager: DocumentTranslationManager = documentTranslationManager
): { destroy: () => void } {
  const statusDocument = resolveStatusDocument(doc);
  const existing = mountedBars.get(statusDocument);
  if (existing) return existing;

  // statusDocument 可能是 Zotero 主窗口，而调用方 doc 是阅读器 iframe；
  // 所有节点必须由同一个 Document 创建，才能安全挂载到主窗口 body。
  const root = statusDocument.createElement('div');
  root.id = STATUS_BAR_ID;
  root.className = 'gemini-task-status';
  root.hidden = true;

  const toggle = statusDocument.createElement('button');
  toggle.className = 'gemini-task-status-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-haspopup', 'true');

  const toggleLabel = statusDocument.createElement('span');
  toggleLabel.className = 'gemini-task-status-label';
  const togglePercent = statusDocument.createElement('span');
  togglePercent.className = 'gemini-task-status-percent';
  const toggleArrow = statusDocument.createElement('span');
  toggleArrow.className = 'gemini-task-status-arrow';
  toggleArrow.textContent = '▾';
  toggle.appendChild(toggleLabel);
  toggle.appendChild(togglePercent);
  toggle.appendChild(toggleArrow);

  const panel = statusDocument.createElement('div');
  panel.className = 'gemini-task-status-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'menu');

  const panelHeader = statusDocument.createElement('div');
  panelHeader.className = 'gemini-task-panel-header';
  panelHeader.textContent = '全文翻译';
  const clearButton = statusDocument.createElement('button');
  clearButton.className = 'gemini-task-action';
  clearButton.type = 'button';
  clearButton.textContent = '清除记录';
  clearButton.addEventListener('click', (event) => {
    event.stopPropagation();
    manager.clearFinished();
  });
  panelHeader.appendChild(clearButton);
  panel.appendChild(panelHeader);

  root.appendChild(toggle);
  root.appendChild(panel);
  const mountTarget = statusDocument.body || statusDocument.documentElement;
  if (!mountTarget) {
    return { destroy: () => {} };
  }
  mountTarget.appendChild(root);

  const render = (tasks: DocumentTranslationTaskSnapshot[]) => {
    const latest = tasks[0];
    const active = activeTask(tasks);
    root.hidden = tasks.length === 0;

    if (active) {
      toggleLabel.textContent = '全文翻译';
      togglePercent.textContent = `${active.progress.percent}%`;
      root.classList.add('is-active');
    } else if (latest?.status === 'completed') {
      toggleLabel.textContent = '译本已就绪';
      togglePercent.textContent = '100%';
      root.classList.remove('is-active');
    } else if (latest?.status === 'failed') {
      toggleLabel.textContent = '翻译失败';
      togglePercent.textContent = '';
      root.classList.remove('is-active');
    } else {
      toggleLabel.textContent = '全文翻译';
      togglePercent.textContent = '';
      root.classList.remove('is-active');
    }

    clearChildren(panel);
    panel.appendChild(panelHeader);
    if (tasks.length === 0) return;
    for (const task of tasks) panel.appendChild(createTaskRow(statusDocument, task, manager));
  };

  const unsubscribe = manager.subscribe(render);
  const onToggle = (event: Event) => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  };
  const onDocumentClick = (event: Event) => {
    if (!root.contains(event.target as Node)) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  };
  toggle.addEventListener('click', onToggle);
  statusDocument.addEventListener('click', onDocumentClick, true);
  statusDocument.addEventListener('keydown', onKeyDown, true);

  const handle = {
    destroy: () => {
      unsubscribe();
      toggle.removeEventListener('click', onToggle);
      statusDocument.removeEventListener('click', onDocumentClick, true);
      statusDocument.removeEventListener('keydown', onKeyDown, true);
      root.remove();
      mountedBars.delete(statusDocument);
    },
  };
  mountedBars.set(statusDocument, handle);
  return handle;
}

export function destroyDocumentTaskStatusBar(doc: Document): void {
  mountedBars.get(resolveStatusDocument(doc))?.destroy();
}
