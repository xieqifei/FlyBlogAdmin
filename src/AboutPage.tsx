import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Input, Space, Spin } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { parseFrontMatter, writeBody, writeFrontMatter } from '../shared/frontMatter';
import MarkdownEditor from './MarkdownEditor';
import { useI18n } from './i18n';
import type { Configuration } from './SettingsGuide';

type Page = { kind: 'about'; path: string; sha?: string; content: string };
async function request<T>(url: string, options?: RequestInit): Promise<T> { const response = await fetch(url, options); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Request failed'); return data as T; }

export default function AboutPage({ configuration }: { configuration: Configuration }) {
  const t = useI18n(); const { message } = App.useApp(); const [page, setPage] = useState<Page>(); const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { const data = await request<{ page: Page }>('/api/pages?kind=about'); setPage(data.page); } catch (reason) { setError(reason instanceof Error ? reason.message : t('pages.loadFailed')); } finally { setLoading(false); } }, [t]);
  useEffect(() => { load(); }, [load]);
  const parsed = useMemo(() => parseFrontMatter(page?.content || ''), [page?.content]);
  const save = async () => { if (!page) return; setSaving(true); try { const data = await request<{ page: Page }>('/api/pages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(page) }); setPage(data.page); message.success(t('pages.saved')); } catch (reason) { message.error(reason instanceof Error ? reason.message : t('pages.saveFailed')); } finally { setSaving(false); } };
  if (loading && !page) return <div className="special-page-loading"><Spin size="large" /></div>;
  return <div className="special-page">{error && <Alert showIcon type="error" message={error} action={<Button onClick={load}>{t('posts.retry')}</Button>} />}{page && <><Card title={t('about.title')} extra={<Space><Button icon={<ReloadOutlined />} onClick={load}>{t('pages.refresh')}</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>{t('pages.save')}</Button></Space>}><label className="page-title-field">{t('pages.titleLabel')}<Input value={String(parsed.fields.title || '')} onChange={(event) => setPage((current) => current ? { ...current, content: writeFrontMatter(current.content, { title: event.target.value, layout: 'page' }) } : current)} /></label></Card><div className="editor-body"><MarkdownEditor value={parsed.body} onChange={(body) => setPage((current) => current ? { ...current, content: writeBody(current.content, body) } : current)} r2Configured={Boolean(configuration.r2?.configured)} defaultBucket={configuration.r2?.defaultBucket || ''} r2PublicUrl={configuration.r2?.publicUrl || ''} /></div></> }</div>;
}
