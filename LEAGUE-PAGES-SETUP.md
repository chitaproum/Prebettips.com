# League pages upgrade

Replace these four files in your existing repository root:
- app.js
- styles.css
- index.html
- fetch_data.py

Do not delete the rest of your site. Keep api-config.json, ads.js, theme.js, your API_FOOTBALL_KEY repository secret, and all archives/caches unchanged. This is an upgrade, not a standalone site.

Commit the changes, then run Actions → Update football data and deploy → Run workflow. After successful deployment, hard-refresh the website. The existing workflow already publishes these filenames; no workflow changes are needed.

Click a league in the sidebar to open its dedicated view. Hash routes such as #league=39 are shareable and work on GitHub Pages without server routing. Browser Back/Forward switches routes. Use the Predictions button to return to the existing match view; it preserves your selected league and shows all dates.

Features:
- Upcoming/live and recent-results tabs for the selected current season.
- Fixtures grouped by API round (date fallback where round is missing).
- All current-season scheduled fixtures returned by the API, not just the main prediction window.
- Date picker, 1X2 / Over-Under 2.5 market selector, Poisson/KPI selector and bookmaker selector.
- Predicted score, actual result, halftime result where supplied, and available pre-match odds.
- Full API standings: position, team, points, played, wins, draws, losses, goal difference. Groups are kept separate.
- Matches load in batches of 50; a scrollable match list keeps column headings visible.
- Responsive layout moves standings below the matches on narrower screens.
- No Featured match card, invented weather, or fabricated standings.

Limitations:
The first successful refresh is needed for full standings, round names and season-wide upcoming fixtures. Missing data displays — or an unavailable message. Live data is only as fresh as the existing eight-hour updater. Odds beyond your configured odds-fetch window may be missing. Historical forecasts are shown only if stored before kickoff; models are not retrospectively computed for completed games. AET/PEN result displays the API final goal total when supplied; history/model statistics continue using regulation-time scores.

Data security and coverage:
No browser API calls or API keys were added. League allowlists, reduced-country configuration, API caches and request limits stay unchanged. Extra output fields use fixture and standings responses already fetched; no new endpoint requests are added. Larger data.js downloads are possible because all season fixtures are now included.

Validation:
Python syntax, mocked full-season league-page data, existing integration, reduced-league/zero-goal and odds tests passed. JavaScript delimiters and helper references were checked. No JavaScript runtime/browser or live API credentials were available, so rendering, interactive routing and deployment are not verified here. The older test-countries.py assumes ten leagues per country and conflicts with the existing reduced-league allowlists; its assertion fails under that configuration. Use test-reduced-leagues.py for the reduced configuration.
