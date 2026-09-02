export function httpsImageUrl(value: string) {
  const url = value.trim().replace(/^(?:https?:)?\/\//i, '');
  return `https://${url}`;
}
