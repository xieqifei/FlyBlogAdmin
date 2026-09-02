import assert from 'node:assert/strict';
import test from 'node:test';
import { httpsImageUrl } from '../src/imageUrl.ts';

test('adds HTTPS to image URLs without duplicating an existing protocol', () => {
  assert.equal(httpsImageUrl('images.example.com/photo.png'), 'https://images.example.com/photo.png');
  assert.equal(httpsImageUrl('//images.example.com/photo.png'), 'https://images.example.com/photo.png');
  assert.equal(httpsImageUrl('http://images.example.com/photo.png'), 'https://images.example.com/photo.png');
  assert.equal(httpsImageUrl('https://images.example.com/photo.png'), 'https://images.example.com/photo.png');
});
