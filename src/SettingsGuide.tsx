import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, CopyOutlined, GithubOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons';
import { generatePasswordHash, generateSecretKey } from './configurationHelpers';

export type Configuration = { configured: boolean; status: Record<string, boolean>; missing: string[] };

const variables = [
  ['SECRET_KEY', '必需', '用于签名登录 Cookie 的长期随机密钥，可使用下方工具安全生成。'],
  ['ADMIN_USERNAME', '必需', '后台登录用户名。'],
  ['ADMIN_PASSWORD_HASH', '二选一', '推荐使用下方工具由登录密码生成 PBKDF2-SHA256 哈希。'],
  ['ADMIN_PASSWORD', '二选一', '无法生成哈希时可使用登录明文密码；请仅保存在 Vercel 加密环境变量中。'],
  ['GITHUB_TOKEN', '必需', '仅授予目标博客仓库 Contents 读写权限的细粒度 GitHub Token，获取步骤见下方教程。'],
  ['GITHUB_REPOSITORY', '必需', '目标仓库，格式 owner/repository。'],
  ['GITHUB_BRANCH', '可选', '文章写入分支，默认 main。'],
  ['POSTS_PATH', '可选', '文章目录，默认 source/_posts。'],
  ['POST_EXTENSIONS', '可选', '可编辑扩展名，默认 .md,.markdown。'],
  ['SESSION_AGE', '可选', '登录有效秒数，默认 604800（7 天）。'],
  ['COOKIE_SECURE', '可选', 'Vercel 自动启用安全 Cookie；其他 HTTPS 环境可设为 1。'],
  ['LLM_API_KEY', 'AI 可选', '大模型服务的 API Key；仅由服务端读取。'],
  ['LLM_MODEL', 'AI 可选', '用于文章优化的模型名称。'],
  ['LLM_BASE_URL', 'AI 可选', 'OpenAI 兼容接口地址，默认 https://api.openai.com/v1。'],
  ['LLM_API_STYLE', 'AI 可选', 'auto、chat 或 responses；默认 auto，会在接口不兼容时自动回退。'],
];

export default function SettingsGuide({ configuration }: { configuration: Configuration }) {
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [passwordHash, setPasswordHash] = useState('');
  const [hashing, setHashing] = useState(false);
  const [copied, setCopied] = useState('');

  const copy = async (name: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(name);
    window.setTimeout(() => setCopied((current) => current === name ? '' : current), 1800);
  };

  const hash = async () => {
    if (!password) return;
    setHashing(true);
    try { setPasswordHash(await generatePasswordHash(password)); } finally { setHashing(false); }
  };

  return <div className="settings-page">
    <Alert showIcon type={configuration.configured ? 'success' : 'warning'} message={configuration.configured ? '必需配置已齐全' : '请先补齐环境变量并重新部署'} description={configuration.configured ? '此页面只显示配置状态，不会读取或显示 Token、密码和密钥。' : `尚缺少：${configuration.missing.join('、')}`} />
    <Card title="Vercel 配置步骤">
      <ol className="guide-steps"><li>打开 Vercel 项目，进入 Settings → Environment Variables。</li><li>按下表添加变量，并选择 Production / Preview 环境。</li><li>保存后重新部署；变量变更不会自动应用到旧部署。</li><li>完成后回到此页检查状态，再使用左下角的退出与登录功能验证账号。</li></ol>
    </Card>
    <Card title="密钥与密码哈希生成器">
      <Alert showIcon type="info" message="所有计算只在当前浏览器中完成" description="生成结果不会发送给 FlyBlog Admin。复制到 Vercel 后请关闭页面，不要将结果提交到代码仓库。" />
      <div className="config-generators">
        <div className="config-generator">
          <Typography.Text strong><KeyOutlined /> SECRET_KEY</Typography.Text>
          <Typography.Text type="secondary">生成 256 位随机登录签名密钥。</Typography.Text>
          <Space.Compact block><Input readOnly value={secret} placeholder="点击右侧按钮生成" /><Button icon={<ReloadOutlined />} onClick={() => { setSecret(generateSecretKey()); setCopied(''); }}>{secret ? '重新生成' : '生成'}</Button><Button disabled={!secret} icon={<CopyOutlined />} onClick={() => copy('secret', secret)}>{copied === 'secret' ? '已复制' : '复制'}</Button></Space.Compact>
        </div>
        <div className="config-generator">
          <Typography.Text strong><KeyOutlined /> ADMIN_PASSWORD_HASH</Typography.Text>
          <Typography.Text type="secondary">输入后台登录密码，生成带随机盐的 PBKDF2-SHA256 哈希；原密码不会保存。</Typography.Text>
          <Space.Compact block><Input.Password value={password} onChange={(event) => { setPassword(event.target.value); setPasswordHash(''); }} placeholder="输入要使用的登录密码" /><Button type="primary" disabled={!password} loading={hashing} onClick={hash}>生成哈希</Button></Space.Compact>
          <Space.Compact block><Input readOnly value={passwordHash} placeholder="生成后的哈希会显示在这里" /><Button disabled={!passwordHash} icon={<CopyOutlined />} onClick={() => copy('hash', passwordHash)}>{copied === 'hash' ? '已复制' : '复制'}</Button></Space.Compact>
        </div>
      </div>
    </Card>
    <Card title={<Space><GithubOutlined />GITHUB_TOKEN 获取教程</Space>}>
      <ol className="guide-steps">
        <li>登录 GitHub，打开 <Typography.Link href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">新建 Fine-grained personal access token</Typography.Link>。</li>
        <li>填写名称和有效期；Repository access 选择“Only select repositories”，然后只勾选博客仓库。</li>
        <li>在 Repository permissions 中，将 Contents 设置为“Read and write”；Metadata 保持默认的只读权限即可。</li>
        <li>点击 Generate token，立即复制生成的值并填入 Vercel 的 <Typography.Text code>GITHUB_TOKEN</Typography.Text>。GitHub 通常只展示一次完整 Token。</li>
        <li>将仓库的 <Typography.Text code>owner/repository</Typography.Text> 填入 <Typography.Text code>GITHUB_REPOSITORY</Typography.Text>，保存变量后重新部署。</li>
      </ol>
      <Alert showIcon type="warning" message="组织仓库可能需要管理员批准或 SSO 授权" description="如果文章仍无法读取，请在 GitHub Token 设置页检查资源所有者、仓库范围和组织授权状态。" />
      <Typography.Link href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noreferrer">查看 GitHub 官方 Token 文档</Typography.Link>
    </Card>
    <Card title="环境变量">
      <Descriptions bordered size="small" column={1}>{variables.map(([name, requirement, description]) => {
        const known = Object.prototype.hasOwnProperty.call(configuration.status, name); const ready = configuration.status[name];
        return <Descriptions.Item key={name} label={<Space><Typography.Text code>{name}</Typography.Text><Tag>{requirement}</Tag>{known && (ready ? <CheckCircleOutlined className="configured" /> : <CloseCircleOutlined className="missing" />)}</Space>}>{description}</Descriptions.Item>;
      })}</Descriptions>
    </Card>
    <Typography.Paragraph type="secondary">所有敏感值只应保存在部署平台的 Secret / 加密环境变量中，不要提交到 Git 仓库，也不要添加会暴露给浏览器的前缀。</Typography.Paragraph>
  </div>;
}
