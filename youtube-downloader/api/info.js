// GET /api/info?url=<lien YouTube>
// Retourne le titre, la durée, la miniature et la liste des formats.

import { extractVideoId, getVideoInfo, parseClientList, CLIENT_CHAIN, YoutubeError } from '../lib/yt.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Méthode non autorisée.' }));
  }

  const url = new URL(req.url, 'http://localhost');
  const input = url.searchParams.get('url') || url.searchParams.get('id') || '';
  const videoId = extractVideoId(input);

  if (!videoId) {
    res.statusCode = 400;
    return res.end(
      JSON.stringify({
        error: 'Lien YouTube non reconnu. Formats acceptés : youtube.com/watch?v=…, youtu.be/…, youtube.com/live/…, /shorts/…, /embed/….',
        code: 'INVALID_URL',
      }),
    );
  }

  try {
    const clients = parseClientList(url.searchParams.get('clients')) || CLIENT_CHAIN;
    const data = await getVideoInfo(videoId, clients);
    res.statusCode = 200;
    return res.end(JSON.stringify(data));
  } catch (err) {
    const status = err instanceof YoutubeError ? err.status : 502;
    res.statusCode = status;
    return res.end(
      JSON.stringify({
        error: err.message || 'Erreur inconnue.',
        code: err.code || 'UNKNOWN',
        id: videoId,
      }),
    );
  }
}
