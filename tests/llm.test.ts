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

test('generates a title and body while preserving other front matter', async () => {
  configure(); let requestBody = '';
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => { requestBody = String(init?.body || ''); return Response.json({ choices: [{ message: { content: '[[TITLE]]\n生成的新标题\n[[CONTENT]]\n## 正文\n\n生成的内容' } }] }); };
  const source = '---\ntitle: 原标题\ntags:\n  - AI\n---\n\n写作素材';
  const result = await optimizeArticle({ content: source, mode: 'generate', instruction: '写一篇入门文章' }, fetcher as typeof fetch);
  assert.equal(result, '---\ntitle: 生成的新标题\ntags:\n  - AI\n---\n\n## 正文\n\n生成的内容');
  assert.match(requestBody, /生成合适的文章标题与完整 Markdown 正文/);
});

test('generation supports a new article with only front matter and a writing requirement', async () => {
  configure();
  const fetcher = async () => Response.json({ choices: [{ message: { content: '[[TITLE]]\n从零开始\n[[CONTENT]]\n正文' } }] });
  const result = await optimizeArticle({ content: '---\ntitle:\ntags:\n---\n\n', mode: 'generate', instruction: '介绍主题' }, fetcher as typeof fetch);
  assert.match(result, /title: 从零开始/);
  assert.match(result, /---\n\n正文$/);
});

test('generation supports completely empty editor content when a writing requirement is provided', async () => {
  configure();
  const fetcher = async () => Response.json({ choices: [{ message: { content: '[[TITLE]]\n空白起稿\n[[CONTENT]]\n正文' } }] });
  const result = await optimizeArticle({ content: '', mode: 'generate', instruction: '从零写一篇文章' }, fetcher as typeof fetch);
  assert.equal(result, '---\ntitle: 空白起稿\n---\n\n正文');
});

test('auto mode falls back to Responses API', async () => {
  configure('auto'); const calls: string[] = [];
  const fetcher = async (url: string | URL | Request) => { calls.push(String(url)); return calls.length === 1 ? Response.json({ error: { message: 'unsupported' } }, { status: 404 }) : Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '优化结果' }] }] }); };
  assert.equal(await optimizeArticle({ content: '原文', mode: 'concise' }, fetcher as typeof fetch), '优化结果');
  assert.deepEqual(calls, ['https://llm.example/v1/chat/completions', 'https://llm.example/v1/responses']);
});
