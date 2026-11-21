// Slipstream and dirty air (planner-report §5.6), evaluated at 60 Hz for every car. Sim layer, allocation-free.
//   slip  = (1 − Δs/50)^1.2 · max(0, 1 − |Δd|/2.2)  for a car 0 < Δs < 50 m ahead on the main ribbon → drag ×(1 − 0.30·slip)
//   dirty = (1 − Δs/30) · max(0, 1 − |Δd|/3.0)       within 30 m                                      → ClA ×(1 − 0.22·dirty)

import type { SimWorld } from '../../contracts/sim';

export function updateSlipstream(world: SimWorld): void {
  const cars = world.state.cars;
  const q = world.static.track.query;
  const n = cars.length;
  for (let i = 0; i < n; i++) {
    const me = cars[i]!.vehicle;
    let slip = 0;
    let dirty = 0;
    if (me.hint.ribbon === 'main' && me.speed > 10) {
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = cars[j]!.vehicle;
        if (o.hint.ribbon !== 'main') continue;
        const ds = q.deltaS(me.s, o.s);
        if (ds <= 0 || ds >= 50) continue;
        const ad = Math.abs(o.d - me.d);
        const ls = 1 - ad / 2.2;
        if (ls > 0) {
          const sv = Math.pow(1 - ds / 50, 1.2) * ls;
          if (sv > slip) slip = sv;
        }
        if (ds < 30) {
          const ld = 1 - ad / 3.0;
          if (ld > 0) {
            const dv = (1 - ds / 30) * ld;
            if (dv > dirty) dirty = dv;
          }
        }
      }
    }
    me.slipstream = slip;
    me.dirtyAir = dirty;
  }
}
