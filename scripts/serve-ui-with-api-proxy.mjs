#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.resolve(process.env.DOUYIN_UI_DIST_DIR || path.join(repoRoot, 'douyin-monitor-ui/dist'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5174);
const apiBase = new URL(process.env.API_BASE || 'http://127.0.0.1:8787');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  const clean = decoded === '/' ? '/index.html' : decoded;
  const target = path.resolve(distDir, `.${clean}`);
  const relative = path.relative(distDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

async function serveStatic(req, res) {
  const target = safeFilePath(req.url || '/');
  const filePath = target && (await stat(target).catch(() => null))?.isFile() ? target : path.join(distDir, 'index.html');
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': contentTypes[ext] || 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
}

function proxyApi(req, res) {
  const upstreamPath = req.url || '/';
  const options = {
    hostname: apiBase.hostname,
    port: apiBase.port || 80,
    path: upstreamPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: apiBase.host,
    },
  };

  const upstream = httpRequest(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (error) => {
    send(res, 502, JSON.stringify({ ok: false, error: error.message }), {
      'content-type': 'application/json; charset=utf-8',
    });
  });

  req.pipe(upstream);
}

await access(path.join(distDir, 'index.html')).catch(() => {
  console.error(`Missing built UI: ${path.join(distDir, 'index.html')}`);
  console.error('Run: cd douyin-monitor-ui && npm run build');
  process.exit(1);
});

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  void serveStatic(req, res).catch((error) => {
    send(res, 500, error instanceof Error ? error.message : String(error), {
      'content-type': 'text/plain; charset=utf-8',
    });
  });
}).listen(port, host, () => {
  console.log(`Douyin monitor UI listening on http://${host}:${port}`);
  console.log(`Proxying /api to ${apiBase.toString().replace(/\/$/, '')}`);
});
