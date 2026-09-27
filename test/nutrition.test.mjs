import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bmr,
  computePlan,
  lbToKg,
  sumEntries,
  estimateTdee,
  bestProteinPicks,
  buildPlate,
} from '../site/js/nutrition.js';
import { addDays, daysBetween, todayInTimeZone } from '../site/js/dates.js';
import { upcomingMeal, logMealForDining } from '../site/js/halls.js';

const base = {
  sex: 'male',
  age: 20,
  heightCm: 178,
  weightKg: lbToKg(180),
  activity: 'moderate',
  lifting: 'regular',
};

test('Mifflin–St Jeor BMR', () => {
  assert.equal(Math.round(bmr({ sex: 'male', age: 20, heightCm: 180, weightKg: 80 })), 1830);
  assert.equal(Math.round(bmr({ sex: 'female', age: 20, heightCm: 165, weightKg: 60 })), 1370);
});

test('fat loss plan: deficit, high protein, macros add up', () => {
  const p = computePlan({ ...base, goal: 'lose', pace: 1, targetWeightKg: lbToKg(170) });
  assert.equal(p.dailyDelta <= -490 && p.dailyDelta >= -510, true);
  assert.ok(Math.abs(p.weeklyChangeLb + 1) < 0.03); // calories are rounded to 10
  assert.equal(p.protein, 175); // 1.0 g/lb of 175 lb (midpoint of 180 → 170)
  const kcal = p.protein * 4 + p.carbs * 4 + p.fat * 9;
  assert.ok(Math.abs(kcal - p.calories) <= 30, `macros ${kcal} vs ${p.calories}`);
  assert.ok(Math.abs(p.weeksToGoal - 10) < 0.5);
});

test('lean bulk plan adds a surplus', () => {
  const p = computePlan({ ...base, goal: 'gain', pace: 0.5, targetWeightKg: lbToKg(190) });
  assert.ok(p.dailyDelta > 200 && p.dailyDelta < 300);
  assert.equal(p.protein, 160); // 0.9 g/lb × 180
  assert.ok(p.weeksToGoal > 19 && p.weeksToGoal < 21);
});

test('calorie floor kicks in for aggressive cuts', () => {
  const p = computePlan({
    sex: 'female', age: 19, heightCm: 157, weightKg: lbToKg(115), activity: 'sedentary',
    lifting: 'none', goal: 'lose', pace: 1.5, targetWeightKg: lbToKg(110),
  });
  assert.equal(p.floorApplied, true);
  assert.ok(p.calories >= 1200);
  assert.ok(p.carbs >= 0);
});

test('sumEntries multiplies by servings', () => {
  const t = sumEntries([
    { servings: 2, n: { cal: 100, protein: 10, carbs: 5, fat: 2 } },
    { servings: 0.5, n: { cal: 300, protein: 20, carbs: 30, fat: 10 } },
  ]);
  assert.equal(t.cal, 350);
  assert.equal(t.protein, 30);
  assert.equal(t.carbs, 25);
  assert.equal(t.fat, 9);
});

test('estimateTdee reads maintenance from intake + weight trend', () => {
  const cals = Array.from({ length: 21 }, (_, i) => ({ dayIndex: i, cal: 2000 }));
  // losing 0.5 lb/week => 250 kcal/day deficit => TDEE ≈ 2250
  const weights = Array.from({ length: 8 }, (_, i) => ({ dayIndex: i * 3, lb: 180 - (i * 3 * 0.5) / 7 }));
  const est = estimateTdee(cals, weights);
  assert.equal(est.tdee, 2250);
  assert.equal(est.lbPerWeek, -0.5);
  assert.equal(estimateTdee(cals.slice(0, 5), weights), null);
});

test('bestProteinPicks ranks by protein per calorie within budget', () => {
  const items = [
    { name: 'Chicken', cal: 160, protein: 31 },
    { name: 'Mac', cal: 420, protein: 17 },
    { name: 'Tofu', cal: 210, protein: 14 },
    { name: 'Cookie', cal: 200, protein: 2 },
    { name: 'Burger', cal: 900, protein: 50 },
  ];
  assert.deepEqual(bestProteinPicks(items, { calLeft: 500 }).map((i) => i.name), ['Chicken', 'Tofu', 'Mac']);
});

test('buildPlate closes the protein gap inside the budget with one side', () => {
  const c = (category, name, cal, protein, carbs = 0, fiber = 0) => ({ category, item: { name, cal, protein, carbs, fiber } });
  const { plate, cal, protein } = buildPlate(
    [
      c('Grill', 'Chicken', 160, 31),
      c('Grill', 'Turkey burger', 250, 25, 20),
      c('Deli', 'Tuna', 180, 24, 2),
      c('Pizza', 'Pizza', 290, 13, 35),
      c('Sides', 'Brown rice', 110, 2, 23, 2),
      c('Sides', 'Fries', 350, 4, 45, 3),
      c('Desserts', 'Oatmeal cookie', 120, 2, 18, 3),
    ],
    { calBudget: 600, proteinGap: 50 },
  );
  assert.deepEqual(plate.map((p) => p.item.name), ['Chicken', 'Tuna', 'Brown rice']);
  assert.equal(cal, 450);
  assert.equal(protein, 57);
});

test('date helpers', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // DST start
  assert.equal(daysBetween('2026-09-27', '2026-10-10'), 13);
  assert.equal(todayInTimeZone('America/New_York', new Date('2026-09-28T02:30:00Z')), '2026-09-27');
});

test('meal helpers', () => {
  assert.equal(upcomingMeal(['breakfast', 'lunch', 'dinner'], 12), 'lunch');
  assert.equal(upcomingMeal(['breakfast', 'lunch', 'dinner'], 7), 'breakfast');
  assert.equal(upcomingMeal(['breakfast', 'lunch', 'dinner'], 15), 'dinner');
  assert.equal(upcomingMeal(['brunch', 'dinner'], 12), 'brunch');
  assert.equal(upcomingMeal(['lunch', 'dinner'], 22), 'dinner');
  assert.equal(logMealForDining('brunch'), 'lunch');
});
