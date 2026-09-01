import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFrontMatter, values, writeFrontMatter } from '../shared/frontMatter.ts';

test('parses date-times and YAML lists without leaking list markers', () => {
  const parsed = parseFrontMatter('---\ntitle: Demo\ndate: 2026-08-31 19:20:30\nupdated: 2026-09-01T10:20:30+08:00\ncategories:\n  - Node.js\ntags: - TypeScript\n---\n\nBody');
  assert.equal(parsed.fields.date, '2026-08-31 19:20:30');
  assert.equal(parsed.fields.updated, '2026-09-01T10:20:30+08:00');
  assert.deepEqual(values(parsed.fields.categories), ['Node.js']);
  assert.deepEqual(values(parsed.fields.tags), ['TypeScript']);
  assert.equal(parsed.body, '\nBody');
});

test('writes normalized list metadata while preserving unknown fields and body', () => {
  const result = writeFrontMatter('---\ntitle: Demo\ncover: image.png\ncategories: - Old\n---\n\nText', { categories: ['New'], updated: '2026-09-01 20:00:00' });
  assert.match(result, /cover: image\.png/);
  assert.match(result, /categories:\n  - New/);
  assert.match(result, /updated: 2026-09-01 20:00:00/);
  assert.match(result, /\n\nText$/);
});
