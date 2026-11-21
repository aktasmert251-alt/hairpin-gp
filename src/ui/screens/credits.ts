// About uses native tabs, scrolling and a modal dialog; screen id stays compatible with navigation contracts.
import type { ActionId } from '../../contracts/input';
import { projectUrl, publicUrl } from '../../core';
import { h } from '../dom';
import { bottomBar, header, langIndicator, stage } from './base';
import type { Screen, ScreenCtx } from './ctx';

const TABS = ['game', 'licenses', 'kvkk', 'storage', 'privacy'] as const;
type Tab = typeof TABS[number];
const LEGAL_SECTIONS = ['controller', 'data', 'technical', 'contact', 'purposes', 'transfer', 'retention', 'rights'];

export function createCredits(ctx: ScreenCtx): Screen {
  const el = h('section', 'apx-screen');
  el.dataset.screen = 'credits'; el.dataset.active = '0';
  const st = stage(el), hd = header(ctx, st), lang = langIndicator(ctx, hd.right);
  const box = h('div', 'm-about', st);
  const title = h('h1', 'm-h1', box);
  const layout = h('div', 'm-about-layout', box);
  const nav = h('div', 'm-about-tabs', layout);
  nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-orientation', 'vertical');
  const panel = h('article', 'm-about-panel', layout);
  panel.id = 'about-panel'; panel.setAttribute('role', 'tabpanel'); panel.tabIndex = 0;
  panel.dataset.focusId = 'about.content';
  const help = h('p', 'm-meta m-about-help', box);
  const back = h('button', 'm-about-back', box); back.type = 'button';
  back.dataset.focusId = 'about.back';
  const bar = bottomBar(ctx, st, ['back']);
  const dialog = h('dialog', 'm-about-dialog', st);
  dialog.setAttribute('aria-labelledby', 'about-confirm-title');
  dialog.setAttribute('aria-describedby', 'about-confirm-body');
  const dialogTitle = h('h2', 'm-h2', dialog); dialogTitle.id = 'about-confirm-title';
  const dialogBody = h('p', '', dialog); dialogBody.id = 'about-confirm-body';
  const dialogActions = h('div', 'm-about-actions', dialog);
  const cancel = h('button', '', dialogActions), confirm = h('button', 'm-about-delete', dialogActions);
  cancel.type = confirm.type = 'button';
  let active: Tab = 'game';
  let deleteResult: 'deleted' | 'failed' | null = null;
  const tabs = TABS.map((id) => {
    const button = h('button', 'm-about-tab', nav); button.type = 'button';
    button.id = `about-tab-${id}`; button.dataset.tab = id; button.dataset.focusId = `about.tab.${id}`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id);
    return button;
  });
  const text = (key: string): string => ctx.t(`credits.${key}`);
  const paragraph = (key: string): HTMLElement => h('p', '', panel, text(key));
  const section = (prefix: string, name: string): void => {
    h('h3', '', panel, text(`${prefix}.${name}`)); paragraph(`${prefix}.${name}Body`);
  };
  const link = (key: string, href: string): void => {
    const a = h('a', '', panel, ctx.t(key)); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  };
  // Repository links appear only once PROJECT_URL is set; the surrounding texts read fine without them.
  const sourceLinks = (): void => {
    const repo = projectUrl();
    if (repo) link('credits.game.repoLink', repo);
    const issues = projectUrl('/issues');
    if (issues) link('credits.game.issuesLink', issues);
  };
  const renderPanel = (): void => {
    panel.replaceChildren(); panel.scrollTop = 0;
    panel.setAttribute('aria-labelledby', `about-tab-${active}`);
    h('h2', 'm-h2', panel, text(`tabs.${active}`));
    if (active === 'game') {
      h('p', 'm-meta m-about-version', panel, ctx.t('menu.version'));
      paragraph('game.intro'); h('h3', '', panel, text('game.features'));
      const list = h('ul', '', panel);
      for (const key of ['solo', 'race', 'online', 'tracks']) h('li', '', list, text(`game.${key}`));
      section('game', 'source'); sourceLinks();
      const fiction = paragraph('game.fiction'); fiction.className = 'm-about-note';
    } else if (active === 'licenses') {
      for (const key of ['team', 'fonts', 'map']) section('licenses', key);
      paragraph('licenses.elevation');
      link('credits.licenses.odbl', publicUrl('data/tracks/README.md'));
      for (const id of ['istanbul', 'lombardia', 'bosphorus', 'ardennes']) link(`tracks.${id}`, publicUrl(`data/tracks/${id}.raw.json`));
      link('credits.licenses.osm', 'https://www.openstreetmap.org/copyright');
      link('credits.licenses.fontLicense', publicUrl('assets/gra/fonts/OFL.txt'));
      for (const key of ['textures', 'code', 'audio']) section('licenses', key);
      link('credits.licenses.notices', publicUrl('THIRD-PARTY-LICENSES.txt'));
    } else if (active === 'kvkk') {
      for (const key of LEGAL_SECTIONS) section('kvkk', key);
      const issues = projectUrl('/issues');
      if (issues) link('credits.game.issuesLink', issues);
      link('credits.kvkk.full', publicUrl(`legal/kvkk.html${ctx.lang() === 'en' ? '#en' : ''}`));
    } else if (active === 'storage') {
      section('storage', 'cookies'); section('storage', 'local');
      paragraph('storage.keys').className = 'm-about-keys';
      section('storage', 'deletion');
      const remove = h('button', 'm-about-delete', panel, text('storage.delete'));
      remove.type = 'button'; remove.dataset.command = 'delete'; remove.dataset.focusId = 'about.delete';
      const status = h('p', 'm-about-status', panel, deleteResult ? text(`storage.${deleteResult}`) : '');
      status.setAttribute('role', 'status');
      if (deleteResult) {
        const reload = h('button', 'm-about-back', panel, text('storage.reload'));
        reload.type = 'button'; reload.dataset.command = 'reload';
      }
    } else {
      section('privacy', 'summary'); section('privacy', 'terms');
      link('credits.privacy.privacyLink', publicUrl(`legal/privacy.html${ctx.lang() === 'en' ? '#en' : ''}`));
      link('credits.privacy.termsLink', publicUrl(`legal/terms.html${ctx.lang() === 'en' ? '#en' : ''}`));
    }
  };
  const select = (index: number, focus = true): void => {
    const next = TABS[Math.max(0, Math.min(TABS.length - 1, index))]!;
    if (active !== next) { active = next; renderPanel(); ctx.sound('move'); }
    for (const [i, tab] of tabs.entries()) {
      const selected = TABS[i] === active;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    if (focus) tabs[TABS.indexOf(active)]!.focus();
  };
  const render = (): void => {
    hd.render(); lang(); bar(); title.textContent = text('title');
    nav.setAttribute('aria-label', text('navigation'));
    tabs.forEach((tab, i) => { tab.textContent = text(`tabs.${TABS[i]!}`); });
    back.textContent = text('back'); help.textContent = text('help');
    dialogTitle.textContent = text('storage.confirmTitle'); dialogBody.textContent = text('storage.confirmBody');
    cancel.textContent = text('storage.cancel'); confirm.textContent = text('storage.confirm');
    renderPanel(); select(TABS.indexOf(active), false);
  };
  const closeDialog = (): void => {
    dialog.close(); panel.querySelector<HTMLElement>('[data-command="delete"]')?.focus();
  };
  const goBack = (): void => { if (dialog.open) closeDialog(); else { ctx.sound('back'); ctx.go('mainMenu'); } };
  const deleteData = (): void => {
    let failed = false;
    for (const kind of ['localStorage', 'sessionStorage'] as const) {
      try {
        const storage = window[kind];
        for (let i = storage.length - 1; i >= 0; i--) {
          const key = storage.key(i);
          if (key?.startsWith('apexgp:v1:')) storage.removeItem(key);
        }
      } catch { failed = true; }
    }
    deleteResult = failed ? 'failed' : 'deleted'; dialog.close(); renderPanel();
    panel.querySelector<HTMLElement>('[data-command="reload"]')?.focus();
  };
  const click = (e: MouseEvent): void => {
    if (!ctx.live('credits') || !(e.target instanceof Element)) return;
    const tab = e.target.closest<HTMLButtonElement>('[data-tab]');
    if (tab) { select(TABS.indexOf(tab.dataset.tab as Tab)); return; }
    if (e.target === back || e.target.closest('[data-hint="back"]')) goBack();
    else if (e.target === cancel) closeDialog();
    else if (e.target === confirm) deleteData();
    else if (e.target.closest('[data-command="delete"]')) { dialog.showModal(); cancel.focus(); }
    else if (e.target.closest('[data-command="reload"]')) window.location.reload();
  };
  const keydown = (e: KeyboardEvent): void => {
    if (!ctx.live('credits') || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    // Native buttons, anchors, Tab and dialog focus must not also trigger the game's menu input.
    e.stopPropagation();
    if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); goBack(); return; }
    if (dialog.open) return;
    const tabFocus = nav.contains(document.activeElement);
    const i = TABS.indexOf(active);
    if (tabFocus && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'Home', 'End'].includes(e.code)) {
      e.preventDefault();
      select(e.code === 'Home' ? 0 : e.code === 'End' ? TABS.length - 1 : i + (['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyA'].includes(e.code) ? -1 : 1));
    } else if (tabFocus && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); panel.focus(); }
    else if (panel.contains(document.activeElement) && ['Home', 'End', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'KeyW', 'KeyS'].includes(e.code)) {
      e.preventDefault();
      panel.scrollTop = e.code === 'Home' ? 0 : e.code === 'End' ? panel.scrollHeight : panel.scrollTop +
        (['ArrowUp', 'PageUp', 'KeyW'].includes(e.code) ? -1 : 1) * (e.code.startsWith('Page') ? panel.clientHeight * 0.8 : 120);
    }
  };
  const dialogCancel = (e: Event): void => { e.preventDefault(); closeDialog(); };
  el.addEventListener('keydown', keydown); el.addEventListener('click', click); dialog.addEventListener('cancel', dialogCancel);
  return { id: 'credits', el, backdrop: 'ink', animated: () => [box],
    enter() { active = 'game'; render(); select(0); },
    leave() { if (dialog.open) dialog.close(); },
    action(a: ActionId) {
      if (a === 'menuBack') goBack();
      else if (!dialog.open && (a === 'menuUp' || a === 'menuDown' || a === 'menuLeft' || a === 'menuRight')) select(TABS.indexOf(active) + (a === 'menuUp' || a === 'menuLeft' ? -1 : 1));
      else if (a === 'menuConfirm') (document.activeElement as HTMLElement)?.click();
    },
    render, dispose() {
      if (dialog.open) dialog.close();
      el.removeEventListener('keydown', keydown); el.removeEventListener('click', click); dialog.removeEventListener('cancel', dialogCancel); el.remove();
    },
  };
}
