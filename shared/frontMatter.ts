export type FrontMatterValue = string | string[];
export type FrontMatterFields = Record<string, FrontMatterValue>;

function scalar(value: string) {
  return value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
}

function inlineValue(value: string): FrontMatterValue {
  const raw = value.trim();
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(scalar).map((item) => item.replace(/^[-*+]\s+/, '')).filter(Boolean);
  }
  if (/^[-*+]\s+/.test(raw)) return [scalar(raw.replace(/^[-*+]\s+/, ''))].filter(Boolean);
  return scalar(raw);
}

export function parseFrontMatter(content: string) {
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const fields: FrontMatterFields = {};
  if (match) {
    let listKey = '';
    for (const line of match[1].split(/\r?\n/)) {
      const item = line.match(/^\s*[-*+]\s+(.+)$/);
      if (item && listKey) {
        const current = fields[listKey];
        if (Array.isArray(current)) current.push(scalar(item[1]));
        continue;
      }
      const field = line.match(/^([\w.-]+):\s*(.*)$/);
      if (!field) continue;
      const [, key, raw] = field;
      if (!raw.trim()) { fields[key] = []; listKey = key; }
      else { fields[key] = inlineValue(raw); listKey = ''; }
    }
  }
  return { fields, prefix: match?.[0] || '', body: match ? content.slice(match[0].length) : content };
}

export function values(value: FrontMatterValue | undefined) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => item.trim().replace(/^[-*+]\s+/, '')).filter(Boolean);
}

export function writeBody(content: string, body: string) {
  const parsed = parseFrontMatter(content);
  return `${parsed.prefix}${body}`;
}

export function writeFrontMatter(content: string, updates: FrontMatterFields) {
  const parsed = parseFrontMatter(content);
  const fields = { ...parsed.fields, ...updates };
  const lines = Object.entries(fields).flatMap(([key, value]) => Array.isArray(value)
    ? (value.length ? [`${key}:`, ...values(value).map((item) => `  - ${item}`)] : [`${key}:`])
    : value ? [`${key}: ${value}`] : [`${key}:`]);
  return `---\n${lines.join('\n')}\n---\n\n${parsed.body.replace(/^\s+/, '')}`;
}
