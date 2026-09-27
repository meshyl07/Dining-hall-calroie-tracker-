// Small hand-rolled SVG charts with hover/focus tooltips.
import { fmt } from './ui.js';

const W = 520;

function niceStep(max, ticks = 4) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

// Column with a 4px rounded data end, square at the baseline.
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function attachTooltip(container, targets, contentFor) {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  container.appendChild(tip);
  const svg = container.querySelector('svg');
  const show = (el) => {
    const i = Number(el.dataset.i);
    const { value, label, x, y } = contentFor(i);
    tip.replaceChildren();
    const b = document.createElement('b');
    b.textContent = value;
    const l = document.createElement('div');
    l.textContent = label;
    tip.append(b, l);
    const scale = svg.getBoundingClientRect().width / W;
    tip.style.left = `${Math.min(Math.max(x * scale, 50), svg.getBoundingClientRect().width - 50)}px`;
    tip.style.top = `${y * scale}px`;
    tip.classList.add('show');
    container.querySelectorAll('.mark.active').forEach((m) => m.classList.remove('active'));
    container.querySelector(`.mark[data-i="${i}"]`)?.classList.add('active');
  };
  const hide = () => {
    tip.classList.remove('show');
    container.querySelectorAll('.mark.active').forEach((m) => m.classList.remove('active'));
  };
  targets.forEach((el) => {
    el.addEventListener('pointerenter', () => show(el));
    el.addEventListener('pointerdown', () => show(el));
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hide);
  });
  container.addEventListener('pointerleave', hide);
}

/**
 * Single-series column chart with an optional goal line.
 * data: [{ key, label, value|null, tip }]
 */
export function barChart(container, { data, goal, color = 'var(--cal)', unit = '', height = 190, goalLabel = 'Goal' }) {
  const m = { t: 14, r: 8, b: 24, l: 40 };
  const ih = height - m.t - m.b;
  const iw = W - m.l - m.r;
  const maxVal = Math.max(goal || 0, ...data.map((d) => d.value || 0), 1);
  const step = niceStep(maxVal * 1.08);
  const top = Math.ceil((maxVal * 1.08) / step) * step;
  const y = (v) => m.t + ih - (v / top) * ih;
  const band = iw / data.length;
  const bw = Math.max(3, Math.min(24, band * 0.62));
  const labelEvery = data.length <= 10 ? 1 : data.length <= 31 ? 5 : 15;

  let grid = '';
  for (let v = step; v <= top + 0.001; v += step) {
    grid += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`;
  }
  let bars = '';
  let hits = '';
  let labels = '';
  data.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    if (d.value > 0) {
      const h = Math.max(1, (d.value / top) * ih);
      bars += `<path class="mark" data-i="${i}" d="${columnPath(cx - bw / 2, m.t + ih - h, bw, h)}" fill="${color}"/>`;
    }
    hits += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" tabindex="0" aria-label="${d.label}: ${d.value == null ? 'no data' : fmt(d.value) + unit}"/>`;
    if (i % labelEvery === 0 || data.length <= 10) {
      labels += `<text class="tick" x="${cx}" y="${height - 6}" text-anchor="middle">${d.label}</text>`;
    }
  });
  const goalLine = goal
    ? `<line class="goal-line" x1="${m.l}" x2="${W - m.r}" y1="${y(goal)}" y2="${y(goal)}"/>`
    : '';

  container.innerHTML = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Column chart">
    ${grid}<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>
    <text class="tick" x="${m.l - 8}" y="${m.t + ih + 3.5}" text-anchor="end">0</text>
    ${goalLine}${bars}${hits}${labels}
  </svg>`;
  if (goal) {
    const lg = document.createElement('div');
    lg.className = 'legend';
    lg.innerHTML = `<span><i class="line" style="background:var(--ink);opacity:.55"></i>${goalLabel} ${fmt(goal)}${unit}</span>`;
    container.appendChild(lg);
  }
  attachTooltip(container, container.querySelectorAll('.hit'), (i) => {
    const d = data[i];
    const cx = m.l + band * i + band / 2;
    return {
      value: d.value == null ? 'Not logged' : `${fmt(d.value)}${unit}`,
      label: d.tip || d.label,
      x: cx,
      y: d.value > 0 ? y(d.value) : m.t + ih,
    };
  });
}

/**
 * Weight line: [{ x (day index), label, value }], optional target reference line.
 */
export function lineChart(container, { points, domain, target, unit = '', height = 190, color = 'var(--protein)', xLabels = [] }) {
  const m = { t: 14, r: 12, b: 24, l: 40 };
  const ih = height - m.t - m.b;
  const iw = W - m.l - m.r;
  const vals = points.map((p) => p.value).concat(target ? [target] : []);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 4) {
    lo -= 2;
    hi += 2;
  }
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const [d0, d1] = domain;
  const x = (v) => m.l + ((v - d0) / Math.max(d1 - d0, 1)) * iw;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  let grid = '';
  for (let v = lo; v <= hi + 0.001; v += step) {
    grid += `<line class="${v === lo ? 'base' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${m.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = points.length > 1
    ? `<path d="${path}L${x(points[points.length - 1].x)},${m.t + ih}L${x(points[0].x)},${m.t + ih}Z" fill="${color}" opacity="0.1"/>`
    : '';
  const dots = points
    .map((p, i) => `<circle class="mark" data-i="${i}" cx="${x(p.x)}" cy="${y(p.value)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`)
    .join('');
  const hits = points
    .map((p, i) => `<circle class="hit" data-i="${i}" cx="${x(p.x)}" cy="${y(p.value)}" r="13" tabindex="0" aria-label="${p.label}: ${fmt(p.value, 1)}${unit}"/>`)
    .join('');
  const targetLine = target
    ? `<line class="goal-line" x1="${m.l}" x2="${W - m.r}" y1="${y(target)}" y2="${y(target)}"/>`
    : '';
  const labels = xLabels
    .map((l) => `<text class="tick" x="${x(l.x)}" y="${height - 6}" text-anchor="middle">${l.label}</text>`)
    .join('');

  container.innerHTML = `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="Weight trend">
    ${grid}${targetLine}${area}
    ${points.length > 1 ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${dots}${hits}${labels}
  </svg>`;
  if (target) {
    const lg = document.createElement('div');
    lg.className = 'legend';
    lg.innerHTML = `<span><i class="line" style="background:${color}"></i>Weigh-ins</span><span><i class="line" style="background:var(--ink);opacity:.55"></i>Goal ${fmt(target, 1)}${unit}</span>`;
    container.appendChild(lg);
  }
  attachTooltip(container, container.querySelectorAll('.hit'), (i) => ({
    value: `${fmt(points[i].value, 1)}${unit}`,
    label: points[i].label,
    x: x(points[i].x),
    y: y(points[i].value),
  }));
}
