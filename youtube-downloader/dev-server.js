// Serveur de développement local : sert public/ et les fonctions api/*.js
// comme le fait Vercel (handler (req, res)). Usage : npm run dev

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice('/api/'.length).replace(/[^a-zA-Z0-9_-]/g, '');
    const file = path.join(root, 'api', `${name}.js`);
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Fonction introuvable'); }
    try {
      const mod = await import(pathToFileURL(file).href);
      await mod.default(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); }
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  let file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Introuvable'); }
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.listen(port, () => console.log(`Serveur de dev : http://localhost:${port}`));
