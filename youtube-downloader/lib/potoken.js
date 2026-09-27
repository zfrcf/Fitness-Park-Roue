// Génération d'un jeton « Proof of Origin » (PO token) via BotGuard.
// Sans ce jeton, YouTube répond « Sign in to confirm you're not a bot » aux
// requêtes venant d'adresses IP de datacenter (Vercel, AWS…). Le jeton est
// lié au visitorData de la session et reste valable ~12 h ; on le met en
// cache en mémoire et dans /tmp pour les invocations suivantes.

import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, GOOG_API_KEY, USER_AGENT } from 'bgutils-js/utils';
import { Innertube } from 'youtubei.js';

export { USER_AGENT };

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const CACHE_FILE = process.env.PO_TOKEN_CACHE || '/tmp/yt-po-token.json';
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000; // on régénère après 6 h

let memory = null;
let inflight = null;

function isFresh(entry) {
  return entry && entry.poToken && entry.visitorData && Date.now() - entry.createdAt < REFRESH_AFTER_MS;
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const entry = JSON.parse(raw);
    return isFresh(entry) ? entry : null;
  } catch {
    return null;
  }
}

async function writeCache(entry) {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(entry));
  } catch {
    // /tmp indisponible : on garde seulement le cache mémoire.
  }
}

/** Exécute BotGuard dans un DOM simulé et fabrique un jeton lié au visitorData. */
async function generate() {
  const bootstrap = await Innertube.create({
    user_agent: USER_AGENT,
    enable_session_cache: false,
    retrieve_player: false,
  });
  const visitorData = bootstrap.session.context.client.visitorData;
  if (!visitorData) throw new Error('visitorData introuvable');

  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'https://www.youtube.com/',
    referrer: 'https://www.youtube.com/',
    userAgent: USER_AGENT,
    virtualConsole: new VirtualConsole(),
  });

  const hadNavigator = Reflect.has(globalThis, 'navigator');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, origin: dom.window.origin });
  if (!hadNavigator) Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

  try {
    const challenge = await bootstrap.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND');
    if (!challenge.bg_challenge) throw new Error('défi BotGuard indisponible');

    const interpreterUrl = challenge.bg_challenge.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
    const interpreterJs = await (await fetch(`https:${interpreterUrl}`)).text();
    if (!interpreterJs) throw new Error('interpréteur BotGuard vide');
    new Function(interpreterJs)();

    const botguard = await BotGuardClient.create({
      program: challenge.bg_challenge.program,
      globalName: challenge.bg_challenge.global_name,
      globalObject: globalThis,
    });
    const webPoSignalOutput = [];
    const botguardResponse = await botguard.snapshot({ webPoSignalOutput });

    const itResponse = await fetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': GOOG_API_KEY,
        'x-user-agent': 'grpc-web-javascript/0.1',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    });
    const it = await itResponse.json();
    if (typeof it?.[0] !== 'string') throw new Error('jeton d\'intégrité refusé');

    const minter = await WebPoMinter.create({ integrityToken: it[0] }, webPoSignalOutput);
    const poToken = await minter.mintAsWebsafeString(visitorData);
    return { poToken, visitorData, createdAt: Date.now() };
  } finally {
    // On retire le DOM simulé pour ne pas perturber le reste du processus.
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.location;
    delete globalThis.origin;
    if (!hadNavigator) delete globalThis.navigator;
    dom.window.close();
  }
}

/**
 * Retourne { poToken, visitorData } : variables d'environnement si définies,
 * sinon cache, sinon génération. Retourne null en cas d'échec (le serveur
 * continue alors sans jeton).
 */
export async function getPoTokenSession({ force = false } = {}) {
  if (process.env.YT_PO_TOKEN && process.env.YT_VISITOR_DATA) {
    return { poToken: process.env.YT_PO_TOKEN, visitorData: process.env.YT_VISITOR_DATA, source: 'env' };
  }
  if (!force) {
    if (isFresh(memory)) return { ...memory, source: 'memory' };
    const cached = await readCache();
    if (cached) {
      memory = cached;
      return { ...cached, source: 'disk' };
    }
  }
  if (!inflight) {
    inflight = generate()
      .then(async (entry) => {
        memory = entry;
        await writeCache(entry);
        return { ...entry, source: 'generated' };
      })
      .catch((err) => {
        console.warn('[potoken] génération impossible :', err.message);
        return null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
