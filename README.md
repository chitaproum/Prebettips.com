# PreBetTips — a Forebet-style football prediction site

A self-contained football prediction web app inspired by forebet.com. It shows
upcoming fixtures with **1X2 win probabilities, a predicted correct score,
expected goals and an Over/Under 2.5 tip** — all computed live in the browser
by a **Poisson statistical model**. It also has a Results/Accuracy view and a
“How it works” explainer.

## Files
- `index.html` – page structure (predictions table, results, explainer)
- `styles.css` – dark sports-book style theme, responsive
- `data.js`   – team attack/defence ratings + fixtures + past results (edit this)
- `app.js`    – Poisson prediction engine + rendering/filters (no inline JS)

## Run it locally (no build tools needed)
It is pure static HTML/CSS/JS.

1. **Easiest:** double-click `index.html` to open it in a browser.
2. **Recommended (serve over http so everything behaves like production):**
   ```bash
   cd forebet-clone
   python3 -m http.server 8000
   ```
   then open http://localhost:8000

## How the model works
For each fixture:
1. `λ_home = attack_home × defence_away × (leagueAvg/2) × homeAdvantage`
2. `λ_away = attack_away × defence_home × (leagueAvg/2)`
3. A Poisson distribution converts each λ into the chance of 0,1,2… goals.
4. Multiplying the home×away grids gives every scoreline’s probability, which is
   summed into 1 / X / 2 probabilities, the most likely score, expected total
   goals and the Over/Under 2.5 split.

## Make it your own
- **Add matches:** append to `fixtures` in `data.js`.
- **Add teams / tune strength:** edit the `teams` map (`att`/`def`, 1.0 = average).
- **Team form table (Stats tab):** in the **Stats** view, click any match row to
  expand a home/away form comparison (P, W, D, L, GF, GA, W%, D%, L%, Avg GF,
  Avg GA, Avg GF+GA, PPG). It also shows an **Over 2.5 goals %** block with
  **Total** and **Last 8** columns per team. These are derived from each team's ratings so they
  stay consistent. To use real figures, add a `form` object to a team in
  `data.js`: `teams["Man City"].form = {home:{p,w,d,l,gf,ga}, away:{p,w,d,l,gf,ga}}`.
- **Add finished games:** append to `history` — the Results view auto-computes hit rates.
- **Tune realism:** adjust `leagueAvgGoals` and `homeAdvantage` at the top of `data.js`.

## Going to real live data (next steps)
Replace the static `data.js` with data pulled from a football data API
(e.g. football-data.org, API-Football). Recommended architecture:
- A small backend (Node/Express, Flask, etc.) fetches fixtures + recent results,
  computes rolling attack/defence ratings, and exposes a `/predictions` JSON endpoint.
- The front-end fetches that endpoint instead of loading `data.js`.
- Keep your API key on the server, never in the browser.
- Cache responses and refresh on a schedule (fixtures change slowly).

## Auto-refresh `data.js` from API-Football (`fetch-data.js`)
A ready-to-use Node script that pulls live data from **API-Football
(api-sports.io)** and regenerates `data.js` in the exact shape the app expects.

**What it derives**
- `teams{att,def,league}` from each league's **standings** (goals for/against
  per game, normalised so `1.0 = league average`).
- `fixtures[]` — upcoming (not-started) matches.
- `history[]` — recently finished matches with final scores.
- `leagueAvgGoals` and `homeAdvantage` — computed from the fetched data.

**Requirements:** Node.js **18+** (uses built-in `fetch`, no `npm install`).

**Get a key:** sign up at https://dashboard.api-football.com and copy your key.
The **free plan** allows ~100 requests/day; the script uses ~3 requests per
league (standings + upcoming + finished), so a few leagues once or twice a day
stays well within quota.

**Run**
```bash
cd forebet-clone
export API_FOOTBALL_KEY=your_key_here     # Windows PowerShell: $env:API_FOOTBALL_KEY="your_key"
node fetch-data.js                         # writes data.js
node fetch-data.js --dry                   # preview only, don't write
```
Using a **RapidAPI** subscription instead of direct api-sports.io? Set
`API_FOOTBALL_RAPID=1` and use your RapidAPI key as `API_FOOTBALL_KEY` — the
correct host header is sent automatically.

**Configure** (top of `fetch-data.js`)
- `CONFIG.season` — season start year (e.g. `2025`).
- `CONFIG.leagues` — add/remove `{ id, name }` (IDs from API-Football's
  `/leagues`; e.g. Premier League `39`, La Liga `140`, Serie A `135`,
  Bundesliga `78`, Ligue 1 `61`). `name` should match a `POPULAR_LEAGUES`
  entry so the sidebar shows a count.
- `CONFIG.upcomingPerLeague` / `finishedPerLeague` — how many matches to pull.
- `NAME_OVERRIDES` — shorten API team names (e.g. `Manchester City` →
  `Man City`) so they match the `ABBR` map used for the compact rows.

**Automate** with cron (regenerate every 6 hours):
```bash
0 */6 * * *  cd /path/to/forebet-clone && API_FOOTBALL_KEY=your_key /usr/bin/node fetch-data.js
```

> ⚠️ Keep the API key in this build step / server only. Never commit it or put
> it in `data.js` — anything in `data.js` is shipped to the browser.

> Demo/educational project. Predictions are statistical estimates, not betting
> advice. 18+ — please gamble responsibly.
