// QC2-03: re-entering a list screen must leave exactly one `.is-focus` / `aria-current` (DESIGN §7.6).
// ListScreen.enter() = blur() then set(restoreIndex); this drives the same FocusList sequence with minimal fake elements.

import { beforeAll, describe, expect, it } from 'vitest';
import { FocusList, type Focusable } from '../focus/focus';

function fakeEl(): HTMLElement {
  const cls = new Set<string>();
  const attrs = new Map<string, string>();
  return {
    tabIndex: 0,
    classList: {
      add: (c: string) => void cls.add(c),
      remove: (c: string) => void cls.delete(c),
      contains: (c: string) => cls.has(c),
    },
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    querySelector: () => null,
    focus: () => undefined,
  } as unknown as HTMLElement;
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document ??= { activeElement: null };
});

describe('FocusList re-enter (QC2-03)', () => {
  it('enter -> move -> leave -> enter leaves exactly one focused row', () => {
    const items: Focusable[] = [{ el: fakeEl() }, { el: fakeEl() }, { el: fakeEl() }];
    const f = new FocusList({ reduced: () => true });
    f.setItems(items);
    const enter = (restore: number): void => {
      f.blur();
      f.set(restore, false);
    };
    enter(0);
    f.move(1);
    f.move(1);
    const restore = f.index; // leave()
    enter(0); // restore index reset, e.g. after a resume
    void restore;
    const focused = items.filter((i) => i.el.classList.contains('is-focus'));
    const current = items.filter((i) => i.el.getAttribute('aria-current') === 'true');
    expect(focused).toHaveLength(1);
    expect(current).toHaveLength(1);
    expect(f.index).toBe(0);
  });
});
