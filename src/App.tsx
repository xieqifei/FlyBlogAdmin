import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Collapse, Empty, Form, Input, Layout, Menu, Modal, Popconfirm, Row as Grid, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { ApartmentOutlined, CloseOutlined, EditOutlined, FileAddOutlined, FileTextOutlined, FolderOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ReloadOutlined, RobotOutlined, SettingOutlined, TagsOutlined } from '@ant-design/icons';
import GraphView from './GraphView';
import MarkdownEditor from './MarkdownEditor';
import SettingsGuide, { type Configuration } from './SettingsGuide';

const { Sider, Header, Content } = Layout;
const items = [
  { key: 'home', icon: <HomeOutlined />, label: '首页' },
  { key: 'posts', icon: <FileTextOutlined />, label: '文章管理' },
  { key: 'graph', icon: <ApartmentOutlined />, label: '关系图谱' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];
type Row = { name: string; path: string; sha?: string; title?: string; categories?: string[]; tags?: string[]; date?: string; updated?: string };
type Post = Row & { content: string };
type OptimizeMode = 'proofread' | 'rewrite' | 'concise' | 'outline';

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败'); return data as T;
}

function slugify(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${slug || `post-${Date.now()}`}.md`;
}

function frontMatter(content: string) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/); const fields: Record<string, string | string[]> = {};
  if (match) {
    let currentList = '';
    for (const line of match[1].split(/\r?\n/)) {
      const item = line.match(/^\s*-\s+(.+)$/); if (item && currentList) { (fields[currentList] as string[]).push(item[1].trim()); continue; }
      const field = line.match(/^([\w.-]+):\s*(.*)$/); if (!field) continue;
      if (!field[2]) { fields[field[1]] = []; currentList = field[1]; } else { const raw = field[2].trim(); currentList = ''; fields[field[1]] = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : raw.replace(/^['"]|['"]$/g, ''); }
    }
  }
  return { fields, prefix: match?.[0] || '', body: match ? content.slice(match[0].length) : content };
}

function writeBody(content: string, body: string) {
  const parsed = frontMatter(content);
  return `${parsed.prefix}${body}`;
}

function writeFrontMatter(content: string, updates: Record<string, string | string[]>) {
  const parsed = frontMatter(content); const fields = { ...parsed.fields, ...updates };
  const lines = Object.entries(fields).flatMap(([key, value]) => Array.isArray(value) ? [`${key}:`, ...value.map((item) => `  - ${item}`)] : value ? [`${key}: ${value}`] : []);
  return `---\n${lines.join('\n')}\n---\n\n${parsed.body.replace(/^\s+/, '')}`;
}

function list(value: string | string[] | undefined) { return Array.isArray(value) ? value : value ? [value] : []; }

function Login({ onLogin, onSetup }: { onLogin: () => void; onSetup: () => void }) {
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const submit = async (values: { username: string; password: string }) => {
    setLoading(true); setError(''); try { await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); onLogin(); } catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败'); } finally { setLoading(false); }
  };
  return <main className="auth-page"><Card className="auth-card"><div className="auth-brand">FlyBlog Admin</div><Typography.Title level={3}>登录</Typography.Title>{error && <Alert showIcon type="error" message={error} />}<Form layout="vertical" onFinish={submit}><Form.Item label="用户名" name="username" rules={[{ required: true }]}><Input autoComplete="username" autoFocus /></Form.Item><Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item><Button type="primary" htmlType="submit" block loading={loading}>登录</Button></Form><Button type="link" block onClick={onSetup}>查看环境变量设置指南</Button></Card></main>;
}

function Dashboard({ configuration, onLogout }: { configuration: Configuration; onLogout: () => void }) {
  const { message } = AntApp.useApp(); const [collapsed, setCollapsed] = useState(false); const [isMobile, setIsMobile] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [section, setSection] = useState('home');
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(false); const [loadError, setLoadError] = useState(''); const [editor, setEditor] = useState<Post>(); const [editorOpen, setEditorOpen] = useState(false); const [saving, setSaving] = useState(false);
  const [optimizeMode, setOptimizeMode] = useState<OptimizeMode>('proofread'); const [instruction, setInstruction] = useState(''); const [suggestion, setSuggestion] = useState(''); const [optimizing, setOptimizing] = useState(false); const [aiOpen, setAiOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); setLoadError(''); try { const data = await api<{ posts: Row[] }>('/api/posts'); setRows(data.posts); } catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : '文章载入失败'); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);

  const edit = async (path: string) => {
    setSaving(true); try { const data = await api<{ post: Post }>(`/api/posts?path=${encodeURIComponent(path)}`); setEditor(data.post); setEditorOpen(true); setSection('posts'); } catch (reason) { message.error(reason instanceof Error ? reason.message : '文章载入失败'); } finally { setSaving(false); }
  };
  const create = () => { const date = new Date().toISOString().slice(0, 10); setEditor({ name: '', path: '', content: `---\ntitle: \ndate: ${date}\ncategories:\ntags:\n---\n\n` }); setEditorOpen(true); };
  const updateMetadata = (updates: Record<string, string | string[]>) => setEditor((value) => value ? { ...value, content: writeFrontMatter(value.content, updates) } : value);
  const metadata = useMemo(() => editor ? frontMatter(editor.content).fields : {}, [editor?.content]);
  const save = async () => {
    if (!editor) return; const articleTitle = String(metadata.title || '').trim(); const path = editor.path.trim() || slugify(articleTitle);
    if (!articleTitle) return message.warning('请填写文章标题'); setSaving(true);
    try { await api('/api/posts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editor, path, name: path.split('/').pop() }) }); message.success('文章已保存到 GitHub'); setEditorOpen(false); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : '保存失败'); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!editor?.sha) return; setSaving(true); try { await api('/api/posts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editor) }); message.success('文章已删除'); setEditorOpen(false); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : '删除失败'); } finally { setSaving(false); }
  };
  const optimize = async () => {
    if (!editor?.content.trim()) return; setOptimizing(true); setSuggestion('');
    try { const data = await api<{ suggestion: string }>('/api/ai/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editor.content, mode: optimizeMode, instruction }) }); setSuggestion(data.suggestion); } catch (reason) { message.error(reason instanceof Error ? reason.message : 'AI 优化失败'); } finally { setOptimizing(false); }
  };
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { onLogout(); } };
  const title = items.find((item) => item.key === section)?.label;
  const categories = [...new Set(rows.flatMap((row) => row.categories || []))]; const tags = [...new Set(rows.flatMap((row) => row.tags || []))];

  const dashboard = <div className="dashboard-page">
    <div className="welcome"><div><Typography.Title level={2}>内容工作台</Typography.Title><Typography.Text type="secondary">集中查看博客数据，快速开始下一篇创作。</Typography.Text></div><Button size="large" type="primary" icon={<FileAddOutlined />} onClick={create}>新建文章</Button></div>
    <Grid gutter={[16, 16]}><Col xs={24} sm={12} xl={6}><Card><Statistic title="文章总数" value={rows.length} prefix={<FileTextOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title="分类" value={categories.length} prefix={<FolderOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title="标签" value={tags.length} prefix={<TagsOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title="已标注日期" value={rows.filter((row) => row.updated || row.date).length} prefix={<EditOutlined />} /></Card></Col></Grid>
    <Grid gutter={[16, 16]}><Col xs={24} lg={12}><Card title="分类分布">{categories.length ? <Space wrap>{categories.map((category) => <Tag color="blue" key={category}>{category} · {rows.filter((row) => row.categories?.includes(category)).length}</Tag>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分类" />}</Card></Col><Col xs={24} lg={12}><Card title="常用标签">{tags.length ? <Space wrap>{tags.sort((a, b) => rows.filter((row) => row.tags?.includes(b)).length - rows.filter((row) => row.tags?.includes(a)).length).slice(0, 20).map((tag) => <Tag color="green" key={tag}>{tag} · {rows.filter((row) => row.tags?.includes(tag)).length}</Tag>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无标签" />}</Card></Col></Grid>
    <Card title="最近文章" extra={<Button type="link" onClick={() => setSection('posts')}>查看全部</Button>}><Table<Row> size="small" tableLayout="fixed" pagination={false} rowKey="path" dataSource={rows.slice(0, 5)} columns={[{ title: '标题', render: (_, row) => <span className="post-title">{row.title || row.name}</span> }, { title: '日期', responsive: ['sm'], render: (_, row) => row.updated || row.date || '—' }, { title: '', width: 64, render: (_, row) => <Button type="link" onClick={() => edit(row.path)}>编辑</Button> }]} /></Card>
  </div>;

  const posts = <Card title="文章" extra={<Space><Button icon={<FileAddOutlined />} type="primary" onClick={create}>新建</Button><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button></Space>}>
    {loadError && <Alert className="table-alert" showIcon type="error" message={loadError} action={<Button size="small" onClick={load}>重试</Button>} />}
    <Table<Row> rowKey="path" tableLayout="fixed" loading={loading} dataSource={rows} scroll={isMobile ? undefined : { x: 680 }} columns={[{ title: '标题', render: (_, row) => <span className="post-title">{row.title || row.name}</span> }, { title: '分类 / 标签', responsive: ['md'], render: (_, row) => <Space wrap>{row.categories?.map((value) => <Tag color="blue" key={`c-${value}`}>{value}</Tag>)}{row.tags?.map((value) => <Tag color="green" key={`t-${value}`}>{value}</Tag>)}</Space> }, { title: '路径', dataIndex: 'path', responsive: ['lg'] }, { title: '操作', width: isMobile ? 64 : 90, render: (_, row) => <Button type="link" onClick={() => edit(row.path)}>编辑</Button> }]} locale={{ emptyText: <Empty description={loading ? '正在从 GitHub 加载文章' : '暂无文章'} /> }} />
  </Card>;

  return <Layout className="app">
    {isMobile && mobileOpen && <button className="mobile-menu-mask" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} />}
    <Sider theme="light" breakpoint="lg" collapsedWidth={isMobile ? 0 : 80} collapsed={isMobile ? !mobileOpen : collapsed} onBreakpoint={(broken) => { setIsMobile(broken); setMobileOpen(false); }} trigger={null} width={240} className="sider"><div className="logo"><span>{collapsed && !isMobile ? 'FB' : 'FlyBlog Admin'}</span>{isMobile && mobileOpen && <Button className="mobile-menu-close" type="text" aria-label="关闭菜单" icon={<CloseOutlined />} onClick={() => setMobileOpen(false)} />}</div><Menu theme="light" mode="inline" selectedKeys={[section]} items={items} onClick={({ key }) => { setSection(key); if (isMobile) setMobileOpen(false); }} /></Sider>
    <Layout><Header className="header"><Button type="text" icon={(isMobile ? !mobileOpen : collapsed) ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => { if (isMobile) setMobileOpen((value) => !value); else setCollapsed((value) => !value); }} /><Typography.Title level={4}>{title}</Typography.Title><Button className="header-logout" type="text" aria-label="退出登录" icon={<LogoutOutlined />} onClick={logout}>{isMobile ? '' : '退出登录'}</Button></Header><Content className="content"><div className="content-stack">{section === 'home' ? dashboard : section === 'posts' ? posts : section === 'graph' ? <GraphView onEdit={edit} /> : <SettingsGuide configuration={configuration} />}</div></Content></Layout>
    <Modal open={editorOpen} width={1120} title={editor?.sha ? `编辑文章 · ${editor.name}` : '新建文章'} onCancel={() => setEditorOpen(false)} footer={<Space wrap>{editor?.sha && <Popconfirm title="确定删除这篇文章？" description="Git 历史中仍可恢复。" onConfirm={remove}><Button danger>删除</Button></Popconfirm>}<Button icon={<RobotOutlined />} onClick={() => { setSuggestion(''); setAiOpen(true); }}>AI 优化</Button><Button onClick={() => setEditorOpen(false)}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存并提交</Button></Space>}>
      {editor ? <div className="editor-form"><label>文章标题<Input value={String(metadata.title || '')} placeholder="输入标题，系统将自动生成文件路径" onChange={(event) => updateMetadata({ title: event.target.value })} /></label><Collapse ghost items={[{ key: 'metadata', label: '日期、分类与标签', children: <Grid gutter={[16, 12]}><Col xs={24} md={8}><label>发布日期<Input type="date" value={String(metadata.date || '')} onChange={(event) => updateMetadata({ date: event.target.value })} /></label></Col><Col xs={24} md={8}><label>分类<Select mode="tags" tokenSeparators={[',']} value={list(metadata.categories)} onChange={(value) => updateMetadata({ categories: value })} placeholder="输入后回车添加" /></label></Col><Col xs={24} md={8}><label>标签<Select mode="tags" tokenSeparators={[',']} value={list(metadata.tags)} onChange={(value) => updateMetadata({ tags: value })} placeholder="输入后回车添加" /></label></Col>{editor.sha && <Col span={24}><Typography.Text type="secondary">文件路径：{editor.path}</Typography.Text></Col>}</Grid> }]}/><label>Markdown 正文<MarkdownEditor value={frontMatter(editor.content).body} onChange={(body) => setEditor((value) => value ? { ...value, content: writeBody(value.content, body) } : value)} /></label></div> : <Spin />}
    </Modal>
    <Modal open={aiOpen} width={1080} title="AI 文章优化" onCancel={() => setAiOpen(false)} footer={<Space><Button onClick={() => setAiOpen(false)}>关闭</Button><Button disabled={!suggestion} onClick={() => { setEditor((value) => value ? { ...value, content: suggestion } : value); setAiOpen(false); message.success('已应用建议，请检查后再保存'); }}>应用到文章</Button><Button type="primary" loading={optimizing} onClick={optimize}>生成建议</Button></Space>}>
      <Alert showIcon type="info" message="先预览，再应用" description="参考 Obsidian AI 写作插件的 Apply Edit 工作流：模型只生成建议，不会直接保存或覆盖 GitHub 内容。" />
      <div className="ai-controls"><Select value={optimizeMode} onChange={setOptimizeMode} options={[{ value: 'proofread', label: '校对错别字与语病' }, { value: 'rewrite', label: '改善结构与表达' }, { value: 'concise', label: '压缩冗余内容' }, { value: 'outline', label: '优化标题与大纲' }]} /><Input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="可选：补充要求，例如“保持技术术语不变”" /></div>
      {suggestion ? <div className="ai-preview"><div><Typography.Text strong>当前文章</Typography.Text><Input.TextArea readOnly value={editor?.content} /></div><div><Typography.Text strong>AI 建议</Typography.Text><Input.TextArea value={suggestion} onChange={(event) => setSuggestion(event.target.value)} /></div></div> : <Empty description={optimizing ? '正在生成建议…' : '选择优化方式后生成建议'} />}
    </Modal>
  </Layout>;
}

export default function Root() {
  const [configuration, setConfiguration] = useState<Configuration>(); const [authenticated, setAuthenticated] = useState<boolean>(); const [showSetup, setShowSetup] = useState(false);
  useEffect(() => { (async () => {
    let current: Configuration;
    try { current = await api<Configuration>('/api/config'); if (typeof current.configured !== 'boolean' || !Array.isArray(current.missing)) throw new Error('API unavailable'); }
    catch { setConfiguration({ configured: false, status: {}, missing: ['API 服务'] }); setAuthenticated(false); return; }
    setConfiguration(current);
    if (!current.configured) { setAuthenticated(false); return; }
    try { await api('/api/auth/session'); setAuthenticated(true); } catch { setAuthenticated(false); }
  })(); }, []);
  if (!configuration || authenticated === undefined) return <div className="boot"><Spin size="large" /></div>;
  if (!configuration.configured || showSetup) return <main className="setup-shell"><div className="setup-heading"><Typography.Title level={2}>FlyBlog Admin 设置</Typography.Title>{configuration.configured && <Button onClick={() => setShowSetup(false)}>返回登录</Button>}</div><SettingsGuide configuration={configuration} /></main>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} onSetup={() => setShowSetup(true)} />;
  return <AntApp><Dashboard configuration={configuration} onLogout={() => setAuthenticated(false)} /></AntApp>;
}
