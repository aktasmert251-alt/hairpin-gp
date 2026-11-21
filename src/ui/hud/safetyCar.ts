import type { HudModel } from '../../contracts/hud';
import { h, Txt } from '../dom';
import type { HudCtx, HudWidget } from './ctx';

/** Dedicated board; a return to green stays visible for five seconds. */
export function createSafetyCar(parent: HTMLElement, ctx: HudCtx): HudWidget & { update(m: HudModel): void } {
  const el = h('div', 'h-reg h-sc h-mode-hide', parent);
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const code = h('b', 'code', el);
  const title = new Txt(h('span', 'title', el));
  let state = 'none';
  let greenUntil = 0;
  const label = (): void => {
    code.textContent = ctx.t(state === 'green' ? 'hud.sc.greenCode' : 'hud.sc.code');
    title.set(ctx.t(`hud.sc.${state}`));
  };
  el.hidden = true;
  return {
    update(m: HudModel) {
      const flag = m.flags.safetyCar ?? 'none';
      const now = performance.now();
      if (flag === 'none' && (state === 'deployed' || state === 'ending')) greenUntil = now + 5000;
      const next = flag === 'none' && now < greenUntil ? 'green' : flag;
      if (state === next) return;
      state = next;
      el.dataset.state = state;
      if (state !== 'none') label();
      el.hidden = state === 'none';
      parent.dataset.sc = state === 'none' ? '0' : '1';
    },
    relabel() { if (state !== 'none') label(); },
    dispose() { el.remove(); },
  };
}
