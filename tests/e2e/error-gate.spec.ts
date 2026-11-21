// Self-tests of the error gate in tests/helpers/fixtures.ts (testing-qc.md §1). `test.fail()` marks a test that must FAIL: it is
// reported as passed only if the auto fixture rejects the page errors injected below, so a broken gate turns this file red.

import { expect, test } from '../helpers/fixtures';

test.describe('error gate rejects page errors', () => {
  test('console.error fails the test', async ({ apex, page }) => {
    test.fail(true, 'the gate must reject console.error');
    await apex.open({ scene: 'skeleton', freeze: 1 }, 'sceneReady');
    await page.evaluate(() => console.error('injected console.error (expected to fail this test)'));
  });

  test('an uncaught exception fails the test', async ({ apex, page }) => {
    test.fail(true, 'the gate must reject uncaught exceptions');
    await apex.open({ scene: 'skeleton', freeze: 1 }, 'sceneReady');
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('injected uncaught exception (expected to fail this test)');
      }, 0);
    });
    await page.waitForTimeout(200);
  });

  test('a non-empty __APEX__.errors fails the test', async ({ apex, page }) => {
    test.fail(true, 'the gate must reject __APEX__.errors');
    await apex.open({ scene: 'skeleton', freeze: 1 }, 'sceneReady');
    await page.evaluate(() => {
      (window as unknown as { __APEX__: { errors: string[] } }).__APEX__.errors.push('injected entry (expected to fail this test)');
    });
  });
});

test.describe('error gate allow-list', () => {
  test.use({ allowedErrors: [/documented noise/] });

  test('a message on the allow-list passes, others still fail', async ({ apex, page }) => {
    await apex.open({ scene: 'skeleton', freeze: 1 }, 'sceneReady');
    await page.evaluate(() => console.error('documented noise: tracked in docs/qa'));
    expect(await apex.errors()).toHaveLength(1);
  });
});

test.describe('clean storage', () => {
  test('localStorage is empty on a fresh test and survives a reload inside the test', async ({ apex, page }) => {
    await apex.open('/', 'ready');
    expect(await page.evaluate(() => window.localStorage.getItem('apexgp:v1:probe'))).toBeNull();
    await page.evaluate(() => window.localStorage.setItem('apexgp:v1:probe', 'kept'));
    await page.reload({ waitUntil: 'load' });
    await apex.whenReady('ready');
    expect(await page.evaluate(() => window.localStorage.getItem('apexgp:v1:probe'))).toBe('kept');
  });
});
