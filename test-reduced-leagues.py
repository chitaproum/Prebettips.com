import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
p=Path(__file__).parent
spec=importlib.util.spec_from_file_location('updater',p/'fetch_data.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
c=json.loads((p/'api-config.json').read_text()); now=dt.datetime(2026,10,3,12,tzinfo=m.UTC)
rules=c['countryDiscovery']['allowedLeaguesByCountry']
class Catalog:
 calls=0;remaining=7400
 def get(self,ep,**params):
  assert ep=='/leagues';self.calls+=1
  co=params['country']; names=rules.get(co,['Division '+str(i) for i in range(12)])+['REMOVED UNLISTED COMPETITION']
  start=c['countryDiscovery']['countries'].index(co)*1000+10000
  return [{'league':{'id':start+i,'name':n,'type':'League'},'country':{'code':'XX'},'seasons':[{'year':2026,'current':True}]} for i,n in enumerate(names)]
a=Catalog();cache={}; selected=m.discover_leagues(c,a,now,cache,[])
for co,names in rules.items():
 found=[x for x in selected if x['country']==co]
 assert {m.league_name_key(x.get('displayName') or x['name']) for x in found}=={m.league_name_key(n) for n in names}
 assert all(m.league_is_allowed(x,c) for x in found)
assert a.calls==47
assert selected==m.discover_leagues(c,a,now+dt.timedelta(days=1),cache,[]) and a.calls==47
assert len([x for x in selected if x['country']=='England'])==10
assert not m.league_is_allowed({'country':'Canada','name':'Northern Super League'},c)
assert m.league_is_allowed({'country':'Turkey','name':'Super Lig'},c)
# Configured leagues cannot bypass the rules, even when discovery is disabled.
bad=dict(c,leagues=[{'id':999,'name':'Primera D','country':'Argentina'}],countryDiscovery=dict(c['countryDiscovery'],enabled=False))
assert m.discover_leagues(bad,a,now,{},[])==[]
class ZeroGoals:
 calls=0;remaining=7400
 def get(self,ep,**params):
  self.calls+=1
  if ep=='/leagues':return [{'seasons':[{'year':2026,'current':True,'coverage':{}}]}]
  if ep=='/fixtures':
   return [{'fixture':{'id':1,'date':'2026-10-01T15:00:00+00:00','status':{'short':'FT'}},'teams':{'home':{'id':1,'name':'A'},'away':{'id':2,'name':'B'}},'goals':{'home':0,'away':0},'score':{}}]
  raise AssertionError(ep)
with tempfile.TemporaryDirectory() as td:
 root=Path(td); test=dict(c,leagues=[{'id':39,'name':'Test','country':'England'}],countryDiscovery={'enabled':False},requestCache={'enabled':False},fetchPreviousSeason=False,odds={'enabled':False})
 (root/'api-config.json').write_text(json.dumps(test));d=m.run(root,ZeroGoals(),now)
 assert d['history'][0]['fh']==d['history'][0]['fa']==0
 assert d['leagueAvgGoalsByLeague']['Test']==2.7
 assert d['teams']['A']['att']>0
print('PASS: all 27 country allowlists, cached catalog filtering, unchanged countries, configured exclusions, name normalization, and zero-goal regression.')
