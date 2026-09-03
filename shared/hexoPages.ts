export type FriendLink = { name: string; url: string; description: string; avatar: string };

const START = '<!-- flyblog-links:start -->';
const END = '<!-- flyblog-links:end -->';

function splitFrontMatter(content: string) {
  const match = content.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return { prefix: match?.[0] || '', body: match ? content.slice(match[0].length) : content };
}

function escapeCell(value: string) {
  return value.trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function splitRow(row: string) {
  const cells: string[] = []; let current = ''; let escaped = false;
  for (const character of row.trim().replace(/^\||\|$/g, '')) {
    if (escaped) { current += character; escaped = false; }
    else if (character === '\\') escaped = true;
    else if (character === '|') { cells.push(current.trim()); current = ''; }
    else current += character;
  }
  cells.push(current.trim());
  return cells;
}

export function friendLinksBlock(links: FriendLink[]) {
  const rows = links.map((link) => `| ${escapeCell(link.name)} | <${escapeCell(link.url)}> | ${escapeCell(link.description)} | ${escapeCell(link.avatar)} |`);
  return [START, '| Name | URL | Description | Avatar |', '| --- | --- | --- | --- |', ...rows, END].join('\n');
}

export function parseFriendLinks(content: string): FriendLink[] {
  const body = splitFrontMatter(content).body;
  const managed = body.match(new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*([\\s\\S]*?)\\s*${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  if (!managed) return [];
  return managed[1].split(/\r?\n/).slice(2).filter((line) => /^\s*\|/.test(line)).map(splitRow).filter((cells) => cells.length >= 2 && cells[0] && cells[1]).map(([name, url, description = '', avatar = '']) => ({ name, url: url.replace(/^<(.+)>$/, '$1'), description, avatar }));
}

export function writeFriendLinks(content: string, links: FriendLink[]) {
  const parsed = splitFrontMatter(content); const block = friendLinksBlock(links);
  const expression = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const body = expression.test(parsed.body)
    ? parsed.body.replace(expression, block)
    : `${parsed.body.trimEnd()}${parsed.body.trim() ? '\n\n' : ''}${block}\n`;
  return `${parsed.prefix}${body}`;
}

export function createHexoPage(kind: 'links' | 'about') {
  const title = kind === 'links' ? '友情链接' : '关于';
  const initial = `---\ntitle: ${title}\nlayout: page\n---\n\n`;
  return kind === 'links' ? writeFriendLinks(initial, []) : initial;
}
