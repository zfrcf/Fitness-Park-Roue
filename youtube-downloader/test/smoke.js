// Tests de fumée : extraction d'identifiants (hors ligne) puis, si le réseau
// le permet, résolution d'une vidéo et lecture d'un morceau via l'API locale.
// Usage : node test/smoke.js [--online]

import assert from 'node:assert/strict';
import { extractVideoId } from '../lib/yt.js';

const cases = [
  ['https://www.youtube.com/live/Jr_EcIG_gAM?si=JhwpAnFIw7snWllB', 'Jr_EcIG_gAM'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123', 'dQw4w9WgXcQ'],
  ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
  ['youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/shorts/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
  ['https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1', 'aqz-KE-bpKQ'],
  ['https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
  ['https://www.youtube.com/v/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
  ['https://www.youtube.com/attribution_link?a=x&u=%2Fwatch%3Fv%3DdQw4w9WgXcQ%26feature%3Dshare', 'dQw4w9WgXcQ'],
  ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/playlist?list=PL123', null],
  ['https://vimeo.com/12345', null],
  ['pas un lien', null],
  ['', null],
];

for (const [input, expected] of cases) {
  assert.equal(extractVideoId(input), expected, `extractVideoId(${JSON.stringify(input)})`);
}
console.log(`✔ ${cases.length} cas d'extraction d'identifiant OK`);

if (process.argv.includes('--online')) {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  const id = process.env.TEST_VIDEO || 'Jr_EcIG_gAM';
  const t0 = Date.now();
  const r = await fetch(`${base}/api/info?url=${encodeURIComponent(`https://www.youtube.com/live/${id}?si=x`)}`);
  const info = await r.json();
  console.log(`/api/info -> ${r.status} en ${Date.now() - t0} ms :`, info.title || info.error, '| formats :', info.formats?.length);
  assert.equal(r.status, 200, info.error);
  assert.ok(info.formats.length > 0);

  const f = info.formats.find((x) => x.kind === 'audio') || info.formats[0];
  const t1 = Date.now();
  const d = await fetch(`${base}/api/download?id=${id}&itag=${f.itag}&client=${f.client}&title=test`, { headers: { Range: 'bytes=0-1048575' } });
  const buf = await d.arrayBuffer();
  console.log(`/api/download (1 Mo, itag ${f.itag}) -> ${d.status} en ${Date.now() - t1} ms, ${buf.byteLength} octets, Content-Range=${d.headers.get('content-range')}, Disposition=${d.headers.get('content-disposition')}`);
  assert.equal(d.status, 206);
  assert.equal(buf.byteLength, 1048576);
  console.log('✔ tests en ligne OK');
}
