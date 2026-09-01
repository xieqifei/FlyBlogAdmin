import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configurationStatus } from './configuration.ts';

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
