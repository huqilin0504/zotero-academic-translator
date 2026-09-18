/**
 * 高性能内存 LRU (Least Recently Used) 缓存
 * 用于对已翻译文本提供 0ms 瞬间响应
 */
export class LRUCache<K = string, V = string> {
  private capacity: number;
  private cache: Map<K, V>;

  constructor(capacity: number = 500) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.cache = new Map<K, V>();
  }

  public get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }
    // 命中缓存，提升至最近使用（重新插入到队尾）
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  public set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // 淘汰最久未使用的元素（Map 键迭代器的第一个）
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  public has(key: K): boolean {
    return this.cache.has(key);
  }

  public delete(key: K): boolean {
    return this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }

  public get size(): number {
    return this.cache.size;
  }
}
