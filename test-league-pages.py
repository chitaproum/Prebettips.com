import importlib.util,datetime as dt,json,tempfile
from pathlib import Path
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('updater',root/'fetch_data.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=dt.datetime(2026,10,4,12,tzinfo=dt.timezone.utc)
def fixture(i,date,status='NS'):
 return {'fixture':{'id':i,'date':date,'status':{'short':status,'elapsed':None}},'league':{'id':39,'season':2026,'round':'Regular Season - 12'},'teams':{'home':{'id':1,'name':'Alpha'},'away':{'id':2,'name':'Beta'}},'goals':{'home':2 if status=='FT' else None,'away':1 if status=='FT' else None},'score':{'halftime':{'home':1,'away':0}}}
class Mock:
 def __init__(self):self.calls=0;self.remaining=7400
 def get(self,ep,**params):
  self.calls+=1
  if ep=='/leagues':return [{'seasons':[{'year':2026,'current':True,'coverage':{'standings':True}}]}]
  if ep=='/fixtures':return [fixture(1,'2026-10-01T15:00:00Z','FT'),fixture(2,'2026-10-05T15:00:00Z'),fixture(3,'2027-01-05T15:00:00Z')]
  if ep=='/standings':return [{'league':{'standings':[[{'rank':1,'team':{'name':'Alpha'},'points':15,'goalsDiff':6,'group':'Group A','all':{'played':6,'win':5,'draw':0,'lose':1}}]]}}]
  if ep=='/fixtures/headtohead':return []
  if ep=='/odds':return []
  raise AssertionError(ep)
with tempfile.TemporaryDirectory() as td:
 p=Path(td);cfg=json.loads((root/'api-config.json').read_text());cfg['countryDiscovery']['enabled']=False;cfg['requestCache']['enabled']=False;cfg['fetchPreviousSeason']=False;cfg['leagues']=[{'id':39,'name':'Test League','country':'England'}];(p/'api-config.json').write_text(json.dumps(cfg))
 data=m.run(p,Mock(),now)
 assert [r['id'] for r in data['leagueFixtures']['Test League']]==[2,3]
 assert 3 not in [r['id'] for r in data['fixtures']]
 assert data['leagueFixtures']['Test League'][1]['round']=='Regular Season - 12'
 assert data['standingsTables']['Test League'][0][0]['points']==15
 assert data['standings']['Test League']['Alpha']==1
 assert data['history'][0]['round']=='Regular Season - 12'
 print('PASS: full-season upcoming fixtures beyond prediction window, round metadata, full standings, rank compatibility, and completed-match history.')
