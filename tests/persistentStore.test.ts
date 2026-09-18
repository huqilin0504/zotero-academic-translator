import test from 'node:test';
import assert from 'node:assert/strict';
import { readPersistentJson, writePersistentJson } from '../src/persistentStore';

test('persistentStore: Zotero 首选项可保存并恢复 JSON', () => {
  const globals = globalThis as any;
  const previousZotero = globals.Zotero;
  let raw = '';
  globals.Zotero = {
    Prefs: {
      get: () => raw,
      set: (_key: string, value: string) => { raw = value; },
    },
  };

  try {
    writePersistentJson('extensions.gemini-translator.test', { turns: 2 });
    assert.deepEqual(
      readPersistentJson('extensions.gemini-translator.test', { turns: 0 }),
      { turns: 2 }
    );
  } finally {
    if (previousZotero === undefined) delete globals.Zotero;
    else globals.Zotero = previousZotero;
  }
});

test('persistentStore: Zotero 首选项不可用时不抛错并返回默认值', () => {
  const globals = globalThis as any;
  const previousZotero = globals.Zotero;
  try {
    delete globals.Zotero;
    assert.deepEqual(readPersistentJson('extensions.gemini-translator.missing', []), []);
  } finally {
    if (previousZotero === undefined) delete globals.Zotero;
    else globals.Zotero = previousZotero;
  }
});
