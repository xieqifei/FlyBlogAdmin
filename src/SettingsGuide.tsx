import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, CopyOutlined, GithubOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons';
import { generatePasswordHash, generateSecretKey } from './configurationHelpers';
import { useI18n, type Language } from './i18n';

export type Configuration = {
  configured: boolean;
  status: Record<string, boolean>;
  missing: string[];
  language: Language;
  r2: { configured: boolean; publicUrl: string | null; defaultBucket: string | null };
};

const variables = [
  ['SECRET_KEY', 'required'], ['ADMIN_USERNAME', 'required'], ['ADMIN_PASSWORD_HASH', 'either'], ['ADMIN_PASSWORD', 'either'],
  ['GITHUB_TOKEN', 'required'], ['GITHUB_REPOSITORY', 'required'], ['GITHUB_BRANCH', 'optional'], ['POSTS_PATH', 'optional'],
  ['POST_EXTENSIONS', 'optional'], ['LINKS_PAGE_PATH', 'optional'], ['ABOUT_PAGE_PATH', 'optional'], ['SESSION_AGE', 'optional'], ['COOKIE_SECURE', 'optional'], ['LANGUAGE', 'optional'],
  ['LLM_API_KEY', 'aiOptional'], ['LLM_MODEL', 'aiOptional'], ['LLM_BASE_URL', 'aiOptional'], ['LLM_API_STYLE', 'aiOptional'],
  ['S3_ENDPOINT', 'r2Optional'], ['S3_ACCESS_KEY_ID', 'r2Optional'], ['S3_SECRET_ACCESS_KEY', 'r2Optional'],
  ['S3_BUCKET', 'r2Optional'], ['S3_PUBLIC_URL', 'r2Optional'],
];

export default function SettingsGuide({ configuration }: { configuration: Configuration }) {
  const t = useI18n();
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
    <Alert showIcon type={configuration.configured ? 'success' : 'warning'} message={t(configuration.configured ? 'sg.ready' : 'sg.missingWarning')} description={configuration.configured ? t('sg.readyDescription') : t('sg.missingDescription', { names: configuration.missing.join('、') })} />
    <Card title={t('sg.stepsTitle')}>
      <ol className="guide-steps"><li>{t('sg.step1')}</li><li>{t('sg.step2')}</li><li>{t('sg.step3')}</li><li>{t('sg.step4')}</li></ol>
    </Card>
    <Card title={t('sg.generatorTitle')}>
      <Alert showIcon type="info" message={t('sg.generatorInfo')} description={t('sg.generatorDescription')} />
      <div className="config-generators">
        <div className="config-generator">
          <Typography.Text strong><KeyOutlined /> SECRET_KEY</Typography.Text>
          <Typography.Text type="secondary">{t('sg.secretHint')}</Typography.Text>
          <Space.Compact block><Input readOnly value={secret} placeholder={t('sg.secretPlaceholder')} /><Button icon={<ReloadOutlined />} onClick={() => { setSecret(generateSecretKey()); setCopied(''); }}>{t(secret ? 'sg.regenerate' : 'sg.generate')}</Button><Button disabled={!secret} icon={<CopyOutlined />} onClick={() => copy('secret', secret)}>{t(copied === 'secret' ? 'sg.copied' : 'sg.copy')}</Button></Space.Compact>
        </div>
        <div className="config-generator">
          <Typography.Text strong><KeyOutlined /> ADMIN_PASSWORD_HASH</Typography.Text>
          <Typography.Text type="secondary">{t('sg.hashHint')}</Typography.Text>
          <Space.Compact block><Input.Password value={password} onChange={(event) => { setPassword(event.target.value); setPasswordHash(''); }} placeholder={t('sg.hashPlaceholder')} /><Button type="primary" disabled={!password} loading={hashing} onClick={hash}>{t('sg.hashButton')}</Button></Space.Compact>
          <Space.Compact block><Input readOnly value={passwordHash} placeholder={t('sg.hashResultPlaceholder')} /><Button disabled={!passwordHash} icon={<CopyOutlined />} onClick={() => copy('hash', passwordHash)}>{t(copied === 'hash' ? 'sg.copied' : 'sg.copy')}</Button></Space.Compact>
        </div>
      </div>
    </Card>
    <Card title={<Space><GithubOutlined />{t('sg.tokenTutorial')}</Space>}>
      <ol className="guide-steps">
        <li><Typography.Link href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">{t('sg.tokenStep1')}</Typography.Link></li>
        <li>{t('sg.tokenStep2')}</li><li>{t('sg.tokenStep3')}</li><li>{t('sg.tokenStep4')}</li><li>{t('sg.tokenStep5')}</li>
      </ol>
      <Alert showIcon type="warning" message={t('sg.orgWarning')} description={t('sg.orgWarningDesc')} />
      <Typography.Link href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noreferrer">{t('sg.tokenDocs')}</Typography.Link>
    </Card>
    <Card title={t('sg.envTitle')}>
      <Descriptions bordered size="small" column={1}>{variables.map(([name, requirement]) => {
        const known = Object.prototype.hasOwnProperty.call(configuration.status, name); const ready = configuration.status[name];
        return <Descriptions.Item key={name} label={<Space><Typography.Text code>{name}</Typography.Text><Tag>{t(`sg.${requirement}`)}</Tag>{known && (ready ? <CheckCircleOutlined className="configured" /> : <CloseCircleOutlined className="missing" />)}</Space>}>{t(`sg.var.${name}`)}</Descriptions.Item>;
      })}</Descriptions>
    </Card>
    <Typography.Paragraph type="secondary">{t('sg.footerNote')}</Typography.Paragraph>
  </div>;
}
