// HAIRPIN GP admin panel (D-050). Plain module, same-origin fetches only. Every value from the server is written with
// textContent (nicknames are player input), never innerHTML.
const $ = (id) => document.getElementById(id);
let csrf = '';
let timer = 0;
let maintenance = false;
/** Ban duration / network choice per NetId, kept across the 2 s re-render. */
const choice = new Map();

const CHEAT = new Set(['strike', 'strikeMute', 'hardViolation', 'lapRejected', 'badMessage', 'wsFlood', 'helloBanned', 'kick']);
const DURATIONS = [['1h', '1 sa'], ['24h', '24 sa'], ['7d', '7 gün'], ['perm', 'Kalıcı']];

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined && text !== null) e.textContent = String(text);
  if (cls) e.className = cls;
  return e;
}

function row(cells) {
  const tr = document.createElement('tr');
  for (const c of cells) {
    const td = document.createElement('td');
    if (c instanceof Node) td.append(c);
    else td.textContent = c === null || c === undefined ? '—' : String(c);
    tr.append(td);
  }
  return tr;
}

function emptyRow(tbody, cols, text) {
  const td = el('td', text, 'muted');
  td.colSpan = cols;
  const tr = document.createElement('tr');
  tr.append(td);
  tbody.append(tr);
}

function toast(text, bad) {
  const t = $('toast');
  t.textContent = text;
  t.className = bad ? 'toast bad' : 'toast';
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3000);
}

async function api(route, body) {
  const init = body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) };
  const res = await fetch('/admin/api/' + route, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && route !== 'login') showLogin('Oturum sona erdi. Tekrar giriş yapın.');
  return { status: res.status, data };
}

function showLogin(msg) {
  clearInterval(timer);
  csrf = '';
  $('app').hidden = true;
  $('login').hidden = false;
  $('loginMsg').textContent = msg || '';
  $('pw').focus();
}

function showApp(session) {
  csrf = session.csrf;
  $('login').hidden = true;
  $('app').hidden = false;
  refresh();
  refreshInbox();
  clearInterval(timer);
  timer = setInterval(refresh, 2000);
}

const fmtTime = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour12: false });
const fmtDate = (ms) => new Date(ms).toLocaleString('tr-TR', { hour12: false });
const fmtBytes = (b) => (b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B');
const fmtMin = (s) => Math.max(0, Math.floor(s / 60)) + ' dk';

function tiles(h) {
  const list = [
    ['CPU', h.cpuPct + ' %', h.cpuPct > 70],
    ['RSS', h.rssMb + ' MB', h.rssMb > 400],
    ['Gecikme p99', h.lagP99Ms + ' ms', h.lagP99Ms > 20],
    ['Soket', h.sockets],
    ['Mesaj/s', h.msgInPerS + ' ↓ / ' + h.msgOutPerS + ' ↑'],
    ['Çıkış', fmtBytes(h.bytesOutPerS) + '/s'],
    ['Sertifika', h.certDaysLeft === null ? 'yok (HTTP)' : h.certDaysLeft + ' gün', h.certDaysLeft !== null && h.certDaysLeft < 10],
    ['Çalışma', Math.floor(h.uptimeS / 3600) + ' sa ' + Math.floor((h.uptimeS % 3600) / 60) + ' dk'],
  ];
  const box = $('tiles');
  box.replaceChildren(...list.map(([k, v, warn]) => {
    const d = el('div', null, warn ? 'tile warn' : 'tile');
    d.append(el('span', k, 'tile-k'), el('strong', v, 'tile-v'));
    return d;
  }));
}

function actions(p) {
  const wrap = el('div', null, 'actions');
  const kick = el('button', 'At', 'small ghost');
  kick.addEventListener('click', async () => {
    if (!confirm(p.name + ' oyundan atılsın mı?')) return;
    const r = await api('kick', { id: p.id });
    toast(r.status === 200 ? p.name + ' atıldı' : 'Hata: ' + (r.data.error || r.status), r.status !== 200);
    refresh();
  });
  const sel = el('select', null, 'small');
  for (const [v, t] of DURATIONS) {
    const o = el('option', t);
    o.value = v;
    sel.append(o);
  }
  const c = choice.get(p.id) || { dur: '1h', net: true };
  sel.value = c.dur;
  const netLabel = el('label', null, 'chk');
  const net = document.createElement('input');
  net.type = 'checkbox';
  net.checked = c.net;
  const keep = () => choice.set(p.id, { dur: sel.value, net: net.checked });
  sel.addEventListener('change', keep);
  net.addEventListener('change', keep);
  netLabel.append(net, document.createTextNode('ağ'));
  netLabel.title = 'Aynı /24 ağını da yasakla (LAN partisinde kapatın)';
  const ban = el('button', 'Yasakla', 'small danger');
  ban.addEventListener('click', async () => {
    const reason = prompt(p.name + ' yasaklanıyor (' + sel.options[sel.selectedIndex].text + '). Neden?', '');
    if (reason === null) return;
    const r = await api('ban', { id: p.id, duration: sel.value, network: net.checked, reason });
    toast(r.status === 200 ? p.name + ' yasaklandı' : 'Hata: ' + (r.data.error || r.status), r.status !== 200);
    refresh();
  });
  wrap.append(kick, sel, netLabel, ban);
  return wrap;
}

function render(s) {
  tiles(s.health);
  maintenance = s.maintenance;
  $('maintBadge').hidden = !maintenance;
  const mt = $('maintToggle');
  mt.textContent = maintenance ? 'Bakımı kapat' : 'Bakımı aç';
  mt.className = maintenance ? 'danger' : '';
  $('noticeNow').textContent = s.notice ? 'Etkin duyuru (' + fmtTime(s.notice.at) + '): ' + s.notice.text : 'Etkin duyuru yok.';
  $('sessionLeft').textContent = 'Oturum: ' + fmtMin(Math.min(s.session.idleLeftS, s.session.maxLeftS));

  const rooms = $('rooms');
  rooms.replaceChildren();
  for (const r of s.rooms) rooms.append(row([el('code', r.code), r.phase, r.track, r.laps, r.humans, r.ai, r.simCpuPct + ' %']));
  if (!s.rooms.length) emptyRow(rooms, 7, 'Açık oda yok');
  $('roomCount').textContent = s.rooms.length;

  const players = $('players');
  players.replaceChildren();
  for (const p of s.players) {
    const conn = el('span', p.connected ? (p.stale ? 'bayat' : 'bağlı') : 'kopuk', p.connected ? (p.stale ? 'badge warn' : 'badge ok') : 'badge bad');
    players.append(row([el('strong', p.name), p.id, p.room, p.pingMs + ' ms', conn, p.strikes, p.violations, p.device ? el('code', p.device) : '—', actions(p)]));
  }
  if (!s.players.length) emptyRow(players, 9, 'Bağlı oyuncu yok');
  $('playerCount').textContent = s.players.length;

  const bans = $('bans');
  bans.replaceChildren();
  for (const b of s.bans) {
    const un = el('button', 'Kaldır', 'small ghost');
    un.addEventListener('click', async () => {
      if (!confirm(b.name + ' yasağı kaldırılsın mı?')) return;
      const r = await api('unban', { banId: b.id });
      toast(r.status === 200 ? 'Yasak kaldırıldı' : 'Hata: ' + (r.data.error || r.status), r.status !== 200);
      refresh();
    });
    const keys = [b.device ? 'cihaz' : '', b.token ? 'oturum' : '', b.network ? 'ağ' : ''].filter(Boolean).join(' + ');
    bans.append(row([b.name, b.reason || '—', b.expiresAt === null ? 'kalıcı' : fmtDate(b.expiresAt), keys, un]));
  }
  if (!s.bans.length) emptyRow(bans, 5, 'Yasak yok');
  $('banCount').textContent = s.bans.length;

  const ev = $('events');
  ev.replaceChildren(...s.events.map((e) => {
    const li = el('li', null, CHEAT.has(e.event) ? 'cheat' : '');
    const data = JSON.stringify(e.data);
    li.append(el('time', fmtTime(e.t)), el('b', e.event), el('span', data === '{}' ? '' : data.length > 120 ? data.slice(0, 117) + '…' : data));
    return li;
  }));
}

async function refresh() {
  const r = await api('state');
  if (r.status === 200) render(r.data);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginMsg').textContent = '';
  const r = await api('login', { password: $('pw').value, code: $('code').value });
  $('pw').value = '';
  $('code').value = '';
  if (r.status === 200) return showApp(r.data);
  const msg = {
    invalid: 'Parola veya kod hatalı.',
    locked: 'Çok fazla deneme. ' + (r.data.retryS || '') + ' sn sonra tekrar deneyin.',
    busy: 'Sunucu meşgul, bir saniye sonra deneyin.',
    notConfigured: 'Yönetici hesabı kurulmamış (admin-setup.sh).',
  }[r.data.error];
  $('loginMsg').textContent = msg || 'Giriş başarısız (' + r.status + ').';
});

$('logout').addEventListener('click', async () => {
  await api('logout', {});
  showLogin('Çıkış yapıldı.');
});

$('maintToggle').addEventListener('click', async () => {
  const on = !maintenance;
  if (on && !confirm('Bakım modu açılsın mı? Yeni oda ve katılım reddedilecek.')) return;
  const r = await api('maintenance', { on });
  toast(r.status === 200 ? (on ? 'Bakım modu açık' : 'Bakım modu kapalı') : 'Hata', r.status !== 200);
  refresh();
});

$('noticeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api('notice', { text: $('noticeText').value });
  toast(r.status === 200 ? 'Duyuru kaydedildi' : 'Hata: ' + (r.data.error || r.status), r.status !== 200);
  if (r.status === 200) $('noticeText').value = '';
  refresh();
});

$('noticeClear').addEventListener('click', async () => {
  await api('notice', { text: '' });
  refresh();
});

(async () => {
  const r = await api('session');
  if (r.status === 200) showApp(r.data);
  else showLogin('');
})();

const inboxStrings = {
  // Labels remain local to the standalone admin panel's TR/EN dictionaries.
  tr: { title: 'Gelen kutusu', note: 'Mesajlar yanıtlanmaz. 30 gün sonra otomatik silinir.', type: 'Tür', status: 'Durum', all: 'Tümü', refresh: 'Yenile', empty: 'Mesaj yok.', error: 'Gelen kutusu yüklenemedi.', readAction: 'Okundu işaretle', archive: 'Arşivle', delete: 'Sil', confirm: 'Mesaj kalıcı olarak silinsin mi?', bug: 'Hata', suggestion: 'Öneri', complaint: 'Şikâyet', other: 'Diğer', new: 'Yeni', read: 'Okundu', archived: 'Arşivlendi' },
  en: { title: 'Inbox', note: 'Messages are not answered. Automatically deleted after 30 days.', type: 'Type', status: 'Status', all: 'All', refresh: 'Refresh', empty: 'No messages.', error: 'Could not load inbox.', readAction: 'Mark read', archive: 'Archive', delete: 'Delete', confirm: 'Permanently delete this message?', bug: 'Bug', suggestion: 'Suggestion', complaint: 'Complaint', other: 'Other', new: 'New', read: 'Read', archived: 'Archived' },
};
function inboxText() { return inboxStrings[$('inboxLang').value] || inboxStrings.tr; }
const inboxLanguage = { tr: 'Dil', en: 'Language' };
function labelInbox() {
  const t = inboxText();
  $('inboxTitle').textContent = t.title; $('inboxNote').textContent = t.note;
  $('inboxLang').setAttribute('aria-label', inboxLanguage[$('inboxLang').value] || inboxLanguage.tr);
  $('inboxTypeLabel').textContent = t.type; $('inboxStatusLabel').textContent = t.status; $('inboxRefresh').textContent = t.refresh;
  for (const [id, values] of [['inboxType', ['', 'bug', 'suggestion', 'complaint', 'other']], ['inboxStatus', ['', 'new', 'read', 'archived']]]) {
    const sel = $(id), value = sel.value;
    sel.replaceChildren(...values.map((v) => { const o = el('option', v ? t[v] : t.all); o.value = v; return o; })); sel.value = value;
  }
}
async function refreshInbox() {
  labelInbox();
  const t = inboxText();
  try {
    const q = new URLSearchParams({ type: $('inboxType').value, status: $('inboxStatus').value });
    const r = await api('inbox?' + q);
    if (r.status !== 200) throw new Error('inbox');
    $('inboxError').textContent = '';
    const box = $('inboxMessages'); box.replaceChildren();
    if (!r.data.messages.length) box.append(el('p', t.empty, 'muted'));
    for (const m of r.data.messages) {
      const card = el('article', null, 'contact-message');
      card.append(el('h3', t[m.type] + ' · ' + t[m.status]), el('time', fmtDate(m.createdAt)));
      if (m.nickname || m.roomCode) card.append(el('p', [m.nickname, m.roomCode].filter(Boolean).join(' · ')));
      card.append(el('p', m.message, 'contact-body'));
      const actions = el('div', null, 'actions');
      for (const [status, label] of [['read', t.readAction], ['archived', t.archive], ['delete', t.delete]]) {
        const b = el('button', label, 'small ghost'); b.disabled = m.status === status;
        b.addEventListener('click', async () => {
          if (status === 'delete' && !confirm(t.confirm)) return;
          try { const r = await api('contact', { id: m.id, status }); if (r.status !== 200) throw new Error('action'); await refreshInbox(); }
          catch { $('inboxError').textContent = t.error; }
        }); actions.append(b);
      }
      card.append(actions); box.append(card);
    }
  } catch { $('inboxError').textContent = t.error; }
}
for (const id of ['inboxType', 'inboxStatus', 'inboxLang']) $(id).addEventListener('change', refreshInbox);
$('inboxRefresh').addEventListener('click', refreshInbox);
