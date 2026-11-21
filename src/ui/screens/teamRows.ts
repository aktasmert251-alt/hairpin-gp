// Shared driver row options for offline team select and the online car picker.
import type { TeamDef } from '../../contracts/data';
import type { Option } from '../controls';
import * as fmt from '../format';

export function driverOptions(team: TeamDef, available: (idx: 0 | 1) => boolean = () => true): Option<0 | 1>[] {
  return team.drivers.flatMap((driver, i) => available(i as 0 | 1)
    ? [{ v: i as 0 | 1, label: () => fmt.upper(driver.name, fmt.langForNat(driver.nat)) }] : []);
}
