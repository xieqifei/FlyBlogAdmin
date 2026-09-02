import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('provides one Vercel function entry for image-hosting endpoints', () => {
  const entry = fileURLToPath(new URL('../api/r2.ts', import.meta.url));
  assert.equal(existsSync(entry), true, 'missing consolidated API entry for /api/r2');
});

test('stays within the Vercel serverless function limit', async () => {
  const apiDirectory = fileURLToPath(new URL('../api', import.meta.url));
  const countEntries = async (directory: string): Promise<number> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const counts = await Promise.all(entries.map((entry) => entry.isDirectory()
      ? countEntries(`${directory}/${entry.name}`)
      : Number(entry.name.endsWith('.ts'))));
    return counts.reduce((sum, count) => sum + count, 0);
  };
  assert.ok(await countEntries(apiDirectory) <= 12, 'api contains more than 12 Vercel functions');
});
