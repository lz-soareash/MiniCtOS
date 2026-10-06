'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { CTOS, TICK_MS } = require('./simulation');

const PORT = process.env.PORT || 3000;
const ctos = new CTOS();
const clients = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function broadcast(state) {
  const msg = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    if (!res.write(msg)) {
      // backpressure: cliente lento demais → remove
      res.destroy();
      clients.delete(res);
    }
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, 'public', urlPath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(ctos.snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/state' && req.method === 'GET') return json(res, 200, ctos.snapshot());

  if (p === '/api/light' && req.method === 'POST') {
    const b = await readBody(req);
    return json(res, 200, ctos.setLight(b.id, b.mode));
  }

  if (p === '/api/lights/all' && req.method === 'POST') {
    const b = await readBody(req);
    const results = ctos.lights.map((l) => ctos.setLight(l.id, b.mode));
    return json(res, 200, { ok: results.every((r) => r.ok), count: results.length });
  }

  if (p === '/api/lights/line' && req.method === 'POST') {
    const b = await readBody(req);
    return json(res, 200, ctos.setLightLine(b.axis, Number(b.index), b.mode));
  }

  if (p === '/api/weather' && req.method === 'POST') {
    const b = await readBody(req);
    return json(res, 200, ctos.setWeather(b.kind));
  }

  if (p === '/api/health' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      uptime: process.uptime(),
      tick: ctos.tick,
      clients: clients.size,
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    });
  }

  if (p === '/api/substation' && req.method === 'POST') {
    const b = await readBody(req);
    return json(res, 200, ctos.setSubstation(b.id, b.online));
  }

  if (p === '/api/camera' && req.method === 'POST') {
    const b = await readBody(req);
    return json(res, 200, ctos.setCamera(b.id, b));
  }

  if (p === '/api/event' && req.method === 'POST') {
    const b = await readBody(req);
    return json(res, 200, ctos.triggerEvent(b.kind));
  }

  if (p === '/api/reset' && req.method === 'POST') {
    Object.assign(ctos, new CTOS());
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET') return serveStatic(req, res);
  json(res, 404, { ok: false, error: 'rota não encontrada' });
});

setInterval(() => {
  const state = ctos.step();
  broadcast(state);
}, TICK_MS);

// heartbeat SSE — mantém conexões vivas atrás de proxies
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

// remove clientes desconectados silenciosamente
setInterval(() => {
  for (const res of clients) {
    if (res.destroyed) clients.delete(res);
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`ctOS online → http://localhost:${PORT}`);
});
