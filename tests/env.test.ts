import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  checkExecutable,
  copyTextToClipboard,
  getExecutableCandidates,
  getAbortController,
  getFetch,
  getTextDecoder,
  persistImageFile,
  removeTempImageAttachment,
} from '../src/env';

test('env: API 请求优先使用 Zotero 主窗口特权 fetch，避免 PDF iframe CORS', () => {
  const globals = globalThis as any;
  const previousZotero = globals.Zotero;
  let mainThis: unknown;
  const mainWindow = {
    fetch(this: unknown) {
      mainThis = this;
      return Promise.resolve({} as Response);
    },
  };
  const readerFetch = () => Promise.resolve({} as Response);
  globals.Zotero = { getMainWindow: () => mainWindow };

  try {
    const selected = getFetch({ defaultView: { fetch: readerFetch } } as unknown as Document);
    void selected('https://api.deepseek.com');
    assert.equal(mainThis, mainWindow);
  } finally {
    if (previousZotero === undefined) delete globals.Zotero;
    else globals.Zotero = previousZotero;
  }
});

test('env: 流式解码和取消控制器与 Zotero 主窗口 fetch 使用同一 realm', () => {
  const globals = globalThis as any;
  const previousZotero = globals.Zotero;
  class MainDecoder {}
  class ReaderDecoder {}
  class MainAbortController {}
  class ReaderAbortController {}
  const mainWindow = {
    TextDecoder: MainDecoder,
    AbortController: MainAbortController,
  };
  globals.Zotero = { getMainWindow: () => mainWindow };

  try {
    const doc = {
      defaultView: {
        TextDecoder: ReaderDecoder,
        AbortController: ReaderAbortController,
      },
    } as unknown as Document;
    assert.equal(getTextDecoder(doc), MainDecoder);
    assert.equal(getAbortController(doc), MainAbortController);
  } finally {
    if (previousZotero === undefined) delete globals.Zotero;
    else globals.Zotero = previousZotero;
  }
});

test('env: 优先使用 Zotero 内部剪贴板封装', async () => {
  const globals = globalThis as any;
  const previousZotero = globals.Zotero;
  let copiedText = '';
  globals.Zotero = {
    Utilities: {
      Internal: {
        copyTextToClipboard: (text: string) => {
          copiedText = text;
        },
      },
    },
  };

  try {
    await copyTextToClipboard({} as Document, 'Zotero 译文');
  } finally {
    if (previousZotero === undefined) delete globals.Zotero;
    else globals.Zotero = previousZotero;
  }

  assert.equal(copiedText, 'Zotero 译文');
});

test('env: Clipboard API 被拒绝时继续使用 DOM 回退复制', async () => {
  let copiedText = '';
  const parent = {
    appendChild(node: any) {
      node.parentNode = parent;
    },
    removeChild(node: any) {
      if (node.parentNode === parent) node.parentNode = null;
    },
  };
  const textarea = {
    value: '',
    style: {} as Record<string, string>,
    parentNode: null as any,
    setAttribute() {},
    focus() {},
    select() {},
    remove() {
      this.parentNode = null;
    },
  };
  const doc = {
    defaultView: {
      navigator: {
        clipboard: {
          writeText: async () => {
            throw new Error('not allowed');
          },
        },
      },
    },
    body: parent,
    documentElement: parent,
    createElement: () => textarea,
    execCommand: (command: string) => {
      copiedText = command === 'copy' ? textarea.value : '';
      return command === 'copy';
    },
  } as unknown as Document;

  await copyTextToClipboard(doc, '这是译文');
  assert.equal(copiedText, '这是译文');
  assert.equal(textarea.parentNode, null);
});

test('env: 图片附件保存为 Agy 可读取的临时文件并可清理', async () => {
  const file = Object.assign(
    new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
    { name: 'figure.png' }
  ) as Blob & { name: string };

  const attachment = await persistImageFile(file, true);
  assert.match(attachment.path || '', /zotero-gemini-translator-images/);
  assert.equal(attachment.mimeType, 'image/png');
  assert.equal(attachment.size, 4);
  assert.equal(attachment.dataUrl, 'data:image/png;base64,iVBORw==');

  await fs.access(attachment.path!);
  await removeTempImageAttachment(attachment);
  await assert.rejects(fs.access(attachment.path!));
});

test('env: 图片附件拒绝非图片和超大文件', async () => {
  const textFile = Object.assign(new Blob(['not an image'], { type: 'text/plain' }), { name: 'note.txt' }) as Blob & { name: string };
  await assert.rejects(persistImageFile(textFile), /只支持/);

  const hugeFile = Object.assign({
    type: 'image/png',
    name: 'huge.png',
    arrayBuffer: async () => new ArrayBuffer(8 * 1024 * 1024 + 1),
  }, { size: 8 * 1024 * 1024 + 1 }) as unknown as Blob & { name: string };
  await assert.rejects(persistImageFile(hugeFile), /不能超过/);
});

test('env: 可执行文件检查支持 PATH/绝对路径并能报告缺失命令', async () => {
  const available = await checkExecutable(process.execPath);
  assert.equal(available.available, true);

  const missing = await checkExecutable('/tmp/definitely-missing-gemini-translator-tool');
  assert.equal(missing.available, false);
});

test('env: Zotero 桌面启动时为 bare agy 命令补充用户 bin 路径', () => {
  const globals = globalThis as any;
  const previousServices = globals.Services;
  globals.Services = {
    env: {
      get(name: string) {
        return {
          HOME: '/tmp/gemini-translator-home',
          PATH: '/usr/bin',
          OS: 'Linux',
        }[name] || '';
      },
    },
  };

  try {
    const candidates = getExecutableCandidates('agy');
    assert.equal(candidates[0], 'agy');
    assert.equal(candidates.includes('/tmp/gemini-translator-home/.local/bin/agy'), true);
    assert.equal(candidates.includes('/usr/bin/agy'), true);
  } finally {
    if (previousServices === undefined) delete globals.Services;
    else globals.Services = previousServices;
  }
});

test('env: Gecko Subprocess 找不到 bare 命令时会尝试自动发现的绝对路径', async () => {
  const globals = globalThis as any;
  const previousServices = globals.Services;
  const previousChromeUtils = globals.ChromeUtils;
  const calls: string[] = [];
  const resolved = '/tmp/gemini-translator-home/.local/bin/agy';
  globals.Services = {
    env: {
      get(name: string) {
        return {
          HOME: '/tmp/gemini-translator-home',
          PATH: '/usr/bin',
          OS: 'Linux',
        }[name] || '';
      },
    },
  };
  globals.ChromeUtils = {
    importESModule() {
      return {
        Subprocess: {
          call: async ({ command }: { command: string }) => {
            calls.push(command);
            if (command !== resolved) throw new Error(`File at path '${command}' does not exist`);
            return { wait: async () => ({ exitCode: 0 }) };
          },
        },
      };
    },
  };

  try {
    const result = await checkExecutable('agy');
    assert.equal(result.available, true);
    assert.match(result.detail, /自动找到/);
    assert.equal(calls.includes('agy'), true);
    assert.equal(calls.includes(resolved), true);
  } finally {
    if (previousServices === undefined) delete globals.Services;
    else globals.Services = previousServices;
    if (previousChromeUtils === undefined) delete globals.ChromeUtils;
    else globals.ChromeUtils = previousChromeUtils;
  }
});
