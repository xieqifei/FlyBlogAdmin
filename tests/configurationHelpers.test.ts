import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import { generatePasswordHash, generateSecretKey } from '../src/configurationHelpers.ts';

test('generates a high-entropy URL-safe secret key', () => {
  const first = generateSecretKey();
  const second = generateSecretKey();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test('generates a password hash accepted by the server verifier format', async () => {
  const password = 'correct horse battery staple';
  const generated = await generatePasswordHash(password);
  const [algorithm, iterationsText, salt, expected] = generated.split('$');
  assert.equal(algorithm, 'pbkdf2_sha256');
  assert.ok(Number(iterationsText) >= 600_000);
  assert.equal(pbkdf2Sync(password, salt, Number(iterationsText), Buffer.from(expected, 'base64').length, 'sha256').toString('base64'), expected);
});
