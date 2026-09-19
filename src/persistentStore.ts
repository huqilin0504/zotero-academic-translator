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
