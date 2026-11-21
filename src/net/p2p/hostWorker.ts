// D-064: the host's room server, in a dedicated Web Worker so the 20 Hz room tick and the 240 Hz server-AI sim do not share the
// page's main thread with rendering. The page hands it one MessagePort per client link (its own client and each guest's bridged
// data channel); the room logic is the Node server's (server/src/p2p/hostRoom.ts → HubCore / Room).
import { HostRoom } from '../../../server/src/p2p/hostRoom';
import { portTransport } from './transport';
import type { HostWorkerMsg } from './hostProtocol';

const room = new HostRoom();

self.onmessage = (ev: MessageEvent<HostWorkerMsg>) => {
  const m = ev.data;
  switch (m.t) {
    case 'attach':
      room.attach(portTransport(m.port), m.label);
      break;
    case 'stats':
      room.linkStats(m.label, m.pingMs, m.buffered);
      break;
    case 'end':
      room.end();
      self.close();
      break;
    default:
      break;
  }
};
