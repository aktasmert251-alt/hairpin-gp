import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from './bots';
import { scenario } from './scenario';

test('D-052 public discovery, private code join, and quick join share the real control transport', async () => {
  await scenario('d052-directory', async (_srv, fleet) => {
    const [owner, guest, viewer] = await fleet.group(3, 'Directory');
    owner!.send({ type: 'create', settings: { ...DEFAULT_SETTINGS, visibility: 'private' } });
    const room = await owner!.waitFor((m) => m.type === 'room');
    if (room.type !== 'room') throw new Error('Missing room');
    const hidden = viewer!.next((m) => m.type === 'rooms');
    viewer!.send({ type: 'listRooms' }); expect(await hidden).toEqual({ type: 'rooms', rooms: [] });
    guest!.send({ type: 'join', code: room.code });
    await owner!.waitFor((m) => m.type === 'room' && m.players.length === 2);
    const visible = viewer!.next((m) => m.type === 'rooms');
    owner!.send({ type: 'setSettings', settings: { ...room.settings, visibility: 'public' } });
    await owner!.waitFor((m) => m.type === 'room' && m.settings.visibility === 'public');
    viewer!.send({ type: 'listRooms' });
    expect(await visible).toMatchObject({ type: 'rooms', rooms: [{ code: room.code, humans: 2, capacity: 20, state: 'lobby', owner: owner!.opts.name }] });
    viewer!.send({ type: 'quickJoin' });
    await viewer!.waitFor((m) => m.type === 'room' && m.code === room.code && m.players.length === 3);
    return { code: room.code, publicHumans: 3 };
  });
});
