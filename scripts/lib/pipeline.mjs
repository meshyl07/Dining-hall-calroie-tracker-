// Scrape -> merge with what's already on disk -> write per-day JSON + index.
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { addDays } from '../../site/js/dates.js';
import { sortDiningMeals } from '../../site/js/halls.js';
import { fetchMenuJson, parseMenuResponse } from './umass.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Walks forward day by day for each hall until the menu runs out.
 * Returns { days: { date: { hallId: meals } }, stats } where `meals` is `{}`
 * for a day UMass confirmed has nothing published. Days that errored are absent.
 */
export async function scrapeHalls({
  halls,
  start,
  maxDays = 42,
  stopAfterEmpty = 6,
  maxConsecutiveErrors = 4,
  delayMs = 150,
  fetchImpl = fetch,
  retries = 3,
  log = () => {},
}) {
  const days = {};
  const stats = { requests: 0, ok: 0, failed: 0, errors: [], halls: {} };

  await Promise.all(
    halls.map(async (hall) => {
      const hs = { ok: 0, failed: 0, lastDate: null };
      stats.halls[hall.id] = hs;
      let emptyRun = 0;
      let errorRun = 0;
      for (let i = 0; i < maxDays; i++) {
        const date = addDays(start, i);
        stats.requests++;
        try {
          const json = await fetchMenuJson(hall.tid, date, { fetchImpl, retries });
          const meals = parseMenuResponse(json);
          stats.ok++;
          hs.ok++;
          errorRun = 0;
          (days[date] ??= {})[hall.id] = meals;
          if (Object.keys(meals).length) {
            emptyRun = 0;
            hs.lastDate = date;
          } else {
            emptyRun++;
          }
        } catch (err) {
          stats.failed++;
          hs.failed++;
          errorRun++;
          if (stats.errors.length < 20) stats.errors.push(`${hall.name} ${date}: ${err.message}`);
          log(`  ! ${hall.name} ${date}: ${err.message}`);
          if (errorRun >= maxConsecutiveErrors) {
            log(`  ! ${hall.name}: giving up after ${errorRun} errors in a row`);
            break;
          }
        }
        if (emptyRun >= stopAfterEmpty) break;
        if (delayMs) await sleep(delayMs);
      }
      log(`  ${hall.name}: ${hs.ok} days fetched, menus through ${hs.lastDate ?? 'n/a'}`);
    }),
  );
  return { days, stats };
}

/**
 * existing: { date: { date, halls: { hallId: meals } } }  (what's on disk)
 * scraped:  { date: { hallId: meals } }                   (this run)
 * Keeps existing data when a fetch failed or came back empty, drops days older
 * than `keepPastDays`.
 */
export function mergeDays(existing, scraped, { today, keepPastDays = 14 }) {
  const cutoff = addDays(today, -keepPastDays);
  const out = {};
  const dates = new Set([...Object.keys(existing), ...Object.keys(scraped)]);
  for (const date of [...dates].sort()) {
    if (date < cutoff) continue;
    const halls = { ...(existing[date]?.halls || {}) };
    for (const [hallId, meals] of Object.entries(scraped[date] || {})) {
      if (Object.keys(meals).length) halls[hallId] = meals;
    }
    for (const hallId of Object.keys(halls)) {
      if (!Object.keys(halls[hallId] || {}).length) delete halls[hallId];
    }
    if (Object.keys(halls).length) out[date] = { date, halls: sortKeys(halls) };
  }
  return out;
}

function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
}

export function buildIndex(days, { halls, updatedAt, repo, branch }) {
  const dates = Object.keys(days).sort();
  const index = {
    version: 1,
    updatedAt,
    source: 'https://umassdining.com/menu-search',
    repo: repo || null,
    branch: branch || null,
    halls: halls.map(({ id, name }) => ({ id, name })),
    start: dates[0] || null,
    end: dates[dates.length - 1] || null,
    hallEnd: {},
    days: {},
  };
  for (const date of dates) {
    index.days[date] = {};
    for (const [hallId, meals] of Object.entries(days[date].halls)) {
      index.days[date][hallId] = sortDiningMeals(Object.keys(meals));
      if (!index.hallEnd[hallId] || date > index.hallEnd[hallId]) index.hallEnd[hallId] = date;
    }
  }
  return index;
}

export async function readExistingDays(outDir) {
  const dir = join(outDir, 'days');
  const out = {};
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return out;
  }
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    try {
      out[m[1]] = JSON.parse(await readFile(join(dir, f), 'utf8'));
    } catch {
      /* ignore corrupt file; it gets rewritten or pruned */
    }
  }
  return out;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes day files + index.json, touching only what changed.
 * Returns { changed, written, removed, index }.
 */
export async function writeData(outDir, days, { halls, now, repo, branch }) {
  const dir = join(outDir, 'days');
  await mkdir(dir, { recursive: true });
  const existingFiles = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  let written = 0;
  let removed = 0;

  for (const [date, day] of Object.entries(days)) {
    const path = join(dir, `${date}.json`);
    const next = JSON.stringify(day);
    let prev = null;
    try {
      prev = await readFile(path, 'utf8');
    } catch {
      /* new file */
    }
    if (prev !== next) {
      await writeFile(path, next);
      written++;
    }
  }
  for (const f of existingFiles) {
    if (!days[f.replace(/\.json$/, '')]) {
      await unlink(join(dir, f));
      removed++;
    }
  }

  const indexPath = join(outDir, 'index.json');
  const prevIndex = await readJson(indexPath);
  const changed = written > 0 || removed > 0 || !prevIndex;
  const updatedAt = changed ? now : prevIndex.updatedAt;
  const index = buildIndex(days, { halls, updatedAt, repo: repo || prevIndex?.repo, branch: branch || prevIndex?.branch });
  const indexText = JSON.stringify(index, null, 1) + '\n';
  if (!prevIndex || JSON.stringify(prevIndex, null, 1) + '\n' !== indexText) {
    await writeFile(indexPath, indexText);
  }
  return { changed, written, removed, index };
}
