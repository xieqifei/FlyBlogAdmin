import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createHmac, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { configurationStatus } from './configuration.js';
import { R2Error, buildObjectKey, contentTypeFor, deleteObject, getObject, listBuckets, listObjects, putObject, r2Configuration, validateBucketName, validateObjectKey } from './r2.js';
import { parseFrontMatter, values, writeFrontMatter } from '../shared/frontMatter.js';
import { automaticArticleDates, currentDateTime, normalizeDateTime } from '../shared/dateTime.js';

type GitHubFile = { name: string; path: string; sha: string; type: 'file' | 'dir'; content?: string };
type Post = { name: string; path?: string; sha?: string; content?: string; clientTime?: string };
type GraphNode = { id: string; label: string; type: 'article' | 'category' | 'tag'; path?: string; degree: number };
type GraphEdge = { source: string; target: string; type: 'link' | 'category' | 'tag'; directed?: boolean };

const SESSION_COOKIE = 'flyblog_session';

function config() {
  return {
    token: process.env.GITHUB_TOKEN?.trim(),
    repository: process.env.GITHUB_REPOSITORY?.trim(),
    branch: process.env.GITHUB_BRANCH?.trim() || 'main',
    postsPath: (process.env.POSTS_PATH?.trim() || 'source/_posts').replace(/^\/+|\/+$/g, ''),
    extensions: (process.env.POST_EXTENSIONS || '.md,.markdown').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
    username: process.env.ADMIN_USERNAME || '',
    password: process.env.ADMIN_PASSWORD || '',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
    secret: process.env.SECRET_KEY || '',
    sessionAge: Math.max(300, Number(process.env.SESSION_AGE) || 604800),
  };
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifyPassword(candidate: string) {
  const { password, passwordHash } = config();
  if (passwordHash.startsWith('pbkdf2_sha256$')) {
    const [, iterationsText, salt, expected] = passwordHash.split('$'); const iterations = Number(iterationsText);
    if (!iterations || !salt || !expected) return false;
    const length = Buffer.from(expected, 'base64').length;
    return length > 0 && safeEqual(pbkdf2Sync(candidate, salt, iterations, length, 'sha256').toString('base64'), expected);
  }
  if (passwordHash.startsWith('sha256$')) return safeEqual(createHash('sha256').update(candidate).digest('hex'), passwordHash.slice(7));
  return Boolean(password) && safeEqual(candidate, password);
}

function credentialFingerprint() {
  const current = config();
  return createHash('sha256').update(`${current.username}\0${current.passwordHash || current.password}`).digest('hex').slice(0, 20);
}

function signSession(username: string) {
  const current = config();
  const payload = Buffer.from(JSON.stringify({ username, exp: Math.floor(Date.now() / 1000) + current.sessionAge, credential: credentialFingerprint() })).toString('base64url');
  return `${payload}.${createHmac('sha256', current.secret).update(payload).digest('base64url')}`;
}

function cookies(req: VercelRequest) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((item) => item.trim().split(/=(.*)/s, 2)).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)]));
}

function isAuthenticated(req: VercelRequest) {
  const current = config(); const token = cookies(req)[SESSION_COOKIE];
  if (!current.secret || !token) return false;
  const [payload, signature] = token.split('.'); if (!payload || !signature) return false;
  if (!safeEqual(signature, createHmac('sha256', current.secret).update(payload).digest('base64url'))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { username: string; exp: number; credential: string };
    return session.username === current.username && session.exp > Date.now() / 1000 && session.credential === credentialFingerprint();
  } catch { return false; }
}

function setSessionCookie(res: VercelResponse, value: string, maxAge: number) {
  const secure = process.env.COOKIE_SECURE !== '0' && (Boolean(process.env.VERCEL) || process.env.COOKIE_SECURE === '1');
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function requestPath(req: VercelRequest) {
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route;
  return route ? `/api/${String(route).replace(/^\/+|\/+$/g, '')}` : new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
}
function mutationOriginAllowed(req: VercelRequest) {
  const origin = req.headers.origin; const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function github(method: string, apiPath: string, body?: unknown) {
  const { token } = config(); if (!token) throw new Error('GITHUB_TOKEN is not configured');
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'FlyBlogAdmin' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(detail.message || `GitHub request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function encodeRepositoryPath(path: string) { return path.split('/').map(encodeURIComponent).join('/'); }
function relativePostPath(value: unknown) {
  const cleaned = String(value || '').replace(/^\/+/, ''); const normalized = posix.normalize(cleaned);
  if (!cleaned || normalized === '.' || normalized.startsWith('../') || posix.isAbsolute(normalized)) throw new Error('Invalid article path');
  return normalized;
}
function isPost(file: GitHubFile) {
  const base = posix.basename(file.path).toLowerCase();
  return file.type === 'file' && base !== '.password' && !base.startsWith('.') && config().extensions.some((extension) => base.endsWith(extension));
}

async function listPosts(directory = config().postsPath): Promise<GitHubFile[]> {
  const current = config();
  const result = await github('GET', `/repos/${current.repository}/contents/${encodeRepositoryPath(directory)}?ref=${encodeURIComponent(current.branch)}`) as GitHubFile[];
  if (!Array.isArray(result)) return isPost(result) ? [result] : [];
  const nested = await Promise.all(result.filter((item) => item.type === 'dir' && !item.name.startsWith('.')).map((item) => listPosts(item.path)));
  return result.filter(isPost).concat(...nested).sort((a, b) => a.path.localeCompare(b.path));
}

async function readPost(relativePath: string) {
  const current = config(); const target = `${current.postsPath}/${relativePath}`;
  const result = await github('GET', `/repos/${current.repository}/contents/${encodeRepositoryPath(target)}?ref=${encodeURIComponent(current.branch)}`) as GitHubFile;
  if (Array.isArray(result) || !isPost(result)) throw new Error('Article not found');
  return { name: result.name, path: relativePath, sha: result.sha, content: Buffer.from(result.content || '', 'base64').toString('utf8') };
}

function slug(value: string) { return value.toLowerCase().replace(/\.(md|markdown)$/i, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, ''); }
function safeDecode(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
function metadataTime(value: string) { const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T')); return Number.isNaN(parsed) ? 0 : parsed; }

async function buildGraph() {
  const files = await listPosts();
  const posts = await Promise.all(files.map(async (file) => {
    const relative = file.path.slice(config().postsPath.length + 1); const article = await readPost(relative); const parsed = parseFrontMatter(article.content);
    return { ...article, metadata: parsed.fields, body: parsed.body, title: String(parsed.fields.title || file.name.replace(/\.(md|markdown)$/i, '')) };
  }));
  const nodes = new Map<string, GraphNode>(); const edges: GraphEdge[] = []; const edgeKeys = new Set<string>(); const aliases = new Map<string, string>();
  for (const post of posts) {
    nodes.set(post.path, { id: post.path, label: post.title, type: 'article', path: post.path, degree: 0 });
    [post.path, posix.basename(post.path), post.title].forEach((alias) => aliases.set(slug(alias), post.path));
  }
  const addEdge = (source: string, target: string, type: GraphEdge['type'], directed = false) => {
    if (source === target) return; const key = `${source}\0${target}\0${type}`; if (edgeKeys.has(key)) return; edgeKeys.add(key); edges.push({ source, target, type, directed });
  };
  for (const post of posts) {
    for (const category of values(post.metadata.categories || post.metadata.category)) { const id = `category:${category}`; if (!nodes.has(id)) nodes.set(id, { id, label: category, type: 'category', degree: 0 }); addEdge(post.path, id, 'category'); }
    for (const tag of values(post.metadata.tags || post.metadata.tag)) { const id = `tag:${tag}`; if (!nodes.has(id)) nodes.set(id, { id, label: tag, type: 'tag', degree: 0 }); addEdge(post.path, id, 'tag'); }
    const links = [...post.body.matchAll(/!?(?:\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|\[[^\]]*\]\(([^)\s#]+)(?:#[^)]*)?\))/g)];
    for (const match of links) {
      if (match[0].startsWith('!')) continue;
      const raw = safeDecode((match[1] || match[2] || '').trim()).replace(/^\.\//, ''); if (!raw || /^(?:[a-z]+:|\/\/|#)/i.test(raw)) continue;
      const resolved = aliases.get(slug(raw)) || aliases.get(slug(posix.normalize(posix.join(posix.dirname(post.path), raw)))); if (resolved) addEdge(post.path, resolved, 'link', true);
    }
  }
  for (const edge of edges) { const source = nodes.get(edge.source); const target = nodes.get(edge.target); if (source) source.degree += 1; if (target) target.degree += 1; }
  return { nodes: [...nodes.values()], edges };
}

function jsonBody<T>(req: VercelRequest) { return (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}) as T; }
function responseStatus(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : 500;
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store'); const path = requestPath(req); const method = req.method || 'GET';
  try {
    if (method === 'GET' && path === '/api/health') return res.status(200).json({ ok: true, runtime: 'node', ...configurationStatus() });
    if (method === 'GET' && path === '/api/config') return res.status(200).json(configurationStatus());
    if (method === 'POST' && path === '/api/auth/login') {
      if (!mutationOriginAllowed(req)) return res.status(403).json({ error: 'Invalid request origin' });
      if (!configurationStatus().configured) return res.status(503).json({ error: '请先完成环境变量配置' });
      const body = jsonBody<{ username?: string; password?: string }>(req);
      if (!safeEqual(body.username || '', config().username) || !verifyPassword(body.password || '')) return res.status(401).json({ error: '用户名或密码错误' });
      setSessionCookie(res, signSession(config().username), config().sessionAge); return res.status(200).json({ ok: true });
    }
    if (method === 'POST' && path === '/api/auth/logout') { setSessionCookie(res, '', 0); return res.status(200).json({ ok: true }); }
    if (method === 'GET' && path === '/api/auth/session') { const authenticated = isAuthenticated(req); return res.status(authenticated ? 200 : 401).json({ authenticated }); }
    if (!isAuthenticated(req)) return res.status(401).json({ error: '请先登录' });
    if (method !== 'GET' && !mutationOriginAllowed(req)) return res.status(403).json({ error: 'Invalid request origin' });
    if (method === 'GET' && path === '/api/graph') return res.status(200).json(await buildGraph());
    if (method === 'POST' && path === '/api/ai/optimize') {
      const { optimizeArticle } = await import('./llm.js');
      return res.status(200).json({ suggestion: await optimizeArticle(jsonBody(req)) });
    }
    if (method === 'GET' && path === '/api/r2/buckets') return res.status(200).json({ buckets: await listBuckets() });
    if (method === 'GET' && path === '/api/r2/content') {
      const bucket = validateBucketName(req.query.bucket); const key = validateObjectKey(req.query.key);
      const object = await getObject(bucket, key);
      res.setHeader('Content-Type', object.contentType); res.setHeader('Content-Length', String(object.body.length));
      return res.status(200).send(object.body);
    }
    if (method === 'GET' && path === '/api/r2/objects') {
      const bucket = validateBucketName(req.query.bucket);
      const prefix = typeof req.query.prefix === 'string' ? req.query.prefix.replace(/^\/+/, '') : '';
      const next = typeof req.query.next === 'string' ? req.query.next : '';
      return res.status(200).json(await listObjects(bucket, prefix, next));
    }
    if (method === 'POST' && path === '/api/r2/upload') {
      const body = jsonBody<{ bucket?: unknown; key?: unknown; filename?: unknown; content?: unknown; contentType?: unknown }>(req);
      const bucket = validateBucketName(body.bucket || r2Configuration().defaultBucket);
      const content = typeof body.content === 'string' ? body.content : '';
      if (!content) throw new R2Error('缺少文件内容', 400);
      const buffer = Buffer.from(content, 'base64');
      if (!buffer.length) throw new R2Error('缺少文件内容', 400);
      if (buffer.length > 25 * 1024 * 1024) throw new R2Error('文件大小不能超过 25MB', 400);
      const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
      const key = body.key !== undefined && body.key !== '' ? validateObjectKey(body.key) : buildObjectKey(filename);
      const result = await putObject({ bucket, key, body: buffer, contentType: typeof body.contentType === 'string' && body.contentType ? body.contentType : contentTypeFor(filename) });
      return res.status(200).json({ ...result, bucket });
    }
    if (method === 'DELETE' && path === '/api/r2/objects') {
      const bucket = validateBucketName(req.query.bucket);
      const key = validateObjectKey(req.query.key);
      await deleteObject(bucket, key);
      return res.status(200).json({ ok: true });
    }
    if (path !== '/api/posts') return res.status(404).json({ error: 'Not found' });
    if (method === 'GET') {
      if (req.query.path) return res.status(200).json({ post: await readPost(relativePostPath(req.query.path)) });
      const files = await listPosts(); const posts = await Promise.all(files.map(async (file) => {
        const relative = file.path.slice(config().postsPath.length + 1); const article = await readPost(relative); const { fields } = parseFrontMatter(article.content);
        return { name: file.name, path: relative, sha: file.sha, title: String(fields.title || file.name.replace(/\.(md|markdown)$/i, '')), categories: values(fields.categories || fields.category), tags: values(fields.tags || fields.tag), date: normalizeDateTime(fields.date), updated: normalizeDateTime(fields.updated) };
      }));
      return res.status(200).json({ posts: posts.sort((a, b) => metadataTime(b.updated || b.date) - metadataTime(a.updated || a.date) || a.title.localeCompare(b.title)) });
    }
    if (!['PUT', 'DELETE'].includes(method)) return res.status(405).json({ error: 'Method not allowed' });
    const post = jsonBody<Post>(req); const relative = relativePostPath(post.path || post.name);
    if (!config().extensions.some((extension) => relative.toLowerCase().endsWith(extension)) || posix.basename(relative).startsWith('.')) return res.status(400).json({ error: '不支持的文章路径' });
    const target = `${config().postsPath}/${relative}`;
    if (method === 'DELETE') {
      if (!post.sha) return res.status(400).json({ error: 'sha is required' });
      await github('DELETE', `/repos/${config().repository}/contents/${encodeRepositoryPath(target)}`, { message: `Delete post ${relative}`, sha: post.sha, branch: config().branch }); return res.status(200).json({ ok: true });
    }
    if (typeof post.content !== 'string') return res.status(400).json({ error: 'content is required' });
    const fields = parseFrontMatter(post.content).fields; const now = normalizeDateTime(post.clientTime) || currentDateTime();
    const content = writeFrontMatter(post.content, automaticArticleDates(fields.date, now, Boolean(post.sha)));
    const payload = { message: `${post.sha ? 'Update' : 'Create'} post ${relative}`, content: Buffer.from(content).toString('base64'), branch: config().branch, ...(post.sha ? { sha: post.sha } : {}) };
    const result = await github('PUT', `/repos/${config().repository}/contents/${encodeRepositoryPath(target)}`, payload) as { content: GitHubFile };
    return res.status(200).json({ ok: true, path: relative, sha: result.content.sha });
  } catch (error) { return res.status(responseStatus(error)).json({ error: error instanceof Error ? error.message : 'Unexpected error' }); }
}
