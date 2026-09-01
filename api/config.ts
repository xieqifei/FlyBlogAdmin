import type { VercelRequest, VercelResponse } from '@vercel/node';
import { configurationStatus } from '../server/configuration.js';

export default function configHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(200).json(configurationStatus());
}
