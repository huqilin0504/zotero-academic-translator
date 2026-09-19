import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentTranslationManager } from '../src/docTranslateTasks';
import { PluginConfig } from '../src/types';

const config: PluginConfig = {
  endpointType: 'agy',
  apiBaseUrl: '',
  apiKey: '',
  model: 'gemini-test',
  agyPath: '/tmp/agy',
  targetLanguage: '简体中文',
  systemPrompt: 'translate',
  enableKaTeX: true,
  cacheSize: 50,
  autoTranslate: true,
  docTranslateMode: 'mono',
  docTranslateThreads: 6,
  docAutoOpen: false,
};

function request(overrides: Partial<Parameters<DocumentTranslationManager['start']>[0]> = {}) {
  return {
    item: { getField: () => '测试论文' },
    inputPdfPath: '/tmp/test-paper.pdf',
    mode: 'mono' as const,
    config,
    ...overrides,
  };
}

test('docTranslateTasks: 提交后立即返回并在后台更新进度', async () => {
  let resolveTranslation: any = null;
  const updates: string[] = [];
  const manager = new DocumentTranslationManager({
    translate: async (options) => {
      options.onProgress?.({ stage: 'done', percent: 100, message: '全文翻译完成！' });
      options.onProgress?.({ stage: 'translating', percent: 42, message: '正在翻译第 4 / 10 页' });
      return new Promise((resolve) => {
        resolveTranslation = resolve;
      });
    },
    attach: async () => ({ id: 10 }),
    open: async () => {},
  });
  const unsubscribe = manager.subscribe((tasks) => {
    const task = tasks[0];
    if (task) updates.push(`${task.status}:${task.progress.percent}`);
  });

  const started = manager.start(request());
  assert.equal(started.status, 'queued');
  await new Promise((resolve) => setImmediate(resolve));
  const running = manager.getSnapshot(started.id);
  assert.ok(running);
  assert.equal(running?.status, 'running');
  assert.equal(running?.progress.percent, 42);

  const duplicate = manager.start(request());
  assert.equal(duplicate.id, started.id);

  resolveTranslation?.({ targetPdfPath: '/tmp/test-paper-mono.pdf' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const completed = manager.getSnapshot(started.id);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.progress.percent, 100);
  assert.ok(updates.some((value) => value === 'running:42'));
  unsubscribe();
});

test('docTranslateTasks: 取消只终止后台任务，不污染其他任务', async () => {
  let aborted = false;
  const manager = new DocumentTranslationManager({
    translate: async (options) => {
      options.signal?.addEventListener('abort', () => { aborted = true; });
      await new Promise((resolve) => setTimeout(resolve, 25));
      throw new Error('aborted');
    },
    attach: async () => ({ id: 11 }),
    open: async () => {},
  });
  const task = manager.start(request({ inputPdfPath: '/tmp/cancel.pdf' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.cancel(task.id), true);
  await new Promise((resolve) => setTimeout(resolve, 35));
  const cancelled = manager.getSnapshot(task.id);
  assert.equal(aborted, true);
  assert.equal(cancelled?.status, 'cancelled');
  assert.equal(manager.cancel(task.id), false);
});

test('docTranslateTasks: queued 阶段取消不会启动翻译进程', async () => {
  let translateCalls = 0;
  const manager = new DocumentTranslationManager({
    translate: async () => {
      translateCalls += 1;
      return { targetPdfPath: '/tmp/should-not-run.pdf' } as any;
    },
    attach: async () => ({ id: 12 }),
    open: async () => {},
  });

  const task = manager.start(request({ inputPdfPath: '/tmp/queued-cancel.pdf' }));
  assert.equal(task.status, 'queued');
  assert.equal(manager.cancel(task.id), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(translateCalls, 0);
  assert.equal(manager.getSnapshot(task.id)?.status, 'cancelled');
});

test('docTranslateTasks: 相同输出 PDF 的不同页段按路径串行执行', async () => {
  let active = 0;
  let peak = 0;
  let translateCalls = 0;
  const manager = new DocumentTranslationManager({
    translate: async () => {
      translateCalls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return {
        monoPdfPath: '/tmp/same-output-mono.pdf',
        dualPdfPath: '/tmp/same-output-dual.pdf',
        targetPdfPath: '/tmp/same-output-mono.pdf',
      };
    },
    attach: async () => ({ id: 20 }),
    open: async () => {},
  });

  const first = manager.start(request({ inputPdfPath: '/tmp/same-output.pdf', pages: '1-2' }));
  const second = manager.start(request({ inputPdfPath: '/tmp/same-output.pdf', pages: '3-4' }));
  assert.equal(first.status, 'queued');
  assert.equal(second.status, 'queued');

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(translateCalls, 2);
  assert.equal(peak, 1, '同一目标 PDF 不能同时启动两个翻译进程');
  assert.equal(manager.getSnapshot(first.id)?.status, 'completed');
  assert.equal(manager.getSnapshot(second.id)?.status, 'completed');
});

test('docTranslateTasks: 附件导入期间取消保持 cancelled，不回写 completed', async () => {
  let resolveAttach: any = null;
  let openCalls = 0;
  const manager = new DocumentTranslationManager({
    translate: async () => ({
      monoPdfPath: '/tmp/import-race-mono.pdf',
      dualPdfPath: '/tmp/import-race-dual.pdf',
      targetPdfPath: '/tmp/import-race-mono.pdf',
    }),
    attach: async () => new Promise((resolve) => {
      resolveAttach = resolve;
    }),
    open: async () => {
      openCalls += 1;
    },
  });

  const task = manager.start(request({ inputPdfPath: '/tmp/import-race.pdf' }));
  for (let attempt = 0; attempt < 5 && !resolveAttach; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(resolveAttach, '测试应进入附件导入阶段');
  assert.equal(manager.cancel(task.id), true);
  resolveAttach?.({ id: 21 });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const cancelled = manager.getSnapshot(task.id);
  assert.equal(cancelled?.status, 'cancelled');
  assert.equal(cancelled?.attachmentReady, true);
  assert.match(cancelled?.error || '', /附件已导入/);
  assert.equal(openCalls, 0, '取消后的已导入附件不应自动打开');
});
