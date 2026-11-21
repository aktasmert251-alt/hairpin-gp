import { chromium } from 'playwright';
const URL0 = 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const mk = async (old) => { const c = await b.newContext({ viewport: { width: 1600, height: 900 } }); if (old) await c.addInitScript(() => { delete window.CompressionStream; delete window.DecompressionStream; }); return c.newPage(); };
for (const old of [false, true]) {
  const host = await mk(old), guest = await mk(old);
  const clickId = (p, id) => p.locator(`[data-focus-id="${id}"]`).first().click();
  const toOnline = async (p, mode, name) => { await p.goto(URL0 + '?quality=low&mute=1&p2p=' + mode, { waitUntil: 'networkidle' }); await p.waitForTimeout(4000); await p.keyboard.press('Space'); await p.waitForTimeout(1500); await clickId(p, 'main.online'); await p.waitForTimeout(1200); await p.locator('[data-focus-id="online.name"]').fill(name); };
  await toOnline(host, 'host', 'Host'); await clickId(host, 'online.hostStart'); await host.waitForTimeout(3000);
  await clickId(host, 'lobby.p2pInvites'); await host.waitForTimeout(800); await clickId(host, 'p2p.newInvite');
  let invite=''; for (let i=0;i<40;i++){ invite = await host.locator('#p2p-invite-out').inputValue().catch(()=> ''); if (invite.startsWith('HP1I.')) break; await host.waitForTimeout(500); }
  await toOnline(guest, 'join', 'Guest'); await guest.locator('[data-focus-id="online.invite"]').fill(invite); await guest.waitForTimeout(300); await clickId(guest, 'online.makeAnswer').catch(()=>{});
  let ans=''; for (let i=0;i<40;i++){ ans = await guest.locator('#online-answer').inputValue().catch(()=> ''); if (ans.startsWith('HP1A.')) break; await guest.waitForTimeout(500); }
  await host.locator('#p2p-answer-in').fill(ans); await host.waitForTimeout(500); await clickId(host, 'p2p.connect').catch(e => console.log('connect click:', String(e).slice(0,80)));
  let ok=false; for (let i=0;i<120;i++){ ok = (await host.locator('.m-p2p-slot.is-connected').count()) > 0; if (ok) break; await host.waitForTimeout(500); }
  const slot = (await host.locator('.m-p2p-slot').first().innerText().catch(()=> '?')).replace(/\s+/g,' ');
  const status = (await host.locator('.m-p2p-status, [role=status]').first().innerText().catch(()=> '')).replace(/\s+/g,' ').slice(0,200);
  console.log(old ? 'ESKI' : 'NORMAL', '| davet', invite.length, '| cevap', ans.length, '| baglandi', ok, '| slot:', slot, '| durum:', status);
  await host.context().close(); await guest.context().close();
}
await b.close();