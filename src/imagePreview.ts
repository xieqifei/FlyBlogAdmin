export function markdownImageUrl(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
}

export function privateImagePreviewUrl(source: string, bucket: string, origin = 'http://localhost') {
  if (!bucket) return source;
  try {
    const url = new URL(markdownImageUrl(source), origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return source;
    const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    const bucketIndex = segments.indexOf(bucket);
    const key = bucketIndex >= 0 ? segments.slice(bucketIndex + 1).join('/') : '';
    if (!key) return source;
    const query = new URLSearchParams({ action: 'content', bucket, key });
    return `/api/r2?${query}`;
  } catch {
    return source;
  }
}
