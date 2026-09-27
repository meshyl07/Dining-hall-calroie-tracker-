// Goal math. Pure functions, shared with the Node tests.

export const LB_PER_KG = 2.20462;
export const CM_PER_IN = 2.54;
export const KCAL_PER_LB = 3500;

export const GOALS = {
  lose: { label: 'Lose fat', blurb: 'Drop body fat while keeping muscle' },
  recomp: { label: 'Recomp', blurb: 'Lose fat and build muscle at the same time' },
  maintain: { label: 'Maintain', blurb: 'Hold my weight and eat better' },
  gain: { label: 'Build muscle', blurb: 'Lean bulk: gain slowly with training' },
};

export const ACTIVITY = {
  sedentary: { label: 'Mostly sitting', blurb: 'Class, desk, little walking', factor: 1.2 },
  light: { label: 'Walking campus', blurb: 'Getting around on foot most days', factor: 1.375 },
  moderate: { label: 'Active', blurb: 'On your feet a lot + workouts 3–5×/week', factor: 1.55 },
  very: { label: 'Very active', blurb: 'Hard training most days', factor: 1.725 },
  athlete: { label: 'Athlete', blurb: 'Two-a-days / varsity training', factor: 1.9 },
};

export const LIFTING = {
  none: { label: 'Not right now', ratio: 0.7 },
  some: { label: '1–2× a week', ratio: 0.8 },
  regular: { label: '3–4× a week', ratio: 0.9 },
  lots: { label: '5+× a week', ratio: 1.0 },
};

export const PACES = {
  lose: [
    { value: 0.5, label: 'Gentle', blurb: '0.5 lb / week' },
    { value: 1, label: 'Steady', blurb: '1 lb / week' },
    { value: 1.5, label: 'Aggressive', blurb: '1.5 lb / week' },
  ],
  gain: [
    { value: 0.25, label: 'Lean', blurb: '0.25 lb / week' },
    { value: 0.5, label: 'Standard', blurb: '0.5 lb / week' },
  ],
};

export const kgToLb = (kg) => kg * LB_PER_KG;
export const lbToKg = (lb) => lb / LB_PER_KG;

// Mifflin–St Jeor
export function bmr({ sex, age, heightCm, weightKg }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') return base + 5;
  if (sex === 'female') return base - 161;
  return base - 78;
}

export function tdee(profile) {
  const f = (ACTIVITY[profile.activity] || ACTIVITY.light).factor;
  return bmr(profile) * f;
}

const round5 = (n) => Math.round(n / 5) * 5;
const round10 = (n) => Math.round(n / 10) * 10;

/**
 * profile: { goal, sex, age, heightCm, weightKg, targetWeightKg?, activity, lifting, pace }
 * -> { bmr, tdee, calories, protein, carbs, fat, dailyDelta, weeklyChangeLb, floorApplied, weeksToGoal }
 */
export function computePlan(profile) {
  const B = bmr(profile);
  const T = tdee(profile);
  const goal = GOALS[profile.goal] ? profile.goal : 'maintain';
  const pace = Number(profile.pace) || 0;

  let delta = 0;
  if (goal === 'lose') delta = -pace * (KCAL_PER_LB / 7);
  else if (goal === 'gain') delta = pace * (KCAL_PER_LB / 7);
  else if (goal === 'recomp') delta = -0.1 * T;

  let calories = T + delta;
  const floor = Math.max(profile.sex === 'male' ? 1500 : 1200, B);
  let floorApplied = false;
  if (calories < floor) {
    calories = floor;
    floorApplied = true;
  }
  calories = round10(calories);
  const dailyDelta = calories - T;

  // Protein: grams per lb, a bit higher while in a deficit to protect muscle.
  let ratio = (LIFTING[profile.lifting] || LIFTING.some).ratio;
  if (goal === 'lose' || goal === 'recomp') ratio += 0.1;
  ratio = Math.min(ratio, 1.1);
  const currentLb = kgToLb(profile.weightKg);
  const targetLb = profile.targetWeightKg ? kgToLb(profile.targetWeightKg) : currentLb;
  const refLb = goal === 'lose' && targetLb < currentLb ? (currentLb + targetLb) / 2 : currentLb;
  let protein = round5(ratio * refLb);

  let fat = round5((calories * 0.28) / 9);
  let carbs = round5((calories - protein * 4 - fat * 9) / 4);
  if (carbs < 50) {
    fat = round5(Math.max((calories * 0.2) / 9, (calories - protein * 4 - 50 * 4) / 9));
    carbs = Math.max(0, round5((calories - protein * 4 - fat * 9) / 4));
  }

  const weeklyChangeLb = (dailyDelta * 7) / KCAL_PER_LB;
  let weeksToGoal = null;
  if (profile.targetWeightKg && Math.abs(weeklyChangeLb) > 0.05) {
    const diffLb = targetLb - currentLb;
    if (Math.sign(diffLb) === Math.sign(weeklyChangeLb)) weeksToGoal = diffLb / weeklyChangeLb;
  }

  return {
    bmr: Math.round(B),
    tdee: Math.round(T),
    calories,
    protein,
    carbs,
    fat,
    ratio: Math.round(ratio * 100) / 100,
    dailyDelta: Math.round(dailyDelta),
    weeklyChangeLb: Math.round(weeklyChangeLb * 100) / 100,
    floorApplied,
    weeksToGoal,
  };
}

export function caloriesFromMacros({ protein = 0, carbs = 0, fat = 0 }) {
  return protein * 4 + carbs * 4 + fat * 9;
}

const NUTRIENTS = ['cal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat'];

export function entryTotals(entry) {
  const s = Number(entry.servings) || 0;
  const out = {};
  for (const k of NUTRIENTS) out[k] = (Number(entry.n?.[k]) || 0) * s;
  return out;
}

export function sumEntries(entries = []) {
  const out = Object.fromEntries(NUTRIENTS.map((k) => [k, 0]));
  for (const e of entries) {
    const t = entryTotals(e);
    for (const k of NUTRIENTS) out[k] += t[k];
  }
  return out;
}

// Least-squares slope/intercept for [{x, y}]
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of points) {
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const slope = (n * sxy - sx * sy) / den;
  return { slope, intercept: (sy - slope * sx) / n };
}

/**
 * Estimate real maintenance calories from what you logged vs how your weight moved.
 * dailyCalories: [{ dayIndex, cal }] for days that look fully logged
 * weights:       [{ dayIndex, lb }]
 */
export function estimateTdee(dailyCalories, weights, { minDays = 10, minWeighIns = 3, minSpanDays = 10 } = {}) {
  if (dailyCalories.length < minDays || weights.length < minWeighIns) return null;
  const xs = weights.map((w) => w.dayIndex);
  if (Math.max(...xs) - Math.min(...xs) < minSpanDays) return null;
  const fit = linearFit(weights.map((w) => ({ x: w.dayIndex, y: w.lb })));
  if (!fit) return null;
  const avgIntake = dailyCalories.reduce((a, d) => a + d.cal, 0) / dailyCalories.length;
  const tdeeEst = avgIntake - fit.slope * KCAL_PER_LB;
  return {
    tdee: round10(tdeeEst),
    avgIntake: Math.round(avgIntake),
    lbPerWeek: Math.round(fit.slope * 7 * 100) / 100,
    days: dailyCalories.length,
  };
}

// Items with the most protein per calorie that still fit what's left today.
export function bestProteinPicks(items, { calLeft = Infinity, limit = 3, minProtein = 8 } = {}) {
  return items
    .filter((it) => (it.cal ?? 0) > 20 && (it.protein ?? 0) >= minProtein && it.cal <= Math.max(calLeft, 150))
    .map((it) => ({ it, score: it.protein / it.cal }))
    .sort((a, b) => b.score - a.score || b.it.protein - a.it.protein)
    .slice(0, limit)
    .map((x) => x.it);
}

const SWEET_STATIONS = /dessert|bakery|sweet|pastr|ice cream|cereal|beverage|drink|condiment|topping/i;

/**
 * Greedy "build my plate": protein anchors from different stations until the
 * protein gap closes, then one fiber-friendly (non-dessert) side, all inside the calorie budget.
 * candidates: [{ item, category }]
 */
export function buildPlate(candidates, { calBudget, proteinGap, maxItems = 4 }) {
  const usable = candidates.filter(({ item }) => (item.cal ?? 0) >= 40 && item.protein != null);
  const plate = [];
  const usedCats = new Set();
  let cal = 0;
  let protein = 0;
  const fits = (c) => !usedCats.has(c.category) && cal + c.item.cal <= calBudget;
  const take = (c) => {
    plate.push(c);
    usedCats.add(c.category);
    cal += c.item.cal;
    protein += c.item.protein;
  };

  const anchors = usable
    .filter((c) => c.item.protein >= 10)
    .sort((a, b) => b.item.protein / b.item.cal - a.item.protein / a.item.cal);
  for (const c of anchors) {
    if (plate.length >= maxItems - 1 || protein >= proteinGap) break;
    if (fits(c)) take(c);
  }

  const sweet = (c) =>
    SWEET_STATIONS.test(c.category) || (c.item.sugar != null && c.item.sugar >= (c.item.carbs ?? 0) * 0.4);
  const sides = usable
    .filter((c) => !plate.includes(c) && cal + c.item.cal <= calBudget && (c.item.carbs ?? 0) >= 10 && !sweet(c))
    .sort((a, b) => ((b.item.fiber ?? 0) + 1) / b.item.cal - ((a.item.fiber ?? 0) + 1) / a.item.cal);
  if (sides.length && plate.length < maxItems) take(sides[0]);

  return { plate, cal, protein };
}
