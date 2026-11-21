import { Fleet } from './bots';
import { ServerProcess, writeEvidence } from './runtime';

export async function scenario<T>(name: string, run: (srv: ServerProcess, fleet: Fleet) => Promise<T>,
  net: { delay?: number; jitter?: number; loss?: number } = {}): Promise<T> {
  const srv = await ServerProcess.start(net);
  const fleet = new Fleet(srv.url);
  const start = performance.now();
  let failure: string | undefined;
  let result: T | undefined;
  try { result = await run(srv, fleet); return result; }
  catch (err) { failure = String(err instanceof Error ? err.stack : err); throw err; }
  finally {
    const health = await srv.health().catch((err: unknown) => ({ error: String(err) }));
    await fleet.dispose();
    await srv.stop();
    await writeEvidence(name, {
      machine: 'Windows dev PC, not the VM', at: new Date().toISOString(), port: srv.port, pid: srv.child.pid,
      elapsedMs: performance.now() - start, status: failure ? 'failed' : 'passed', failure, result, health,
      serverEnvironment: srv.environment,
      bots: fleet.bots.map((b) => ({ id: b.id, name: b.opts.name, welcomeMs: b.welcomeMs, connectMs: b.connectMs, tx: b.tx, rx: b.rx,
        batches: b.batches, seenIds: [...b.seenIds], receivedCounts: Object.fromEntries(b.receivedCounts),
        lastState: b.lastState, receivedStates: Object.fromEntries(b.receivedStates),
        receivedResets: Object.fromEntries(b.receivedResets),
        contacts: b.contacts, closeCode: b.closeCode, disconnects: b.disconnects, errors: b.errors })),
      logs: srv.logs, stderr: srv.stderr, stopped: srv.child.exitCode !== null || srv.child.signalCode !== null,
    });
  }
}
