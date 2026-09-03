import assert from 'node:assert/strict';
import test from 'node:test';
import { createHexoPage, parseFriendLinks, writeFriendLinks } from '../shared/hexoPages.ts';

test('creates Hexo-compatible pages with front matter', () => {
  assert.match(createHexoPage('about'), /^---\ntitle: 关于\nlayout: page\n---/);
  assert.match(createHexoPage('links'), /^---\ntitle: 友情链接\nlayout: page\n---/);
});

test('round-trips structured friend links through a Markdown table', () => {
  const content = writeFriendLinks(createHexoPage('links'), [{ name: 'A | B', url: 'https://example.com', description: 'Friends', avatar: 'https://example.com/a.png' }]);
  assert.deepEqual(parseFriendLinks(content), [{ name: 'A | B', url: 'https://example.com', description: 'Friends', avatar: 'https://example.com/a.png' }]);
});

test('preserves content outside the managed friend-link block', () => {
  const original = createHexoPage('links').replace('<!-- flyblog-links:start -->', 'Intro\n\n<!-- flyblog-links:start -->').replace('<!-- flyblog-links:end -->', '<!-- flyblog-links:end -->\n\nFooter');
  const updated = writeFriendLinks(original, [{ name: 'Example', url: 'https://example.com', description: '', avatar: '' }]);
  assert.match(updated, /Intro/); assert.match(updated, /Footer/);
});
