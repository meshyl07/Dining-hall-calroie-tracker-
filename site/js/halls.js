// Shared by the browser app and the Node scraper.

// `tid` is the location id UMass Dining's menu endpoint expects
// (https://umassdining.com/foodpro-menu-ajax?tid=<tid>&date=MM/DD/YYYY).
export const HALLS = [
  { id: 'worcester', name: 'Worcester', tid: 1 },
  { id: 'berkshire', name: 'Berkshire', tid: 4 },
  { id: 'franklin', name: 'Franklin', tid: 2 },
  { id: 'hampshire', name: 'Hampshire', tid: 3 },
];

export const DEFAULT_HALL = 'worcester';

export function hallById(id) {
  return HALLS.find((h) => h.id === id) || HALLS[0];
}

// Meals as UMass publishes them. Keys are normalized from e.g. "lunch_menu".
export const DINING_MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'brunch', label: 'Brunch' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'latenight', label: 'Late Night' },
  { id: 'grabngo', label: "Grab 'n Go" },
];

export function diningMealLabel(id) {
  const m = DINING_MEALS.find((x) => x.id === id);
  if (m) return m.label;
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : '';
}

export function sortDiningMeals(ids) {
  const order = DINING_MEALS.map((m) => m.id);
  return [...ids].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

// Sections of the food log.
export const LOG_MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'latenight', label: 'Late Night' },
  { id: 'snack', label: 'Snacks' },
];

export function logMealLabel(id) {
  return (LOG_MEALS.find((m) => m.id === id) || LOG_MEALS[4]).label;
}

// Which log section a dining meal lands in by default.
export function logMealForDining(diningMeal) {
  if (diningMeal === 'brunch') return 'lunch';
  if (diningMeal === 'grabngo') return 'snack';
  return LOG_MEALS.some((m) => m.id === diningMeal) ? diningMeal : 'snack';
}

// The meal you're about to eat (or are eating) at this hour, from the meals actually served.
export function upcomingMeal(available, hour) {
  if (!available.length) return null;
  const prefs =
    hour < 10 ? ['breakfast', 'brunch', 'lunch']
    : hour < 14.5 ? ['lunch', 'brunch', 'dinner']
    : hour < 20 ? ['dinner', 'latenight']
    : ['latenight', 'dinner'];
  return prefs.find((m) => available.includes(m)) || sortDiningMeals(available)[0];
}

export function logMealForHour(hour) {
  if (hour < 10.5) return 'breakfast';
  if (hour < 15.5) return 'lunch';
  if (hour < 20.5) return 'dinner';
  return 'latenight';
}
