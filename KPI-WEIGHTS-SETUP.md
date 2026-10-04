# KPI weights update

Replace only app.js in your repository root, commit, and deploy your site using your existing GitHub Actions workflow. Hard-refresh after deployment. No API key, configuration, styles, data, or fetcher changes are required. Base: prebettips-league-pages-update.zip, app.js.

Weights from your image:
- overallWin: 0.1
- venueWin: 0.125
- recent6: 0.1
- venueRecent6: 0.055
- h2h: 0.035
- net: 0.035
- overallAGF: 0.11
- overallAGA: 0.15
- venueAGF: 0.13
- venueAGA: 0.16

Total: 1.000.

Inputs: overall and venue win rates; last-six form as points earned divided by maximum possible points; last six home games for the home team and away games for the away team; H2H points share; net goals normalized from -2 to +2; overall and venue average goals scored/conceded normalized from 0 to 4 goals per match and clamped. Lower AGA means a higher defensive component. These normalization ranges are modeling assumptions, not values specified by the supplied image. Missing components use a neutral 0.5; fewer than six matches use available matches. No fabricated match records are added.

The previous additional 0.06 home-confidence bump is removed so the confidence index uses exactly the requested weights. Existing draw conversion is retained, with a safe equal split if both confidence scores are zero. Confidence-derived percentages are model estimates, not calibrated guarantees.

Poisson predictions, predicted scores, expected goals, and the separate Over/Under blend (45% Poisson, 35% historical over-rate, 20% expected-goals factor) remain unchanged. New weights apply to KPI 1X2 confidence in every view using the shared prediction function.

Historical predictions are not rewritten. The existing server archive stores Poisson predictions, not these browser-generated KPI forecasts. This patch does not add KPI forecast archiving or backtesting.

Checks: weight count and sum, all ten sensitivity checks, neutral/missing-data and zero-confidence reference cases, finite probability bounds and totals, and last-six source checks passed using Python and source inspection. JavaScript execution, browser rendering, real API responses, and deployment were not tested; no JS runtime is available here.
