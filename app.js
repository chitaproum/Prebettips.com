/* PreBetTips — Poisson football prediction engine + UI (no inline handlers) */
(function () {
  "use strict";
  var D = window.DATA;
  var MAX_GOALS = 8; // score grid size
  var dateFilter = "all"; // all | today | tomorrow | weekend | yesterday
  var mode = "1x2";       // 1x2 | ou | stats | selection
  var engine = "poisson";  // poisson | random  (prediction data source)

  /* ---------- "Your Selection" coupon ---------- */
  // User-ticked picks from the 1 x 2 / Over-Under columns, capped at SEL_MAX,
  // persisted in localStorage so the coupon survives a reload.
  var SEL_MAX = 20;
  var SEL_KEY = "sp_selection_v1";
  function loadSelection(){
    try{ var s=JSON.parse(localStorage.getItem(SEL_KEY));
      return Array.isArray(s)?s.slice(0,SEL_MAX):[]; }catch(e){ return []; }
  }
  function saveSelection(){
    try{ localStorage.setItem(SEL_KEY, JSON.stringify(selection)); }catch(e){}
  }
  var selection = loadSelection();
  function isSelected(home,away,m){
    return selection.some(function(s){
      return s.home===home && s.away===away && s.mode===m; });
  }

  /* ---------- Math ---------- */
  function factorial(n){ var f=1; for(var i=2;i<=n;i++) f*=i; return f; }
  function poisson(k, lambda){ return Math.pow(lambda,k)*Math.exp(-lambda)/factorial(k); }

  // Compute a full prediction for one fixture
  function predict(home, away){
    var h = D.teams[home], a = D.teams[away];
    if(!h||!a) return null;
    var base = D.leagueAvgGoals/2;                 // avg goals per side
    var lh = h.att * a.def * base * D.homeAdvantage;
    var la = a.att * h.def * base;

    // Probability of each goal count for home / away
    var ph=[], pa=[], i, j;
    for(i=0;i<=MAX_GOALS;i++){ ph.push(poisson(i,lh)); pa.push(poisson(i,la)); }

    var p1=0,pX=0,p2=0,pOver=0,pBtts=0,best={p:-1,h:0,a:0};
    for(i=0;i<=MAX_GOALS;i++){
      for(j=0;j<=MAX_GOALS;j++){
        var p = ph[i]*pa[j];
        if(i>j) p1+=p; else if(i===j) pX+=p; else p2+=p;
        if(i+j>=3) pOver+=p;
        if(i>=1 && j>=1) pBtts+=p;
        if(p>best.p){ best={p:p,h:i,a:j}; }
      }
    }
    var tot=p1+pX+p2;                              // normalise (grid is truncated)
    p1/=tot; pX/=tot; p2/=tot; pOver/=tot; pBtts/=tot;
    var tip = p1>=pX && p1>=p2 ? "1" : (p2>=pX ? "2" : "X");
    var overPct = Math.round(pOver*100);
    return {
      lh:lh, la:la,
      p1:Math.round(p1*100), pX:Math.round(pX*100), p2:Math.round(p2*100),
      tip:tip,
      score:best.h+":"+best.a,
      goals:(lh+la),
      over:pOver>=0.5,
      overPct:overPct, underPct:100-overPct,
      btts:Math.round(pBtts*100)
    };
  }

  /* ---------- KPI engine (the "Random" / alternative data source) ----------
     Instead of a seeded RNG, this engine builds its prediction entirely from
     the Key Performance Indicators shown in the stats tables (venue-specific
     average goals for/against, plus a form momentum from PPG and win%). It is
     a transparent, KPI-driven alternative to the pure att/def Poisson engine.

       Attack KPI   = avg goals FOR  (aGF)   -> how many a team tends to score
       Defense KPI  = avg goals AGAINST (aGA) -> how many it tends to concede
       Form KPI     = points-per-game (PPG) + win% -> recent momentum tilt

     Expected goals blend each side's attacking KPI with the opponent's
     defensive KPI, then the form KPI tilts the result; a Poisson score grid
     over those expected goals yields 1/X/2, score, Over/Under and BTTS. */
  function predictKpi(home, away){
    var hForm = computeForm(home, HOME);   // Arsenal (HOME) venue KPIs
    var aForm = computeForm(away, 'away'); // Everton (AWAY) venue KPIs
    if(!hForm || !aForm) return null;
    var hOv = overallForm(home), aOv = overallForm(away);

    // --- Attack / Defense KPIs (straight from the displayed aGF / aGA) ---
    var homeAttack = hForm.agf, homeDefense = hForm.aga;
    var awayAttack = aForm.agf, awayDefense = aForm.aga;

    // Expected goals: team's attacking KPI blended with opponent's leakiness
    var lh = (homeAttack + awayDefense) / 2;
    var la = (awayAttack + homeDefense) / 2;

    // --- Form KPI (PPG + win%) applies a small momentum tilt (+/- ~18%) ---
    var hMom = ((hOv.ppg / 3) + (hOv.wp / 100)) / 2;   // 0..1
    var aMom = ((aOv.ppg / 3) + (aOv.wp / 100)) / 2;   // 0..1
    var tilt = hMom - aMom;                            // -1..1
    lh *= (1 + 0.18 * tilt);
    la *= (1 - 0.18 * tilt);
    lh = Math.max(0.15, lh); la = Math.max(0.15, la);

    // --- Poisson score grid over the KPI-derived expected goals ---
    var ph=[], pa=[], i, j;
    for(i=0;i<=MAX_GOALS;i++){ ph.push(poisson(i,lh)); pa.push(poisson(i,la)); }
    var p1=0,pX=0,p2=0,pOver=0,pBtts=0,best={p:-1,h:0,a:0};
    for(i=0;i<=MAX_GOALS;i++){
      for(j=0;j<=MAX_GOALS;j++){
        var p = ph[i]*pa[j];
        if(i>j) p1+=p; else if(i===j) pX+=p; else p2+=p;
        if(i+j>=3) pOver+=p;
        if(i>=1 && j>=1) pBtts+=p;
        if(p>best.p){ best={p:p,h:i,a:j}; }
      }
    }
    var tot=p1+pX+p2;
    p1/=tot; pX/=tot; p2/=tot; pOver/=tot; pBtts/=tot;
    var tip = p1>=pX && p1>=p2 ? "1" : (p2>=pX ? "2" : "X");
    var overPct = Math.round(pOver*100);
    return {
      lh:lh, la:la,
      p1:Math.round(p1*100), pX:Math.round(pX*100), p2:Math.round(p2*100),
      tip:tip,
      score:best.h+":"+best.a,
      goals:(lh+la),
      over:pOver>=0.5,
      overPct:overPct, underPct:100-overPct,
      btts:Math.round(pBtts*100)
    };
  }
  // Prediction using whichever engine is currently selected
  function activePredict(home, away){
    return engine==="random" ? predictKpi(home,away) : predict(home,away);
  }

  /* ---------- Helpers ---------- */
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  // 3-letter uppercase team abbreviations for compact match-history rows
  var ABBR = {
    "Man City":"MCI","Arsenal":"ARS","Liverpool":"LIV","Tottenham":"TOT",
    "Chelsea":"CHE","Man United":"MUN","Brighton":"BHA","Everton":"EVE",
    "Burnley":"BUR","Sheffield Utd":"SHU","Real Madrid":"RMA","Barcelona":"BAR",
    "Atletico":"ATM","Girona":"GIR","Sevilla":"SEV","Getafe":"GET",
    "Cadiz":"CAD","Almeria":"ALM","Inter":"INT","Juventus":"JUV",
    "Milan":"MIL","Napoli":"NAP","Roma":"ROM","Lazio":"LAZ",
    "Salernitana":"SAL","Empoli":"EMP"
  };
  function abbr(name){
    if(ABBR[name]) return ABBR[name];
    var w=(name||"").replace(/[^A-Za-z ]/g,"").split(/\s+/).filter(Boolean);
    var s = w.length>1 ? w.map(function(x){return x.charAt(0);}).join("") : (w[0]||name);
    return s.substring(0,3).toUpperCase();
  }
  function fmtDate(s){
    var d=new Date(s.replace(" ","T"));
    if(isNaN(d)) return esc(s);
    var day=d.toLocaleDateString(undefined,{day:"2-digit",month:"short"});
    var t=d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",hour12:false});
    return {day:day,time:t};
  }

  /* ---------- Date bucketing ---------- */
  function dayOf(f){ return f.date.slice(0,10); }
  // Anchor "today" to the earliest fixture date so the demo always has data.
  var allDays = D.fixtures.map(dayOf).sort();
  var baseToday = allDays[0];
  function addDays(iso, n){ var d=new Date(iso+"T00:00"); d.setDate(d.getDate()+n);
    return d.toISOString().slice(0,10); }
  var baseTomorrow = addDays(baseToday,1);
  var baseYesterday = addDays(baseToday,-1);
  function isWeekend(iso){ var g=new Date(iso+"T00:00").getDay(); return g===0||g===6; }
  function inBucket(f, bucket){
    var d=dayOf(f);
    if(bucket==="all") return true;
    if(bucket==="today") return d===baseToday;
    if(bucket==="tomorrow") return d===baseTomorrow;
    if(bucket==="yesterday") return d===baseYesterday;
    if(bucket==="weekend") return isWeekend(d);
    return true;
  }

  /* ---------- Render predictions ---------- */
  var rows = [];
  function buildRows(){
    rows = D.fixtures.map(function(f){
      return {f:f, p:activePredict(f.home, f.away)};
    }).filter(function(r){ return r.p; });
  }
  buildRows();

  /* ---------- Team form (season W/D/L, goals, PPG) ----------
     Derived from each team att/def ratings so it stays consistent and
     editable. To use REAL figures instead, add a `form` object on a team in
     data.js, e.g. teams['Man City'].form = {home:{p,w,d,l,gf,ga}, away:{...}}
     and it will be used verbatim. */
  function computeForm(name, venue){
    var r = rawForm(name, venue);
    return r ? finalizeForm(r) : null;
  }
  // Raw season figures {p,w,d,l,gf,ga} for a venue (home|away)
  function rawForm(name, venue){
    var t = D.teams[name]; if(!t) return null;
    if(t.form && t.form[venue]){ return t.form[venue]; }
    var base = D.leagueAvgGoals/2;
    var gfPer, gaPer, P;
    if(venue===HOME){
      gfPer = t.att * base * D.homeAdvantage; // scored vs an average side, at home
      gaPer = t.def * base;
      P = 11;
    } else {
      gfPer = t.att * base * 0.92;            // slight away penalty
      gaPer = t.def * base * 1.06;
      P = 12;
    }
    var i,j,pw=0,pd=0,pl=0;
    for(i=0;i<=MAX_GOALS;i++) for(j=0;j<=MAX_GOALS;j++){
      var pr = poisson(i,gfPer)*poisson(j,gaPer);
      if(i>j) pw+=pr; else if(i===j) pd+=pr; else pl+=pr;
    }
    var w=Math.round(pw*P), d=Math.round(pd*P);
    if(w+d>P) d=P-w; var l=P-w-d; if(l<0){ l=0; }
    var gf=Math.round(gfPer*P), ga=Math.round(gaPer*P);
    return {p:P,w:w,d:d,l:l,gf:gf,ga:ga};
  }
  // Combined home+away (overall) season form
  function overallForm(name){
    var h=rawForm(name,'home'), a=rawForm(name,'away');
    if(!h||!a) return null;
    return finalizeForm({p:h.p+a.p,w:h.w+a.w,d:h.d+a.d,l:h.l+a.l,gf:h.gf+a.gf,ga:h.ga+a.ga});
  }
  function finalizeForm(r){
    var P=r.p||1, pts=3*r.w+r.d;
    // Over 2.5 goals rate from average total goals per game (Poisson)
    var lam=(r.gf+r.ga)/P;
    var pUnder=Math.exp(-lam)*(1+lam+lam*lam/2); // P(0)+P(1)+P(2)
    var pOver=1-pUnder;
    var l8=Math.round(pOver*8);                  // over-2.5 games out of last 8
    return {
      p:r.p, w:r.w, d:r.d, l:r.l, gf:r.gf, ga:r.ga,
      wp:Math.round(r.w/P*100), dp:Math.round(r.d/P*100), lp:Math.round(r.l/P*100),
      agf:(r.gf/P), aga:(r.ga/P), agfga:((r.gf+r.ga)/P), ppg:(pts/P),
      ovgTotal:Math.round(pOver*100), ovgLast8:Math.round(l8/8*100)
    };
  }

  var HOME = 'home';

  /* League standings: rank each league's teams by points (home+away form),
     then goal difference. Cached per league. */
  var _standings = {};
  function leaguePosition(name){
    var t=D.teams[name]; if(!t) return null;
    var lg=t.league;
    if(!_standings[lg]){
      var arr=[];
      Object.keys(D.teams).forEach(function(tn){
        if(D.teams[tn].league!==lg) return;
        var fh=computeForm(tn,'home'), fa=computeForm(tn,'away');
        arr.push({name:tn,
          pts:(3*fh.w+fh.d)+(3*fa.w+fa.d),
          gd:(fh.gf+fa.gf)-(fh.ga+fa.ga)});
      });
      arr.sort(function(a,b){ return b.pts-a.pts || b.gd-a.gd; });
      _standings[lg]={};
      arr.forEach(function(x,i){ _standings[lg][x.name]=i+1; });
    }
    return _standings[lg][name];
  }

  /* ---------- Recent results (deterministic, derived from ratings) ----------
     Real match history isn't available in this static demo, so recent results
     are simulated deterministically from each team's att/def ratings using a
     seeded RNG. Same fixture => same results every render. To show REAL data,
     replace generateResults() with figures from your API. */
  function strHash(s){ var h=2166136261>>>0; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function samplePoisson(lambda, rnd){ var L=Math.exp(-lambda),k=0,p=1; do{ k++; p*=rnd(); }while(p>L); return k-1; }
  function leagueTag(lg){
    var m={"Premier League":"PL","La Liga":"LL","Serie A":"SA"};
    if(m[lg]) return m[lg];
    return (lg||"").split(/\s+/).map(function(w){return w.charAt(0);}).join("").toUpperCase().slice(0,3);
  }
  function fmtDMY(d){
    var dd=String(d.getDate()).padStart(2,"0"), mm=String(d.getMonth()+1).padStart(2,"0");
    return dd+"/"+mm+"/"+d.getFullYear();
  }
  function leagueTeams(lg){ return Object.keys(D.teams).filter(function(n){ return D.teams[n].league===lg; }); }
  // Simulate one match; returns {ft:[h,a], ht:[h,a]}
  function simMatch(homeName, awayName, rnd){
    var h=D.teams[homeName], a=D.teams[awayName];
    var base=D.leagueAvgGoals/2;
    var lh=(h?h.att:1)*(a?a.def:1)*base*D.homeAdvantage;
    var la=(a?a.att:1)*(h?h.def:1)*base;
    var hg=Math.min(samplePoisson(lh,rnd),6), ag=Math.min(samplePoisson(la,rnd),6);
    var hh=0,ah=0,i;
    for(i=0;i<hg;i++) if(rnd()<0.45) hh++;
    for(i=0;i<ag;i++) if(rnd()<0.45) ah++;
    return {ft:[hg,ag],ht:[hh,ah]};
  }
  // Build a list of matches for `team`; venue: 'any'|'home'|'away'
  function teamResults(team, count, venue, seedKey){
    var t=D.teams[team]; if(!t) return [];
    var pool=leagueTeams(t.league).filter(function(n){ return n!==team; });
    var rnd=mulberry32(strHash(team+"|"+venue+"|"+seedKey));
    var day=new Date(2026,8,27); // base date (month is 0-indexed => Sep)
    var out=[],i;
    for(i=0;i<count;i++){
      day=new Date(day.getTime()-(3+Math.floor(rnd()*8))*86400000);
      var opp=pool[Math.floor(rnd()*pool.length)]||team;
      var atHome = venue==='home' ? true : venue==='away' ? false : rnd()<0.5;
      var hn=atHome?team:opp, an=atHome?opp:team;
      var m=simMatch(hn,an,rnd);
      var mine=atHome?m.ft[0]:m.ft[1], theirs=atHome?m.ft[1]:m.ft[0];
      var res=mine>theirs?'W':mine<theirs?'L':'D';
      out.push({date:new Date(day),home:hn,away:an,ft:m.ft,ht:m.ht,
                league:t.league,res:res});
    }
    return out;
  }
  // Head-to-head between two teams
  function h2hResults(home, away, count){
    var rnd=mulberry32(strHash("H2H|"+home+"|"+away));
    var day=new Date(2026,8,20), out=[], i;
    var lg=(D.teams[home]||{}).league||(D.teams[away]||{}).league;
    for(i=0;i<count;i++){
      day=new Date(day.getTime()-(120+Math.floor(rnd()*260))*86400000);
      var homeIsFirst = i%2===0;
      var hn=homeIsFirst?home:away, an=homeIsFirst?away:home;
      var m=simMatch(hn,an,rnd);
      out.push({date:new Date(day),home:hn,away:an,ft:m.ft,ht:m.ht,league:lg});
    }
    return out;
  }

  function pct(n,tot){ return tot?Math.round(n/tot*100):0; }
  function resultRowHtml(m, showLg){
    var hWin=m.ft[0]>m.ft[1], aWin=m.ft[1]>m.ft[0];
    var lg=showLg?"<span class='rs-lg'>"+esc(leagueTag(m.league))+"</span>":"";
    return "<div class='rs-row'>"+
      "<span class='rs-date'>"+fmtDMY(m.date)+"</span>"+
      "<span class='rs-teams'>"+
        "<span class='rs-tn"+(hWin?" win":"")+"' title='"+esc(m.home)+"'>"+esc(abbr(m.home))+"</span>"+
        "<span class='rs-sc'>"+m.ft[0]+"-"+m.ft[1]+" <em>("+m.ht[0]+"-"+m.ht[1]+")</em></span>"+
        "<span class='rs-tn"+(aWin?" win":"")+"' title='"+esc(m.away)+"'>"+esc(abbr(m.away))+"</span>"+
      "</span>"+lg+"</div>";
  }
  function resultModuleHtml(title, tag, rows, footer, showLg){
    var body=rows.map(function(m){ return resultRowHtml(m,showLg); }).join("");
    var tagHtml = tag ? "<span class='rs-tag'>"+esc(tag)+"</span>" : "";
    return "<div class='rs-module'>"+
      "<div class='rs-head'>"+tagHtml+"<span class='rs-title'>"+esc(title)+"</span><span class='rs-all'>All</span></div>"+
      "<div class='rs-rows'>"+body+"</div>"+
      "<div class='rs-foot'>"+footer+"</div></div>";
  }
  function wdlFooter(rows, team){
    var w=0,d=0,l=0;
    rows.forEach(function(m){
      var atHome=m.home===team, mine=atHome?m.ft[0]:m.ft[1], th=atHome?m.ft[1]:m.ft[0];
      if(mine>th) w++; else if(mine<th) l++; else d++;
    });
    var t=rows.length;
    return "<span class='rs-w'>Win "+w+" ("+pct(w,t)+"%)</span>"+
           "<span class='rs-d'>Draw "+d+" ("+pct(d,t)+"%)</span>"+
           "<span class='rs-l'>Lost "+l+" ("+pct(l,t)+"%)</span>";
  }
  function h2hFooter(rows, home, away){
    var hw=0,dr=0,aw=0;
    rows.forEach(function(m){
      var homeGoals=m.home===home?m.ft[0]:m.ft[1];
      var awayGoals=m.home===home?m.ft[1]:m.ft[0];
      if(homeGoals>awayGoals) hw++; else if(homeGoals<awayGoals) aw++; else dr++;
    });
    var t=rows.length;
    return "<span class='rs-w'>"+esc(abbr(home))+" "+hw+" ("+pct(hw,t)+"%)</span>"+
           "<span class='rs-d'>Draw "+dr+" ("+pct(dr,t)+"%)</span>"+
           "<span class='rs-l'>"+esc(abbr(away))+" "+aw+" ("+pct(aw,t)+"%)</span>";
  }
  function resultsPanelHtml(f){
    var home=f.home, away=f.away;
    var hTag=abbr(home);
    var aTag=abbr(away);
    var h2h=h2hResults(home,away,4);
    var hLast=teamResults(home,6,'any','L6'),  aLast=teamResults(away,6,'any','L6');
    var hHome=teamResults(home,4,'home','HM'), aAway=teamResults(away,4,'away','AW');
    return "<div class='results-info'>"+
      resultModuleHtml("HEAD TO HEAD","",h2h,h2hFooter(h2h,home,away),true)+
      resultModuleHtml("LAST 6 MATCHES",hTag,hLast,wdlFooter(hLast,home),false)+
      resultModuleHtml("LAST 6 MATCHES",aTag,aLast,wdlFooter(aLast,away),false)+
      resultModuleHtml("HOME MATCHES",hTag,hHome,wdlFooter(hHome,home),true)+
      resultModuleHtml("AWAY MATCHES",aTag,aAway,wdlFooter(aAway,away),true)+
    "</div>";
  }

  var FORM_COLS = ['P','W','D','L','GF','GA','W%','D%','L%','aGF','aGA','aG+A','PPG'];
  function formRowHtml(label, venueLbl, f){
    if(!f) return '';
    var pos = leaguePosition(label);
    var posBadge = pos ? "<span class='ft-pos' title='League position'>"+pos+'</span>' : '';
    var venue = venueLbl ? " <span class='ft-venue'>"+venueLbl+'</span>' : '';
    return '<tr>'+
      "<td class='ft-team'>"+posBadge+esc(label)+venue+'</td>'+
      "<td><span class='p-badge'>"+f.p+'</span></td>'+
      '<td>'+f.w+'</td><td>'+f.d+'</td><td>'+f.l+'</td>'+
      '<td>'+f.gf+'</td><td>'+f.ga+'</td>'+
      '<td>'+f.wp+'</td><td>'+f.dp+'</td><td>'+f.lp+'</td>'+
      "<td class='agf'>"+f.agf.toFixed(2)+'</td>'+
      "<td class='aga'>"+f.aga.toFixed(2)+'</td>'+
      "<td class='agfga'>"+f.agfga.toFixed(2)+'</td>'+
      "<td class='ppg'>"+f.ppg.toFixed(2)+'</td>'+
      "<td class='ovg'>"+f.ovgTotal+'%</td>'+
      "<td class='ovg'>"+f.ovgLast8+'%</td>'+
    '</tr>';
  }
  // One statistics table (colgroup + 2-row header + given team rows)
  function formTableHtml(title, bodyRows){
    var cg="<colgroup><col class='cg-team'>";
    FORM_COLS.forEach(function(){ cg+="<col class='cg-num'>"; });
    cg+="<col class='cg-ovg'><col class='cg-ovg'></colgroup>";
    var head="<tr><th class='ft-team' rowspan='2'>Team</th>";
    FORM_COLS.forEach(function(c){ head+="<th rowspan='2'>"+c+'</th>'; });
    head+="<th class='ovg-group' colspan='2'>Over 2.5</th></tr>";
    head+="<tr><th class='ovg'>Total</th><th class='ovg'>Last 8</th></tr>";
    return "<div class='form-title'>"+esc(title)+"</div>"+
      "<table class='form-table'>"+cg+"<thead>"+head+'</thead><tbody>'+bodyRows+'</tbody></table>';
  }
  function detailRowHtml(f, colspan){
    var oh=overallForm(f.home), oa=overallForm(f.away);       // combined home+away
    var fh=computeForm(f.home,'home'), fa=computeForm(f.away,'away'); // venue-specific
    var overallTbl=formTableHtml("Overall Statistic",
      formRowHtml(f.home,'',oh)+formRowHtml(f.away,'',oa));
    var venueTbl=formTableHtml("Home / Away Statistic",
      formRowHtml(f.home,'HOME',fh)+formRowHtml(f.away,'AWAY',fa));
    return "<tr class='detail-row'><td colspan='"+colspan+"'>"+
      "<div class='form-panel'>"+overallTbl+venueTbl+"</div>"+
      resultsPanelHtml(f)+'</td></tr>';
  }

  function bar(v){ return '<span class="bar" style="width:'+v+'%"></span>'; }

  // In-feed native sponsored row (spans all table columns)
  function adRowHtml(cols){
    return "<tr class='ad-row'><td colspan='"+(cols||8)+"'>"+
      "<div class='ad-native'>"+
        "<span class='ad-badge'>Ad</span>"+
        "<span class='ad-thumb'>\u26bd</span>"+
        "<span class='ad-text'>"+
          "<span class='ad-title'>Bet $10, Get $30 in Free Bets</span>"+
          "<span class='ad-desc'>New customers only \u00b7 18+ \u00b7 T&amp;Cs apply \u00b7 Sponsored placeholder</span>"+
        "</span>"+
        "<a class='ad-cta' href='#' rel='nofollow sponsored noopener'>Claim</a>"+
      "</div></td></tr>";
  }

  var COMMON_HEAD = "<th>Date</th><th class='col-league'>League</th><th class='col-match'>Match</th>";
  var HEADS = {
    "1x2":  COMMON_HEAD+"<th title='Home win'>1</th><th title='Draw'>X</th><th title='Away win'>2</th><th>Tip</th><th title='Most likely score'>Score</th>",
    "ou":   COMMON_HEAD+"<th title='Chance of 3+ goals'>Over %</th><th title='Chance of 0-2 goals'>Under %</th><th title='Predicted total goals'>Exp. goals</th><th>Tip</th><th title='Both teams to score'>BTTS</th>",
    "stats":COMMON_HEAD+"<th title='Expected goals, home'>xG H</th><th title='Expected goals, away'>xG A</th><th title='Predicted total goals'>Exp. goals</th><th title='Most likely score'>Score</th><th title='Both teams to score'>BTTS</th>"
  };

  function renderPredictions(){
    if(mode==="selection"){ renderSelection(); return; }
    var league = document.getElementById("leagueFilter").value;
    var tip = document.getElementById("tipFilter").value;
    var minP = parseInt(document.getElementById("probFilter").value,10);
    var q = (document.getElementById("searchBox").value||"").toLowerCase();
    var body = document.getElementById("predBody");
    var pickable = (mode==="1x2" || mode==="ou");
    var headHtml = HEADS[mode];
    if(pickable){ headHtml += "<th class='col-pick' title='Add to Your Selection'>Pick</th>"; }
    document.getElementById("predHead").innerHTML = "<tr>"+headHtml+"</tr>";
    var html = "";
    var shown = 0;

    rows.forEach(function(r){
      var f=r.f, p=r.p;
      if(league!=="all" && f.league!==league) return;
      if(!inBucket(f, dateFilter)) return;
      if(q && (f.home+" "+f.away).toLowerCase().indexOf(q)<0) return;
      var best = p.tip; // 1/X/2
      var maxProb = Math.max(p.p1,p.pX,p.p2);
      if(minP && maxProb<minP) return;
      if(tip==="1"&&best!=="1") return;
      if(tip==="X"&&best!=="X") return;
      if(tip==="2"&&best!=="2") return;
      if(tip==="over"&&!p.over) return;
      if(tip==="under"&&p.over) return;

      var dt = fmtDate(f.date);
      shown++;
      var caret = (mode==="stats") ? "<span class='exp-caret'>\u203a</span> " : "";
      var lead =
        "<td>"+dt.day+"<br><span class='time'>"+dt.time+"</span></td>"+
        "<td class='col-league'><span class='league-cell'>"+esc(f.league)+"</span></td>"+
        "<td class='col-match'><div class='match-cell'><span class='teams'>"+caret+esc(f.home)+" v "+esc(f.away)+"</span></div></td>";
      var cells;
      if(mode==="1x2"){
        cells =
          "<td class='prob "+(best==="1"?"best-1":"")+"'>"+p.p1+"%"+bar(p.p1)+"</td>"+
          "<td class='prob "+(best==="X"?"best-X":"")+"'>"+p.pX+"%"+bar(p.pX)+"</td>"+
          "<td class='prob "+(best==="2"?"best-2":"")+"'>"+p.p2+"%"+bar(p.p2)+"</td>"+
          "<td><span class='tip t"+best+"'>"+best+"</span></td>"+
          "<td class='score'>"+p.score+"</td>";
      } else if(mode==="ou"){
        cells =
          "<td class='prob "+(p.over?"best-1":"")+"'>"+p.overPct+"%"+bar(p.overPct)+"</td>"+
          "<td class='prob "+(!p.over?"best-X":"")+"'>"+p.underPct+"%"+bar(p.underPct)+"</td>"+
          "<td class='score'>"+p.goals.toFixed(2)+"</td>"+
          "<td><span class='ou "+(p.over?"over":"under")+"'>"+(p.over?"Over 2.5":"Under 2.5")+"</span></td>"+
          "<td>"+p.btts+"%</td>";
      } else { // stats
        cells =
          "<td class='score'>"+p.lh.toFixed(2)+"</td>"+
          "<td class='score'>"+p.la.toFixed(2)+"</td>"+
          "<td class='score'>"+p.goals.toFixed(2)+"</td>"+
          "<td class='score'>"+p.score+"</td>"+
          "<td>"+p.btts+"%</td>";
      }
      if(mode==="stats"){
        html += "<tr class='stats-row' data-home=\""+esc(f.home)+"\" data-away=\""+esc(f.away)+"\">"+lead+cells+"</tr>";
      } else {
        if(pickable){
          var pickTip = (mode==="1x2") ? best : (p.over?"Over 2.5":"Under 2.5");
          var checked = isSelected(f.home,f.away,mode) ? " checked" : "";
          cells += "<td class='col-pick'><input type='checkbox' class='pick-cb'"+checked+
            " data-home=\""+esc(f.home)+"\" data-away=\""+esc(f.away)+"\""+
            " data-mode=\""+mode+"\" data-tip=\""+esc(pickTip)+"\""+
            " data-league=\""+esc(f.league)+"\" data-date=\""+esc(f.date)+"\""+
            " aria-label='Add to Your Selection'></td>";
        }
        html += "<tr>"+lead+cells+"</tr>";
      }
      // Ad: in-feed native sponsored row after the 3rd match
      if(shown===3){ html += adRowHtml(pickable?9:8); }
    });

    body.innerHTML = html;
    document.getElementById("emptyMsg").hidden = shown>0;

    if(mode==="stats"){
      body.querySelectorAll("tr.stats-row").forEach(function(tr){
        tr.addEventListener("click", function(){ toggleDetail(tr); });
      });
    }
    if(pickable){
      body.querySelectorAll("input.pick-cb").forEach(function(cb){
        cb.addEventListener("change", function(){ onPickToggle(cb); });
      });
    }
  }

  /* Add/remove a pick when its checkbox is toggled; enforce the 20-item cap. */
  function onPickToggle(cb){
    var home=cb.getAttribute("data-home"), away=cb.getAttribute("data-away"),
        m=cb.getAttribute("data-mode");
    if(cb.checked){
      if(selection.length>=SEL_MAX){
        cb.checked=false;
        window.alert("You can add up to "+SEL_MAX+" predictions to Your Selection.");
        return;
      }
      selection.push({home:home, away:away, mode:m,
        tip:cb.getAttribute("data-tip"),
        league:cb.getAttribute("data-league"),
        date:cb.getAttribute("data-date")});
    } else {
      selection = selection.filter(function(s){
        return !(s.home===home && s.away===away && s.mode===m); });
    }
    saveSelection();
    updateSelBadges();
  }

  /* Keep the top button + sidebar counters in sync with the coupon size. */
  function updateSelBadges(){
    var n=selection.length;
    var top=document.getElementById("selCount");
    if(top){ top.textContent=n; top.hidden = (n===0); }
    var side=document.getElementById("sideSelCount");
    if(side){ side.textContent=n; }
  }

  function setMode(m){
    mode=m;
    document.querySelectorAll(".mode-btn").forEach(function(x){
      x.classList.toggle("active", x.getAttribute("data-mode")===m);
    });
  }

  /* ---------- "Your Selection" view ---------- */
  function selTipHtml(s){
    if(s.mode==="ou"){
      var over=(s.tip||"").toLowerCase().indexOf("over")>=0;
      return "<span class='ou "+(over?"over":"under")+"'>"+esc(s.tip)+"</span>";
    }
    return "<span class='tip t"+esc(s.tip)+"'>"+esc(s.tip)+"</span>";
  }
  // Probability cell: 1 x 2 shows three values, Over/Under shows two.
  function selProbHtml(s){
    var p=activePredict(s.home,s.away);
    if(!p) return "<span class='muted'>\u2013</span>";
    if(s.mode==="ou"){
      return "<span class='pp "+(p.over?"hi":"")+"'>"+p.overPct+"%</span>"+
             "<span class='pp "+(!p.over?"hi":"")+"'>"+p.underPct+"%</span>";
    }
    var best=p.tip;
    return "<span class='pp "+(best==='1'?'hi':'')+"'>"+p.p1+"%</span>"+
           "<span class='pp "+(best==='X'?'hi':'')+"'>"+p.pX+"%</span>"+
           "<span class='pp "+(best==='2'?'hi':'')+"'>"+p.p2+"%</span>";
  }
  function selDateStr(s){
    var d=fmtDate(s.date);
    return d && d.day ? d.day+" "+d.time : esc(String(s.date));
  }
  // Open a clean print window so the browser can "Save as PDF".
  function downloadSelectionPdf(){
    if(!selection.length){ window.alert("Your Selection is empty."); return; }
    var w=window.open("","_blank");
    if(!w){ window.alert("Please allow pop-ups to download the PDF."); return; }
    var body="";
    selection.forEach(function(s){
      var p=activePredict(s.home,s.away);
      var prob = p ? (s.mode==="ou"
        ? (p.overPct+"% / "+p.underPct+"%")
        : (p.p1+"% / "+p.pX+"% / "+p.p2+"%")) : "\u2013";
      var market = s.mode==="ou" ? "Over/Under 2.5" : "1 x 2";
      body+="<tr><td>"+esc(selDateStr(s))+"</td><td>"+esc(s.home)+" v "+esc(s.away)+"</td>"+
        "<td>"+esc(s.league)+"</td><td>"+esc(prob)+"</td><td>"+esc(market)+"</td>"+
        "<td>"+esc(s.tip)+"</td></tr>";
    });
    var stamp=new Date().toLocaleString();
    var doc="<!DOCTYPE html><html><head><meta charset='utf-8'>"+
      "<title>PreBetTips \u2014 Your Selection</title><style>"+
      "body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:28px}"+
      "h1{font-size:20px;margin:0 0 2px}p.sub{color:#666;font-size:12px;margin:0 0 16px}"+
      "table{border-collapse:collapse;width:100%;font-size:12px}"+
      "th,td{border:1px solid #ccc;padding:7px 9px;text-align:left}"+
      "th{background:#0b1b34;color:#fff}tbody tr:nth-child(even){background:#f4f6f9}"+
      "footer{margin-top:16px;color:#888;font-size:11px}"+
      "</style></head><body>"+
      "<h1>PreBetTips \u2014 Your Selection</h1>"+
      "<p class='sub'>"+selection.length+" prediction(s) \u00b7 generated "+esc(stamp)+"</p>"+
      "<table><thead><tr><th>Date</th><th>Match</th><th>League</th>"+
      "<th>Probability (%)</th><th>Market</th><th>Pick</th></tr></thead>"+
      "<tbody>"+body+"</tbody></table>"+
      "<footer>Demo project \u00b7 18+ \u00b7 Please gamble responsibly.</footer>"+
      "</body></html>";
    w.document.open(); w.document.write(doc); w.document.close(); w.focus();
    setTimeout(function(){ try{ w.print(); }catch(e){} }, 400);
  }
  function renderSelection(){
    document.getElementById("predHead").innerHTML =
      "<tr><th>Date</th><th class='col-match'>Match</th><th class='col-league'>League</th>"+
      "<th class='col-prob'>Probability (%)</th><th>Market</th><th>Pick</th>"+
      "<th class='col-pick'>Remove</th></tr>";
    var body=document.getElementById("predBody");
    var em=document.getElementById("emptyMsg");
    if(!selection.length){
      body.innerHTML="";
      em.hidden=false;
      em.textContent="Your Selection is empty. Tick the checkbox on any 1 x 2 or "+
        "Over/Under 2.5 prediction to add it here (up to "+SEL_MAX+").";
      return;
    }
    em.hidden=true;
    var html="<tr class='sel-tools'><td colspan='7'>"+
      "<span class='sel-info'>"+selection.length+" / "+SEL_MAX+" selected</span>"+
      "<button type='button' class='sel-pdf' id='selPdf'>Download PDF</button>"+
      "<button type='button' class='sel-clear' id='selClear'>Clear all</button></td></tr>";
    selection.forEach(function(s,i){
      var market = s.mode==="ou" ? "Over/Under 2.5" : "1 x 2";
      html+="<tr>"+
        "<td>"+selDateStr(s)+"</td>"+
        "<td class='col-match'><div class='match-cell'><span class='teams'>"+esc(s.home)+" v "+esc(s.away)+"</span></div></td>"+
        "<td class='col-league'><span class='league-cell'>"+esc(s.league)+"</span></td>"+
        "<td class='col-prob'>"+selProbHtml(s)+"</td>"+
        "<td>"+esc(market)+"</td>"+
        "<td>"+selTipHtml(s)+"</td>"+
        "<td class='col-pick'><button type='button' class='sel-remove' data-idx='"+i+"' aria-label='Remove'>\u00d7</button></td>"+
      "</tr>";
    });
    body.innerHTML=html;
    body.querySelectorAll(".sel-remove").forEach(function(b){
      b.addEventListener("click", function(){
        selection.splice(parseInt(b.getAttribute("data-idx"),10),1);
        saveSelection(); updateSelBadges(); renderSelection();
      });
    });
    var clr=document.getElementById("selClear");
    if(clr){ clr.addEventListener("click", function(){
      selection=[]; saveSelection(); updateSelBadges(); renderSelection();
    }); }
    var pdf=document.getElementById("selPdf");
    if(pdf){ pdf.addEventListener("click", downloadSelectionPdf); }
  }

  function toggleDetail(tr){
    var next = tr.nextElementSibling;
    if(next && next.classList.contains("detail-row")){
      next.parentNode.removeChild(next);
      tr.classList.remove("open");
      return;
    }
    // close any other open detail first
    var opened = tr.parentNode.querySelector("tr.detail-row");
    if(opened){
      var prev=opened.previousElementSibling;
      if(prev) prev.classList.remove("open");
      opened.parentNode.removeChild(opened);
    }
    var f = {home:tr.getAttribute("data-home"), away:tr.getAttribute("data-away")};
    var colspan = tr.children.length;
    tr.insertAdjacentHTML("afterend", detailRowHtml(f, colspan));
    tr.classList.add("open");
  }

  /* ---------- Render results / accuracy ---------- */
  function renderResults(){
    var body=document.getElementById("resultsBody");
    var html="", n=0, hit1x2=0, hitScore=0, hitOu=0;
    D.history.forEach(function(g){
      var p=activePredict(g.home,g.away); if(!p) return;
      n++;
      var actual = g.fh>g.fa?"1":(g.fh===g.fa?"X":"2");
      var win = p.tip===actual;
      if(win) hit1x2++;
      if(p.score===(g.fh+":"+g.fa)) hitScore++;
      var actualOver=(g.fh+g.fa)>=3;
      if(actualOver===p.over) hitOu++;
      html+="<tr>"+
        "<td>"+esc(g.date)+"</td>"+
        "<td class='col-league'><span class='league-cell'>"+esc(g.league)+"</span></td>"+
        "<td class='col-match'>"+esc(g.home)+" v "+esc(g.away)+"</td>"+
        "<td><span class='tip t"+p.tip+"'>"+p.tip+"</span></td>"+
        "<td class='score'>"+p.score+"</td>"+
        "<td class='score'>"+g.fh+":"+g.fa+"</td>"+
        "<td><span class='verdict "+(win?"win":"miss")+"'>"+(win?"HIT":"MISS")+"</span></td>"+
      "</tr>";
    });
    body.innerHTML=html;
    document.getElementById("accOverall").textContent = n?Math.round(hit1x2/n*100)+"%":"–";
    document.getElementById("accScore").textContent   = n?Math.round(hitScore/n*100)+"%":"–";
    document.getElementById("accOu").textContent      = n?Math.round(hitOu/n*100)+"%":"–";
    document.getElementById("settled").textContent    = n;
  }

  /* ---------- Sidebar ---------- */
  function fixtureCountForLeague(name){
    var n=0; D.fixtures.forEach(function(f){ if(f.league===name) n++; }); return n;
  }
  function bucketCount(bucket){
    var n=0; D.fixtures.forEach(function(f){ if(inBucket(f,bucket)) n++; }); return n;
  }

  function buildSidebar(){
    var el=document.getElementById("sidebar");
    var html="";

    /* FOOTBALL group */
    var football=[
      {key:"today",    lbl:"Predictions for TODAY",       cnt:bucketCount("today")},
      {key:"live",     lbl:"LIVE predictions",            cnt:null},
      {key:"tomorrow", lbl:"Predictions for TOMORROW",    cnt:bucketCount("tomorrow")},
      {key:"weekend",  lbl:"Predictions for the WEEKEND", cnt:bucketCount("weekend")},
      {key:"yesterday",lbl:"Predictions from YESTERDAY",  cnt:bucketCount("yesterday")},
      {key:"all",      lbl:"ALL predictions",             cnt:D.fixtures.length},
      {key:"top",      lbl:"TOP predictions",             cnt:null},
      {key:"selection",lbl:"Your Selection",               cnt:selection.length},
      {key:"fav",      lbl:"Favourites",                  cnt:null},
      {key:"lists",    lbl:"Lists",                       cnt:null}
    ];
    html+='<div class="side-group"><div class="side-title">Football</div>';
    football.forEach(function(it){
      var cntId = it.key==="selection" ? " id=\"sideSelCount\"" : "";
      var cnt = it.cnt!=null ? '<span class="cnt"'+cntId+'>'+it.cnt+'</span>' : '';
      html+='<button class="side-item" data-kind="date" data-val="'+it.key+'">'+
        '<span class="ico">\u26bd</span><span class="lbl">'+esc(it.lbl)+'</span>'+cnt+'</button>';
    });
    html+='</div>';

    /* Ad: in-sidebar banner between FOOTBALL and POPULAR LEAGUES */
    html+='<div class="ad-slot ad-sidebar-mid" aria-label="Advertisement">'+
      '<span class="ad-body">Adv. banner<span class="ad-size">300\u00d7100</span></span></div>';

    /* POPULAR LEAGUES */
    html+='<div class="side-group"><div class="side-title">Popular Leagues</div>';
    (D.popularLeagues||[]).forEach(function(lg){
      var c=fixtureCountForLeague(lg.name);
      var hasData = c>0;
      var cnt = hasData ? '<span class="cnt">'+c+'</span>' : '<span class="caret">\u203a</span>';
      html+='<button class="side-item" data-kind="league" data-val="'+esc(lg.name)+'" '+
        (hasData?'':'title="No sample fixtures"')+'>'+
        '<span class="ico">'+lg.icon+'</span><span class="lbl">'+esc(lg.name)+'</span>'+cnt+'</button>';
    });
    html+='</div>';

    /* COUNTRIES */
    html+='<div class="side-group"><div class="side-title">Countries</div>'+
      '<div class="side-search"><span class="ico">\ud83d\udd0d</span>'+
      '<input type="search" id="countrySearch" placeholder="Search" aria-label="Search country"></div>'+
      '<div class="country-list" id="countryList"></div></div>';

    /* Ad: sidebar MPU (300x250) */
    html+='<div class="ad-slot ad-mpu" aria-label="Advertisement">'+
      '<span class="ad-body">Your ad here<span class="ad-size">Medium Rectangle 300×250</span></span></div>';

    /* Visitors dashboard widget */
    html+='<div class="visitors" aria-label="Visitors">'+
      '<div class="vc-head"><span class="vc-icon">\ud83d\udcc8</span>Visitors</div>'+
      '<ul class="vc-list">'+
        '<li class="online"><span class="vc-k">Online</span><span class="vc-v">111</span></li>'+
        '<li><span class="vc-k">Today</span><span class="vc-v">1,200</span></li>'+
        '<li><span class="vc-k">Yesterday</span><span class="vc-v">2,200</span></li>'+
        '<li><span class="vc-k">All time</span><span class="vc-v">120,200</span></li>'+
      '</ul></div>';

    el.innerHTML=html;
    renderCountries("");

    // Wiring
    el.querySelectorAll('.side-item[data-kind]').forEach(function(b){
      var kind=b.getAttribute("data-kind");
      if(kind==="date" || kind==="league"){
        b.addEventListener("click", function(){ onSidebarClick(b); });
      }
    });
    document.getElementById("countrySearch").addEventListener("input", function(e){
      renderCountries(e.target.value);
    });
  }

  function renderCountries(q){
    q=(q||"").toLowerCase();
    var list=document.getElementById("countryList");
    var html="";
    (D.countries||[]).forEach(function(name){
      if(q && name.toLowerCase().indexOf(q)<0) return;
      html+='<button class="side-item" data-kind="country" data-val="'+esc(name)+'">'+
        '<span class="ico">\ud83c\udff3\ufe0f</span><span class="lbl">'+esc(name)+'</span>'+
        '<span class="caret">\u203a</span></button>';
    });
    list.innerHTML = html || '<div class="empty" style="padding:14px">No match</div>';
    // country items just search the table by name (best-effort demo)
    list.querySelectorAll('.side-item[data-kind="country"]').forEach(function(b){
      b.addEventListener("click", function(){ onSidebarClick(b); });
    });
  }

  function setActive(btn){
    document.querySelectorAll('.sidebar .side-item').forEach(function(x){ x.classList.remove("active"); });
    if(btn) btn.classList.add("active");
  }

  function onSidebarClick(btn){
    var kind=btn.getAttribute("data-kind");
    var val=btn.getAttribute("data-val");
    switchView("predictions");
    setActive(btn);
    if(kind==="date" && val==="selection"){
      setMode("selection");
      renderPredictions();
      return;
    }
    if(mode==="selection"){ setMode("1x2"); }
    if(kind==="date"){
      // buttons without real data (live/top/fav/lists) fall back to "all"
      dateFilter = ("today tomorrow weekend yesterday all".indexOf(val)>=0) ? val : "all";
      document.getElementById("leagueFilter").value="all";
    } else if(kind==="league"){
      dateFilter="all";
      var sel=document.getElementById("leagueFilter");
      // only switch if this league exists in the fixture data
      var exists=Array.prototype.some.call(sel.options,function(o){return o.value===val;});
      sel.value = exists ? val : "all";
    } else if(kind==="country"){
      document.getElementById("searchBox").value=""; // no team-country map in demo
    }
    renderPredictions();
  }

  /* ---------- Wiring ---------- */
  function initLeagueFilter(){
    var sel=document.getElementById("leagueFilter");
    var seen={};
    D.fixtures.forEach(function(f){
      if(!seen[f.league]){ seen[f.league]=1;
        var o=document.createElement("option"); o.value=f.league; o.textContent=f.league; sel.appendChild(o);
      }
    });
  }

  function switchView(name){
    ["predictions","results","how"].forEach(function(v){
      document.getElementById("view-"+v).hidden = (v!==name);
    });
    document.querySelectorAll(".nav-btn").forEach(function(b){
      b.classList.toggle("active", b.getAttribute("data-view")===name);
    });
    if(name==="results") renderResults();
  }

  document.addEventListener("DOMContentLoaded", function(){
    initLeagueFilter();
    buildSidebar();
    updateSelBadges();
    renderPredictions();
    // Hamburger menu toggle (mobile)
    var menuToggle=document.getElementById("menuToggle");
    var mainNav=document.querySelector(".main-nav");
    if(menuToggle && mainNav){
      menuToggle.addEventListener("click", function(){
        var open=mainNav.classList.toggle("open");
        menuToggle.setAttribute("aria-expanded", open?"true":"false");
      });
      // close nav when a nav-btn is clicked
      mainNav.querySelectorAll(".nav-btn").forEach(function(b){
        b.addEventListener("click", function(){
          mainNav.classList.remove("open");
          menuToggle.setAttribute("aria-expanded","false");
        });
      });
      // close nav when clicking outside
      document.addEventListener("click", function(e){
        if(!mainNav.contains(e.target) && e.target!==menuToggle){
          mainNav.classList.remove("open");
          menuToggle.setAttribute("aria-expanded","false");
        }
      });
    }
    // Sidebar toggle (mobile)
    var sideToggle=document.getElementById("sideToggle");
    if(sideToggle){
      sideToggle.addEventListener("click", function(){
        var sb=document.getElementById("sidebar");
        sb.classList.toggle("open");
        sideToggle.classList.toggle("open");
      });
    }
    ["leagueFilter","tipFilter","probFilter"].forEach(function(id){
      document.getElementById(id).addEventListener("change", renderPredictions);
    });
    document.getElementById("searchBox").addEventListener("input", renderPredictions);
    document.querySelectorAll(".mode-btn").forEach(function(b){
      b.addEventListener("click", function(){
        mode = b.getAttribute("data-mode");
        document.querySelectorAll(".mode-btn").forEach(function(x){
          x.classList.toggle("active", x===b);
        });
        renderPredictions();
      });
    });
    document.querySelectorAll(".nav-btn").forEach(function(b){
      b.addEventListener("click", function(){ switchView(b.getAttribute("data-view")); });
    });
    // Sticky anchor ad: reserve space + wire the close button
    var anchor=document.getElementById("anchorAd");
    var anchorClose=document.getElementById("anchorAdClose");
    if(anchor && anchorClose){
      document.body.classList.add("has-anchor-ad");
      anchorClose.addEventListener("click", function(){
        anchor.hidden=true;
        document.body.classList.remove("has-anchor-ad");
      });
    }
    document.querySelectorAll(".eng-btn").forEach(function(b){
      b.addEventListener("click", function(){
        var e=b.getAttribute("data-engine");
        if(e===engine) return;
        engine=e;
        document.querySelectorAll(".eng-btn").forEach(function(x){
          var on=(x===b);
          x.classList.toggle("active", on);
          x.setAttribute("aria-pressed", on?"true":"false");
        });
        buildRows();          // recompute predictions with the chosen source
        renderPredictions();  // refresh the table (also closes open detail rows)
        renderResults();      // keep the accuracy page in sync
      });
    });
  });
})();
