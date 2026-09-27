// Bottom sheets for logging food: dining items, edits, quick add.
import {
  getState, addEntry, updateEntry, removeEntry, restoreEntry, entriesFor,
  isFavorite, toggleFavorite, saveMyFood, removeMyFood, recentFoods,
} from '../store.js';
import { LOG_MEALS, logMealLabel, hallById, diningMealLabel } from '../halls.js';
import { sumEntries, caloriesFromMacros } from '../nutrition.js';
import { relativeDayLabel } from '../dates.js';
import { esc, fmt, g, icon, openSheet, closeSheet, toast, numberInput, pcf } from '../ui.js';

const NUTRIENT_KEYS = ['cal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat', 'chol'];

export function nutrientsOf(item) {
  const n = {};
  for (const k of NUTRIENT_KEYS) if (item[k] != null) n[k] = item[k];
  return n;
}

function mealPicker(selected) {
  return `<div class="field"><span class="label">Log to</span>
    <div class="meal-chips" role="group" aria-label="Meal">
      ${LOG_MEALS.map((m) => `<button type="button" class="chip" data-meal="${m.id}" aria-pressed="${m.id === selected}">${m.label}</button>`).join('')}
    </div></div>`;
}

function servingsPicker(value) {
  return `<div class="field"><span class="label">Servings</span>
    <div class="row between">
      <div class="stepper">
        <button type="button" data-step="-0.5" aria-label="Less">−</button>
        <input type="number" inputmode="decimal" step="0.25" min="0.25" value="${value}" data-servings aria-label="Servings">
        <button type="button" data-step="0.5" aria-label="More">+</button>
      </div>
      <div class="row" style="gap:6px">${[0.5, 1, 2].map((v) => `<button type="button" class="chip" data-set="${v}">${v}×</button>`).join('')}</div>
    </div></div>`;
}

function tiles(n, s) {
  const v = (k) => (n[k] == null ? '—' : fmt(n[k] * s));
  return `<div class="macro-tiles">
    <div><b data-t="cal">${v('cal')}</b><span>kcal</span></div>
    <div><b data-t="protein">${v('protein')}</b><span><i class="dot-p"></i>Protein</span></div>
    <div><b data-t="carbs">${v('carbs')}</b><span><i class="dot-c"></i>Carbs</span></div>
    <div><b data-t="fat">${v('fat')}</b><span><i class="dot-f"></i>Fat</span></div>
  </div>`;
}

function facts(item) {
  const rows = [
    ['Saturated fat', item.satFat != null && g(item.satFat)],
    ['Fiber', item.fiber != null && g(item.fiber)],
    ['Sugar', item.sugar != null && g(item.sugar)],
    ['Sodium', item.sodium != null && `${fmt(item.sodium)}mg`],
    ['Cholesterol', item.chol != null && `${fmt(item.chol)}mg`],
    ['Allergens', item.allergens && esc(item.allergens)],
    ['Diet', item.diets?.length && esc(item.diets.join(', '))],
  ].filter((r) => r[1]);
  if (!rows.length) return '';
  return `<details class="details-table" style="margin:4px 0 14px"><summary>Nutrition facts (per serving)</summary>
    <table class="facts"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table></details>`;
}

function afterText(date, n, s, excludeId) {
  const t = getState().targets;
  if (!t) return '';
  const others = entriesFor(date).filter((e) => e.id !== excludeId);
  const tot = sumEntries(others);
  const calLeft = Math.round(t.calories - tot.cal - (n.cal || 0) * s);
  const pLeft = Math.round(t.protein - tot.protein - (n.protein || 0) * s);
  const calTxt = calLeft >= 0 ? `${fmt(calLeft)} kcal left` : `${fmt(-calLeft)} kcal over`;
  const pTxt = pLeft > 0 ? `${pLeft}g protein to go` : 'protein goal hit';
  return `After this: ${calTxt} · ${pTxt}`;
}

function wireCommon(body, { n, date, excludeId, initialMeal, onChange }) {
  let servings = Number(body.querySelector('[data-servings]').value) || 1;
  let meal = initialMeal;
  const input = body.querySelector('[data-servings]');
  const refresh = () => {
    for (const k of ['cal', 'protein', 'carbs', 'fat']) {
      const el = body.querySelector(`[data-t="${k}"]`);
      if (el) el.textContent = n[k] == null ? '—' : fmt(n[k] * servings);
    }
    const after = body.querySelector('[data-after]');
    if (after) after.textContent = afterText(date, n, servings, excludeId);
    onChange?.({ servings, meal });
  };
  const set = (v) => {
    servings = Math.max(0.25, Math.round(v * 4) / 4);
    input.value = servings;
    refresh();
  };
  body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => set(servings + Number(b.dataset.step))));
  body.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => set(Number(b.dataset.set))));
  input.addEventListener('input', () => {
    const v = numberInput(input.value);
    if (v && v > 0) {
      servings = v;
      refresh();
    }
  });
  body.querySelectorAll('[data-meal]').forEach((b) =>
    b.addEventListener('click', () => {
      meal = b.dataset.meal;
      body.querySelectorAll('[data-meal]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      refresh();
    }),
  );
  refresh();
  return { get: () => ({ servings, meal }) };
}

/**
 * Log a dining-hall item (or any food with per-serving nutrition).
 * ctx: { date, meal, hall, diningMeal, category }
 */
export function openFoodSheet(item, ctx) {
  const n = nutrientsOf(item);
  const hall = ctx.hall ? hallById(ctx.hall).name : null;
  const where = [hall, ctx.diningMeal && diningMealLabel(ctx.diningMeal), ctx.category].filter(Boolean).map(esc).join(' · ');
  const fav = isFavorite(item.name);
  const noData = item.cal == null;
  openSheet(
    `${where ? `<div class="eyebrow" style="margin-right:40px">${where}</div>` : ''}
     <h2 style="margin:4px 40px 4px 0">${esc(item.name)}</h2>
     <div class="muted small">${item.serving ? `Serving: ${esc(item.serving)}` : 'Per serving'}</div>
     ${noData ? `<p class="banner" style="margin-top:14px">UMass didn’t publish nutrition for this item. Use <b style="display:inline">Quick add</b> to log it with your own estimate.</p>` : tiles(n, 1)}
     ${facts(item)}
     ${noData ? '' : servingsPicker(1) + mealPicker(ctx.meal)}
     <p class="small ink-2" data-after style="margin:-4px 0 14px"></p>
     <div class="row">
       <button type="button" class="icon-btn ghost" data-fav aria-pressed="${fav}" aria-label="Favorite" style="${fav ? 'color:var(--warn)' : ''}">${icon('star', fav ? 'fill="currentColor"' : '')}</button>
       ${noData
         ? `<button type="button" class="btn block" data-quick>Quick add instead</button>`
         : `<button type="button" class="btn block" data-add>Add to ${relativeDayLabel(ctx.date).toLowerCase() === 'today' ? 'today' : esc(relativeDayLabel(ctx.date))}</button>`}
     </div>`,
    (body) => {
      const favBtn = body.querySelector('[data-fav]');
      favBtn.addEventListener('click', () => {
        const on = toggleFavorite({ name: item.name, hall: ctx.hall, serving: item.serving, n });
        favBtn.setAttribute('aria-pressed', String(on));
        favBtn.style.color = on ? 'var(--warn)' : '';
        favBtn.innerHTML = icon('star', on ? 'fill="currentColor"' : '');
        toast(on ? 'Added to favorites' : 'Removed from favorites');
      });
      if (noData) {
        body.querySelector('[data-quick]').addEventListener('click', () =>
          openQuickAdd({ date: ctx.date, meal: ctx.meal, prefillName: item.name }),
        );
        return;
      }
      const ctl = wireCommon(body, { n, date: ctx.date, initialMeal: ctx.meal });
      body.querySelector('[data-add]').addEventListener('click', () => {
        const { servings, meal } = ctl.get();
        const e = addEntry(ctx.date, {
          meal,
          name: item.name,
          serving: item.serving,
          servings,
          n,
          source: 'menu',
          hall: ctx.hall,
          diningMeal: ctx.diningMeal,
          category: ctx.category,
        });
        closeSheet();
        toast(`Added ${item.name}`, { label: 'Undo', onClick: () => removeEntry(ctx.date, e.id) });
        ctx.onAdded?.(e);
      });
    },
  );
}

export function openEntrySheet(date, entry) {
  const where = [entry.hall && hallById(entry.hall).name, logMealLabel(entry.meal)].filter(Boolean).map(esc).join(' · ');
  openSheet(
    `<div class="eyebrow" style="margin-right:40px">${where}</div>
     <h2 style="margin:4px 40px 4px 0">${esc(entry.name)}</h2>
     <div class="muted small">${entry.serving ? `Serving: ${esc(entry.serving)}` : 'Per serving'}</div>
     ${tiles(entry.n, entry.servings)}
     ${facts(entry.n)}
     ${servingsPicker(entry.servings)}
     ${mealPicker(entry.meal)}
     <p class="small ink-2" data-after style="margin:-4px 0 14px"></p>
     <div class="row">
       <button type="button" class="btn danger" data-del>${icon('trash')}Delete</button>
       <button type="button" class="btn block" data-save>Save</button>
     </div>`,
    (body) => {
      const ctl = wireCommon(body, { n: entry.n, date, excludeId: entry.id, initialMeal: entry.meal });
      body.querySelector('[data-save]').addEventListener('click', () => {
        updateEntry(date, entry.id, ctl.get());
        closeSheet();
      });
      body.querySelector('[data-del]').addEventListener('click', () => {
        const removed = removeEntry(date, entry.id);
        closeSheet();
        if (removed) toast(`Deleted ${entry.name}`, { label: 'Undo', onClick: () => restoreEntry(date, removed) });
      });
    },
  );
}

// ---------------------------------------------------------------- quick add

function foodRow(f, i, kind) {
  const n = f.n || {};
  const s = kind === 'recent' ? f.servings || 1 : 1;
  return `<li><div class="item compact">
    <button type="button" class="main" data-open="${i}" style="background:none;border:0;padding:0;text-align:left">
      <div class="title">${esc(f.name)}</div>
      <div class="meta">${fmt((n.cal || 0) * s)} kcal · ${pcf(n, s)}${s !== 1 ? ` · ${s}×` : ''}</div>
    </button>
    ${kind === 'mine' ? `<button type="button" class="add-btn" data-remove="${i}" aria-label="Remove ${esc(f.name)}">${icon('trash')}</button>` : ''}
    <button type="button" class="add-btn" data-add="${i}" aria-label="Add ${esc(f.name)}">${icon('plus')}</button>
  </div></li>`;
}

export function openQuickAdd({ date, meal, prefillName = '', tab = 'quick' }) {
  let current = tab;
  const render = (body) => {
    const s = getState();
    const recent = recentFoods(25);
    body.innerHTML = `
      <h2 style="margin:0 40px 12px 0">Add food</h2>
      <div class="segmented" role="tablist" style="margin-bottom:16px">
        <button type="button" data-tab="quick" aria-pressed="${current === 'quick'}">Quick add</button>
        <button type="button" data-tab="mine" aria-pressed="${current === 'mine'}">My foods</button>
        <button type="button" data-tab="recent" aria-pressed="${current === 'recent'}">Recent</button>
      </div>
      <div data-pane></div>`;
    const pane = body.querySelector('[data-pane]');
    body.querySelectorAll('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        current = b.dataset.tab;
        render(body);
      }),
    );

    if (current === 'quick') {
      pane.innerHTML = `
        <p class="small muted" style="margin-bottom:14px">For snacks, shakes, or anything off the dining menu. Leave calories blank to compute them from macros.</p>
        <div class="field"><label for="qa-name">Name</label><input id="qa-name" placeholder="e.g. Protein shake" value="${esc(prefillName)}"></div>
        <div class="grid-4">
          <div class="field"><label for="qa-cal">kcal</label><input id="qa-cal" inputmode="decimal" type="number" min="0"></div>
          <div class="field"><label for="qa-p">Protein</label><input id="qa-p" inputmode="decimal" type="number" min="0"></div>
          <div class="field"><label for="qa-c">Carbs</label><input id="qa-c" inputmode="decimal" type="number" min="0"></div>
          <div class="field"><label for="qa-f">Fat</label><input id="qa-f" inputmode="decimal" type="number" min="0"></div>
        </div>
        ${mealPicker(meal)}
        <label class="row small" style="margin:-2px 0 16px"><input type="checkbox" id="qa-save" checked> Save to My foods for next time</label>
        <p class="error-text hidden" data-err style="margin-bottom:10px"></p>
        <button type="button" class="btn block" data-qa-add>Add to ${esc(relativeDayLabel(date).toLowerCase() === 'today' ? 'today' : relativeDayLabel(date))}</button>`;
      let m = meal;
      pane.querySelectorAll('[data-meal]').forEach((b) =>
        b.addEventListener('click', () => {
          m = b.dataset.meal;
          pane.querySelectorAll('[data-meal]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        }),
      );
      pane.querySelector('[data-qa-add]').addEventListener('click', () => {
        const val = (id) => numberInput(pane.querySelector(id).value);
        const protein = val('#qa-p') ?? 0;
        const carbs = val('#qa-c') ?? 0;
        const fat = val('#qa-f') ?? 0;
        let cal = val('#qa-cal');
        if (cal == null) cal = Math.round(caloriesFromMacros({ protein, carbs, fat }));
        const err = pane.querySelector('[data-err]');
        if (!cal) {
          err.textContent = 'Enter calories or at least one macro.';
          err.classList.remove('hidden');
          return;
        }
        const name = pane.querySelector('#qa-name').value.trim() || `Quick add (${cal} kcal)`;
        const n = { cal, protein, carbs, fat };
        addEntry(date, { meal: m, name, servings: 1, n, source: 'custom' });
        if (pane.querySelector('#qa-save').checked && pane.querySelector('#qa-name').value.trim()) saveMyFood({ name, n });
        closeSheet();
        toast(`Added ${name}`);
      });
      setTimeout(() => pane.querySelector(prefillName ? '#qa-cal' : '#qa-name')?.focus(), 300);
      return;
    }

    const list = current === 'mine' ? s.myFoods : recent;
    if (!list.length) {
      pane.innerHTML = `<p class="muted center" style="padding:28px 8px">${
        current === 'mine' ? 'Foods you save from Quick add show up here.' : 'Foods you log will show up here for one-tap re-adding.'
      }</p>`;
      return;
    }
    pane.innerHTML = `<p class="small muted" style="margin-bottom:4px">Adding to ${esc(logMealLabel(meal))}. Tap a name to change servings.</p>
      <ul class="list">${list.map((f, i) => foodRow(f, i, current)).join('')}</ul>`;
    pane.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => {
        const f = list[Number(b.dataset.add)];
        addEntry(date, {
          meal,
          name: f.name,
          serving: f.serving,
          servings: current === 'recent' ? f.servings || 1 : 1,
          n: f.n,
          source: f.source || 'custom',
          hall: f.hall,
        });
        toast(`Added ${f.name}`);
        b.innerHTML = icon('check');
      }),
    );
    pane.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => {
        const f = list[Number(b.dataset.open)];
        openFoodSheet({ name: f.name, serving: f.serving, ...f.n }, { date, meal, hall: f.hall });
      }),
    );
    pane.querySelectorAll('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => {
        removeMyFood(list[Number(b.dataset.remove)].id);
        render(body);
      }),
    );
  };
  openSheet('', (body) => render(body));
}
