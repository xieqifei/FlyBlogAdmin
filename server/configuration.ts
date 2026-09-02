export type Language = 'zh' | 'en' | 'de';
export type R2Status = { configured: boolean; publicUrl: string | null; defaultBucket: string | null };
export type ConfigurationStatus = { configured: boolean; status: Record<string, boolean>; missing: string[]; language: Language; r2: R2Status };

const required = ['SECRET_KEY', 'ADMIN_USERNAME', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY'] as const;
const optional = ['GITHUB_BRANCH', 'POSTS_PATH', 'POST_EXTENSIONS', 'SESSION_AGE', 'COOKIE_SECURE', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_BASE_URL', 'LLM_API_STYLE', 'LANGUAGE', 'S3_ACCOUNT_ID', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_ENDPOINT', 'S3_PUBLIC_URL'] as const;
const languages = ['zh', 'en', 'de'] as const;

export function resolveLanguage(environment: NodeJS.ProcessEnv = process.env): Language {
  const value = environment.LANGUAGE?.trim().toLowerCase();
  return (languages as readonly string[]).includes(value || '') ? value as Language : 'zh';
}

export function r2Status(environment: NodeJS.ProcessEnv = process.env): R2Status {
  const configured = Boolean(environment.S3_ACCOUNT_ID?.trim() && environment.S3_ACCESS_KEY_ID?.trim() && environment.S3_SECRET_ACCESS_KEY?.trim());
  return { configured, publicUrl: environment.S3_PUBLIC_URL?.trim() || null, defaultBucket: environment.S3_BUCKET?.trim() || null };
}

export function configurationStatus(environment: NodeJS.ProcessEnv = process.env): ConfigurationStatus {
  const passwordHash = environment.ADMIN_PASSWORD_HASH?.trim() || '';
  const status: Record<string, boolean> = {
    ...Object.fromEntries(required.map((name) => [name, Boolean(environment[name]?.trim())])),
    ADMIN_PASSWORD: Boolean(environment.ADMIN_PASSWORD?.trim()),
    ADMIN_PASSWORD_HASH: passwordHash.startsWith('pbkdf2_sha256$') || passwordHash.startsWith('sha256$'),
    ...Object.fromEntries(optional.map((name) => [name, Boolean(environment[name]?.trim())])),
  };
  const missing = required.filter((name) => !status[name]) as string[];
  if (!status.ADMIN_PASSWORD && !status.ADMIN_PASSWORD_HASH) missing.splice(2, 0, 'ADMIN_PASSWORD 或 ADMIN_PASSWORD_HASH');
  return { configured: missing.length === 0, status, missing, language: resolveLanguage(environment), r2: r2Status(environment) };
}
