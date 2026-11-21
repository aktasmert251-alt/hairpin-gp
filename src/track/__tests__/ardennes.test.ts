// Ardennes acceptance (docs/design/tracks-spa.md §11): U-TR-01…12 through the shared suite.
import { trackSuite } from './trackSuite';

trackSuite('ardennes', {
  length: [6890, 6970],
  sequence: 'R L R L R L R R L L L R L R R L L R L',
  minRadius: 12,
  minTurn: 12,
  heading: -360,
  pitLength: [770, 830],
  elevationRange: [90, 115],
  maxGrade: 0.17,
});
