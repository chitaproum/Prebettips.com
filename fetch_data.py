#!/usr/bin/env python3
"""API-Football v3 -> static website data. Python 3.11+, standard library only.
Read the API key ONLY from API_FOOTBALL_KEY. No browser-side API requests.
"""
import datetime as dt
import json
import math
import re
import unicodedata
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

BASE = 'https://v3.football.api-sports.io'
UTC = dt.timezone.utc
LIVE = {'1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'}
FINISHED = {'FT', 'AET', 'PEN'}
DISPLAY = LIVE | FINISHED | {'NS', 'TBD'}

def stamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))

def load_json(path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text())

class Client:
    def __init__(self, key, budget=500):
        self.key, self.budget, self.calls = key, budget, 0
        self.remaining = None
        self.reserve = 0
        self.last_request = 0.0

    def get(self, endpoint, **params):
        results, page = [], 1
        while True:
            q = dict(params)
            if page > 1:
                q['page'] = page
            url = BASE + endpoint + '?' + urllib.parse.urlencode(q)
            for attempt in range(3):
                if self.remaining is not None and self.remaining <= self.reserve:
                    raise RuntimeError('Daily API reserve reached; existing data preserved.')
                if self.calls >= self.budget:
                    raise RuntimeError('Configured per-run request budget reached; existing data preserved.')
                wait = 0.7 - (time.monotonic() - self.last_request)
                if wait > 0: time.sleep(wait)
                self.last_request = time.monotonic()
                self.calls += 1
                req = urllib.request.Request(url, headers={'x-apisports-key': self.key, 'Accept': 'application/json'})
                try:
                    with urllib.request.urlopen(req, timeout=60) as response:
                        remaining = response.headers.get('x-ratelimit-requests-remaining')
                        if remaining is not None:
                            self.remaining = int(remaining)
                        payload = json.load(response)
                    break
                except urllib.error.HTTPError as e:
                    if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                        time.sleep(10 * (attempt + 1))
                        continue
                    raise RuntimeError(f'API HTTP {e.code} on {endpoint}; check subscription, key, or quota.') from None
                except (urllib.error.URLError, TimeoutError):
                    if attempt < 2:
                        time.sleep(3 * (attempt + 1))
                        continue
                    raise RuntimeError(f'API network timeout on {endpoint}; existing data preserved.') from None
            errors = payload.get('errors')
            if errors:
                # Avoid echoing arbitrary server content, which could contain secrets.
                fields = ', '.join(errors.keys()) if isinstance(errors, dict) else 'response'
                raise RuntimeError(f'API returned errors on {endpoint} ({fields}); inspect your provider dashboard.')
            if not isinstance(payload.get('response'), list):
                raise RuntimeError(f'Unexpected API response on {endpoint}.')
            results.extend(payload['response'])
            pages = int(payload.get('paging', {}).get('total', 1))
            if page >= pages:
                return results
            page += 1
            time.sleep(0.35)

def normalize(f, league, season, tz):
    fix = f['fixture']; goals = f.get('goals') or {}; score = f.get('score') or {}
    status = fix['status']['short']
    # Regulation-time models and stats must not include extra-time or shootout goals.
    final = (score.get('fulltime') or {}) if status in {'AET','PEN'} else goals
    half = score.get('halftime') or {}
    row = {
        'id':fix['id'], 'homeId':f['teams']['home']['id'], 'awayId':f['teams']['away']['id'],
        'home':f['teams']['home']['name'], 'away':f['teams']['away']['name'],
        'homeLogo':f['teams']['home'].get('logo'), 'awayLogo':f['teams']['away'].get('logo'),
        'league':league['name'], 'leagueId':league['id'], 'country':league.get('country',''), 'season':season,
        'date':stamp(fix['date']).astimezone(tz).strftime('%Y-%m-%d %H:%M'),
        'kickoffUtc':stamp(fix['date']).astimezone(UTC).isoformat(),
        'round':(f.get('league') or {}).get('round') or '',
        'status':status, 'live':status in LIVE, 'elapsed':fix['status'].get('elapsed'),
        'fh':final.get('home'), 'fa':final.get('away'),
        'currentHome':goals.get('home'), 'currentAway':goals.get('away'),
        'ht':[half.get('home'),half.get('away')] if half.get('home') is not None and half.get('away') is not None else None
    }
    return row

def complete(row):
    return row['status'] in FINISHED and isinstance(row['fh'],int) and isinstance(row['fa'],int)

def poisson(home, away, base, advantage):
    lh = max(.15,min(6, home['att'] * away['def'] * base / 2 * advantage))
    la = max(.15,min(6, away['att'] * home['def'] * base / 2))
    h=d=a=o=0.; best=-1.; bh=ba=0
    for i in range(8):
        for j in range(8):
            p = math.exp(-lh-la) * lh**i * la**j / math.factorial(i) / math.factorial(j)
            if i>j: h+=p
            elif i<j: a+=p
            else: d+=p
            if i+j>2: o+=p
            if p>best: best,bh,ba=p,i,j
    total=h+d+a
    return {'pHome':h/total,'pDraw':d/total,'pAway':a/total,'pOver':max(.02,min(.98,o)),
            'scoreH':bh,'scoreA':ba,'expH':lh,'expA':la,'expTotal':lh+la}


def parse_odds(rows, fixture_id):
    """Only regulation-time Match Winner and Goals Over/Under at exactly 2.5."""
    books = {}
    updated = None
    for row in rows:
        if str((row.get('fixture') or {}).get('id')) != str(fixture_id):
            continue
        updated = row.get('update') or updated
        for book in row.get('bookmakers') or []:
            ident = str(book.get('id', ''))
            if not ident: continue
            target = books.setdefault(ident, {'id':book['id'], 'name':book.get('name') or ident, 'markets':{}})
            for bet in book.get('bets') or []:
                # API-Football v3 bet IDs: 1 Match Winner, 5 Goals Over/Under.
                bid = str(bet.get('id'))
                name = (bet.get('name') or '').strip().lower()
                if bid == '1' and name in ('', 'match winner'):
                    market='1x2'; mapping={'home':'1','draw':'X','away':'2'}
                elif bid == '5' and name in ('', 'goals over/under'):
                    market='ou'; mapping={'over 2.5':'over','under 2.5':'under'}
                else: continue
                values = target['markets'].setdefault(market,{})
                for v in bet.get('values') or []:
                    key=mapping.get(str(v.get('value','')).strip().lower())
                    try: odd=float(v.get('odd'))
                    except (TypeError,ValueError): continue
                    if key and math.isfinite(odd) and odd>1: values[key]=odd
    return {'bookmakers':[b for b in books.values() if any(b['markets'].values())], 'providerUpdatedAt':updated}

def update_odds(fixtures, config, api, cache, now, warnings, coverage):
    opts=config.get('odds',{})
    if not opts.get('enabled',False): return
    ttl=float(opts.get('cacheHours',6))*3600
    max_age=float(opts.get('maxDisplayAgeHours',24))*3600
    horizon=now+dt.timedelta(days=int(opts.get('daysAhead',7)))
    candidates=[r for r in fixtures if r['status']=='NS' and now<stamp(r['kickoffUtc'])<=horizon]
    # Refresh earliest kickoffs first, while bounding extra requests per run.
    calls=0; limit=max(0,int(opts.get('maxFixturesPerRun',30)))
    for r in candidates:
        if coverage.get(r['leagueId']) is False: continue
        key=str(r['id']); entry=cache.get(key)
        fresh=entry and 0 <= (now-stamp(entry['fetchedAt'])).total_seconds()<ttl
        if not fresh and calls<limit and api.calls < getattr(api,'budget',float('inf')):
            calls+=1
            try:
                fetched=parse_odds(api.get('/odds',fixture=r['id']),r['id'])
                # Successful empty response means no current quote; do not invent or retain one.
                entry=dict(fetched,fetchedAt=now.isoformat(),kickoffUtc=r['kickoffUtc'])
                cache[key]=entry
            except RuntimeError:
                warnings.append('Odds update failed for fixture '+key+'; any cached quote is age-limited.')
        if entry and 0 <= (now-stamp(entry['fetchedAt'])).total_seconds()<=max_age and entry.get('bookmakers'):
            # Provider update time must also be recent when supplied.
            try: provider_age=(now-stamp(entry.get('providerUpdatedAt') or entry['fetchedAt'])).total_seconds()
            except (ValueError,TypeError): provider_age=max_age+1
            if -300<=provider_age<=max_age:
                r['odds']=dict(entry,cached=(now-stamp(entry['fetchedAt'])).total_seconds()>=ttl)
    for key in list(cache):
        if (now-stamp(cache[key]['fetchedAt'])).total_seconds()>30*86400:
            del cache[key]


COUNTRY_LABELS = {'South-Korea':'South Korea', 'Czech-Republic':'Czech Republic', 'Saudi-Arabia':'Saudi Arabia'}

class CachedClient:
    """Persistent server-side request cache. Never published in the Pages artifact."""
    def __init__(self, api, cache, now, config):
        self.api, self.cache, self.now, self.config = api, cache, now, config
    @property
    def calls(self): return self.api.calls
    @property
    def remaining(self): return self.api.remaining
    @property
    def budget(self): return getattr(self.api, 'budget', float('inf'))
    def get(self, endpoint, **params):
        opts = self.config.get('requestCache', {})
        ttl = 0
        if opts.get('enabled'):
            if endpoint == '/leagues': ttl = opts.get('metadataHours',168)
            elif endpoint == '/fixtures':
                ttl = opts.get('fixturesHours',6)
                if params.get('season') in getattr(self, 'previous_years', set()):
                    ttl = opts.get('previousSeasonHours',168)
            elif endpoint == '/standings': ttl = opts.get('standingsHours',12)
        key = endpoint + '?' + urllib.parse.urlencode(sorted(params.items()))
        entry = self.cache.get(key)
        if ttl and entry and 0 <= (self.now-stamp(entry['at'])).total_seconds() < ttl*3600:
            return entry['rows']
        rows = self.api.get(endpoint, **params)
        if ttl: self.cache[key] = {'at':self.now.isoformat(), 'rows':rows}
        return rows

def league_name_key(name):
    """Normalize API display-name punctuation without guessing competition IDs."""
    text = unicodedata.normalize('NFKD', str(name)).casefold()
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9]+', '', text)

def league_is_allowed(league, config):
    rules = config.get('countryDiscovery', {}).get('allowedLeaguesByCountry', {})
    country = league.get('country')
    if country not in rules:
        return True
    name = league.get('displayName') or league.get('name', '').split(' · ')[0]
    return league_name_key(name) in {league_name_key(n) for n in rules[country]}

def discover_leagues(config, api, now, catalog_cache, warnings):
    opts = config.get('countryDiscovery', {})
    configured = [x for x in config.get('leagues', []) if league_is_allowed(x, config)]
    if not opts.get('enabled'): return configured
    selected = {x['id']:dict(x) for x in configured}
    limit = max(1, min(10, int(opts.get('maxLeaguesPerCountry',10))))
    for country in opts.get('countries', []):
        entry = catalog_cache.get(country)
        fresh = entry and 0 <= (now-stamp(entry['at'])).total_seconds() < opts.get('cacheHours',168)*3600
        if not fresh:
            rows = api.get('/leagues', country=country, current='true')
            entry = {'at':now.isoformat(), 'rows':rows}
            catalog_cache[country] = entry
        candidates = []
        for row in entry['rows']:
            league = row.get('league', {})
            if not league.get('id') or not row.get('seasons'): continue
            if not opts.get('includeCups',True) and league.get('type') == 'Cup': continue
            if not league_is_allowed({'country':country, 'name':league.get('name','')}, config): continue
            candidates.append(row)
        priority = {x['id'] for x in configured if x['country']==country}
        def rank(row):
            lg=row['league']; name=lg['name'].lower()
            youth=any(t in name for t in ['u17','u18','u19','u20','u21','u23','youth','reserve'])
            return (lg['id'] not in priority, youth, lg.get('type') != 'League', lg['id'])
        candidates.sort(key=rank)
        chosen = candidates[:limit]
        # Existing priority leagues count toward this country's ten-competition cap.
        used = sum(x['country']==country for x in selected.values())
        for row in chosen:
            lg=row['league']
            if lg['id'] in selected:
                selected[lg['id']]['_meta']=[row]
                continue
            if used >= limit: break
            label=COUNTRY_LABELS.get(country,country)
            selected[lg['id']]={'id':lg['id'], 'name':lg['name']+' · '+label,
                'displayName':lg['name'], 'country':country,
                'icon':row.get('country',{}).get('code') or '⚽', '_meta':[row]}
            used+=1
        rules = opts.get('allowedLeaguesByCountry', {})
        if country in rules:
            available = {league_name_key(r['league']['name']) for r in candidates}
            missing = [n for n in rules[country] if league_name_key(n) not in available]
            if missing:
                warnings.append(country+': selected competitions unavailable in current API catalog: '+', '.join(missing))
        if len(chosen)<5 and country not in rules:
            warnings.append(country+': fewer than five current competitions returned by the API; no invented leagues added.')
    return list(selected.values())

def run(root, api=None, now=None):
    root = Path(root)
    config = load_json(root/'api-config.json', {})
    tz = ZoneInfo(config.get('timezone','UTC'))
    now = now or dt.datetime.now(UTC)
    today = now.astimezone(tz).date()
    if api is None:
        key = os.environ.get('API_FOOTBALL_KEY')
        if not key:
            raise RuntimeError('Missing API_FOOTBALL_KEY. Add it as a GitHub Actions repository secret.')
        api = Client(key,config.get('maxRequestsPerRun',500))
        api.reserve = int(config.get('dailyRequestsReserve',500))
    archive = load_json(root/'prediction-archive.json', {})
    cache = load_json(root/'h2h-cache.json', {})
    odds_cache = load_json(root/'odds-cache.json', {})
    request_cache = load_json(root/'api-request-cache.json', {})
    discovery_cache = load_json(root/'league-discovery-cache.json', {})
    api = CachedClient(api, request_cache, now, config)
    odds_coverage = {}
    teams, standings, seasons, all_results, fixture_map = {}, {}, {}, {}, {}
    league_averages, league_catalog, warnings = {}, [], []
    teams_by_league = {}
    league_fixtures, standings_tables = {}, {}
    configured_leagues = discover_leagues(config, api, now, discovery_cache, warnings)
    for lg in configured_leagues:
        print('Fetching '+lg['name'], flush=True)
        meta = lg.get('_meta') or api.get('/leagues',id=lg['id'])
        if not meta or not meta[0].get('seasons'):
            warnings.append('No seasons available for '+lg['name']); continue
        choices = meta[0]['seasons']
        within = [s for s in choices if s.get('start','9999') <= today.isoformat() <= s.get('end','0000')]
        current = [s for s in choices if s.get('current')]
        chosen = max(within or current or choices,key=lambda s:s['year'])
        year = lg.get('season') or chosen['year']
        seasons[lg['name']] = year
        coverage = next((s.get('coverage',{}) for s in choices if s['year']==year),{})
        odds_coverage[lg['id']] = coverage.get('odds')
        catalog = dict({k:v for k,v in lg.items() if not k.startswith('_')},season=year,coverage=coverage)
        league_catalog.append(catalog)
        raw = api.get('/fixtures',league=lg['id'],season=year,timezone=config.get('timezone','UTC'))
        if not raw:
            warnings.append('No current-season fixtures for '+lg['name']); continue
        current_rows = [normalize(f,lg,year,tz) for f in raw]
        league_fixtures[lg['name']] = [r for r in current_rows if not complete(r)]
        finished = [r for r in current_rows if complete(r)]
        played, goals = len(finished),sum(r['fh']+r['fa'] for r in finished)
        observed_avg = goals/played if played else 0
        # A zero-goal season must not cause division by zero in model ratings.
        avg = observed_avg if observed_avg > 0 else 2.7
        league_averages[lg['name']] = round(avg,5)
        form = {}
        league_teams = {}
        for r in finished:
            all_results[r['id']] = r
            for name,gf,ga in [(r['home'],r['fh'],r['fa']),(r['away'],r['fa'],r['fh'])]:
                rec=form.setdefault(name,[0,0,0]); rec[0]+=1; rec[1]+=gf; rec[2]+=ga
        for r in current_rows:
            for side in ['home','away']:
                name = r[side]; n,gf,ga = form.get(name,[0,0,0]); prior=5; baseline=avg/2
                league_teams[name] = {'id':r[side+'Id'],'logo':r[side+'Logo'],'league':lg['name'],
                    'att':round((gf+prior*baseline)/(n+prior)/baseline,5),
                    'def':round((ga+prior*baseline)/(n+prior)/baseline,5),'played':n}
            day = r['date'][:10]
            if (today-dt.timedelta(days=config.get('daysBack',2))).isoformat() <= day <= (today+dt.timedelta(days=config.get('daysAhead',14))).isoformat() and r['status'] in DISPLAY:
                fixture_map[r['id']] = r
        teams_by_league[lg['name']] = league_teams
        teams.update(league_teams)
        if coverage.get('standings'):
            tables = api.get('/standings',league=lg['id'],season=year)
            standings_tables[lg['name']] = tables[0].get('league',{}).get('standings',[]) if tables else []
            ranks = {}
            for group in (tables[0].get('league',{}).get('standings',[]) if tables else []):
                for row in group:
                    ranks[row['team']['name']] = row['rank']
            standings[lg['name']] = ranks
            if not ranks:
                warnings.append('Standings unavailable for '+lg['name'])
        else:
            standings[lg['name']] = {}
            warnings.append('Standings not covered for '+lg['name'])
        if config.get('fetchPreviousSeason',True):
            previous = [s['year'] for s in choices if s['year'] < year]
            if previous:
                prev = max(previous)
                api.previous_years = {prev}
                for f in api.get('/fixtures',league=lg['id'],season=prev,timezone=config.get('timezone','UTC')):
                    r = normalize(f,lg,prev,tz)
                    if complete(r): all_results[r['id']] = r
                api.previous_years = set()
    if not teams_by_league:
        raise RuntimeError('No usable fixtures returned for any selected competition; existing data preserved.')
    fixtures = sorted(fixture_map.values(),key=lambda r:r['kickoffUtc'])
    # Cache H2H separately so other competitions never inflate league season totals.
    h2h = {}
    h2h_refreshes = 0
    for r in fixtures:
        if r['status'] not in {'NS','TBD'} | LIVE: continue
        pair = '-'.join(str(i) for i in sorted([r['homeId'],r['awayId']]))
        entry=cache.get(pair)
        fresh=entry and (now-stamp(entry['fetchedAt'])).total_seconds() < config.get('h2hCacheHours',24)*3600
        if not fresh and h2h_refreshes >= config.get('maxH2HRefreshPerRun',60):
            h2h[pair] = entry['rows'] if entry else []
            continue
        if not fresh:
            h2h_refreshes += 1
            rows=[]
            for f in api.get('/fixtures/headtohead',h2h=pair,last=config.get('h2hLast',6),timezone=config.get('timezone','UTC')):
                lg={'name':f['league']['name'],'id':f['league']['id']}
                row=normalize(f,lg,f['league']['season'],tz)
                if complete(row): rows.append(row)
            entry={'fetchedAt':now.isoformat(),'rows':sorted(rows,key=lambda x:x['kickoffUtc'])}
            cache[pair]=entry
        h2h[pair]=entry['rows']
    update_odds(fixtures,config,api,odds_cache,now,warnings,odds_coverage)
    for r in fixtures:
        # New snapshots only for NOT STARTED fixtures strictly before kickoff.
        # Preserve the FIRST recorded prediction; never fabricate historical accuracy.
        if r['status']=='NS' and stamp(r['kickoffUtc'])>now:
            key=str(r['id']); existing=archive.get(key)
            if existing and stamp(existing['savedAt'])>=stamp(r['kickoffUtc']):
                archive.pop(key,None)
            if key not in archive:
                p=poisson(teams_by_league[r['league']][r['home']],teams_by_league[r['league']][r['away']],league_averages[r['league']],config.get('homeAdvantage',1.15))
                archive[key]={'savedAt':now.isoformat(),'kickoffUtc':r['kickoffUtc'],'home':r['home'],
                    'away':r['away'],'league':r['league'],'model':'poisson-v1','prediction':p}
        saved=archive.get(str(r['id']))
        if saved and stamp(saved['savedAt'])<stamp(r['kickoffUtc']): r['prediction']=saved['prediction']
    results=sorted(all_results.values(),key=lambda x:x['kickoffUtc'])
    history=[r for r in results if r['season']==seasons.get(r['league'])]
    # Results page shows recent results plus all settled archived forecasts in retained seasons.
    visible=[]
    for r in history:
        saved=archive.get(str(r['id']))
        if saved and stamp(saved['savedAt'])<stamp(r['kickoffUtc']):
            r['prediction']=saved['prediction']; r['predictionSavedAt']=saved['savedAt']
        if r['date'][:10]>=(today-dt.timedelta(days=30)).isoformat() or r.get('prediction'): visible.append(r)
    total_goals=sum(r['fh']+r['fa'] for r in history)
    data={'source':'API-Football','demo':False,'generatedAt':now.isoformat(),'today':today.isoformat(),
        'timezone':config.get('timezone','UTC'),'leagueAvgGoals':total_goals/len(history) if history else 2.7,
        'leagueAvgGoalsByLeague':league_averages,'homeAdvantage':config.get('homeAdvantage',1.15),
        'teams':teams,'teamsByLeague':teams_by_league,'fixtures':fixtures,'history':history,'recentResults':visible,
        'matches':results,'h2h':h2h,'standings':standings,'seasons':seasons,
        'leagueFixtures':league_fixtures,'standingsTables':standings_tables,
        'popularLeagues':[x for x in league_catalog if x['id'] in {v['id'] for v in config.get('leagues',[])}],
        'leagues':league_catalog,'countries':sorted(set(config.get('countryDiscovery',{}).get('countries',[])) | {x['country'] for x in configured_leagues}),
        'oddsConfig':config.get('odds',{}),'warnings':warnings,'apiRequestsThisRun':api.calls,'apiRequestsRemaining':api.remaining}
    # Reject accidentally leaked keys anywhere in public output; write only after success.
    output='/* Generated from API-Football. No API key. */\nwindow.DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n'
    secret=os.environ.get('API_FOOTBALL_KEY','')
    if secret and secret in output: raise RuntimeError('Secret detected in output; refusing to publish.')
    files={'api-request-cache.json':json.dumps(request_cache,ensure_ascii=False,separators=(',',':'))+'\n',
           'league-discovery-cache.json':json.dumps(discovery_cache,ensure_ascii=False,separators=(',',':'))+'\n',
           'data.js':output,'prediction-archive.json':json.dumps(archive,ensure_ascii=False,indent=2)+'\n',
           'odds-cache.json':json.dumps(odds_cache,ensure_ascii=False,separators=(',',':'))+'\n',
           'h2h-cache.json':json.dumps(cache,ensure_ascii=False,separators=(',',':'))+'\n'}
    for name,content in files.items():
        tmp=root/(name+'.tmp'); tmp.write_text(content,encoding='utf-8'); tmp.replace(root/name)
    print(f'Updated {len(fixtures)} fixtures, {len(results)} completed matches, {len(teams)} teams. Requests: {api.calls}.')
    for warning in warnings: print('WARNING: '+warning)
    return data

if __name__=='__main__':
    try: run(Path(__file__).resolve().parent)
    except Exception as exc:
        print('ERROR: '+str(exc)); raise SystemExit(1)
