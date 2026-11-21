import type tr from './net.tr';
import type { DictOf } from '../../core/i18n/types';

const en: DictOf<typeof tr> = {
  notice: { title: 'SERVER NOTICE' },
  equalCars: 'Online: equal cars',
  kicked: { title: 'REMOVED FROM THE ROOM', detail: 'The server admin removed you from the game.' },
  banned: { title: 'ACCESS BLOCKED', detail: 'You cannot connect to this server right now.', until: 'Blocked until {until}.' },
  maintenance: { title: 'MAINTENANCE', detail: 'New rooms and joins are paused right now. Try again in a little while.' },
};

export default en;
