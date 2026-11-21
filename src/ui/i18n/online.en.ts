import type { DictOf } from '../../core/i18n/types';
import type tr from './online.tr';
const en: DictOf<typeof tr> = {
  quickJoin: 'Quick join',
  directoryHint: 'Enter your nickname to browse public rooms.',
  rooms: 'PUBLIC ROOMS', noRooms: 'No public rooms yet. Create a room to get started.', roomState: { lobby: 'Lobby', racing: 'Racing' },
  backOnline: 'Back to online', visibility: 'Visibility', visibilityValue: { public: 'Public', private: 'Private' },
  title: 'ONLINE', description: 'Share the grid with friends. Create a room or join with a room code.',
  name: 'Nickname', nameHint: '2–16 characters · Turkish letters supported', badName: 'Use 2–16 letters, digits, spaces or _ . -.',
  create: 'CREATE ROOM', join: 'JOIN ROOM', code: 'Room code', codeHint: 'Enter the 5-character room code.', badCode: 'Use 5 characters: A–Z (except I and O), 2–9.',
  advanced: 'Advanced · server address', server: 'Server address', serverHint: 'Leave blank to use this site’s server.',
  badServer: 'Enter a valid ws:// or wss:// address. Secure pages require wss://.', back: 'Back', unavailable: 'Online connection is not available yet.',
  status: { offline: 'Waiting for connection', connecting: 'Connecting…', online: 'Connected', reconnecting: 'Reconnecting…', error: 'Connection error' },
  error: { maintenance: 'Server maintenance. Try again shortly.', full: 'Room is full.', notFound: 'Room not found. Check the code.', badName: 'Nickname is invalid.', taken: 'Another player has this car.', version: 'Game versions do not match.', rate: 'Too many requests. Wait a moment.', badMessage: 'Request was not accepted.', phase: 'Room is closed to this action.' },
  lobby: 'RACE ROOM', roomCode: 'Room code · share', copy: 'Copy code', copied: 'Code copied', copyFailed: 'Copy failed · select and copy the code',
  players: 'PLAYERS', humans: '{n}/4 players', empty: 'Waiting for player', owner: 'Room owner', you: 'You', ready: 'READY', unready: 'NOT READY', waiting: 'Waiting for ready',
  ping: '{n} ms', disconnected: 'Disconnected', ai: '{n} AI · {total} cars in total',
  settings: 'ROOM SETTINGS', ownerSettings: 'The room owner chooses the settings.', car: 'YOUR CAR', team: 'Team', driver: 'Driver', carTaken: 'The selected car is no longer available.',
  aiCount: 'AI cars', difficulty: 'Difficulty', start: 'START', leave: 'LEAVE ROOM', startHint: 'At least 2 players, all ready, are required.', allReady: 'Grid ready. You can start the race.',
  emptyRoom: 'Create a room or join with a room code.', loading: 'Preparing track', countdown: 'RACE STARTING', go: 'GO',
  pause: 'ONLINE · RACE CONTINUES', pauseHint: 'The race continues while this menu is open.', leaveRace: 'Leave race', leaveRaceTitle: 'Leave the race?', leaveRaceBody: 'The race will continue. You will leave the room.',
  mode: 'Mode', modeValue: { normal: 'Normal', kasap: 'Kasap' },
  modeHint: { normal: 'All rules: collision and track-limit penalties, safety car.', kasap: 'No rules: no penalties, warnings or safety car. Just racing.' },
  customTeam: 'Custom team', customNone: 'None · standard team', customOwnedBy: 'Created by {name}', customHint: 'Your team takes both seats of the chosen car. A teammate can join as the second driver.',
  resultsLobby: 'Return to room', sample: 'Sample data · no server connection',
  tower: { ok: 'Connected', stale: 'Delayed', dc: 'Disconnected', staleBadge: 'LAG', dcBadge: 'DC', ping: '{n} ms' },
};
export default en;
