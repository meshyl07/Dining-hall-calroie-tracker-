import { getState, entriesFor } from '../store.js';
import { LOG_MEALS, hallById, upcomingMeal, diningMealLabel, logMealForDining } from '../halls.js';
import { sumEntries, bestProteinPicks } from '../nutrition.js';
import { todayIso, addDays, fmtDate, relativeDayLabel, dateFromIso } from '../dates.js';
import { getIndex, hallMeals, loadDay } from '../menus.js';
import { esc, fmt, icon, ring, macroBar, pcf } from '../ui.js';
import { openFoodSheet, openEntrySheet, openQuickAdd } from './food-sheet.js';

function weekStrip(selected) {
  const s = getState();
  const today = todayIso();
  const start = addDays(selected, -dateFromIso(selected).getDay());
  const target = s.targets?.calories || 0;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return `<div class="row" style="gap:4px;margin-bottom:14px">
    <button class="icon-btn sm ghost" data-week="-7" aria-label="Previous week">${icon('chevronLeft')}</button>
    <div class="week" style="flex:1;margin:0">${days
      .map((d) => {
        const cal = sumEntries(entriesFor(d)).cal;
        const pct = target ? Math.min(cal / target, 1) : 0;
        const cls = [d === today && 'today', d > today && 'future'].filter(Boolean).join(' ');
        const r = 15.5;
        const c = 2 * Math.PI * r;
        const arc = cal > 0 && d !== selected
          ? `<svg viewBox="0 0 34 34" aria-hidden="true" style="transform:rotate(-90deg)"><circle cx="17" cy="17" r="${r}" fill="none" stroke="var(--cal)" stroke-width="2" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" opacity="0.8"/></svg>`
          : '';
        return `<button class="${cls}" data-date="${d}" ${d === selected ? 'aria-current="date"' : ''} aria-label="${fmtDate(d)}">
          <span class="wd">${dateFromIso(d).toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
          <span class="dn">${arc}${dateFromIso(d).getDate()}</span></button>`;
      })
      .join('')}</div>
    <button class="icon-btn sm ghost" data-week="7" aria-label="Next week">${icon('chevronRight')}</button>
  </div>`;
}

function hero(tot, t) {
  const goal = t?.calories || 0;
  const left = Math.round(goal - tot.cal);
  const over = left < 0;
  return `<section class="card" aria-label="Today's calories and macros">
    <div class="hero">
      <div class="ring-wrap">
        ${ring({ value: tot.cal, max: goal, size: 150, stroke: 14 })}
        <div class="ring-center">
          <div class="big">${fmt(Math.abs(left))}</div>
          <div class="lbl">${over ? 'kcal over' : 'kcal left'}</div>
        </div>
      </div>
      <div class="macros">
        ${macroBar({ label: 'Protein', key: 'protein', value: tot.protein, target: t?.protein || 0 })}
        ${macroBar({ label: 'Carbs', key: 'carbs', value: tot.carbs, target: t?.carbs || 0 })}
        ${macroBar({ label: 'Fat', key: 'fat', value: tot.fat, target: t?.fat || 0 })}
      </div>
    </div>
    <div class="hero-foot">
      <div><b>${fmt(goal)}</b><span>Goal</span></div>
      <div><b>${fmt(tot.cal)}</b><span>Eaten</span></div>
      <div><b>${fmt(tot.fiber)}g</b><span>Fiber</span></div>
    </div>
  </section>`;
}

function mealCard(meal, entries) {
  const tot = sumEntries(entries);
  return `<section class="card meal-card" aria-label="${meal.label}">
    <div class="meal-head">
      <div><h2>${meal.label}</h2><div class="sub">${entries.length ? `${fmt(tot.cal)} kcal · P ${fmt(tot.protein)} · C ${fmt(tot.carbs)} · F ${fmt(tot.fat)}` : 'Nothing logged'}</div></div>
      <button class="add-btn" data-add-meal="${meal.id}" aria-label="Add to ${meal.label}">${icon('plus')}</button>
    </div>
    ${entries.length ? `<ul class="list">${entries
      .map((e) => `<li><button class="item" data-entry="${e.id}">
        <div class="main">
          <div class="title">${esc(e.name)}</div>
          <div class="meta">${[e.servings !== 1 && `${fmt(e.servings, 2)}×`, e.serving && esc(e.serving), e.hall && esc(hallById(e.hall).name)].filter(Boolean).join(' · ') || 'Custom'} · ${pcf(e.n, e.servings)}</div>
        </div>
        <div class="kcal"><b>${fmt((e.n.cal || 0) * e.servings)}</b><span>kcal</span></div>
      </button></li>`)
      .join('')}</ul>` : ''}
  </section>`;
}

function coachShell(date, tot, t) {
  if (!t) return '';
  const today = todayIso();
  const calLeft = Math.round(t.calories - tot.cal);
  const pLeft = Math.round(t.protein - tot.protein);
  let title;
  let text;
  let ic = 'target';
  if (date > today) {
    title = 'Plan ahead';
    text = 'Menus for this day are in the Dining tab. Pre-log a meal to see how it fits.';
  } else if (date < today) {
    const hitP = pLeft <= 0;
    const withinCal = Math.abs(calLeft) <= t.calories * 0.1;
    title = hitP && withinCal ? 'Solid day' : hitP ? 'Protein goal hit' : `${pLeft}g short on protein`;
    text = !tot.cal
      ? 'Nothing logged this day.'
      : calLeft >= 0
        ? `Finished ${fmt(calLeft)} kcal under your ${fmt(t.calories)} target.`
        : `Finished ${fmt(-calLeft)} kcal over. One day won’t decide your progress; your weekly average does.`;
  } else if (calLeft < 0) {
    ic = 'info';
    title = `${fmt(-calLeft)} kcal over today`;
    text = 'No stress. One day won’t decide your progress; your weekly average does. Aim for lighter, protein-first picks tomorrow.';
  } else if (pLeft > 5) {
    ic = 'bolt';
    title = `${pLeft}g protein to go`;
    text = `${fmt(calLeft)} kcal left today. Leading with protein keeps you full and protects muscle.`;
  } else {
    ic = 'check';
    title = 'Protein goal hit';
    text = `${fmt(calLeft)} kcal left for the rest of today.`;
  }
  const wantPicks = date === today && calLeft > 100 && pLeft > 5;
  return `<section class="card" data-coach>
    <div class="coach">
      <div class="coach-icon">${icon(ic)}</div>
      <div style="flex:1;min-width:0"><h3>${esc(title)}</h3><p>${text}</p></div>
    </div>
    ${wantPicks ? '<div class="picks" data-picks></div>' : ''}
  </section>`;
}

async function fillPicks(root, date, tot, t, ctx) {
  const el = root.querySelector('[data-picks]');
  if (!el) return;
  const hallId = getState().prefs.defaultHall;
  const available = hallMeals(date, hallId);
  if (!getIndex() || !available.length) {
    el.innerHTML = `<p class="small muted" style="padding-top:12px">No ${esc(hallById(hallId).name)} menu loaded for today yet. Check the Dining tab.</p>`;
    return;
  }
  const meal = upcomingMeal(available, new Date().getHours() + new Date().getMinutes() / 60);
  try {
    const day = await loadDay(date);
    const cats = day?.halls?.[hallId]?.[meal] || [];
    const flat = cats.flatMap((c) => c.items.map((it) => ({ it, cat: c.name })));
    const calLeft = t.calories - tot.cal;
    const picks = bestProteinPicks(flat.map((x) => x.it), { calLeft, limit: 3 });
    if (!picks.length) {
      el.remove();
      return;
    }
    el.innerHTML = `<p class="small muted" style="padding:12px 0 2px">Best protein per calorie at ${esc(hallById(hallId).name)} ${esc(diningMealLabel(meal).toLowerCase())}:</p>
      <ul class="list">${picks
        .map((it, i) => `<li><div class="item compact">
          <button class="main" data-pick="${i}" style="background:none;border:0;padding:0;text-align:left">
            <div class="title">${esc(it.name)}</div>
            <div class="meta">${fmt(it.protein)}g protein · ${fmt(it.cal)} kcal${it.serving ? ` · ${esc(it.serving)}` : ''}</div>
          </button>
          <button class="add-btn" data-pick="${i}" aria-label="Add ${esc(it.name)}">${icon('plus')}</button>
        </div></li>`)
        .join('')}</ul>`;
    el.querySelectorAll('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        const it = picks[Number(b.dataset.pick)];
        const cat = flat.find((x) => x.it === it)?.cat;
        openFoodSheet(it, { date, meal: logMealForDining(meal), hall: hallId, diningMeal: meal, category: cat });
      }),
    );
  } catch {
    el.remove();
  }
}

export function renderToday(root, ctx) {
  const s = getState();
  const date = ctx.date;
  const t = s.targets;
  const entries = entriesFor(date);
  const tot = sumEntries(entries);
  const today = todayIso();

  root.innerHTML = `
    <header class="page-head">
      <div>
        <div class="eyebrow">${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <h1>${esc(relativeDayLabel(date, today))}</h1>
      </div>
      <div class="head-actions">
        ${date !== today ? `<button class="btn sm secondary" data-go-today>Today</button>` : ''}
        <button class="icon-btn" data-quick aria-label="Quick add food">${icon('plus')}</button>
      </div>
    </header>
    ${weekStrip(date)}
    ${hero(tot, t)}
    ${coachShell(date, tot, t)}
    ${LOG_MEALS.map((m) => mealCard(m, entries.filter((e) => e.meal === m.id))).join('')}
  `;

  root.querySelectorAll('[data-date]').forEach((b) => b.addEventListener('click', () => ctx.setDate(b.dataset.date)));
  root.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => ctx.setDate(addDays(date, Number(b.dataset.week)))));
  root.querySelector('[data-go-today]')?.addEventListener('click', () => ctx.setDate(today));
  root.querySelector('[data-quick]').addEventListener('click', () => openQuickAdd({ date, meal: ctx.defaultLogMeal() }));
  root.querySelectorAll('[data-add-meal]').forEach((b) =>
    b.addEventListener('click', () => {
      const meal = b.dataset.addMeal;
      if (meal === 'snack') openQuickAdd({ date, meal });
      else ctx.go(`#/dining?meal=${meal}`);
    }),
  );
  root.querySelectorAll('[data-entry]').forEach((b) =>
    b.addEventListener('click', () => {
      const e = entries.find((x) => x.id === b.dataset.entry);
      if (e) openEntrySheet(date, e);
    }),
  );
  fillPicks(root, date, tot, t, ctx);
}
