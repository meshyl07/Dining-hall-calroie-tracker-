// Fetches and parses menus from UMass Dining's menu endpoint.
//
// GET https://umassdining.com/foodpro-menu-ajax?tid=<location>&date=MM/DD/YYYY
// returns JSON shaped like:
//   { "lunch_menu": { "Grill": "<li class=\"lightbox-nutrition\"><a href=\"#inline\"
//        data-dish-name=\"Cheeseburger\" data-serving-size=\"1 each\" data-calories=\"450\"
//        data-total-fat=\"22g\" data-total-carb=\"33g\" data-protein=\"28g\" ...>Cheeseburger</a></li>..." } }
// or `[]` when nothing is published for that day.

export const MENU_ENDPOINT = 'https://umassdining.com/foodpro-menu-ajax';

const USER_AGENT =
  'Mozilla/5.0 (compatible; umass-dining-calorie-tracker/1.0; personal use; +https://github.com)';

export function menuUrl(tid, isoDate) {
  const [y, m, d] = isoDate.split('-');
  const params = new URLSearchParams({ tid: String(tid), date: `${m}/${d}/${y}` });
  return `${MENU_ENDPOINT}?${params}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchMenuJson(tid, isoDate, { fetchImpl = fetch, retries = 3, timeoutMs = 20000 } = {}) {
  const url = menuUrl(tid, isoDate);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetchImpl(url, {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'User-Agent': USER_AGENT,
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        continue;
      }
      const text = (await res.text()).replace(/^﻿/, '').trim();
      if (!text) return [];
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 120)}`);
      }
    } catch (err) {
      lastErr = err;
      if (String(err.message).startsWith('Expected JSON')) break;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------- parsing

export function normalizeMealKey(key) {
  const k = String(key)
    .toLowerCase()
    .replace(/_?menu$/, '')
    .replace(/[^a-z]/g, '');
  if (!k) return null;
  if (k === 'grabandgo' || k === 'grabngo' || k === 'grabgo') return 'grabngo';
  return k;
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™',
  copy: '©', eacute: 'é', egrave: 'è', aacute: 'á', ntilde: 'ñ', uuml: 'ü', ouml: 'ö',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', frac12: '½', deg: '°',
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v ?? m;
  });
}

export function cleanText(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// "12g" -> 12, "1.5 g" -> 1.5, "<1g" / "less than 1g" -> 0.5, "" / "N/A" -> null
export function parseNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (/^(<|less than)\s*1(\D|$)/.test(s)) return 0.5;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

// Quote-aware so a ">" inside an attribute value (ingredient lists) can't end the tag early.
const A_TAG = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi;
const ATTR = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseAttributes(attrText) {
  const attrs = {};
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(attrText))) {
    const name = m[1].toLowerCase();
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

function first(attrs, ...names) {
  for (const n of names) {
    if (attrs[n] !== undefined && String(attrs[n]).trim() !== '') return attrs[n];
  }
  return undefined;
}

function splitList(s) {
  if (!s) return [];
  return String(s)
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function itemFromAttributes(attrs, innerHtml = '') {
  const name = cleanText(first(attrs, 'data-dish-name', 'data-name', 'title') ?? innerHtml);
  if (!name) return null;
  const item = {
    name,
    serving: cleanText(first(attrs, 'data-serving-size', 'data-portion') ?? '') || undefined,
    cal: parseNum(first(attrs, 'data-calories', 'data-kcal')),
    protein: parseNum(first(attrs, 'data-protein')),
    carbs: parseNum(first(attrs, 'data-total-carb', 'data-total-carbohydrate', 'data-total-carbs', 'data-carbohydrates', 'data-carbs')),
    fat: parseNum(first(attrs, 'data-total-fat', 'data-fat')),
    satFat: parseNum(first(attrs, 'data-sat-fat', 'data-saturated-fat')),
    fiber: parseNum(first(attrs, 'data-dietary-fiber', 'data-fiber')),
    sugar: parseNum(first(attrs, 'data-sugars', 'data-sugar')),
    sodium: parseNum(first(attrs, 'data-sodium')),
    chol: parseNum(first(attrs, 'data-cholesterol')),
    allergens: cleanText(first(attrs, 'data-allergens') ?? '') || undefined,
    diets: splitList(cleanText(first(attrs, 'data-clean-diet-str', 'data-diet', 'data-diets') ?? '')),
  };
  if (!item.diets.length) delete item.diets;
  for (const k of Object.keys(item)) if (item[k] === null || item[k] === undefined) delete item[k];
  return item;
}

export function parseItemsHtml(html) {
  const items = [];
  const seen = new Set();
  let m;
  A_TAG.lastIndex = 0;
  while ((m = A_TAG.exec(html))) {
    const attrs = parseAttributes(m[1]);
    if (!('data-dish-name' in attrs) && !('data-calories' in attrs)) continue;
    const item = itemFromAttributes(attrs, m[2]);
    if (!item) continue;
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}

// -> { lunch: [ { name: 'Grill', items: [...] } ], dinner: [...] }
export function parseMenuResponse(json) {
  const meals = {};
  if (!json || typeof json !== 'object' || Array.isArray(json)) return meals;
  for (const [rawMeal, cats] of Object.entries(json)) {
    const meal = normalizeMealKey(rawMeal);
    if (!meal) continue;
    let entries = [];
    if (typeof cats === 'string') entries = [['Menu', cats]];
    else if (Array.isArray(cats)) entries = cats.map((c) => ['Menu', c]);
    else if (cats && typeof cats === 'object') entries = Object.entries(cats);
    const categories = [];
    for (const [catName, html] of entries) {
      if (typeof html !== 'string') continue;
      const items = parseItemsHtml(html);
      if (!items.length) continue;
      const name = cleanText(catName) || 'Menu';
      const existing = categories.find((c) => c.name === name);
      if (existing) existing.items.push(...items);
      else categories.push({ name, items });
    }
    if (categories.length) meals[meal] = categories;
  }
  return meals;
}
