import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Empty, Popconfirm, Select, Space, Spin, Typography, Upload } from 'antd';
import { CopyOutlined, DeleteOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import type { Configuration } from './SettingsGuide';
import { useI18n } from './i18n';

const BUCKET_KEY = 'flyblog:r2bucket';
type R2Object = { key: string; size: number; lastModified: string; url: string };

function bucketNames(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { buckets?: unknown }).buckets)) return [];
  return (value as { buckets: unknown[] }).buckets.flatMap((item) => item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string' ? [(item as { name: string }).name] : []);
}

function objectPage(value: unknown): { objects: R2Object[]; next: string } {
  if (!value || typeof value !== 'object') return { objects: [], next: '' };
  const page = value as { objects?: unknown; next?: unknown };
  const objects = Array.isArray(page.objects) ? page.objects.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<R2Object>;
    if (typeof candidate.key !== 'string' || typeof candidate.url !== 'string') return [];
    return [{ key: candidate.key, url: candidate.url, size: Number(candidate.size) || 0, lastModified: typeof candidate.lastModified === 'string' ? candidate.lastModified : '' }];
  }) : [];
  return { objects, next: typeof page.next === 'string' ? page.next : '' };
}

export function rememberedBucket() { try { return localStorage.getItem(BUCKET_KEY) || ''; } catch { return ''; } }
export function rememberBucket(bucket: string) { try { localStorage.setItem(BUCKET_KEY, bucket); } catch { /* ignore */ } }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败'); return data as T;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const result = String(reader.result || ''); resolve(result.includes(',') ? result.split(',')[1] : result); };
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export async function uploadImageFile(file: File, bucket = '') {
  const content = await fileToBase64(file);
  return api<{ key: string; url: string; bucket: string }>('/api/r2?action=upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket: bucket || undefined, filename: file.name, contentType: file.type, content }),
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ImageHosting({ configuration }: { configuration: Configuration }) {
  const t = useI18n(); const { message } = AntApp.useApp();
  const configured = Boolean(configuration.r2?.configured);
  const [buckets, setBuckets] = useState<string[]>([]);
  const [bucket, setBucket] = useState(rememberedBucket() || configuration.r2?.defaultBucket || '');
  const [objects, setObjects] = useState<R2Object[]>([]);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [loadError, setLoadError] = useState('');

  const copy = async (text: string, successKey: string) => {
    try { await navigator.clipboard.writeText(text); message.success(t(successKey)); } catch { message.error(t('error.requestFailed')); }
  };

  const loadBuckets = useCallback(async () => {
    if (!configured) return;
    setLoadingBuckets(true); setLoadError('');
    try {
      const data = await api<unknown>('/api/r2?action=buckets');
      const names = bucketNames(data);
      setBuckets(names);
      setBucket((current) => current || names[0] || '');
    } catch (reason) { const error = reason instanceof Error ? reason.message : t('ih.loadFailed'); setLoadError(error); message.error(error); } finally { setLoadingBuckets(false); }
  }, [configured, message, t]);

  useEffect(() => { loadBuckets(); }, [loadBuckets]);

  const loadObjects = useCallback(async (selected: string, token = '') => {
    if (!selected) return;
    setLoading(true); setLoadError('');
    try {
      const query = new URLSearchParams({ action: 'objects', bucket: selected });
      if (token) query.set('next', token);
      const data = objectPage(await api<unknown>(`/api/r2?${query}`));
      setObjects((current) => token ? [...current, ...data.objects] : data.objects);
      setNext(data.next);
    } catch (reason) { const error = reason instanceof Error ? reason.message : t('ih.loadFailed'); setLoadError(error); message.error(error); } finally { setLoading(false); }
  }, [message, t]);

  useEffect(() => { setObjects([]); setNext(''); if (bucket) loadObjects(bucket); }, [bucket, loadObjects]);

  const upload = useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    setUploading((count) => count + images.length);
    let failed = 0;
    for (const file of images) {
      try {
        await uploadImageFile(file, bucket);
      } catch { failed += 1; }
    }
    setUploading((count) => count - images.length);
    if (failed) message.error(t('ih.uploadFailed', { error: `${failed}` }));
    else message.success(t('md.uploaded', { count: images.length }));
    if (bucket) loadObjects(bucket);
  }, [bucket, loadObjects, message, t]);

  const remove = useCallback(async (key: string) => {
    try {
      await api(`/api/r2?action=objects&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      message.success(t('ih.deleted'));
      setObjects((current) => current.filter((item) => item.key !== key));
    } catch (reason) { message.error(reason instanceof Error ? reason.message : t('error.delete')); }
  }, [bucket, message, t]);

  const markdownLink = (item: R2Object) => `![${item.key.split('/').pop()?.replace(/\.[^.]+$/, '') || 'image'}](${item.url})`;
  const previewLink = (item: R2Object) => `/api/r2?action=content&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(item.key)}`;

  const notice = useMemo(() => configuration.r2?.publicUrl ? null : (t('ih.noPublicUrl')), [configuration.r2?.publicUrl, t]);

  if (!configured) {
    return <div className="image-hosting-page">
      <Alert showIcon type="warning" message={t('ih.notConfiguredTitle')} description={t('ih.notConfiguredDesc')} />
      <Card title={t('menu.images')}><Typography.Paragraph type="secondary">{t('sg.var.S3_ENDPOINT')}</Typography.Paragraph><Typography.Paragraph type="secondary">{t('sg.var.S3_ACCESS_KEY_ID')}</Typography.Paragraph><Typography.Paragraph type="secondary">{t('sg.var.S3_SECRET_ACCESS_KEY')}</Typography.Paragraph></Card>
    </div>;
  }

  return <div className="image-hosting-page">
    {notice && <Alert showIcon type="info" message={notice} />}
    {loadError && <Alert showIcon closable type="error" message={t('ih.loadFailed')} description={loadError} onClose={() => setLoadError('')} />}
    <Card title={t('menu.images')} extra={<Space><Select aria-label={t('ih.bucket')} value={bucket || undefined} placeholder={t('ih.selectBucket')} loading={loadingBuckets} style={{ minWidth: 220 }} options={buckets.map((name) => ({ value: name, label: name }))} onChange={(value) => { rememberBucket(value); setBucket(value); }} /><Button icon={<ReloadOutlined />} onClick={() => { loadBuckets(); if (bucket) loadObjects(bucket); }}>{t('ih.refresh')}</Button></Space>}>
      <Upload.Dragger accept="image/*" multiple showUploadList={false} disabled={uploading > 0 || !bucket} customRequest={({ file, onSuccess, onError }) => { upload([file as File]).then(() => onSuccess?.(null)).catch(onError); }}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{uploading > 0 ? t('ih.uploading') : t('ih.dragUpload')}</p>
      </Upload.Dragger>
      <div className="image-hosting-list">
        {loading && objects.length === 0 ? <div className="image-hosting-loading"><Spin /></div> : objects.length ? <>
          <div className="image-hosting-grid">{objects.map((item) => <div className="image-hosting-item" key={item.key}>
            <div className="image-hosting-thumb"><img src={previewLink(item)} alt={item.key} loading="lazy" onError={(event) => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }} /></div>
            <div className="image-hosting-name" title={item.key}>{item.key.split('/').pop()}</div>
            <Typography.Text type="secondary" className="image-hosting-size">{formatSize(item.size)}</Typography.Text>
            <Space wrap className="image-hosting-actions">
              <Button size="small" icon={<CopyOutlined />} onClick={() => copy(markdownLink(item), 'ih.copiedMarkdown')}>{t('ih.copyMarkdown')}</Button>
              <Button size="small" icon={<CopyOutlined />} onClick={() => copy(item.url, 'ih.copiedUrl')}>{t('ih.copyUrl')}</Button>
              <Popconfirm title={t('ih.confirmDelete')} onConfirm={() => remove(item.key)}><Button size="small" danger icon={<DeleteOutlined />}>{t('ih.delete')}</Button></Popconfirm>
            </Space>
          </div>)}</div>
          {next && <div className="image-hosting-more"><Button onClick={() => loadObjects(bucket, next)}>{t('ih.loadMore')}</Button></div>}
        </> : <Empty description={t('ih.emptyObjects')} />}
      </div>
    </Card>
  </div>;
}
