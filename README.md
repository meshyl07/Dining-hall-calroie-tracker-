# Calorie Tracker: UMass Dining

A personal, Bevel-style calorie and macro tracker built around the UMass Amherst dining halls: **Worcester** (default), **Berkshire**, **Franklin**, and **Hampshire**.

Browse the real menus with calories, protein, carbs, and fat for every item. Tap to log, and track progress toward a goal you set in a short questionnaire.

## What it does

- **Goals questionnaire.** Asks your goal (lose fat, recomp, maintain, build muscle), body stats, activity, how often you lift, goal weight and pace, and which halls and meals you eat at. It turns that into daily calorie, protein, carb, and fat targets with a projected goal date. You can override any number.
- **Today.** A calorie ring plus protein, carb, and fat bars, a week strip, and meals grouped as Breakfast, Lunch, Dinner, Late Night, and Snacks. A coach card tells you what's left and shows the **best protein-per-calorie picks** on the menu you're about to eat.
- **Dining.** Every published menu, by hall, date, and meal, grouped by station. Search, sort by protein or protein per calorie, and filter (20g+ protein, under 300 kcal, vegetarian, vegan, favorites). One tap logs a serving; open an item for half or double servings and full nutrition facts. **Build my plate** suggests a combination that fits what you have left.
- **Quick add.** Snacks, shakes, or anything off-menu. You can save these as "My foods", and recent items can be re-added in one tap.
- **Trends.** Calories and protein vs. goal (7, 30, or 90 days), average macros, streaks, and a weight log with trend line and projected goal date. After about 2 weeks of logging it **estimates your real maintenance calories** from your logs and weigh-ins, and offers to adjust your target.
- Works offline once loaded, has dark and light modes, and can be installed to your phone's home screen.

## How menus stay up to date

UMass posts menus about 2 weeks ahead. A GitHub Action ([`.github/workflows/update-menus.yml`](.github/workflows/update-menus.yml)) handles the updates:

1. Runs **twice a day** (about 6 AM and 4 PM Eastern), on every push, and whenever you hit **Refresh**.
2. Walks forward from today, requesting each hall's menu, until the menus run out.
3. Commits the data to `site/data/` and redeploys the site.

So when UMass publishes the next weeks, the app picks them up on its own within about half a day. The Dining tab shows how far menus go ("Worcester menus through Sat, Oct 10") and warns when fewer than 3 days are left.

**The Refresh button:**
- **Without a token:** it reloads the latest data and links you to *Actions → Run workflow* on GitHub, if you want to force an update now.
- **With a token (one tap):** go to *Goals → Menu updates → Set up* and paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to this repo with only **Actions: Read and write**. Refresh then runs the job and waits for it (about 1–2 min).

## One-time setup (~3 minutes)

1. **Enable GitHub Pages:** repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Make this the default branch**, if it isn't already (**Settings → General → Default branch**). Scheduled runs and Pages deploys only happen on the default branch.
3. **Run it once:** **Actions → Update menus & deploy → Run workflow**. When it goes green, your site is live at
   `https://<your-username>.github.io/<repo-name>/`
4. On your phone, open that link and choose **Share → Add to Home Screen**. The goals questionnaire starts on first launch.
5. *(Optional)* Rename the repo to `calorie-tracker` under **Settings → General**. The site URL changes to match.

## Limitations

- **Data lives in your browser.** Your log, goals, and weights are stored locally (localStorage) on one device. They don't sync between phone and laptop. Use **Goals → Export/Import** to back up or move them. On iPhone, add the app to your Home Screen, because Safari can clear website data from sites you haven't opened in a while.
- **Nutrition is only as good as UMass's data.** Values are per UMass's listed serving; real portions vary. Some items have no nutrition info (shown as "No nutrition info"); use Quick add for those.
- **Menus can change** after they're posted (substitutions, items running out).
- **The scraper depends on UMass's website.** It uses the same JSON endpoint the umassdining.com menu pages load (`/foodpro-menu-ajax`). If UMass redesigns the site, the job fails. You'll get a failed-run email from GitHub, and the app keeps showing the last good menus with "last check failed".
- **Refresh isn't instant.** Browsers can't read umassdining.com directly (cross-site restrictions), so updates go through the GitHub Action, which takes a minute or two.
- **GitHub pauses scheduled workflows** in repos with no activity for 60 days. The menu commits count as activity, so this shouldn't trigger. If it ever does, re-enable the workflow on the Actions tab.
- **The site is public** because the repo is public (GitHub Pages). Only the app and menu data are published; your personal log never leaves your browser.
- Only the four residential dining halls are included (no Blue Wall or grab-and-go cafés).
- Calorie targets use the Mifflin–St Jeor equation and standard activity multipliers. They're estimates, not medical advice.

## Development

No build step or dependencies; just Node 20+ and a browser.

```sh
npm test                 # unit tests (parser, scraper pipeline, goal math)
npm run scrape           # fetch menus into site/data (needs internet access to umassdining.com)
npm run serve            # http://localhost:8080
```

| Path | What |
|---|---|
| `site/` | The app (plain HTML/CSS/ES modules), deployed as-is |
| `site/js/nutrition.js` | BMR/TDEE, targets, adaptive maintenance estimate, plate builder |
| `site/js/halls.js` | Dining hall list (UMass location ids) and meal names |
| `scripts/lib/umass.mjs` | Fetches and parses UMass Dining menu responses |
| `scripts/lib/pipeline.mjs` | Scrape → merge → write `site/data/index.json` + `site/data/days/*.json` |

Not affiliated with UMass Amherst or Bevel.
