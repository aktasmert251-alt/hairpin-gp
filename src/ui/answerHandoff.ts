// D-064 answer links: the page a host lands on after tapping the guest's `#answer=HP1A.…` link. It hands the answer code to the
// room tab of this browser over a BroadcastChannel (nothing to paste) and says what happened. When no room tab answers (the link
// was opened in another browser or app), it shows the code with a copy button so it can still be pasted by hand.
// The game itself is not started in this tab.
import { P2P_HANDOFF_CHANNEL, type HandoffMsg } from '../net/index';
import type { TFn } from './format';

/** How long to wait for the room tab before falling back to copy & paste. */
const WAIT_MS = 2500;

type Outcome = { ok: true } | { ok: false; error: string | null } | null;

function handOver(code: string): Promise<Outcome> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(null);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const ch = new BroadcastChannel(P2P_HANDOFF_CHANNEL);
  return new Promise<Outcome>((resolve) => {
    let failed: Outcome = null;
    const done = (o: Outcome): void => {
      clearTimeout(timer);
      ch.close();
      resolve(o);
    };
    const timer = setTimeout(() => done(failed), WAIT_MS);
    ch.onmessage = (ev: MessageEvent) => {
      const m = ev.data as HandoffMsg;
      if (!m || m.t !== 'ack' || m.id !== id) return;
      if (m.ok) done({ ok: true });
      else failed = { ok: false, error: m.error };
    };
    ch.postMessage({ t: 'answer', id, code } satisfies HandoffMsg);
  });
}

export async function runAnswerHandoff(code: string, t: TFn, root: HTMLElement = document.body): Promise<void> {
  const box = document.createElement('main');
  box.className = 'apx-handoff';
  box.setAttribute('role', 'status');
  Object.assign(box.style, {
    position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px',
    padding: '24px', background: '#0b0d12', color: '#f2f2f2', font: '16px/1.5 system-ui, sans-serif', textAlign: 'center', zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);
  const title = document.createElement('h1');
  title.textContent = t('p2p.handoff.title');
  title.style.margin = '0';
  const status = document.createElement('p');
  status.style.maxWidth = '640px';
  status.textContent = t('p2p.handoff.sending');
  box.append(title, status);
  root.append(box);

  const res = await handOver(code);
  if (res?.ok) {
    status.textContent = t('p2p.handoff.ok');
    return;
  }
  status.textContent = res && res.error ? t('p2p.handoff.failed', { error: t(`p2p.error.${res.error}`, { detail: '-' }) }) : t('p2p.handoff.notFound');
  const area = document.createElement('textarea');
  area.readOnly = true;
  area.value = code;
  area.rows = 6;
  Object.assign(area.style, { width: 'min(640px, 100%)', background: '#151922', color: '#f2f2f2', border: '1px solid #3a4150', padding: '8px', font: '12px/1.4 monospace' } satisfies Partial<CSSStyleDeclaration>);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = t('p2p.handoff.copy');
  Object.assign(copy.style, { padding: '12px 20px', font: 'inherit', fontWeight: '700', background: '#ff5a1f', color: '#0b0d12', border: '0', cursor: 'pointer' } satisfies Partial<CSSStyleDeclaration>);
  copy.addEventListener('click', () => {
    const fallback = (): void => { area.focus(); area.select(); };
    if (!navigator.clipboard) { fallback(); return; }
    void navigator.clipboard.writeText(code).then(() => { copy.textContent = t('p2p.handoff.copied'); }, fallback);
  });
  const open = document.createElement('a');
  open.href = `${location.pathname}${location.search}`;
  open.textContent = t('p2p.handoff.open');
  open.style.color = '#ff8a5c';
  box.append(area, copy, open);
}
