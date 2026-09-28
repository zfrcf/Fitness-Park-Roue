// Test de la fusion vidéo + audio : télécharge deux flux fMP4 via l'API
// (production par défaut), les fusionne avec public/js/mux.js, puis vérifie
// le résultat avec ffmpeg si le chemin FFMPEG est fourni.
// Usage : BASE_URL=https://… FFMPEG=/chemin/ffmpeg node test/mux-test.mjs

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { muxFmp4, rangeChunks } from '../public/js/mux.js';

const base = process.env.BASE_URL || 'https://telechargeur-youtube.vercel.app';
const id = process.env.TEST_VIDEO || 'dQw4w9WgXcQ';
const out = process.env.OUT || '/tmp/mux-test.mp4';

const info = await (await fetch(`${base}/api/info?url=${id}`)).json();
if (!info.formats) throw new Error(info.error);
const video = info.formats.filter((f) => f.kind === 'video' && f.container === 'mp4' && f.codecs.startsWith('avc1')).sort((a, b) => a.height - b.height).find((f) => f.height >= 720) || info.formats.find((f) => f.kind === 'video' && f.container === 'mp4');
const audio = info.formats.find((f) => f.kind === 'audio' && f.itag === 140) || info.formats.find((f) => f.kind === 'audio' && f.container === 'm4a');
console.log(`vidéo itag ${video.itag} ${video.quality} (${video.size} o) + audio itag ${audio.itag} (${audio.size} o)`);

const url = (f) => `${base}/api/download?id=${id}&itag=${f.itag}&client=${f.client}`;
let read = 0;
const total = video.size + audio.size;
const onBytes = (n) => { read += n; process.stdout.write(`\r  lecture ${((read / total) * 100).toFixed(0)} %`); };

const fd = fs.openSync(out, 'w');
const t0 = Date.now();
const result = await muxFmp4({
  video: rangeChunks(url(video), video.size, { chunkSize: 8 * 1024 * 1024, onBytes }),
  audio: rangeChunks(url(audio), audio.size, { chunkSize: 8 * 1024 * 1024, onBytes }),
  write: (data) => { fs.writeSync(fd, data); },
});
fs.closeSync(fd);
console.log(`\n✔ fusion : ${result.fragments} fragments, ${result.bytesWritten} octets écrits en ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${out}`);
if (Math.abs(result.bytesWritten - total) > 1_000_000) throw new Error('Taille de sortie incohérente');

if (process.env.FFMPEG) {
  const run = (args) => {
    try { return execFileSync(process.env.FFMPEG, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return e.stderr?.toString() || e.message; } // ffmpeg -i sans sortie termine en erreur : normal
  };
  const description = run(['-hide_banner', '-i', out]);
  const streams = description.split('\n').filter((l) => l.includes('Stream #') || l.includes('Duration') || l.includes('major_brand'));
  console.log(streams.join('\n'));
  if (!/Stream #0:0.*Video/.test(description) || !/Stream #0:1.*Audio/.test(description)) throw new Error('Le fichier fusionné ne contient pas deux pistes');
  const errors = run(['-v', 'error', '-i', out, '-f', 'null', '-']).trim();
  if (errors) throw new Error('Erreurs de décodage :\n' + errors);
  console.log('✔ décodage complet sans erreur');
}
