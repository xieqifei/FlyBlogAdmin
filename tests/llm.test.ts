import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { OptimizeError, optimizeArticle, validateOptimizeInput } from '../server/llm.ts';

const originalEnvironment = { ...process.env };
afterEach(() => { process.env = { ...originalEnvironment }; });
function configure(style = 'chat') { process.env.LLM_API_KEY = 'test-key'; process.env.LLM_MODEL = 'test-model'; process.env.LLM_BASE_URL = 'https://llm.example/v1/'; process.env.LLM_API_STYLE = style; }

test('validates empty and oversized input', () => {
  assert.throws(() => validateOptimizeInput({ content: '' }), (error) => error instanceof OptimizeError && error.status === 400);
  assert.throws(() => validateOptimizeInput({ content: '正文', instruction: 'a'.repeat(1001) }), /不能超过 1000/);
});

test('uses Chat Completions and preserves front matter exactly', async () => {
  configure(); let requestBody = '';
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => { assert.equal(String(url), 'https://llm.example/v1/chat/completions'); requestBody = String(init?.body || ''); return Response.json({ choices: [{ message: { content: '# 优化后正文' } }] }); };
  const prefix = '---\ntitle: 原标题\ntags:\n  - AI\n---\n\n'; const result = await optimizeArticle({ content: `${prefix}# 原正文`, mode: 'proofread' }, fetcher as typeof fetch);
  assert.equal(result, `${prefix}# 优化后正文`); assert.match(requestBody, /校对错别字/); assert.doesNotMatch(requestBody, /title: 原标题/);
});

test('auto mode falls back to Responses API', async () => {
  configure('auto'); const calls: string[] = [];
  const fetcher = async (url: string | URL | Request) => { calls.push(String(url)); return calls.length === 1 ? Response.json({ error: { message: 'unsupported' } }, { status: 404 }) : Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '优化结果' }] }] }); };
  assert.equal(await optimizeArticle({ content: '原文', mode: 'concise' }, fetcher as typeof fetch), '优化结果');
  assert.deepEqual(calls, ['https://llm.example/v1/chat/completions', 'https://llm.example/v1/responses']);
});
