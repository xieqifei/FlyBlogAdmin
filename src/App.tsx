import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Collapse, Empty, Form, Input, Layout, Menu, Modal, Popconfirm, Row as Grid, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { ApartmentOutlined, ArrowLeftOutlined, CloseOutlined, CloudOutlined, DeleteOutlined, EditOutlined, FileAddOutlined, FileTextOutlined, FolderOutlined, HomeOutlined, LinkOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PictureOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, SettingOutlined, TagsOutlined, UserOutlined } from '@ant-design/icons';
import GraphView from './GraphView';
import ContributionCalendar from './ContributionCalendar';
import ImageHosting from './ImageHosting';
import FriendLinks from './FriendLinks';
import AboutPage from './AboutPage';
import MarkdownEditor from './MarkdownEditor';
import SettingsGuide, { type Configuration } from './SettingsGuide';
import { I18nProvider, normalizeLanguage, useI18n, type Translator } from './i18n';
import { parseFrontMatter, values as frontMatterValues, writeBody, writeFrontMatter, type FrontMatterFields } from '../shared/frontMatter';
import { automaticArticleDates, currentDateTime } from '../shared/dateTime';

const { Sider, Header, Content } = Layout;
const menuItems = (t: Translator) => [
  { key: 'home', icon: <HomeOutlined />, label: t('menu.home') },
  { key: 'posts', icon: <FileTextOutlined />, label: t('menu.posts') },
  { key: 'links', icon: <LinkOutlined />, label: t('menu.links') },
  { key: 'about', icon: <UserOutlined />, label: t('menu.about') },
  { key: 'graph', icon: <ApartmentOutlined />, label: t('menu.graph') },
  { key: 'images', icon: <PictureOutlined />, label: t('menu.images') },
  { key: 'settings', icon: <SettingOutlined />, label: t('menu.settings') },
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

function formatDate(value?: string) {
  if (!value) return '—'; const matched = value.match(/^\d{4}-\d{2}-\d{2}/); if (matched) return matched[0];
  const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0'); return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}
function time(value?: string) { if (!value) return 0; const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T')); return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime(); }
const DRAFT_PREFIX = 'flyblog:draft:';
function draftKey(path?: string) { return `${DRAFT_PREFIX}${path || 'new'}`; }
function readDraft(path: string, remote: Post) {
  try { const saved = JSON.parse(localStorage.getItem(draftKey(path)) || '') as { post?: Post }; return saved.post?.content ? { ...remote, ...saved.post, path: remote.path, name: remote.name, sha: remote.sha } : remote; } catch { return remote; }
}

function Login({ onLogin }: { onLogin: () => void }) {
  const t = useI18n();
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const submit = async (values: { username: string; password: string }) => {
    setLoading(true); setError(''); try { await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); onLogin(); } catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败'); } finally { setLoading(false); }
  };
  return <main className="auth-page"><Card className="auth-card"><div className="auth-brand">FlyBlog Admin</div><Typography.Title level={3}>{t('login.title')}</Typography.Title>{error && <Alert showIcon type="error" message={error} />}<Form layout="vertical" onFinish={submit}><Form.Item label={t('login.username')} name="username" rules={[{ required: true }]}><Input autoComplete="username" autoFocus /></Form.Item><Form.Item label={t('login.password')} name="password" rules={[{ required: true }]}><Input.Password autoComplete="current-password" /></Form.Item><Button type="primary" htmlType="submit" block loading={loading}>{t('login.submit')}</Button></Form></Card></main>;
}

function Dashboard({ configuration, onLogout }: { configuration: Configuration; onLogout: () => void }) {
  const t = useI18n(); const items = useMemo(() => menuItems(t), [t]);
  const { message } = AntApp.useApp(); const [collapsed, setCollapsed] = useState(false); const [isMobile, setIsMobile] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [section, setSection] = useState('home');
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(false); const [loadError, setLoadError] = useState(''); const [editor, setEditor] = useState<Post>(); const [saving, setSaving] = useState(false); const [query, setQuery] = useState(''); const [draftSavedAt, setDraftSavedAt] = useState('');
  const [optimizeMode, setOptimizeMode] = useState<OptimizeMode>('generate'); const [instruction, setInstruction] = useState(''); const [suggestion, setSuggestion] = useState(''); const [optimizing, setOptimizing] = useState(false); const [aiOpen, setAiOpen] = useState(false);
  const load = useCallback(async () => { setLoading(true); setLoadError(''); try { const data = await api<{ posts: Row[] }>('/api/posts'); setRows(data.posts); } catch (reason) { setRows([]); setLoadError(reason instanceof Error ? reason.message : t('error.loadPosts')); } finally { setLoading(false); } }, [t]);
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
  const create = () => { const blank: Post = { name: '', path: '', content: '---\ntitle:\ndate:\nupdated:\ncategories:\ntags:\n---\n\n' }; const restored = readDraft('', blank); setEditor(restored); setDraftSavedAt(restored.content === blank.content ? '' : '已恢复'); setSection('editor'); };
  const updateMetadata = (updates: FrontMatterFields) => setEditor((value) => value ? { ...value, content: writeFrontMatter(value.content, updates) } : value);
  const metadata = useMemo(() => editor ? parseFrontMatter(editor.content).fields : {}, [editor?.content]);
  const save = async () => {
    if (!editor) return; const articleTitle = String(metadata.title || '').trim(); const path = editor.path.trim() || slugify(articleTitle);
    if (!articleTitle) return message.warning(t('editor.titleRequired')); setSaving(true);
    const clientTime = currentDateTime(); const content = writeFrontMatter(editor.content, automaticArticleDates(metadata.date, clientTime, Boolean(editor.sha)));
    try {
      const result = await api<{ path: string; sha: string }>('/api/posts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editor, content, path, name: path.split('/').pop(), clientTime }) });
      const savedFields = parseFrontMatter(content).fields;
      const saved: Row = { name: path.split('/').pop() || path, path: result.path || path, sha: result.sha, title: String(savedFields.title || articleTitle), categories: list(savedFields.categories || savedFields.category), tags: list(savedFields.tags || savedFields.tag), date: String(savedFields.date || ''), updated: String(savedFields.updated || '') };
      localStorage.removeItem(draftKey(editor.path)); localStorage.removeItem(draftKey(path)); message.success(t('editor.saved')); setEditor(undefined); setDraftSavedAt(''); setSection('posts'); await load();
      setRows((current) => [saved, ...current.filter((row) => row.path !== saved.path)]);
    } catch (reason) { setEditor((value) => value ? { ...value, content } : value); message.error(reason instanceof Error ? reason.message : t('error.save')); } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!editor?.sha) return; setSaving(true); try { await api('/api/posts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editor) }); localStorage.removeItem(draftKey(editor.path)); message.success(t('editor.deleted')); setEditor(undefined); setSection('posts'); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : t('error.delete')); } finally { setSaving(false); }
  };
  const removeRow = async (row: Row) => {
    if (!row.sha) return; setSaving(true); try { await api('/api/posts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) }); localStorage.removeItem(draftKey(row.path)); message.success(t('editor.deleted')); await load(); } catch (reason) { message.error(reason instanceof Error ? reason.message : t('error.delete')); } finally { setSaving(false); }
  };
  const optimize = async () => {
    if (!editor) return; const body = parseFrontMatter(editor.content).body.trim();
    if (!body && (optimizeMode !== 'generate' || !instruction.trim())) return message.warning(t(optimizeMode === 'generate' ? 'ai.requirementRequired' : 'ai.bodyRequired'));
    setOptimizing(true); setSuggestion('');
    try { const data = await api<{ suggestion: string }>('/api/ai/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editor.content, mode: optimizeMode, instruction }) }); setSuggestion(data.suggestion); } catch (reason) { message.error(reason instanceof Error ? reason.message : t('error.aiOptimize')); } finally { setOptimizing(false); }
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
    <div className="welcome"><div><Typography.Title level={2}>{t('home.title')}</Typography.Title><Typography.Text type="secondary">{t('home.subtitle')}</Typography.Text></div><Button size="large" type="primary" icon={<FileAddOutlined />} onClick={create}>{t('home.newPost')}</Button></div>
    <Grid gutter={[16, 16]}><Col xs={24} sm={12} xl={6}><Card><Statistic title={t('home.articleCount')} value={rows.length} prefix={<FileTextOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title={t('home.categories')} value={categories.length} prefix={<FolderOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title={t('home.tags')} value={tags.length} prefix={<TagsOutlined />} /></Card></Col><Col xs={24} sm={12} xl={6}><Card><Statistic title={t('home.dated')} value={rows.filter((row) => row.updated || row.date).length} prefix={<EditOutlined />} /></Card></Col></Grid>
    <Grid gutter={[16, 16]}><Col xs={24} lg={12}><Card title={t('home.categoryDistribution')}>{categories.length ? <Space wrap>{categories.map((category) => <Tag color="blue" key={category}>{category} · {rows.filter((row) => row.categories?.includes(category)).length}</Tag>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('home.emptyCategories')} />}</Card></Col><Col xs={24} lg={12}><Card title={t('home.commonTags')}>{tags.length ? <Space wrap>{tags.sort((a, b) => rows.filter((row) => row.tags?.includes(b)).length - rows.filter((row) => row.tags?.includes(a)).length).slice(0, 20).map((tag) => <Tag color="green" key={tag}>{tag} · {rows.filter((row) => row.tags?.includes(tag)).length}</Tag>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('home.emptyTags')} />}</Card></Col></Grid>
    <ContributionCalendar dates={rows.map((row) => row.date)} />
    <Card title={t('home.recentPosts')} extra={<Button type="link" onClick={() => setSection('posts')}>{t('home.viewAll')}</Button>}><Table<Row> size="small" tableLayout="fixed" pagination={false} rowKey="path" dataSource={recentRows.slice(0, 5)} columns={[{ title: t('home.titleCol'), render: (_, row) => <span className="post-title">{row.title || row.name}</span> }, { title: t('home.editDateCol'), responsive: ['sm'], render: (_, row) => formatDate(row.updated || row.date) }, { title: '', width: 64, render: (_, row) => <Button type="link" onClick={() => edit(row.path)}>{t('home.edit')}</Button> }]} /></Card>
  </div>;

  const posts = <Card className="posts-card" title={t('posts.title')} extra={<Space><Button icon={<FileAddOutlined />} type="primary" onClick={create}>{t('posts.new')}</Button><Button icon={<ReloadOutlined />} onClick={load}>{t('posts.refresh')}</Button></Space>}>
    <Input className="post-search" allowClear prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('posts.search')} />
    {loadError && <Alert className="table-alert" showIcon type="error" message={loadError} action={<Button size="small" onClick={load}>{t('posts.retry')}</Button>} />}
    <Table<Row> rowKey="path" tableLayout="fixed" loading={loading} dataSource={filteredRows} pagination={{ position: ['bottomCenter'] }} showSorterTooltip={{ target: 'sorter-icon' }} columns={[
      { title: t('posts.titleCol'), key: 'title', sorter: (left, right) => (left.title || left.name).localeCompare(right.title || right.name), render: (_, row) => <span className="post-title">{row.title || row.name}</span> },
      { title: t('posts.categoriesCol'), key: 'categories', width: '18%', responsive: ['sm'], sorter: (left, right) => (left.categories || []).join('/').localeCompare((right.categories || []).join('/')), render: (_, row) => <Space wrap>{row.categories?.map((value) => <Tag color="blue" key={value}>{value}</Tag>)}</Space> },
      { title: t('posts.tagsCol'), key: 'tags', width: '20%', responsive: ['md'], sorter: (left, right) => (left.tags || []).join('/').localeCompare((right.tags || []).join('/')), render: (_, row) => <Space wrap>{row.tags?.map((value) => <Tag color="green" key={value}>{value}</Tag>)}</Space> },
      { title: t('posts.editDateCol'), key: 'updated', width: 120, responsive: ['sm'], defaultSortOrder: 'descend', sorter: (left, right) => time(left.updated || left.date) - time(right.updated || right.date), render: (_, row) => formatDate(row.updated || row.date) },
      { title: t('posts.actionsCol'), key: 'actions', width: 88, render: (_, row) => <Space size={4}><Button type="text" aria-label={t('posts.editAria', { title: row.title || row.name })} title={t('posts.edit')} icon={<EditOutlined />} onClick={() => edit(row.path)} /><Popconfirm title={t('confirm.deleteTitle')} description={t('confirm.deleteDescription')} onConfirm={() => removeRow(row)}><Button type="text" danger aria-label={t('posts.deleteAria', { title: row.title || row.name })} title={t('posts.delete')} icon={<DeleteOutlined />} /></Popconfirm></Space> },
    ]} locale={{ emptyText: <Empty description={t(loading ? 'posts.loading' : query ? 'posts.noMatch' : 'posts.empty')} /> }} />
  </Card>;

  const editorPage = editor ? <div className="article-editor-page">
    <div className="editor-page-heading">
      <Space><Button icon={<ArrowLeftOutlined />} onClick={() => setSection('posts')}>{t('editor.back')}</Button><div><Typography.Title level={3}>{t(editor.sha ? 'editor.editTitle' : 'editor.newTitle')}</Typography.Title><Typography.Text type="secondary"><CloudOutlined /> {draftSavedAt ? t('draft.savedAt', { time: draftSavedAt }) : t('draft.localOnly')}</Typography.Text></div></Space>
      <Space wrap>{editor.sha && <Popconfirm title={t('confirm.deleteTitle')} description={t('confirm.deleteDescription')} onConfirm={remove}><Button danger icon={<DeleteOutlined />}>{t('editor.delete')}</Button></Popconfirm>}<Button icon={<RobotOutlined />} onClick={() => { setSuggestion(''); setAiOpen(true); }}>{t('editor.ai')}</Button><Button type="primary" loading={saving} onClick={save}>{t('editor.save')}</Button></Space>
    </div>
    <Card className="editor-metadata-card">
      <div className="editor-form">
        <label>{t('editor.titleLabel')}<Input value={String(metadata.title || '')} placeholder={t('editor.titlePlaceholder')} onChange={(event) => updateMetadata({ title: event.target.value })} /></label>
        <Collapse ghost items={[{ key: 'metadata', label: t('editor.categoriesTags'), children: <Grid gutter={[16, 12]}>
          <Col xs={24} md={12}><label>{t('editor.categories')}<Select mode="tags" tokenSeparators={[',']} value={list(metadata.categories)} onChange={(value) => updateMetadata({ categories: value })} placeholder={t('editor.enterToAdd')} /></label></Col>
          <Col xs={24} md={12}><label>{t('editor.tags')}<Select mode="tags" tokenSeparators={[',']} value={list(metadata.tags)} onChange={(value) => updateMetadata({ tags: value })} placeholder={t('editor.enterToAdd')} /></label></Col>
        </Grid> }]}/>
      </div>
    </Card>
    <div className="editor-body"><Typography.Text strong>{t('editor.body')}</Typography.Text><MarkdownEditor value={parseFrontMatter(editor.content).body} onChange={(body) => setEditor((value) => value ? { ...value, content: writeBody(value.content, body) } : value)} r2Configured={Boolean(configuration.r2?.configured)} defaultBucket={configuration.r2?.defaultBucket || ''} r2PublicUrl={configuration.r2?.publicUrl || ''} /></div>
  </div> : <div className="boot"><Spin size="large" /></div>;

  return <Layout className="app">
    {isMobile && mobileOpen && <button className="mobile-menu-mask" aria-label={t('header.closeMenu')} onClick={() => setMobileOpen(false)} />}
    <Sider theme="light" breakpoint="lg" collapsedWidth={isMobile ? 0 : 80} collapsed={isMobile ? !mobileOpen : collapsed} onBreakpoint={(broken) => { setIsMobile(broken); setMobileOpen(false); }} trigger={null} width={240} className="sider"><div className="logo"><span>{collapsed && !isMobile ? 'FB' : 'FlyBlog Admin'}</span>{isMobile && mobileOpen && <Button className="mobile-menu-close" type="text" aria-label={t('header.closeMenu')} icon={<CloseOutlined />} onClick={() => setMobileOpen(false)} />}</div><Menu theme="light" mode="inline" selectedKeys={[section === 'editor' ? 'posts' : section]} items={items} onClick={({ key }) => { setSection(key); if (isMobile) setMobileOpen(false); }} /></Sider>
    <Layout><Header className="header"><Button type="text" icon={(isMobile ? !mobileOpen : collapsed) ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => { if (isMobile) setMobileOpen((value) => !value); else setCollapsed((value) => !value); }} /><Typography.Title level={4}>{section === 'editor' ? t(editor?.sha ? 'editor.editTitle' : 'editor.newTitle') : title}</Typography.Title><Button className="header-logout" type="text" aria-label={t('header.logout')} icon={<LogoutOutlined />} onClick={logout}>{isMobile ? '' : t('header.logout')}</Button></Header><Content className="content"><div className="content-stack">{section === 'home' ? dashboard : section === 'posts' ? posts : section === 'editor' ? editorPage : section === 'links' ? <FriendLinks /> : section === 'about' ? <AboutPage configuration={configuration} /> : section === 'graph' ? <GraphView onEdit={edit} /> : section === 'images' ? <ImageHosting configuration={configuration} /> : <SettingsGuide configuration={configuration} />}</div></Content></Layout>
    <Modal open={aiOpen} width={1080} title={t('ai.title')} onCancel={() => setAiOpen(false)} footer={<Space><Button onClick={() => setAiOpen(false)}>{t('ai.close')}</Button><Button disabled={!suggestion} onClick={() => { setEditor((value) => value ? { ...value, content: suggestion } : value); setAiOpen(false); message.success(t('ai.applied')); }}>{t('ai.apply')}</Button><Button type="primary" loading={optimizing} onClick={optimize}>{t('ai.generate')}</Button></Space>}>
      <Alert showIcon type="info" message={t('ai.previewFirst')} description={t('ai.previewDescription')} />
      <div className="ai-controls"><Select value={optimizeMode} onChange={setOptimizeMode} options={[{ value: 'generate', label: t('ai.modeGenerate') }, { value: 'proofread', label: t('ai.modeProofread') }, { value: 'rewrite', label: t('ai.modeRewrite') }, { value: 'concise', label: t('ai.modeConcise') }, { value: 'outline', label: t('ai.modeOutline') }]} /><Input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={t(optimizeMode === 'generate' ? 'ai.instructionGenerate' : 'ai.instruction')} /></div>
      {suggestion ? <div className="ai-preview"><div><Typography.Text strong>{t('ai.current')}</Typography.Text><Input.TextArea readOnly value={editor?.content} /></div><div><Typography.Text strong>{t('ai.suggestion')}</Typography.Text><Input.TextArea value={suggestion} onChange={(event) => setSuggestion(event.target.value)} /></div></div> : <Empty description={t(optimizing ? 'ai.generating' : 'ai.selectMode')} />}
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
    try { const session = await api<{ authenticated: boolean }>('/api/auth/session'); setAuthenticated(session.authenticated === true); } catch { setAuthenticated(false); }
  })(); }, []);
  const wrap = (content: ReactNode) => <I18nProvider language={normalizeLanguage(configuration?.language)}><AntApp>{content}</AntApp></I18nProvider>;
  if (startupError) return wrap(<main className="setup-shell"><Alert showIcon type="error" message="API 服务暂时不可用" description={startupError} action={<Button onClick={() => window.location.reload()}>重新检测</Button>} /></main>);
  if (!configuration || authenticated === undefined) return wrap(<div className="boot"><Spin size="large" /></div>);
  if (!configuration.configured) return wrap(<main className="setup-shell"><div className="setup-heading"><Typography.Title level={2}>FlyBlog Admin</Typography.Title></div><SettingsGuide configuration={configuration} /></main>);
  if (!authenticated) return wrap(<Login onLogin={() => setAuthenticated(true)} />);
  return wrap(<Dashboard configuration={configuration} onLogout={() => setAuthenticated(false)} />);
}
