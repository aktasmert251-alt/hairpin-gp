// Settings → Controls "key test" row (2026-10-23, user: "the brake key sometimes isn't detected while turning"). Lights a
// chip for every driving action whose key is physically held, and shows the most game keys seen down at once, so a
// keyboard that cannot report a combination (hardware ghosting, e.g. W+A+S on some cheap boards) is visible at a glance.
// Reads raw window key events (passive: no preventDefault), so it works in the menu context too.

import type { ActionId } from '../../contracts/input';
import { h } from '../dom';
import type { ScreenCtx } from './ctx';

const TEST_ACTIONS: readonly ActionId[] = ['throttle', 'brake', 'steerLeft', 'steerRight', 'gearUp', 'gearDown'];

export interface KeyTestRow {
  render(): void;
  dispose(): void;
}

export function keyTestRow(ctx: ScreenCtx, parent: HTMLElement): KeyTestRow {
  const el = h('div', 'm-row m-keytest', parent);
  h('span', 'notch', el);
  const lbl = h('span', 'lbl', el);
  const chips = h('span', 'ctl', el);
  const chipEls = TEST_ACTIONS.map((a) => {
    const c = h('span', 'apx-kc m-kt-chip', chips);
    c.dataset.action = a;
    return c;
  });
  const maxEl = h('span', 'm-kt-max', chips);
  const held = new Set<string>();
  let maxDown = 0;

  const paint = (): void => {
    const b = ctx.deps.keys.bindings();
    let down = 0;
    TEST_ACTIONS.forEach((a, i) => {
      const on = (b[a] ?? []).some((code) => held.has(code));
      if (on) down++;
      chipEls[i]!.classList.toggle('is-on', on);
    });
    if (down > maxDown) maxDown = down;
    maxEl.textContent = ctx.t('settings.c.keyTestMax', { n: maxDown });
  };
  const render = (): void => {
    lbl.textContent = ctx.t('settings.c.keyTest');
    el.title = ctx.t('settings.c.keyTestHint');
    TEST_ACTIONS.forEach((a, i) => {
      chipEls[i]!.textContent = `${ctx.t(`settings.c.action.${a}`)} · ${ctx.deps.keys.labelsFor(a).map((s) => ctx.upper(s)).join('/')}`;
    });
    paint();
  };
  const down = (e: KeyboardEvent): void => {
    held.add(e.code);
    paint();
  };
  const up = (e: KeyboardEvent): void => {
    held.delete(e.code);
    paint();
  };
  const blur = (): void => {
    held.clear();
    paint();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  render();
  return {
    render,
    dispose() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      el.remove();
    },
  };
}
