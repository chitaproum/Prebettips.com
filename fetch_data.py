#!/usr/bin/env python3
"""API-Football v3 -> static website data. Python 3.11+, standard library only.
Read the API key ONLY from API_FOOTBALL_KEY. No browser-side API requests.
"""
import datetime as dt
import json
import math
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

    def get(self, endpoint, **params):
        results, page = [], 1
        while True:
            q = dict(params)
            if page > 1:
                q['page'] = page
            url = BASE + endpoint + '?' + urllib.parse.urlencode(q)
            for attempt in range(3):
                if self.calls >= self.budget:
                    raise RuntimeError('Configured per-run request budget reached; existing data preserved.')
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
        'league':league['name'], 'leagueId':league['id'], 'season':season,
        'date':stamp(fix['date']).astimezone(tz).strftime('%Y-%m-%d %H:%M'),
        'kickoffUtc':stamp(fix['date']).astimezone(UTC).isoformat(),
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
    archive = load_json(root/'prediction-archive.json', {})
    cache = load_json(root/'h2h-cache.json', {})
    teams, standings, seasons, all_results, fixture_map = {}, {}, {}, {}, {}
    league_averages, league_catalog, warnings = {}, [], []
    for lg in config['leagues']:
        print('Fetching '+lg['name'], flush=True)
        meta = api.get('/leagues',id=lg['id'])
        if not meta or not meta[0].get('seasons'):
            raise RuntimeError('No seasons available for '+lg['name'])
        choices = meta[0]['seasons']
        within = [s for s in choices if s.get('start','9999') <= today.isoformat() <= s.get('end','0000')]
        current = [s for s in choices if s.get('current')]
        chosen = max(within or current or choices,key=lambda s:s['year'])
        year = lg.get('season') or chosen['year']
        seasons[lg['name']] = year
        coverage = next((s.get('coverage',{}) for s in choices if s['year']==year),{})
        catalog = dict(lg,season=year,coverage=coverage)
        league_catalog.append(catalog)
        raw = api.get('/fixtures',league=lg['id'],season=year,timezone=config.get('timezone','UTC'))
        if not raw:
            raise RuntimeError('No current-season fixtures returned for '+lg['name']+'; existing data preserved.')
        current_rows = [normalize(f,lg,year,tz) for f in raw]
        finished = [r for r in current_rows if complete(r)]
        played, goals = len(finished),sum(r['fh']+r['fa'] for r in finished)
        avg = goals/played if played else 2.7
        league_averages[lg['name']] = round(avg,5)
        form = {}
        for r in finished:
            all_results[r['id']] = r
            for name,gf,ga in [(r['home'],r['fh'],r['fa']),(r['away'],r['fa'],r['fh'])]:
                rec=form.setdefault(name,[0,0,0]); rec[0]+=1; rec[1]+=gf; rec[2]+=ga
        for r in current_rows:
            for side in ['home','away']:
                name = r[side]; n,gf,ga = form.get(name,[0,0,0]); prior=5; baseline=avg/2
                teams[name] = {'id':r[side+'Id'],'logo':r[side+'Logo'],'league':lg['name'],
                    'att':round((gf+prior*baseline)/(n+prior)/baseline,5),
                    'def':round((ga+prior*baseline)/(n+prior)/baseline,5),'played':n}
            day = r['date'][:10]
            if (today-dt.timedelta(days=config.get('daysBack',2))).isoformat() <= day <= (today+dt.timedelta(days=config.get('daysAhead',14))).isoformat() and r['status'] in DISPLAY:
                fixture_map[r['id']] = r
        if coverage.get('standings'):
            tables = api.get('/standings',league=lg['id'],season=year)
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
                for f in api.get('/fixtures',league=lg['id'],season=prev,timezone=config.get('timezone','UTC')):
                    r = normalize(f,lg,prev,tz)
                    if complete(r): all_results[r['id']] = r
    fixtures = sorted(fixture_map.values(),key=lambda r:r['kickoffUtc'])
    # Cache H2H separately so other competitions never inflate league season totals.
    h2h = {}
    for r in fixtures:
        if r['status'] not in {'NS','TBD'} | LIVE: continue
        pair = '-'.join(str(i) for i in sorted([r['homeId'],r['awayId']]))
        entry=cache.get(pair)
        fresh=entry and (now-stamp(entry['fetchedAt'])).total_seconds() < config.get('h2hCacheHours',24)*3600
        if not fresh:
            rows=[]
            for f in api.get('/fixtures/headtohead',h2h=pair,last=config.get('h2hLast',6),timezone=config.get('timezone','UTC')):
                lg={'name':f['league']['name'],'id':f['league']['id']}
                row=normalize(f,lg,f['league']['season'],tz)
                if complete(row): rows.append(row)
            entry={'fetchedAt':now.isoformat(),'rows':sorted(rows,key=lambda x:x['kickoffUtc'])}
            cache[pair]=entry
        h2h[pair]=entry['rows']
    for r in fixtures:
        # New snapshots only for NOT STARTED fixtures strictly before kickoff.
        # Preserve the FIRST recorded prediction; never fabricate historical accuracy.
        if r['status']=='NS' and stamp(r['kickoffUtc'])>now:
            key=str(r['id']); existing=archive.get(key)
            if existing and stamp(existing['savedAt'])>=stamp(r['kickoffUtc']):
                archive.pop(key,None)
            if key not in archive:
                p=poisson(teams[r['home']],teams[r['away']],league_averages[r['league']],config.get('homeAdvantage',1.15))
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
        'teams':teams,'fixtures':fixtures,'history':history,'recentResults':visible,
        'matches':results,'h2h':h2h,'standings':standings,'seasons':seasons,
        'popularLeagues':league_catalog,'countries':sorted({x['country'] for x in config['leagues']}),
        'warnings':warnings,'apiRequestsThisRun':api.calls,'apiRequestsRemaining':api.remaining}
    # Reject accidentally leaked keys anywhere in public output; write only after success.
    output='/* Generated from API-Football. No API key. */\nwindow.DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n'
    secret=os.environ.get('API_FOOTBALL_KEY','')
    if secret and secret in output: raise RuntimeError('Secret detected in output; refusing to publish.')
    files={'data.js':output,'prediction-archive.json':json.dumps(archive,ensure_ascii=False,indent=2)+'\n',
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
