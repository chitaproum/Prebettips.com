import datetime as dt
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('updater',Path(__file__).parent/'fetch_data.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=dt.datetime(2026,10,3,12,tzinfo=m.UTC)
def payload(ident=11):
 return [{'fixture':{'id':ident},'update':now.isoformat(),'bookmakers':[{'id':8,'name':'Test Book','bets':[
 {'id':1,'name':'Match Winner','values':[{'value':'Home','odd':'1.85'},{'value':'Draw','odd':'3.6'},{'value':'Away','odd':'4.2'}]},
 {'id':5,'name':'Goals Over/Under','values':[{'value':'Over 2.5','odd':'1.9'},{'value':'Under 2.5','odd':'2.0'},{'value':'Over 3.5','odd':'3.0'}]},
 {'id':12,'name':'Goals Over/Under First Half','values':[{'value':'Over 2.5','odd':'8.0'}]}]},
 {'id':9,'name':'Other Book','bets':[{'id':1,'values':[{'value':'Home','odd':'2.0'},{'value':'Away','odd':'NaN'},{'value':'Draw','odd':'1'}]}]}]}]
class Fake:
 def __init__(self,rows=None,fail=False):self.calls=0;self.budget=100;self.rows=rows if rows is not None else payload();self.fail=fail
 def get(self,endpoint,**params):
  assert endpoint=='/odds';self.calls+=1
  if self.fail:raise RuntimeError('outage')
  return self.rows
config={'odds':{'enabled':True,'daysAhead':7,'cacheHours':6,'maxDisplayAgeHours':24,'maxFixturesPerRun':30}}
def fixture():return {'id':11,'leagueId':39,'status':'NS','kickoffUtc':(now+dt.timedelta(days=1)).isoformat()}
p=m.parse_odds(payload(),11);assert p['bookmakers'][0]['markets']=={'1x2':{'1':1.85,'X':3.6,'2':4.2},'ou':{'over':1.9,'under':2.0}}
assert p['bookmakers'][1]['markets']['1x2']=={'1':2.0}
assert m.parse_odds(payload(12),11)['bookmakers']==[]
cache={};warn=[];f=fixture();api=Fake();m.update_odds([f],config,api,cache,now,warn,{39:True});assert f['odds']['bookmakers'] and api.calls==1
f=fixture();api=Fake();m.update_odds([f],config,api,cache,now+dt.timedelta(hours=1),warn,{});assert api.calls==0 and f['odds']['bookmakers']
f=fixture();api=Fake(fail=True);m.update_odds([f],config,api,cache,now+dt.timedelta(hours=7),warn,{});assert f['odds']['cached'] and warn
f=fixture();api=Fake([]);m.update_odds([f],config,api,cache,now+dt.timedelta(hours=8),warn,{});assert 'odds' not in f and cache['11']['bookmakers']==[]
f=fixture();api=Fake();m.update_odds([f],config,api,cache,now+dt.timedelta(hours=9),warn,{});assert api.calls==0 and 'odds' not in f
cache={'11':dict(p,fetchedAt=(now-dt.timedelta(hours=25)).isoformat())};f=fixture();m.update_odds([f],config,Fake(fail=True),cache,now,[],{});assert 'odds' not in f
cache={'11':dict(p,fetchedAt=now.isoformat(),providerUpdatedAt=(now-dt.timedelta(hours=25)).isoformat())};f=fixture();m.update_odds([f],config,Fake(),cache,now,[],{});assert 'odds' not in f
for status in ['FT','2H','NS']:
 f=fixture();f['status']=status;f['kickoffUtc']=(now-dt.timedelta(minutes=1)).isoformat();api=Fake();m.update_odds([f],config,api,{},now,[],{});assert 'odds' not in f and api.calls==0
f=fixture();api=Fake();m.update_odds([f],config,api,{},now,[],{39:False});assert api.calls==0
config['odds']['maxFixturesPerRun']=0;f=fixture();api=Fake();m.update_odds([f],config,api,{},now,[],{});assert api.calls==0
print('PASS: exact markets/line, decimal validation, multiple bookmakers, fixture isolation, caching, empty quotes, age limits, provider freshness, failures, kickoff cutoff, coverage and lookup limit.')
