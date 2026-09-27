// Cœur du téléchargeur : résolution d'un lien YouTube vers ses flux.
// Basé sur youtubei.js (client InnerTube), avec une chaîne de clients de repli,
// car depuis une IP de datacenter certains clients déclenchent la
// détection anti-robot de YouTube ("Sign in to confirm you're not a bot").

import vm from 'node:vm';
import { Innertube, UniversalCache, Platform } from 'youtubei.js';
import { getPoTokenSession, USER_AGENT } from './potoken.js';

// Évaluateur JavaScript pour déchiffrer les paramètres "n" et "sig" des URL de
// flux : youtubei.js extrait le code du lecteur YouTube et nous l'exécutons dans
// un contexte isolé (module vm de Node).
Platform.shim.eval = (data, env) => {
  const context = vm.createContext({ URL, URLSearchParams, ...env });
  return vm.runInContext(`(function(){ ${data.output} })()`, context, { timeout: 5000 });
};

// Ordre d'essai des clients. MWEB fournit les formats "vidéo+audio"
// (progressifs) et des URL directes ; iOS et Android sont les plus tolérants
// depuis un datacenter. WEB ne renvoie plus que du SABR (sans URL), on le
// garde en dernier recours avec TV.
export const CLIENT_CHAIN = ['MWEB', 'IOS', 'ANDROID', 'TV', 'WEB'];

const CLIENT_USER_AGENTS = {
  IOS: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  ANDROID: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
};

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrait l'identifiant vidéo depuis n'importe quelle forme de lien YouTube :
 * watch?v=, youtu.be/, /live/, /shorts/, /embed/, /v/, /e/, music.youtube.com,
 * paramètres si=/t=/list= en trop, ou un identifiant nu.
 */
export function extractVideoId(input) {
  if (!input) return null;
  let raw = String(input).trim();
  if (ID_RE.test(raw)) return raw;
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\.|^music\.|^gaming\./, '').toLowerCase();
  const isYoutube = host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be';
  if (!isYoutube) return null;

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && ID_RE.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && ID_RE.test(v)) return v;

  // /live/ID, /shorts/ID, /embed/ID, /v/ID, /e/ID
  const m = url.pathname.match(/^\/(?:live|shorts|embed|v|e)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
  if (m) return m[1];

  // /attribution_link?u=/watch%3Fv%3DID
  const u = url.searchParams.get('u');
  if (u) {
    const inner = u.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (inner) return inner[1];
  }

  return null;
}

let innertubePromise = null;
let innertubeForceRefresh = false;

/** Session InnerTube partagée entre les invocations "chaudes" de la fonction. */
export function getInnertube() {
  if (!innertubePromise) {
    const force = innertubeForceRefresh;
    innertubeForceRefresh = false;
    innertubePromise = (async () => {
      const po = await getPoTokenSession({ force });
      if (po) console.log(`[yt] session avec jeton PO (${po.source})`);
      return Innertube.create({
        cache: new UniversalCache(true, '/tmp/youtubei-cache'),
        generate_session_locally: true,
        user_agent: USER_AGENT,
        cookie: process.env.YT_COOKIES || undefined,
        po_token: po?.poToken,
        visitor_data: po?.visitorData,
        lang: 'fr',
        location: 'FR',
      });
    })().catch((err) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

export class YoutubeError extends Error {
  constructor(message, status = 502, code = 'YT_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function describeStatus(status, reason) {
  if (status === 'LOGIN_REQUIRED') {
    return new YoutubeError(
      'YouTube exige une connexion depuis ce serveur (détection anti-robot). ' +
        'Réessaie dans quelques secondes ; si le blocage persiste, configure la variable ' +
        'YT_COOKIES sur Vercel avec les cookies d\'un compte YouTube connecté.',
      503,
      'LOGIN_REQUIRED',
    );
  }
  if (status === 'UNPLAYABLE' || status === 'ERROR') {
    return new YoutubeError(reason || 'Cette vidéo n\'est pas lisible (privée, supprimée ou géo-bloquée).', 422, status);
  }
  if (status === 'LIVE_STREAM_OFFLINE') {
    return new YoutubeError('Ce direct n\'a pas encore commencé.', 422, status);
  }
  if (status === 'AGE_CHECK_REQUIRED' || status === 'CONTENT_CHECK_REQUIRED') {
    return new YoutubeError('Cette vidéo demande une vérification d\'âge ; ajoute YT_COOKIES d\'un compte majeur.', 422, status);
  }
  return new YoutubeError(reason || `YouTube a refusé la lecture (${status}).`, 502, status || 'UNKNOWN');
}

/** Priorité des erreurs : on remonte la plus parlante pour l'utilisateur. */
const ERROR_PRIORITY = { IS_LIVE: 6, UNPLAYABLE: 5, ERROR: 5, LIVE_STREAM_OFFLINE: 5, AGE_CHECK_REQUIRED: 4, CONTENT_CHECK_REQUIRED: 4, LOGIN_REQUIRED: 3, NO_FORMATS: 2, CLIENT_ERROR: 1 };
function pickError(current, candidate) {
  if (!current) return candidate;
  return (ERROR_PRIORITY[candidate.code] || 0) >= (ERROR_PRIORITY[current.code] || 0) ? candidate : current;
}

/** Réinitialise la session InnerTube (nouveau visitor_data) : utile quand
 * YouTube marque la session courante comme robot. */
export function resetInnertube() {
  innertubePromise = null;
  innertubeForceRefresh = true; // nouveau visitorData + nouveau jeton PO
}

async function tryClients(videoId, clients) {
  const yt = await getInnertube();
  let lastError = null;

  for (const client of clients) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const status = info.playability_status?.status;
      const sd = info.streaming_data;
      const hasFormats = sd && ((sd.formats?.length || 0) + (sd.adaptive_formats?.length || 0)) > 0;

      if (status === 'OK' && hasFormats) return { info, client, yt };
      if (info.basic_info?.is_live) {
        throw new YoutubeError('Cette vidéo est un direct en cours : attends la fin du live pour la télécharger.', 422, 'IS_LIVE');
      }
      lastError = pickError(lastError, describeStatus(status, info.playability_status?.reason));
      // Erreur définitive confirmée par un client "web" : inutile de continuer.
      if (['UNPLAYABLE', 'ERROR', 'LIVE_STREAM_OFFLINE'].includes(status) && client !== 'IOS') break;
    } catch (err) {
      if (err instanceof YoutubeError) {
        lastError = pickError(lastError, err);
        if (err.code === 'IS_LIVE') break;
      } else {
        lastError = pickError(lastError, new YoutubeError(`Erreur client ${client} : ${err.message}`, 502, 'CLIENT_ERROR'));
      }
    }
  }
  throw lastError || new YoutubeError('Aucun flux disponible pour cette vidéo.', 502, 'NO_FORMATS');
}

/**
 * Récupère les informations d'une vidéo en essayant chaque client jusqu'à
 * obtenir des flux. Si YouTube réclame une connexion (anti-robot), on
 * régénère la session une fois et on réessaie. Retourne { info, client, yt }.
 */
export async function fetchPlayable(videoId, preferredClients = CLIENT_CHAIN) {
  try {
    return await tryClients(videoId, preferredClients);
  } catch (err) {
    if (err instanceof YoutubeError && err.code === 'LOGIN_REQUIRED') {
      resetInnertube();
      return tryClients(videoId, preferredClients);
    }
    throw err;
  }
}

function kindOf(f) {
  if (f.has_video && f.has_audio) return 'video+audio';
  if (f.has_video) return 'video';
  if (f.has_audio) return 'audio';
  return 'other';
}

function containerOf(f) {
  const mime = f.mime_type || '';
  if (mime.includes('mp4')) return f.has_video ? 'mp4' : 'm4a';
  if (mime.includes('webm')) return f.has_video ? 'webm' : 'webm';
  if (mime.includes('3gpp')) return '3gp';
  return 'bin';
}

/** Met en forme la liste des formats pour le front. */
export function listFormats(info, client) {
  const sd = info.streaming_data;
  const all = [...(sd.formats || []), ...(sd.adaptive_formats || [])];
  const seen = new Set();
  const out = [];

  for (const f of all) {
    if (f.has_text) continue; // sous-titres
    if (f.is_drc || f.is_dubbed || f.is_descriptive || f.is_auto_dubbed) continue; // pistes secondaires
    const kind = kindOf(f);
    if (kind === 'other') continue;
    const key = `${f.itag}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      itag: f.itag,
      kind,
      client,
      quality: f.quality_label || (f.has_audio ? `${Math.round((f.bitrate || 0) / 1000)} kbit/s` : f.quality || ''),
      height: f.height || 0,
      fps: f.fps || 0,
      container: containerOf(f),
      mime: (f.mime_type || '').split(';')[0],
      codecs: ((f.mime_type || '').match(/codecs="([^"]+)"/) || [])[1] || '',
      size: f.content_length ? Number(f.content_length) : null,
      bitrate: f.bitrate || 0,
      audioQuality: f.audio_quality || null,
    });
  }

  const rank = { 'video+audio': 0, video: 1, audio: 2 };
  out.sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
    if (b.height !== a.height) return b.height - a.height;
    if (b.fps !== a.fps) return b.fps - a.fps;
    if (a.container !== b.container) return a.container === 'mp4' || a.container === 'm4a' ? -1 : 1;
    return b.bitrate - a.bitrate;
  });
  return out;
}

/** Nettoie un titre pour en faire un nom de fichier. */
export function safeFilename(title, ext) {
  const base = String(title || 'video')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'video';
  return `${base}.${ext}`;
}

/**
 * Résout l'URL directe (déchiffrée) d'un format précis. Essaie d'abord le
 * client indiqué (celui qui a produit la liste), puis les autres.
 */
export async function resolveStream(videoId, itag, preferredClient) {
  const chain = preferredClient
    ? [preferredClient, ...CLIENT_CHAIN.filter((c) => c !== preferredClient)]
    : CLIENT_CHAIN;

  let lastError = null;
  for (const client of chain) {
    let resolved;
    try {
      resolved = await fetchPlayable(videoId, [client]);
    } catch (err) {
      lastError = err;
      continue;
    }
    const { info, yt } = resolved;
    const sd = info.streaming_data;
    const all = [...(sd.formats || []), ...(sd.adaptive_formats || [])];
    const format = all.find((f) => f.itag === Number(itag) && !f.is_drc && !f.is_dubbed);
    if (!format) {
      lastError = new YoutubeError(`Le format ${itag} n'est pas disponible via le client ${client}.`, 404, 'FORMAT_NOT_FOUND');
      continue;
    }
    const url = await format.decipher(yt.session.player);
    if (!url) {
      lastError = new YoutubeError('Impossible de déchiffrer l\'URL du flux.', 502, 'DECIPHER_FAILED');
      continue;
    }
    return {
      url,
      client,
      format,
      title: info.basic_info.title || videoId,
      size: format.content_length ? Number(format.content_length) : null,
      mime: (format.mime_type || '').split(';')[0],
      container: containerOf(format),
      userAgent: CLIENT_USER_AGENTS[client] || USER_AGENT,
    };
  }
  throw lastError || new YoutubeError('Flux introuvable.', 404, 'FORMAT_NOT_FOUND');
}

/** Fabrique la charge utile JSON de /api/info. */
export async function getVideoInfo(videoId) {
  const { info, client } = await fetchPlayable(videoId);
  const b = info.basic_info;
  const thumbs = (b.thumbnail || []).slice().sort((a, c) => (c.width || 0) - (a.width || 0));
  return {
    id: videoId,
    title: b.title || '',
    author: b.author || '',
    channelId: b.channel_id || '',
    duration: b.duration || 0,
    views: b.view_count || 0,
    isLive: !!b.is_live,
    wasLive: !!b.is_live_content,
    thumbnail: thumbs[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    client,
    formats: listFormats(info, client),
  };
}
