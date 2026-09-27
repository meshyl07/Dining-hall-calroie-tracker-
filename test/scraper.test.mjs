import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  menuUrl,
  parseMenuResponse,
  parseNum,
  normalizeMealKey,
  decodeEntities,
  fetchMenuJson,
} from '../scripts/lib/umass.mjs';
import { scrapeHalls, mergeDays, writeData, readExistingDays } from '../scripts/lib/pipeline.mjs';
import { HALLS } from '../site/js/halls.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/worcester-lunch.json', import.meta.url), 'utf8'));

test('menuUrl formats the date the way UMass expects', () => {
  assert.equal(menuUrl(1, '2026-10-03'), 'https://umassdining.com/foodpro-menu-ajax?tid=1&date=10%2F03%2F2026');
});

test('parseNum handles units, "<1g", blanks and junk', () => {
  assert.equal(parseNum('31g'), 31);
  assert.equal(parseNum('3.5g'), 3.5);
  assert.equal(parseNum('890mg'), 890);
  assert.equal(parseNum('<1g'), 0.5);
  assert.equal(parseNum('less than 1g'), 0.5);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('N/A'), null);
  assert.equal(parseNum(undefined), null);
  assert.equal(parseNum('1,240'), 1240);
});

test('normalizeMealKey', () => {
  assert.equal(normalizeMealKey('lunch_menu'), 'lunch');
  assert.equal(normalizeMealKey('latenight_menu'), 'latenight');
  assert.equal(normalizeMealKey('late_night_menu'), 'latenight');
  assert.equal(normalizeMealKey('Grab_and_Go'), 'grabngo');
});

test('decodeEntities', () => {
  assert.equal(decodeEntities('Mac &amp; Cheese &#038; more &#x27;s &quot;x&quot;'), 'Mac & Cheese & more \'s "x"');
});

test('parseMenuResponse extracts meals, stations and macros', () => {
  const meals = parseMenuResponse(fixture);
  assert.deepEqual(Object.keys(meals), ['lunch', 'dinner', 'latenight']);

  const [grill, fusion] = meals.lunch;
  assert.equal(grill.name, 'Grill Station');
  assert.equal(grill.items.length, 2);
  assert.deepEqual(grill.items[0], {
    name: 'Grilled Chicken Breast',
    serving: '4 oz',
    cal: 160,
    protein: 31,
    carbs: 0,
    fat: 3.5,
    satFat: 1,
    fiber: 0,
    sugar: 0,
    sodium: 370,
    chol: 85,
    diets: ['Halal', 'Local'],
  });
  const mac = grill.items[1];
  assert.equal(mac.name, 'Mac & Cheese');
  assert.equal(mac.fiber, 0.5);
  assert.equal(mac.allergens, 'Milk, Wheat');

  assert.equal(fusion.items[0].name, 'Tofu & Broccoli Stir Fry');
  assert.deepEqual(fusion.items[0].diets, ['Vegan', 'Plant Based']);
  // duplicate "Brown Rice" collapsed
  assert.equal(fusion.items.length, 2);

  // single-quoted attributes
  assert.equal(meals.dinner[0].items[0].protein, 13);

  // item with no nutrition data is kept, without numbers
  const soft = meals.latenight[0].items[0];
  assert.equal(soft.name, 'Soft Serve');
  assert.equal(soft.cal, undefined);
  assert.equal(soft.protein, undefined);
});

test('parseMenuResponse treats [] and junk as empty', () => {
  assert.deepEqual(parseMenuResponse([]), {});
  assert.deepEqual(parseMenuResponse(null), {});
  assert.deepEqual(parseMenuResponse({ lunch_menu: [] }), {});
});

function fakeFetch(handler) {
  return async (url) => {
    const u = new URL(url);
    const [m, d, y] = u.searchParams.get('date').split('/');
    const out = handler(Number(u.searchParams.get('tid')), `${y}-${m}-${d}`);
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
}

test('fetchMenuJson rejects HTML error pages', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html>Access denied</html>' });
  await assert.rejects(fetchMenuJson(1, '2026-10-01', { fetchImpl, retries: 0 }), /Expected JSON/);
});

test('scrapeHalls walks forward until the menus run out', async () => {
  const fetchImpl = fakeFetch((tid, date) => (date <= '2026-10-10' ? fixture : []));
  const { days, stats } = await scrapeHalls({
    halls: HALLS,
    start: '2026-09-27',
    maxDays: 40,
    stopAfterEmpty: 3,
    delayMs: 0,
    fetchImpl,
  });
  assert.equal(stats.failed, 0);
  for (const h of HALLS) assert.equal(stats.halls[h.id].lastDate, '2026-10-10');
  assert.ok(days['2026-10-10'].worcester.lunch);
  assert.deepEqual(days['2026-10-11'].worcester, {});
  assert.equal(days['2026-10-14'], undefined, 'stops after 3 empty days');
});

test('scrapeHalls gives up on a hall after repeated errors', async () => {
  const fetchImpl = fakeFetch((tid) => (tid === 1 ? new Error('boom') : fixture));
  const { stats } = await scrapeHalls({
    halls: HALLS,
    start: '2026-09-27',
    maxDays: 3,
    delayMs: 0,
    retries: 0,
    maxConsecutiveErrors: 2,
    fetchImpl,
  });
  assert.equal(stats.halls.worcester.failed, 2);
  assert.equal(stats.halls.franklin.ok, 3);
});

test('mergeDays keeps old data on failures/empties and prunes the past', () => {
  const lunch = parseMenuResponse(fixture);
  const existing = {
    '2026-09-01': { date: '2026-09-01', halls: { worcester: lunch } },
    '2026-09-27': { date: '2026-09-27', halls: { worcester: lunch, franklin: lunch } },
  };
  const scraped = {
    '2026-09-27': { worcester: {}, hampshire: lunch }, // worcester came back empty, franklin errored
    '2026-09-28': { worcester: lunch },
  };
  const merged = mergeDays(existing, scraped, { today: '2026-09-27', keepPastDays: 14 });
  assert.deepEqual(Object.keys(merged), ['2026-09-27', '2026-09-28']);
  assert.deepEqual(Object.keys(merged['2026-09-27'].halls), ['franklin', 'hampshire', 'worcester']);
});

test('writeData writes day files + index and only bumps updatedAt on change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'menus-'));
  try {
    const lunch = parseMenuResponse(fixture);
    const days = { '2026-09-27': { date: '2026-09-27', halls: { worcester: lunch } } };
    const first = await writeData(dir, days, { halls: HALLS, now: 't1', repo: 'me/repo', branch: 'main' });
    assert.equal(first.changed, true);
    assert.deepEqual(await readdir(join(dir, 'days')), ['2026-09-27.json']);
    assert.equal(first.index.updatedAt, 't1');
    assert.equal(first.index.end, '2026-09-27');
    assert.deepEqual(first.index.days['2026-09-27'].worcester, ['lunch', 'dinner', 'latenight']);
    assert.equal(first.index.repo, 'me/repo');

    const second = await writeData(dir, days, { halls: HALLS, now: 't2' });
    assert.equal(second.changed, false);
    assert.equal(second.index.updatedAt, 't1');
    assert.equal(second.index.repo, 'me/repo');

    const reread = await readExistingDays(dir);
    assert.deepEqual(reread, days);

    const third = await writeData(dir, {}, { halls: HALLS, now: 't3' });
    assert.equal(third.removed, 1);
    assert.equal(third.index.updatedAt, 't3');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
