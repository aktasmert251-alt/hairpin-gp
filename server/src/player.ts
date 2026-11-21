// A connected socket (Peer, owned by ws.ts) and a player identity (bound to one peer at a time; survives a reconnect
// within the grace window through its resumeToken). Every message is bound to the socket, never to an id inside it.
import type { NetId, NetServerMsg } from '../../src/contracts/net';
import type { Room } from './room';

export interface Peer {
  readonly ip: string;
  player: Player | null;
  sendJson(msg: NetServerMsg): void;
  /** `lossy`: a `states` batch that the --net-delay loss simulation may drop. */
  sendBinary(buf: Uint8Array, lossy: boolean): void;
  bufferedAmount(): number;
  close(code: number, reason: string): void;
  /** RTT of the last protocol ping, ms. */
  pingMs: number;
}

export class Player {
  peer: Peer | null = null;
  room: Room | null = null;
  teamId = '';
  driverIdx: 0 | 1 = 0;
  ready = false;
  /** Server ms of the last disconnect (NaN while connected). */
  disconnectedAt = Number.NaN;
  /** Server ms of the last (re)connect (contact grace window). */
  connectedAt = 0;
  /** Random per-device id from hello (D-050; null until clients send one). Memory only. */
  deviceId: string | null = null;
  /** Address of the latest socket, kept in memory only so a ban can key the /24 hash after a disconnect. */
  lastIp = '';

  constructor(
    readonly id: NetId,
    public name: string,
    readonly token: string,
  ) {}

  get connected(): boolean {
    return this.peer !== null;
  }

  send(msg: NetServerMsg): void {
    this.peer?.sendJson(msg);
  }
}
