import { getState, entriesFor, isFavorite, addEntry, removeEntry } from '../store.js';
import { HALLS, hallById, diningMealLabel, logMealForDining, logMealLabel, upcomingMeal, sortDiningMeals } from '../halls.js';
import { sumEntries, buildPlate } from '../nutrition.js';
import { todayIso, addDays, fmtDate, relativeDayLabel, dateFromIso, timeAgo } from '../dates.js';
import { getIndex, hallMeals, loadDay, loadIndex, coverage, triggerRefresh, actionsUrl, availableDates } from '../menus.js';
import { esc, fmt, icon, pcf, toast, openSheet } from '../ui.js';
import { openFoodSheet } from './food-sheet.js';

// View state survives re-renders and tab switches.
const view = {
  hall: null,
  date: null,
  meal: null,
  logMeal: null, // set when arriving from a meal's "+" on Today
  q: '',
  sort: 'menu',
  filters: new Set(),
  plate: null,
  refreshing: null, // progress text while a GitHub refresh runs
};

// Re-renders just the item list of the mounted menu (after logging / favoriting).
let mountedList = null;
export function refreshDiningList() {
  if (mountedList?.el.isConnected) mountedList.render();
}

const SORTS = {
  menu: 'Menu order',
  protein: 'Most protein',
  density: 'Protein per kcal',
  lowcal: 'Fewest calories',
};

const dietMatch = (it, words) => (it.diets || []).some((d) => words.some((w) => d.toLowerCase().includes(w)));
const FILTERS = {
  fav: { label: 'Favorites', test: (it) => isFavorite(it.name) },
  protein: { label: '20g+ protein', test: (it) => (it.protein ?? 0) >= 20 },
  under300: { label: 'Under 300 kcal', test: (it) => it.cal != null && it.cal < 300 },
  veg: { label: 'Vegetarian', test: (it) => dietMatch(it, ['vegetarian', 'vegan', 'plant']), needsDiets: true },
  vegan: { label: 'Vegan', test: (it) => dietMatch(it, ['vegan', 'plant based', 'plant-based']), needsDiets: true },
};

export function statusBar() {
  const s = getState();
  const cov = coverage(s.prefs.defaultHall);
  const hallName = hallById(s.prefs.defaultHall).name;
  let cls = '';
  let title;
  let sub;
  if (view.refreshing) {
    cls = 'warn';
    title = 'Refreshing menus…';
    sub = esc(view.refreshing);
  } else if (cov.state === 'loading') {
    title = 'Loading menus…';
    sub = '';
  } else if (cov.state === 'none') {
    cls = 'bad';
    title = 'No menu data yet';
    sub = cov.error
      ? 'Couldn’t reach the site. Are you offline?'
      : cov.checkedAt
        ? `Last check ${timeAgo(cov.checkedAt)}${cov.lastCheckFailed ? ' failed' : ' found nothing posted'}. Tap refresh.`
        : 'The update job hasn’t run yet. Tap refresh.';
  } else {
    const endTxt = fmtDate(cov.end, { weekday: 'short', month: 'short', day: 'numeric' });
    title = cov.state === 'stale' ? `${hallName} menus ended ${endTxt}` : `${hallName} menus through ${endTxt}`;
    sub = `Checked ${timeAgo(cov.checkedAt)}${cov.lastCheckFailed ? ' · last check failed' : ''}`;
    if (cov.state === 'stale' || cov.lastCheckFailed) cls = 'bad';
    else if (cov.state === 'ending') cls = 'warn';
  }
  return `<div class="status-bar ${cls}">
    <span class="dot" aria-hidden="true"></span>
    <div class="txt"><b>${title}</b><span class="muted">${sub}</span></div>
    <button class="icon-btn sm ghost ${view.refreshing ? 'spin' : ''}" data-refresh aria-label="Refresh menus" ${view.refreshing ? 'disabled' : ''}>${icon('refresh')}</button>
  </div>
  ${cov.state === 'ending' && !view.refreshing ? `<div class="banner"><b>Menus run out ${cov.daysLeft === 0 ? 'after today' : `in ${cov.daysLeft} day${cov.daysLeft === 1 ? '' : 's'}`}</b>UMass posts new weeks every so often. This app re-checks automatically twice a day; tap refresh to check right now.</div>` : ''}`;
}

export async function refreshMenus(rerender) {
  const token = getState().prefs.ghToken;
  if (!token) {
    await loadIndex({ force: true });
    rerender();
    const cov = coverage(getState().prefs.defaultHall);
    if (cov.state === 'ok') {
      toast('Menus are up to date');
      return;
    }
    const url = actionsUrl();
    openSheet(`<h2 style="margin-right:40px">Pull new menus now</h2>
      <p class="ink-2" style="margin:10px 0 14px">Menus update on their own twice a day (about 6 AM and 4 PM). If UMass just posted a new week and you don’t want to wait:</p>
      <ol class="ink-2" style="padding-left:20px;margin:0 0 16px;line-height:1.6">
        <li>Open the update job on GitHub and press <b>Run workflow</b>.</li>
        <li>Come back in ~2 minutes and tap refresh again.</li>
      </ol>
      ${url ? `<a class="btn block" href="${esc(url)}" target="_blank" rel="noopener">Open GitHub Actions</a>` : ''}
      <p class="small muted" style="margin-top:14px">Want this to be one tap? Add a GitHub token under <b>Goals → Menu updates</b> and the refresh button will run the job for you.</p>`);
    return;
  }
  view.refreshing = 'Contacting GitHub…';
  rerender();
  try {
    await triggerRefresh(token, (msg) => {
      view.refreshing = msg;
      const bar = document.querySelector('.status-bar .txt .muted');
      if (bar) bar.textContent = msg;
      else toast(msg);
    });
    view.refreshing = null;
    const cov = coverage(getState().prefs.defaultHall);
    toast(cov.end ? `Menus now run through ${fmtDate(cov.end)}` : 'Menus refreshed');
  } catch (err) {
    view.refreshing = null;
    toast(err.message);
  }
  rerender();
}

function pickDefaults(ctx) {
  const s = getState();
  const today = todayIso();
  if (!view.hall) view.hall = s.prefs.defaultHall;
  if (!view.date) view.date = ctx.date || today;
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.get('meal')) {
    view.logMeal = params.get('meal');
    view.meal = null;
    view.date = ctx.date;
    history.replaceState(null, '', '#/dining');
  }
  const available = hallMeals(view.date, view.hall);
  if (!view.meal || !available.includes(view.meal)) {
    const pref = view.logMeal || s.prefs.defaultMeal;
    const wanted = pref === 'lunch' ? ['lunch', 'brunch'] : pref === 'breakfast' ? ['breakfast', 'brunch'] : [pref];
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    view.meal =
      (pref !== 'auto' && wanted.find((m) => available.includes(m))) ||
      (view.date === today ? upcomingMeal(available, hour) : null) ||
      sortDiningMeals(available)[0] ||
      null;
  }
}

function dateChips() {
  const today = todayIso();
  const dates = availableDates().filter((d) => d >= addDays(today, -3));
  if (view.date && !dates.includes(view.date)) dates.push(view.date);
  dates.sort();
  return `<div class="scroller" role="group" aria-label="Date">${dates
    .map((d) => {
      const label = d === today ? 'Today' : dateFromIso(d).toLocaleDateString('en-US', { weekday: 'short' });
      return `<button class="chip date" data-date="${d}" aria-pressed="${d === view.date}"><span>${label}</span><b>${dateFromIso(d).getDate()}</b></button>`;
    })
    .join('')}</div>`;
}

function itemRow(it, i, cat, showCat) {
  const fav = isFavorite(it.name);
  const noData = it.cal == null;
  const meta = [showCat && esc(cat), it.serving && esc(it.serving)].filter(Boolean).join(' · ');
  return `<li><div class="item ${noData ? 'dim' : ''}">
    <button class="main" data-item="${i}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer">
      <div class="title">${fav ? `<span class="star" aria-label="Favorite">★</span> ` : ''}${esc(it.name)}</div>
      <div class="meta">${meta ? `${meta} · ` : ''}${noData ? 'No nutrition info' : pcf(it)}</div>
    </button>
    <div class="kcal"><b>${noData ? '—' : fmt(it.cal)}</b><span>kcal</span></div>
    ${noData ? '' : `<button class="add-btn" data-quick="${i}" aria-label="Add ${esc(it.name)}">${icon('plus')}</button>`}
  </div></li>`;
}

function renderMenu(el, day) {
  const cats = day?.halls?.[view.hall]?.[view.meal] || [];
  const all = cats.flatMap((c) => c.items.map((it) => ({ it, cat: c.name })));
  const hasDiets = all.some((x) => x.it.diets?.length);
  const logMeal = view.logMeal || logMealForDining(view.meal);
  const t = getState().targets;

  // Controls render once; typing/filtering only re-renders the list below them.
  el.innerHTML = `
    <div class="controls">
      <div class="row">
        <label class="search" style="flex:1"><span class="sr-only">Search menu</span>${icon('search')}<input type="search" placeholder="Search ${esc(diningMealLabel(view.meal).toLowerCase())}" value="${esc(view.q)}" data-q></label>
        <select class="sort-select" data-sort aria-label="Sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === view.sort ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="scroller" role="group" aria-label="Filters">${Object.entries(FILTERS)
        .filter(([, f]) => !f.needsDiets || hasDiets)
        .map(([k, f]) => `<button class="chip" data-filter="${k}" aria-pressed="${view.filters.has(k)}">${f.label}</button>`)
        .join('')}</div>
    </div>
    <div data-plate-slot></div>
    <div data-list></div>`;

  const sheetCtx = (x) => ({
    date: view.date, meal: logMeal, hall: view.hall, diningMeal: view.meal, category: x.cat, onAdded: () => renderList(),
  });

  function renderPlate() {
    const slot = el.querySelector('[data-plate-slot]');
    slot.innerHTML = t && all.length ? plateCard(view.plate) : '';
    slot.querySelector('[data-plate]')?.addEventListener('click', () => {
      const tot = sumEntries(entriesFor(view.date));
      const calLeft = t.calories - tot.cal;
      const pLeft = t.protein - tot.protein;
      const calBudget = Math.max(250, Math.min(calLeft, t.calories * 0.4));
      const proteinGap = Math.max(20, Math.min(pLeft, t.protein * 0.45));
      view.plate = {
        ...buildPlate(all.map((x) => ({ item: x.it, category: x.cat })), { calBudget, proteinGap }),
        calBudget,
        key: `${view.hall}|${view.date}|${view.meal}`,
      };
      renderPlate();
    });
    slot.querySelector('[data-plate-close]')?.addEventListener('click', () => {
      view.plate = null;
      renderPlate();
    });
    slot.querySelector('[data-plate-all]')?.addEventListener('click', () => {
      const date = view.date;
      const added = view.plate.plate.map((p) => quickLog({ it: p.item, cat: p.category }, logMeal, true));
      view.plate = null;
      renderPlate();
      toast(`Added ${added.length} items`, { label: 'Undo', onClick: () => added.forEach((e) => removeEntry(date, e.id)) });
    });
    slot.querySelectorAll('[data-plate-item]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = view.plate.plate[Number(b.dataset.plateItem)];
        openFoodSheet(p.item, sheetCtx({ it: p.item, cat: p.category }));
      }),
    );
  }

  function renderList() {
    const q = view.q.trim().toLowerCase();
    const matches = (x) =>
      (!q || x.it.name.toLowerCase().includes(q) || x.cat.toLowerCase().includes(q)) &&
      [...view.filters].every((f) => !FILTERS[f] || (FILTERS[f].needsDiets && !hasDiets) || FILTERS[f].test(x.it));
    const shown = all.filter(matches);

    let listHtml;
    if (!all.length) {
      listHtml = `<div class="card center muted">No items published for this meal.</div>`;
    } else if (!shown.length) {
      listHtml = `<div class="card center muted">Nothing matches. Try clearing filters.</div>`;
    } else if (view.sort !== 'menu') {
      const key = {
        protein: (x) => -(x.it.protein ?? -1),
        density: (x) => ((x.it.cal ?? 0) < 20 ? 1 : -((x.it.protein ?? 0) / x.it.cal)),
        lowcal: (x) => x.it.cal ?? 1e9,
      }[view.sort];
      const sorted = [...shown].sort((a, b) => key(a) - key(b));
      listHtml = `<section class="card flush"><ul class="list">${sorted.map((x) => itemRow(x.it, all.indexOf(x), x.cat, true)).join('')}</ul></section>`;
    } else {
      const groups = cats.map((c) => ({ c, rows: shown.filter((x) => x.cat === c.name) })).filter((gr) => gr.rows.length);
      const openAll = q || view.filters.size || groups.length <= 6;
      listHtml = groups
        .map(
          (gr) => `<details class="card cat" ${openAll ? 'open' : ''}>
            <summary><span>${esc(gr.c.name)}</span><span class="count">${gr.rows.length} ${icon('chevronDown')}</span></summary>
            <ul class="list">${gr.rows.map((x) => itemRow(x.it, all.indexOf(x), x.cat, false)).join('')}</ul>
          </details>`,
        )
        .join('');
    }
    const list = el.querySelector('[data-list]');
    list.innerHTML = `<p class="small muted" style="margin:0 4px 10px">Adding to <b>${esc(logMealLabel(logMeal))}</b> · ${esc(relativeDayLabel(view.date))} · ${shown.length} items</p>${listHtml}`;
    list.querySelectorAll('[data-item]').forEach((b) =>
      b.addEventListener('click', () => {
        const x = all[Number(b.dataset.item)];
        openFoodSheet(x.it, sheetCtx(x));
      }),
    );
    list.querySelectorAll('[data-quick]').forEach((b) =>
      b.addEventListener('click', () => {
        quickLog(all[Number(b.dataset.quick)], logMeal);
        b.innerHTML = icon('check');
      }),
    );
  }

  el.querySelector('[data-q]').addEventListener('input', (e) => {
    view.q = e.target.value;
    renderList();
  });
  el.querySelector('[data-sort]').addEventListener('change', (e) => {
    view.sort = e.target.value;
    renderList();
  });
  el.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.filter;
      view.filters.has(k) ? view.filters.delete(k) : view.filters.add(k);
      b.setAttribute('aria-pressed', String(view.filters.has(k)));
      renderList();
    }),
  );
  renderPlate();
  renderList();
  mountedList = { el, render: renderList };
}

function quickLog(x, logMeal, silent = false) {
  const { it, cat } = x;
  const n = {};
  for (const k of ['cal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat', 'chol']) if (it[k] != null) n[k] = it[k];
  const e = addEntry(view.date, {
    meal: logMeal,
    name: it.name,
    serving: it.serving,
    servings: 1,
    n,
    source: 'menu',
    hall: view.hall,
    diningMeal: view.meal,
    category: cat,
  });
  if (!silent) toast(`Added ${it.name}`, { label: 'Undo', onClick: () => removeEntry(view.date, e.id) });
  return e;
}

function plateCard(plate) {
  const key = `${view.hall}|${view.date}|${view.meal}`;
  if (!plate || plate.key !== key) {
    return `<button class="card row plate-card" data-plate style="width:100%;border-style:solid;text-align:left;cursor:pointer">
      <span class="coach-icon">${icon('plate')}</span>
      <span style="flex:1"><b style="display:block">Build my plate</b><span class="small muted">Picks from this menu that fit what you have left today</span></span>
      ${icon('chevronRight', 'style="width:18px;height:18px;color:var(--muted)"')}
    </button>`;
  }
  if (!plate.plate.length) {
    return `<section class="card plate-card"><div class="row between"><b>No good fit found</b><button class="icon-btn sm ghost" data-plate-close aria-label="Close">${icon('close')}</button></div>
      <p class="small muted" style="margin-top:6px">Nothing on this menu fits ${fmt(plate.calBudget)} kcal with enough protein.</p></section>`;
  }
  return `<section class="card plate-card">
    <div class="row between" style="margin-bottom:4px">
      <div><b>Suggested plate</b><div class="small muted">≈ ${fmt(plate.cal)} kcal · ${fmt(plate.protein)}g protein (budget ${fmt(plate.calBudget)} kcal)</div></div>
      <button class="icon-btn sm ghost" data-plate-close aria-label="Close">${icon('close')}</button>
    </div>
    <ul class="list">${plate.plate
      .map((p, i) => `<li><button class="item compact" data-plate-item="${i}">
        <div class="main"><div class="title">${esc(p.item.name)}</div><div class="meta">${esc(p.category)} · ${pcf(p.item)}</div></div>
        <div class="kcal"><b>${fmt(p.item.cal)}</b><span>kcal</span></div></button></li>`)
      .join('')}</ul>
    <button class="btn block" data-plate-all style="margin-top:8px">Add all ${plate.plate.length}</button>
  </section>`;
}

export function renderDining(root, ctx) {
  pickDefaults(ctx);
  const idx = getIndex();
  const rerender = () => renderDining(root, ctx);
  const available = hallMeals(view.date, view.hall);

  root.innerHTML = `
    <header class="page-head">
      <div><div class="eyebrow">UMass Amherst</div><h1>Dining</h1></div>
    </header>
    ${statusBar()}
    <div class="segmented" role="group" aria-label="Dining hall" style="margin-bottom:12px">
      ${HALLS.map((h) => `<button data-hall="${h.id}" aria-pressed="${h.id === view.hall}">${h.name}</button>`).join('')}
    </div>
    ${idx ? dateChips() : ''}
    ${available.length ? `<div class="scroller" role="group" aria-label="Meal" style="margin:10px -16px 12px">${available
      .map((m) => `<button class="chip" data-meal="${m}" aria-pressed="${m === view.meal}">${esc(diningMealLabel(m))}</button>`)
      .join('')}</div>` : ''}
    <div data-menu>${
      !idx
        ? ''
        : available.length
          ? '<div class="card center muted">Loading menu…</div>'
          : `<div class="card center muted">No ${esc(hallById(view.hall).name)} menu posted for ${esc(fmtDate(view.date))}.</div>`
    }</div>`;

  root.querySelector('[data-refresh]')?.addEventListener('click', () => refreshMenus(rerender));
  root.querySelectorAll('[data-hall]').forEach((b) =>
    b.addEventListener('click', () => {
      view.hall = b.dataset.hall;
      view.plate = null;
      rerender();
    }),
  );
  root.querySelectorAll('[data-date]').forEach((b) =>
    b.addEventListener('click', () => {
      view.date = b.dataset.date;
      view.plate = null;
      ctx.setDate(view.date, { silent: true });
      rerender();
    }),
  );
  root.querySelectorAll('[data-meal]').forEach((b) =>
    b.addEventListener('click', () => {
      view.meal = b.dataset.meal;
      view.logMeal = null;
      view.plate = null;
      rerender();
    }),
  );
  root.querySelector('[data-date][aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  if (idx && available.length && view.meal) {
    const el = root.querySelector('[data-menu]');
    const want = `${view.hall}|${view.date}|${view.meal}`;
    loadDay(view.date)
      .then((day) => {
        if (`${view.hall}|${view.date}|${view.meal}` !== want || !el.isConnected) return;
        renderMenu(el, day);
      })
      .catch(() => {
        el.innerHTML = '<div class="card center muted">Couldn’t load this menu. Check your connection.</div>';
      });
  }
}

// Called when you open the Dining tab (not re-renders inside it).
export function enterDining() {
  view.logMeal = null;
}

// Called when the selected date changes elsewhere (Today's week strip).
export function syncDiningDate(date) {
  view.date = date;
  view.plate = null;
}

