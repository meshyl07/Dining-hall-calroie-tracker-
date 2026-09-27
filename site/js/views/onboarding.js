// The goals questionnaire. Runs on first launch and from Goals → "Retake".
import { getState, setPlan, setPrefs, setWeight, latestWeight } from '../store.js';
import { GOALS, ACTIVITY, LIFTING, PACES, computePlan, kgToLb, lbToKg, CM_PER_IN } from '../nutrition.js';
import { HALLS } from '../halls.js';
import { todayIso, addDays, fmtDate } from '../dates.js';
import { esc, fmt, icon, numberInput } from '../ui.js';

const GOAL_ICONS = { lose: 'trendDown', recomp: 'shuffle', maintain: 'equal', gain: 'trendUp' };
const ACTIVITY_ICONS = { sedentary: 'sofa', light: 'walk', moderate: 'run', very: 'dumbbell', athlete: 'trophy' };
const DINING = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
  ['latenight', 'Late night'],
];

let draft = null;
let step = 0;

function freshDraft() {
  const s = getState();
  const p = s.profile || {};
  const metric = s.prefs.units === 'metric';
  const w = p.weightKg ?? latestWeight()?.kg;
  const totalIn = p.heightCm ? p.heightCm / CM_PER_IN : null;
  return {
    goal: p.goal || null,
    sex: p.sex || null,
    age: p.age ?? '',
    metric,
    heightFt: totalIn ? Math.floor(totalIn / 12) : '',
    heightIn: totalIn ? Math.round(totalIn % 12) : '',
    heightCm: p.heightCm ? Math.round(p.heightCm) : '',
    weight: w ? Math.round((metric ? w : kgToLb(w)) * 10) / 10 : '',
    target: p.targetWeightKg ? Math.round((metric ? p.targetWeightKg : kgToLb(p.targetWeightKg)) * 10) / 10 : '',
    activity: p.activity || 'light',
    lifting: p.lifting || null,
    pace: p.pace ?? null,
    defaultHall: s.prefs.defaultHall || 'worcester',
    diningMeals: s.prefs.diningMeals?.length ? [...s.prefs.diningMeals] : ['lunch'],
    custom: s.targets?.source === 'custom' ? { ...s.targets } : null,
  };
}

function toProfile(d) {
  const heightCm = d.metric ? Number(d.heightCm) : (Number(d.heightFt) * 12 + Number(d.heightIn || 0)) * CM_PER_IN;
  const weightKg = d.metric ? Number(d.weight) : lbToKg(Number(d.weight));
  const targetWeightKg = d.target ? (d.metric ? Number(d.target) : lbToKg(Number(d.target))) : null;
  const needsPace = d.goal === 'lose' || d.goal === 'gain';
  return {
    goal: d.goal,
    sex: d.sex,
    age: Number(d.age),
    heightCm,
    weightKg,
    targetWeightKg: d.goal === 'maintain' ? null : targetWeightKg,
    activity: d.activity,
    lifting: d.lifting || 'some',
    pace: needsPace ? d.pace ?? PACES[d.goal][1].value : 0,
  };
}

const STEPS = ['goal', 'body', 'activity', 'target', 'dining', 'plan'];

function stepList() {
  return STEPS.filter((s) => s !== 'target' || draft.goal !== 'maintain');
}

function choice({ key, value, title, blurb, ic, pressed }) {
  return `<button type="button" class="choice" data-choice="${key}" data-value="${value}" aria-pressed="${pressed}">
    ${ic ? `<span class="ci">${icon(ic)}</span>` : ''}
    <span><b>${esc(title)}</b>${blurb ? `<span>${esc(blurb)}</span>` : ''}</span>
    <span class="check">${pressed ? icon('check') : ''}</span>
  </button>`;
}

function validate(name) {
  const d = draft;
  if (name === 'goal') return d.goal ? null : 'Pick a goal to continue.';
  if (name === 'body') {
    if (!d.sex) return 'Choose the option used for the calorie formula.';
    const age = Number(d.age);
    if (!(age >= 14 && age <= 90)) return 'Enter your age.';
    const h = d.metric ? Number(d.heightCm) : Number(d.heightFt) * 12 + Number(d.heightIn || 0);
    if (d.metric ? !(h >= 120 && h <= 230) : !(h >= 48 && h <= 90)) return 'Enter your height.';
    const w = Number(d.weight);
    if (d.metric ? !(w >= 35 && w <= 300) : !(w >= 75 && w <= 660)) return 'Enter your current weight.';
  }
  if (name === 'activity' && !d.lifting) return 'Pick how often you lift.';
  if (name === 'target') {
    const w = Number(d.weight);
    const t = Number(d.target);
    if (d.goal !== 'recomp' || d.target) {
      if (!t) return 'Enter a goal weight.';
      if (d.goal === 'lose' && t >= w) return 'For fat loss, the goal weight should be below your current weight.';
      if (d.goal === 'gain' && t <= w) return 'For building muscle, the goal weight should be above your current weight.';
    }
    if ((d.goal === 'lose' || d.goal === 'gain') && d.pace == null) return 'Pick a pace.';
  }
  if (name === 'dining' && !d.diningMeals.length) return 'Pick at least one meal.';
  return null;
}

function bodyStep() {
  const d = draft;
  const u = d.metric ? 'kg' : 'lb';
  return `
    <h1>About you</h1>
    <p class="lede">Used to estimate how many calories you burn (Mifflin–St Jeor formula).</p>
    <div class="field"><span class="label">Units</span>
      <div class="segmented"><button type="button" data-units="imperial" aria-pressed="${!d.metric}">lb · ft</button><button type="button" data-units="metric" aria-pressed="${d.metric}">kg · cm</button></div></div>
    <div class="field"><span class="label">Sex (for the calorie formula)</span>
      <div class="segmented"><button type="button" data-sex="male" aria-pressed="${d.sex === 'male'}">Male</button><button type="button" data-sex="female" aria-pressed="${d.sex === 'female'}">Female</button></div></div>
    <div class="grid-2">
      <div class="field"><label for="f-age">Age</label><input id="f-age" data-f="age" type="number" inputmode="numeric" value="${esc(d.age)}"></div>
      <div class="field"><label for="f-w">Current weight</label><div class="input-unit"><input id="f-w" data-f="weight" type="number" inputmode="decimal" step="0.1" value="${esc(d.weight)}"><span>${u}</span></div></div>
    </div>
    ${d.metric
      ? `<div class="field"><label for="f-hcm">Height</label><div class="input-unit"><input id="f-hcm" data-f="heightCm" type="number" inputmode="numeric" value="${esc(d.heightCm)}"><span>cm</span></div></div>`
      : `<div class="field"><span class="label">Height</span><div class="grid-2">
          <div class="input-unit"><input aria-label="Feet" data-f="heightFt" type="number" inputmode="numeric" value="${esc(d.heightFt)}"><span>ft</span></div>
          <div class="input-unit"><input aria-label="Inches" data-f="heightIn" type="number" inputmode="numeric" value="${esc(d.heightIn)}"><span>in</span></div></div></div>`}`;
}

function targetStep() {
  const d = draft;
  const u = d.metric ? 'kg' : 'lb';
  const paces = PACES[d.goal] || [];
  let preview = '';
  if (!validate('body') && d.target) {
    const plan = computePlan(toProfile(d));
    if (plan.weeksToGoal) preview = `At that pace: about <b>${Math.round(plan.weeksToGoal)} weeks</b>, around ${fmtDate(addDays(todayIso(), Math.round(plan.weeksToGoal * 7)), { month: 'long', day: 'numeric', year: 'numeric' })}.`;
  }
  const scale = d.metric ? 1 / 2.20462 : 1;
  return `
    <h1>${d.goal === 'gain' ? 'Where do you want to get to?' : d.goal === 'recomp' ? 'Any goal weight?' : 'What’s your goal weight?'}</h1>
    <p class="lede">${d.goal === 'recomp' ? 'Optional: with a recomp your weight may barely move while your body changes.' : 'Slow and steady keeps muscle on and is easier to stick to with dining hall food.'}</p>
    <div class="field"><label for="f-t">Goal weight</label><div class="input-unit"><input id="f-t" data-f="target" type="number" inputmode="decimal" step="0.1" value="${esc(d.target)}" placeholder="${d.goal === 'recomp' ? 'Optional' : ''}"><span>${u}</span></div></div>
    ${paces.length ? `<div class="field"><span class="label">Pace</span><div class="choice-list">${paces
      .map((p) => choice({ key: 'pace', value: p.value, title: p.label, blurb: `${fmt(p.value * scale, 2)} ${u} / week`, pressed: d.pace === p.value }))
      .join('')}</div></div>` : ''}
    <p class="small ink-2" data-preview>${preview}</p>`;
}

function planStep() {
  const d = draft;
  const profile = toProfile(d);
  const plan = computePlan(profile);
  const tgt = d.custom || { calories: plan.calories, protein: plan.protein, carbs: plan.carbs, fat: plan.fat };
  const u = d.metric ? 'kg' : 'lb';
  const weekly = d.metric ? plan.weeklyChangeLb / 2.20462 : plan.weeklyChangeLb;
  const eta = plan.weeksToGoal ? fmtDate(addDays(todayIso(), Math.round(plan.weeksToGoal * 7)), { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  return `
    <h1>Your plan</h1>
    <p class="lede">${esc(GOALS[d.goal].label)}${eta ? `, reaching ${esc(d.target)} ${u} around ${eta}` : ''}. You can change any of this later.</p>
    <section class="card">
      <div class="plan-big"><div class="n" data-p="calories">${fmt(tgt.calories)}</div><div class="u">calories per day</div></div>
      <div class="macro-tiles" style="grid-template-columns:repeat(3,1fr)">
        <div><b data-p="protein">${fmt(tgt.protein)}g</b><span><i class="dot-p"></i>Protein</span></div>
        <div><b data-p="carbs">${fmt(tgt.carbs)}g</b><span><i class="dot-c"></i>Carbs</span></div>
        <div><b data-p="fat">${fmt(tgt.fat)}g</b><span><i class="dot-f"></i>Fat</span></div>
      </div>
      <div class="kv"><span>Calories you burn at rest (BMR)</span><span>${fmt(plan.bmr)}</span></div>
      <div class="kv"><span>Estimated daily burn (TDEE)</span><span>${fmt(plan.tdee)}</span></div>
      <div class="kv"><span>Daily ${plan.dailyDelta < 0 ? 'deficit' : 'surplus'}</span><span>${plan.dailyDelta === 0 ? '0' : `${plan.dailyDelta < 0 ? '−' : '+'}${fmt(Math.abs(plan.dailyDelta))}`} kcal</span></div>
      <div class="kv"><span>Expected change</span><span>${weekly > 0 ? '+' : weekly < 0 ? '−' : ''}${fmt(Math.abs(weekly), 2)} ${u} / week</span></div>
      <div class="kv"><span>Protein target</span><span>${plan.ratio} g per lb</span></div>
      ${plan.floorApplied ? `<p class="small ink-2" style="margin-top:10px">Calories were held at a safe minimum, so progress will be a little slower than the pace you picked.</p>` : ''}
    </section>
    <details class="card" ${d.custom ? 'open' : ''}><summary class="bold" style="cursor:pointer">Adjust numbers yourself</summary>
      <div class="grid-2" style="margin-top:14px">
        ${['calories', 'protein', 'carbs', 'fat'].map((k) => `<div class="field"><label for="c-${k}">${k[0].toUpperCase() + k.slice(1)}${k === 'calories' ? '' : ' (g)'}</label><input id="c-${k}" data-custom="${k}" type="number" inputmode="numeric" value="${tgt[k]}"></div>`).join('')}
      </div>
      <button type="button" class="link-btn small" data-reset-custom>Use the recommended numbers</button>
    </details>
    <p class="small muted" style="margin:4px 4px 0">Estimates, not medical advice. The Trends tab re-checks your real burn from your logs and weigh-ins after a couple of weeks.</p>`;
}

function stepHtml(name) {
  const d = draft;
  if (name === 'goal') {
    return `<h1>What’s your main goal?</h1>
      <p class="lede">Everything (calories, protein, and the picks you see at the dining hall) is tuned to this.</p>
      <div class="choice-list">${Object.entries(GOALS)
        .map(([k, g]) => choice({ key: 'goal', value: k, title: g.label, blurb: g.blurb, ic: GOAL_ICONS[k], pressed: d.goal === k }))
        .join('')}</div>`;
  }
  if (name === 'body') return bodyStep();
  if (name === 'activity') {
    return `<h1>How active are you?</h1>
      <p class="lede">Outside of workouts: think about a normal class day.</p>
      <div class="choice-list">${Object.entries(ACTIVITY)
        .map(([k, a]) => choice({ key: 'activity', value: k, title: a.label, blurb: a.blurb, ic: ACTIVITY_ICONS[k], pressed: d.activity === k }))
        .join('')}</div>
      <div class="field" style="margin-top:22px"><span class="label">How often do you lift / strength train?</span>
        <div class="segmented">${Object.entries(LIFTING)
          .map(([k, l]) => `<button type="button" data-choice="lifting" data-value="${k}" aria-pressed="${d.lifting === k}">${l.label.replace(' a week', '').replace('Not right now', 'Never')}</button>`)
          .join('')}</div>
        <span class="hint">More lifting → a higher protein target to build and keep muscle.</span></div>`;
  }
  if (name === 'target') return targetStep();
  if (name === 'dining') {
    return `<h1>Your dining hall routine</h1>
      <p class="lede">Sets which hall and meal the Dining tab opens to.</p>
      <div class="field"><span class="label">Where do you eat most?</span><div class="choice-list">${HALLS.map((h) =>
        choice({ key: 'defaultHall', value: h.id, title: h.name, blurb: h.id === 'worcester' ? 'Default' : '', pressed: d.defaultHall === h.id }),
      ).join('')}</div></div>
      <div class="field"><span class="label">Which meals do you usually eat at a dining hall?</span>
        <div class="row" style="flex-wrap:wrap;gap:8px">${DINING.map(([k, l]) => `<button type="button" class="chip" data-meal-toggle="${k}" aria-pressed="${d.diningMeals.includes(k)}">${l}</button>`).join('')}</div></div>`;
  }
  return planStep();
}

export function renderOnboarding(root, ctx, { restart = false } = {}) {
  if (!draft || restart) {
    draft = freshDraft();
    step = 0;
  }
  const steps = stepList();
  step = Math.min(step, steps.length - 1);
  const name = steps[step];
  const isEdit = !!getState().profile;
  document.body.classList.add('no-nav');

  root.innerHTML = `<div class="wizard">
    <div class="wizard-top">
      ${step > 0 || isEdit ? `<button type="button" class="icon-btn sm ghost" data-back aria-label="${step > 0 ? 'Back' : 'Cancel'}">${icon(step > 0 ? 'chevronLeft' : 'close')}</button>` : ''}
      <div class="progress" role="progressbar" aria-valuenow="${step + 1}" aria-valuemin="1" aria-valuemax="${steps.length}"><span style="width:${((step + 1) / steps.length) * 100}%"></span></div>
      <span class="small muted">${step + 1}/${steps.length}</span>
    </div>
    <div class="wizard-body">${stepHtml(name)}</div>
    <div class="wizard-foot">
      <p class="error-text hidden" data-err style="margin-bottom:10px"></p>
      <button type="button" class="btn block" data-next>${name === 'plan' ? (isEdit ? 'Save plan' : 'Start tracking') : 'Continue'}</button>
    </div>
  </div>`;

  const rerender = () => renderOnboarding(root, ctx);
  const err = root.querySelector('[data-err]');

  root.querySelectorAll('[data-choice]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.choice;
      const raw = b.dataset.value;
      draft[key] = key === 'pace' ? Number(raw) : raw;
      if (key === 'goal') draft.pace = null;
      draft.custom = key === 'goal' ? null : draft.custom;
      rerender();
    }),
  );
  root.querySelectorAll('[data-sex]').forEach((b) =>
    b.addEventListener('click', () => {
      draft.sex = b.dataset.sex;
      rerender();
    }),
  );
  root.querySelectorAll('[data-units]').forEach((b) =>
    b.addEventListener('click', () => {
      const metric = b.dataset.units === 'metric';
      if (metric === draft.metric) return;
      const conv = (v) => (v === '' || v == null ? '' : Math.round((metric ? lbToKg(Number(v)) : kgToLb(Number(v))) * 10) / 10);
      draft.weight = conv(draft.weight);
      draft.target = conv(draft.target);
      if (metric && draft.heightFt) draft.heightCm = Math.round((Number(draft.heightFt) * 12 + Number(draft.heightIn || 0)) * CM_PER_IN);
      if (!metric && draft.heightCm) {
        const inches = Number(draft.heightCm) / CM_PER_IN;
        draft.heightFt = Math.floor(inches / 12);
        draft.heightIn = Math.round(inches % 12);
      }
      draft.metric = metric;
      rerender();
    }),
  );
  root.querySelectorAll('[data-f]').forEach((inp) =>
    inp.addEventListener('input', () => {
      draft[inp.dataset.f] = inp.value;
      err.classList.add('hidden');
      if (inp.dataset.f === 'target') {
        const prev = root.querySelector('[data-preview]');
        if (prev && !validate('body') && inp.value) {
          const plan = computePlan(toProfile(draft));
          prev.innerHTML = plan.weeksToGoal
            ? `At that pace: about <b>${Math.round(plan.weeksToGoal)} weeks</b>, around ${fmtDate(addDays(todayIso(), Math.round(plan.weeksToGoal * 7)), { month: 'long', day: 'numeric', year: 'numeric' })}.`
            : '';
        }
      }
    }),
  );
  root.querySelectorAll('[data-meal-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.mealToggle;
      draft.diningMeals = draft.diningMeals.includes(k) ? draft.diningMeals.filter((x) => x !== k) : [...draft.diningMeals, k];
      b.setAttribute('aria-pressed', String(draft.diningMeals.includes(k)));
    }),
  );
  root.querySelectorAll('[data-custom]').forEach((inp) =>
    inp.addEventListener('input', () => {
      const plan = computePlan(toProfile(draft));
      draft.custom ||= { calories: plan.calories, protein: plan.protein, carbs: plan.carbs, fat: plan.fat };
      const v = numberInput(inp.value);
      if (v != null) draft.custom[inp.dataset.custom] = Math.round(v);
      // Keep calories consistent with macros when a macro changes.
      if (inp.dataset.custom !== 'calories') {
        const c = draft.custom;
        c.calories = Math.round((c.protein * 4 + c.carbs * 4 + c.fat * 9) / 10) * 10;
        root.querySelector('#c-calories').value = c.calories;
      }
      for (const k of ['calories', 'protein', 'carbs', 'fat']) {
        const el = root.querySelector(`[data-p="${k}"]`);
        if (el) el.textContent = k === 'calories' ? fmt(draft.custom[k]) : `${fmt(draft.custom[k])}g`;
      }
    }),
  );
  root.querySelector('[data-reset-custom]')?.addEventListener('click', () => {
    draft.custom = null;
    rerender();
  });

  root.querySelector('[data-back]')?.addEventListener('click', () => {
    if (step > 0) {
      step--;
      rerender();
    } else {
      draft = null;
      document.body.classList.remove('no-nav');
      ctx.go('#/you');
    }
  });

  root.querySelector('[data-next]').addEventListener('click', () => {
    const problem = validate(name);
    if (problem) {
      err.textContent = problem;
      err.classList.remove('hidden');
      return;
    }
    if (name !== 'plan') {
      step++;
      rerender();
      window.scrollTo(0, 0);
      return;
    }
    const profile = toProfile(draft);
    const plan = computePlan(profile);
    const targets = draft.custom
      ? { ...draft.custom, source: 'custom' }
      : { calories: plan.calories, protein: plan.protein, carbs: plan.carbs, fat: plan.fat, source: 'plan' };
    const meals = draft.diningMeals;
    setPrefs({
      units: draft.metric ? 'metric' : 'imperial',
      defaultHall: draft.defaultHall,
      diningMeals: meals,
      defaultMeal: meals.length === 1 ? meals[0] : 'auto',
    });
    setPlan(profile, targets);
    const last = latestWeight();
    if (!last || Math.abs(last.kg - profile.weightKg) > 0.05) setWeight(todayIso(), profile.weightKg);
    draft = null;
    document.body.classList.remove('no-nav');
    ctx.go('#/today');
  });
}
