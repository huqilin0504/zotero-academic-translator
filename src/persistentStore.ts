/**
 * 小型本地持久化层：优先写入 Zotero.Prefs，测试/预览环境再回退到
 * 当前文档的 localStorage。这里只保存 JSON 文本，不接触网络。
 */
export function readPersistentJson<T>(key: string, fallback: T, doc?: Document): T {
  const zotero = (globalThis as any).Zotero;
  try {
    const raw = zotero?.Prefs?.get?.(key);
    if (typeof raw === 'string' && raw) return JSON.parse(raw) as T;
  } catch (_) {}

  try {
    const storage = doc?.defaultView?.localStorage || (globalThis as any).localStorage;
    const raw = storage?.getItem?.(key);
    if (typeof raw === 'string' && raw) return JSON.parse(raw) as T;
  } catch (_) {}

  return fallback;
}

export function writePersistentJson<T>(key: string, value: T, doc?: Document): void {
  const serialized = JSON.stringify(value);
  const zotero = (globalThis as any).Zotero;
  try {
    if (typeof zotero?.Prefs?.set === 'function') {
      zotero.Prefs.set(key, serialized);
      return;
    }
  } catch (_) {}

  try {
    const storage = doc?.defaultView?.localStorage || (globalThis as any).localStorage;
    storage?.setItem?.(key, serialized);
  } catch (_) {}
}
