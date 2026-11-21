// AISystem (ARCHITECTURE §4.1 row 3): AI controllers at 60 Hz, staggered so car i runs when (tick + i) % 4 == 0.
// Drives every car whose control is 'ai' (including the player under autodrive) or 'pitAuto'. Between runs the
// car keeps its last input. 'remote' puppets (online, P3) are posed by the glue and never driven. Sim layer.

import type { AIModule } from '../contracts/ai';
import type { SimSystem } from '../contracts/sim';

export function createAISystem(ai: AIModule): SimSystem {
  return {
    name: 'ai',
    step(world) {
      const cars = world.state.cars;
      const tick = world.state.tick;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        if (car.control === 'player' || car.control === 'remote') continue;
        if ((tick + i) % 4 !== 0) continue;
        ai.computeInput(world, i, car.input);
      }
    },
  };
}
