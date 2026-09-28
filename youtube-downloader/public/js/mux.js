// Fusion vidéo + audio dans le navigateur, sans réencodage.
//
// YouTube livre les qualités HD en deux flux MP4 fragmentés (fMP4) : une piste
// vidéo (avc1) et une piste audio (mp4a). Chaque flux commence par un en-tête
// (ftyp + moov), puis enchaîne des fragments (moof + mdat). Un fichier MP4 à
// deux pistes s'obtient en :
//   1. fusionnant les deux en-têtes moov (la piste audio devient la piste n° 2) ;
//   2. entrelaçant les fragments des deux flux par ordre chronologique, en
//      renumérotant les fragments audio (track_ID = 2) et la séquence.
// Aucune donnée n'est décodée : c'est une copie au niveau des boîtes MP4, ce qui
// permet de traiter un fichier de plusieurs Go en flux, sans le charger en mémoire.
//
// Ce module ne dépend pas du DOM : il est aussi utilisé par les tests Node.

const textDecoder = new TextDecoder('latin1');

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const setU32 = (b, o, v) => { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; };
const boxType = (b, o) => textDecoder.decode(b.subarray(o + 4, o + 8));
const ascii = (str) => Uint8Array.from(str, (c) => c.charCodeAt(0));

function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

/** Fabrique une boîte MP4 (taille 32 bits) à partir de son type et de son contenu. */
function makeBox(type, payloadParts) {
  const payload = concat(payloadParts);
  const out = new Uint8Array(8 + payload.byteLength);
  setU32(out, 0, out.byteLength);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

/** Liste les boîtes enfants d'un conteneur : [{ type, start, end, payloadStart }]. */
function children(buf, start, end) {
  const out = [];
  let off = start;
  while (off + 8 <= end) {
    let size = u32(buf, off);
    let header = 8;
    if (size === 1) { size = u64(buf, off + 8); header = 16; }
    if (size === 0) size = end - off;
    if (size < header || off + size > end) throw new Error(`Boîte MP4 invalide (${boxType(buf, off)}) : taille ${size}`);
    out.push({ type: boxType(buf, off), start: off, end: off + size, payloadStart: off + header });
    off += size;
  }
  return out;
}

const findChild = (buf, box, type) => children(buf, box.payloadStart, box.end).find((c) => c.type === type);

function rootBox(data) {
  const header = u32(data, 0) === 1 ? 16 : 8;
  return { type: boxType(data, 0), start: 0, end: data.byteLength, payloadStart: header };
}

// ---------------------------------------------------------------------------
// Lecture séquentielle des boîtes depuis une source d'octets asynchrone.
// ---------------------------------------------------------------------------

class ByteQueue {
  constructor(iterator) {
    this.iterator = iterator;
    this.chunks = [];
    this.length = 0;
    this.done = false;
  }

  async ensure(n) {
    while (this.length < n && !this.done) {
      const { value, done } = await this.iterator.next();
      if (done) { this.done = true; break; }
      if (value && value.byteLength) { this.chunks.push(value); this.length += value.byteLength; }
    }
    return this.length >= n;
  }

  take(n) {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const c = this.chunks[0];
      const want = n - off;
      if (c.byteLength <= want) {
        out.set(c, off); off += c.byteLength; this.chunks.shift();
      } else {
        out.set(c.subarray(0, want), off); this.chunks[0] = c.subarray(want); off += want;
      }
    }
    this.length -= n;
    return out;
  }
}

export class BoxReader {
  constructor(iterable) {
    this.queue = new ByteQueue(iterable[Symbol.asyncIterator] ? iterable[Symbol.asyncIterator]() : iterable);
  }

  /** Boîte suivante ({ type, data }) ou null en fin de flux. */
  async next() {
    const q = this.queue;
    if (!(await q.ensure(8))) {
      if (q.length === 0) return null;
      throw new Error('Flux MP4 tronqué (en-tête de boîte incomplet).');
    }
    // On lit l'en-tête sans le consommer pour connaître la taille totale.
    const head = q.take(8);
    let size = u32(head, 0);
    const type = boxType(head, 0);
    let header = head;
    if (size === 1) {
      if (!(await q.ensure(8))) throw new Error('Flux MP4 tronqué (taille étendue).');
      const ext = q.take(8);
      header = concat([head, ext]);
      size = u64(ext, 0);
    }
    if (size === 0) throw new Error('Boîte MP4 de taille indéterminée non prise en charge.');
    const rest = size - header.byteLength;
    if (rest < 0) throw new Error(`Boîte MP4 invalide (${type}).`);
    if (!(await q.ensure(rest))) throw new Error(`Flux MP4 tronqué dans la boîte ${type}.`);
    return { type, data: concat([header, q.take(rest)]) };
  }
}

// ---------------------------------------------------------------------------
// Analyse et retouche des boîtes.
// ---------------------------------------------------------------------------

function trackInfo(moov) {
  const root = rootBox(moov);
  const trak = findChild(moov, root, 'trak');
  if (!trak) throw new Error('Piste (trak) introuvable dans l\'en-tête.');
  const mdia = findChild(moov, trak, 'mdia');
  const mdhd = mdia && findChild(moov, mdia, 'mdhd');
  if (!mdhd) throw new Error('Boîte mdhd introuvable.');
  const version = moov[mdhd.payloadStart];
  const timescale = u32(moov, mdhd.payloadStart + 4 + (version === 1 ? 16 : 8));
  return { trak, timescale };
}

/** Remplace l'identifiant de piste dans une copie de trak (tkhd) ou de trex. */
function retagTrack(moov, box, newId) {
  const copy = moov.slice(box.start, box.end);
  const local = rootBox(copy);
  if (local.type === 'trak') {
    const tkhd = findChild(copy, local, 'tkhd');
    if (!tkhd) throw new Error('Boîte tkhd introuvable.');
    const version = copy[tkhd.payloadStart];
    setU32(copy, tkhd.payloadStart + 4 + (version === 1 ? 16 : 8), newId);
  } else if (local.type === 'trex') {
    setU32(copy, local.payloadStart + 4, newId);
  }
  return copy;
}

/** Construit le moov fusionné : pistes vidéo (1) et audio (2). */
function mergeMoov(videoMoov, audioMoov) {
  const vRoot = rootBox(videoMoov);
  const aRoot = rootBox(audioMoov);
  const vKids = children(videoMoov, vRoot.payloadStart, vRoot.end);
  const aKids = children(audioMoov, aRoot.payloadStart, aRoot.end);

  const vMvhd = vKids.find((c) => c.type === 'mvhd');
  const vMvex = vKids.find((c) => c.type === 'mvex');
  const vTrak = vKids.find((c) => c.type === 'trak');
  const aTrak = aKids.find((c) => c.type === 'trak');
  const aMvex = aKids.find((c) => c.type === 'mvex');
  if (!vMvhd || !vTrak || !aTrak) throw new Error('En-tête MP4 incomplet (mvhd/trak).');

  // mvhd : next_track_ID = 3
  const mvhd = videoMoov.slice(vMvhd.start, vMvhd.end);
  const mvhdVersion = mvhd[8];
  setU32(mvhd, 8 + (mvhdVersion === 1 ? 108 : 96), 3);

  // mvex : trex vidéo (inchangé) + trex audio (piste 2)
  const mvexParts = [];
  if (vMvex) for (const c of children(videoMoov, vMvex.payloadStart, vMvex.end)) mvexParts.push(videoMoov.slice(c.start, c.end));
  if (aMvex) {
    const aTrex = findChild(audioMoov, aMvex, 'trex');
    if (aTrex) mvexParts.push(retagTrack(audioMoov, aTrex, 2));
  }
  const mvex = makeBox('mvex', mvexParts);

  const vTrakCopy = retagTrack(videoMoov, vTrak, 1);
  const aTrakCopy = retagTrack(audioMoov, aTrak, 2);

  const others = vKids
    .filter((c) => !['mvhd', 'mvex', 'trak'].includes(c.type))
    .map((c) => videoMoov.slice(c.start, c.end));

  return makeBox('moov', [mvhd, mvex, vTrakCopy, aTrakCopy, ...others]);
}

/** Renumérote un fragment (moof) : séquence et identifiant de piste. Retourne son instant de début. */
function patchMoof(moof, trackId, sequence, timescale) {
  const root = rootBox(moof);
  let startTime = 0;
  for (const c of children(moof, root.payloadStart, root.end)) {
    if (c.type === 'mfhd') {
      setU32(moof, c.payloadStart + 4, sequence);
    } else if (c.type === 'traf') {
      for (const t of children(moof, c.payloadStart, c.end)) {
        if (t.type === 'tfhd') setU32(moof, t.payloadStart + 4, trackId);
        if (t.type === 'tfdt') {
          const version = moof[t.payloadStart];
          const base = version === 1 ? u64(moof, t.payloadStart + 4) : u32(moof, t.payloadStart + 4);
          startTime = base / timescale;
        }
      }
    }
  }
  return startTime;
}

// ---------------------------------------------------------------------------
// Lecture d'un flux : en-tête puis fragments.
// ---------------------------------------------------------------------------

/** Lit ftyp + moov ; renvoie aussi la première boîte hors en-tête (souvent moof). */
async function readInit(reader) {
  let ftyp = null;
  let moov = null;
  while (true) {
    const box = await reader.next();
    if (!box) throw new Error('Flux terminé avant la fin de l\'en-tête MP4.');
    if (box.type === 'ftyp') ftyp = box.data;
    else if (box.type === 'moov') moov = box.data;
    else if (box.type === 'moof' || box.type === 'mdat') {
      if (!moov) throw new Error('Fragment rencontré avant l\'en-tête moov.');
      return { ftyp, moov, pending: box };
    }
    // sidx, styp, free… : ignorés.
  }
}

/** Lit le fragment suivant : { moof, mdat } ou null en fin de flux. */
async function readFragment(reader, state) {
  let moof = null;
  while (true) {
    const box = state.pending || (await reader.next());
    state.pending = null;
    if (!box) {
      if (moof) throw new Error('Fragment sans données (moof sans mdat).');
      return null;
    }
    if (box.type === 'moof') moof = box.data;
    else if (box.type === 'mdat') {
      if (!moof) continue; // mdat orphelin : ignoré
      return { moof, mdat: box.data };
    }
    // sidx, styp, prft… : ignorés.
  }
}

// ---------------------------------------------------------------------------
// Fusion.
// ---------------------------------------------------------------------------

/**
 * Fusionne deux flux fMP4 (vidéo puis audio) en un MP4 à deux pistes.
 * @param {Object} opts
 * @param {AsyncIterable<Uint8Array>} opts.video  octets du flux vidéo
 * @param {AsyncIterable<Uint8Array>} opts.audio  octets du flux audio
 * @param {(data: Uint8Array) => Promise<void>|void} opts.write  écriture séquentielle
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ fragments: number, bytesWritten: number }>}
 */
export async function muxFmp4({ video, audio, write, signal }) {
  const vr = new BoxReader(video);
  const ar = new BoxReader(audio);

  const vInit = await readInit(vr);
  const aInit = await readInit(ar);
  const vTrack = trackInfo(vInit.moov);
  const aTrack = trackInfo(aInit.moov);

  let bytesWritten = 0;
  const out = async (data) => { await write(data); bytesWritten += data.byteLength; };

  // ftyp standard (les flux YouTube portent la marque "dash", que certains
  // lecteurs de bureau n'aiment pas) : isom / iso6 / avc1 / mp41.
  await out(makeBox('ftyp', [ascii('isom'), new Uint8Array([0, 0, 2, 0]), ascii('isom'), ascii('iso6'), ascii('avc1'), ascii('mp41')]));
  await out(mergeMoov(vInit.moov, aInit.moov));

  const vState = { pending: vInit.pending };
  const aState = { pending: aInit.pending };
  let vFrag = await readFragment(vr, vState);
  let aFrag = await readFragment(ar, aState);
  let sequence = 1;
  let fragments = 0;

  const timeOf = (frag, ts) => {
    // tfdt est lu sans modifier la séquence : on passe un identifiant factice puis on repatche à l'écriture.
    const root = rootBox(frag.moof);
    for (const c of children(frag.moof, root.payloadStart, root.end)) {
      if (c.type !== 'traf') continue;
      const tfdt = findChild(frag.moof, c, 'tfdt');
      if (!tfdt) return 0;
      const version = frag.moof[tfdt.payloadStart];
      return (version === 1 ? u64(frag.moof, tfdt.payloadStart + 4) : u32(frag.moof, tfdt.payloadStart + 4)) / ts;
    }
    return 0;
  };

  while (vFrag || aFrag) {
    if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    let pickVideo;
    if (vFrag && aFrag) pickVideo = timeOf(vFrag, vTrack.timescale) <= timeOf(aFrag, aTrack.timescale);
    else pickVideo = !!vFrag;

    const frag = pickVideo ? vFrag : aFrag;
    patchMoof(frag.moof, pickVideo ? 1 : 2, sequence++, pickVideo ? vTrack.timescale : aTrack.timescale);
    await out(frag.moof);
    await out(frag.mdat);
    fragments++;

    if (pickVideo) vFrag = await readFragment(vr, vState);
    else aFrag = await readFragment(ar, aState);
  }

  return { fragments, bytesWritten };
}

// ---------------------------------------------------------------------------
// Source HTTP lue par requêtes Range successives (avec préchargement).
// ---------------------------------------------------------------------------

/**
 * Itère sur le contenu d'une URL par morceaux Range, en préchargeant le
 * morceau suivant pendant que le précédent est consommé.
 * @param {string} url
 * @param {number} size  taille totale en octets
 * @param {Object} [opts]
 * @param {number} [opts.chunkSize]
 * @param {number} [opts.retries]
 * @param {AbortSignal} [opts.signal]
 * @param {(bytes: number) => void} [opts.onBytes]  appelé à chaque morceau reçu
 * @param {typeof fetch} [opts.fetchFn]
 */
export async function* rangeChunks(url, size, opts = {}) {
  const chunkSize = opts.chunkSize || 32 * 1024 * 1024;
  const retries = opts.retries ?? 6;
  const fetchFn = opts.fetchFn || fetch;
  const signal = opts.signal;

  async function fetchRange(start) {
    const end = Math.min(size, start + chunkSize) - 1;
    const expected = end - start + 1;
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
      try {
        const r = await fetchFn(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
        if (r.status !== 206 && r.status !== 200) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Le serveur a répondu ${r.status}.`);
        }
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.byteLength !== expected) throw new Error(`Morceau incomplet (${buf.byteLength} octets sur ${expected}).`);
        return buf;
      } catch (err) {
        if (err.name === 'AbortError' || attempt >= retries) throw err;
        await new Promise((res) => setTimeout(res, 800 * Math.pow(1.7, attempt)));
      }
    }
  }

  let next = 0;
  let pending = size > 0 ? fetchRange(0) : null;
  while (pending) {
    const current = pending;
    next += chunkSize;
    pending = next < size ? fetchRange(next) : null;
    if (pending) pending.catch(() => {}); // évite un rejet non géré si on s'arrête avant
    const data = await current;
    opts.onBytes?.(data.byteLength);
    yield data;
  }
}
