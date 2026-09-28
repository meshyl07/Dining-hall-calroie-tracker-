// Loads the menu data the GitHub Action publishes next to the site, and can
// ask GitHub to run that Action right now (the "Refresh menus" button).
import { todayIso, daysBetween } from './dates.js';
import { DEFAULT_HALL } from './halls.js';

export const WORKFLOW_FILE = 'update-menus.yml';

let index = null;
let status = null;
let loadedAt = 0;
let loadError = null;
const dayCache = new Map();
const listeners = new Set();

export const onMenusChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn());

// The single-file local build (scripts/build-local.mjs) embeds a snapshot of the
// menus and, when online, pulls fresher ones straight from the GitHub repo.
const EMBEDDED = globalThis.__EMBEDDED_MENUS__ || null; // { index, days }
let source = null; // 'site' | 'embedded' | 'remote'
let dataBase = null;

export const isLocalBuild = () => !!EMBEDDED;
const siteBase = () => new URL('data/', document.baseURI);
const remoteBase = (repo) => `https://raw.githubusercontent.com/${repo}/HEAD/site/data/`;

async function getJson(base, path, query = '') {
  const url = new URL(path, base);
  if (query) url.search = query;
  const res = await fetch(url, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${path}`);
  return res.json();
}

function useIndex(idx, st, src, base) {
  if (index && (idx.updatedAt !== index.updatedAt || src !== source)) dayCache.clear();
  index = idx;
  status = st;
  source = src;
  dataBase = base;
}

export async function loadIndex({ force = false } = {}) {
  if (!force && index && Date.now() - loadedAt < 30 * 60e3) return index;
  const t = `t=${Date.now()}`;
  try {
    if (EMBEDDED) {
      if (!index) useIndex(EMBEDDED.index, null, 'embedded', null);
      const repo = EMBEDDED.index?.repo;
      const base = repo && remoteBase(repo);
      const idx = base ? await getJson(base, 'index.json', t).catch(() => null) : null;
      // Offline (or GitHub unreachable): keep whatever we already have.
      if (idx?.end && (idx.updatedAt || '') >= (EMBEDDED.index.updatedAt || '')) {
        useIndex(idx, null, 'remote', base); // status.json isn't committed, so there's none to fetch
      }
    } else {
      const base = siteBase();
      const [idx, st] = await Promise.all([getJson(base, 'index.json', t), getJson(base, 'status.json', t).catch(() => null)]);
      if (idx) useIndex(idx, st, 'site', base);
      else index = null;
    }
    loadError = null;
  } catch (err) {
    loadError = err;
  }
  loadedAt = Date.now();
  emit();
  return index;
}

export const getIndex = () => index;
export const getLoadError = () => loadError;
export const lastLoadedAt = () => loadedAt;

export function loadDay(date) {
  if (!index?.days?.[date]) return Promise.resolve(null);
  if (!dayCache.has(date)) {
    const snapshot = EMBEDDED?.days?.[date] || null;
    const p =
      source === 'embedded'
        ? Promise.resolve(snapshot)
        : getJson(dataBase, `days/${date}.json`, `v=${encodeURIComponent(index.updatedAt || '')}`).catch((err) => {
            if (snapshot) return snapshot;
            dayCache.delete(date);
            throw err;
          });
    dayCache.set(date, p);
  }
  return dayCache.get(date);
}

export function hallMeals(date, hallId) {
  return index?.days?.[date]?.[hallId] || [];
}

export function availableDates() {
  return index ? Object.keys(index.days).sort() : [];
}

/**
 * What the UI should say about menu freshness.
 * state: 'loading' | 'none' | 'stale' | 'ending' | 'ok'
 */
export function coverage(hallId = DEFAULT_HALL) {
  if (!index) return { state: loadedAt ? 'none' : 'loading', error: loadError };
  const today = todayIso();
  const end = index.hallEnd?.[hallId] || index.end;
  // status.json (written on every check) only ships with the Pages site; otherwise
  // all we know is when the menus last changed.
  const checkedAt = status?.checkedAt || index.updatedAt;
  const checkedLabel = status ? 'Checked' : 'Menus updated';
  const lastCheckFailed = status ? !status.ok : false;
  if (!end) return { state: 'none', checkedAt, checkedLabel, lastCheckFailed };
  const daysLeft = daysBetween(today, end);
  let state = 'ok';
  if (daysLeft < 0) state = 'stale';
  else if (daysLeft <= 2) state = 'ending';
  return { state, end, daysLeft, checkedAt, checkedLabel, updatedAt: index.updatedAt, lastCheckFailed };
}

// ---------------------------------------------------------------- GitHub

export function repoInfo() {
  if (index?.repo && index.repo.includes('/')) {
    const [owner, repo] = index.repo.split('/');
    return { owner, repo };
  }
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner: m[1], repo: seg || `${m[1]}.github.io` };
  }
  return null;
}

export function actionsUrl() {
  const r = repoInfo();
  return r ? `https://github.com/${r.owner}/${r.repo}/actions/workflows/${WORKFLOW_FILE}` : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(url, token, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token. Check it in Goals → Menu updates.');
  if (res.status === 403) throw new Error('The token needs “Actions: Read and write” on this repository.');
  if (res.status === 404) throw new Error('GitHub could not find the repo or workflow with that token.');
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

/**
 * Runs the update workflow on GitHub and waits for it to finish (≈1–2 min),
 * then reloads the menu index. onProgress(text) receives status updates.
 */
export async function triggerRefresh(token, onProgress = () => {}) {
  const r = repoInfo();
  if (!r) throw new Error('Could not tell which GitHub repo this site comes from.');
  const api = `https://api.github.com/repos/${r.owner}/${r.repo}`;

  onProgress('Contacting GitHub…');
  const repo = await gh(api, token);
  const startedAt = Date.now();
  const dispatched = await gh(`${api}/actions/workflows/${WORKFLOW_FILE}/dispatches`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: repo.default_branch }),
  });

  let run = null;
  for (let i = 0; i < 50; i++) {
    await sleep(i === 0 ? 4000 : 6000);
    if (dispatched?.workflow_run_id) {
      run = await gh(`${api}/actions/runs/${dispatched.workflow_run_id}`, token);
    } else {
      const list = await gh(`${api}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=5`, token);
      run = list?.workflow_runs?.find((w) => new Date(w.created_at).getTime() >= startedAt - 60e3) || null;
    }
    if (!run) {
      onProgress('Waiting for GitHub to start the job…');
      continue;
    }
    if (run.status === 'completed') break;
    onProgress(run.status === 'queued' ? 'Queued on GitHub…' : 'Fetching the latest menus from UMass Dining…');
  }
  if (!run || run.status !== 'completed') throw new Error('Still running on GitHub. Check back in a minute.');
  onProgress('Loading new menus…');
  await loadIndex({ force: true });
  if (run.conclusion !== 'success') {
    throw new Error('The update job reported a problem (UMass Dining may be down). Open GitHub Actions for details.');
  }
  return index;
}
