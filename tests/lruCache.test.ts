import test from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache } from '../src/lruCache';

test('lruCache: 基本存取与存在性检测', () => {
  const cache = new LRUCache<string, string>(3);
  cache.set('a', 'apple');
  cache.set('b', 'banana');

  assert.equal(cache.get('a'), 'apple');
  assert.equal(cache.get('b'), 'banana');
  assert.equal(cache.get('c'), undefined);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('c'), false);
  assert.equal(cache.size, 2);
});

test('lruCache: 容量满时淘汰最久未使用项', () => {
  const cache = new LRUCache<string, string>(3);
  cache.set('1', 'one');
  cache.set('2', 'two');
  cache.set('3', 'three');

  // 访问 key 1，使其变为最近使用
  cache.get('1');

  // 写入 key 4，此时最久未使用的是 key 2
  cache.set('4', 'four');

  assert.equal(cache.has('2'), false, 'Key 2 应该被淘汰');
  assert.equal(cache.has('1'), true, 'Key 1 仍应存在');
  assert.equal(cache.has('3'), true, 'Key 3 仍应存在');
  assert.equal(cache.has('4'), true, 'Key 4 应该存在');
});

test('lruCache: clear 与 delete', () => {
  const cache = new LRUCache<string, string>(2);
  cache.set('x', '10');
  cache.set('y', '20');

  assert.equal(cache.delete('x'), true);
  assert.equal(cache.has('x'), false);
  assert.equal(cache.size, 1);

  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.has('y'), false);
});
