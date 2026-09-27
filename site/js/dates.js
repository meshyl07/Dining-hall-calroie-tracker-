// Dates are handled as ISO strings (YYYY-MM-DD) everywhere so they never
// shift with time zones or daylight saving.

const pad = (n) => String(n).padStart(2, '0');

export function isoFromDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso() {
  return isoFromDate(new Date());
}

// Today's date in a specific time zone (the scraper runs in UTC on GitHub).
export function todayInTimeZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// Local-midnight Date for formatting.
export function dateFromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return dateFromIso(iso).toLocaleDateString('en-US', opts);
}

export function relativeDayLabel(iso, today = todayIso()) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return fmtDate(iso);
}

export function weekdayShort(iso) {
  return dateFromIso(iso).toLocaleDateString('en-US', { weekday: 'narrow' });
}

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, (now - new Date(ts).getTime()) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 36) return `${Math.round(h)} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}
