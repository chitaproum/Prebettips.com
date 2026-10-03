# Reduced leagues update

Selections transcribed from Reduce Leagues.pdf, pages 1–7. Crossed-out competitions are excluded; the unmarked competitions below are retained. Countries not shown in the PDF keep existing discovery settings.

Only upload api-config.json and fetch_data.py to the repository root, commit, and run Update football data and deploy. Merge custom timezone or other settings before replacing api-config.json. No API secret changes are required.

The allowlists are applied before fixture requests and to cached catalogs. Removed competitions are not replaced with new discoveries. The sidebar updates after the first successful data refresh. Existing prediction archives and caches are not deleted. The zero-goal model fallback is included. No live API or browser testing was performed.

Country mappings: Czech Republic → Czech-Republic; South Korea → South-Korea; Saudi Arabia → Saudi-Arabia.

## Argentina
- Liga Profesional Argentina
- Primera Nacional
- Primera B Metropolitana
- Primera C
- Copa de la Liga Profesional
- Copa Argentina
- Copa de la Superliga

## Austria
- Bundesliga
- 2. Liga
- Regionalliga - Ost
- Regionalliga - Mitte
- Regionalliga - West

## Belarus
- Premier League
- 1. Division
- Coppa
- Super Cup

## Belgium
- Jupiler Pro League
- Challenger Pro League
- Super League Women
- Second Amateur Division - ACFF
- Second Amateur Division - VFV A
- Second Amateur Division - VFV B

## Brazil
- Serie A
- Serie B
- Brasileiro Women
- Serie C
- Serie D
- Paulista - A1
- Paulista - A2

## Bulgaria
- First League
- Second League
- Cup
- Super Cup

## Canada
- Canadian Premier League

## Croatia
- HNL
- First NL
- Second NL
- Cup
- Super Cup

## Cyprus
- 1. Division
- 2. Division
- Cup
- Super Cup

## Czech-Republic
- Czech Liga
- FNL
- 3. liga - CFL A
- 3. liga - MSFL
- 1. Liga Women

## Denmark
- Superliga
- 1. Division
- 2. Division

## France
- Ligue 1
- Ligue 2
- Ligue 3
- Feminine Division 1
- National 2 - Group A
- National 2 - Group B

## Greece
- Super League 1
- Super League 2
- Gamma Ethniki - Group 1
- Gamma Ethniki - Group 2

## Italy
- Serie A
- Serie B
- Serie C - Girone A
- Serie A Women
- Serie D - Girone A
- Serie D - Girone B

## Norway
- Eliteserien
- 1. Division
- 2. Division - Group 1
- 2. Division - Group 2
- Toppserien
- 3. Division - Girone 1
- 3. Division - Girone 2

## Poland
- Ekstraklasa
- I Liga
- II Liga - East
- III Liga - Group 1
- III Liga - Group 2
- Ekstraliga Women
- Cup
- Super Cup

## Portugal
- Primeira Liga
- Segunda Liga
- Campeonato de Portugal Prio - Group A
- Campeonato de Portugal Prio - Group B

## Romania
- Liga I
- Liga II
- Liga 1 Feminin
- Liga III - Serie 1
- Liga III - Serie 2

## Russia
- Premier League
- First League
- Supreme Division Women
- Second League - Group 1
- Second League - Group 2

## Saudi-Arabia
- Pro League
- Division 1
- Premier League Women
- King's Cup
- Super Cup

## Serbia
- Super Liga
- Prva Liga
- Cup
- U19 league

## Slovakia
- Super Liga
- 2. liga
- 3. liga - Bratislava
- I Liga - Women
- 3. liga - Play-offs
- Cup

## Slovenia
- 1. SNL
- 2. SNL
- Cup

## South-Korea
- K League 1
- K League 2
- K3 League
- WK-League
- FA Cup

## Switzerland
- Super League
- Challenge League
- 1. Liga Promotion
- 1. Liga Classic - Group 1
- 1. Liga Classic - Group 2
- 1. Liga Classic - Group 3
- AXA Women's Super League

## Turkey
- Süper Lig
- 1. Lig
- 2. Lig
- 3. Lig - Group 1
- 3. Lig - Group 2
- 3. Lig - Play-offs
- Türkiye Kupası
- Super Cup

## Ukraine
- Premier League
- Persha Liga
- Cup
- Super Cup

## Interpretation notes
- Canada: the cross spanning League 1 Ontario and Northern Super League is interpreted as removing both. Only Canadian Premier League remains. (PDF page 3.)
- Slovakia: 3. liga - Bratislava is unmarked and remains; West, East and Center are removed. (PDF page 6.)
- Turkey: both crossed-out group entries are removed; Groups 1 and 2 and Play-offs remain. (PDF page 7.)
- Exact names are matched after accent/punctuation normalization. If a retained league is renamed by the API, the updater reports it as unavailable rather than inventing an ID or selecting an unrelated replacement.
