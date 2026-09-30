#!/usr/bin/env node
/*
 * PreBetTips — data refresher
 * ---------------------------------------------------------------------------
 * Fetches live football data from API-Football (api-sports.io) and regenerates
 * ./data.js in the exact shape window.DATA expects, so the static front-end
 * keeps working unchanged.
 *
 * Requirements: Node.js 18+ (built-in fetch). No npm install needed.
 *
 * Usage:
 *   export API_FOOTBALL_KEY=your_key_here      # from https://dashboard.api-football.com
 *   node fetch-data.js                          # writes data.js
 *   node fetch-data.js --dry                     # print to stdout, don't write
 */

'use strict';
const fs = require('fs');
const path = require('path');

/* ----------------------------- CONFIG ------------------------------------- */
const CONFIG = {
  season: 2024,                 // Free plan supported season (2022-2024)
  upcomingPerLeague: 8,         // max upcoming fixtures to include per league
  finishedPerLeague: 8,         // max finished fixtures to include per league
  minRating: 0.2,               // clamp att/def so a team is never 0
  leagues: [
    { id: 39,  name: 'Premier League' },
    { id: 140, name: 'La Liga' },
    { id: 135, name: 'Serie A' },
  ],
};

/* Optional: shorten API team names to the compact labels the app uses. */
const NAME_OVERRIDES = {
  'Manchester City': 'Man City',
  'Manchester United': 'Man United',
  'Tottenham Hotspur': 'Tottenham',
  'Brighton & Hove Albion': 'Brighton',
  'Sheffield Utd': 'Sheffield Utd',
  'Atletico Madrid': 'Atletico',
  'Athletic Club': 'Athletic',
  'Real Sociedad': 'Sociedad',
  'Inter': 'Inter',
  'AC Milan': 'Milan',
  'AS Roma': 'Roma',
};
function mapName(n) { return NAME_OVERRIDES[n] || n; }

/* Static sidebar / country lists */
const POPULAR_LEAGUES = [
  { name: 'UEFA Champions League', icon: '\u26bd' },
  { name: 'UEFA Europa League',    icon: '\ud83c\udfc6' },
  { name: 'Premier League',        icon: '\ud83c\udff4' },
  { name: 'La Liga',               icon: '\ud83c\uddea\ud83c\uddf8' },
  { name: 'Bundesliga',            icon: '\ud83c\udde9\ud83c\uddea' },
  { name: 'Serie A',               icon: '\ud83c\uddee\ud83c\uddf9' },
  { name: 'Ligue 1',               icon: '\ud83c\uddeb\ud83c\uddf7' },
  { name: 'Eredivisie',            icon: '\ud83c\uddf3\ud83c\uddf1' },
  { name: 'Liga Portugal',         icon: '\ud83c\uddf5\ud83c\uddf9' },
  { name: 'Brasileiro Serie A',    icon: '\ud83c\udde7\ud83c\uddf7' },
  { name: 'Scottish Premiership',  icon: '\ud83c\udff4' },
  { name: 'S\u00fcper Lig',        icon: '\ud83c\uddf9\ud83c\uddf7' },
  { name: 'Saudi Pro League',      icon: '\ud83c\uddf8\ud83c\udde6' },
];
const COUNTRIES = [
  'Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina',
  'Armenia','Australia','Austria','Belgium','Brazil','Bulgaria','Chile',
  'China','Colombia','Croatia','Denmark','England','France','Germany',
  'Greece','Italy','Japan','Mexico','Netherlands','Norway','Poland',
  'Portugal','Saudi Arabia','Scotland','Spain','Sweden','Switzerland',
  'Turkey','USA',
];

/* ----------------------------- API CLIENT --------------------------------- */
const HARDCODED_API_KEY = ''; // Optional fallback key if not using env vars

const API_KEY = process.env.API_FOOTBALL_KEY || HARDCODED_API_KEY;
const USE_RAPID = process.env.API_FOOTBALL_RAPID === '1';
const BASE = USE_RAPID
  ? 'https://api-football-v1.p.rapidapi.com/v3'
  : 'https://v3.football.api-sports.io';

function authHeaders() {
  return USE_RAPID
    ? { 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' }
    : { 'x-apisports-key': API_KEY };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(endpoint, params) {
  const url = new URL(BASE + endpoint);
  Object.keys(params || {}).forEach((k) => url.searchParams.set(k, params[k]));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 1) { await sleep(2000); continue; }
    }
    if (!res.ok) throw new Error('API ' + res.status + ' on ' + endpoint + ': ' + (await res.text()).slice(0, 200));
    const json = await res.json();
    if (json.errors && Object.keys(json.errors).length) {
      throw new Error('API error on ' + endpoint + ': ' + JSON.stringify(json.errors));
    }
    await sleep(250);
    return json.response || [];
  }
  throw new Error('API repeatedly failed on ' + endpoint);
}

/* ----------------------------- FETCHERS ----------------------------------- */
async function fetchStandings(league) {
  const resp = await apiGet('/standings', { league: league.id, season: CONFIG.season });
  const table = resp[0] && resp[0].league && resp[0].league.standings && resp[0].league.standings[0];
  if (!table) { console.warn('  ! no standings for ' + league.name); return []; }
  return table.map((row) => ({
    name: mapName(row.team.name),
    played: row.all.played || 0,
    gf: row.all.goals.for || 0,
    ga: row.all.goals.against || 0,
  }));
}

function fmtDateTime(iso) { return String(iso).replace('T', ' ').slice(0, 16); }
function fmtDate(iso) { return String(iso).slice(0, 10); }
function toYYYYMMDD(d) { return d.toISOString().slice(0, 10); }

// Upcoming fixtures using date range (Free plan compatible)
async function fetchUpcoming(league) {
  const today = new Date();
  const future = new Date();
  future.setDate(today.getDate() + 180); // 6-month window for past/test seasons

  const resp = await apiGet('/fixtures', {
    league: league.id,
    season: CONFIG.season,
    from: toYYYYMMDD(today),
    to: toYYYYMMDD(future),
  });

  return resp.slice(0, CONFIG.upcomingPerLeague).map((f) => ({
    date: fmtDateTime(f.fixture.date),
    league: league.name,
    home: mapName(f.teams.home.name),
    away: mapName(f.teams.away.name),
  }));
}

// Recently finished fixtures using date range (Free plan compatible)
async function fetchFinished(league) {
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 365); // 1-year past window for historical season data

  const resp = await apiGet('/fixtures', {
    league: league.id,
    season: CONFIG.season,
    from: toYYYYMMDD(past),
    to: toYYYYMMDD(today),
  });

  return resp
    .filter((f) => f.goals.home != null && f.goals.away != null)
    .slice(-CONFIG.finishedPerLeague)
    .map((f) => ({
      date: fmtDate(f.fixture.date),
      league: league.name,
      home: mapName(f.teams.home.name),
      away: mapName(f.teams.away.name),
      fh: f.goals.home,
      fa: f.goals.away,
    }));
}

/* --------------------------- RATING MATH ---------------------------------- */
function buildTeams(perLeagueStats) {
  const teams = {};
  let totalGoals = 0, totalPlayed = 0;

  perLeagueStats.forEach(({ rows }) => {
    rows.forEach((r) => { totalGoals += r.gf; totalPlayed += r.played; });
  });
  const perSideAvg = totalPlayed ? totalGoals / totalPlayed : 1.35;
  const leagueAvgGoals = +(2 * perSideAvg).toFixed(2);

  const clamp = (v) => Math.max(CONFIG.minRating, +v.toFixed(2));
  perLeagueStats.forEach(({ league, rows }) => {
    rows.forEach((r) => {
      if (!r.played) return;
      teams[r.name] = {
        att: clamp((r.gf / r.played) / perSideAvg),
        def: clamp((r.ga / r.played) / perSideAvg),
        league: league.name,
      };
    });
  });
  return { teams, leagueAvgGoals };
}

function computeHomeAdvantage(history) {
  let hg = 0, ag = 0;
  history.forEach((m) => { hg += m.fh; ag += m.fa; });
  if (!ag) return 1.15;
  const ratio = hg / ag;
  return +Math.min(1.35, Math.max(1.0, ratio)).toFixed(2);
}

/* --------------------------- SERIALISATION --------------------------------*/
function serialize(DATA) {
  const json = JSON.stringify(DATA, null, 2);
  return (
    '/* AUTO-GENERATED by fetch-data.js on ' + new Date().toISOString() + '\n' +
    '   Source: API-Football (api-sports.io). Do not edit by hand \u2014 re-run the\n' +
    '   script to refresh. Each team att/def rating is normalised so 1.0 = league\n' +
    '   average, exactly as window.DATA expects. */\n' +
    'window.DATA = ' + json + ';\n'
  );
}

/* ------------------------------- MAIN -------------------------------------*/
async function main() {
  if (!API_KEY) {
    console.error('ERROR: Set API_FOOTBALL_KEY in GitHub Secrets or environment.');
    process.exit(1);
  }
  if (typeof fetch !== 'function') {
    console.error('ERROR: global fetch not found. Please run with Node.js 18 or newer.');
    process.exit(1);
  }
  const dry = process.argv.includes('--dry');

  const perLeagueStats = [];
  let fixtures = [];
  let history = [];

  for (const league of CONFIG.leagues) {
    console.log('Fetching ' + league.name + ' (id ' + league.id + ') ...');
    const rows = await fetchStandings(league);
    perLeagueStats.push({ league, rows });
    fixtures = fixtures.concat(await fetchUpcoming(league));
    history = history.concat(await fetchFinished(league));
  }

  const { teams, leagueAvgGoals } = buildTeams(perLeagueStats);
  const homeAdvantage = computeHomeAdvantage(history);

  const known = (n) => Object.prototype.hasOwnProperty.call(teams, n);
  fixtures = fixtures.filter((f) => known(f.home) && known(f.away));
  history = history.filter((m) => known(m.home) && known(m.away));
  fixtures.sort((a, b) => a.date.localeCompare(b.date));
  history.sort((a, b) => b.date.localeCompare(a.date));

  const DATA = {
    leagueAvgGoals,
    homeAdvantage,
    teams,
    fixtures,
    history,
    popularLeagues: POPULAR_LEAGUES,
    countries: COUNTRIES,
  };

  const out = serialize(DATA);
  console.log('\nSummary: ' + Object.keys(teams).length + ' teams, ' +
    fixtures.length + ' upcoming fixtures, ' + history.length + ' finished matches.');
  console.log('leagueAvgGoals=' + leagueAvgGoals + '  homeAdvantage=' + homeAdvantage);

  if (dry) { console.log('\n--- data.js (dry run) ---\n' + out); return; }
  const target = path.join(__dirname, 'data.js');
  fs.writeFileSync(target, out, 'utf8');
  console.log('\nWrote ' + target);
}

main().catch((err) => { console.error('\nFailed:', err.message); process.exit(1); });
