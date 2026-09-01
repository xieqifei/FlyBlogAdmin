import { writeFrontMatter } from '../shared/frontMatter.ts';

export type OptimizeMode = 'generate' | 'rewrite' | 'proofread' | 'concise' | 'outline';
export type OptimizeInput = { content?: unknown; mode?: unknown; instruction?: unknown };
type LLMConfig = { apiKey: string; model: string; baseUrl: string; apiStyle: 'auto' | 'chat' | 'responses' };

export class OptimizeError extends Error {
  readonly status: number; readonly upstreamStatus?: number;
  constructor(message: string, status: number, upstreamStatus?: number) { super(message); this.status = status; this.upstreamStatus = upstreamStatus; }
}

const instructions: Record<OptimizeMode, string> = {
  generate: '根据已有素材和补充要求生成合适的文章标题与完整 Markdown 正文；信息不足时不要虚构具体事实。',
  rewrite: '改善段落结构、逻辑衔接和表达清晰度，保留作者观点。', proofread: '校对错别字、标点和语病，尽量少改动原意与文风。',
  concise: '删除重复与冗余表达，让文章更精炼，同时保留重要信息。', outline: '优化标题、各级标题和文章结构，不虚构新的事实。',
};

function configuration(): LLMConfig {
  const apiKey = process.env.LLM_API_KEY?.trim() || ''; const model = process.env.LLM_MODEL?.trim() || '';
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiStyle = (process.env.LLM_API_STYLE?.trim().toLowerCase() || 'auto') as LLMConfig['apiStyle'];
  if (!apiKey || !model) throw new OptimizeError('请先配置 LLM_API_KEY 和 LLM_MODEL', 503);
  if (!/^https?:\/\//i.test(baseUrl)) throw new OptimizeError('LLM_BASE_URL 必须是 HTTP(S) 地址', 503);
  if (!['auto', 'chat', 'responses'].includes(apiStyle)) throw new OptimizeError('LLM_API_STYLE 必须是 auto、chat 或 responses', 503);
  return { apiKey, model, baseUrl, apiStyle };
}

export function validateOptimizeInput(input: OptimizeInput) {
  const content = typeof input.content === 'string' ? input.content : ''; const mode = typeof input.mode === 'string' && input.mode in instructions ? input.mode as OptimizeMode : 'proofread';
  const custom = typeof input.instruction === 'string' ? input.instruction.trim() : '';
  if (!content.trim()) throw new OptimizeError('请输入需要 AI 处理的正文', 400);
  if (content.length > 100_000) throw new OptimizeError('单次 AI 处理不能超过 100000 个字符', 400);
  if (custom.length > 1000) throw new OptimizeError('补充要求不能超过 1000 个字符', 400);
  return { content, mode, custom, instruction: `${instructions[mode]}${custom ? `\n补充要求：${custom}` : ''}` };
}

function splitFrontMatter(content: string) {
  const match = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/);
  return match ? { prefix: match[0], body: content.slice(match[0].length) } : { prefix: '', body: content };
}

async function request(config: LLMConfig, endpoint: string, payload: unknown, fetcher: typeof fetch) {
  let response: Response;
  try { response = await fetcher(`${config.baseUrl}/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000) }); }
  catch (error) { throw new OptimizeError(error instanceof Error && error.name === 'TimeoutError' ? 'AI 服务响应超时，请重试' : '无法连接 AI 服务，请稍后重试', 502); }
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) { const remote = data.error as { message?: string } | undefined; throw new OptimizeError(remote?.message ? `AI 服务：${remote.message}` : `AI 服务返回 ${response.status}`, response.status === 429 ? 429 : 502, response.status); }
  return data;
}

function chatText(data: Record<string, unknown>) {
  const content = (data.choices as Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }> | undefined)?.[0]?.message?.content;
  return typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text || '').join('') : '';
}
function responsesText(data: Record<string, unknown>) {
  if (typeof data.output_text === 'string') return data.output_text;
  return (data.output as Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> | undefined)?.filter((item) => item.type === 'message').flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text || '').join('') || '';
}

function cleanResult(result: string) {
  return result.trim().replace(/^```(?:markdown)?\s*\n?|\n?```$/g, '');
}

function generatedArticle(source: string, result: string) {
  const cleaned = cleanResult(result);
  const match = cleaned.match(/^\s*\[\[TITLE\]\]\s*\r?\n([^\r\n]+)\r?\n\s*\[\[CONTENT\]\]\s*\r?\n([\s\S]+)$/i);
  if (!match?.[1].trim() || !match[2].trim()) throw new OptimizeError('AI 未按要求返回标题和正文，请重试', 502);
  return writeFrontMatter(source, { title: match[1].trim() }).replace(/(^---[\s\S]*?\r?\n---\s*(?:\r?\n|$))[\s\S]*$/, (_whole, prefix: string) => `${prefix}${match[2].trim()}`);
}

export async function optimizeArticle(input: OptimizeInput, fetcher: typeof fetch = fetch) {
  const validated = validateOptimizeInput(input); const config = configuration(); const { prefix, body } = splitFrontMatter(validated.content);
  if (!body.trim() && (validated.mode !== 'generate' || !validated.custom)) throw new OptimizeError(validated.mode === 'generate' ? '请输入写作要求或正文素材' : 'Front Matter 之外没有可处理的正文', 400);
  const generating = validated.mode === 'generate';
  const system = generating
    ? '你是严谨的中文 Markdown 作者。严格按以下格式输出，不添加解释或代码围栏：第一行是 [[TITLE]]，第二行只写文章标题，第三行是 [[CONTENT]]，随后只写 Markdown 正文。正文不要重复输出文章标题，不要输出 Front Matter，不要虚构素材中没有的具体事实。'
    : '你是严谨的中文 Markdown 编辑。只输出修改后的 Markdown 正文，不添加解释、代码围栏或 Front Matter。保留原文事实、链接、图片、代码块和标题层级；不要杜撰信息。';
  const prompt = `${generating ? '写作要求' : '编辑要求'}：${validated.instruction}\n\n${body.trim() ? '已有素材' : '已有素材（无）'}：\n${body}`;
  const callChat = async () => chatText(await request(config, 'chat/completions', { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2 }, fetcher));
  const callResponses = async () => responsesText(await request(config, 'responses', { model: config.model, instructions: system, input: prompt, store: false }, fetcher));
  let result = '';
  if (config.apiStyle === 'chat') result = await callChat(); else if (config.apiStyle === 'responses') result = await callResponses();
  else { try { result = await callChat(); } catch (error) { if (!(error instanceof OptimizeError) || ![400, 404].includes(error.upstreamStatus || 0)) throw error; result = await callResponses(); } }
  if (!result.trim()) throw new OptimizeError('AI 未返回可用文本', 502);
  return generating ? generatedArticle(validated.content, result) : prefix + cleanResult(result);
}
