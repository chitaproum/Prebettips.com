# Country dropdowns and expanded API-Football coverage

This is an UPGRADE for the existing API-Football + bookmaker-odds website, not a standalone website. Keep your existing theme.js, ads.js, data.js, prediction archive and API key secret.

## Install
1. Upload these files into the repository root, replacing their earlier versions. Include `.github/workflows/update-data.yml`.
2. If you customized `api-config.json`, retain your timezone and priority leagues and merge the new countryDiscovery, requestCache, dailyRequestsReserve and maxH2HRefreshPerRun settings. The shipped config uses UTC.
3. Keep API_FOOTBALL_KEY in GitHub Actions repository secrets. Never paste it into public files.
4. Keep Pages configured to GitHub Actions. Run Actions → Update football data and deploy → Run workflow.
5. After deployment, hard-refresh the site. New competitions appear after the first successful fetch.

## Sidebar
Click the › next to a country to expand/collapse its competitions. Click the country name to filter its matches, or click a competition to filter just that competition. Day, tip and probability filters still apply. A league with 0 matches remains visible, and selecting it may show no matches for the selected day.
Stars mark favorites locally; they do not change API coverage or automatically create a separate favorites list. Expanded countries and stars persist in the same browser. Country search also searches competition names.
Badges count fixtures across the loaded date window, not only today's fixtures.

## Coverage
The configuration requests all 47 countries, including the seven original ones. South Korea uses the API country value South-Korea; Czech Republic uses Czech-Republic. Wales is spelled correctly. Saudi Arabia uses the API country value Saudi-Arabia and displays as Saudi Arabia. Serbia is spelled correctly. Portugal is included once, not duplicated.
The updater discovers actual IDs and season coverage using `/leagues?country=...&current=true`. It selects up to ten competitions per country, preferring existing priority leagues, then senior leagues before cups and youth/reserve competitions. Cups count toward the total.
It does NOT promise five competitions if the provider returns fewer than five current competitions. Those countries show what the API actually returns, and a warning is logged. No unverified IDs or fabricated fixtures are included. Discovery is refreshed weekly.

## Schedule and quota — important change
To make this expanded full-season integration manageable, the workflow now runs every EIGHT HOURS, rather than every thirty minutes. It is not a live-score service. Fixture snapshots are cached for six hours; standings for twelve hours; previous-season fixtures and metadata for seven days. H2H fetches are capped at 60 per run, and new odds lookups at 80 per run. Other H2H records fill in over later runs. Odds are not available for every match and stale quotes remain hidden.
Each run is capped at 1,800 API requests, with a 500-request daily reserve when the provider reports the remaining quota. API calls are paced. Limits cause the updater to fail without replacing the published data. These safeguards are not a guarantee of a particular daily usage: pagination, retries, manual runs and other apps using the same key affect quota. Check Actions logs and your API dashboard.
The initial fetch can take substantially longer than the previous seven-league update. The workflow timeout is 45 minutes. A large initial dataset may increase repository size and browser load time. Reduce maxLeaguesPerCountry or the country list if necessary.
For true frequent live scores across this coverage, use a separate cached backend; simply shortening this full-season workflow's schedule risks excessive requests.

## Cached data
api-request-cache.json and league-discovery-cache.json are committed by the workflow so caches survive between runs. They contain provider responses, not the API key. They are excluded from the Pages artifact. In a PUBLIC repository their contents are nevertheless publicly readable. Keep your API key only in Actions secrets; check the provider's data redistribution terms.

## Tests
Run `python test-integration.py`, `python test-odds.py` and `python test-countries.py` with Python 3.11+. These use simulated API responses. No live API call or browser rendering has been tested in the assistant environment.

## Additional countries in this update
Switzerland, Saudi Arabia, Ukraine, Serbia, Poland, Cyprus and Belarus have been added. Portugal was already enabled and remains enabled. Run the update workflow after uploading; sidebar countries come from the generated data.js, not directly from api-config.json. Newly added countries have no discovery cache entries and are fetched on the next successful run. Existing weekly discovery caches need not be deleted.

If you have customized api-config.json, append only these values to countryDiscovery.countries rather than replacing your configuration:
```json
["Switzerland", "Saudi-Arabia", "Ukraine", "Serbia", "Poland", "Cyprus", "Belarus"]
```
Keep existing request limits. More coverage can increase requests and run time; check Actions logs and reduce competition coverage if the run reaches its cap.
