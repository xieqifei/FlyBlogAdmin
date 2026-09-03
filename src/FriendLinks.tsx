import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Empty, Form, Input, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { parseFrontMatter, writeFrontMatter } from '../shared/frontMatter';
import { parseFriendLinks, writeFriendLinks, type FriendLink } from '../shared/hexoPages';
import { useI18n } from './i18n';

type Page = { kind: 'links'; path: string; sha?: string; content: string };

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed'); return data as T;
}

export default function FriendLinks() {
  const t = useI18n(); const { message } = App.useApp();
  const [page, setPage] = useState<Page>(); const [links, setLinks] = useState<FriendLink[]>([]); const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [editing, setEditing] = useState<number>(); const [open, setOpen] = useState(false); const [form] = Form.useForm<FriendLink>();
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await request<{ page: Page }>('/api/pages?kind=links'); setPage(data.page); setLinks(parseFriendLinks(data.page.content)); setTitle(String(parseFrontMatter(data.page.content).fields.title || '')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('pages.loadFailed')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { load(); }, [load]);
  const showForm = (index?: number) => { setEditing(index); form.setFieldsValue(index === undefined ? { name: '', url: '', description: '', avatar: '' } : links[index]); setOpen(true); };
  const apply = async () => { const value = await form.validateFields(); setLinks((current) => editing === undefined ? [...current, value] : current.map((link, index) => index === editing ? value : link)); setOpen(false); };
  const save = async () => {
    if (!page) return; setSaving(true);
    try {
      const content = writeFriendLinks(writeFrontMatter(page.content, { title: title.trim() || t('links.defaultTitle'), layout: 'page' }), links);
      const data = await request<{ page: Page }>('/api/pages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'links', sha: page.sha, content }) });
      setPage(data.page); message.success(t('pages.saved'));
    } catch (reason) { message.error(reason instanceof Error ? reason.message : t('pages.saveFailed')); } finally { setSaving(false); }
  };
  return <div className="special-page">
    <Card loading={loading} title={t('links.title')} extra={<Space wrap><Button icon={<ReloadOutlined />} onClick={load}>{t('pages.refresh')}</Button><Button icon={<PlusOutlined />} onClick={() => showForm()}>{t('links.add')}</Button><Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!page} onClick={save}>{t('pages.save')}</Button></Space>}>
      {error && <Alert className="table-alert" showIcon type="error" message={error} />}
      <label className="page-title-field">{t('pages.titleLabel')}<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <Table<FriendLink> rowKey={(link) => `${link.name}\0${link.url}`} dataSource={links} pagination={false} locale={{ emptyText: <Empty description={t('links.empty')} /> }} columns={[
        { title: t('links.name'), dataIndex: 'name' }, { title: t('links.url'), dataIndex: 'url', responsive: ['sm'], render: (url: string) => <Typography.Link href={url} target="_blank" rel="noreferrer">{url}</Typography.Link> },
        { title: t('links.description'), dataIndex: 'description', responsive: ['md'] }, { title: t('posts.actionsCol'), width: 96, render: (_, __, index) => <Space size={4}><Button type="text" icon={<EditOutlined />} aria-label={t('links.edit')} onClick={() => showForm(index)} /><Popconfirm title={t('links.deleteConfirm')} onConfirm={() => setLinks((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Button danger type="text" icon={<DeleteOutlined />} aria-label={t('links.delete')} /></Popconfirm></Space> },
      ]} />
    </Card>
    <Modal open={open} title={t(editing === undefined ? 'links.add' : 'links.edit')} onCancel={() => setOpen(false)} onOk={apply} destroyOnHidden><Form form={form} layout="vertical"><Form.Item name="name" label={t('links.name')} rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="url" label={t('links.url')} rules={[{ required: true }, { pattern: /^https?:\/\//i, message: t('links.urlInvalid') }]}><Input placeholder="https://example.com" /></Form.Item><Form.Item name="description" label={t('links.description')}><Input /></Form.Item><Form.Item name="avatar" label={t('links.avatar')} rules={[{ pattern: /^https?:\/\//i, warningOnly: true, message: t('links.urlInvalid') }]}><Input placeholder="https://example.com/avatar.png" /></Form.Item></Form></Modal>
  </div>;
}
