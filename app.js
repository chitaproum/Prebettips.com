/* PreBetTips - front-end logic (demo).
   Two prediction engines:
   (1) Poisson model  : expected goals from att/def ratings -> score grid.
   (2) KPI framework  : stats-weighted confidence index (PDF-style method).
   Sample data only - not betting advice. No inline event handlers are used;
   everything is wired with addEventListener. */
(function () {
  'use strict';
  var DATA = window.DATA || {};
  var TEAMS = DATA.teams || {};
  var FIXTURES = DATA.fixtures || [];
  var HISTORY = DATA.history || [];
  var LEAGUE_AVG = DATA.leagueAvgGoals || 2.7;
  var HOME_ADV = DATA.homeAdvantage || 1.15;

  /* ---------- tiny DOM helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pct(x) { return Math.round(x * 100); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /* ---------- Poisson engine ---------- */
  function factorial(n) { var f = 1; for (var i = 2; i <= n; i++) f *= i; return f; }
  function poissonPmf(k, lambda) { return Math.pow(lambda, k) * Math.exp(-lambda) / factorial(k); }

  function lambdas(home, away) {
    var h = TEAMS[home] || { att: 1, def: 1 };
    var a = TEAMS[away] || { att: 1, def: 1 };
    var base = LEAGUE_AVG / 2;
    var lh = h.att * a.def * base * HOME_ADV;
    var la = a.att * h.def * base;
    return { lh: clamp(lh, 0.15, 6), la: clamp(la, 0.15, 6) };
  }

  function predictPoisson(home, away) {
    var L = lambdas(home, away), N = 7;
    var pH = 0, pD = 0, pA = 0, pOver = 0, best = 0, bh = 0, ba = 0;
    for (var i = 0; i <= N; i++) {
      for (var j = 0; j <= N; j++) {
        var p = poissonPmf(i, L.lh) * poissonPmf(j, L.la);
        if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
        if (i + j > 2) pOver += p;
        if (p > best) { best = p; bh = i; ba = j; }
      }
    }
    var s = pH + pD + pA;
    pH /= s; pD /= s; pA /= s;
    return {
      pHome: pH, pDraw: pD, pAway: pA,
      scoreH: bh, scoreA: ba,
      expH: L.lh, expA: L.la, expTotal: L.lh + L.la,
      pOver: clamp(pOver, 0.02, 0.98)
    };
  }
  /* ---------- KPI stats (computed from HISTORY) ---------- */
  var _statsCache = null;
  function buildStats() {
    if (_statsCache) return _statsCache;
    var map = {};
    function ensure(t) {
      if (!map[t]) map[t] = {
        games: [], gf: 0, ga: 0, w: 0, d: 0, l: 0,
        hGames: [], hw: 0, hd: 0, hl: 0,
        aGames: [], aw: 0, ad: 0, al: 0
      };
      return map[t];
    }
    // chronological order (oldest first) so "recent" = tail
    var hist = HISTORY.slice().sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    hist.forEach(function (m) {
      var H = ensure(m.home), A = ensure(m.away);
      var res = m.fh > m.fa ? 'H' : (m.fh < m.fa ? 'A' : 'D');
      H.gf += m.fh; H.ga += m.fa; A.gf += m.fa; A.ga += m.fh;
      var hRec = { res: res === 'H' ? 'W' : (res === 'A' ? 'L' : 'D'), gf: m.fh, ga: m.fa, date: m.date, opp: m.away, venue: 'H' };
      var aRec = { res: res === 'A' ? 'W' : (res === 'H' ? 'L' : 'D'), gf: m.fa, ga: m.fh, date: m.date, opp: m.home, venue: 'A' };
      H.games.push(hRec); A.games.push(aRec);
      H.hGames.push(hRec); A.aGames.push(aRec);
      if (res === 'H') { H.w++; H.hw++; A.l++; A.al++; }
      else if (res === 'A') { A.w++; A.aw++; H.l++; H.hl++; }
      else { H.d++; H.hd++; A.d++; A.ad++; }
    });
    _statsCache = map;
    return map;
  }
  function teamStat(t) {
    var m = buildStats()[t];
    if (!m) return null;
    var n = m.games.length || 1;
    return {
      n: m.games.length,
      winRate: m.w / n,
      ppg: (m.w * 3 + m.d) / n,
      aGF: m.gf / n, aGA: m.ga / n,
      net: (m.gf - m.ga) / n,
      overRate: m.games.filter(function (g) { return g.gf + g.ga > 2.5; }).length / n,
      recent6: m.games.slice(-6),
      raw: m
    };
  }
  function venuePPG(t, venue) {
    var m = buildStats()[t]; if (!m) return null;
    var g = venue === 'H' ? m.hGames : m.aGames;
    if (!g.length) return null;
    var pts = g.reduce(function (s, x) { return s + (x.res === 'W' ? 3 : x.res === 'D' ? 1 : 0); }, 0);
    return { ppg: pts / g.length, winRate: g.filter(function (x) { return x.res === 'W'; }).length / g.length, n: g.length };
  }
  function h2h(home, away) {
    var rows = HISTORY.filter(function (m) {
      return (m.home === home && m.away === away) || (m.home === away && m.away === home);
    }).sort(function (x, y) { return x.date < y.date ? 1 : -1; });
    var hp = 0, ap = 0;
    rows.forEach(function (m) {
      var hs = m.home === home ? m.fh : m.fa, as = m.home === home ? m.fa : m.fh;
      if (hs > as) hp += 3; else if (hs < as) ap += 3; else { hp++; ap++; }
    });
    return { rows: rows, hp: hp, ap: ap, n: rows.length };
  }

  /* ---------- KPI engine (PDF-style weighted confidence index) ---------- */
  function predictKpi(home, away) {
    var model = predictPoisson(home, away); // reused for score & expected goals
    var hs = teamStat(home), as = teamStat(away);
    var hv = venuePPG(home, 'H'), av = venuePPG(away, 'A');
    var hh = h2h(home, away);
    // normalised components in [0,1], higher favours that side
    function norm(x, lo, hi) { return clamp((x - lo) / (hi - lo), 0, 1); }
    var hWin = hs ? hs.winRate : 0.45, aWin = as ? as.winRate : 0.40;
    var hVen = hv ? hv.winRate : hWin, aVen = av ? av.winRate : aWin;
    var hRec = hs ? norm(hs.ppg, 0, 3) : 0.5, aRec = as ? norm(as.ppg, 0, 3) : 0.45;
    var hVR = hv ? norm(hv.ppg, 0, 3) : hRec, aVR = av ? norm(av.ppg, 0, 3) : aRec;
    var h2hTot = hh.hp + hh.ap;
    var hH2H = h2hTot ? hh.hp / h2hTot : 0.52, aH2H = h2hTot ? hh.ap / h2hTot : 0.48;
    var hNet = norm(hs ? hs.net : 0, -2, 2), aNet = norm(as ? as.net : 0, -2, 2);
    // weights: overallW .15 | venueW .15 | recent6 .20 | venue-recent .15 | H2H .20 | net .15
    var hConf = 0.15 * hWin + 0.15 * hVen + 0.20 * hRec + 0.15 * hVR + 0.20 * hH2H + 0.15 * hNet;
    var aConf = 0.15 * aWin + 0.15 * aVen + 0.20 * aRec + 0.15 * aVR + 0.20 * aH2H + 0.15 * aNet;
    hConf += 0.06; // home advantage bump
    var closeness = 1 - clamp(Math.abs(hConf - aConf) / 0.5, 0, 1);
    var pDraw = clamp(0.08 + (0.34 - 0.08) * closeness, 0.08, 0.34);
    var rem = 1 - pDraw, tot = hConf + aConf || 1;
    var pHome = rem * (hConf / tot), pAway = rem * (aConf / tot);
    var sum = pHome + pDraw + pAway || 1;
    pHome /= sum; pAway /= sum;
    var pDraw2 = pDraw / sum;
    // Over/Under KPI confidence: .45 Poisson + .35 historical over-rate + .20 expected-goals factor
    var histOver = ((hs ? hs.overRate : 0.5) + (as ? as.overRate : 0.5)) / 2;
    var expFactor = clamp(model.expTotal / 4, 0, 1);
    var pOver = clamp(0.45 * model.pOver + 0.35 * histOver + 0.20 * expFactor, 0.02, 0.98);
    return {
      pHome: pHome, pDraw: pDraw2, pAway: pAway,
      scoreH: model.scoreH, scoreA: model.scoreA,
      expH: model.expH, expA: model.expA, expTotal: model.expTotal,
      pOver: pOver,
      _kpi: { hConf: hConf, aConf: aConf, hH2H: hH2H, aH2H: aH2H, h2hN: hh.n }
    };
  }

  function predict(home, away) {
    return state.engine === 'random' ? predictKpi(home, away) : predictPoisson(home, away);
  }
  /* ---------- state ---------- */
  var state = {
    mode: '1x2',        // 1x2 | ou | stats | selection
    engine: 'poisson',  // poisson | random(KPI)
    league: 'all',
    tip: 'all',
    minProb: 0,
    search: '',
    period: 'today',    // today | live | tomorrow | weekend | yesterday | all | top | day
    day: null,          // 'YYYY-MM-DD' when period === 'day'
    selection: {}       // key -> true
  };
  function fxKey(f) { return f.home + '|' + f.away + '|' + f.date; }

  /* ---------- date periods (sidebar + Featured matches strip) ---------- */
  var TOP_MIN = 60;       // "TOP predictions" = best 1X2 probability >= this %
  var LIVE_MINUTES = 110; // a match counts as live for this long after kick-off
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function parseDay(s) { var a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
  function addDays(s, n) { var d = parseDay(s); d.setDate(d.getDate() + n); return isoDate(d); }
  function dayOf(f) { return String(f.date).slice(0, 10); }
  function showDay(s) { var a = s.split('-'); return a[2] + '.' + a[1] + '.' + a[0]; }
  var REAL_TODAY = isoDate(new Date());
  /* "Today" is the real date when the data has fixtures within 2 days of it;
     otherwise (static demo data) it is the first fixture day, so the page is never empty. */
  var REF = (function () {
    var days = FIXTURES.map(dayOf).sort(), near = [];
    for (var i = -2; i <= 2; i++) near.push(addDays(REAL_TODAY, i));
    if (days.some(function (d) { return near.indexOf(d) !== -1; })) return REAL_TODAY;
    return days[0] || REAL_TODAY;
  })();
  function weekendRange() {
    var dow = parseDay(REF).getDay();            // 0 Sun .. 6 Sat
    var sat = dow === 6 ? REF : (dow === 0 ? addDays(REF, -1) : addDays(REF, 6 - dow));
    return [sat, addDays(sat, 1)];
  }
  function allRange() {
    var days = FIXTURES.map(dayOf).sort();
    return [days[0] || REF, days[days.length - 1] || REF];
  }
  function isLive(f) {
    if (f.live === true) return true;
    if (REF !== REAL_TODAY) return false;        // demo dates: nothing is really live
    var t = String(f.date).split(' ')[1];
    if (!t) return false;
    var a = dayOf(f).split('-'), h = t.split(':');
    var ko = new Date(+a[0], +a[1] - 1, +a[2], +h[0], +h[1]).getTime();
    var diff = (Date.now() - ko) / 60000;
    return diff >= 0 && diff <= LIVE_MINUTES;
  }
  function periodRange(period, day) {
    switch (period) {
      case 'tomorrow':  return [addDays(REF, 1), addDays(REF, 1)];
      case 'yesterday': return [addDays(REF, -1), addDays(REF, -1)];
      case 'weekend':   return weekendRange();
      case 'all': case 'top': return allRange();
      case 'day':       return [day, day];
      default:          return [REF, REF];       // today, live
    }
  }
  function inPeriod(f, p, period, day) {
    if (period === 'live') return isLive(f);
    if (period === 'top') return Math.max(p.pHome, p.pDraw, p.pAway) * 100 >= TOP_MIN;
    if (period === 'all') return true;
    var r = periodRange(period, day), d = dayOf(f);
    return d >= r[0] && d <= r[1];
  }
  function matchesPeriod(f, p) { return inPeriod(f, p, state.period, state.day); }
  function currentDay() {
    switch (state.period) {
      case 'today': return REF;
      case 'tomorrow': return addDays(REF, 1);
      case 'yesterday': return addDays(REF, -1);
      case 'day': return state.day;
      default: return null;
    }
  }
  function setPeriod(period) { state.period = period; state.day = null; renderPredictions(); }
  function setDay(d) {
    if (d === REF) { setPeriod('today'); return; }
    if (d === addDays(REF, 1)) { setPeriod('tomorrow'); return; }
    if (d === addDays(REF, -1)) { setPeriod('yesterday'); return; }
    state.period = 'day'; state.day = d; renderPredictions();
  }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function buildDayStrip() {
    var el = $('#dayStrip');
    if (!el) return;
    var html = '';
    for (var i = -2; i <= 2; i++) {
      var d = addDays(REF, i);
      html += '<button type="button" class="day-pill" data-day="' + d + '" title="' + showDay(d) + '">'
        + (i === 0 ? 'Today' : DOW[parseDay(d).getDay()]) + '</button>';
    }
    el.innerHTML = html;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('.day-pill');
      if (b) setDay(b.getAttribute('data-day'));
    });
  }
  function syncPeriodUI() {
    var cd = currentDay();
    $all('.day-pill').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-day') === cd); });
    $all('.side-item[data-period]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-period') === state.period);
    });
    var r = periodRange(state.period, state.day), dr = $('#dateRange');
    if (dr) dr.textContent = showDay(r[0]) + ' - ' + showDay(r[1]);
    var counts = { today: 0, live: 0, tomorrow: 0, weekend: 0, yesterday: 0, all: 0 };
    FIXTURES.forEach(function (f) {
      var p = predict(f.home, f.away);
      Object.keys(counts).forEach(function (k) { if (inPeriod(f, p, k)) counts[k]++; });
    });
    Object.keys(counts).forEach(function (k) {
      var c = $('[data-period="' + k + '"] .cnt');
      if (!c) return;
      c.textContent = counts[k];
      c.hidden = counts[k] === 0;
    });
  }

  /* ---------- table headers per mode ---------- */
  var HEADS = {
    '1x2': '<tr><th class="col-pick">Pick</th><th>Date</th><th class="col-league">League</th>'
      + '<th class="col-match">Match</th><th>1</th><th>X</th><th>2</th><th>Tip</th><th>Score</th></tr>',
    'ou': '<tr><th class="col-pick">Pick</th><th>Date</th><th class="col-league">League</th>'
      + '<th class="col-match">Match</th><th>Exp. goals</th><th>Over 2.5</th><th>Under 2.5</th><th>Tip</th></tr>',
    'stats': '<tr><th class="col-match">Match</th><th>1</th><th>X</th><th>2</th><th>Exp. goals</th><th>Over 2.5</th><th>Score</th></tr>',
    'selection': '<tr><th>Date</th><th class="col-league">League</th><th class="col-match">Match</th>'
      + '<th class="col-prob">Probabilities</th><th>Tip</th><th>Score</th><th></th></tr>'
  };

  function adRowHtml(cols) {
    return '<tr class="ad-row"><td colspan="' + cols + '" style="padding:0">'
      + '<div class="ad-slot ad-inline" style="margin:0;border-radius:0;border-left:0;border-right:0" aria-label="Advertisement">'
      + '<span class="ad-body">Your banner here<span class="ad-size">Leaderboard 728×90</span></span></div></td></tr>';
  }

  function fmtDate(d) {
    var parts = String(d).split(' ');
    var dd = parts[0] ? parts[0].slice(5) : '';
    return '<span class="date-cell"><b>' + esc(dd.split('-').reverse().join('/')) + '</b>'
      + (parts[1] ? '<span class="time">' + esc(parts[1]) + '</span>' : '') + '</span>';
  }
  function initials(name) {
    var w = String(name).replace(/\./g, '').split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0].charAt(0) + w[1].charAt(0) : String(name).slice(0, 2)).toUpperCase();
  }
  function matchCell(f) {
    return '<div class="match-cell">'
      + '<span class="mc-team"><span class="crest" aria-hidden="true">' + esc(initials(f.home)) + '</span>' + esc(f.home) + '</span>'
      + '<span class="mc-team"><span class="crest" aria-hidden="true">' + esc(initials(f.away)) + '</span>' + esc(f.away) + '</span>'
      + '<span class="mc-league">' + esc(f.league) + '</span></div>';
  }
  function bestKey(p) {
    if (p.pHome >= p.pDraw && p.pHome >= p.pAway) return '1';
    if (p.pAway >= p.pHome && p.pAway >= p.pDraw) return '2';
    return 'X';
  }
  function probCell(val, key, best) {
    return '<span class="prob ' + (key === best ? 'best-' + best : '') + '">' + pct(val) + '%'
      + '<span class="bar" style="width:' + Math.max(6, pct(val)) + '%"></span></span>';
  }
  function tipBadge(key) {
    var cls = key === '1' ? 't1' : key === '2' ? 't2' : 'tX';
    return '<span class="tip ' + cls + '">' + key + '</span>';
  }

  /* ---------- row builders per mode ---------- */
  function row1x2(f, p) {
    var best = bestKey(p), k = fxKey(f), checked = state.selection[k] ? ' checked' : '';
    return '<tr>'
      + '<td class="col-pick"><input type="checkbox" class="pick-cb" data-key="' + esc(k) + '"' + checked + ' aria-label="Add to selection"></td>'
      + '<td>' + fmtDate(f.date) + '</td>'
      + '<td class="col-league"><span class="league-cell">' + esc(f.league) + '</span></td>'
      + '<td class="col-match">' + matchCell(f) + '</td>'
      + '<td>' + probCell(p.pHome, '1', best) + '</td>'
      + '<td>' + probCell(p.pDraw, 'X', best) + '</td>'
      + '<td>' + probCell(p.pAway, '2', best) + '</td>'
      + '<td>' + tipBadge(best) + '</td>'
      + '<td><span class="score">' + p.scoreH + '-' + p.scoreA + '</span></td>'
      + '</tr>';
  }
  function rowOu(f, p) {
    var over = p.pOver, under = 1 - over, k = fxKey(f), checked = state.selection[k] ? ' checked' : '';
    var tip = over >= 0.5 ? 'over' : 'under';
    return '<tr>'
      + '<td class="col-pick"><input type="checkbox" class="pick-cb" data-key="' + esc(k) + '"' + checked + ' aria-label="Add to selection"></td>'
      + '<td>' + fmtDate(f.date) + '</td>'
      + '<td class="col-league"><span class="league-cell">' + esc(f.league) + '</span></td>'
      + '<td class="col-match">' + matchCell(f) + '</td>'
      + '<td><span class="score">' + p.expTotal.toFixed(2) + '</span></td>'
      + '<td><span class="ou over">' + pct(over) + '%</span></td>'
      + '<td><span class="ou under">' + pct(under) + '%</span></td>'
      + '<td><span class="ou ' + tip + '">' + (tip === 'over' ? 'Over 2.5' : 'Under 2.5') + '</span></td>'
      + '</tr>';
  }
  function rowStats(f, p, idx) {
    var best = bestKey(p);
    return '<tr class="stats-row" data-idx="' + idx + '">'
      + '<td class="col-match"><span class="exp-caret">&#9656;</span>' + esc(f.home) + ' v ' + esc(f.away) + '</td>'
      + '<td>' + probCell(p.pHome, '1', best) + '</td>'
      + '<td>' + probCell(p.pDraw, 'X', best) + '</td>'
      + '<td>' + probCell(p.pAway, '2', best) + '</td>'
      + '<td><span class="score">' + p.expTotal.toFixed(2) + '</span></td>'
      + '<td><span class="ou over">' + pct(p.pOver) + '%</span></td>'
      + '<td><span class="score">' + p.scoreH + '-' + p.scoreA + '</span></td>'
      + '</tr>';
  }
  /* ---------- Stats detail panel (recent form + H2H) ---------- */
  function formRowsHtml(team) {
    var st = teamStat(team);
    if (!st || !st.recent6.length) {
      return '<tr><td class="ft-team">' + esc(team) + '</td><td colspan="6" style="color:var(--muted)">No recent matches in sample</td></tr>';
    }
    var g = st.recent6;
    var cells = g.map(function (x) {
      var cls = x.res === 'W' ? 'ppg' : x.res === 'L' ? 'aga' : '';
      return '<td class="' + cls + '">' + x.res + '</td>';
    }).join('');
    while (g.length < 6) { cells += '<td style="color:var(--muted)">–</td>'; g = g.concat([0]); }
    return '<tr><td class="ft-team">' + esc(team) + '</td>'
      + '<td class="agf">' + st.aGF.toFixed(2) + '</td>'
      + '<td class="aga">' + st.aGA.toFixed(2) + '</td>'
      + '<td class="ppg">' + st.ppg.toFixed(2) + '</td>'
      + '<td class="ovg">' + pct(st.overRate) + '%</td></tr>';
  }
  function detailPanel(f) {
    var hh = h2h(f.home, f.away);
    var formTbl = '<p class="form-title">Season form (sample)</p>'
      + '<table class="form-table"><thead><tr>'
      + '<th class="ft-team">Team</th><th>Avg GF</th><th>Avg GA</th><th>PPG</th><th class="ovg">Over 2.5</th>'
      + '</tr></thead><tbody>' + formRowsHtml(f.home) + formRowsHtml(f.away) + '</tbody></table>';
    var h2hRows = hh.rows.length
      ? hh.rows.map(function (m) {
        var hw = m.fh > m.fa, aw = m.fh < m.fa;
        return '<div class="rs-row"><span class="rs-date">' + esc(m.date.slice(5)) + '</span>'
          + '<span class="rs-teams"><span class="rs-tn ' + (hw ? 'win' : '') + '">' + esc(m.home) + '</span>'
          + '<span class="rs-sc">' + m.fh + '–' + m.fa + '</span>'
          + '<span class="rs-tn ' + (aw ? 'win' : '') + '">' + esc(m.away) + '</span></span>'
          + '<span class="rs-lg">' + esc(m.league) + '</span></div>';
      }).join('')
      : '<div class="rs-row"><span class="rs-tn" style="text-align:center;flex:1">No head-to-head in sample</span></div>';
    var h2hMod = '<div class="rs-module"><div class="rs-head"><span class="rs-tag">H2H</span>'
      + '<span class="rs-title">Head to head</span></div><div class="rs-rows">' + h2hRows + '</div></div>';
    return '<div class="form-panel">' + formTbl + '</div><div class="results-info">' + h2hMod + '</div>';
  }
  function toggleDetail(tr) {
    var idx = tr.getAttribute('data-idx');
    var next = tr.nextElementSibling;
    if (next && next.classList.contains('detail-row')) {
      next.parentNode.removeChild(next); tr.classList.remove('open'); return;
    }
    $all('tr.detail-row').forEach(function (d) { d.parentNode.removeChild(d); });
    $all('tr.stats-row.open').forEach(function (d) { d.classList.remove('open'); });
    var f = _rendered[idx];
    if (!f) return;
    var dr = document.createElement('tr');
    dr.className = 'detail-row';
    dr.innerHTML = '<td colspan="7">' + detailPanel(f) + '</td>';
    tr.parentNode.insertBefore(dr, tr.nextElementSibling);
    tr.classList.add('open');
  }
  /* ---------- filtering + render ---------- */
  var _rendered = [];
  function passesFilters(f, p) {
    if (!matchesPeriod(f, p)) return false;
    if (state.league !== 'all' && f.league !== state.league) return false;
    if (state.search) {
      var q = state.search.toLowerCase();
      if ((f.home + ' ' + f.away).toLowerCase().indexOf(q) === -1) return false;
    }
    var best = bestKey(p);
    if (state.tip !== 'all') {
      if (state.tip === 'over') { if (p.pOver < 0.5) return false; }
      else if (state.tip === 'under') { if (p.pOver >= 0.5) return false; }
      else if (state.tip !== best) return false;
    }
    if (state.minProb > 0) {
      var topProb = Math.max(p.pHome, p.pDraw, p.pAway) * 100;
      if (state.tip === 'over') topProb = p.pOver * 100;
      else if (state.tip === 'under') topProb = (1 - p.pOver) * 100;
      if (topProb < state.minProb) return false;
    }
    return true;
  }

  function renderPredictions() {
    var head = $('#predHead'), body = $('#predBody'), empty = $('#emptyMsg');
    syncPeriodUI();
    if (state.mode === 'selection') { renderSelection(head, body, empty); return; }
    head.innerHTML = HEADS[state.mode];
    _rendered = [];
    var rows = [], cols = state.mode === 'ou' ? 8 : (state.mode === 'stats' ? 7 : 9);
    FIXTURES.forEach(function (f) {
      var p = predict(f.home, f.away);
      if (!passesFilters(f, p)) return;
      var idx = _rendered.length;
      _rendered.push(f);
      if (state.mode === '1x2') rows.push(row1x2(f, p));
      else if (state.mode === 'ou') rows.push(rowOu(f, p));
      else rows.push(rowStats(f, p, idx));
      if (idx === 3) rows.push(adRowHtml(cols)); // inline ad after 4th row
    });
    body.innerHTML = rows.join('');
    empty.hidden = rows.length > 0;
    bindRowEvents();
    updateSelBadges();
  }

  function bindRowEvents() {
    $all('.pick-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var k = cb.getAttribute('data-key');
        if (cb.checked) state.selection[k] = true; else delete state.selection[k];
        updateSelBadges();
      });
    });
    $all('tr.stats-row').forEach(function (tr) {
      tr.addEventListener('click', function () { toggleDetail(tr); });
    });
  }

  /* ---------- Your Selection ---------- */
  function selectedFixtures() {
    return FIXTURES.filter(function (f) { return state.selection[fxKey(f)]; });
  }
  function updateSelBadges() {
    var n = Object.keys(state.selection).length;
    var badge = $('#selCount');
    if (badge) { badge.textContent = n; badge.hidden = n === 0; }
  }
  function selProbHtml(p) {
    var best = bestKey(p);
    function one(v, k) {
      return '<span class="pp ' + (k === best ? 'hi' : '') + '">' + k + ' ' + pct(v) + '%</span>';
    }
    return one(p.pHome, '1') + one(p.pDraw, 'X') + one(p.pAway, '2');
  }
  function selTipHtml(p) { return tipBadge(bestKey(p)); }

  function renderSelection(head, body, empty) {
    head.innerHTML = HEADS.selection;
    var fx = selectedFixtures();
    if (!fx.length) {
      body.innerHTML = '<tr class="sel-tools"><td colspan="7">'
        + '<span class="sel-info">No matches selected. Tick the “Pick” box on the 1X2 or Over/Under tab to build your slip.</span>'
        + '</td></tr>';
      empty.hidden = true; updateSelBadges(); return;
    }
    var tools = '<tr class="sel-tools"><td colspan="7">'
      + '<span class="sel-info">' + fx.length + ' match' + (fx.length > 1 ? 'es' : '') + ' in your selection</span>'
      + '<button type="button" class="sel-clear" id="selClear">Clear all</button>'
      + '<button type="button" class="sel-pdf" id="selPdf">Download PDF</button>'
      + '</td></tr>';
    var rows = fx.map(function (f) {
      var p = predict(f.home, f.away), k = fxKey(f);
      return '<tr>'
        + '<td>' + fmtDate(f.date) + '</td>'
        + '<td class="col-league"><span class="league-cell">' + esc(f.league) + '</span></td>'
        + '<td class="col-match">' + matchCell(f) + '</td>'
        + '<td class="col-prob">' + selProbHtml(p) + '</td>'
        + '<td>' + selTipHtml(p) + '</td>'
        + '<td><span class="score">' + p.scoreH + '-' + p.scoreA + '</span></td>'
        + '<td><button type="button" class="sel-remove" data-key="' + esc(k) + '" aria-label="Remove">×</button></td>'
        + '</tr>';
    }).join('');
    body.innerHTML = tools + rows;
    empty.hidden = true;
    var clr = $('#selClear');
    if (clr) clr.addEventListener('click', function () { state.selection = {}; renderPredictions(); });
    var pdf = $('#selPdf');
    if (pdf) pdf.addEventListener('click', downloadSelectionPdf);
    $all('.sel-remove').forEach(function (b) {
      b.addEventListener('click', function () {
        delete state.selection[b.getAttribute('data-key')];
        renderPredictions();
      });
    });
    updateSelBadges();
  }

  function downloadSelectionPdf() {
    var fx = selectedFixtures();
    if (!fx.length) return;
    var engName = state.engine === 'random' ? 'KPI' : 'Poisson';
    var w = window.open('', '_blank');
    if (!w) return;
    var rows = fx.map(function (f) {
      var p = predict(f.home, f.away);
      return '<tr><td>' + esc(f.date) + '</td><td>' + esc(f.league) + '</td>'
        + '<td>' + esc(f.home + ' v ' + f.away) + '</td>'
        + '<td>1 ' + pct(p.pHome) + '% / X ' + pct(p.pDraw) + '% / 2 ' + pct(p.pAway) + '%</td>'
        + '<td style="font-weight:700">' + bestKey(p) + '</td>'
        + '<td>' + p.scoreH + '-' + p.scoreA + '</td>'
        + '<td>Over ' + pct(p.pOver) + '%</td></tr>';
    }).join('');
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>PreBetTips — My Selection</title>'
      + '<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:28px}'
      + 'h1{font-size:20px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin:0 0 16px}'
      + 'table{width:100%;border-collapse:collapse;font-size:12px}'
      + 'th,td{border:1px solid #ccc;padding:7px 8px;text-align:left}'
      + 'th{background:#f0f3f7}.foot{margin-top:16px;color:#888;font-size:11px}</style></head><body>'
      + '<h1>PreBetTips — My Selection</h1>'
      + '<p class="sub">' + fx.length + ' match(es) · ' + engName + ' engine · generated ' + new Date().toLocaleString() + '</p>'
      + '<table><thead><tr><th>Date</th><th>League</th><th>Match</th><th>1 X 2</th><th>Tip</th><th>Score</th><th>O/U</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '<p class="foot">Sample/demo predictions — not betting advice. 18+ Please gamble responsibly.</p>'
      + '<script>window.onload=function(){window.print();}<\/script></body></html>';
    w.document.open(); w.document.write(html); w.document.close();
  }
  /* ---------- mode + engine switches ---------- */
  function setMode(mode) {
    state.mode = mode;
    $all('.mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    renderPredictions();
  }
  function setEngine(eng) {
    state.engine = eng;
    $all('.eng-btn').forEach(function (b) {
      var on = b.getAttribute('data-engine') === eng;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderPredictions();
  }

  /* ---------- sidebar ---------- */
  function leagueCounts() {
    var c = {};
    FIXTURES.forEach(function (f) { c[f.league] = (c[f.league] || 0) + 1; });
    return c;
  }
  function buildSidebar() {
    var side = $('#sidebar');
    if (!side) return;
    var counts = leagueCounts();
    var pl = (DATA.popularLeagues || []).map(function (lg) {
      var n = counts[lg.name] || 0;
      return '<button class="side-item" data-league="' + esc(lg.name) + '">'
        + '<span class="ico">' + lg.icon + '</span><span class="lbl">' + esc(lg.name) + '</span>'
        + (n ? '<span class="cnt">' + n + '</span>' : '') + '</button>';
    }).join('');
    var allBtn = '<button class="side-item active" data-league="all"><span class="ico">★</span>'
      + '<span class="lbl">All leagues</span><span class="cnt">' + FIXTURES.length + '</span></button>';
    var countries = (DATA.countries || []).map(function (co) {
      return '<button class="side-item" data-country="' + esc(co) + '"><span class="ico">⚽</span>'
        + '<span class="lbl">' + esc(co) + '</span><span class="caret">›</span></button>';
    }).join('');
    var periodBtns = [['today','Predictions for TODAY'],['live','LIVE predictions'],['tomorrow','Predictions for TOMORROW'],['weekend','Predictions for the WEEKEND'],['yesterday','Predictions from YESTERDAY'],['all','ALL predictions']].map(function (x) {
      return '<button class="side-item side-period" data-period="' + x[0] + '"><span class="lbl">' + x[1]
        + '</span><span class="cnt" hidden>0</span></button>';
    }).join('') + '<button class="side-item side-period side-top" data-period="top"><span class="lbl">TOP predictions</span></button>';
    side.insertAdjacentHTML('beforeend',
      '<div class="side-group side-periods">' + periodBtns + '</div>'
      + '<div class="side-group"><div class="side-title">Popular leagues</div>' + allBtn + pl + '</div>'
      + '<div class="side-group"><div class="side-title">Countries</div>'
      + '<div class="side-search"><span class="ico">⚲</span><input type="search" id="countrySearch" placeholder="Search country…" aria-label="Search country"></div>'
      + '<div class="country-list">' + countries + '</div></div>'
      + '<div class="ad-slot ad-mpu" aria-label="Advertisement"><span class="ad-body">Your ad here<span class="ad-size">MPU 300×250</span></span></div>'
      + '<div class="visitors"><div class="vc-head"><span class="vc-icon">◉</span>Live traffic</div>'
      + '<ul class="vc-list"><li class="online"><span class="vc-k">Online now</span><span class="vc-v">1,284</span></li>'
      + '<li><span class="vc-k">Today</span><span class="vc-v">38,902</span></li>'
      + '<li><span class="vc-k">This week</span><span class="vc-v">241,517</span></li></ul></div>');

    // populate league filter dropdown
    var sel = $('#leagueFilter');
    if (sel) {
      Object.keys(counts).forEach(function (lg) {
        var o = document.createElement('option'); o.value = lg; o.textContent = lg; sel.appendChild(o);
      });
    }
    side.addEventListener('click', function (e) {
      var pb = e.target.closest('.side-item[data-period]');
      if (pb) { setPeriod(pb.getAttribute('data-period')); return; }
      var btn = e.target.closest('.side-item[data-league]');
      if (!btn) return;
      state.league = btn.getAttribute('data-league');
      $all('.side-item[data-league]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      if (sel) sel.value = state.league;
      renderPredictions();
    });
    var cs = $('#countrySearch');
    if (cs) cs.addEventListener('input', function () {
      var q = cs.value.toLowerCase();
      $all('.country-list .side-item').forEach(function (b) {
        b.style.display = b.textContent.toLowerCase().indexOf(q) === -1 ? 'none' : '';
      });
    });
  }

  /* ---------- Results & Accuracy ---------- */
  function renderResults() {
    var body = $('#resultsBody');
    if (!body) return;
    var hit1x2 = 0, hitScore = 0, hitOu = 0, n = HISTORY.length || 1;
    var rows = HISTORY.map(function (m) {
      var p = predictPoisson(m.home, m.away);
      var predTip = bestKey(p);
      var actual = m.fh > m.fa ? '1' : (m.fh < m.fa ? '2' : 'X');
      var okTip = predTip === actual;
      var okScore = p.scoreH === m.fh && p.scoreA === m.fa;
      var predOver = p.pOver >= 0.5;
      var actualOver = (m.fh + m.fa) > 2.5;
      var okOu = predOver === actualOver;
      if (okTip) hit1x2++; if (okScore) hitScore++; if (okOu) hitOu++;
      return '<tr><td>' + esc(m.date.slice(5)) + '</td>'
        + '<td class="col-league"><span class="league-cell">' + esc(m.league) + '</span></td>'
        + '<td class="col-match">' + esc(m.home + ' v ' + m.away) + '</td>'
        + '<td>' + tipBadge(predTip) + '</td>'
        + '<td><span class="score">' + p.scoreH + '-' + p.scoreA + '</span></td>'
        + '<td><span class="score">' + m.fh + '-' + m.fa + '</span></td>'
        + '<td><span class="verdict ' + (okTip ? 'win' : 'miss') + '">' + (okTip ? 'Hit' : 'Miss') + '</span></td></tr>';
    }).join('');
    body.innerHTML = rows;
    $('#accOverall').textContent = pct(hit1x2 / n) + '%';
    $('#accScore').textContent = pct(hitScore / n) + '%';
    $('#accOu').textContent = pct(hitOu / n) + '%';
    $('#settled').textContent = HISTORY.length;
    var ha = $('#heroAcc'); if (ha) ha.textContent = pct(hit1x2 / n) + '%';
  }

  function showView(view) {
    $all('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + view; });
    $all('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    var nav = $('#menuToggle');
    if (nav) nav.setAttribute('aria-expanded', 'false');
    $('.main-nav').classList.remove('open');
  }

  /* ---------- init / wiring ---------- */
  function init() {
    buildSidebar();
    buildDayStrip();
    renderPredictions();
    renderResults();
    var hm = $('#heroMatches'); if (hm) hm.textContent = FIXTURES.length;
    var hl = $('#heroLeagues'); if (hl) hl.textContent = Object.keys(leagueCounts()).length;
    var tt = $('#themeToggle');
    if (tt) {
      var sync = function () {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        tt.innerHTML = dark ? '&#9728;' : '&#9790;';
        tt.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      };
      sync();
      tt.addEventListener('click', function () {
        var dark = document.documentElement.getAttribute('data-theme') !== 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        try { localStorage.setItem('pbt-theme', dark ? 'dark' : 'light'); } catch (e) {}
        sync();
      });
    }

    $all('.mode-btn').forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });
    $all('.eng-btn').forEach(function (b) {
      b.addEventListener('click', function () { setEngine(b.getAttribute('data-engine')); });
    });
    $all('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
    });
    var lf = $('#leagueFilter');
    if (lf) lf.addEventListener('change', function () {
      state.league = lf.value;
      $all('.side-item[data-league]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-league') === state.league);
      });
      renderPredictions();
    });
    var tf = $('#tipFilter');
    if (tf) tf.addEventListener('change', function () { state.tip = tf.value; renderPredictions(); });
    var pf = $('#probFilter');
    if (pf) pf.addEventListener('change', function () { state.minProb = parseInt(pf.value, 10) || 0; renderPredictions(); });
    var sb = $('#searchBox');
    if (sb) sb.addEventListener('input', function () { state.search = sb.value.trim(); renderPredictions(); });

    var mt = $('#menuToggle');
    if (mt) mt.addEventListener('click', function () {
      var nav = $('.main-nav'), open = nav.classList.toggle('open');
      mt.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    var st = $('#sideToggle');
    if (st) st.addEventListener('click', function () {
      var open = $('#sidebar').classList.toggle('open');
      st.classList.toggle('open', open);
    });
    var ac = $('#anchorAdClose');
    if (ac) ac.addEventListener('click', function () { document.body.classList.add('anchor-hidden'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
