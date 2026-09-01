export function normalizeDateTime(value: unknown) {
  const text = String(value || '').trim();
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!matched) return text;
  const [, date, hour = '00', minute = '00', second = '00'] = matched;
  return `${date} ${hour}:${minute}:${second}`;
}

export function dateTimeInputValue(value: unknown) {
  const normalized = normalizeDateTime(value);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized) ? normalized.replace(' ', 'T') : '';
}

export function currentDateTime(current = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())} ${pad(current.getHours())}:${pad(current.getMinutes())}:${pad(current.getSeconds())}`;
}
