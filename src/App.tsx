import { useCallback, useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Empty, Form, Input, Layout, Menu, Modal, Popconfirm, Space, Spin, Table, Typography } from 'antd';
import { ApartmentOutlined, FileAddOutlined, FileTextOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import GraphView from './GraphView';
import SettingsGuide, { type Configuration } from './SettingsGuide';

const { Sider, Header, Content } = Layout;
const items = [
  { key: 'posts', icon: <FileTextOutlined />, label: '文章管理' },
  { key: 'graph', icon: <ApartmentOutlined />, label: '关系图谱' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];
type Row = { name: string; path: string; sha?: string };
type Post = Row & { content: string };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败'); return data as T;
}

function Login({ onLogin, onSetup }: { onLogin: () => void; onSetup: () => void }) {
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const submit = async (values: { username: string; password: string }) => {
    setLoading(true); setError(''); try { await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); onLogin(); } catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败'); } finally { setLoading(false); }
  };
  return <main className="auth-page"><Card className="auth-card"><div className="auth-brand">FlyBlog Admin</div><Typography.Title level={3}>登录</Typography.Title>{error && <Alert showIcon type="error" message={error} />}<Form layout="vertical" onFinish={submit}><Form.Item label="用户名" name="username" rules={[{ required: true }]}><Input autoComplete="username" autoFocus /></Form.Item><Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item><Button type="primary" htmlType="submit" block loading={loading}>登录</Button></Form><Button type="link" block onClick={onSetup}>查看环境变量设置指南</Button></Card></main>;
}

function Dashboard({ configuration, onLogout }: { configuration: Configuration; onLogout: () => void }) {
  const { message } = AntApp.useApp(); const [collapsed, setCollapsed] = useState(false); const [isMobile, setIsMobile] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [section, setSection] = useState('posts');
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(false); const [loadError, setLoadError] = useState(''); const [editor, setEditor] = useState<Post>(); const [editorOpen, setEditorOpen] = useState(false); const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { setLoading(true); setLoadError(''); try { const data = await api<{ posts: Row[] }>('/api/posts'); setRows(data.posts); } catch (reason) { setLoadError(reason instanceof Error ? reason.message : '文章载入失败'); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);

  const edit = async (path: string) => {
    setSaving(true); try { const data = await api<{ post: Post }>(`/api/posts?path=${encodeURIComponent(path)}`); setEditor(data.post); setEditorOpen(true); setSection('posts'); } catch (reason) { message.error(reason instanceof Error ? reason.message : '文章载入失败'); } finally { setSaving(false); }
  };
  const create = () => { setEditor({ name: '', path: '', content: '' }); setEditorOpen(true); };
  const save = async () => {
    if (!editor?.path.trim()) return message.warning('请填写文章路径'); setSaving(true);
    try { await api('/api/posts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editor) }); message.success('文章已保存到 GitHub'); setEditorOpen(false); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : '保存失败'); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!editor?.sha) return; setSaving(true); try { await api('/api/posts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editor) }); message.success('文章已删除'); setEditorOpen(false); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : '删除失败'); } finally { setSaving(false); }
  };
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { onLogout(); } };
  const title = items.find((item) => item.key === section)?.label;

  const posts = <Card title="文章" extra={<Space><Button icon={<FileAddOutlined />} type="primary" onClick={create}>新建</Button><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button></Space>}>
    {loadError && <Alert className="table-alert" showIcon type="error" message={loadError} action={<Button size="small" onClick={load}>重试</Button>} />}
    <Table<Row> rowKey="path" loading={loading} dataSource={rows} scroll={{ x: 620 }} columns={[{ title: '文件名', dataIndex: 'name' }, { title: '路径', dataIndex: 'path', responsive: ['md'] }, { title: '操作', width: 90, render: (_, row) => <Button type="link" onClick={() => edit(row.path)}>编辑</Button> }]} locale={{ emptyText: <Empty description={loading ? '正在从 GitHub 加载文章' : '暂无文章'} /> }} />
  </Card>;

  return <Layout className="app">
    <Sider theme="light" breakpoint="lg" collapsedWidth={isMobile ? 0 : 80} collapsed={isMobile ? !mobileOpen : collapsed} onBreakpoint={(broken) => { setIsMobile(broken); setMobileOpen(false); }} trigger={null} width={240} className="sider"><div className="logo">{collapsed && !isMobile ? 'FB' : 'FlyBlog Admin'}</div><Menu theme="light" mode="inline" selectedKeys={[section]} items={items} onClick={({ key }) => { setSection(key); if (isMobile) setMobileOpen(false); }} /><Button className="logout" type="text" icon={<LogoutOutlined />} onClick={logout}>{(!collapsed || isMobile) && '退出登录'}</Button></Sider>
    <Layout><Header className="header"><Button type="text" icon={(isMobile ? !mobileOpen : collapsed) ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => { if (isMobile) setMobileOpen((value) => !value); else setCollapsed((value) => !value); }} /><Typography.Title level={4}>{title}</Typography.Title></Header><Content className="content">{section === 'posts' ? posts : section === 'graph' ? <GraphView onEdit={edit} /> : <SettingsGuide configuration={configuration} />}</Content></Layout>
    <Modal open={editorOpen} width={960} title={editor?.sha ? `编辑文章 · ${editor.name}` : '新建文章'} onCancel={() => setEditorOpen(false)} footer={<Space>{editor?.sha && <Popconfirm title="确定删除这篇文章？" description="Git 历史中仍可恢复。" onConfirm={remove}><Button danger>删除</Button></Popconfirm>}<Button onClick={() => setEditorOpen(false)}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存并提交</Button></Space>}>
      {saving && !editor ? <Spin /> : <div className="editor-form"><label>文章路径<Input value={editor?.path} disabled={Boolean(editor?.sha)} placeholder="my-post.md" onChange={(event) => setEditor((value) => value ? { ...value, path: event.target.value, name: event.target.value.split('/').pop() || '' } : value)} /></label><label>Markdown 正文<Input.TextArea className="markdown-editor" value={editor?.content} spellCheck={false} onChange={(event) => setEditor((value) => value ? { ...value, content: event.target.value } : value)} /></label></div>}
    </Modal>
  </Layout>;
}

export default function Root() {
  const [configuration, setConfiguration] = useState<Configuration>(); const [authenticated, setAuthenticated] = useState<boolean>(); const [showSetup, setShowSetup] = useState(false);
  useEffect(() => { (async () => { try { const current = await api<Configuration>('/api/config'); setConfiguration(current); if (!current.configured) { setAuthenticated(false); return; } await api('/api/auth/session'); setAuthenticated(true); } catch { setAuthenticated(false); } })(); }, []);
  if (!configuration || authenticated === undefined) return <div className="boot"><Spin size="large" /></div>;
  if (!configuration.configured || showSetup) return <main className="setup-shell"><div className="setup-heading"><Typography.Title level={2}>FlyBlog Admin 设置</Typography.Title>{configuration.configured && <Button onClick={() => setShowSetup(false)}>返回登录</Button>}</div><SettingsGuide configuration={configuration} /></main>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} onSetup={() => setShowSetup(true)} />;
  return <AntApp><Dashboard configuration={configuration} onLogout={() => setAuthenticated(false)} /></AntApp>;
}
