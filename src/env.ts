
import { ImageAttachment } from './types';

export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const IMAGE_TEMP_DIR = '/tmp/zotero-gemini-translator-images';

export function getFetch(doc?: Document): typeof fetch {
  if (typeof Zotero !== 'undefined') {
    const win = Zotero.getMainWindow?.();
    if (win?.fetch) {
      return win.fetch.bind(win);
    }
  }
  if (doc?.defaultView?.fetch) {
    return doc.defaultView.fetch.bind(doc.defaultView);
  }
  if (typeof fetch !== 'undefined') {
    return fetch;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).fetch) {
    return (globalThis as any).fetch;
  }
  throw new Error('无法在当前 Zotero 环境中获取 fetch API');
}

export function getAbortController(doc?: Document): typeof AbortController {
  if (typeof Zotero !== 'undefined') {
    const win = Zotero.getMainWindow?.();
    if (win?.AbortController) {
      return win.AbortController;
    }
  }
  if (doc?.defaultView?.AbortController) {
    return doc.defaultView.AbortController;
  }
  if (typeof AbortController !== 'undefined') {
    return AbortController;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).AbortController) {
    return (globalThis as any).AbortController;
  }
  return class PolyfillAbortController {
    signal = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };
    abort() {
      this.signal.aborted = true;
    }
  } as any;
}

export function getTextDecoder(doc?: Document): typeof TextDecoder {
  if (typeof Zotero !== 'undefined') {
    const win = Zotero.getMainWindow?.();
    if (win?.TextDecoder) {
      return win.TextDecoder;
    }
  }
  if (doc?.defaultView?.TextDecoder) {
    return doc.defaultView.TextDecoder;
  }
  if (typeof TextDecoder !== 'undefined') {
    return TextDecoder;
  }
  return (globalThis as any).TextDecoder;
}

export function clearChildren(el: HTMLElement): void {
  if (typeof el.replaceChildren === 'function') {
    try {
      el.replaceChildren();
      return;
    } catch (_) {}
  }
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

export async function copyTextToClipboard(doc: Document, text: string): Promise<void> {
  if (!text) throw new Error('没有可复制的译文');

  const globals = globalThis as any;
  const errors: string[] = [];

  const recordFailure = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error || '未知错误');
    if (message && !errors.includes(message)) errors.push(message);
  };

  try {
    const zotero = globals.Zotero;
    const copy = zotero?.Utilities?.Internal?.copyTextToClipboard;
    if (typeof copy === 'function') {
      copy.call(zotero.Utilities.Internal, text);
      return;
    }
  } catch (error) {
    recordFailure(error);
  }

  const tryNativeClipboard = (services: any): boolean => {
    try {
      if (typeof services?.clipboard?.copyString === 'function') {
        services.clipboard.copyString(text, null);
        return true;
      }
    } catch (error) {
      recordFailure(error);
    }
    return false;
  };

  if (tryNativeClipboard(globals.Services)) return;

  try {
    const chromeUtils = globals.ChromeUtils;
    const imported = chromeUtils?.importESModule?.('resource://gre/modules/Services.sys.mjs');
    if (tryNativeClipboard(imported?.Services)) return;
  } catch (error) {
    recordFailure(error);
  }

  try {
    const components = globals.Components;
    const classes = components?.classes || globals.Cc;
    const interfaces = components?.interfaces || globals.Ci;
    const factory = classes?.['@mozilla.org/widget/clipboardhelper;1'];
    const helper = factory?.getService?.(interfaces?.nsIClipboardHelper);
    if (typeof helper?.copyString === 'function') {
      helper.copyString(text);
      return;
    }
  } catch (error) {
    recordFailure(error);
  }

  try {
    const viewNavigator = (doc.defaultView as any)?.navigator;
    const clipboard = viewNavigator?.clipboard || globals.navigator?.clipboard;
    if (typeof clipboard?.writeText === 'function') {
      await clipboard.writeText(text);
      return;
    }
  } catch (error) {
    recordFailure(error);
  }

  const parent = doc.body || doc.documentElement;
  if (parent && typeof doc.createElement === 'function' && typeof doc.execCommand === 'function') {
    const textarea = doc.createElement('textarea') as HTMLTextAreaElement;
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-10000px';
    textarea.style.top = '0';
    parent.appendChild(textarea);
    try {
      textarea.focus?.();
      textarea.select?.();
      if (doc.execCommand('copy')) return;
      recordFailure('execCommand copy 返回 false');
    } catch (error) {
      recordFailure(error);
    } finally {
      textarea.remove?.();
      if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
    }
  }

  throw new Error(errors.length ? `复制失败：${errors.join('；')}` : '当前 Zotero 环境不支持复制');
}

export function getSubprocess(): any {
  if (typeof ChromeUtils !== 'undefined') {
    const CU = ChromeUtils as any;
    if (CU.importESModule) {
      try {
        const mod = CU.importESModule('resource://gre/modules/Subprocess.sys.mjs');
        return mod.Subprocess || mod.default || mod;
      } catch (_) {}
    }
    if (CU.import) {
      try {
        const mod = CU.import('resource://gre/modules/Subprocess.jsm');
        return mod.Subprocess || mod;
      } catch (_) {}
    }
  }
  return null;
}

function readRuntimeEnvironment(name: string): string {
  const globals = globalThis as any;
  try {
    const services = globals.Services || globals.ChromeUtils?.importESModule?.(
      'resource://gre/modules/Services.sys.mjs'
    )?.Services;
    const value = services?.env?.get?.(name);
    if (value) return String(value);
  } catch (_) {}
  try {
    const value = globals.process?.env?.[name];
    if (value) return String(value);
  } catch (_) {}
  return '';
}

function isPathLikeExecutable(value: string): boolean {
  return value.includes('/') || value.includes('\\') || /^[A-Za-z]:/.test(value);
}

function joinExecutablePath(directory: string, executable: string): string {
  const normalizedDirectory = directory.replace(/[\\/]+$/, '');
  const separator = normalizedDirectory.includes('\\') && !normalizedDirectory.includes('/') ? '\\' : '/';
  const normalizedExecutable = separator === '\\' ? executable.replace(/\//g, '\\') : executable.replace(/\\/g, '/');
  return `${normalizedDirectory}${separator}${normalizedExecutable}`;
}

export function getExecutableCandidates(command: string): string[] {
  const raw = String(command || '').trim();
  if (!raw) return [];

  const home = readRuntimeEnvironment('HOME') || readRuntimeEnvironment('USERPROFILE');
  const expanded = raw.startsWith('~/') && home
    ? joinExecutablePath(home, raw.slice(2))
    : raw;
  if (isPathLikeExecutable(expanded)) return [expanded];

  const pathValue = readRuntimeEnvironment('PATH');
  const pathSeparator = pathValue.includes(';') ? ';' : ':';
  const directories = pathValue.split(pathSeparator).filter(Boolean);
  if (home) {
    directories.unshift(joinExecutablePath(home, '.local/bin'));
    directories.unshift(joinExecutablePath(home, 'bin'));
  }

  const platform = `${readRuntimeEnvironment('OS')} ${readRuntimeEnvironment('OSTYPE')}`.toLowerCase();
  const isWindows = pathSeparator === ';' || platform.includes('windows') || platform.includes('win32');
  if (!isWindows) directories.push('/usr/local/bin', '/usr/bin', '/bin');

  const names = [raw];
  if (isWindows && !/\.exe$/i.test(raw)) names.push(`${raw}.exe`);
  const candidates: string[] = [];
  for (const name of names) {
    candidates.push(name);
    for (const directory of directories) candidates.push(joinExecutablePath(directory, name));
  }
  return [...new Set(candidates)];
}

export interface ExecutableCheckResult {
  command: string;
  available: boolean;
  detail: string;
}

export async function checkExecutable(command: string): Promise<ExecutableCheckResult> {
  const target = String(command || '').trim();
  if (!target) return { command: target, available: false, detail: '未填写可执行文件名或路径' };
  const candidates = getExecutableCandidates(target);

  const Subprocess = getSubprocess();
  if (Subprocess?.call) {
    let lastDetail = '当前环境无法启动进程';
    for (const candidate of candidates) {
      try {
        const proc = await Subprocess.call({
          command: candidate,
          arguments: ['--version'],
          environmentAppend: true,
          workdir: '/tmp',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const { exitCode } = await proc.wait();
        if (exitCode === 0) {
          return {
            command: target,
            available: true,
            detail: candidate === target ? '可用' : `可用（自动找到 ${candidate}）`,
          };
        }
        lastDetail = `版本探针退出码 ${exitCode}`;
      } catch (err: any) {
        lastDetail = err?.message || String(err);
      }
    }
    return { command: target, available: false, detail: lastDetail };
  }

  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    try {
      const childProcess: any = await import('node:child_process');
      const result = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
        const child = childProcess.spawn(candidates[0] || target, ['--version'], { stdio: 'ignore', windowsHide: true });
        child.once('error', (error: Error) => resolve({ code: null, error }));
        child.once('close', (code: number | null) => resolve({ code }));
      });
      return {
        command: target,
        available: result.code === 0,
        detail: result.code === 0 ? '可用' : result.error?.message || `版本探针退出码 ${result.code}`,
      };
    } catch (err: any) {
      return { command: target, available: false, detail: err?.message || String(err) };
    }
  }

  return { command: target, available: false, detail: '当前环境没有可用的进程检查接口' };
}

function resolveImageMimeType(file: Blob & { name?: string }): string {
  const declared = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (declared.startsWith('image/')) return declared;

  const name = String((file as any).name || '').toLowerCase();
  const extension = name.split('.').pop() || '';
  const byExtension: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
  };
  return byExtension[extension] || '';
}

function extensionForImageMime(mimeType: string): string {
  const extension = mimeType.split('/')[1]?.split(';')[0]?.toLowerCase() || 'png';
  return extension === 'jpeg' ? 'jpg' : extension === 'svg+xml' ? 'svg' : extension;
}

function bytesToBase64(bytes: Uint8Array): string {
  const globalObj = globalThis as any;
  if (typeof globalObj.btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return globalObj.btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('当前环境不支持图片编码');
}

async function writeTempBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  const globals = globalThis as any;
  if (globals.IOUtils?.makeDirectory && globals.IOUtils?.write) {
    await globals.IOUtils.makeDirectory(IMAGE_TEMP_DIR, { createAncestors: true, ignoreExisting: true });
    await globals.IOUtils.write(filePath, bytes);
    return;
  }

  if (globals.OS?.File?.makeDir && globals.OS?.File?.writeAtomic) {
    await globals.OS.File.makeDir(IMAGE_TEMP_DIR, { from: null, ignoreExisting: true });
    await globals.OS.File.writeAtomic(filePath, bytes, { tmpPath: `${filePath}.tmp` });
    return;
  }

  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    const fsModule = 'node:fs/promises';
    const fs = await import(fsModule);
    await fs.mkdir(IMAGE_TEMP_DIR, { recursive: true });
    await fs.writeFile(filePath, bytes);
    return;
  }

  throw new Error('当前 Zotero 环境没有可用的本地文件写入接口');
}

export async function persistImageFile(
  file: Blob & { name?: string },
  includeDataUrl = true
): Promise<ImageAttachment> {
  const mimeType = resolveImageMimeType(file);
  if (!mimeType) {
    throw new Error('只支持 PNG、JPEG、WebP、GIF、BMP、AVIF 或 SVG 图片');
  }

  const arrayBuffer = await (file as any).arrayBuffer?.();
  if (!arrayBuffer) throw new Error('无法读取图片数据');
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength === 0) throw new Error('图片文件为空');
  if (bytes.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`图片不能超过 ${Math.floor(MAX_IMAGE_ATTACHMENT_BYTES / 1024 / 1024)} MB`);
  }

  const originalName = String((file as any).name || `image.${extensionForImageMime(mimeType)}`);
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'image';
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const filePath = `${IMAGE_TEMP_DIR}/${token}-${safeName}`;
  await writeTempBytes(filePath, bytes);

  return {
    name: originalName,
    mimeType,
    size: bytes.byteLength,
    path: filePath,
    ...(includeDataUrl ? { dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}` } : {}),
  };
}

export async function removeTempImageAttachment(attachment: ImageAttachment): Promise<void> {
  const filePath = attachment.path;
  if (!filePath || !filePath.startsWith(`${IMAGE_TEMP_DIR}/`)) return;

  const globals = globalThis as any;
  try {
    if (globals.IOUtils?.remove) {
      await globals.IOUtils.remove(filePath, { ignoreAbsent: true });
      return;
    }
    if (globals.OS?.File?.remove) {
      await globals.OS.File.remove(filePath, { ignoreAbsent: true });
      return;
    }
    if (typeof process !== 'undefined' && (process as any).versions?.node) {
      const fsModule = 'node:fs/promises';
      const fs = await import(fsModule);
      await fs.rm(filePath, { force: true });
    }
  } catch (_) {
  }
}
