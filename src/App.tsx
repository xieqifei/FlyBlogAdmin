import { useState } from 'react';
import { Layout, Menu, Typography, Button, Card, Table, Empty, Tag } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined, FileTextOutlined, DatabaseOutlined, ApartmentOutlined, SettingOutlined, ReloadOutlined } from '@ant-design/icons';

const { Sider, Header, Content } = Layout;
const items = [
  { key: 'posts', icon: <FileTextOutlined />, label: '文章管理' },
  { key: 'knowledge', icon: <DatabaseOutlined />, label: '知识库' },
  { key: 'graph', icon: <ApartmentOutlined />, label: '关系图谱' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];
type Row = { name: string; path: string; sha?: string };

export default function App() {
  const [collapsed, setCollapsed] = useState(false); const [section, setSection] = useState('posts'); const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { const response = await fetch('/api/posts'); const data = await response.json(); setRows(data.posts || []); } finally { setLoading(false); } };
  const title = items.find((item) => item.key === section)?.label;
  return <Layout className="app"><Sider collapsible collapsed={collapsed} trigger={null} width={240} className="sider"><div className="logo">{collapsed ? 'FB' : 'FlyBlog Admin'}</div><Menu theme="dark" mode="inline" selectedKeys={[section]} items={items} onClick={({ key }) => setSection(key)} /></Sider><Layout><Header className="header"><Button type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed(!collapsed)} /><Typography.Title level={4}>{title}</Typography.Title><Tag color="blue">Node.js + TypeScript</Tag></Header><Content className="content">{section === 'posts' ? <Card title="文章" extra={<Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>}><Table rowKey="path" loading={loading} dataSource={rows} columns={[{ title: '文件名', dataIndex: 'name' }, { title: '路径', dataIndex: 'path' }, { title: '操作', render: () => <Button type="link">编辑</Button> }]} locale={{ emptyText: <Empty description="暂无文章，点击刷新从 GitHub 加载" /> }} /></Card> : <Card title={title}><Empty description={`${title}模块已就绪`} /></Card>}</Content></Layout></Layout>;
}
