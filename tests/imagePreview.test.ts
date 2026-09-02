import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownImageUrl, privateImagePreviewUrl } from '../src/imagePreview.ts';

test('unwraps angle-bracket Markdown image destinations', () => {
  assert.equal(markdownImageUrl('<https://images.example/a photo.png>'), 'https://images.example/a photo.png');
});

test('routes path-style private bucket objects through the authenticated image endpoint', () => {
  assert.equal(
    privateImagePreviewUrl('https://account.r2.example/blog-images/2026/09/a%20photo.png', 'blog-images'),
    '/api/r2?action=content&bucket=blog-images&key=2026%2F09%2Fa+photo.png',
  );
});

test('leaves public and unrelated image URLs untouched', () => {
  const source = 'https://cdn.example/2026/09/photo.png';
  assert.equal(privateImagePreviewUrl(source, 'blog-images'), source);
  assert.equal(privateImagePreviewUrl(source, ''), source);
});
