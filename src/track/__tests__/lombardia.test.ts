// Lombardia acceptance (tracks.md §4): U-TR-01…12 through the shared suite.
import { trackSuite } from './trackSuite';

trackSuite('lombardia', {
  length: [5760, 5840],
  sequence: 'R L R L R R R L R L R',
  minRadius: 14,
  heading: -360,
  pitLength: [700, 790],
  elevationRange: [10, 20],
  maxGrade: 0.03,
});
