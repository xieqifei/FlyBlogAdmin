import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Collapse, Empty, Form, Input, Layout, Menu, Modal, Popconfirm, Row as Grid, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { ApartmentOutlined, ArrowLeftOutlined, CloseOutlined, CloudOutlined, DeleteOutlined, EditOutlined, FileAddOutlined, FileTextOutlined, FolderOutlined, HomeOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, SettingOutlined, TagsOutlined } from '@ant-design/icons';
import GraphView from './GraphView';
import MarkdownEditor from './MarkdownEditor';
import SettingsGuide, { type Configuration } from './SettingsGuide';
import { parseFrontMatter, values as frontMatterValues, writeBody, writeFrontMatter, type FrontMatterFields } from '../shared/frontMatter';

const { Sider, Header, Content } = Layout;
const items = [
  { key: 'home', icon: <HomeOutlined />, label: '首页' },
  { key: 'posts', icon: <FileTextOutlined />, label: '文章管理' },
  { key: 'graph', icon: <ApartmentOutlined />, label: '关系图谱' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];
type Row = { name: string; path: string; sha?: string; title?: string; categories?: string[]; tags?: string[]; date?: string; updated?: string };
type Post = Row & { content: string };
type OptimizeMode = 'generate' | 'proofread' | 'rewrite' | 'concise' | 'outline';

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败'); return data as T;
}

function slugify(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${slug || `post-${Date.now()}`}.md`;
}

function list(value: string | string[] | undefined) { return frontMatterValues(value); }

function dateOnly(value: string | string[] | undefined) { return String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || ''; }
function formatDate(value?: string) {
  if (!value) return '—'; const matched = value.match(/^\d{4}-\d{2}-\d{2}/); if (matched) return matched[0];
  const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0'); return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}
function time(value?: string) { if (!value) return 0; const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T')); return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime(); }
function markdownDateTime(current = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())} ${pad(current.getHours())}:${pad(current.getMinutes())}:${pad(current.getSeconds())}`;
}
const DRAFT_PREFIX = 'flyblog:draft:';
function draftKey(path?: string) { return `${DRAFT_PREFIX}${path || 'new'}`; }
function readDraft(path: string, remote: Post) {
  try { const saved = JSON.parse(localStorage.getItem(draftKey(path)) || '') as { post?: Post }; return saved.post?.content ? { ...remote, ...saved.post, path: remote.path, name: remote.name, sha: remote.sha } : remote; } catch { return remote; }
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const submit = async (values: { username: string; password: string }) => {
    setLoading(true); setError(''); try { await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); onLogin(); } catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败'); } finally { setLoading(false); }
  };
  return <main className="auth-page"><Card className="auth-card"><div className="auth-brand">FlyBlog Admin</div><Typography.Title level={3}>登录</Typography.Title>{error && <Alert showIcon type="error" message={error} />}<Form layout="vertical" onFinish={submit}><Form.Item label="用户名" name="username" rules={[{ required: true }]}><Input autoComplete="username" autoFocus /></Form.Item><Form.Item label="密码" name="password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item><Button type="primary" htmlType="submit" block loading={loading}>登录</Button></Form></Card></main>;
}

function Dashboard({ configuration, onLogout }: { configuration: Configuration; onLogout: () => void }) {
  const { message } = AntApp.useApp(); const [collapsed, setCollapsed] = useState(false); const [isMobile, setIsMobile] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [section, setSection] = useState('home');
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(false); const [loadError, setLoadError] = useState(''); const [editor, setEditor] = useState<Post>(); const [saving, setSaving] = useState(false); const [query, setQuery] = useState(''); const [draftSavedAt, setDraftSavedAt] = useState('');
  const [optimizeMode, setOptimizeMode] = useState<OptimizeMode>('proofread'); const [instruction, setInstruction] = useState(''); const [suggestion, setSuggestion] = useState(''); const [optimizing, setOptimizing] = useState(false); const [aiOpen, setAiOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); setLoadError(''); try { const data = await api<{ posts: Row[] }>('/api/posts'); setRows(data.posts); } catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : '文章载入失败'); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!editor) return undefined;
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftKey(editor.path), JSON.stringify({ post: editor, savedAt: Date.now() }));
      setDraftSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [editor]);

  const edit = async (path: string) => {
    setSaving(true); try { const data = await api<{ post: Post }>(`/api/posts?path=${encodeURIComponent(path)}`); const restored = readDraft(path, data.post); setEditor(restored); setDraftSavedAt(restored.content === data.post.content ? '' : '已恢复'); setSection('editor'); } catch (reason) { message.error(reason instanceof Error ? reason.message : '文章载入失败'); } finally { setSaving(false); }
  };
  const create = () => { const now = markdownDateTime(); const blank: Post = { name: '', path: '', content: `---\ntitle:\ndate: ${dateOnly(now)}\nupdated: ${now}\ncategories:\ntags:\n---\n\n` }; const restored = readDraft('', blank); setEditor(restored); setDraftSavedAt(restored.content === blank.content ? '' : '已恢复'); setSection('editor'); };
  const updateMetadata = (updates: FrontMatterFields) => setEditor((value) => value ? { ...value, content: writeFrontMatter(value.content, updates) } : value);
  const metadata = useMemo(() => editor ? parseFrontMatter(editor.content).fields : {}, [editor?.content]);
  const save = async () => {
    if (!editor) return; const articleTitle = String(metadata.title || '').trim(); const path = editor.path.trim() || slugify(articleTitle);
    if (!articleTitle) return message.warning('请填写文章标题'); setSaving(true);
    const content = writeFrontMatter(editor.content, { updated: markdownDateTime() });
    try { await api('/api/posts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editor, content, path, name: path.split('/').pop() }) }); localStorage.removeItem(draftKey(editor.path)); localStorage.removeItem(draftKey(path)); message.success('文章已保存到 GitHub，编辑时间已更新'); setEditor(undefined); setDraftSavedAt(''); setSection('posts'); await load(); } catch (reason) { setEditor((value) => value ? { ...value, content } : value); message.error(reason instanceof Error ? reason.message : '保存失败'); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!editor?.sha) return; setSaving(true); try { await api('/api/posts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editor) }); localStorage.removeItem(draftKey(editor.path)); message.success('文章已删除'); setEditor(undefined); setSection('posts'); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : '删除失败'); } finally { setSaving(false); }
  };
  const removeRow = async (row: Row) => {
    if (!row.sha) return; setSaving(true); try { await api('/api/posts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) }); localStorage.removeItem(draftKey(row.path)); message.success('文章已删除'); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : '删除失败'); } finally { setSaving(false); }
  };
  const optimize = async () => {
    if (!editor?.content.trim()) return; setOptimizing(true); setSuggestion('');
    try { const data = await api<{ suggestion: string }>('/api/ai/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editor.content, mode: optimizeMode, instruction }) }); setSuggestion(data.suggestion); } catch (reason) { message.error(reason instanceof Error ? reason.message : 'AI 优化失败'); } finally { setOptimizing(false); }
  };
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { onLogout(); } };
  const title = items.find((item) => item.key === section)?.label;
  const categories = [...new Set(rows.flatMap((row) => row.categories || []))]; const tags = [...new Set(rows.flatMap((row) => row.tags || []))];
  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => [row.title || row.name, ...(row.categories || []), ...(row.tags || [])].some((value) => value.toLocaleLowerCase().includes(keyword)));
  }, [query, rows]);
  const recentRows = useMemo(() => [...rows].sort((left, right) => time(right.updated || right.date) - time(left.updated || left.date)), [rows]);

  const dashboard = <div className="dashboard-page">
    <div className="welcome"><div><Typography.Title level={2}>内容工作台</Typography.Title><Typography.Text type="secondary">集中查看博客数据，快速开始下一篇创作。</Typography.Text></div><Button size="large" type="primary" icon={<FileAddOutlined />} onClick={create}>新建文章</Button></div>
    <Grid gutter={[16, 16]}><Col xs={24} sm={12} xl={6}><Card><Statistic title="文章总数" value={rows.length} prefix={<FileTextOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title="分类" value={categories.length} prefix={<FolderOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title="标签" value={tags.length} prefix={<TagsOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title="已标注日期" value={rows.filter((row) => row.updated || row.date).length} prefix={<EditOutlined />} /></Card></Col></Grid>
    <Grid gutter={[16, 16]}><Col xs={24} lg={12}><Card title="分类分布">{categories.length ? <Space wrap>{categories.map((category) => <Tag color="blue" key={category}>{category} · {rows.filter((row) => row.categories?.includes(category)).length}</Tag>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分类" />}</Card></Col><Col xs={24} lg={12}><Card title="常用标签">{tags.length ? <Space wrap>{tags.sort((a, b) => rows.filter((row) => row.tags?.includes(b)).length - rows.filter((row) => row.tags?.includes(a)).length).slice(0, 20).map((tag) => <Tag color="green" key={tag}>{tag} · {rows.filter((row) => row.tags?.includes(tag)).length}</Tag>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无标签" />}</Card></Col></Grid>
    <Card title="最近文章" extra={<Button type="link" onClick={() => setSection('posts')}>查看全部</Button>}><Table<Row> size="small" tableLayout="fixed" pagination={false} rowKey="path" dataSource={recentRows.slice(0, 5)} columns={[{ title: '标题', render: (_, row) => <span className="post-title">{row.title || row.name}</span> }, { title: '编辑日期', responsive: ['sm'], render: (_, row) => formatDate(row.updated || row.date) }, { title: '', width: 64, render: (_, row) => <Button type="link" onClick={() => edit(row.path)}>编辑</Button> }]} /></Card>
  </div>;

  const posts = <Card title="文章" extra={<Space><Button icon={<FileAddOutlined />} type="primary" onClick={create}>新建</Button><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button></Space>}>
    <Input className="post-search" allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、分类或标签" />
    {loadError && <Alert className="table-alert" showIcon type="error" message={loadError} action={<Button size="small" onClick={load}>重试</Button>} />}
    <Table<Row> rowKey="path" tableLayout="fixed" loading={loading} dataSource={filteredRows} showSorterTooltip={{ target: 'sorter-icon' }} scroll={isMobile ? undefined : { x: 940 }} columns={[
      { title: '标题', key: 'title', width: isMobile ? undefined : 360, sorter: (left, right) => (left.title || left.name).localeCompare(right.title || right.name, 'zh-CN'), render: (_, row) => <span className="post-title">{row.title || row.name}</span> },
      { title: '分类', key: 'categories', width: 150, responsive: ['sm'], sorter: (left, right) => (left.categories || []).join('/').localeCompare((right.categories || []).join('/'), 'zh-CN'), render: (_, row) => <Space wrap>{row.categories?.map((value) => <Tag color="blue" key={value}>{value}</Tag>)}</Space> },
      { title: '标签', key: 'tags', width: 160, responsive: ['md'], sorter: (left, right) => (left.tags || []).join('/').localeCompare((right.tags || []).join('/'), 'zh-CN'), render: (_, row) => <Space wrap>{row.tags?.map((value) => <Tag color="green" key={value}>{value}</Tag>)}</Space> },
      { title: '编辑日期', key: 'updated', width: 160, responsive: ['sm'], defaultSortOrder: 'descend', sorter: (left, right) => time(left.updated || left.date) - time(right.updated || right.date), render: (_, row) => formatDate(row.updated || row.date) },
      { title: '操作', key: 'actions', width: isMobile ? 88 : 110, render: (_, row) => <Space size={4}><Button type="text" aria-label={`编辑 ${row.title || row.name}`} title="编辑" icon={<EditOutlined />} onClick={() => edit(row.path)} /><Popconfirm title="确定删除这篇文章？" description="Git 历史中仍可恢复。" onConfirm={() => removeRow(row)}><Button type="text" danger aria-label={`删除 ${row.title || row.name}`} title="删除" icon={<DeleteOutlined />} /></Popconfirm></Space> },
    ]} locale={{ emptyText: <Empty description={loading ? '正在从 GitHub 加载文章' : query ? '没有匹配的文章' : '暂无文章'} /> }} />
  </Card>;

  const editorPage = editor ? <div className="article-editor-page">
    <div className="editor-page-heading">
      <Space><Button icon={<ArrowLeftOutlined />} onClick={() => setSection('posts')}>返回文章列表</Button><div><Typography.Title level={3}>{editor.sha ? '编辑文章' : '新建文章'}</Typography.Title><Typography.Text type="secondary"><CloudOutlined /> {draftSavedAt ? `草稿已自动保存（${draftSavedAt}）` : '修改会自动保存在当前浏览器'}</Typography.Text></div></Space>
      <Space wrap>{editor.sha && <Popconfirm title="确定删除这篇文章？" description="Git 历史中仍可恢复。" onConfirm={remove}><Button danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>}<Button icon={<RobotOutlined />} onClick={() => { setSuggestion(''); setAiOpen(true); }}>AI 优化</Button><Button type="primary" loading={saving} onClick={save}>保存并提交</Button></Space>
    </div>
    <Card className="editor-metadata-card">
      <div className="editor-form">
        <label>文章标题<Input value={String(metadata.title || '')} placeholder="输入标题，系统将自动生成文件名" onChange={(event) => updateMetadata({ title: event.target.value })} /></label>
        <Collapse ghost items={[{ key: 'metadata', label: '发布日期、编辑日期、分类与标签', children: <Grid gutter={[16, 12]}>
          <Col xs={24} md={6}><label>发布日期<Input type="date" value={dateOnly(metadata.date)} onChange={(event) => updateMetadata({ date: event.target.value })} /></label></Col>
          <Col xs={24} md={6}><label>编辑日期<Input readOnly value={metadata.updated ? formatDate(String(metadata.updated)) : '保存时自动生成'} /></label></Col>
          <Col xs={24} md={6}><label>分类<Select mode="tags" tokenSeparators={[',']} value={list(metadata.categories)} onChange={(value) => updateMetadata({ categories: value })} placeholder="输入后回车添加" /></label></Col>
          <Col xs={24} md={6}><label>标签<Select mode="tags" tokenSeparators={[',']} value={list(metadata.tags)} onChange={(value) => updateMetadata({ tags: value })} placeholder="输入后回车添加" /></label></Col>
        </Grid> }]}/>
      </div>
    </Card>
    <div className="editor-body"><Typography.Text strong>Markdown 正文</Typography.Text><MarkdownEditor value={parseFrontMatter(editor.content).body} onChange={(body) => setEditor((value) => value ? { ...value, content: writeBody(value.content, body) } : value)} /></div>
  </div> : <div className="boot"><Spin size="large" /></div>;

  return <Layout className="app">
    {isMobile && mobileOpen && <button className="mobile-menu-mask" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} />}
    <Sider theme="light" breakpoint="lg" collapsedWidth={isMobile ? 0 : 80} collapsed={isMobile ? !mobileOpen : collapsed} onBreakpoint={(broken) => { setIsMobile(broken); setMobileOpen(false); }} trigger={null} width={240} className="sider"><div className="logo"><span>{collapsed && !isMobile ? 'FB' : 'FlyBlog Admin'}</span>{isMobile && mobileOpen && <Button className="mobile-menu-close" type="text" aria-label="关闭菜单" icon={<CloseOutlined />} onClick={() => setMobileOpen(false)} />}</div><Menu theme="light" mode="inline" selectedKeys={[section === 'editor' ? 'posts' : section]} items={items} onClick={({ key }) => { setSection(key); if (isMobile) setMobileOpen(false); }} /></Sider>
    <Layout><Header className="header"><Button type="text" icon={(isMobile ? !mobileOpen : collapsed) ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => { if (isMobile) setMobileOpen((value) => !value); else setCollapsed((value) => !value); }} /><Typography.Title level={4}>{section === 'editor' ? (editor?.sha ? '编辑文章' : '新建文章') : title}</Typography.Title><Button className="header-logout" type="text" aria-label="退出登录" icon={<LogoutOutlined />} onClick={logout}>{isMobile ? '' : '退出登录'}</Button></Header><Content className="content"><div className="content-stack">{section === 'home' ? dashboard : section === 'posts' ? posts : section === 'editor' ? editorPage : section === 'graph' ? <GraphView onEdit={edit} /> : <SettingsGuide configuration={configuration} />}</div></Content></Layout>
    <Modal open={aiOpen} width={1080} title="AI 文章优化" onCancel={() => setAiOpen(false)} footer={<Space><Button onClick={() => setAiOpen(false)}>关闭</Button><Button disabled={!suggestion} onClick={() => { setEditor((value) => value ? { ...value, content: suggestion } : value); setAiOpen(false); message.success('已应用建议，请检查后再保存'); }}>应用到文章</Button><Button type="primary" loading={optimizing} onClick={optimize}>生成建议</Button></Space>}>
      <Alert showIcon type="info" message="先预览，再应用" description="参考 Obsidian AI 写作插件的 Apply Edit 工作流：模型只生成建议，不会直接保存或覆盖 GitHub 内容。" />
      <div className="ai-controls"><Select value={optimizeMode} onChange={setOptimizeMode} options={[{ value: 'generate', label: '生成标题和内容' }, { value: 'proofread', label: '校对错别字与语病' }, { value: 'rewrite', label: '改善结构与表达' }, { value: 'concise', label: '压缩冗余内容' }, { value: 'outline', label: '优化标题与大纲' }]} /><Input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={optimizeMode === 'generate' ? '补充主题、要点、语气等写作要求' : '可选：补充要求，例如“保持技术术语不变”'} /></div>
      {suggestion ? <div className="ai-preview"><div><Typography.Text strong>当前文章</Typography.Text><Input.TextArea readOnly value={editor?.content} /></div><div><Typography.Text strong>AI 建议</Typography.Text><Input.TextArea value={suggestion} onChange={(event) => setSuggestion(event.target.value)} /></div></div> : <Empty description={optimizing ? '正在生成建议…' : '选择优化方式后生成建议'} />}
    </Modal>
  </Layout>;
}

export default function Root() {
  const [configuration, setConfiguration] = useState<Configuration>(); const [authenticated, setAuthenticated] = useState<boolean>(); const [startupError, setStartupError] = useState('');
  useEffect(() => { (async () => {
    let current: Configuration;
    try { current = await api<Configuration>('/api/config'); if (typeof current.configured !== 'boolean' || !Array.isArray(current.missing)) throw new Error('API unavailable'); }
    catch { setStartupError('无法读取 API 服务状态，请确认当前部署包含 Node.js API Functions 后重试。'); setAuthenticated(false); return; }
    setConfiguration(current);
    if (!current.configured) { setAuthenticated(false); return; }
    try { await api('/api/auth/session'); setAuthenticated(true); } catch { setAuthenticated(false); }
  })(); }, []);
  if (startupError) return <AntApp><main className="setup-shell"><Alert showIcon type="error" message="API 服务暂时不可用" description={startupError} action={<Button onClick={() => window.location.reload()}>重新检测</Button>} /></main></AntApp>;
  if (!configuration || authenticated === undefined) return <div className="boot"><Spin size="large" /></div>;
  if (!configuration.configured) return <main className="setup-shell"><div className="setup-heading"><Typography.Title level={2}>FlyBlog Admin 设置</Typography.Title></div><SettingsGuide configuration={configuration} /></main>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <AntApp><Dashboard configuration={configuration} onLogout={() => setAuthenticated(false)} /></AntApp>;
}
