import { DeleteObjectCommand, GetObjectCommand, ListBucketsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { posix } from 'node:path';

export class R2Error extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function r2Configuration() {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim() || '';
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim() || '';
  const defaultBucket = process.env.S3_BUCKET?.trim() || '';
  const endpoint = process.env.S3_ENDPOINT?.trim() || '';
  const publicUrl = process.env.S3_PUBLIC_URL?.trim() || '';
  return { accessKeyId, secretAccessKey, defaultBucket, endpoint, publicUrl };
}

export function requireR2Client() {
  const config = r2Configuration();
  if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey) throw new R2Error('图床未配置：请先设置 S3_ENDPOINT、S3_ACCESS_KEY_ID 和 S3_SECRET_ACCESS_KEY', 503);
  return new S3Client({ region: 'auto', endpoint: config.endpoint, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
}

export function validateBucketName(value: unknown) {
  const name = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) throw new R2Error('无效的存储桶名称', 400);
  return name;
}

export function validateObjectKey(value: unknown) {
  const key = String(value || '').trim().replace(/^\/+/, '');
  if (!key || key.length > 1024 || key.includes('\\') || key.split('/').some((segment) => segment === '..' || segment.startsWith('..'))) throw new R2Error('无效的对象键', 400);
  return key;
}

export function objectUrl(bucket: string, key: string) {
  const config = r2Configuration();
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  if (config.publicUrl) return `${config.publicUrl.replace(/\/+$/, '')}/${encodedKey}`;
  return `${config.endpoint.replace(/\/+$/, '')}/${bucket}/${encodedKey}`;
}

const contentTypeByExtension: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.tiff': 'image/tiff',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.zip': 'application/zip', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

export function contentTypeFor(filename: string) {
  const extension = posix.extname(filename).toLowerCase();
  return contentTypeByExtension[extension] || 'application/octet-stream';
}

export function buildObjectKey(filename: string) {
  const originalExtension = posix.extname(filename || '');
  const extension = originalExtension.toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
  const base = posix.basename(filename || 'image', originalExtension).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'image';
  const now = new Date();
  const month = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const stamp = `${String(now.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 8)}`;
  return `${month}/${base}-${stamp}${extension}`;
}

export async function listBuckets() {
  const client = requireR2Client();
  const result = await client.send(new ListBucketsCommand({}));
  return (result.Buckets || []).map((bucket) => ({ name: bucket.Name || '', creationDate: bucket.CreationDate?.toISOString() || '' })).sort((left, right) => left.name.localeCompare(right.name));
}

export async function listObjects(bucket: string, prefix: string, continuationToken?: string) {
  const client = requireR2Client();
  const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken || undefined, MaxKeys: 100 }));
  return {
    objects: (result.Contents || []).filter((item) => item.Key && !item.Key.endsWith('/')).map((item) => ({
      key: item.Key!, size: Number(item.Size || 0), lastModified: item.LastModified?.toISOString() || '', url: objectUrl(bucket, item.Key!),
    })),
    next: result.IsTruncated ? result.NextContinuationToken || '' : '',
  };
}

export async function getObject(bucket: string, key: string) {
  const client = requireR2Client();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) throw new R2Error('图片内容为空', 404);
  return { body: Buffer.from(bytes), contentType: result.ContentType || contentTypeFor(key) };
}

export async function putObject(input: { bucket: string; key: string; body: Buffer; contentType?: string }) {
  const client = requireR2Client();
  const result = await client.send(new PutObjectCommand({ Bucket: input.bucket, Key: input.key, Body: input.body, ContentType: input.contentType || 'application/octet-stream' }));
  return { key: input.key, url: objectUrl(input.bucket, input.key), eTag: result.ETag || '' };
}

export async function deleteObject(bucket: string, key: string) {
  const client = requireR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return true;
}
