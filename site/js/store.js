// All personal data lives in this browser's localStorage under one key.
import { DEFAULT_HALL } from './halls.js';

const KEY = 'dhct:v1';

export function defaults() {
  return {
    version: 1,
    profile: null, // filled in by the goals questionnaire
    targets: null, // { calories, protein, carbs, fat, source: 'plan' | 'custom' }
    prefs: {
      units: 'imperial',
      theme: 'auto',
      defaultHall: DEFAULT_HALL,
      defaultMeal: 'lunch', // 'auto' follows the clock
      diningMeals: ['lunch'],
      ghToken: '',
    },
    log: {}, // { 'YYYY-MM-DD': [entry] }
    weights: [], // [{ date, kg }]
    favorites: {}, // { key: { name, hall, serving, n } }
    myFoods: [], // [{ id, name, serving, n }]
    createdAt: new Date().toISOString(),
  };
}

function migrate(s) {
  const d = defaults();
  return {
    ...d,
    ...s,
    prefs: { ...d.prefs, ...(s.prefs || {}) },
    log: s.log || {},
    weights: s.weights || [],
    favorites: s.favorites || {},
    myFoods: s.myFoods || [],
  };
}

export let storageOk = true;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch {
    storageOk = false;
  }
  return defaults();
}

let state = load();
const listeners = new Set();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(mutator) {
  mutator(state);
  save();
  for (const fn of listeners) fn(state);
}

// Ask the browser not to evict our storage (helps on iOS / when disk is low).
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    /* not supported */
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------------------------------------------------------------- log

export function entriesFor(date) {
  return state.log[date] || [];
}

export function addEntry(date, entry) {
  const e = { id: uid(), at: Date.now(), servings: 1, ...entry };
  update((s) => {
    (s.log[date] ||= []).push(e);
  });
  return e;
}

export function updateEntry(date, id, patch) {
  update((s) => {
    const e = (s.log[date] || []).find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  });
}

export function removeEntry(date, id) {
  let removed = null;
  update((s) => {
    const list = s.log[date] || [];
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) [removed] = list.splice(i, 1);
    if (!list.length) delete s.log[date];
  });
  return removed;
}

export function restoreEntry(date, entry) {
  update((s) => {
    (s.log[date] ||= []).push(entry);
  });
}

export function loggedDates() {
  return Object.keys(state.log).filter((d) => state.log[d]?.length).sort();
}

// Unique foods you've logged recently, newest first.
export function recentFoods(limit = 30) {
  const seen = new Set();
  const out = [];
  for (const date of loggedDates().reverse()) {
    for (const e of [...state.log[date]].reverse()) {
      const k = foodKey(e.name);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------- weights

export function setWeight(date, kg) {
  update((s) => {
    s.weights = s.weights.filter((w) => w.date !== date);
    s.weights.push({ date, kg: Math.round(kg * 100) / 100 });
    s.weights.sort((a, b) => a.date.localeCompare(b.date));
    if (s.profile) s.profile.weightKg = s.weights[s.weights.length - 1].kg;
  });
}

export function removeWeight(date) {
  update((s) => {
    s.weights = s.weights.filter((w) => w.date !== date);
  });
}

export function latestWeight() {
  return state.weights[state.weights.length - 1] || null;
}

// ---------------------------------------------------------------- favorites & my foods

export const foodKey = (name) => String(name || '').trim().toLowerCase();

export function isFavorite(name) {
  return !!state.favorites[foodKey(name)];
}

export function toggleFavorite(food) {
  const k = foodKey(food.name);
  let on = false;
  update((s) => {
    if (s.favorites[k]) delete s.favorites[k];
    else {
      s.favorites[k] = { name: food.name, hall: food.hall, serving: food.serving, n: food.n, at: Date.now() };
      on = true;
    }
  });
  return on;
}

export function saveMyFood(food) {
  const f = { id: uid(), ...food };
  update((s) => {
    s.myFoods = s.myFoods.filter((x) => foodKey(x.name) !== foodKey(f.name));
    s.myFoods.unshift(f);
  });
  return f;
}

export function removeMyFood(id) {
  update((s) => {
    s.myFoods = s.myFoods.filter((x) => x.id !== id);
  });
}

// ---------------------------------------------------------------- profile

export function setPlan(profile, targets) {
  update((s) => {
    s.profile = { ...profile, updatedAt: new Date().toISOString() };
    s.targets = targets;
  });
}

export function setPrefs(patch) {
  update((s) => {
    Object.assign(s.prefs, patch);
  });
}

// ---------------------------------------------------------------- backup

export function exportData() {
  return JSON.stringify({ app: 'umass-dining-calorie-tracker', exportedAt: new Date().toISOString(), data: state }, null, 1);
}

export function importData(text) {
  const parsed = JSON.parse(text);
  const data = parsed?.data ?? parsed;
  if (!data || typeof data !== 'object' || !('log' in data)) throw new Error('That file is not a tracker backup.');
  update((s) => {
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, migrate(data));
  });
}

export function resetAll() {
  update((s) => {
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, defaults());
  });
}
