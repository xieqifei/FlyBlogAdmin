import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editMarkdownTable, parseMarkdownTable } from '../src/markdownTable.ts';

const source = '| 姓名 | 年龄 |\n| --- | ---: |\n| 小明 | 18 |';

test('parses table cells and alignment for live preview', () => {
  assert.deepEqual(parseMarkdownTable(source), { headers: ['姓名', '年龄'], rows: [['小明', '18']], alignments: ['left', 'right'] });
});

test('adds and removes rows from the table at the cursor', () => {
  const added = editMarkdownTable(source, source.length, 'add-row');
  assert.match(added?.content || '', /\| 内容 \| 内容 \|$/);
  const removed = editMarkdownTable(added!.content, added!.to, 'delete-row');
  assert.equal(removed?.content, source);
});

test('adds and removes columns while preserving a valid markdown table', () => {
  const added = editMarkdownTable(source, source.indexOf('年龄'), 'add-column');
  assert.deepEqual(parseMarkdownTable(added!.content)?.headers, ['姓名', '年龄', '新列']);
  const removed = editMarkdownTable(added!.content, added!.content.indexOf('新列'), 'delete-column');
  assert.equal(removed?.content, source);
});
