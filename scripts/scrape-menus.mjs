#!/usr/bin/env node
// Pulls every published menu (today onward) for the four UMass dining halls
// and writes site/data/index.json + site/data/days/<date>.json.
//
// Usage: node scripts/scrape-menus.mjs [--days=42] [--start=YYYY-MM-DD]
//        [--keep-past=14] [--stop-after-empty=6] [--out=site/data]
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HALLS } from '../site/js/halls.js';
import { todayInTimeZone } from '../site/js/dates.js';
import { scrapeHalls, mergeDays, readExistingDays, writeData } from './lib/pipeline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function args() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? 'true';
  }
  return out;
}

async function main() {
  const a = args();
  const outDir = a.out || join(ROOT, 'site', 'data');
  const today = todayInTimeZone('America/New_York');
  const start = a.start || today;
  const maxDays = Number(a.days || 42);
  const keepPastDays = Number(a['keep-past'] || 14);
  const now = new Date().toISOString();

  console.log(`Fetching UMass Dining menus from ${start} (up to ${maxDays} days ahead)…`);
  const { days: scraped, stats } = await scrapeHalls({
    halls: HALLS,
    start,
    maxDays,
    stopAfterEmpty: Number(a['stop-after-empty'] || 6),
    log: (s) => console.log(s),
  });

  const existing = await readExistingDays(outDir);
  const merged = mergeDays(existing, scraped, { today, keepPastDays });
  const { changed, written, removed, index } = await writeData(outDir, merged, {
    halls: HALLS,
    now,
    repo: process.env.GITHUB_REPOSITORY,
    branch: process.env.GITHUB_REF_NAME,
  });

  const status = {
    checkedAt: now,
    ok: stats.ok > 0,
    requests: stats.requests,
    succeeded: stats.ok,
    failed: stats.failed,
    errors: stats.errors,
    hallLastDate: Object.fromEntries(Object.entries(stats.halls).map(([id, h]) => [id, h.lastDate])),
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'status.json'), JSON.stringify(status, null, 1) + '\n');

  console.log(
    `Done: ${stats.ok}/${stats.requests} requests ok, ${written} day files written, ${removed} removed` +
      `${changed ? '' : ' (no changes)'}. Menus cover ${index.start ?? '—'} → ${index.end ?? '—'}.`,
  );
  if (stats.ok === 0) {
    console.error('Every request to umassdining.com failed. Existing data was left untouched.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
