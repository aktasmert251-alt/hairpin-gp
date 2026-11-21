// Local-only visual fixture. Never imported by the application or deployment bundle.
import http from 'node:http';
import fs from 'node:fs';
const root = new URL('../../server/src/admin/panel/', import.meta.url);
const now = Date.now();
const messages = [
  { id: 'sample-1', type: 'bug', status: 'new', message: 'Yarış sonu ekranında tur sürem görünmedi.\nPist: Boğaz Sahil.', createdAt: now - 120000 },
  { id: 'sample-2', type: 'suggestion', status: 'read', message: 'Klavye düzenlerini ana menüden karşılaştırabilmek isterim.', createdAt: now - 3600000 },
  { id: 'sample-3', type: 'complaint', status: 'archived', nickname: 'Deniz', roomCode: 'ABCDE', message: 'Odadaki bir oyuncu başlangıçta yolu kapattı.\n<script>Bu metin düz yazı olarak kalır.</script>', createdAt: now - 7200000 },
];
const state = { session: { csrf: 'visual-fixture', idleLeftS: 1800, maxLeftS: 28800 }, health: { cpuPct: 1, rssMb: 64, lagP99Ms: 2, sockets: 0, msgInPerS: 0, msgOutPerS: 0, bytesOutPerS: 0, certDaysLeft: 60, uptimeS: 3600 }, maintenance: false, notice: null, rooms: [], players: [], bans: [], events: [] };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const asset = { '/admin': 'index.html', '/admin/panel.js': 'panel.js', '/admin/panel.css': 'panel.css' }[u.pathname];
  if (asset) { res.setHeader('Content-Type', asset.endsWith('js') ? 'text/javascript' : asset.endsWith('css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(new URL(asset, root))); return; }
  res.setHeader('Content-Type', 'application/json');
  if (u.pathname === '/admin/api/session') res.end(JSON.stringify(state.session));
  else if (u.pathname === '/admin/api/state') res.end(JSON.stringify(state));
  else if (u.pathname === '/admin/api/inbox') res.end(JSON.stringify({ messages: messages.filter((m) => (!u.searchParams.get('type') || m.type === u.searchParams.get('type')) && (!u.searchParams.get('status') || m.status === u.searchParams.get('status'))) }));
  else { res.statusCode = 404; res.end('{}'); }
});
server.listen(8787, '127.0.0.1', () => process.stdout.write('Contact visual fixture: 8787\n'));
