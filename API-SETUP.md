# API-Football setup for PreBetTips

## 1. Upload
Upload the ZIP contents to the root of your GitHub repository, replacing existing files.
Include the hidden `.github/workflows/update-data.yml` file. GitHub’s web uploader may skip
hidden folders: if necessary use **Add file → Create new file** and enter that exact path,
then paste the workflow contents. These instructions assume your default branch is `main`.
For another branch, update `branches: [main]` in the workflow.
Keep your existing images/assets and advertising configuration if you customized them.

## 2. Store the key privately
In the API-Sports/API-Football dashboard, copy your direct API key.
GitHub repository → Settings → Secrets and variables → Actions → New repository secret.
Name: `API_FOOTBALL_KEY`. Value: your API key. Never put it in an uploaded file or chat.
This integration uses https://v3.football.api-sports.io with `x-apisports-key`, NOT RapidAPI headers.
If a key was ever committed publicly, revoke it and issue a new one first.

## 3. Enable deployments and write access
Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**.
Repository Settings → Actions → General → Workflow permissions → **Read and write permissions**.
Organization policies or branch protection may disallow workflow pushes: if the commit step
fails, check those restrictions (or use a permitted data branch / deployment-only architecture).

## 4. Run once
Open Actions → Update football data and deploy → Run workflow → Run workflow.
Wait for BOTH update and deploy jobs to complete successfully. Check the fetch step log for
fixture/team/result counts. A subscription does not enable this workflow automatically.
First run can take several minutes because it fetches previous-season history and H2H.
The shipped data.js is intentionally empty; no made-up matches remain.
Refresh your website after deployment. The refresh timestamp appears under the day selector.

## 5. Coverage and customization
Edit `api-config.json`. Default leagues: Premier League, La Liga, Serie A, Bundesliga,
Ligue 1, Eredivisie, and Primeira Liga. This is NOT all world competitions.
Add/remove objects with API league IDs, names, countries and icons to change coverage.
Current seasons are detected from API metadata; optional `season` on a league pins a year.
Timezone defaults to UTC. Use an IANA zone supported by API-Football, e.g. `Asia/Phnom_Penh`,
to change kickoff dates/times and the Today filter consistently. Results histories use the same zone.
Default fixture window: 2 days back, 14 days ahead. Cancelled/postponed matches are excluded.
Live status and score are API snapshots, not streaming updates. Refresh the browser for new data.

## Refresh and quota
Schedule: twice an hour, at minute 17 and 47. GitHub can delay scheduled jobs; it is not suitable
for second-by-second live scoring. Scheduled workflows run on the default branch; GitHub may
disable schedules after prolonged inactivity in public repositories. Check Actions regularly.
H2H cache: 24 hours. Current and previous season fixtures are downloaded on each run;
standings use the API’s coverage flag. Most stats are computed from completed league fixtures,
not additional per-team statistics requests. Actual requests/run appear in Actions logs and
in window.DATA.apiRequestsThisRun; monitor the provider dashboard before expanding leagues.
The 500-call per-run safety cap is NOT a global daily quota manager; your plan’s daily limit
still applies across all uses of your API key. A quota/error failure preserves the previous published data.
For fast live scores, use a cached backend with an appropriate polling and quota policy instead.

## What is real, and what is estimated
Real: fixtures, kickoff times, regulation-time results, halftime scores when covered, live
status/score snapshots, provider standings, completed current/previous season results and H2H.
Overall and Home/Away tables summarize CURRENT LEAGUE SEASON only; H2H data stays separate.
Last-six and venue cards also use the current league season, so they can contain fewer games
at the season start. Over 2.5 uses 90-minute fulltime scores, not extra time/penalty shootouts.
Provider rank is shown only when standings are available; missing data is not fabricated.
Attack/defence ratings use current completed matches with five neutral-prior games to avoid
unstable early-season estimates. Poisson and KPI probabilities, predicted scores and expected
goals are site-model estimates. Expected goals here are NOT measured shot-based xG.
All Endpoints/Competitions in a plan does not guarantee every field for every fixture.
No odds, lineups, injuries, player stats or API prediction endpoint are integrated in this release.

## Honest accuracy tracking
The first Poisson prediction saved strictly BEFORE kickoff is stored in prediction-archive.json.
Future Poisson rows use the saved snapshot. Accuracy counts only those saved forecasts once
the fixture finishes. Existing old results say “Not tracked before kickoff” and do not count.
The KPI view is recalculated and is NOT included in the accuracy metric. Do not delete the
archive: it is how your tracked forecasts survive updates. Archives contain no API key.
Current and previous seasons are retained in the exported histories; very old archived forecasts
are preserved but not automatically retrieved/settled after they leave that retained window.

## Troubleshooting
- Missing API_FOOTBALL_KEY: create the exact repository secret above.
- API HTTP 401/403 or API errors: check direct API key, activated plan and provider dashboard.
- No fixtures / wrong season: check coverage, API league IDs, timezone and optional season override.
- git push denied: check Actions permissions and protected-branch policy.
- Pages permission/deployment failure: select GitHub Actions as the Pages source.
- Blank site: first data job must succeed; check all browser files exist at root, then force refresh.
- Refresh timestamp stale: inspect Actions failures and API quota; do not mistake old snapshots for live data.

## Local run (optional)
Python 3.11+; no third-party dependencies. Set API_FOOTBALL_KEY in your environment and run
`python fetch_data.py`. On systems without IANA timezone files install system tzdata or use UTC.
`node fetch-data.js` remains a compatibility wrapper that calls Python.

## Validation boundaries
Automated Python syntax and mocked API integration tests are included in this delivery's checks.
A real authenticated API call, browser rendering, and GitHub deployment cannot be verified here.

Run offline tests with `python test-integration.py`. Mock data exists only in a temporary test directory.
