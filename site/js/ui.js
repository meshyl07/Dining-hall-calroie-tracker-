import { getState } from './store.js';
import { kgToLb, lbToKg } from './nutrition.js';

// ---------------------------------------------------------------- strings

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const fmt = (n, digits = 0) =>
  n == null || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const g = (n) => (n == null ? '—' : `${fmt(n, n < 10 && n % 1 ? 1 : 0)}g`);

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- units

export const isMetric = () => getState().prefs.units === 'metric';
export const weightUnit = () => (isMetric() ? 'kg' : 'lb');
export const toDisplayWeight = (kg) => (kg == null ? null : isMetric() ? kg : kgToLb(kg));
export const fromDisplayWeight = (v) => (isMetric() ? Number(v) : lbToKg(Number(v)));
export const fmtWeight = (kg, digits = 1) => (kg == null ? '—' : `${fmt(toDisplayWeight(kg), digits)} ${weightUnit()}`);

// ---------------------------------------------------------------- icons

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-1 2-2 3-3 3 0-2-1-4-3-6 0 4-4 7-4 13 0 4 3 7 7 7Z"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 9a5 5 0 0 1 8 0l-3 3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  leaf: '<path d="M5 21c0-9 5-15 15-16-1 10-7 15-15 16Z"/><path d="M5 21 14 12"/>',
  trendDown: '<path d="m3 7 7 7 4-4 7 7"/><path d="M21 11v6h-6"/>',
  trendUp: '<path d="m3 17 7-7 4 4 7-7"/><path d="M21 13V7h-6"/>',
  equal: '<path d="M5 9h14M5 15h14"/>',
  shuffle: '<path d="M4 17h3l10-10h3M4 7h3l3 3M14 14l3 3h3"/><path d="m18 4 2 3-2 3M18 14l2 3-2 3"/>',
  plate: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  dumbbell: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="m9 21 2-6 3 3v3M7 12l2-4 4 1 3 3 2 1M11 15l-1-4"/>',
  sofa: '<path d="M4 10V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2M2 12a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2zM5 17v2M19 17v2"/>',
  run: '<circle cx="15" cy="4" r="2"/><path d="m4 20 4-2 2-4M13 21l1-5-3-3 2-5 3 3 3 1M8 10l3-2"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
};

export function icon(name, extra = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`;
}

// ---------------------------------------------------------------- rings & bars

export function ring({ value, max, size = 150, stroke = 14, color = 'var(--cal)', track = 'var(--track)' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = c * (1 - pct);
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    ${value > 0 ? `<circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>` : ''}
  </svg>`;
}

export function macroBar({ label, key, value, target }) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  const left = Math.round(target - value);
  const leftText = !target ? '' : left > 0 ? `${left}g left` : left === 0 ? 'Goal hit' : `${-left}g over`;
  return `<div class="macro">
    <div class="top">
      <span class="name"><i style="background:var(--${key})"></i>${label}</span>
      <span class="val"><b>${fmt(value)}</b> / ${fmt(target)}g</span>
    </div>
    <div class="bar" role="progressbar" aria-label="${label}" aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="${target || 0}"><span style="width:${pct}%;background:var(--${key})"></span></div>
    <div class="left">${leftText}</div>
  </div>`;
}

export function pcf(n, servings = 1) {
  const v = (k) => (n?.[k] == null ? '—' : fmt(n[k] * servings));
  return `<span class="pcf"><span><i class="dot-p"></i>P ${v('protein')}</span><span><i class="dot-c"></i>C ${v('carbs')}</span><span><i class="dot-f"></i>F ${v('fat')}</span></span>`;
}

// ---------------------------------------------------------------- sheet

let sheetCleanup = null;

export function openSheet(html, onMount) {
  closeSheet(true);
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="grabber"></div>
      <button class="icon-btn sm ghost close" data-close aria-label="Close">${icon('close')}</button>
      <div class="sheet-body">${html}</div>
    </div>`;
  const backdrop = root.querySelector('.sheet-backdrop');
  const sheet = root.querySelector('.sheet');
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  });
  backdrop.addEventListener('click', () => closeSheet());
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet());
  const onKey = (e) => e.key === 'Escape' && closeSheet();
  document.addEventListener('keydown', onKey);
  sheetCleanup = () => document.removeEventListener('keydown', onKey);
  const body = sheet.querySelector('.sheet-body');
  onMount?.(body, sheet);
  return body;
}

export function closeSheet(immediate = false) {
  const root = document.getElementById('sheet-root');
  if (!root.firstChild) return;
  sheetCleanup?.();
  sheetCleanup = null;
  if (immediate) {
    root.innerHTML = '';
    return;
  }
  root.querySelector('.sheet-backdrop')?.classList.remove('open');
  root.querySelector('.sheet')?.classList.remove('open');
  setTimeout(() => {
    if (!root.querySelector('.sheet.open')) root.innerHTML = '';
  }, 260);
}

// ---------------------------------------------------------------- toast

let toastTimer;
export function toast(message, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) {
    el.querySelector('button').onclick = () => {
      el.classList.remove('show');
      action.onClick();
    };
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2600);
}

// ---------------------------------------------------------------- misc

export function numberInput(v) {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
