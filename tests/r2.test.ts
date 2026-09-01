import assert from 'node:assert/strict';
import test from 'node:test';
import { buildObjectKey, contentTypeFor, validateBucketName, validateObjectKey } from '../server/r2.ts';

test('validates R2 buckets and object keys', () => {
  assert.equal(validateBucketName('blog-images'), 'blog-images');
  assert.equal(validateObjectKey('/2026/09/photo.png'), '2026/09/photo.png');
  assert.throws(() => validateBucketName('Bad Bucket'));
  assert.throws(() => validateObjectKey('../secret'));
});

test('creates dated image keys and detects common content types', () => {
  assert.match(buildObjectKey('My Photo.PNG'), /^\d{4}\/\d{2}\/my-photo-\d{2}-[a-z0-9]{6}\.png$/);
  assert.equal(contentTypeFor('photo.webp'), 'image/webp');
  assert.equal(contentTypeFor('unknown.bin'), 'application/octet-stream');
});
