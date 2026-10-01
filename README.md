# PreBetTips — Football Predictions (demo)

A static, dependency-free football-prediction site in the style of forebet.
It ships 1X2 win probabilities, correct-score, Over/Under 2.5 and average-goals
tips, computed in the browser from a small sample dataset. **Sample/demo data
only — not betting advice. 18+, please gamble responsibly.**

## Run it

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup: header/nav, filters, prediction table, Results and How-it-works views, ad slots. |
| `theme.js` | Tiny script loaded in `<head>`: applies the saved/system light or dark theme before first paint. |
| `styles.css` | All styling, including the responsive layout (sidebar collapses, nav turns into a burger, filters stack on narrow screens). |
| `app.js` | All logic: both prediction engines, table rendering, filters, Your Selection slip + PDF export. No inline event handlers — everything uses `addEventListener`. |
| `data.js` | The editable sample dataset (`window.DATA`). Replace this to change teams/fixtures. |
| `fetch-data.js` | Optional Node 18+ script that regenerates `data.js` from the API-Football API. |

## Prediction engines

Switch between them with the **Data** toggle in the toolbar.

### 1. Poisson (default)

Expected goals per side come from attack/defence ratings:

```
λ_home = att_home × def_away × (leagueAvgGoals / 2) × homeAdvantage
λ_away = att_away × def_home × (leagueAvgGoals / 2)
```

A Poisson distribution turns each λ into goal probabilities; the home×away grid
gives 1 / X / 2, the most likely correct score, expected total goals and the
Over/Under 2.5 split.

### 2. KPI (stats-weighted confidence index)

An alternative method that builds a confidence index for each side from the
historical sample, using these weights:

| Component | Weight |
|-----------|--------|
| Overall win % | 0.15 |
| Venue win % (home side at home / away side away) | 0.15 |
| Recent-6 form (points per game) | 0.20 |
| Venue-specific recent form | 0.15 |
| Head-to-head dominance | 0.20 |
| Net average goals (avg GF − avg GA) | 0.15 |

A fixed **+0.06 home-advantage bump** is added to the home confidence. The draw
probability scales with how close the two indices are (clamped to 8–34 %), and
the remainder is split between home and away in proportion to their indices.

The Over/Under KPI confidence blends three signals:

```
conf_over = 0.45 × Poisson_over + 0.35 × historical_over_rate + 0.20 × expected-goals_factor
```

## Your Selection

Tick the **Pick** box on the 1X2 or Over/Under tab to add a match to the
**Your Selection** tab, where you can review the slip and **Download PDF**
(opens a print-ready page via the browser's print dialog).

## Going live with real data (`fetch-data.js`)

`fetch-data.js` is a dependency-free Node 18+ script (uses the built-in
`fetch`). It pulls fixtures and recent results from
[API-Football](https://www.api-football.com/) and regenerates `data.js` while
leaving `index.html`, `styles.css` and `app.js` untouched.

```bash
export API_FOOTBALL_KEY=your_key_here   # never hard-code the key in client files
node fetch-data.js
```

**Security note:** the API key is read from the `API_FOOTBALL_KEY` environment
variable and is used only in `fetch-data.js`, which runs on your machine/server.
It is never written into `data.js`, `app.js` or `index.html`, so it never ships
to the browser.

Edit `CONFIG.leagues` / `CONFIG.season` at the top of `fetch-data.js` to choose
competitions. The script maps API team stats onto the `att` / `def` ratings the
engines expect, so the front end keeps working unchanged.

## Design (v2)

Light-first editorial theme with a dark mode (moon/sun button in the header; choice saved in `localStorage`, defaults to the system setting). Colours are CSS variables at the top of `styles.css` — change `--brand` / `--hero-a` / `--hero-b` to re-skin the whole site.

### Period navigation and Featured matches

The sidebar's top block (Today / Live / Tomorrow / Weekend / Yesterday / All / Top) and the *Featured matches* day strip are two views of the same filter, so they stay in sync.

- "Today" is the real date when `data.js` has fixtures from today onward; otherwise it is the first fixture day (so demo data is never empty).
- **Live** shows fixtures with `live: true`, or (on real dates) kicked off within the last 110 minutes.
- **Top** = best 1X2 probability of at least 60% (`TOP_MIN` in `app.js`).
- Count badges follow the selected engine (Poisson/KPI) and hide when zero.
