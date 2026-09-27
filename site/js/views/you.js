// Goals, settings, menu updates and backups.
import { getState, update, setPrefs, exportData, importData, resetAll, storageOk } from '../store.js';
import { GOALS, ACTIVITY, computePlan } from '../nutrition.js';
import { HALLS, hallById } from '../halls.js';
import { todayIso, addDays, fmtDate, timeAgo } from '../dates.js';
import { coverage, actionsUrl, repoInfo } from '../menus.js';
import { esc, fmt, icon, toast, openSheet, closeSheet, fmtWeight, toDisplayWeight, weightUnit, numberInput, downloadFile } from '../ui.js';
import { refreshMenus } from './dining.js';

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function goalProgress(s) {
  const p = s.profile;
  if (!p?.targetWeightKg || !s.weights.length) return '';
  const start = s.weights[0].kg;
  const now = s.weights[s.weights.length - 1].kg;
  const total = p.targetWeightKg - start;
  const done = now - start;
  const pct = total ? Math.max(0, Math.min(100, (done / total) * 100)) : 0;
  const left = Math.abs(p.targetWeightKg - now);
  return `<section class="card">
    <div class="card-title"><h2>Goal progress</h2><span class="sub">${fmt(pct)}%</span></div>
    <div class="bar" style="height:10px"><span style="width:${pct}%;background:var(--ink)"></span></div>
    <div class="row between small" style="margin-top:8px">
      <span class="muted">Start ${fmtWeight(start)}</span><span><b>${fmtWeight(now)}</b></span><span class="muted">Goal ${fmtWeight(p.targetWeightKg)}</span>
    </div>
    <p class="small ink-2" style="margin-top:8px">${left < 0.25 ? 'You made it. Consider switching your goal to Maintain.' : `${fmt(toDisplayWeight(left), 1)} ${weightUnit()} to go.`}</p>
  </section>`;
}

function editTargets() {
  const t = getState().targets || {};
  openSheet(
    `<h2 style="margin-right:40px">Edit daily targets</h2>
     <p class="small muted" style="margin:6px 0 16px">Changing a macro recalculates calories (4 kcal/g protein & carbs, 9 kcal/g fat).</p>
     <div class="grid-2">
       ${['calories', 'protein', 'carbs', 'fat'].map((k) => `<div class="field"><label for="t-${k}">${k[0].toUpperCase() + k.slice(1)}${k === 'calories' ? '' : ' (g)'}</label><input id="t-${k}" data-t="${k}" type="number" inputmode="numeric" value="${t[k] ?? ''}"></div>`).join('')}
     </div>
     <button class="btn block" data-save>Save targets</button>`,
    (body) => {
      const val = (k) => numberInput(body.querySelector(`[data-t="${k}"]`).value) || 0;
      body.querySelectorAll('[data-t]').forEach((inp) =>
        inp.addEventListener('input', () => {
          if (inp.dataset.t === 'calories') return;
          body.querySelector('[data-t="calories"]').value = Math.round((val('protein') * 4 + val('carbs') * 4 + val('fat') * 9) / 10) * 10;
        }),
      );
      body.querySelector('[data-save]').addEventListener('click', () => {
        const next = { calories: val('calories'), protein: val('protein'), carbs: val('carbs'), fat: val('fat'), source: 'custom' };
        if (next.calories < 800) {
          toast('Calories look too low');
          return;
        }
        update((s) => {
          s.targets = next;
        });
        closeSheet();
        toast('Targets saved');
      });
    },
  );
}

function tokenSheet() {
  const repo = repoInfo();
  const repoName = repo ? `${repo.owner}/${repo.repo}` : 'this repository';
  openSheet(
    `<h2 style="margin-right:40px">One-tap menu refresh</h2>
     <p class="ink-2" style="margin:10px 0 12px">The refresh button can start the menu update job on GitHub for you. It needs a GitHub token that can only run this repo’s Actions:</p>
     <ol class="ink-2 small" style="padding-left:20px;line-height:1.65;margin:0 0 14px">
       <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → New fine-grained token</a>.</li>
       <li>Repository access: <b>Only select repositories</b> → <b>${esc(repoName)}</b>.</li>
       <li>Permissions → Repository → <b>Actions: Read and write</b>. Nothing else.</li>
       <li>Generate, copy, and paste it below.</li>
     </ol>
     <div class="field"><label for="gh-token">Token</label><input id="gh-token" type="password" autocomplete="off" placeholder="github_pat_…" value="${esc(getState().prefs.ghToken)}"></div>
     <p class="small muted" style="margin:-4px 0 14px">Stored only in this browser. Anyone with this token could re-run the menu job, nothing more.</p>
     <div class="row"><button class="btn secondary" data-clear>Remove</button><button class="btn block" data-save>Save token</button></div>`,
    (body) => {
      body.querySelector('[data-save]').addEventListener('click', () => {
        setPrefs({ ghToken: body.querySelector('#gh-token').value.trim() });
        closeSheet();
        toast('Token saved. Refresh now runs the update job');
      });
      body.querySelector('[data-clear]').addEventListener('click', () => {
        setPrefs({ ghToken: '' });
        closeSheet();
        toast('Token removed');
      });
    },
  );
}

export function renderYou(root, ctx) {
  const s = getState();
  const p = s.profile;
  const t = s.targets || {};
  const plan = p ? computePlan(p) : null;
  const cov = coverage(s.prefs.defaultHall);
  const eta = plan?.weeksToGoal ? fmtDate(addDays(todayIso(), Math.round(plan.weeksToGoal * 7)), { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const url = actionsUrl();

  root.innerHTML = `
    <header class="page-head"><div><div class="eyebrow">Your plan</div><h1>Goals</h1></div></header>

    <section class="card">
      <div class="card-title">
        <div><h2>${esc(p ? GOALS[p.goal]?.label : 'No goal set')}</h2>
          <div class="sub">${p ? `${esc(ACTIVITY[p.activity]?.label || '')}${eta ? ` · goal around ${eta}` : ''}` : ''}</div></div>
        <button class="btn sm secondary" data-edit-targets>${icon('edit')}Edit</button>
      </div>
      <div class="macro-tiles" style="margin:4px 0 8px">
        <div><b>${fmt(t.calories)}</b><span>kcal</span></div>
        <div><b>${fmt(t.protein)}g</b><span><i class="dot-p"></i>Protein</span></div>
        <div><b>${fmt(t.carbs)}g</b><span><i class="dot-c"></i>Carbs</span></div>
        <div><b>${fmt(t.fat)}g</b><span><i class="dot-f"></i>Fat</span></div>
      </div>
      ${plan ? `<div class="kv"><span>Estimated daily burn</span><span>${fmt(plan.tdee)} kcal</span></div>
      <div class="kv"><span>Target source</span><span>${t.source === 'custom' ? 'Set by you' : t.source === 'adaptive' ? 'Adjusted from your data' : 'Questionnaire'}</span></div>` : ''}
      <button class="btn block secondary" data-retake style="margin-top:12px">${p ? 'Retake goals questionnaire' : 'Set my goals'}</button>
    </section>

    ${goalProgress(s)}

    <div class="section-label">Preferences</div>
    <section class="card">
      <div class="field"><span class="label">Default dining hall</span>
        <select class="input" data-pref="defaultHall">${HALLS.map((h) => `<option value="${h.id}" ${h.id === s.prefs.defaultHall ? 'selected' : ''}>${h.name}</option>`).join('')}</select></div>
      <div class="field"><span class="label">Menu opens to</span>
        <select class="input" data-pref="defaultMeal">${[
          ['auto', 'Whatever meal is next'],
          ['breakfast', 'Breakfast'],
          ['lunch', 'Lunch'],
          ['dinner', 'Dinner'],
          ['latenight', 'Late night'],
        ].map(([v, l]) => `<option value="${v}" ${v === s.prefs.defaultMeal ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><span class="label">Units</span>
        <div class="segmented"><button data-units="imperial" aria-pressed="${s.prefs.units !== 'metric'}">lb</button><button data-units="metric" aria-pressed="${s.prefs.units === 'metric'}">kg</button></div></div>
      <div class="field" style="margin-bottom:0"><span class="label">Appearance</span>
        <div class="segmented">${['auto', 'light', 'dark'].map((th) => `<button data-theme-set="${th}" aria-pressed="${s.prefs.theme === th}">${th[0].toUpperCase() + th.slice(1)}</button>`).join('')}</div></div>
    </section>

    <div class="section-label">Menu updates</div>
    <section class="card">
      <div class="kv"><span>Menus available through</span><span>${cov.end ? esc(fmtDate(cov.end)) : '—'}</span></div>
      <div class="kv"><span>Last checked UMass Dining</span><span>${cov.checkedAt ? esc(timeAgo(cov.checkedAt)) : '—'}</span></div>
      <div class="kv"><span>Automatic checks</span><span>Twice a day</span></div>
      <div class="kv"><span>One-tap refresh</span><span>${s.prefs.ghToken ? 'On' : 'Off'}</span></div>
      <div class="row" style="margin-top:12px">
        <button class="btn secondary" data-token>${s.prefs.ghToken ? 'Change token' : 'Set up'}</button>
        <button class="btn block" data-refresh>${icon('refresh')}Refresh menus</button>
      </div>
      ${url ? `<p class="small muted" style="margin-top:10px">Or run it by hand: <a href="${esc(url)}" target="_blank" rel="noopener">GitHub Actions → Run workflow</a>.</p>` : ''}
    </section>

    <div class="section-label">Your data</div>
    <section class="card">
      <p class="small ink-2" style="margin-bottom:12px">Your log lives only in this browser${storageOk ? '' : ' <b>(storage is blocked here, so nothing will be saved!)</b>'}. On iPhone, use Share → <b>Add to Home Screen</b> so Safari doesn’t clear it, and export a backup now and then.</p>
      <div class="grid-2">
        <button class="btn secondary" data-export>${icon('download')}Export</button>
        <label class="btn secondary" style="cursor:pointer">${icon('upload')}Import<input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
      <button class="btn danger block" data-reset style="margin-top:10px">Erase everything</button>
    </section>

    <p class="small muted center" style="margin:18px 12px 0">Nutrition comes from UMass Dining’s published menus and may not match what’s served. Not affiliated with UMass. Estimates only, not medical advice.</p>
  `;

  root.querySelector('[data-retake]').addEventListener('click', () => ctx.go('#/welcome?restart=1'));
  root.querySelector('[data-edit-targets]').addEventListener('click', editTargets);
  root.querySelectorAll('[data-pref]').forEach((sel) =>
    sel.addEventListener('change', () => {
      setPrefs({ [sel.dataset.pref]: sel.value });
      toast(sel.dataset.pref === 'defaultHall' ? `Default hall: ${hallById(sel.value).name}` : 'Saved');
    }),
  );
  root.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => setPrefs({ units: b.dataset.units })));
  root.querySelectorAll('[data-theme-set]').forEach((b) =>
    b.addEventListener('click', () => {
      setPrefs({ theme: b.dataset.themeSet });
      applyTheme(b.dataset.themeSet);
    }),
  );
  root.querySelector('[data-token]').addEventListener('click', tokenSheet);
  root.querySelector('[data-refresh]').addEventListener('click', () => refreshMenus(() => renderYou(root, ctx)));
  root.querySelector('[data-export]').addEventListener('click', () => {
    downloadFile(`calorie-tracker-backup-${todayIso()}.json`, exportData());
  });
  root.querySelector('[data-import]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importData(await file.text());
      applyTheme(getState().prefs.theme);
      toast('Backup restored');
    } catch (err) {
      toast(err.message || 'Could not read that file');
    }
  });
  root.querySelector('[data-reset]').addEventListener('click', () => {
    if (!confirm('Erase your goals, food log, weights and favorites from this browser? This can’t be undone.')) return;
    resetAll();
    applyTheme('auto');
    ctx.go('#/welcome');
  });
}

export { applyTheme };
