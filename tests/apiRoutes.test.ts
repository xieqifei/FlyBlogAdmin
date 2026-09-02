import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('provides a Vercel function entry for every image-hosting endpoint', () => {
  for (const route of ['buckets', 'objects', 'upload', 'content']) {
    const entry = fileURLToPath(new URL(`../api/r2/${route}.ts`, import.meta.url));
    assert.equal(existsSync(entry), true, `missing API entry for /api/r2/${route}`);
  }
});
