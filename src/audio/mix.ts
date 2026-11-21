// Deterministic summing (S2-S9, E-AU-02). Chrome sums the connections into one node input in an order that depends on
// object addresses, and float addition is not associative, so a node with 3+ inputs rendered different low bits on
// every offline render (≈ 1e-7). Two inputs are order-free (a + b = b + a exactly), so every fan-in goes through a
// balanced tree of unity GainNodes with at most two inputs each.

export function sumTree(ctx: BaseAudioContext, dest: AudioNode, srcs: readonly AudioNode[], keep: (n: AudioNode) => void): void {
  let level: AudioNode[] = srcs.slice();
  while (level.length > 2) {
    const next: AudioNode[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        next.push(level[i]!);
        continue;
      }
      const g = new GainNode(ctx, { gain: 1 });
      keep(g);
      level[i]!.connect(g);
      level[i + 1]!.connect(g);
      next.push(g);
    }
    level = next;
  }
  for (const n of level) n.connect(dest);
}
