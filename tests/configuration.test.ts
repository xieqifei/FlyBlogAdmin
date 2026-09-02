import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configurationStatus, resolveLanguage, r2Status } from '../server/configuration.ts';

const required = { SECRET_KEY: 'secret', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'password', GITHUB_TOKEN: 'token', GITHUB_REPOSITORY: 'owner/repo' };

test('only required variables decide whether setup is complete', () => {
  const result = configurationStatus(required);
  assert.equal(result.configured, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.status.GITHUB_BRANCH, false);
  assert.equal(result.status.LLM_API_KEY, false);
});

test('password hash can replace the plain-text password', () => {
  const { ADMIN_PASSWORD: _password, ...withoutPassword } = required;
  assert.equal(configurationStatus({ ...withoutPassword, ADMIN_PASSWORD_HASH: 'sha256$hash' }).configured, true);
});

test('reports every missing required value without treating optional values as required', () => {
  const result = configurationStatus({ GITHUB_BRANCH: 'main', LLM_MODEL: 'model' });
  assert.equal(result.configured, false);
  assert.deepEqual(result.missing, ['SECRET_KEY', 'ADMIN_USERNAME', 'ADMIN_PASSWORD 或 ADMIN_PASSWORD_HASH', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY']);
  assert.equal(result.status.GITHUB_BRANCH, true);
  assert.equal(result.status.LLM_MODEL, true);
});

test('defaults to Chinese and accepts the built-in language values', () => {
  assert.equal(resolveLanguage({}), 'zh');
  assert.equal(resolveLanguage({ LANGUAGE: 'EN' }), 'en');
  assert.equal(resolveLanguage({ LANGUAGE: 'de' }), 'de');
  assert.equal(resolveLanguage({ LANGUAGE: 'fr' }), 'zh');
});

test('reports optional S3-prefixed image-hosting configuration without exposing secrets', () => {
  assert.deepEqual(r2Status({ S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret', S3_BUCKET: 'images', S3_PUBLIC_URL: 'https://img.example.com/' }), {
    configured: true, publicUrl: 'https://img.example.com/', defaultBucket: 'images',
  });
  assert.equal(r2Status({ S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com' }).configured, false);
  assert.equal('S3_ACCOUNT_ID' in configurationStatus(required).status, false);
});
