import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import shutil
spec=importlib.util.spec_from_file_location('updater',str(Path(__file__).resolve().parent/'fetch_data.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
now=dt.datetime(2026,10,3,12,tzinfo=dt.timezone.utc)
def fixture(i,date,status='FT',gh=2,ga=1,season=2026):
 return {'fixture':{'id':i,'date':date,'status':{'short':status,'elapsed':90 if status=='FT' else None}},'league':{'name':'Test League','id':39,'season':season},'teams':{'home':{'id':1,'name':'Alpha','logo':'https://example.org/a.png'},'away':{'id':2,'name':'Beta','logo':'https://example.org/b.png'}},'goals':{'home':gh,'away':ga},'score':{'halftime':{'home':1,'away':0},'fulltime':{'home':gh,'away':ga}}}
class Mock:
 def __init__(self,finished=False,fail=False):self.calls=0;self.remaining=7490;self.finished=finished;self.fail=fail
 def get(self,ep,**p):
  self.calls+=1
  if self.fail:raise RuntimeError('Simulated API outage')
  if ep=='/leagues':return [{'seasons':[{'year':2025,'start':'2025-08-01','end':'2026-05-31','current':False,'coverage':{'standings':True}},{'year':2026,'start':'2026-08-01','end':'2027-05-31','current':True,'coverage':{'standings':True}}]}]
  if ep=='/standings':return [{'league':{'standings':[[{'team':{'name':'Alpha'},'rank':1},{'team':{'name':'Beta'},'rank':2}]]}}]
  if ep=='/fixtures/headtohead':return [fixture(9,'2025-03-01T15:00:00+00:00',season=2024)]
  if ep=='/fixtures' and p['season']==2025:return [fixture(8,'2026-04-01T15:00:00+00:00',season=2025)]
  if ep=='/fixtures':return [fixture(10,'2026-10-01T15:00:00+00:00'),fixture(11,'2026-10-04T15:00:00+00:00','FT' if self.finished else 'NS',2 if self.finished else None,1 if self.finished else None),fixture(12,'2026-10-03T10:00:00+00:00','2H',1,0)]
  raise AssertionError(ep)
with tempfile.TemporaryDirectory() as td:
 p=Path(td);config=json.loads((Path(__file__).resolve().parent/'api-config.json').read_text());config['leagues']=[{'id':39,'name':'Test League','country':'England','icon':'GB'}];(p/'api-config.json').write_text(json.dumps(config))
 d=m.run(p,Mock(),now)
 assert d['seasons']['Test League']==2026
 assert len(d['history'])==1 and len(d['matches'])==2
 assert len(d['h2h']['1-2'])==1
 assert d['fixtures'][1]['live'] is True
 assert next(r for r in d['fixtures'] if r['id']==11).get('prediction')
 assert all('prediction' not in r for r in d['recentResults'])
 archive=json.loads((p/'prediction-archive.json').read_text());assert list(archive)==['11']
 second=Mock(True);d2=m.run(p,second,now+dt.timedelta(days=2));assert second.calls==5
 result=next(r for r in d2['recentResults'] if r['id']==11);assert result['prediction']==archive['11']['prediction']
 old=(p/'data.js').read_bytes()
 try:m.run(p,Mock(fail=True),now)
 except RuntimeError:pass
 else:raise AssertionError('Failure not propagated')
 assert (p/'data.js').read_bytes()==old
 a=fixture(15,'2026-10-03T20:00:00+00:00','AET',4,3);a['score']['fulltime']={'home':2,'away':2}
 r=m.normalize(a,config['leagues'][0],2026,m.ZoneInfo('Asia/Phnom_Penh'));assert r['date']=='2026-10-04 03:00' and r['fh']==2 and r['fa']==2
 print('PASS: current season, fixture window, complete histories, isolated H2H, live flags, pre-kickoff snapshots, settlement, cache, failed-update preservation, timezone and regulation-time scores.')
