/* GoalPre - front-end logic with API-Football data.
   Two prediction engines:
   (1) Poisson model (Dixon-Coles corrected) : expected goals from att/def ratings -> score grid with tau adjustment + normalization.
   (2) KPI framework  : stats-weighted confidence index (PDF-style method).
   Model estimates and market odds are not guarantees. No inline event handlers are used;
   everything is wired with addEventListener. */
(function () {
  'use strict';
  var DATA = window.DATA || {};
  var TEAMS = DATA.teams || {};
  var FIXTURES = DATA.fixtures || [];
  var HISTORY = DATA.history || [];
  var LEAGUE_AVG = DATA.leagueAvgGoals || 2.7;
  var HOME_ADV = DATA.homeAdvantage || 1.15;
  var CATALOG = DATA.leagues || DATA.popularLeagues || [];
  var activeLeague = null;
  function teamRating(name) { return ((DATA.teamsByLeague || {})[activeLeague] || TEAMS)[name]; }
  function countryLabel(name) { return name === 'South-Korea' ? 'South Korea' : name === 'Czech-Republic' ? 'Czech Republic' : name === 'Saudi-Arabia' ? 'Saudi Arabia' : name; }

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

  /* ---------- Poisson engine (Dixon-Coles corrected) ---------- */
  var DC_RHO = -0.13;   // low-score dependency parameter
  var DC_XI  = 0.003;   // time-decay per day (for future parameter fitting)

  function factorial(n) { var f = 1; for (var i = 2; i <= n; i++) f *= i; return f; }
  function poissonPmf(k, lambda) { return Math.pow(lambda, k) * Math.exp(-lambda) / factorial(k); }

  // Dixon-Coles tau correction for low scorelines
  function dcTau(x, y, lambda, mu, rho) {
    if (x === 0 && y === 0) return 1.0 - (lambda * mu * rho);
    if (x === 0 && y === 1) return 1.0 + (lambda * rho);
    if (x === 1 && y === 0) return 1.0 + (mu * rho);
    if (x === 1 && y === 1) return 1.0 - rho;
    return 1.0; // x >= 2 or y >= 2
  }

  // Exponential time-decay weight (for future parameter fitting from historical matches)
  // days = days elapsed since match; xi = decay rate per day
  function dcTimeWeight(days, xi) { return Math.exp(-xi * days); }

  function lambdas(home, away) {
    var h = teamRating(home) || { att: 1, def: 1 };
    var a = teamRating(away) || { att: 1, def: 1 };
    var base = ((DATA.leagueAvgGoalsByLeague || {})[h.league] || LEAGUE_AVG) / 2;
    var lh = h.att * a.def * base * HOME_ADV;
    var la = a.att * h.def * base;
    return { lh: clamp(lh, 0.15, 6), la: clamp(la, 0.15, 6) };
  }

  function predictPoisson(home, away) {
    var L = lambdas(home, away), N = 7, rho = DC_RHO;
    var pH = 0, pD = 0, pA = 0, pOver = 0, total = 0;
    // Track the most likely exact scoreline WITHIN each outcome bucket, so the
    // displayed "predicted score" matches the 1X2 tip instead of always
    // collapsing onto the global mode (which is 1-1 for most balanced games).
    var bHp = 0, bHh = 1, bHa = 0;   // best home-win score
    var bDp = 0, bDh = 1, bDa = 1;   // best draw score
    var bAp = 0, bAh = 0, bAa = 1;   // best away-win score
    for (var i = 0; i <= N; i++) {
      for (var j = 0; j <= N; j++) {
        var p = dcTau(i, j, L.lh, L.la, rho) * poissonPmf(i, L.lh) * poissonPmf(j, L.la);
        // tau can push (0,0) slightly negative for large rho*lambda*mu — clamp to 0
        if (p < 0) p = 0;
        total += p;
        if (i > j) { pH += p; if (p > bHp) { bHp = p; bHh = i; bHa = j; } }
        else if (i === j) { pD += p; if (p > bDp) { bDp = p; bDh = i; bDa = j; } }
        else { pA += p; if (p > bAp) { bAp = p; bAh = i; bAa = j; } }
        if (i + j > 2) pOver += p;
      }
    }
    // Normalize so all outcome probabilities sum strictly to 1.0
    if (total > 0) { pH /= total; pD /= total; pA /= total; pOver /= total; }
    // Pick the predicted scoreline from the most likely outcome's bucket.
    var bh, ba;
    if (pH >= pD && pH >= pA) { bh = bHh; ba = bHa; }
    else if (pA >= pH && pA >= pD) { bh = bAh; ba = bAa; }
    else { bh = bDh; ba = bDa; }
    return {
      pHome: pH, pDraw: pD, pAway: pA,
      scoreH: bh, scoreA: ba,
      expH: L.lh, expA: L.la, expTotal: L.lh + L.la,
      pOver: clamp(pOver, 0.02, 0.98)
    };
  }
  /* ---------- KPI stats (computed from HISTORY) ---------- */
  var _statsCache = null;
  var _statsLeague = null;
  function buildStats() {
    if (_statsCache && _statsLeague === activeLeague) return _statsCache;
    _statsLeague = activeLeague;
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
      if (activeLeague && m.league !== activeLeague) return;
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
    var ids = [teamRating(home) && teamRating(home).id, teamRating(away) && teamRating(away).id].sort(function(a,b){return a-b;}).join('-');
    var rows = (DATA.demo === false ? ((DATA.h2h || {})[ids] || []) : HISTORY).filter(function (m) {
      return (m.home === home && m.away === away) || (m.home === away && m.away === home);
    }).sort(function (x, y) { return x.date < y.date ? 1 : -1; });
    var hp = 0, ap = 0;
    rows.forEach(function (m) {
      var hs = m.home === home ? m.fh : m.fa, as = m.home === home ? m.fa : m.fh;
      if (hs > as) hp += 3; else if (hs < as) ap += 3; else { hp++; ap++; }
    });
    return { rows: rows, hp: hp, ap: ap, n: rows.length };
  }

  /* ---------- KPI engine: user-specified weights (sum = 1) ---------- */
  var KPI_WEIGHTS = {
    overallWin: 0.10, venueWin: 0.125, recent6: 0.10,
    venueRecent6: 0.055, h2h: 0.035, net: 0.035,
    overallAGF: 0.11, overallAGA: 0.15,
    venueAGF: 0.13, venueAGA: 0.16
  };
  function kpiComponents(stat, venue, dominance) {
    function norm(x, lo, hi) { return clamp((x - lo) / (hi - lo), 0, 1); }
    function form(games) {
      if (!games.length) return 0.5;
      return games.reduce(function (total, g) {
        return total + (g.res === 'W' ? 3 : g.res === 'D' ? 1 : 0);
      }, 0) / (3 * games.length);
    }
    var games = stat ? (venue === 'H' ? stat.raw.hGames : stat.raw.aGames) : [];
    function venueAverage(key) {
      if (!games.length) return null;
      return games.reduce(function (total, g) { return total + g[key]; }, 0) / games.length;
    }
    var venueGF = venueAverage('gf'), venueGA = venueAverage('ga');
    return {
      overallWin: stat ? stat.winRate : 0.5,
      venueWin: games.length ? games.filter(function (g) { return g.res === 'W'; }).length / games.length : 0.5,
      recent6: form(stat ? stat.recent6 : []),
      venueRecent6: form(games.slice(-6)),
      h2h: dominance,
      net: stat ? norm(stat.net, -2, 2) : 0.5,
      overallAGF: stat ? norm(stat.aGF, 0, 4) : 0.5,
      overallAGA: stat ? 1 - norm(stat.aGA, 0, 4) : 0.5,
      venueAGF: venueGF === null ? 0.5 : norm(venueGF, 0, 4),
      venueAGA: venueGA === null ? 0.5 : 1 - norm(venueGA, 0, 4)
    };
  }
  function kpiConfidence(components) {
    return Object.keys(KPI_WEIGHTS).reduce(function (total, key) {
      return total + KPI_WEIGHTS[key] * components[key];
    }, 0);
  }
  function predictKpi(home, away) {
    var model = predictPoisson(home, away); // unchanged score and expected-goals model
    var hs = teamStat(home), as = teamStat(away), hh = h2h(home, away);
    var h2hTot = hh.hp + hh.ap;
    var hH2H = h2hTot ? hh.hp / h2hTot : 0.5;
    var aH2H = h2hTot ? hh.ap / h2hTot : 0.5;
    var hComponents = kpiComponents(hs, 'H', hH2H);
    var aComponents = kpiComponents(as, 'A', aH2H);
    var hConf = kpiConfidence(hComponents), aConf = kpiConfidence(aComponents);
    // Venue inputs already capture home/away strength; no extra unweighted home bump.
    var closeness = 1 - clamp(Math.abs(hConf - aConf) / 0.5, 0, 1);
    var pDraw = clamp(0.08 + (0.34 - 0.08) * closeness, 0.08, 0.34);
    var rem = 1 - pDraw, tot = hConf + aConf;
    var pHome = rem * (tot > 0 ? hConf / tot : 0.5);
    var pAway = rem * (tot > 0 ? aConf / tot : 0.5);
    // Over/Under KPI confidence: .45 Poisson + .35 historical over-rate + .20 expected-goals factor
    var histOver = ((hs ? hs.overRate : 0.5) + (as ? as.overRate : 0.5)) / 2;
    var expFactor = clamp(model.expTotal / 4, 0, 1);
    var pOver = clamp(0.45 * model.pOver + 0.35 * histOver + 0.20 * expFactor, 0.02, 0.98);
    return {
      pHome: pHome, pDraw: pDraw, pAway: pAway,
      scoreH: model.scoreH, scoreA: model.scoreA,
      expH: model.expH, expA: model.expA, expTotal: model.expTotal,
      pOver: pOver,
      _kpi: {
        version: 'kpi-v2-user-weights', weights: KPI_WEIGHTS,
        hConf: hConf, aConf: aConf, hH2H: hH2H, aH2H: aH2H, h2hN: hh.n,
        homeComponents: hComponents, awayComponents: aComponents
      }
    };
  }

  function predict(home, away, league) {
    activeLeague = league || null;
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
    country: 'all',
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
  var REAL_TODAY = DATA.today || isoDate(new Date());
  /* "Today" is the real date when the data has fixtures within 2 days of it;
     otherwise (static demo data) it is the first fixture day, so the page is never empty. */
  var REF = DATA.demo === false ? REAL_TODAY : (function () {
    var days = FIXTURES.map(dayOf).sort(), near = [];
    for (var i = -2; i <= 2; i++) near.push(addDays(REAL_TODAY, i));
    if (days.some(function (d) { return near.indexOf(d) !== -1; })) return REAL_TODAY;
    return days[0] || REAL_TODAY;
  })();
  // Reference "today" string used for hero counters and the Today day-pill.
  // (Was referenced by init() but never defined, which threw a ReferenceError
  //  and aborted init() before any buttons/menus/tabs got their click handlers.)
  function todayStr() { return REF; }
  function weekendRange() {
    var dow = parseDay(REF).getDay();            // 0 Sun .. 6 Sat
    // Always the UPCOMING weekend, never the one that has already passed:
    //   Mon–Fri -> this week's coming Saturday;
    //   Saturday -> today (Sat) + tomorrow (Sun);
    //   Sunday   -> NEXT week's Saturday (this weekend's Saturday is already over).
    var sat = dow === 6 ? REF : (dow === 0 ? addDays(REF, 6) : addDays(REF, 6 - dow));
    return [sat, addDays(sat, 1)];
  }
  function allRange() {
    var days = FIXTURES.map(dayOf).sort();
    return [days[0] || REF, days[days.length - 1] || REF];
  }
  function isLive(f) {
    if (f.status) return f.live === true;
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
  function setPeriod(period) { state.period = period; state.day = null; renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 }
  function setDay(d) {
    if (d === REF) { setPeriod('today'); return; }
    if (d === addDays(REF, 1)) { setPeriod('tomorrow'); return; }
    if (d === addDays(REF, -1)) { setPeriod('yesterday'); return; }
    state.period = 'day'; state.day = d; renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }

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
    if (dr) dr.textContent = (r[0] === r[1] || showDay(r[0]) === showDay(r[1])) ? showDay(r[0]) : showDay(r[0]) + ' - ' + showDay(r[1]);
    var counts = { today: 0, live: 0, tomorrow: 0, weekend: 0, yesterday: 0, all: 0 };
    FIXTURES.forEach(function (f) {
      var p = (state.engine === 'poisson' && f.prediction ? f.prediction : predict(f.home, f.away, f.league));
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
    '1x2': '<tr><th class="col-pick">Pick</th><th class="col-date">Date</th><th class="col-league">League</th>'
      + '<th class="col-match">Match</th><th class="col-live">Result/Live</th><th>1</th><th>X</th><th>2</th><th>Tip</th><th>Score</th><th title="Decimal bookmaker odds for the displayed tip">Coef.</th></tr>',
    'ou': '<tr><th class="col-pick">Pick</th><th class="col-date">Date</th><th class="col-league">League</th>'
      + '<th class="col-match">Match</th><th class="col-live">Result/Live</th><th>Exp. goals</th><th>Over 2.5</th><th>Under 2.5</th><th>Tip</th><th title="Decimal bookmaker odds for the displayed tip">Coef.</th></tr>',
    'stats': '<tr><th>Date</th><th class="col-league">League</th><th class="col-match">Match</th>'
      + '<th>Exp. H</th><th>Exp. A</th><th>Exp. total</th><th>Score</th><th>Over 2.5</th></tr>',
    'selection': '<tr><th class="col-date">Date</th><th class="col-league">League</th><th class="col-match">Match</th>'
      + '<th class="col-prob">Probabilities</th><th>Tip</th><th>Score</th><th></th></tr>'
  };

  function adRowHtml(cols) {
    return '<tr class="ad-row"><td colspan="' + cols + '" style="padding:0">'
      + '<div class="ad-slot ad-inline" data-ad-placement="inTable" style="margin:0;border-radius:0;border-left:0;border-right:0" aria-label="Advertisement">'
      + '<span class="ad-body">Your banner here<span class="ad-size">Leaderboard 728×90</span></span></div></td></tr>';
  }

  function fmtDate(d) {
    if (!d) return '<span class="date-cell"><b>—</b></span>';
    var str = String(d);
    var dateObj = null;

    if (userSettings.timezone !== 'default') {
      try {
        var isoStr = str.replace(' ', 'T') + 'Z';
        var parsed = new Date(isoStr);
        if (!isNaN(parsed.getTime())) {
          var tzOpt = userSettings.timezone === 'local' ? undefined : userSettings.timezone;
          var dFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', timeZone: tzOpt });
          var tFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tzOpt });
          var datePart = dFmt.format(parsed);
          var timePart = tFmt.format(parsed);
          return '<span class="date-cell"><b>' + esc(datePart) + '</b><span class="time">' + esc(timePart) + '</span></span>';
        }
      } catch (e) {}
    }

    var parts = str.split(' ');
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
      + '<span class="mc-meta"><span class="mc-date">' + fmtDate(f.date) + '</span></span>'
      + '<span class="mc-league">' + esc(f.league) + '</span></div>';
  }
  // Result / Live cell: final score for finished games, live score + clock for
  // in-play games, and a neutral dash for matches that have not kicked off.
  function resultLiveCell(f) {
    var hasScore = f && f.currentHome != null && f.currentAway != null;
    if (f && f.live && hasScore) {
      var el = f.elapsed != null ? ' ' + esc(f.elapsed) + "'" : '';
      return '<span class="rl rl-live"><span class="rl-score">' + esc(f.currentHome) + '\u2013' + esc(f.currentAway) + '</span>'
        + '<span class="rl-clk">' + (f.status ? esc(f.status) : 'LIVE') + el + '</span></span>';
    }
    if (f && f.status && f.status !== 'NS' && hasScore) {
      return '<span class="rl rl-final"><span class="rl-score">' + esc(f.currentHome) + '\u2013' + esc(f.currentAway) + '</span>'
        + '<span class="rl-clk">' + esc(f.status) + '</span></span>';
    }
    return '<span class="rl rl-pending">\u2013</span>';
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

  /* Decimal bookmaker odds: separate from the model probability. */
  var selectedBookmaker = String((DATA.oddsConfig || {}).defaultBookmaker || 'best');
  function oddsQuote(f, market, outcome) {
    if (f.status !== 'NS' || !f.odds || Date.parse(f.kickoffUtc) <= Date.now()) return null;
    var maxAge = Number((DATA.oddsConfig || {}).maxDisplayAgeHours || 24) * 3600000;
    var fetched = Date.parse(f.odds.fetchedAt), updated = Date.parse(f.odds.providerUpdatedAt || f.odds.fetchedAt);
    if (!isFinite(fetched) || !isFinite(updated) || Date.now()-fetched > maxAge || Date.now()-updated > maxAge) return null;
    var best = null;
    (f.odds.bookmakers || []).forEach(function (b) {
      if (selectedBookmaker !== 'best' && String(b.id) !== selectedBookmaker) return;
      var value = Number(((b.markets || {})[market] || {})[outcome]);
      if (isFinite(value) && value > 1 && (!best || value > best.value)) best = {value:value, name:b.name, updated:f.odds.providerUpdatedAt || f.odds.fetchedAt, cached:f.odds.cached};
    });
    return best;
  }
  
  var userSettings = {
    timezone: localStorage.getItem('pb_tz') || 'default',
    oddsFormat: localStorage.getItem('pb_odds_fmt') || 'decimal'
  };

  function decToFractional(dec) {
    if (!dec || dec <= 1) return '—';
    var val = dec - 1;
    var bestN = 1, bestD = 1, minDiff = 999;
    for (var d = 1; d <= 20; d++) {
      var n = Math.round(val * d);
      var diff = Math.abs(val - (n / d));
      if (diff < minDiff) {
        minDiff = diff;
        bestN = n;
        bestD = d;
      }
    }
    return bestN + '/' + bestD;
  }

  function decToAmerican(dec) {
    if (!dec || dec <= 1) return '—';
    if (dec >= 2.0) {
      return '+' + Math.round((dec - 1) * 100);
    } else {
      return '-' + Math.round(100 / (dec - 1));
    }
  }

  function formatOddsVal(dec) {
    if (dec == null || isNaN(dec) || dec <= 0) return '—';
    var fmt = userSettings.oddsFormat;
    if (fmt === 'fractional') return decToFractional(dec);
    if (fmt === 'american') return decToAmerican(dec);
    if (fmt === 'prob') return (100 / dec).toFixed(1) + '%';
    return Number(dec).toFixed(2);
  }

  function oddsCell(f, market, tip) {
    var q = oddsQuote(f, market, tip);
    if (!q) return '<td class="col-odds"><span class="odds-missing" title="No recent pre-match odds available from the selected bookmaker">—</span></td>';
    var title = 'Decimal market odds for the tip. ' + q.name + '. Provider update: ' + q.updated + '. Implied probability: ' + (100/q.value).toFixed(1) + '% (includes bookmaker margin). ' + (q.cached ? 'Cached quote. ' : '') + 'Not a guaranteed result.';
    var keys = market === '1x2' ? ['1','X','2'] : ['over','under'];
    var detail = keys.map(function (key) {
      var x = oddsQuote(f, market, key), label = key === 'over' ? 'Over 2.5' : key === 'under' ? 'Under 2.5' : key;
      return '<span>' + label + ': <b>' + (x ? x.value.toFixed(2) : '—') + '</b>' + (x ? ' · ' + esc(x.name) : '') + '</span>';
    }).join('');
    return '<td class="col-odds"><span class="odds-badge" title="' + esc(title) + '">' + q.value.toFixed(2) + '</span><small class="odds-book">' + esc(q.name) + '</small><details class="odds-detail"><summary>Market odds</summary>' + detail + '<small>Updated: ' + esc(q.updated) + '</small></details></td>';
  }
  function initBookmakers() {
    var el = $('#bookmakerFilter'); if (!el) return;
    var names = {};
    FIXTURES.forEach(function (f) { ((f.odds || {}).bookmakers || []).forEach(function (b) { names[String(b.id)] = b.name; }); });
    el.innerHTML = '<option value="best">Best available odds</option>' + Object.keys(names).sort(function (a,b) { return names[a].localeCompare(names[b]); }).map(function (id) { return '<option value="' + esc(id) + '">' + esc(names[id]) + '</option>'; }).join('');
    if (selectedBookmaker !== 'best' && !names[selectedBookmaker]) selectedBookmaker = 'best';
    el.value = selectedBookmaker;
    el.addEventListener('change', function () { selectedBookmaker = el.value; renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 });
  }

  /* ---------- row builders per mode ---------- */
  function row1x2(f, p) {
    var best = bestKey(p), k = fxKey(f), checked = state.selection[k] ? ' checked' : '';
    return '<tr>'
      + '<td class="col-pick"><input type="checkbox" class="pick-cb" data-key="' + esc(k) + '"' + checked + ' aria-label="Add to selection"></td>'
      + '<td class="col-date">' + fmtDate(f.date) + '</td>'
      + '<td class="col-league">' + renderLeagueBadge(f) + '</td>'
      + '<td class="col-match">' + matchCell(f) + '</td>'
      + '<td class="col-live">' + resultLiveCell(f) + '</td>'
      + '<td>' + probCell(p.pHome, '1', best) + '</td>'
      + '<td>' + probCell(p.pDraw, 'X', best) + '</td>'
      + '<td>' + probCell(p.pAway, '2', best) + '</td>'
      + '<td>' + tipBadge(best) + '</td>'
      + '<td><span class="score">' + p.scoreH + '-' + p.scoreA + '</span></td>'
      + oddsCell(f, '1x2', best)
      + '</tr>';
  }
  function rowOu(f, p) {
    var over = p.pOver, under = 1 - over, k = fxKey(f), checked = state.selection[k] ? ' checked' : '';
    var tip = over >= 0.5 ? 'over' : 'under';
    return '<tr>'
      + '<td class="col-pick"><input type="checkbox" class="pick-cb" data-key="' + esc(k) + '"' + checked + ' aria-label="Add to selection"></td>'
      + '<td class="col-date">' + fmtDate(f.date) + '</td>'
      + '<td class="col-league">' + renderLeagueBadge(f) + '</td>'
      + '<td class="col-match">' + matchCell(f) + '</td>'
      + '<td class="col-live">' + resultLiveCell(f) + '</td>'
      + '<td><span class="score">' + p.expTotal.toFixed(2) + '</span></td>'
      + '<td><span class="ou over">' + pct(over) + '%</span></td>'
      + '<td><span class="ou under">' + pct(under) + '%</span></td>'
      + '<td><span class="ou ' + tip + '">' + (tip === 'over' ? 'Over 2.5' : 'Under 2.5') + '</span></td>'
      + oddsCell(f, 'ou', tip)
      + '</tr>';
  }
  function rowStats(f, p, idx) {
    return '<tr class="stats-row" data-idx="' + idx + '" tabindex="0" aria-expanded="false">'
      + '<td class="col-date">' + fmtDate(f.date) + '</td>'
      + '<td class="col-league">' + renderLeagueBadge(f) + '</td>'
      + '<td class="col-match"><span class="exp-caret">&#9662;</span><span class="sr-match">' + esc(f.home) + ' v ' + esc(f.away) + '</span></td>'
      + '<td><span class="sr-num">' + p.expH.toFixed(2) + '</span></td>'
      + '<td><span class="sr-num">' + p.expA.toFixed(2) + '</span></td>'
      + '<td><span class="sr-num sr-tot">' + p.expTotal.toFixed(2) + '</span></td>'
      + '<td><span class="score">' + p.scoreH + ':' + p.scoreA + '</span></td>'
      + '<td><span class="ou over">' + pct(p.pOver) + '%</span></td>'
      + '</tr>';
  }
  /* ---------- Stats detail panel ----------
     Season tables, last-6 form, home/away form and head-to-head, all computed
     in the browser from DATA.matches (falls back to DATA.history). */
  var MATCHES = (DATA.matches && DATA.matches.length ? DATA.matches : HISTORY).slice()
    .sort(function (x, y) { return x.date < y.date ? -1 : (x.date > y.date ? 1 : 0); });
  var CODES = {
    'Man City': 'MCI', 'Arsenal': 'ARS', 'Liverpool': 'LIV', 'Tottenham': 'TOT', 'Chelsea': 'CHE',
    'Man United': 'MUN', 'Brighton': 'BHA', 'Everton': 'EVE', 'Burnley': 'BUR', 'Sheffield Utd': 'SHU',
    'Real Madrid': 'RMA', 'Barcelona': 'BAR', 'Atletico': 'ATM', 'Girona': 'GIR', 'Sevilla': 'SEV',
    'Getafe': 'GET', 'Cadiz': 'CAD', 'Almeria': 'ALM', 'Inter': 'INT', 'Juventus': 'JUV',
    'Milan': 'MIL', 'Napoli': 'NAP', 'Roma': 'ROM', 'Lazio': 'LAZ', 'Salernitana': 'SAL', 'Empoli': 'EMP'
  };
  function teamCode(t) {
    return CODES[t] || String(t).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  }
  
  /* ---------- Compact League & Country Badging ---------- */
  var COUNTRY_DATA = {
    'England': { iso: 'gb-eng', code: 'En', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', icon: 'GB' },
    'Spain': { iso: 'es', code: 'Es', flag: '🇪🇸', icon: 'ES' },
    'Italy': { iso: 'it', code: 'It', flag: '🇮🇹', icon: 'IT' },
    'Germany': { iso: 'de', code: 'De', flag: '🇩🇪', icon: 'DE' },
    'France': { iso: 'fr', code: 'Fr', flag: '🇫🇷', icon: 'FR' },
    'Netherlands': { iso: 'nl', code: 'Nl', flag: '🇳🇱', icon: 'NL' },
    'Portugal': { iso: 'pt', code: 'Pt', flag: '🇵🇹', icon: 'PT' },
    'Argentina': { iso: 'ar', code: 'Ar', flag: '🇦🇷', icon: 'AR' },
    'Australia': { iso: 'au', code: 'Au', flag: '🇦🇺', icon: 'AU' },
    'Austria': { iso: 'at', code: 'At', flag: '🇦🇹', icon: 'AT' },
    'Belarus': { iso: 'by', code: 'By', flag: '🇧🇾', icon: 'BY' },
    'Belgium': { iso: 'be', code: 'Be', flag: '🇧🇪', icon: 'BE' },
    'Brazil': { iso: 'br', code: 'Br', flag: '🇧🇷', icon: 'BR' },
    'Bulgaria': { iso: 'bg', code: 'Bg', flag: '🇧🇬', icon: 'BG' },
    'Canada': { iso: 'ca', code: 'Ca', flag: '🇨🇦', icon: 'CA' },
    'Chile': { iso: 'cl', code: 'Cl', flag: '🇨🇱', icon: 'CL' },
    'China': { iso: 'cn', code: 'Cn', flag: '🇨🇳', icon: 'CN' },
    'Croatia': { iso: 'hr', code: 'Hr', flag: '🇭🇷', icon: 'HR' },
    'Cyprus': { iso: 'cy', code: 'Cy', flag: '🇨🇾', icon: 'CY' },
    'Czech-Republic': { iso: 'cz', code: 'Cz', flag: '🇨🇿', icon: 'CZ' },
    'Denmark': { iso: 'dk', code: 'Dk', flag: '🇩🇰', icon: 'DK' },
    'Estonia': { iso: 'ee', code: 'Ee', flag: '🇪🇪', icon: 'EE' },
    'Finland': { iso: 'fi', code: 'Fi', flag: '🇫🇮', icon: 'FI' },
    'Greece': { iso: 'gr', code: 'Gr', flag: '🇬🇷', icon: 'GR' },
    'Hungary': { iso: 'hu', code: 'Hu', flag: '🇭🇺', icon: 'HU' },
    'Iceland': { iso: 'is', code: 'Is', flag: '🇮🇸', icon: 'IS' },
    'Ireland': { iso: 'ie', code: 'Ie', flag: '🇮🇪', icon: 'IE' },
    'Israel': { iso: 'il', code: 'Il', flag: '🇮🇱', icon: 'IL' },
    'Japan': { iso: 'jp', code: 'Jp', flag: '🇯🇵', icon: 'JP' },
    'Mexico': { iso: 'mx', code: 'Mx', flag: '🇲🇽', icon: 'MX' },
    'Norway': { iso: 'no', code: 'No', flag: '🇳🇴', icon: 'NO' },
    'Poland': { iso: 'pl', code: 'Pl', flag: '🇵🇱', icon: 'PL' },
    'Romania': { iso: 'ro', code: 'Ro', flag: '🇷🇴', icon: 'RO' },
    'Russia': { iso: 'ru', code: 'Ru', flag: '🇷🇺', icon: 'RU' },
    'Saudi-Arabia': { iso: 'sa', code: 'Sa', flag: '🇸🇦', icon: 'SA' },
    'Scotland': { iso: 'gb-sct', code: 'Sc', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', icon: 'SC' },
    'Serbia': { iso: 'rs', code: 'Rs', flag: '🇷🇸', icon: 'RS' },
    'Slovakia': { iso: 'sk', code: 'Sk', flag: '🇸🇰', icon: 'SK' },
    'Slovenia': { iso: 'si', code: 'Si', flag: '🇸🇮', icon: 'SI' },
    'South-Korea': { iso: 'kr', code: 'Kr', flag: '🇰🇷', icon: 'KR' },
    'Sweden': { iso: 'se', code: 'Se', flag: '🇸🇪', icon: 'SE' },
    'Switzerland': { iso: 'ch', code: 'Ch', flag: '🇨🇭', icon: 'CH' },
    'Turkey': { iso: 'tr', code: 'Tr', flag: '🇹🇷', icon: 'TR' },
    'Ukraine': { iso: 'ua', code: 'Ua', flag: '🇺🇦', icon: 'UA' },
    'Uruguay': { iso: 'uy', code: 'Uy', flag: '🇺🇾', icon: 'UY' },
    'USA': { iso: 'us', code: 'Us', flag: '🇺🇸', icon: 'US' },
    'Wales': { iso: 'gb-wls', code: 'Wa', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', icon: 'WA' }
  };

  function getLeagueShortCode(leagueName, countryName) {
    var raw = String(leagueName || '').trim();
    var cInfo = COUNTRY_DATA[countryName] || {};
    var prefix = cInfo.code || (countryName ? countryName.slice(0, 2).toUpperCase() : '');

    // Known specific league mappings
    var l = raw.toLowerCase();
    if (l.indexOf('premier league') !== -1 || l.indexOf('serie a') !== -1 || l.indexOf('la liga') !== -1 || l.indexOf('ligue 1') !== -1 || l.indexOf('bundesliga') !== -1 || l.indexOf('super lig') !== -1 || l.indexOf('super liga') !== -1 || l.indexOf('superliga') !== -1 || l.indexOf('eliteserien') !== -1 || l.indexOf('ekstraklasa') !== -1 || l.indexOf('eredivisie') !== -1 || l.indexOf('primeira liga') !== -1 || l.indexOf('hnl') !== -1 || l.indexOf('pro league') !== -1 || l.indexOf('first league') !== -1 || l.indexOf('1. division') !== -1 || l.indexOf('liga i') !== -1 || l.indexOf('liga profesional') !== -1) {
      if (l.indexOf('women') !== -1 || l.indexOf('feminine') !== -1) return (prefix || 'L') + 'W';
      if (l.indexOf('2. bundesliga') !== -1 || l.indexOf('bundesliga 2') !== -1) return (prefix || 'De') + '2';
      return (prefix || 'L') + '1';
    }
    if (l.indexOf('championship') !== -1 || l.indexOf('serie b') !== -1 || l.indexOf('ligue 2') !== -1 || l.indexOf('segunda') !== -1 || l.indexOf('2. liga') !== -1 || l.indexOf('first nl') !== -1 || l.indexOf('second league') !== -1 || l.indexOf('liga ii') !== -1 || l.indexOf('primera nacional') !== -1 || l.indexOf('challenge league') !== -1 || l.indexOf('i liga') !== -1) {
      return (prefix || 'L') + '2';
    }
    if (l.indexOf('league one') !== -1 || l.indexOf('serie c') !== -1 || l.indexOf('ligue 3') !== -1 || l.indexOf('3. liga') !== -1 || l.indexOf('second nl') !== -1 || l.indexOf('ii liga') !== -1 || l.indexOf('primera b') !== -1) {
      return (prefix || 'L') + '3';
    }
    if (l.indexOf('league two') !== -1 || l.indexOf('serie d') !== -1 || l.indexOf('national league') !== -1 || l.indexOf('third nl') !== -1 || l.indexOf('iii liga') !== -1 || l.indexOf('primera c') !== -1) {
      return (prefix || 'L') + '4';
    }
    if (l.indexOf('cup') !== -1 || l.indexOf('copa') !== -1 || l.indexOf('pokal') !== -1 || l.indexOf('kupas') !== -1) {
      return (prefix || 'C') + 'C';
    }
    if (l.indexOf('women') !== -1 || l.indexOf('feminin') !== -1 || l.indexOf('nwsl') !== -1) {
      return (prefix || 'W') + 'W';
    }

    // Default short code: prefix + number or first initials
    var numMatch = raw.match(/\b([1-4])\b/);
    if (numMatch) return (prefix || 'D') + numMatch[1];
    var words = raw.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (prefix ? prefix.charAt(0) : words[0].charAt(0)) + words[0].charAt(0).toUpperCase() + words[1].charAt(0).toUpperCase();
    return (prefix || '') + raw.slice(0, 2).toUpperCase();
  }

  function renderLeagueBadge(f) {
    if (!f) return '';
    var leagueName = typeof f === 'string' ? f : (f.league || '');
    var countryName = (typeof f === 'object' && f.country) ? f.country : '';

    // If country is not on fixture, try to deduce from CATALOG or string
    if (!countryName && leagueName.indexOf(' · ') !== -1) {
      var parts = leagueName.split(' · ');
      leagueName = parts[0].trim();
      countryName = parts[1].trim();
    }
    if (!countryName && typeof CATALOG !== 'undefined' && CATALOG.length) {
      for (var i = 0; i < CATALOG.length; i++) {
        if (CATALOG[i].name === leagueName && CATALOG[i].country) {
          countryName = CATALOG[i].country;
          break;
        }
      }
    }

    var cInfo = COUNTRY_DATA[countryName] || {};
    var flag = cInfo.flag || '⚽';
    var shortCode = getLeagueShortCode(leagueName, countryName);
    var fullName = leagueName + (countryName ? ' · ' + countryLabel(countryName) : '');

    return '<div class="league-badge" title="' + esc(fullName) + '">'
      + '<span class="lb-flag" aria-hidden="true">' + flag + '</span>'
      + '<span class="lb-code">' + esc(shortCode) + '</span>'
      + '</div>';
  }

function leagueCode(l) {
    var w = String(l).split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0].charAt(0) + w[1].charAt(0) : String(l).slice(0, 2)).toUpperCase();
  }
  function fmtFull(d) { return String(d).slice(0, 10).split('-').reverse().join('/'); }

  var _seasonStart = null;
  function seasonStart() {
    if (_seasonStart) return _seasonStart;
    var last = MATCHES.length ? MATCHES[MATCHES.length - 1].date : '';
    var y = parseInt(last.slice(0, 4), 10), mo = parseInt(last.slice(5, 7), 10);
    if (!y) { _seasonStart = '0000-00-00'; return _seasonStart; }
    _seasonStart = (mo < 7 ? y - 1 : y) + '-07-01';
    return _seasonStart;
  }

  /* one team's games, oldest first. venue: 'H' | 'A' */
  function teamGames(team, season) {
    var from = season ? seasonStart() : '';
    var out = [];
    MATCHES.forEach(function (m) {
      if (m.home !== team && m.away !== team) return;
      if (DATA.demo === false && season) {
        var lg = activeLeague || (TEAMS[team] && TEAMS[team].league);
        if (m.league !== lg || m.season !== (DATA.seasons || {})[lg]) return;
      } else if (from && m.date < from) return;
      var home = m.home === team;
      var gf = home ? m.fh : m.fa, ga = home ? m.fa : m.fh;
      out.push({ m: m, venue: home ? 'H' : 'A', gf: gf, ga: ga,
        res: gf > ga ? 'W' : (gf < ga ? 'L' : 'D') });
    });
    return out;
  }
  function aggregate(games) {
    var s = { p: games.length, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, over: 0 };
    games.forEach(function (g) {
      if (g.res === 'W') { s.w++; s.pts += 3; } else if (g.res === 'D') { s.d++; s.pts++; } else s.l++;
      s.gf += g.gf; s.ga += g.ga;
      if (g.gf + g.ga > 2.5) s.over++;
    });
    var last8 = games.slice(-8);
    s.overTotal = s.p ? Math.round(100 * s.over / s.p) : null;
    s.overLast8 = last8.length ? Math.round(100 * last8.filter(function (g) { return g.gf + g.ga > 2.5; }).length / last8.length) : null;
    return s;
  }
  var _rankCache = {};
  function leagueRank(team, league) {
    if (DATA.demo === false) return ((DATA.standings || {})[league] || {})[team] || null;
    if (!_rankCache[league]) {
      var tbl = {};
      MATCHES.forEach(function (m) {
        if (m.league !== league || m.date < seasonStart()) return;
        [[m.home, m.fh, m.fa], [m.away, m.fa, m.fh]].forEach(function (x) {
          var r = tbl[x[0]] || (tbl[x[0]] = { t: x[0], pts: 0, gd: 0, gf: 0 });
          r.pts += x[1] > x[2] ? 3 : (x[1] === x[2] ? 1 : 0); r.gd += x[1] - x[2]; r.gf += x[1];
        });
      });
      var arr = Object.keys(tbl).map(function (k) { return tbl[k]; }).sort(function (a, b) {
        return (b.pts - a.pts) || (b.gd - a.gd) || (b.gf - a.gf);
      });
      var map = {};
      arr.forEach(function (r, i) { map[r.t] = i + 1; });
      _rankCache[league] = map;
    }
    return _rankCache[league][team] || null;
  }

  function dash(v, suffix) { return v == null ? '–' : v + (suffix || ''); }
  function per(n, d) { return d ? Math.round(100 * n / d) : 0; }
  function avg(n, d) { return d ? (n / d) : 0; }

  function statRow(team, league, games, tag) {
    var s = aggregate(games), rk = leagueRank(team, league);
    var agf = avg(s.gf, s.p), aga = avg(s.ga, s.p);
    return '<tr><td class="sp-team">' + (rk ? '<span class="sp-rank">' + rk + '</span>' : '')
      + '<span class="sp-name">' + esc(team) + '</span>' + (tag ? '<span class="sp-tag">' + tag + '</span>' : '') + '</td>'
      + '<td><span class="sp-p">' + s.p + '</span></td><td>' + s.w + '</td><td>' + s.d + '</td><td>' + s.l + '</td>'
      + '<td>' + s.gf + '</td><td>' + s.ga + '</td>'
      + '<td>' + per(s.w, s.p) + '</td><td>' + per(s.d, s.p) + '</td><td>' + per(s.l, s.p) + '</td>'
      + '<td class="sp-agf">' + agf.toFixed(2) + '</td><td class="sp-aga">' + aga.toFixed(2) + '</td>'
      + '<td>' + (agf + aga).toFixed(2) + '</td><td class="sp-ppg">' + avg(s.pts, s.p).toFixed(2) + '</td>'
      + '<td class="sp-ov sp-ov-l">' + dash(s.overTotal, '%') + '</td><td class="sp-ov">' + dash(s.overLast8, '%') + '</td></tr>';
  }
  function statTable(title, rowsHtml) {
    return '<h3 class="sp-title">' + title + '</h3><div class="sp-scroll"><table class="sp-table"><thead>'
      + '<tr><th rowspan="2" class="sp-th-team">Team</th><th rowspan="2">P</th><th rowspan="2">W</th><th rowspan="2">D</th>'
      + '<th rowspan="2">L</th><th rowspan="2">GF</th><th rowspan="2">GA</th><th rowspan="2">W%</th><th rowspan="2">D%</th>'
      + '<th rowspan="2">L%</th><th rowspan="2">AGF</th><th rowspan="2">AGA</th><th rowspan="2">AG+</th><th rowspan="2">APPG</th>'
      + '<th colspan="2" class="sp-th-ov">Over 2.5</th></tr>'
      + '<tr><th class="sp-th-ov2 sp-ov-l">Total</th><th class="sp-th-ov2">Last 8</th></tr>'
      + '</thead><tbody>' + rowsHtml + '</tbody></table></div>';
  }

  /* one match line: date | HOME score (ht) AWAY | league tag */
  function matchLine(m, focus, showLg) {
    var hw = m.fh > m.fa, aw = m.fh < m.fa;
    var hb = focus ? (m.home === focus) : hw, ab = focus ? (m.away === focus) : aw;
    var ht = m.ht && m.ht.length === 2 ? '<i>(' + m.ht[0] + '-' + m.ht[1] + ')</i>' : '';
    return '<div class="sp-mr' + (showLg ? ' has-lg' : '') + '"><span class="sp-d">' + fmtFull(m.date) + '</span>'
      + '<span class="sp-h' + (hb ? ' b' : '') + '">' + esc(teamCode(m.home)) + '</span>'
      + '<span class="sp-s"><b>' + m.fh + '-' + m.fa + '</b>' + ht + '</span>'
      + '<span class="sp-a' + (ab ? ' b' : '') + '">' + esc(teamCode(m.away)) + '</span>'
      + (showLg ? '<span class="sp-lg" title="' + esc(m.league) + '">' + esc(leagueCode(m.league)) + '</span>' : '') + '</div>';
  }
  function card(tag, title, rowsHtml, footHtml) {
    return '<div class="sp-card"><div class="sp-card-h">' + (tag ? '<span class="sp-pill">' + esc(tag) + '</span>' : '')
      + '<span class="sp-card-t">' + title + '</span><span class="sp-all">All</span></div>'
      + '<div class="sp-card-b">' + (rowsHtml || '<div class="sp-none">No matches in the data yet</div>') + '</div>'
      + '<div class="sp-card-f">' + (footHtml || '') + '</div></div>';
  }
  function foot(a, b, c, n, labels, cls) {
    return '<span class="' + cls[0] + '">' + labels[0] + ' ' + a + ' (' + per(a, n) + '%)</span>'
      + '<span class="sp-fd">' + labels[1] + ' ' + b + ' (' + per(b, n) + '%)</span>'
      + '<span class="' + cls[1] + '">' + labels[2] + ' ' + c + ' (' + per(c, n) + '%)</span>';
  }
  function formCard(team, games, title, count) {
    var g = games.slice(-count).reverse();
    var w = g.filter(function (x) { return x.res === 'W'; }).length;
    var d = g.filter(function (x) { return x.res === 'D'; }).length;
    var rows = g.map(function (x) { return matchLine(x.m, team, title !== 'Last 6 matches'); }).join('');
    return card(teamCode(team), title, rows,
      g.length ? foot(w, d, g.length - w - d, g.length, ['Win', 'Draw', 'Lost'], ['sp-fw', 'sp-fl']) : '');
  }
  function detailPanel(f) {
    activeLeague = f.league;
    var hAll = teamGames(f.home, true), aAll = teamGames(f.away, true);
    var hHome = hAll.filter(function (x) { return x.venue === 'H'; });
    var aAway = aAll.filter(function (x) { return x.venue === 'A'; });
    var overall = statTable('Overall statistic',
      statRow(f.home, f.league, hAll) + statRow(f.away, f.league, aAll));
    var split = statTable('Home / Away statistic',
      statRow(f.home, f.league, hHome, 'Home') + statRow(f.away, f.league, aAway, 'Away'));

    var pair = [f.homeId, f.awayId].sort(function (a,b) { return a-b; }).join('-');
    var hhSource = DATA.demo === false ? ((DATA.h2h || {})[pair] || []) : MATCHES;
    var hh = hhSource.filter(function (m) {
      return (m.home === f.home && m.away === f.away) || (m.home === f.away && m.away === f.home);
    }).slice(-6).reverse();
    var hw = 0, dw = 0, aw = 0;
    hh.forEach(function (m) {
      var a = m.home === f.home ? m.fh : m.fa, b = m.home === f.home ? m.fa : m.fh;
      if (a > b) hw++; else if (a < b) aw++; else dw++;
    });
    var h2hCard = card('', 'Head to head', hh.map(function (m) { return matchLine(m, null, true); }).join(''),
      hh.length ? foot(hw, dw, aw, hh.length, [teamCode(f.home), 'Draw', teamCode(f.away)], ['sp-fw', 'sp-fl']) : '');
    h2hCard = h2hCard.replace('<div class="sp-card-h">', '<div class="sp-card-h sp-card-h2h">');

    return '<div class="sp-panel">' + overall + split + '<div class="sp-grid">'
      + h2hCard
      + formCard(f.home, hAll, 'Last 6 matches', 6)
      + formCard(f.away, aAll, 'Last 6 matches', 6)
      + formCard(f.home, hHome, 'Home matches', 4)
      + formCard(f.away, aAway, 'Away matches', 4)
      + '</div></div>';
  }
  function toggleDetail(tr) {
    var idx = tr.getAttribute('data-idx');
    var next = tr.nextElementSibling;
    if (next && next.classList.contains('detail-row')) {
      next.parentNode.removeChild(next); tr.classList.remove('open'); tr.setAttribute('aria-expanded', 'false'); return;
    }
    $all('tr.detail-row').forEach(function (d) { d.parentNode.removeChild(d); });
    $all('tr.stats-row.open').forEach(function (d) { d.classList.remove('open'); d.setAttribute('aria-expanded', 'false'); });
    var f = _rendered[idx];
    if (!f) return;
    var dr = document.createElement('tr');
    dr.className = 'detail-row';
    dr.innerHTML = '<td colspan="8">' + detailPanel(f) + '</td>';
    tr.parentNode.insertBefore(dr, tr.nextElementSibling);
    tr.classList.add('open'); tr.setAttribute('aria-expanded', 'true');
    sizeDetail();
  }
  /* keep the panel as wide as the visible table area (the table itself may scroll sideways on phones) */
  function sizeDetail() {
    var p = $('.sp-panel'), w = $('.table-wrap');
    if (!p || !w) return;
    p.style.width = Math.max(260, w.clientWidth - 2) + 'px';
  }
  window.addEventListener('resize', sizeDetail);
  /* ---------- filtering + render ---------- */
  var _rendered = [];
  function passesFilters(f, p) {
    if (!matchesPeriod(f, p)) return false;
    if (state.league !== 'all' && f.league !== state.league) return false;
    if (state.country !== 'all' && !CATALOG.some(function(lg){ return lg.name === f.league && lg.country === state.country; })) return false;
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
    var rows = [], cols = state.mode === 'ou' ? 10 : (state.mode === 'stats' ? 8 : 11);
    FIXTURES.forEach(function (f) {
      var p = (state.engine === 'poisson' && f.prediction ? f.prediction : predict(f.home, f.away, f.league));
      if (!passesFilters(f, p)) return;
      var idx = _rendered.length;
      _rendered.push(f);
      if (state.mode === '1x2') rows.push(row1x2(f, p));
      else if (state.mode === 'ou') rows.push(rowOu(f, p));
      else rows.push(rowStats(f, p, idx));
      if (idx === 3) rows.push(adRowHtml(cols)); // inline ad after 4th row
    });
    body.innerHTML = rows.join('');
    var tbl = document.querySelector('#view-predictions .pred-table');
    if (tbl) { tbl.classList.toggle('ou-mode', state.mode === 'ou'); tbl.classList.toggle('stats-mode', state.mode === 'stats'); }
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
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDetail(tr); }
      });
    });
  }

  /* ---------- Your Selection ---------- */
  function selectedFixtures() {
    var pool = FIXTURES.slice(), seen = {};
    Object.keys(DATA.leagueFixtures || {}).forEach(function (name) { pool = pool.concat(DATA.leagueFixtures[name]); });
    return pool.filter(function (f) { var key = fxKey(f); if (seen[key]) return false; seen[key] = true; return state.selection[key]; });
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
      var p = (state.engine === 'poisson' && f.prediction ? f.prediction : predict(f.home, f.away, f.league)), k = fxKey(f);
      return '<tr>'
        + '<td class="col-date">' + fmtDate(f.date) + '</td>'
        + '<td class="col-league">' + renderLeagueBadge(f) + '</td>'
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
    if (clr) clr.addEventListener('click', function () { state.selection = {}; renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 });
    var pdf = $('#selPdf');
    if (pdf) pdf.addEventListener('click', downloadSelectionPdf);
    $all('.sel-remove').forEach(function (b) {
      b.addEventListener('click', function () {
        delete state.selection[b.getAttribute('data-key')];
        renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }

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
      var p = (state.engine === 'poisson' && f.prediction ? f.prediction : predict(f.home, f.away, f.league));
      return '<tr><td>' + esc(f.date) + '</td><td>' + esc(f.league) + '</td>'
        + '<td>' + esc(f.home + ' v ' + f.away) + '</td>'
        + '<td>1 ' + pct(p.pHome) + '% / X ' + pct(p.pDraw) + '% / 2 ' + pct(p.pAway) + '%</td>'
        + '<td style="font-weight:700">' + bestKey(p) + '</td>'
        + '<td>' + p.scoreH + '-' + p.scoreA + '</td>'
        + '<td>Over ' + pct(p.pOver) + '%</td></tr>';
    }).join('');
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>GoalPre — My Selection</title>'
      + '<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:28px}'
      + 'h1{font-size:20px;margin:0 0 2px}.sub{color:#666;font-size:12px;margin:0 0 16px}'
      + 'table{width:100%;border-collapse:collapse;font-size:12px}'
      + 'th,td{border:1px solid #ccc;padding:7px 8px;text-align:left}'
      + 'th{background:#f0f3f7}.foot{margin-top:16px;color:#888;font-size:11px}</style></head><body>'
      + '<h1>GoalPre — My Selection</h1>'
      + '<p class="sub">' + fx.length + ' match(es) · ' + engName + ' engine · generated ' + new Date().toLocaleString() + '</p>'
      + '<table><thead><tr><th>Date</th><th>League</th><th>Match</th><th>1 X 2</th><th>Tip</th><th>Score</th><th>O/U</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '<p class="foot">Statistical predictions — not betting advice. 18+ Please gamble responsibly.</p>'
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

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }

  }
  function setEngine(eng) {
    state.engine = eng;
    $all('.eng-btn').forEach(function (b) {
      var on = b.getAttribute('data-engine') === eng;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }

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
    var favorites = {}, opened = {};
    try { favorites = JSON.parse(localStorage.getItem('pbt-favorite-leagues') || '{}'); } catch (e) {}
    try { opened = JSON.parse(localStorage.getItem('pbt-open-countries') || '{}'); } catch (e) {}
    if (!favorites || typeof favorites !== 'object') favorites = {};
    if (!opened || typeof opened !== 'object') opened = {};
    function leagueItem(lg) {
      var n = counts[lg.name] || 0, favorite = !!favorites[lg.id];
      return '<div class="country-league-row"><button type="button" class="league-favorite' + (favorite ? ' starred' : '')
        + '" data-favorite="' + esc(lg.id) + '" aria-label="Favorite ' + esc(lg.displayName || lg.name) + '" aria-pressed="' + favorite + '">'
        + (favorite ? '★' : '☆') + '</button><button type="button" class="side-item country-league" data-league="' + esc(lg.name) + '">'
        + '<span class="lbl">' + esc(lg.displayName || lg.name) + '</span><span class="cnt" title="Matches in the loaded date window">' + n + '</span></button></div>';
    }
    var countries = (DATA.countries || []).map(function (co, i) {
      var leagues = CATALOG.filter(function(lg) { return lg.country === co; });
      var isOpen = !!opened[co], id = 'country-leagues-' + i;
      return '<div class="country-group" data-country-group="' + esc(co) + '"><div class="country-heading">'
        + '<button type="button" class="side-item country-select" data-country="' + esc(co) + '"><span class="ico">' + ((COUNTRY_DATA[co] && COUNTRY_DATA[co].flag) ? COUNTRY_DATA[co].flag : '⚽') + '</span>'
        + '<span class="lbl">' + esc(countryLabel(co)) + '</span></button>'
        + '<button type="button" class="country-expand" data-expand-country="' + esc(co) + '" aria-expanded="' + isOpen
        + '" aria-controls="' + id + '" aria-label="Show leagues in ' + esc(countryLabel(co)) + '"><span class="caret">›</span></button></div>'
        + '<div class="country-leagues" id="' + id + '"' + (isOpen ? '' : ' hidden') + '>'
        + (leagues.length ? leagues.map(leagueItem).join('') : '<p class="country-empty">No current competitions returned by the API.</p>') + '</div></div>';
    }).join('');
    var periodBtns = [['today','Predictions for TODAY'],['live','LIVE predictions'],['tomorrow','Predictions for TOMORROW'],['weekend','Predictions for the WEEKEND'],['yesterday','Predictions from YESTERDAY'],['all','ALL predictions']].map(function (x) {
      // Each period is now an expandable group: clicking it reveals two sub-links
      // (Predictions 1X2 / Under-Over 2.5 goals) that switch BOTH the period and the market mode.
      return '<div class="side-period-group" data-period-group="' + x[0] + '">'
        + '<button class="side-item side-period" data-period="' + x[0] + '" aria-expanded="false"><span class="lbl">' + x[1]
        + '</span><span class="cnt" hidden>0</span><span class="period-caret" aria-hidden="true">\u203a</span></button>'
        + '<div class="side-submenu" hidden>'
        + '<button type="button" class="side-subitem" data-period="' + x[0] + '" data-submode="1x2">Predictions 1X2</button>'
        + '<button type="button" class="side-subitem" data-period="' + x[0] + '" data-submode="ou">Under/Over 2.5 goals</button>'
        + '</div></div>';
    }).join('') + '<button class="side-item side-period side-top" data-period="top"><span class="lbl">TOP predictions</span></button>';
    side.insertAdjacentHTML('beforeend',
      '<div class="side-group side-periods">' + periodBtns + '</div>'
      + '<div class="side-group"><div class="side-title">Popular leagues</div>' + allBtn + pl + '</div>'
      + '<div class="side-group"><div class="side-title">Countries</div>'
      + '<div class="side-search"><span class="ico">⚲</span><input type="search" id="countrySearch" placeholder="Search country…" aria-label="Search country"></div>'
      + '<div class="country-list">' + countries + '</div></div>'
      + '<div class="ad-slot ad-mpu" data-ad-placement="sidebar" aria-label="Advertisement"><span class="ad-body">Your ad here<span class="ad-size">MPU 300×250</span></span></div>'
      + '<div class="visitors"><div class="vc-head"><span class="vc-icon">◉</span>Traffic analytics not connected</div>'
      + '<ul class="vc-list"><li class="online"><span class="vc-k">Online now</span><span class="vc-v">–</span></li>'
      + '<li><span class="vc-k">Today</span><span class="vc-v">–</span></li>'
      + '<li><span class="vc-k">This week</span><span class="vc-v">–</span></li></ul></div>');

    // populate league filter dropdown — mirror the sidebar exactly:
    // only leagues that appear under a country group in the sidebar list (1).
    var sel = $('#leagueFilter');
    if (sel) {
      (DATA.countries || []).forEach(function (co) {
        var leagues = CATALOG.filter(function (lg) { return lg.country === co; });
        if (!leagues.length) return;
        var og = document.createElement('optgroup');
        og.label = countryLabel(co);
        leagues.forEach(function (lg) {
          var o = document.createElement('option');
          o.value = lg.name;
          o.textContent = lg.displayName || lg.name;
          og.appendChild(o);
        });
        sel.appendChild(og);
      });
    }
    function persist() {
      try { localStorage.setItem('pbt-favorite-leagues', JSON.stringify(favorites));
        localStorage.setItem('pbt-open-countries', JSON.stringify(opened)); } catch (e) {}
    }
    side.addEventListener('click', function (e) {
      var expand = e.target.closest('[data-expand-country]');
      if (expand) {
        var co = expand.getAttribute('data-expand-country'), panel = document.getElementById(expand.getAttribute('aria-controls'));
        opened[co] = expand.getAttribute('aria-expanded') !== 'true';
        expand.setAttribute('aria-expanded', String(opened[co])); panel.hidden = !opened[co]; persist(); return;
      }
      var star = e.target.closest('[data-favorite]');
      if (star) {
        var id = star.getAttribute('data-favorite'); favorites[id] = !favorites[id];
        star.classList.toggle('starred', favorites[id]); star.setAttribute('aria-pressed', String(favorites[id]));
        star.textContent = favorites[id] ? '★' : '☆'; persist(); return;
      }
      // Period sub-link: switch the period AND the market mode, then show predictions.
      var sub = e.target.closest('.side-subitem[data-period]');
      if (sub) {
        showView('predictions');
        setMode(sub.getAttribute('data-submode'));
        setPeriod(sub.getAttribute('data-period'));
        return;
      }
      var pb = e.target.closest('.side-item[data-period]');
      if (pb) {
        var group = pb.closest('.side-period-group');
        var submenu = group ? group.querySelector('.side-submenu') : null;
        // Periods without a sub-menu (e.g. TOP predictions) switch directly.
        if (!submenu) { showView('predictions'); setPeriod(pb.getAttribute('data-period')); return; }
        var isOpen = pb.getAttribute('aria-expanded') === 'true';
        // Collapse any other open period dropdowns so only one is open at a time.
        $all('.side-period[aria-expanded="true"]', side).forEach(function (b) {
          if (b === pb) return;
          b.setAttribute('aria-expanded', 'false');
          var g = b.closest('.side-period-group'), s = g ? g.querySelector('.side-submenu') : null;
          if (s) s.hidden = true;
        });
        pb.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        submenu.hidden = isOpen;
        return;
      }
      var cb = e.target.closest('.side-item[data-country]');
      if (cb) {
        showView('predictions'); state.country = cb.getAttribute('data-country'); state.league = 'all';
        if (sel) sel.value = 'all';
        $all('.side-item[data-country]').forEach(function(b){b.classList.toggle('active',b === cb);});
        $all('.side-item[data-league]').forEach(function(b){b.classList.remove('active');});
        renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 return;
      }
      var btn = e.target.closest('.side-item[data-league]');
      if (!btn) return;
      state.country = 'all';
      $all('.side-item[data-country]').forEach(function(b){b.classList.remove('active');});
      state.league = btn.getAttribute('data-league');
      $all('.side-item[data-league]').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      if (sel) sel.value = state.league;
      if (state.league !== 'all') openLeaguePage(state.league);
      else { showView('predictions'); renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 }
    });
    var cs = $('#countrySearch');
    if (cs) cs.addEventListener('input', function () {
      var q = cs.value.trim().toLowerCase();
      $all('.country-group').forEach(function (group) {
        var co = group.getAttribute('data-country-group'), countryMatch = countryLabel(co).toLowerCase().indexOf(q) !== -1;
        var rows = $all('.country-league-row', group), matches = 0;
        rows.forEach(function(row) {
          var match = !q || countryMatch || row.textContent.toLowerCase().indexOf(q) !== -1;
          row.hidden = !match; if (match) matches++;
        });
        group.hidden = !!q && !countryMatch && !matches;
        var panel = $('.country-leagues', group), toggle = $('.country-expand', group);
        var open = q ? !group.hidden : !!opened[co];
        panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
      });
    });
  }

  /* ---------- Results & Accuracy ---------- */
  function renderResults() {
    var body1x2 = $('#resultsBody1x2');
    var bodyOu = $('#resultsBodyOu');
    if (!body1x2 && !bodyOu) return;

    var records = DATA.demo === false ? (DATA.recentResults || []) : HISTORY;

    // Keep popular leagues only.
    var popular = {};
    (DATA.popularLeagues || []).forEach(function (lg) { popular[lg.name] = true; });
    var inPopular = records.filter(function (m) { return popular[m.league]; });

    // Keep only the latest 2 rounds per popular league. A "round" is grouped
    // by league + round label; its recency is the newest kickoff date in it.
    var roundDate = {}; // league -> round -> newest date string
    inPopular.forEach(function (m) {
      var rd = m.round || m.date.slice(0, 10);
      var byLeague = roundDate[m.league] || (roundDate[m.league] = {});
      if (!byLeague[rd] || m.date > byLeague[rd]) byLeague[rd] = m.date;
    });
    var latestRounds = {}; // league -> { round: true } for the 2 newest rounds
    Object.keys(roundDate).forEach(function (lg) {
      var rounds = Object.keys(roundDate[lg]).sort(function (a, b) {
        return roundDate[lg][b].localeCompare(roundDate[lg][a]);
      }).slice(0, 2);
      var keep = latestRounds[lg] = {};
      rounds.forEach(function (r) { keep[r] = true; });
    });
    var shown = inPopular.filter(function (m) {
      var rd = m.round || m.date.slice(0, 10);
      return latestRounds[m.league] && latestRounds[m.league][rd];
    });

    // Newest matches first.
    shown.sort(function (a, b) { return b.date.localeCompare(a.date); });

    var hit1x2 = 0, hitScore = 0, hitOu = 0, n = 0;
    var rows1x2 = [], rowsOu = [];
    shown.forEach(function (m) {
      // Prefer the forecast saved before kickoff, fall back to the model so
      // the Tip / Pred. score never collapse to "–" once a result is in.
      var p = (DATA.demo === false ? m.prediction : null) || predictPoisson(m.home, m.away);
      if (!p) return;
      n++;

      var dateCell = esc(m.date.slice(0, 10).split('-').reverse().join('/'));
      var leagueCell = '<td class="col-league">' + renderLeagueBadge(m) + '</td>';
      var matchCellTxt = '<td class="col-match">' + esc(m.home + ' v ' + m.away) + '</td>';
      var resultTotal = m.fh + m.fa;

      // --- 1X2 ---
      var predTip = bestKey(p);
      var actual = m.fh > m.fa ? '1' : (m.fh < m.fa ? '2' : 'X');
      var okTip = predTip === actual;
      if (okTip) hit1x2++;
      if (p.scoreH === m.fh && p.scoreA === m.fa) hitScore++;
      rows1x2.push('<tr><td>' + dateCell + '</td>' + leagueCell + matchCellTxt
        + '<td>' + tipBadge(predTip) + '</td>'
        + '<td><span class="score">' + p.scoreH + '-' + p.scoreA + '</span></td>'
        + '<td><span class="score">' + m.fh + '-' + m.fa + '</span></td>'
        + '<td><span class="verdict ' + (okTip ? 'win' : 'miss') + '">' + (okTip ? 'Hit' : 'Miss') + '</span></td></tr>');

      // --- Over/Under 2.50 ---
      var over = p.pOver >= 0.5;
      var ouTip = over ? 'over' : 'under';
      var ouActual = resultTotal > 2.5;
      var okOu = over === ouActual;
      if (okOu) hitOu++;
      rowsOu.push('<tr><td>' + dateCell + '</td>' + leagueCell + matchCellTxt
        + '<td><span class="ou ' + ouTip + '">' + (over ? 'Over 2.5' : 'Under 2.5') + '</span></td>'
        + '<td><span class="score">' + p.expTotal.toFixed(2) + '</span></td>'
        + '<td><span class="score">' + m.fh + '-' + m.fa + '</span></td>'
        + '<td><span class="verdict ' + (okOu ? 'win' : 'miss') + '">' + (okOu ? 'Hit' : 'Miss') + '</span></td></tr>');
    });

    if (body1x2) body1x2.innerHTML = rows1x2.join('') || '<tr><td colspan="7" class="empty">No recent results from popular leagues.</td></tr>';
    if (bodyOu) bodyOu.innerHTML = rowsOu.join('') || '<tr><td colspan="7" class="empty">No recent results from popular leagues.</td></tr>';

    $('#accOverall').textContent = n ? pct(hit1x2 / n) + '%' : '–';
    $('#accScore').textContent = n ? pct(hitScore / n) + '%' : '–';
    $('#accOu').textContent = n ? pct(hitOu / n) + '%' : '–';
    $('#settled').textContent = n;
    var ha = $('#heroAcc'); if (ha) ha.textContent = n ? pct(hit1x2 / n) + '%' : '–';
  }

  /* ---------- Page loading indicator ----------
     Gives instant visual feedback when the user switches menus, so the site
     never feels "stuck" during the brief render. A thin top progress bar plus
     a small corner spinner appear, then finish and fade out automatically. */
  var pageLoader = (function () {
    var barWrap = null, bar = null, spin = null, t1 = null, t2 = null;
    function build() {
      if (barWrap) return;
      barWrap = document.createElement('div');
      barWrap.className = 'page-loader';
      barWrap.setAttribute('aria-hidden', 'true');
      bar = document.createElement('div');
      bar.className = 'page-loader-bar';
      barWrap.appendChild(bar);
      spin = document.createElement('div');
      spin.className = 'page-loader-spin';
      spin.setAttribute('aria-hidden', 'true');
      document.body.appendChild(barWrap);
      document.body.appendChild(spin);
    }
    function run() {
      build();
      clearTimeout(t1); clearTimeout(t2);
      // reset to the start without animating
      barWrap.classList.remove('done');
      barWrap.classList.add('active');
      spin.classList.add('active');
      bar.style.transition = 'none';
      bar.style.width = '0%';
      void bar.offsetWidth; // force reflow so the next width animates
      bar.style.transition = 'width .4s ease';
      bar.style.width = '85%';
      t1 = setTimeout(function () {
        bar.style.width = '100%';
        barWrap.classList.add('done');
        spin.classList.remove('active');
        t2 = setTimeout(function () {
          barWrap.classList.remove('active', 'done');
          bar.style.transition = 'none';
          bar.style.width = '0%';
        }, 260);
      }, 420);
    }
    return { run: run };
  })();

  /* ---------- Home: top prediction highlights (both engines) ---------- */
  function tpTop1x2(p) {
    var k = bestKey(p);
    var v = k === '1' ? p.pHome : (k === '2' ? p.pAway : p.pDraw);
    return { key: k, prob: v };
  }
  function tpTopOU(p) {
    var over = p.pOver, under = 1 - p.pOver;
    return over >= under ? { key: 'Over 2.5', prob: over, side: 'O' } : { key: 'Under 2.5', prob: under, side: 'U' };
  }
  function tpWhen(f) {
    var parts = String(f.date || '').split(' ');
    return parts[1] ? parts[1] : '';
  }
  function tpEngine(name, t, market) {
    var cls = market === '1x2' ? ('pk' + t.key) : ('pk' + t.side);
    return '<div class="tp-eng"><span class="tp-eng-name">' + name + '</span>'
      + '<span class="tp-pick ' + cls + '">' + esc(t.key) + '</span>'
      + '<span class="tp-prob">' + pct(t.prob) + '%</span></div>';
  }
  function tpItem(s, market) {
    var f = s.f;
    var po = market === '1x2' ? s.t1 : s.to;
    var kp = market === '1x2' ? s.k1 : s.ko;
    var agree = po.key === kp.key;
    var when = tpWhen(f);
    return '<a class="tp-item" href="#" data-tp-view="predictions">'
      + '<div class="tp-match">'
      +   '<span class="tp-teams">'
      +     '<span class="tp-team"><span class="tp-crest" aria-hidden="true">' + esc(initials(f.home)) + '</span>' + esc(f.home) + '</span>'
      +     '<span class="tp-team"><span class="tp-crest" aria-hidden="true">' + esc(initials(f.away)) + '</span>' + esc(f.away) + '</span>'
      +   '</span>'
      +   '<span class="tp-meta">' + esc(f.league || '') + (when ? ' &middot; ' + esc(when) : '') + '</span>'
      + '</div>'
      + '<div class="tp-engines">' + tpEngine('Poisson', po, market) + tpEngine('KPI', kp, market) + '</div>'
      + (agree
          ? '<span class="tp-flag tp-agree" title="Both engines pick the same outcome">&#10003; agree</span>'
          : '<span class="tp-flag tp-split" title="The two engines differ">split</span>')
      + '</a>';
  }
  function renderHomeTopPicks() {
    var el1 = $('#tp1x2'), elO = $('#tpou');
    if (!el1 && !elO) return;
    var today = todayStr();
    var pool = FIXTURES.filter(function (f) { return dayOf(f) === today; });
    if (pool.length < 5) {
      pool = FIXTURES.filter(function (f) { return dayOf(f) >= today; })
        .sort(function (a, b) { return String(a.date) < String(b.date) ? -1 : 1; });
    }
    // Stage 1: cheap Dixon-Coles pass to shortlist candidates (keeps KPI work small).
    var scored = pool.map(function (f) {
      activeLeague = f.league || null;
      var pois = (f.prediction && f.prediction.pHome != null) ? f.prediction : predictPoisson(f.home, f.away);
      return { f: f, pois: pois, t1: tpTop1x2(pois), to: tpTopOU(pois) };
    });
    var short1 = scored.slice().sort(function (a, b) { return b.t1.prob - a.t1.prob; }).slice(0, 18);
    var shortO = scored.slice().sort(function (a, b) { return b.to.prob - a.to.prob; }).slice(0, 18);
    var seen = {}, union = [];
    short1.concat(shortO).forEach(function (s) { var k = fxKey(s.f); if (!seen[k]) { seen[k] = true; union.push(s); } });
    // Group by league so the KPI stats cache is rebuilt once per league, not per match.
    union.sort(function (a, b) { return String(a.f.league || '') < String(b.f.league || '') ? -1 : 1; });
    // Stage 2: compute KPI for the shortlist and a combined (both-engine) ranking score.
    union.forEach(function (s) {
      activeLeague = s.f.league || null;
      s.kpi = predictKpi(s.f.home, s.f.away);
      s.k1 = tpTop1x2(s.kpi);
      s.ko = tpTopOU(s.kpi);
      s.rank1 = (s.t1.prob + s.k1.prob) / 2;
      s.rankO = (s.to.prob + s.ko.prob) / 2;
    });
    var best1 = union.slice().sort(function (a, b) { return b.rank1 - a.rank1; }).slice(0, 5);
    var bestO = union.slice().sort(function (a, b) { return b.rankO - a.rankO; }).slice(0, 5);
    if (el1) el1.innerHTML = best1.length
      ? best1.map(function (s) { return tpItem(s, '1x2'); }).join('')
      : '<p class="tp-empty">No upcoming fixtures to rank yet.</p>';
    if (elO) elO.innerHTML = bestO.length
      ? bestO.map(function (s) { return tpItem(s, 'ou'); }).join('')
      : '<p class="tp-empty">No upcoming fixtures to rank yet.</p>';
  }

  function showView(view) {
    pageLoader.run();
    if (view !== 'league' && location.hash.indexOf('#league=') === 0) history.replaceState(null, '', location.pathname + location.search);
    $all('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + view; });
    // Gentle fade-in on the view that just became visible, so the switch feels responsive.
    var shown = $('#view-' + view);
    if (shown) { shown.classList.remove('pb-switching'); void shown.offsetWidth; shown.classList.add('pb-switching'); }
    $all('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === view); });
    var nav = $('#menuToggle');
    if (nav) nav.setAttribute('aria-expanded', 'false');
    $('.main-nav').classList.remove('open');
  }


  /* ---------- Dedicated league routes ---------- */
  var leaguePageState = { name: '', tab: 'overview', date: '', market: '1x2', limit: 50 };
  function leagueByName(name) {
    return CATALOG.find(function (lg) { return lg.name === name; });
  }
  function leagueLink(lg) { return '#league=' + encodeURIComponent(lg.id != null ? lg.id : lg.name); }
  function openLeaguePage(name) {
    var lg = leagueByName(name); if (!lg) return;
    if (leaguePageState.name !== name) {
      leaguePageState.name = name; leaguePageState.date = ''; leaguePageState.tab = 'overview'; leaguePageState.limit = 50;
    }
    state.league = name; state.country = 'all';
    var filter = $('#leagueFilter'); if (filter) filter.value = name;
    $all('.side-item[data-league]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-league') === name); });
    if (location.hash !== leagueLink(lg)) history.pushState(null, '', leagueLink(lg));
    showView('league'); renderLeaguePage();
  }
  function leagueRoute() {
    if (location.hash.indexOf('#league=') !== 0) { showView('predictions'); return; }
    var value; try { value = decodeURIComponent(location.hash.slice(8)); } catch (e) { return; }
    var lg = CATALOG.find(function (x) { return String(x.id) === value || x.name === value; });
    if (lg) openLeaguePage(lg.name);
    else { showView('predictions'); }
  }
  function leagueRows(name) {
    var season = (DATA.seasons || {})[name], found = {};
    var extra = ((DATA.leagueFixtures || {})[name] || []);
    HISTORY.concat(extra, FIXTURES).forEach(function (f) {
      if (f.league !== name || (season != null && f.season != null && String(f.season) !== String(season))) return;
      found[f.id != null ? f.id : fxKey(f)] = f;
    });
    return Object.keys(found).map(function (key) { return found[key]; });
  }
  function leagueFinished(f) { return ['FT', 'AET', 'PEN'].indexOf(f.status) >= 0 || (!f.status && f.fh != null && f.fa != null); }
  // Keep the full latest-results round and next/live round, without pagination.
  function leagueRoundKey(f) { return f.round || f.date.slice(0, 10); }
  function leagueOverviewGroups(recent, upcoming, now) {
    var results = recent.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var pending = upcoming.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var next = pending.find(function (f) { return f.live || ['1H','HT','2H','ET','BT','P','INT'].indexOf(f.status) >= 0; })
      || pending.find(function (f) { return Date.parse(f.date) >= now && ['PST','SUSP'].indexOf(f.status) < 0; });
    var groups = [];
    function add(label, source, first) {
      if (!first) return;
      var key = leagueRoundKey(first);
      groups.push({ title: label + ' · ' + key, rows: source.filter(function (f) { return leagueRoundKey(f) === key; }).sort(function (a,b) { return a.date.localeCompare(b.date); }) });
    }
    add('Latest results', results, results[0]);
    add('Upcoming / live', pending, next);
    return groups;
  }
  function standingZone(description) {
    var text = String(description || '').toLowerCase();
    if (/relegation|relegated/.test(text)) return 'relegation';
    if (/champions league/.test(text)) return 'champions';
    if (/europa league/.test(text)) return 'europa';
    return '';
  }
  function standingsLegend() {
    return '<div class="lp-legend" aria-label="Standings legend"><span><i class="lp-zone champions"></i>Champions League</span><span><i class="lp-zone europa"></i>Europa League</span><span><i class="lp-zone relegation"></i>Relegation</span><small>Row markers use API-Football qualification descriptions only; applicable zones vary by competition.</small></div>';
  }
  function leagueStandings(name) {
    var groups = (DATA.standingsTables || {})[name] || [];
    if (!groups.length) return '<p class="empty">Standings are unavailable for this competition. Cups may not have a league table.</p>';
    function val(x) { return x == null ? '—' : esc(x); }
    return groups.map(function (group, index) {
      var label = group[0] && group[0].group;
      return '<h3>' + esc(label || (groups.length > 1 ? 'Group ' + (index + 1) : 'Overall table')) + '</h3><div class="lp-standings-scroll"><table class="lp-standings"><thead><tr><th>#</th><th>Team</th><th>Pts</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th></tr></thead><tbody>'
        + group.map(function (r) {
          var a = r.all || {};
          return '<tr><td>' + (standingZone(r.description) ? '<i class="lp-zone ' + standingZone(r.description) + '" title="' + esc(r.description) + '"></i>' : '') + val(r.rank) + '</td><td title="' + esc(r.description || '') + '">' + esc((r.team || {}).name) + '</td><td><b>' + val(r.points) + '</b></td><td>' + val(a.played) + '</td><td>' + val(a.win) + '</td><td>' + val(a.draw) + '</td><td>' + val(a.lose) + '</td><td>' + val(r.goalsDiff) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).join('');
  }
  function leagueMatchRow(f) {
    var finished = leagueFinished(f), p = null;
    // Do not produce retrospective forecasts for completed matches.
    if (finished) p = f.prediction || null;
    else p = state.engine === 'poisson' && f.prediction ? f.prediction : predict(f.home, f.away, f.league);
    var ou = leaguePageState.market === 'ou', key = p ? (ou ? (p.pOver >= 0.5 ? 'over' : 'under') : bestKey(p)) : null;
    var probs = p ? (ou ? '<td>' + pct(p.pOver) + '%</td><td>' + pct(1-p.pOver) + '%</td>' : '<td>' + pct(p.pHome) + '%</td><td>' + pct(p.pDraw) + '%</td><td>' + pct(p.pAway) + '%</td>') : (ou ? '<td>—</td><td>—</td>' : '<td>—</td><td>—</td><td>—</td>');
    var actual = finished ? (f.currentHome != null && f.currentAway != null ? f.currentHome + '–' + f.currentAway : f.fh + '–' + f.fa) : (f.live && f.currentHome != null ? f.currentHome + '–' + f.currentAway : '—');
    var forecast = p ? p.scoreH + '–' + p.scoreA : '—';
    var tip = key ? (ou ? '<span class="tip t1">' + (key === 'over' ? 'Over' : 'Under') + ' 2.5</span>' : tipBadge(key)) : '—';
    var status = finished && p ? 'Saved before kickoff' : (!finished ? 'Model estimate' : 'No saved forecast');
    return '<tr><td><input class="pick-cb" type="checkbox" data-key="' + esc(fxKey(f)) + '" aria-label="Select ' + esc(f.home + ' vs ' + f.away) + '"' + (state.selection[fxKey(f)] ? ' checked' : '') + (finished ? ' disabled' : '') + '></td><td>' + fmtDate(f.date) + '</td><td class="lp-match">' + matchCell(f) + '</td>' + probs + '<td title="' + esc(status) + '">' + tip + '</td><td><b>' + esc(forecast) + '</b></td><td><b>' + esc(actual) + '</b>' + (f.ht ? '<small class="lp-muted">HT ' + esc(f.ht.join('–')) + '</small>' : '') + '</td>' + (key && !finished ? oddsCell(f, ou ? 'ou' : '1x2', key) : '<td>—</td>') + '</tr>';
  }
  function renderLeaguePage() {
    var host = $('#leaguePage'), name = leaguePageState.name, lg = leagueByName(name);
    if (!host || !lg) return;
    var rows = leagueRows(name), upcoming = rows.filter(function (f) { return !leagueFinished(f) && ['CANC','ABD','AWD','WO'].indexOf(f.status) < 0; }), recent = rows.filter(leagueFinished);
    var groups = leagueOverviewGroups(recent, upcoming, Date.now());
    if (leaguePageState.date) groups = groups.map(function (g) {
      return { title: g.title, rows: g.rows.filter(function (f) { return f.date.slice(0,10) === leaguePageState.date; }) };
    }).filter(function (g) { return g.rows.length; });
    var list = [].concat.apply([], groups.map(function (g) { return g.rows; }));
    var ou = leaguePageState.market === 'ou', cols = ou ? 9 : 10;
    var body = groups.map(function (g) { return '<tr class="lp-round"><th scope="rowgroup" colspan="' + cols + '">' + esc(g.title) + '</th></tr>' + g.rows.map(leagueMatchRow).join(''); }).join('');
    var booknames = {};
    rows.forEach(function (r) { ((r.odds || {}).bookmakers || []).forEach(function (b) { booknames[b.id] = b.name; }); });
    host.innerHTML = '<header class="lp-title"><div><h1>' + esc(lg.displayName || name) + '</h1><p>' + esc(countryLabel(lg.country || '')) + ' · Season ' + esc((DATA.seasons || {})[name] || lg.season || '—') + '</p></div><button type="button" class="lp-button" data-lp-action="back">← Predictions</button></header>'
      + '<div class="lp-grid"><div class="lp-main"><div class="lp-controls"><p class="lp-round-summary">Latest results &amp; upcoming round · Full match lists</p>'
      + '<div class="lp-options"><label>Market<select data-lp-select="market"><option value="1x2"' + (!ou ? ' selected' : '') + '>1X2</option><option value="ou"' + (ou ? ' selected' : '') + '>Over/Under 2.5</option></select></label><label>Model<select data-lp-select="engine"><option value="poisson"' + (state.engine === 'poisson' ? ' selected' : '') + '>Poisson</option><option value="random"' + (state.engine === 'random' ? ' selected' : '') + '>KPI</option></select></label><label>Bookmaker<select data-lp-select="book"><option value="best">Best available</option>' + Object.keys(booknames).map(function (id) { return '<option value="' + esc(id) + '"' + (String(id) === selectedBookmaker ? ' selected' : '') + '>' + esc(booknames[id]) + '</option>'; }).join('') + '</select></label></div></div>'
      + '<div class="table-wrap lp-table-wrap"><table class="pred-table lp-table"><thead><tr><th>Pick</th><th>Date</th><th>Match</th>' + (ou ? '<th>Over 2.5</th><th>Under 2.5</th>' : '<th>1</th><th>X</th><th>2</th>') + '<th>Tip</th><th>Pred.</th><th>Result</th><th>Coef.</th></tr></thead><tbody>' + body + '</tbody></table>' + (!list.length ? '<p class="empty">No ' + (leaguePageState.tab === 'recent' ? 'completed matches' : 'matches in the latest and upcoming rounds') + ' available' + (leaguePageState.date ? ' on this date' : '') + '.</p>' : '') + '</div>'
      + '<p class="lp-note">Match times: ' + esc(DATA.timezone || 'UTC') + '. Updated: ' + esc(DATA.generatedAt || 'Not available') + '. Live scores are update snapshots. Completed matches show only forecasts saved before kickoff; — means unavailable. Odds and model estimates are not guarantees.</p></div>'
      + '<aside class="lp-aside"><section class="lp-card"><h2>Match calendar</h2><label>Date<input type="date" data-lp-select="date" value="' + esc(leaguePageState.date) + '"></label><button class="lp-button" data-lp-action="clear-date">All dates</button><p class="lp-muted">Filters these two round lists. Clear the date to see every match.</p></section><section class="lp-card"><h2>Standings</h2>' + leagueStandings(name) + '</section>' + standingsLegend() + '</aside></div>';
    $all('.pick-cb', host).forEach(function (cb) { cb.addEventListener('change', function () { var key = cb.getAttribute('data-key'); if (cb.checked) state.selection[key] = true; else delete state.selection[key]; updateSelBadges(); }); });
    updateSelBadges();
  }
  function initLeaguePages() {
    var host = $('#leaguePage'); if (!host) return;
    host.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-lp-tab]'), action = e.target.closest('[data-lp-action]');
      if (tab) { leaguePageState.tab = tab.getAttribute('data-lp-tab'); leaguePageState.limit = 50; renderLeaguePage(); }
      if (action) {
        var a = action.getAttribute('data-lp-action');
        if (a === 'back') { state.period = 'all'; showView('predictions'); renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 }
        if (a === 'more') { leaguePageState.limit += 50; renderLeaguePage(); }
        if (a === 'clear-date') { leaguePageState.date = ''; leaguePageState.limit = 50; renderLeaguePage(); }
      }
    });
    host.addEventListener('change', function (e) {
      var key = e.target.getAttribute('data-lp-select'); if (!key) return;
      if (key === 'market') leaguePageState.market = e.target.value;
      if (key === 'engine') setEngine(e.target.value);
      if (key === 'book') { selectedBookmaker = e.target.value; var el = $('#bookmakerFilter'); if (el) el.value = selectedBookmaker; }
      if (key === 'date') { leaguePageState.date = e.target.value; leaguePageState.limit = 50; }
      renderLeaguePage();
    });
    window.addEventListener('hashchange', leagueRoute);
    window.addEventListener('popstate', leagueRoute);
    if (location.hash.indexOf('#league=') === 0) leagueRoute();
  }

  /* ---------- init / wiring ---------- */
  function init() {
    initBookmakers();
    buildSidebar();
    buildDayStrip();
    var info = $('#dataStatus');
    if (info) {
      info.textContent = DATA.demo === false && DATA.generatedAt ? 'API-Football · Updated ' + DATA.generatedAt.replace('T',' ').slice(0,16) + ' UTC · Match times: ' + DATA.timezone : 'Waiting for first API-Football update';
      if (DATA.generatedAt && Date.now() - new Date(DATA.generatedAt).getTime() > 7200000) info.textContent += ' · Data may be stale';
    }
    renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }

    renderResults();
    var todayIso = todayStr();
    var todayMatchesList = FIXTURES.filter(function (f) {
      var d = String(f.date || '');
      return d.indexOf(todayIso) === 0 || d.slice(0, 10) === todayIso;
    });
    var todayLeagueSet = {};
    todayMatchesList.forEach(function (f) { if (f.league) todayLeagueSet[f.league] = true; });

    var hm = $('#heroMatches'); if (hm) hm.textContent = todayMatchesList.length;
    var hl = $('#heroLeagues'); if (hl) hl.textContent = Object.keys(todayLeagueSet).length;
    renderHomeTopPicks();
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
    // Home page call-to-action buttons jump to the matching view.
    $all('.home-cta[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { showView(b.getAttribute('data-view')); });
    });
    // Home top-pick cards jump to the full predictions table.
    document.addEventListener('click', function (e) {
      var node = e.target, hit = null;
      while (node && node.nodeType === 1) {
        if (node.classList && node.classList.contains('tp-item')) { hit = node; break; }
        node = node.parentNode;
      }
      if (hit) { e.preventDefault(); showView('predictions'); }
    });
    var lf = $('#leagueFilter');
    if (lf) lf.addEventListener('change', function () {
      state.league = lf.value; state.country = 'all';
      $all('.side-item[data-country]').forEach(function(b){b.classList.remove('active');});
      $all('.side-item[data-league]').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-league') === state.league);
      });
      renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }

    });
    var tf = $('#tipFilter');
    if (tf) tf.addEventListener('change', function () { state.tip = tf.value; renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 });
    var pf = $('#probFilter');
    if (pf) pf.addEventListener('change', function () { state.minProb = parseInt(pf.value, 10) || 0; renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 });
    var sb = $('#searchBox');
    if (sb) sb.addEventListener('input', function () { state.search = sb.value.trim(); renderPredictions();

    // Bind Settings UI (Timezone & Odds Format)
    var tzSel = $('#tzSelect');
    if (tzSel) {
      tzSel.value = userSettings.timezone;
      tzSel.addEventListener('change', function () {
        userSettings.timezone = tzSel.value;
        localStorage.setItem('pb_tz', tzSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
    var oddsSel = $('#oddsFormatSelect');
    if (oddsSel) {
      oddsSel.value = userSettings.oddsFormat;
      oddsSel.addEventListener('change', function () {
        userSettings.oddsFormat = oddsSel.value;
        localStorage.setItem('pb_odds_fmt', oddsSel.value);
        renderPredictions();
        if (state.activeTab === 'results') renderResults();
        if (leaguePageState.name) renderLeaguePage();
      });
    }
 });

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
    // Settings drop-list: click "Settings" to reveal Time Zone + % COEF.
    var settingsToggle = $('#settingsToggle'), settingsPanel = $('#settingsPanel');
    if (settingsToggle && settingsPanel) {
      var closeSettings = function () {
        settingsPanel.setAttribute('hidden', '');
        settingsToggle.setAttribute('aria-expanded', 'false');
      };
      settingsToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (settingsPanel.hasAttribute('hidden')) {
          settingsPanel.removeAttribute('hidden');
          settingsToggle.setAttribute('aria-expanded', 'true');
        } else { closeSettings(); }
      });
      // Close when clicking anywhere outside the settings box.
      document.addEventListener('click', function (e) {
        if (!settingsPanel.hasAttribute('hidden') && !e.target.closest('#siteSettings')) closeSettings();
      });
      // Close on Escape for keyboard users.
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !settingsPanel.hasAttribute('hidden')) { closeSettings(); settingsToggle.focus(); }
      });
    }
    initLeaguePages();
    var ac = $('#anchorAdClose');
    if (ac) ac.addEventListener('click', function () { document.body.classList.add('anchor-hidden'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
