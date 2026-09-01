import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editMarkdownTable, findMarkdownTables, parseMarkdownTable } from '../src/markdownTable.ts';

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

test('finds and parses a table in a mixed markdown document', () => {
  const document = [
    '# 综合示例',
    '',
    '**粗体**和普通段落。',
    '',
    '```ts',
    'const fake = "| not | a table |";',
    '| --- | --- |',
    '```',
    '',
    '| 名称 | 类型 | 说明 |',
    '| :- | -: | --- |',
    '| 联合类型 | `string | number` | **可选值** |',
    '',
    '- 列表项',
  ].join('\n');
  const tables = findMarkdownTables(document);
  assert.equal(tables.length, 1);
  assert.deepEqual(parseMarkdownTable(tables[0].source), {
    headers: ['名称', '类型', '说明'],
    rows: [['联合类型', '`string | number`', '**可选值**']],
    alignments: ['left', 'right', 'left'],
  });
});
