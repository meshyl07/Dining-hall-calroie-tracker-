import { getState, entriesFor, setWeight, update, loggedDates } from '../store.js';
import { sumEntries, estimateTdee, linearFit, computePlan, kgToLb } from '../nutrition.js';
import { todayIso, addDays, fmtDate, daysBetween, dateFromIso } from '../dates.js';
import { esc, fmt, icon, toast, weightUnit, toDisplayWeight, fromDisplayWeight, numberInput, isMetric } from '../ui.js';
import { barChart, lineChart } from '../charts.js';

let range = 7;

function dayLabel(iso, n) {
  const d = dateFromIso(iso);
  if (n <= 7) return d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function streak(today) {
  let d = entriesFor(today).length ? today : addDays(today, -1);
  let n = 0;
  while (entriesFor(d).length) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

function adaptiveInsight(s, today) {
  const start = addDays(today, -28);
  const daily = [];
  for (let i = 0; i < 28; i++) {
    const d = addDays(start, i);
    const cal = sumEntries(entriesFor(d)).cal;
    if (cal >= 800) daily.push({ dayIndex: i, cal });
  }
  const weights = s.weights
    .filter((w) => w.date >= start && w.date <= today)
    .map((w) => ({ dayIndex: daysBetween(start, w.date), lb: kgToLb(w.kg) }));
  const est = estimateTdee(daily, weights);
  const needs = [];
  if (daily.length < 10) needs.push(`${10 - daily.length} more fully-logged days`);
  if (weights.length < 3) needs.push(`${3 - weights.length} more weigh-ins`);
  if (!est) {
    return `<section class="card"><div class="coach"><div class="coach-icon">${icon('flame')}</div><div>
      <h3>Your real maintenance calories</h3>
      <p>Log food and weigh in a few times a week and this app will work out what you actually burn, then fine-tune your target.${needs.length ? ` Needs ${needs.join(' and ')} in the last 4 weeks.` : ' Needs weigh-ins spread over at least 10 days.'}</p>
    </div></div></section>`;
  }
  const plan = s.profile ? computePlan(s.profile) : null;
  const diff = plan ? est.tdee - plan.tdee : 0;
  const suggest = plan && Math.abs(diff) >= 150;
  const newCal = plan ? Math.round((est.tdee + plan.dailyDelta) / 10) * 10 : null;
  return `<section class="card"><div class="coach"><div class="coach-icon">${icon('flame')}</div><div style="flex:1">
    <h3>Estimated maintenance: ${fmt(est.tdee)} kcal</h3>
    <p>From ${est.days} logged days averaging ${fmt(est.avgIntake)} kcal while your weight moved ${est.lbPerWeek >= 0 ? '+' : '−'}${fmt(Math.abs(isMetric() ? est.lbPerWeek / 2.20462 : est.lbPerWeek), 2)} ${weightUnit()}/week.
    ${plan ? ` Your plan assumed ${fmt(plan.tdee)}.` : ''}</p>
    ${suggest ? `<button class="btn sm" data-adapt="${newCal}" style="margin-top:10px">Set target to ${fmt(newCal)} kcal</button>` : ''}
  </div></div></section>`;
}

export function renderTrends(root) {
  const s = getState();
  const t = s.targets || {};
  const today = todayIso();
  const dates = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1));
  const rows = dates.map((d) => ({ date: d, ...sumEntries(entriesFor(d)), n: entriesFor(d).length }));
  const logged = rows.filter((r) => r.n);
  const avg = (k) => (logged.length ? logged.reduce((a, r) => a + r[k], 0) / logged.length : null);
  const proteinHits = logged.filter((r) => t.protein && r.protein >= t.protein * 0.95).length;
  const calOnTarget = logged.filter((r) => t.calories && Math.abs(r.cal - t.calories) <= t.calories * 0.1).length;

  // weight
  const wIn = s.weights.filter((w) => w.date >= dates[0] && w.date <= today);
  const recent = s.weights.filter((w) => w.date >= addDays(today, -28));
  const fit = recent.length >= 2 ? linearFit(recent.map((w) => ({ x: daysBetween(today, w.date), y: toDisplayWeight(w.kg) }))) : null;
  const ratePerWeek = fit ? fit.slope * 7 : null;
  const latest = s.weights[s.weights.length - 1];
  const targetKg = s.profile?.targetWeightKg;
  let eta = '';
  if (latest && targetKg && ratePerWeek) {
    const remaining = toDisplayWeight(targetKg) - toDisplayWeight(latest.kg);
    const weeks = remaining / ratePerWeek;
    if (Math.abs(remaining) < 0.5) eta = 'You’re at your goal weight.';
    else if (weeks > 0 && weeks < 200) eta = `At this pace you’ll reach ${fmt(toDisplayWeight(targetKg), 1)} ${weightUnit()} around ${fmtDate(addDays(today, Math.round(weeks * 7)), { month: 'short', day: 'numeric', year: 'numeric' })}.`;
    else eta = 'Your recent trend is moving away from your goal weight.';
  }

  const topFoods = (() => {
    const counts = new Map();
    for (const d of loggedDates().filter((x) => x >= dates[0])) {
      for (const e of entriesFor(d)) {
        const k = e.name.toLowerCase();
        const c = counts.get(k) || { name: e.name, n: 0, protein: 0 };
        c.n++;
        c.protein += (e.n.protein || 0) * e.servings;
        counts.set(k, c);
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  })();

  root.innerHTML = `
    <header class="page-head"><div><div class="eyebrow">Last ${range} days</div><h1>Trends</h1></div></header>
    <div class="segmented" role="group" aria-label="Range" style="margin-bottom:14px">
      ${[7, 30, 90].map((n) => `<button data-range="${n}" aria-pressed="${n === range}">${n} days</button>`).join('')}
    </div>

    <div class="tiles">
      <div class="tile"><div class="label">Avg calories</div><div class="value">${fmt(avg('cal'))}</div><div class="delta">${t.calories && avg('cal') != null ? `${avg('cal') > t.calories ? '+' : '−'}${fmt(Math.abs(avg('cal') - t.calories))} vs goal` : 'per logged day'}</div></div>
      <div class="tile"><div class="label">Avg protein</div><div class="value">${fmt(avg('protein'))}<small>g</small></div><div class="delta">${t.protein ? `goal ${fmt(t.protein)}g` : ''}</div></div>
      <div class="tile"><div class="label">Protein goal hit</div><div class="value">${proteinHits}<small> / ${logged.length} days</small></div><div class="delta">${calOnTarget} days within 10% of calories</div></div>
      <div class="tile"><div class="label">Logging streak</div><div class="value">${streak(today)}<small> days</small></div><div class="delta">${logged.length} of ${range} days logged</div></div>
    </div>

    <section class="card"><div class="card-title"><h2>Calories</h2><span class="sub">kcal per day</span></div><div class="chart" data-cal></div></section>
    <section class="card"><div class="card-title"><h2>Protein</h2><span class="sub">grams per day</span></div><div class="chart" data-protein></div></section>

    <section class="card">
      <div class="card-title"><h2>Average macros</h2><span class="sub">logged days</span></div>
      ${['protein', 'carbs', 'fat'].map((k) => {
        const v = avg(k);
        const goal = t[k] || 0;
        const pct = goal && v != null ? Math.min((v / goal) * 100, 100) : 0;
        return `<div class="avg-row"><span class="name"><i style="background:var(--${k})"></i>${k[0].toUpperCase() + k.slice(1)}</span>
          <div class="bar"><span style="width:${pct}%;background:var(--${k})"></span></div>
          <span class="v"><b>${fmt(v)}</b> / ${fmt(goal)}g</span></div>`;
      }).join('')}
    </section>

    <section class="card">
      <div class="card-title"><h2>Weight</h2><span class="sub">${latest ? `${fmt(toDisplayWeight(latest.kg), 1)} ${weightUnit()} · ${fmtDate(latest.date, { month: 'short', day: 'numeric' })}` : ''}</span></div>
      <div class="row" style="margin-bottom:12px">
        <div class="input-unit" style="flex:1"><input class="input" type="number" inputmode="decimal" step="0.1" placeholder="Today’s weight" data-weight aria-label="Today's weight"><span>${weightUnit()}</span></div>
        <button class="btn" data-log-weight>Log</button>
      </div>
      ${wIn.length ? '<div class="chart" data-weight-chart></div>' : `<p class="muted small">${s.weights.length ? 'No weigh-ins in this range yet.' : 'Weigh in 2–3× a week (morning, after the bathroom) to see your trend.'}</p>`}
      ${ratePerWeek != null ? `<p class="small ink-2" style="margin-top:10px">4-week trend: <b>${ratePerWeek >= 0 ? '+' : '−'}${fmt(Math.abs(ratePerWeek), 2)} ${weightUnit()}/week</b>. ${esc(eta)}</p>` : ''}
    </section>

    ${adaptiveInsight(s, today)}

    ${topFoods.length ? `<section class="card"><div class="card-title"><h2>Most logged</h2><span class="sub">last ${range} days</span></div>
      <ul class="list">${topFoods.map((f) => `<li class="item compact"><div class="main"><div class="title">${esc(f.name)}</div><div class="meta">${fmt(f.protein / f.n)}g protein avg</div></div><div class="kcal"><b>${f.n}×</b></div></li>`).join('')}</ul></section>` : ''}

    <details class="details-table card"><summary>Daily table</summary>
      <table><thead><tr><th>Day</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr></thead><tbody>
      ${[...rows].reverse().map((r) => `<tr><td>${fmtDate(r.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}</td><td>${r.n ? fmt(r.cal) : '—'}</td><td>${r.n ? fmt(r.protein) : '—'}</td><td>${r.n ? fmt(r.carbs) : '—'}</td><td>${r.n ? fmt(r.fat) : '—'}</td></tr>`).join('')}
      </tbody></table></details>
  `;

  const chartData = (k) =>
    rows.map((r) => ({
      label: dayLabel(r.date, range),
      value: r.n ? Math.round(r[k]) : null,
      tip: fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' }),
    }));
  barChart(root.querySelector('[data-cal]'), { data: chartData('cal'), goal: t.calories, unit: ' kcal', color: 'var(--cal)' });
  barChart(root.querySelector('[data-protein]'), { data: chartData('protein'), goal: t.protein, unit: 'g', color: 'var(--protein)' });

  const wc = root.querySelector('[data-weight-chart]');
  if (wc) {
    const every = range <= 7 ? 1 : range <= 30 ? 7 : 21;
    lineChart(wc, {
      points: wIn.map((w) => ({ x: daysBetween(dates[0], w.date), value: toDisplayWeight(w.kg), label: fmtDate(w.date) })),
      domain: [0, range - 1],
      target: targetKg ? Math.round(toDisplayWeight(targetKg) * 10) / 10 : null,
      unit: ` ${weightUnit()}`,
      xLabels: dates.map((d, i) => ({ x: i, label: dayLabel(d, range) })).filter((_, i) => i % every === 0),
    });
  }

  root.querySelectorAll('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      range = Number(b.dataset.range);
      renderTrends(root);
    }),
  );
  root.querySelector('[data-log-weight]').addEventListener('click', () => {
    const v = numberInput(root.querySelector('[data-weight]').value);
    const kg = v && fromDisplayWeight(v);
    if (!kg || kg < 30 || kg > 300) {
      toast('Enter a realistic weight');
      return;
    }
    setWeight(today, kg);
    toast(`Logged ${fmt(v, 1)} ${weightUnit()}`);
  });
  root.querySelector('[data-adapt]')?.addEventListener('click', (e) => {
    const calories = Number(e.currentTarget.dataset.adapt);
    update((st) => {
      const protein = st.targets.protein;
      const fat = Math.round((calories * 0.28) / 9 / 5) * 5;
      const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4 / 5) * 5);
      st.targets = { ...st.targets, calories, fat, carbs, source: 'adaptive' };
    });
    toast(`Calorie target set to ${fmt(calories)}`);
  });
}
