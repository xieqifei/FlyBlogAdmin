import type { VercelRequest, VercelResponse } from '@vercel/node';

type Post = { name: string; path: string; sha?: string; content?: string };
const config = () => ({ token: process.env.QEXO_GITHUB_TOKEN, repository: process.env.QEXO_GITHUB_REPOSITORY, branch: process.env.QEXO_GITHUB_BRANCH || 'main', path: process.env.QEXO_POSTS_PATH || 'source/_posts' });

async function github(method: string, path: string, body?: unknown) {
  const { token } = config();
  if (!token) throw new Error('QEXO_GITHUB_TOKEN is not configured');
  const response = await fetch(`https://api.github.com${path}`, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url?.startsWith('/api/health')) return res.status(200).json({ ok: true, runtime: 'node', configured: Boolean(config().token && config().repository) });
  if (req.method !== 'GET' && req.method !== 'PUT' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  const { repository, branch, path } = config();
  if (!repository) return res.status(503).json({ error: 'QEXO_GITHUB_REPOSITORY is not configured' });
  try {
    const requested = String(req.query.path || '').replace(/^\/+/, '');
    const filePath = requested ? `${path}/${requested}` : path;
    if (req.method === 'GET') {
      const result = await github('GET', `/repos/${repository}/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
      const files = Array.isArray(result) ? result.filter((file) => file.type === 'file').map((file) => ({ name: file.name, path: file.path, sha: file.sha })) : [{ name: result.name, path: result.path, sha: result.sha, content: Buffer.from(result.content, 'base64').toString('utf8') }];
      return res.status(200).json({ posts: files });
    }
    const post = req.body as Post;
    if (req.method === 'DELETE') {
      if (!post?.name || !post.sha) return res.status(400).json({ error: 'name and sha are required' });
      await github('DELETE', `/repos/${repository}/contents/${path}/${post.name}`, { message: `Delete post ${post.name}`, sha: post.sha, branch });
      return res.status(200).json({ ok: true });
    }
    if (!post?.name || !post.content) return res.status(400).json({ error: 'name and content are required' });
    const target = `${path}/${post.name}`;
    const payload = { message: `${req.method === 'PUT' ? 'Update' : 'Create'} post ${post.name}`, content: Buffer.from(post.content).toString('base64'), branch, ...(post.sha ? { sha: post.sha } : {}) };
    const result = await github('PUT', `/repos/${repository}/contents/${target}`, payload);
    return res.status(200).json({ ok: true, path: result.content.path, sha: result.content.sha });
  } catch (error) { return res.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected error' }); }
}
