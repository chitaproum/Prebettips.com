#!/usr/bin/env node
/* PreBetTips - regenerate data.js from API-Football (api-sports.io).
   Dependency-free: requires Node 18+ (built-in global fetch).

   SECURITY: the API key is read ONLY from the environment variable
   API_FOOTBALL_KEY. It is never written into data.js / app.js / index.html,
   so it never ships to the browser. Run this on your machine or server:

       export API_FOOTBALL_KEY=your_key_here
       node fetch-data.js

   The front end (index.html / styles.css / app.js) is left untouched; only
   data.js is regenerated with the same schema the prediction engines expect:
     teams{att,def,league}, leagueAvgGoals, homeAdvantage,
     fixtures[{home,away,league,date}],
     history[{date,home,away,league,fh,fa}],
     popularLeagues[{name,icon}], countries[]
*/
'use strict';

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.API_FOOTBALL_KEY;
if (!API_KEY) {
  console.error('ERROR: set the API_FOOTBALL_KEY environment variable first.');
  console.error('  export API_FOOTBALL_KEY=your_key_here');
  process.exit(1);
}

const API_BASE = 'https://v3.football.api-sports.io';

/* ------- configuration: which competitions to pull ------- */
const CONFIG = {
  season: 2024,
  // API-Football league IDs -> display name + flag
  leagues: [
    { id: 39,  name: 'Premier League', icon: '\uD83C\uDDEC\uD83C\uDDE7', country: 'England' },
    { id: 140, name: 'La Liga',        icon: '\uD83C\uDDEA\uD83C\uDDF8', country: 'Spain'   },
    { id: 135, name: 'Serie A',        icon: '\uD83C\uDDEE\uD83C\uDDF9', country: 'Italy'   },
    { id: 78,  name: 'Bundesliga',     icon: '\uD83C\uDDE9\uD83C\uDDEA', country: 'Germany' },
    { id: 61,  name: 'Ligue 1',        icon: '\uD83C\uDDEB\uD83C\uDDF7', country: 'France'  }
  ],
  upcomingPerLeague: 12,
  historyPerLeague: 10,
  homeAdvantage: 1.15
};

const COUNTRIES = ['England', 'Spain', 'Italy', 'Germany', 'France',
  'Netherlands', 'Portugal', 'Belgium', 'Turkey', 'Brazil', 'Argentina', 'USA'];

async function api(endpoint, params) {
  const url = new URL(API_BASE + endpoint);
  Object.keys(params || {}).forEach((k) => url.searchParams.set(k, params[k]));
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  if (!res.ok) throw new Error('API ' + res.status + ' for ' + endpoint);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error('API error: ' + JSON.stringify(json.errors));
  }
  return json.response || [];
}

function fmtDate(iso) {
  // 'YYYY-MM-DDTHH:MM:SS+00:00' -> 'YYYY-MM-DD HH:MM'
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* Convert API team season stats into normalised att/def ratings.
   att>1 => scores more than league average; def<1 => concedes less. */
function ratingsFromStats(stats, leagueAvgPerTeam) {
  const played = (stats.fixtures && stats.fixtures.played && stats.fixtures.played.total) || 1;
  const gf = (stats.goals && stats.goals.for && stats.goals.for.total && stats.goals.for.total.total) || 0;
  const ga = (stats.goals && stats.goals.against && stats.goals.against.total && stats.goals.against.total.total) || 0;
  const gfpg = gf / played;
  const gapg = ga / played;
  const base = leagueAvgPerTeam || 1.35;
  return {
    att: +(gfpg / base).toFixed(2) || 1,
    def: +(gapg / base).toFixed(2) || 1
  };
}

async function run() {
  const teams = {};
  const fixtures = [];
  const history = [];
  let totalGoals = 0, totalMatches = 0;

  for (const lg of CONFIG.leagues) {
    console.log('Fetching ' + lg.name + ' \u2026');

    // 1) standings give us the squad list + goals for/against for ratings
    const standings = await api('/standings', { league: lg.id, season: CONFIG.season });
    const table = (standings[0] && standings[0].league && standings[0].league.standings
      && standings[0].league.standings[0]) || [];
    let lgGF = 0, lgPlayed = 0;
    table.forEach((r) => { lgGF += (r.all && r.all.goals && r.all.goals.for) || 0; lgPlayed += (r.all && r.all.played) || 0; });
    const leagueAvgPerTeam = lgPlayed ? lgGF / lgPlayed : 1.35;

    table.forEach((r) => {
      const name = r.team && r.team.name;
      if (!name) return;
      const played = (r.all && r.all.played) || 1;
      const gfpg = ((r.all && r.all.goals && r.all.goals.for) || 0) / played;
      const gapg = ((r.all && r.all.goals && r.all.goals.against) || 0) / played;
      teams[name] = {
        att: +(gfpg / (leagueAvgPerTeam || 1.35)).toFixed(2) || 1,
        def: +(gapg / (leagueAvgPerTeam || 1.35)).toFixed(2) || 1,
        league: lg.name
      };
    });

    // 2) upcoming fixtures (not started)
    const next = await api('/fixtures', { league: lg.id, season: CONFIG.season, next: CONFIG.upcomingPerLeague });
    next.forEach((f) => {
      fixtures.push({
        home: f.teams.home.name,
        away: f.teams.away.name,
        league: lg.name,
        date: fmtDate(f.fixture.date)
      });
    });

    // 3) recent finished results for the Results & Accuracy page
    const last = await api('/fixtures', { league: lg.id, season: CONFIG.season, last: CONFIG.historyPerLeague });
    last.forEach((f) => {
      if (f.goals.home == null || f.goals.away == null) return;
      history.push({
        date: f.fixture.date.slice(0, 10),
        home: f.teams.home.name,
        away: f.teams.away.name,
        league: lg.name,
        fh: f.goals.home,
        fa: f.goals.away
      });
      totalGoals += f.goals.home + f.goals.away;
      totalMatches++;
    });
  }

  const leagueAvgGoals = totalMatches ? +(totalGoals / totalMatches).toFixed(2) : 2.7;
  history.sort((a, b) => (a.date < b.date ? 1 : -1));
  fixtures.sort((a, b) => (a.date < b.date ? -1 : 1));

  const data = {
    leagueAvgGoals: leagueAvgGoals,
    homeAdvantage: CONFIG.homeAdvantage,
    teams: teams,
    fixtures: fixtures,
    history: history,
    popularLeagues: CONFIG.leagues.map((l) => ({ name: l.name, icon: l.icon })),
    countries: COUNTRIES
  };

  const header = '/* PreBetTips - dataset generated by fetch-data.js from API-Football.\n'
    + '   Generated: ' + new Date().toISOString() + '\n'
    + '   Do NOT put API keys in this file - it ships to the browser. */\n';
  const out = header + 'window.DATA = ' + JSON.stringify(data, null, 2) + ';\n';

  const target = path.join(__dirname, 'data.js');
  fs.writeFileSync(target, out, 'utf8');
  console.log('\u2713 Wrote ' + target);
  console.log('  teams: ' + Object.keys(teams).length
    + ' | fixtures: ' + fixtures.length
    + ' | history: ' + history.length
    + ' | leagueAvgGoals: ' + leagueAvgGoals);
}

run().catch((err) => { console.error(err.message || err); process.exit(1); });
