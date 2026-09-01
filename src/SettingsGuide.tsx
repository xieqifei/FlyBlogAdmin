import { Alert, Card, Descriptions, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

export type Configuration = { configured: boolean; status: Record<string, boolean>; missing: string[] };

const variables = [
  ['SECRET_KEY', '必需', '用于签名登录 Cookie 的长期随机密钥。可在浏览器控制台运行 crypto.randomUUID() 生成。'],
  ['ADMIN_USERNAME', '必需', '后台登录用户名。'],
  ['ADMIN_PASSWORD_HASH', '二选一', '推荐使用 Django pbkdf2_sha256 或 sha256$<hex> 格式的密码哈希。'],
  ['ADMIN_PASSWORD', '二选一', '无法生成哈希时可使用登录明文密码；请仅保存在 Vercel 加密环境变量中。'],
  ['GITHUB_TOKEN', '必需', '仅授予目标博客仓库 Contents 读写权限的 GitHub Token。'],
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
  return <div className="settings-page">
    <Alert showIcon type={configuration.configured ? 'success' : 'warning'} message={configuration.configured ? '必需配置已齐全' : '请先补齐环境变量并重新部署'} description={configuration.configured ? '此页面只显示配置状态，不会读取或显示 Token、密码和密钥。' : `尚缺少：${configuration.missing.join('、')}`} />
    <Card title="Vercel 配置步骤">
      <ol className="guide-steps"><li>打开 Vercel 项目，进入 Settings → Environment Variables。</li><li>按下表添加变量，并选择 Production / Preview 环境。</li><li>保存后重新部署；变量变更不会自动应用到旧部署。</li><li>完成后回到此页检查状态，再使用左下角的退出与登录功能验证账号。</li></ol>
    </Card>
    <Card title="环境变量">
      <Descriptions bordered size="small" column={1}>{variables.map(([name, requirement, description]) => {
        const statusKey = name === 'ADMIN_PASSWORD_HASH' ? 'ADMIN_PASSWORD' : name; const known = Object.prototype.hasOwnProperty.call(configuration.status, statusKey); const ready = configuration.status[statusKey];
        return <Descriptions.Item key={name} label={<Space><Typography.Text code>{name}</Typography.Text><Tag>{requirement}</Tag>{known && (ready ? <CheckCircleOutlined className="configured" /> : <CloseCircleOutlined className="missing" />)}</Space>}>{description}</Descriptions.Item>;
      })}</Descriptions>
    </Card>
    <Typography.Paragraph type="secondary">所有敏感值只应保存在部署平台的 Secret / 加密环境变量中，不要提交到 Git 仓库，也不要添加会暴露给浏览器的前缀。</Typography.Paragraph>
  </div>;
}
