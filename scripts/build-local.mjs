#!/usr/bin/env node
// Builds the whole app into ONE html file you can open by double-clicking:
// no server, no GitHub Pages. It carries a snapshot of the current menus and,
// when online, loads newer ones straight from the GitHub repo.
//
// Usage: node scripts/build-local.mjs [--out=dist/calorie-tracker.html]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, todayInTimeZone } from '../site/js/dates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const ESBUILD = 'esbuild@0.28.2';
const KEEP_PAST_DAYS = 3;

const outArg = process.argv.find((a) => a.startsWith('--out='));
const out = outArg ? outArg.slice(6) : join(ROOT, 'dist', 'calorie-tracker.html');

function replaceOnce(html, find, replacement) {
  if (!html.includes(find)) throw new Error(`index.html no longer contains: ${find}`);
  return html.replace(find, () => replacement);
}

async function menuSnapshot() {
  let index;
  try {
    index = JSON.parse(await readFile(join(SITE, 'data', 'index.json'), 'utf8'));
  } catch {
    console.warn('No site/data/index.json yet: building without a menu snapshot.');
    return { index: { version: 1, repo: process.env.GITHUB_REPOSITORY || null, days: {}, hallEnd: {} }, days: {} };
  }
  const cutoff = addDays(todayInTimeZone('America/New_York'), -KEEP_PAST_DAYS);
  const files = (await readdir(join(SITE, 'data', 'days'))).filter((f) => f.endsWith('.json'));
  const days = {};
  for (const f of files) {
    const date = f.replace('.json', '');
    if (date >= cutoff && index.days[date]) days[date] = JSON.parse(await readFile(join(SITE, 'data', 'days', f), 'utf8'));
  }
  const dates = Object.keys(days).sort();
  index.days = Object.fromEntries(dates.map((d) => [d, index.days[d]]));
  index.start = dates[0] || null;
  if (process.env.GITHUB_REPOSITORY) index.repo = process.env.GITHUB_REPOSITORY;
  return { index, days };
}

// JSON / JS placed inside <script> must not contain "</script" or "<!--".
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const safeJs = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const js = execFileSync(
  'npx',
  ['--yes', ESBUILD, 'site/js/app.js', '--bundle', '--format=iife', '--target=es2020', '--minify', '--legal-comments=none'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const css = await readFile(join(SITE, 'css', 'app.css'), 'utf8');
const icon = await readFile(join(SITE, 'icon.svg'), 'utf8');
const snapshot = await menuSnapshot();

let html = await readFile(join(SITE, 'index.html'), 'utf8');
html = replaceOnce(html, '<link rel="stylesheet" href="css/app.css">', `<style>\n${css}</style>`);
html = replaceOnce(html, '<link rel="manifest" href="manifest.webmanifest">\n', '');
html = replaceOnce(html, '  <link rel="apple-touch-icon" href="icon-180.png">\n', '');
html = replaceOnce(
  html,
  '<link rel="icon" href="icon.svg" type="image/svg+xml">',
  `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon.trim())}">`,
);
html = replaceOnce(
  html,
  '<script type="module" src="js/app.js"></script>',
  `<script>window.__EMBEDDED_MENUS__=${safeJson(snapshot)};</script>\n  <script>${safeJs(js)}</script>`,
);

await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
const dates = Object.keys(snapshot.days);
console.log(
  `Wrote ${out} (${Math.round(html.length / 1024)} KB, menus ${dates[0] ?? '—'} → ${dates[dates.length - 1] ?? '—'}, repo ${snapshot.index.repo ?? 'unknown'})`,
);
