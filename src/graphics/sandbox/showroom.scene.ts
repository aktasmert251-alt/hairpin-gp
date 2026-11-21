// ?scene=showroom (Grafik-3B, G2 / CR-15): the main-menu Showroom on its own renderer.
// URL: &team=<id> &angle=<deg> (fixed turntable angle) &freeze=1 &quality=low|medium|high|ultra &menu=1 (left 40 % menu mock)
// Keys: ←/→ previous/next livery. Overlay: team, draw calls, programs. `window.__showroom` exposes the
// Showroom plus cycle(n) (init/dispose n times and return geometry/texture counts) for the leak check.

import type { QualityId } from '../../contracts/common';
import type { SandboxScene } from '../../contracts/debug';
import { TEAMS } from '../../data/teams';
import { QUALITY_PRESETS } from '../presets';
import { createGraphicsSystem } from '../renderer/graphicsSystem';
import { createShowroom, type ShowroomImpl } from '../showroom/showroom';

const scene: SandboxScene = {
  id: 'showroom',
  title: 'Showroom',
  async create({ canvas, uiRoot, params }) {
    const qid = (params.get('quality') as QualityId | null) ?? 'high';
    const quality = QUALITY_PRESETS[qid] ?? QUALITY_PRESETS.high;
    const graphics = createGraphicsSystem();
    const ctx = await graphics.init(canvas, quality);
    let room: ShowroomImpl = createShowroom();
    await room.init(ctx);
    const team0 = params.get('team') ?? 'anka';
    room.setTeam(team0);
    const angle = params.get('angle');
    const freeze = params.get('freeze') === '1';
    if (angle !== null) room.setAngle((Number(angle) * Math.PI) / 180);
    if (freeze || angle !== null) room.setMotion(false);
    if (angle !== null) room.setAngle((Number(angle) * Math.PI) / 180);
    const onResize = (): void => {
      graphics.resize();
      room.resize();
    };
    window.addEventListener('resize', onResize);

    let idx = Math.max(0, TEAMS.findIndex((t) => t.id === team0));
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      e.preventDefault();
      idx = (idx + (e.code === 'ArrowRight' ? 1 : TEAMS.length - 1)) % TEAMS.length;
      room.setTeam(TEAMS[idx]!.id);
    };
    window.addEventListener('keydown', onKey);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;right:12px;bottom:12px;padding:6px 10px;background:rgba(9,11,14,.8);color:#F2F4F7;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre;pointer-events:none';
    uiRoot.appendChild(overlay);
    let menu: HTMLDivElement | null = null;
    if (params.get('menu') === '1') {
      // Layout mock only (the real menu is GRA-UI's): shows that the left 40 % stays free.
      menu = document.createElement('div');
      menu.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:40%;background:linear-gradient(90deg,rgba(9,11,14,.72),rgba(9,11,14,0));pointer-events:none';
      uiRoot.appendChild(menu);
    }

    const cycle = async (n: number): Promise<{ before: [number, number]; after: [number, number] }> => {
      const p0 = graphics.getPerf();
      const team = room.team();
      for (let i = 0; i < n; i++) {
        room.dispose();
        room = createShowroom();
        await room.init(ctx);
        room.setTeam(team);
        room.render(1 / 60);
      }
      const p1 = graphics.getPerf();
      return { before: [p0.geometries, p0.textures], after: [p1.geometries, p1.textures] };
    };
    (window as unknown as { __showroom?: unknown }).__showroom = { get room() { return room; }, cycle, graphics };

    let acc = 0;
    return {
      update(dt) {
        room.render(freeze ? 0 : dt);
        acc += dt;
        if (acc > 0.25) {
          acc = 0;
          const p = graphics.getPerf();
          overlay.textContent = `team ${room.team()}  quality ${qid}\ncalls ${room.drawCalls()}  tris ${p.triangles}  programs ${p.programs}\ngeo ${p.geometries}  tex ${p.textures}`;
        }
      },
      dispose() {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKey);
        overlay.remove();
        menu?.remove();
        room.dispose();
        graphics.dispose();
      },
    };
  },
};

export default scene;
