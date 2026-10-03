import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
spec=importlib.util.spec_from_file_location('updater',Path(__file__).parent/'fetch_data.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=dt.datetime(2026,10,3,12,tzinfo=m.UTC)
config=json.loads((Path(__file__).parent/'api-config.json').read_text())
assert len(config['countryDiscovery']['countries'])==47
assert len(set(config['countryDiscovery']['countries']))==47
assert all(c in config['countryDiscovery']['countries'] for c in ['Switzerland','Saudi-Arabia','Ukraine','Serbia','Poland','Cyprus','Belarus','Portugal'])
assert config['countryDiscovery']['countries'].count('Portugal')==1
assert m.COUNTRY_LABELS['Saudi-Arabia']=='Saudi Arabia'
class CatalogAPI:
 def __init__(self):self.calls=0;self.remaining=7500
 def get(self,endpoint,**p):
  assert endpoint=='/leagues' and p['current']=='true'
  self.calls+=1
  base=config['countryDiscovery']['countries'].index(p['country'])*1000+10000
  return [{'league':{'id':base+i,'name':'Division '+str(i),'type':'Cup' if i>7 else 'League'},'country':{'name':p['country'],'code':'XX'},'seasons':[{'year':2026,'current':True,'coverage':{}}]} for i in range(12)]
api=CatalogAPI();cache={};warnings=[]
leagues=m.discover_leagues(config,api,now,cache,warnings)
for country in config['countryDiscovery']['countries']:
 assert len([x for x in leagues if x['country']==country])==10
assert len({x['id'] for x in leagues})==len(leagues)
assert len({x['name'] for x in leagues})==len(leagues)
assert api.calls==47
assert m.discover_leagues(config,api,now+dt.timedelta(days=1),cache,[])==leagues and api.calls==47
class Few(CatalogAPI):
 def get(self,*a,**p):return super().get(*a,**p)[:2]
c=dict(config,leagues=[],countryDiscovery=dict(config['countryDiscovery'],countries=['Wales']))
w=[];assert len(m.discover_leagues(c,Few(),now,{},w))==2 and w
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
print('PASS: all 47 countries, ten-competition cap, unique verified IDs/names, discovery cache, short coverage warnings, request cache expiry and competition-isolated model ratings.')
