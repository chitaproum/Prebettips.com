/* PreBetTips — sample dataset (demo).
   Team att/def ratings are normalised to the league average (1.00 = average).
   att > 1 => scores more than average; def < 1 => concedes less than average.
   Replace this file with real figures (e.g. via fetch-data.js) to go live.
   NOTE: this is sample data for a demonstration app — not betting advice. */
window.DATA = {
  leagueAvgGoals: 2.7,
  homeAdvantage: 1.15,

  teams: {
    /* Premier League */
    "Man City":{att:1.45,def:0.70,league:"Premier League"},
    "Arsenal":{att:1.35,def:0.72,league:"Premier League"},
    "Liverpool":{att:1.38,def:0.78,league:"Premier League"},
    "Tottenham":{att:1.20,def:0.95,league:"Premier League"},
    "Chelsea":{att:1.10,def:0.98,league:"Premier League"},
    "Man United":{att:1.05,def:1.00,league:"Premier League"},
    "Brighton":{att:1.00,def:1.05,league:"Premier League"},
    "Everton":{att:0.82,def:1.18,league:"Premier League"},
    "Burnley":{att:0.75,def:1.30,league:"Premier League"},
    "Sheffield Utd":{att:0.70,def:1.40,league:"Premier League"},
    /* La Liga */
    "Real Madrid":{att:1.42,def:0.72,league:"La Liga"},
    "Barcelona":{att:1.35,def:0.80,league:"La Liga"},
    "Atletico":{att:1.18,def:0.82,league:"La Liga"},
    "Girona":{att:1.10,def:0.98,league:"La Liga"},
    "Sevilla":{att:0.95,def:1.05,league:"La Liga"},
    "Getafe":{att:0.80,def:1.08,league:"La Liga"},
    "Cadiz":{att:0.72,def:1.25,league:"La Liga"},
    "Almeria":{att:0.68,def:1.38,league:"La Liga"},
    /* Serie A */
    "Inter":{att:1.40,def:0.74,league:"Serie A"},
    "Juventus":{att:1.20,def:0.78,league:"Serie A"},
    "Milan":{att:1.22,def:0.85,league:"Serie A"},
    "Napoli":{att:1.25,def:0.88,league:"Serie A"},
    "Roma":{att:1.08,def:0.95,league:"Serie A"},
    "Lazio":{att:1.05,def:0.98,league:"Serie A"},
    "Salernitana":{att:0.72,def:1.30,league:"Serie A"},
    "Empoli":{att:0.75,def:1.22,league:"Serie A"}
  },

  /* Upcoming fixtures (date: 'YYYY-MM-DD HH:MM', 24h) */
  fixtures: [
    {home:"Man City",   away:"Burnley",       league:"Premier League", date:"2026-09-26 15:00"},
    {home:"Juventus",   away:"Salernitana",   league:"Serie A",        date:"2026-09-26 20:45"},
    {home:"Barcelona",  away:"Almeria",       league:"La Liga",        date:"2026-09-26 18:30"},
    {home:"Tottenham",  away:"Brighton",      league:"Premier League", date:"2026-09-27 14:00"},
    {home:"Real Madrid",away:"Getafe",        league:"La Liga",        date:"2026-09-27 21:00"},
    {home:"Inter",      away:"Empoli",        league:"Serie A",        date:"2026-09-27 18:00"},
    {home:"Arsenal",    away:"Everton",       league:"Premier League", date:"2026-09-28 17:30"},
    {home:"Chelsea",    away:"Liverpool",     league:"Premier League", date:"2026-09-28 20:00"},
    {home:"Atletico",   away:"Sevilla",       league:"La Liga",        date:"2026-09-28 20:00"},
    {home:"Milan",      away:"Roma",          league:"Serie A",        date:"2026-09-28 20:45"},
    {home:"Man United", away:"Sheffield Utd", league:"Premier League", date:"2026-09-29 19:45"},
    {home:"Girona",     away:"Cadiz",         league:"La Liga",        date:"2026-09-29 19:00"},
    {home:"Napoli",     away:"Lazio",         league:"Serie A",        date:"2026-09-29 20:45"}
  ],

  /* Settled results used by the Results & Accuracy page */
  history: [
    {date:"2026-09-20", home:"Arsenal",     away:"Tottenham",   league:"Premier League", fh:2, fa:1},
    {date:"2026-09-20", home:"Liverpool",   away:"Man United",  league:"Premier League", fh:3, fa:1},
    {date:"2026-09-19", home:"Everton",     away:"Burnley",     league:"Premier League", fh:1, fa:1},
    {date:"2026-09-19", home:"Chelsea",     away:"Brighton",    league:"Premier League", fh:2, fa:2},
    {date:"2026-09-13", home:"Real Madrid", away:"Barcelona",   league:"La Liga",        fh:2, fa:1},
    {date:"2026-09-13", home:"Atletico",    away:"Girona",      league:"La Liga",        fh:1, fa:0},
    {date:"2026-09-12", home:"Sevilla",     away:"Getafe",      league:"La Liga",        fh:0, fa:0},
    {date:"2026-09-06", home:"Inter",       away:"Milan",       league:"Serie A",        fh:2, fa:1},
    {date:"2026-09-06", home:"Napoli",      away:"Juventus",    league:"Serie A",        fh:1, fa:2},
    {date:"2026-09-05", home:"Roma",        away:"Lazio",       league:"Serie A",        fh:1, fa:1}
  ],

  popularLeagues: [
    {name:"Premier League", icon:"\ud83c\uddec\ud83c\udde7"},
    {name:"La Liga",        icon:"\ud83c\uddea\ud83c\uddf8"},
    {name:"Serie A",        icon:"\ud83c\uddee\ud83c\uddf9"},
    {name:"Bundesliga",     icon:"\ud83c\udde9\ud83c\uddea"},
    {name:"Ligue 1",        icon:"\ud83c\uddeb\ud83c\uddf7"}
  ],

  countries: [
    "England","Spain","Italy","Germany","France","Netherlands",
    "Portugal","Belgium","Turkey","Brazil","Argentina","USA"
  ]
};
