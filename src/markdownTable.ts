export type TableAction = 'add-row' | 'delete-row' | 'add-column' | 'delete-column';

export type MarkdownTable = {
  headers: string[];
  rows: string[][];
  alignments: Array<'left' | 'center' | 'right'>;
};

function cells(line: string) {
  const result: string[] = []; let cell = ''; let codeFence = 0;
  const trimmed = line.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === '`') {
      let length = 1;
      while (trimmed[index + length] === '`') length += 1;
      codeFence = codeFence === length ? 0 : codeFence ? codeFence : length;
      cell += '`'.repeat(length); index += length - 1; continue;
    }
    if (character === '\\' && trimmed[index + 1] === '|') { cell += '|'; index += 1; continue; }
    if (character === '|' && !codeFence) { result.push(cell.trim()); cell = ''; continue; }
    cell += character;
  }
  result.push(cell.trim());
  if (trimmed.startsWith('|')) result.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) result.pop();
  return result;
}

function isRow(line: string) { return line.includes('|') && cells(line).length > 1; }
function isDelimiter(line: string) { const values = cells(line); return values.length > 1 && values.every((cell) => /^:?-+:?$/.test(cell)); }

function pipeOffsets(line: string) {
  const offsets: number[] = []; let codeFence = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '`') {
      let length = 1;
      while (line[index + length] === '`') length += 1;
      codeFence = codeFence === length ? 0 : codeFence ? codeFence : length;
      index += length - 1; continue;
    }
    if (line[index] === '\\') { index += 1; continue; }
    if (line[index] === '|' && !codeFence) offsets.push(index);
  }
  return offsets;
}

export function parseMarkdownTable(markdown: string): MarkdownTable | undefined {
  const lines = markdown.trim().split(/\r?\n/);
  if (lines.length < 2 || !isRow(lines[0]) || !isDelimiter(lines[1])) return undefined;
  const headers = cells(lines[0]);
  const delimiters = cells(lines[1]);
  const alignments = headers.map((_, index) => {
    const delimiter = delimiters[index] || '---';
    return delimiter.startsWith(':') && delimiter.endsWith(':') ? 'center' : delimiter.endsWith(':') ? 'right' : 'left';
  });
  const rows = lines.slice(2).filter(isRow).map((line) => {
    const row = cells(line).slice(0, headers.length);
    return [...row, ...Array(Math.max(0, headers.length - row.length)).fill('')];
  });
  return { headers, rows, alignments };
}

function serializeCell(value: string) {
  const singleLine = value.replace(/[\r\n]+/g, ' ').trim();
  let result = ''; let codeFence = 0;
  for (let index = 0; index < singleLine.length; index += 1) {
    const character = singleLine[index];
    if (character === '`') {
      let length = 1;
      while (singleLine[index + length] === '`') length += 1;
      codeFence = codeFence === length ? 0 : codeFence ? codeFence : length;
      result += '`'.repeat(length); index += length - 1; continue;
    }
    if (character === '|' && !codeFence && singleLine[index - 1] !== '\\') result += '\\|';
    else result += character;
  }
  return result;
}

function serialize(table: MarkdownTable) {
  const alignment = table.alignments.map((value) => value === 'center' ? ':---:' : value === 'right' ? '---:' : '---');
  return [table.headers, alignment, ...table.rows].map((row, index) => `| ${(index === 1 ? row : row.map(serializeCell)).join(' | ')} |`).join('\n');
}

export type MarkdownTableRange = { from: number; to: number; source: string; table: MarkdownTable };

function tableRanges(content: string) {
  const lines = content.split('\n');
  const offsets: number[] = []; let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  const ranges: Array<{ from: number; to: number; firstLine: number; lastLine: number }> = [];
  let fenced = false; let fenceMarker = '';
  for (let index = 0; index < lines.length - 1; index += 1) {
    const fence = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!fenced) { fenced = true; fenceMarker = marker; }
      else if (marker === fenceMarker) { fenced = false; fenceMarker = ''; }
      continue;
    }
    if (fenced) continue;
    if (!isRow(lines[index]) || !isDelimiter(lines[index + 1])) continue;
    if (cells(lines[index]).length !== cells(lines[index + 1]).length) continue;
    let lastLine = index + 1;
    while (lastLine + 1 < lines.length && isRow(lines[lastLine + 1])) lastLine += 1;
    ranges.push({ from: offsets[index], to: offsets[lastLine] + lines[lastLine].length, firstLine: index, lastLine });
    index = lastLine;
  }
  return { lines, offsets, ranges };
}

export function findMarkdownTables(content: string): MarkdownTableRange[] {
  return tableRanges(content).ranges.flatMap(({ from, to }) => {
    const source = content.slice(from, to); const table = parseMarkdownTable(source);
    return table ? [{ from, to, source, table }] : [];
  });
}

export function editMarkdownTable(content: string, position: number, action: TableAction) {
  const { lines, offsets, ranges } = tableRanges(content);
  const range = ranges.find((candidate) => position >= candidate.from && position <= candidate.to + 2);
  if (!range) return undefined;
  const original = content.slice(range.from, range.to);
  const table = parseMarkdownTable(original);
  if (!table) return undefined;

  let sourceLine = range.lastLine;
  for (let index = range.firstLine; index <= range.lastLine; index += 1) {
    const lineEnd = offsets[index] + lines[index].length;
    if (position >= offsets[index] && position <= lineEnd) { sourceLine = index; break; }
  }
  const rowIndex = sourceLine <= range.firstLine + 1 ? 0 : sourceLine - range.firstLine - 1;
  const line = lines[sourceLine] || '';
  const withinLine = Math.max(0, position - (offsets[sourceLine] || 0));
  const beforeCursor = line.slice(0, withinLine);
  const leadingPipe = line.trimStart().startsWith('|') ? 1 : 0;
  const columnIndex = Math.max(0, Math.min(table.headers.length - 1, pipeOffsets(beforeCursor).length - leadingPipe));

  if (action === 'add-row') table.rows.splice(Math.min(rowIndex + 1, table.rows.length), 0, table.headers.map(() => '内容'));
  if (action === 'delete-row') {
    if (!table.rows.length) return undefined;
    table.rows.splice(Math.min(Math.max(0, rowIndex - 1), table.rows.length - 1), 1);
  }
  if (action === 'add-column') {
    const insertAt = columnIndex + 1;
    table.headers.splice(insertAt, 0, '新列'); table.alignments.splice(insertAt, 0, 'left');
    table.rows.forEach((row) => row.splice(insertAt, 0, '内容'));
  }
  if (action === 'delete-column') {
    if (table.headers.length <= 2) return undefined;
    table.headers.splice(columnIndex, 1); table.alignments.splice(columnIndex, 1);
    table.rows.forEach((row) => row.splice(columnIndex, 1));
  }

  const replacement = serialize(table);
  return { content: `${content.slice(0, range.from)}${replacement}${content.slice(range.to)}`, from: range.from, to: range.from + replacement.length };
}

export function updateMarkdownTableCell(content: string, tableFrom: number, rowIndex: number, columnIndex: number, value: string) {
  const range = tableRanges(content).ranges.find((candidate) => candidate.from === tableFrom);
  if (!range) return undefined;
  const table = parseMarkdownTable(content.slice(range.from, range.to));
  if (!table || columnIndex < 0 || columnIndex >= table.headers.length) return undefined;
  const normalized = value.replace(/[\r\n]+/g, ' ').trim();
  if (rowIndex < 0) table.headers[columnIndex] = normalized;
  else {
    if (rowIndex >= table.rows.length) return undefined;
    table.rows[rowIndex][columnIndex] = normalized;
  }
  const replacement = serialize(table);
  return { content: `${content.slice(0, range.from)}${replacement}${content.slice(range.to)}`, from: range.from, to: range.from + replacement.length };
}

export function markdownTableCellPosition(content: string, tableFrom: number, rowIndex: number, columnIndex: number) {
  const { lines, offsets, ranges } = tableRanges(content);
  const range = ranges.find((candidate) => candidate.from === tableFrom);
  if (!range || columnIndex < 0) return undefined;
  const lineIndex = rowIndex < 0 ? range.firstLine : range.firstLine + rowIndex + 2;
  if (lineIndex > range.lastLine) return undefined;
  const line = lines[lineIndex]; const pipes = pipeOffsets(line); const leadingPipe = line.trimStart().startsWith('|');
  const relative = columnIndex === 0 && !leadingPipe ? 0 : (pipes[columnIndex - (leadingPipe ? 0 : 1)] ?? line.length - 1) + 1;
  return offsets[lineIndex] + Math.min(line.length, relative);
}
