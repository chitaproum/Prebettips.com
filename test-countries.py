import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
spec=importlib.util.spec_from_file_location('updater',Path(__file__).parent/'fetch_data.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=dt.datetime(2026,10,3,12,tzinfo=m.UTC)
config=json.loads((Path(__file__).parent/'api-config.json').read_text())
countries=config['countryDiscovery']['countries']
rules=config['countryDiscovery']['allowedLeaguesByCountry']
LIMIT=max(1,min(30,int(config['countryDiscovery'].get('maxLeaguesPerCountry',10))))
assert len(countries)==76
assert len(set(countries))==76
assert all(c in countries for c in ['Switzerland','Saudi-Arabia','Ukraine','Serbia','Poland','Cyprus','Belarus','Portugal'])
assert all(c in countries for c in ['Armenia','Colombia','Costa-Rica','Northern-Ireland','Vietnam','Qatar','South-Africa'])
assert countries.count('Portugal')==1
assert m.COUNTRY_LABELS['Saudi-Arabia']=='Saudi Arabia'
# Every allowlisted competition name is unique within its country.
for country,names in rules.items():
 assert country in countries, country
 keys=[m.league_name_key(n) for n in names]
 assert len(keys)==len(set(keys)), country

def row(league_id,name,country,cup=False):
 return {'league':{'id':league_id,'name':name,'type':'Cup' if cup else 'League'},
  'country':{'name':country,'code':'XX'},'seasons':[{'year':2026,'current':True,'coverage':{}}]}

# Discovery with the real country/allowlist settings, but no pre-seeded leagues,
# so each country's count reflects allowlist filtering alone.
disc_config=dict(config,leagues=[])
class CatalogAPI:
 def __init__(self):self.calls=0;self.remaining=7500
 def get(self,endpoint,**p):
  assert endpoint=='/leagues' and p['current']=='true'
  self.calls+=1
  country=p['country'];base=countries.index(country)*1000+10000
  if country in rules:
   # Serve every allowlisted competition plus unlisted extras that MUST be dropped.
   out=[row(base+i,nm,country) for i,nm in enumerate(rules[country])]
   out+=[row(base+500+j,'Unlisted Competition '+str(j),country,cup=True) for j in range(3)]
   return out
  # No allowlist: 12 competitions (8 leagues + 4 cups) to exercise the ten cap.
  return [row(base+i,'Division '+str(i),country,cup=i>7) for i in range(12)]
api=CatalogAPI();cache={};warnings=[]
leagues=m.discover_leagues(disc_config,api,now,cache,warnings)
by_country={}
for x in leagues:by_country.setdefault(x['country'],[]).append(x)
for country in countries:
 got=by_country.get(country,[])
 if country in rules:
  # Only allowlisted competitions survive, capped at the per-country limit.
  assert len(got)==min(len(rules[country]),LIMIT),(country,len(got))
  allowed={m.league_name_key(n) for n in rules[country]}
  assert all(m.league_name_key(x['displayName']) in allowed for x in got),country
 else:
  # Twelve generic competitions reduced to the per-country cap.
  assert len(got)==min(LIMIT,12),(country,len(got))
assert len({x['id'] for x in leagues})==len(leagues)
assert len({x['name'] for x in leagues})==len(leagues)
# Every discovered league carries its country label in the display name.
assert all(' \u00b7 ' in x['name'] for x in leagues)
assert api.calls==len(countries)
# A fresh catalog cache serves the next run without extra API calls.
assert m.discover_leagues(disc_config,api,now+dt.timedelta(days=1),cache,[])==leagues and api.calls==len(countries)
# A clean catalog (all allowlisted names present, >=5 non-allowlist entries) warns about nothing.
assert not any('unavailable in current API catalog' in w for w in warnings)

# Allowlisted competitions absent from the catalog must raise a coverage warning,
# and only the available ones are returned.
missing_country='Switzerland'
present=rules[missing_country][:-1]
mc=dict(config,leagues=[],countryDiscovery=dict(config['countryDiscovery'],countries=[missing_country]))
class Missing:
 def __init__(self):self.calls=0;self.remaining=7000
 def get(self,endpoint,**p):
  self.calls+=1
  return [row(2000+i,nm,missing_country) for i,nm in enumerate(present)]
w=[]
got=m.discover_leagues(mc,Missing(),now,{},w)
assert len(got)==len(present)
assert all(m.league_name_key(x['displayName']) in {m.league_name_key(n) for n in present} for x in got)
assert any(missing_country in msg and 'unavailable in current API catalog' in msg for msg in w)
assert rules[missing_country][-1] in w[0]

# A country without an allowlist still warns when fewer than five competitions exist.
nc=next(c for c in countries if c not in rules)
fc=dict(config,leagues=[],countryDiscovery=dict(config['countryDiscovery'],countries=[nc]))
class Few:
 def __init__(self):self.calls=0;self.remaining=7000
 def get(self,endpoint,**p):
  self.calls+=1
  return [row(3000+i,'League '+str(i),nc) for i in range(2)]
w=[]
got=m.discover_leagues(fc,Few(),now,{},w)
assert len(got)==2 and any(nc in msg for msg in w)

class Raw:
 def __init__(self):self.calls=0;self.remaining=7000
 def get(self,*a,**p):self.calls+=1;return [{'ok':True}]
r=Raw();requests={};a=m.CachedClient(r,requests,now,config)
a.get('/fixtures',league=39,season=2026);a.get('/fixtures',season=2026,league=39);assert r.calls==1
m.CachedClient(r,requests,now+dt.timedelta(hours=7),config).get('/fixtures',league=39,season=2026);assert r.calls==2
# Two competitions involving the same team must retain separate model ratings.
class Matches:
 calls=0;remaining=7400
 def get(self,ep,**p):
  self.calls+=1
  if ep=='/leagues':return [{'seasons':[{'year':2026,'current':True,'coverage':{}}]}]
  if ep=='/fixtures':
   lid=p['league'];gh=4 if lid==39 else 0
   return [{'fixture':{'id':lid,'date':'2026-10-01T15:00:00+00:00','status':{'short':'FT'}},'teams':{'home':{'id':1,'name':'Shared Team'},'away':{'id':2,'name':'Opponent'}},'goals':{'home':gh,'away':1},'score':{}}]
  raise AssertionError(ep)
with tempfile.TemporaryDirectory() as td:
 p=Path(td);c=dict(config,countryDiscovery={'enabled':False},requestCache={'enabled':False},fetchPreviousSeason=False,odds={'enabled':False},leagues=[{'id':39,'name':'League','country':'England'},{'id':40,'name':'Cup','country':'England'}]);(p/'api-config.json').write_text(json.dumps(c))
 d=m.run(p,Matches(),now)
 assert d['teamsByLeague']['League']['Shared Team']['att'] != d['teamsByLeague']['Cup']['Shared Team']['att']
 assert len(d['leagues'])==2 and len(d['history'])==2
 assert (p/'api-request-cache.json').exists() and (p/'league-discovery-cache.json').exists()
print('PASS: 76 countries, allowlist filtering (unlisted dropped, missing warned), per-country cap, country-labelled unique IDs/names, discovery cache, short-coverage warnings, request cache expiry and competition-isolated model ratings.')
