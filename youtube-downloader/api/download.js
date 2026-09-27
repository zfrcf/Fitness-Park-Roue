// GET /api/download?id=<videoId>&itag=<itag>&client=<client>&title=<nom>
// Relaie le flux YouTube vers le navigateur, avec prise en charge des
// requêtes Range (reprise, téléchargement par morceaux parallèles).
// Chaque invocation résout une URL fraîche : les URL googlevideo sont liées
// à l'adresse IP qui les a demandées, il faut donc les résoudre et les lire
// depuis la même exécution.

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extractVideoId, resolveStream, safeFilename, YoutubeError } from '../lib/yt.js';

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function parseRange(header, size) {
  if (!header) return null;
  const m = RANGE_RE.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    // bytes=-500 : les 500 derniers octets
    if (size === null) return null;
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || (size !== null && end >= size)) {
    end = size !== null ? size - 1 : null;
  }
  if (size !== null && start >= size) return { invalid: true };
  if (end !== null && end < start) return { invalid: true };
  return { start, end };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Méthode non autorisée.' });
  }

  const url = new URL(req.url, 'http://localhost');
  const videoId = extractVideoId(url.searchParams.get('id') || url.searchParams.get('url') || '');
  const itag = Number(url.searchParams.get('itag'));
  const client = url.searchParams.get('client') || undefined;
  const requestedTitle = url.searchParams.get('title') || '';

  if (!videoId || !Number.isInteger(itag) || itag <= 0) {
    return sendJson(res, 400, { error: 'Paramètres invalides (id et itag requis).', code: 'BAD_REQUEST' });
  }

  let stream;
  try {
    stream = await resolveStream(videoId, itag, client);
  } catch (err) {
    const status = err instanceof YoutubeError ? err.status : 502;
    return sendJson(res, status, { error: err.message, code: err.code || 'UNKNOWN' });
  }

  const size = stream.size;
  const range = parseRange(req.headers.range, size);
  if (range?.invalid) {
    res.statusCode = 416;
    if (size !== null) res.setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }

  const upstreamHeaders = {};
  if (stream.userAgent) upstreamHeaders['User-Agent'] = stream.userAgent;
  // Le paramètre d'URL "range" est celui que les clients officiels utilisent ;
  // l'en-tête Range est aussi honoré par googlevideo. On envoie les deux.
  let upstreamUrl = stream.url;
  if (range) {
    const endPart = range.end === null ? '' : range.end;
    upstreamHeaders.Range = `bytes=${range.start}-${endPart}`;
    upstreamUrl += `&range=${range.start}-${endPart}`;
  } else if (size !== null) {
    upstreamUrl += `&range=0-${size - 1}`;
  }

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    if (controller.signal.aborted) return;
    return sendJson(res, 502, { error: `Connexion au serveur vidéo impossible : ${err.message}`, code: 'UPSTREAM_ERROR' });
  }

  if (!upstream.ok) {
    const code = upstream.status === 403 ? 'UPSTREAM_403' : 'UPSTREAM_ERROR';
    const message =
      upstream.status === 403
        ? 'YouTube a refusé le flux (403). Réessaie ; si cela persiste, la vidéo demande une session connectée (variable YT_COOKIES).'
        : `Le serveur vidéo a répondu ${upstream.status}.`;
    return sendJson(res, 502, { error: message, code, upstreamStatus: upstream.status });
  }

  const filename = safeFilename(requestedTitle || stream.title, stream.container);
  const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Type', stream.mime || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader('X-Video-Client', stream.client);

  const upstreamLength = upstream.headers.get('content-length');
  if (range) {
    const total = size !== null ? size : (upstream.headers.get('content-range') || '').split('/')[1] || '*';
    const end = range.end !== null ? range.end : upstreamLength ? range.start + Number(upstreamLength) - 1 : null;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${end ?? ''}/${total}`);
    if (upstreamLength) res.setHeader('Content-Length', upstreamLength);
  } else {
    res.statusCode = 200;
    if (upstreamLength) res.setHeader('Content-Length', upstreamLength);
    else if (size !== null) res.setHeader('Content-Length', String(size));
  }

  if (req.method === 'HEAD' || !upstream.body) {
    return res.end();
  }

  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (err) {
    // Client parti ou flux interrompu : rien à renvoyer.
    if (!res.headersSent) sendJson(res, 502, { error: `Flux interrompu : ${err.message}`, code: 'STREAM_ERROR' });
    else res.destroy();
  }
}
