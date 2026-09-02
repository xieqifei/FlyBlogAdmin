import assert from 'node:assert/strict';
import test from 'node:test';
import { buildObjectKey, contentTypeFor, listBuckets, requireR2Client, validateBucketName, validateObjectKey } from '../server/r2.ts';

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

test('uses the configured bucket without requiring account-wide ListBuckets permission', async () => {
  const previous = process.env.S3_BUCKET;
  process.env.S3_BUCKET = 'blog-images';
  try {
    assert.deepEqual(await listBuckets(), [{ name: 'blog-images', creationDate: '' }]);
  } finally {
    if (previous === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = previous;
  }
});

test('uses path-style S3 requests for manually configured endpoints', async () => {
  const previous = {
    endpoint: process.env.S3_ENDPOINT,
    accessKey: process.env.S3_ACCESS_KEY_ID,
    secret: process.env.S3_SECRET_ACCESS_KEY,
  };
  Object.assign(process.env, { S3_ENDPOINT: 'https://s3.example.com', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' });
  try {
    assert.equal(requireR2Client().config.forcePathStyle, true);
  } finally {
    for (const [name, value] of Object.entries({ S3_ENDPOINT: previous.endpoint, S3_ACCESS_KEY_ID: previous.accessKey, S3_SECRET_ACCESS_KEY: previous.secret })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
