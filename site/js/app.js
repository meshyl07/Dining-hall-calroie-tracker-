import { getState, subscribe, requestPersistence } from './store.js';
import { loadIndex, onMenusChange, lastLoadedAt } from './menus.js';
import { todayIso } from './dates.js';
import { logMealForHour } from './halls.js';
import { renderToday } from './views/today.js';
import { renderDining, syncDiningDate, refreshDiningList, enterDining } from './views/dining.js';
import { renderTrends } from './views/trends.js';
import { renderYou } from './views/you.js';
import { renderOnboarding } from './views/onboarding.js';

const root = document.getElementById('app');
const ui = { date: todayIso(), today: todayIso() };

const ctx = {
  get date() {
    return ui.date;
  },
  setDate(date, { silent = false } = {}) {
    ui.date = date;
    syncDiningDate(date);
    if (!silent) render();
  },
  go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  defaultLogMeal() {
    const now = new Date();
    return logMealForHour(now.getHours() + now.getMinutes() / 60);
  },
};

function route() {
  const [name, query] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: name || 'today', query: new URLSearchParams(query || '') };
}

function render() {
  const s = getState();
  const { name, query } = route();
  if (!s.profile && name !== 'welcome') {
    location.replace('#/welcome');
    return;
  }
  if (name !== 'welcome') document.body.classList.remove('no-nav');
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  switch (name) {
    case 'welcome':
      renderOnboarding(root, ctx, { restart: query.get('restart') === '1' });
      if (query.get('restart')) history.replaceState(null, '', '#/welcome');
      break;
    case 'dining':
      renderDining(root, ctx);
      break;
    case 'trends':
      renderTrends(root, ctx);
      break;
    case 'you':
      renderYou(root, ctx);
      break;
    default:
      renderToday(root, ctx);
  }
}

let lastRoute = null;
window.addEventListener('hashchange', () => {
  const { name } = route();
  if (name !== lastRoute) {
    window.scrollTo(0, 0);
    if (name === 'dining') enterDining();
  }
  lastRoute = name;
  render();
});

subscribe(() => {
  const { name } = route();
  if (name === 'welcome') return;
  // Re-rendering the whole Dining view would reload the menu and jump the scroll position.
  if (name === 'dining') refreshDiningList();
  else render();
});

onMenusChange(() => {
  const { name } = route();
  if (name === 'today' || name === 'dining' || name === 'you') render();
});

// When the app comes back to the foreground: roll over to a new day, recheck menus.
function onResume() {
  const today = todayIso();
  if (today !== ui.today) {
    if (ui.date === ui.today) ctx.setDate(today, { silent: true });
    ui.today = today;
    render();
  }
  if (Date.now() - lastLoadedAt() > 30 * 60e3) loadIndex({ force: true });
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && onResume());
window.addEventListener('focus', onResume);

lastRoute = route().name;
render();
loadIndex();
requestPersistence();

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
