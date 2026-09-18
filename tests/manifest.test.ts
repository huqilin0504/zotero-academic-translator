import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('manifest declares the supported Zotero 7+ compatibility range', () => {
  const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const target = manifest.applications?.zotero;

  assert.equal(manifest.manifest_version, 2);
  assert.equal(target?.id, 'gemini-translator@local.ai');
  assert.equal(target?.strict_min_version, '7.0');
  assert.equal(target?.strict_max_version, '10.*');
});
