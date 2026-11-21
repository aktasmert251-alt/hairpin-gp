// The Node server's hub: the runtime-neutral HubCore (hubCore.ts) plus the salted network log tag of privacy.ts (node:crypto).
// D-064: the browser host room (server/src/p2p/hostRoom.ts) uses HubCore directly; both share every rule of the game hub.
import type { GameConfig } from './config';
import { HubCore, serverNow } from './hubCore';
import { logTag } from './privacy';
import type { Log } from './room';

export { CLOSE_BANNED, CLOSE_KICKED, serverNow, type Admission, type LogTag } from './hubCore';

export class Hub extends HubCore {
  constructor(log: Log, cfg: Partial<GameConfig> = {}, now: () => number = serverNow) {
    super(log, cfg, now, logTag);
  }
}
