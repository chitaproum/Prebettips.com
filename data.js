/* Sample dataset. In a real deployment this comes from an API/database.
   Each team has an attack & defence rating (1.0 = league average). */
window.DATA = {
  leagueAvgGoals: 2.7,      // avg total goals per match in the sample leagues
  homeAdvantage: 1.15,      // multiplier applied to the home side's expected goals

  teams: {
    // Premier League
    "Man City":     {att:1.75, def:0.70, league:"Premier League"},
    "Arsenal":      {att:1.55, def:0.72, league:"Premier League"},
    "Liverpool":    {att:1.60, def:0.80, league:"Premier League"},
    "Tottenham":    {att:1.40, def:1.05, league:"Premier League"},
    "Chelsea":      {att:1.30, def:0.95, league:"Premier League"},
    "Man United":   {att:1.25, def:1.00, league:"Premier League"},
    "Brighton":     {att:1.20, def:1.05, league:"Premier League"},
    "Everton":      {att:0.85, def:1.15, league:"Premier League"},
    "Burnley":      {att:0.75, def:1.35, league:"Premier League"},
    "Sheffield Utd":{att:0.65, def:1.55, league:"Premier League"},
    // La Liga
    "Real Madrid":  {att:1.70, def:0.68, league:"La Liga"},
    "Barcelona":    {att:1.60, def:0.82, league:"La Liga"},
    "Atletico":     {att:1.35, def:0.75, league:"La Liga"},
    "Girona":       {att:1.40, def:1.00, league:"La Liga"},
    "Sevilla":      {att:1.05, def:1.05, league:"La Liga"},
    "Getafe":       {att:0.90, def:1.00, league:"La Liga"},
    "Cadiz":        {att:0.70, def:1.30, league:"La Liga"},
    "Almeria":      {att:0.80, def:1.45, league:"La Liga"},
    // Serie A
    "Inter":        {att:1.65, def:0.70, league:"Serie A"},
    "Juventus":     {att:1.30, def:0.72, league:"Serie A"},
    "Milan":        {att:1.40, def:0.90, league:"Serie A"},
    "Napoli":       {att:1.45, def:0.95, league:"Serie A"},
    "Roma":         {att:1.25, def:0.98, league:"Serie A"},
    "Lazio":        {att:1.15, def:0.95, league:"Serie A"},
    "Salernitana":  {att:0.70, def:1.50, league:"Serie A"},
    "Empoli":       {att:0.78, def:1.25, league:"Serie A"}
  },

  // Upcoming fixtures (no result yet)
  fixtures: [
    {date:"2026-09-28 15:00", league:"Premier League", home:"Man City",   away:"Burnley"},
    {date:"2026-09-28 17:30", league:"Premier League", home:"Arsenal",    away:"Everton"},
    {date:"2026-09-28 20:00", league:"Premier League", home:"Chelsea",    away:"Liverpool"},
    {date:"2026-09-29 14:00", league:"Premier League", home:"Man United", away:"Brighton"},
    {date:"2026-09-29 16:30", league:"Premier League", home:"Tottenham",  away:"Sheffield Utd"},
    {date:"2026-09-28 16:15", league:"La Liga",        home:"Real Madrid",away:"Almeria"},
    {date:"2026-09-28 18:30", league:"La Liga",        home:"Barcelona",  away:"Sevilla"},
    {date:"2026-09-29 20:00", league:"La Liga",        home:"Atletico",   away:"Getafe"},
    {date:"2026-09-29 21:00", league:"La Liga",        home:"Girona",     away:"Cadiz"},
    {date:"2026-09-28 18:00", league:"Serie A",        home:"Inter",      away:"Salernitana"},
    {date:"2026-09-28 20:45", league:"Serie A",        home:"Milan",      away:"Roma"},
    {date:"2026-09-29 19:00", league:"Serie A",        home:"Napoli",     away:"Empoli"},
    {date:"2026-09-29 20:45", league:"Serie A",        home:"Juventus",   away:"Lazio"}
  ],

  // Past fixtures with actual results (to show model accuracy)
  history: [
    {date:"2026-09-21", league:"Premier League", home:"Man City",   away:"Everton",       fh:3, fa:0},
    {date:"2026-09-21", league:"Premier League", home:"Liverpool",  away:"Burnley",       fh:2, fa:1},
    {date:"2026-09-22", league:"Premier League", home:"Arsenal",    away:"Man United",    fh:1, fa:1},
    {date:"2026-09-22", league:"Premier League", home:"Brighton",   away:"Sheffield Utd", fh:2, fa:0},
    {date:"2026-09-21", league:"La Liga",        home:"Real Madrid",away:"Getafe",        fh:2, fa:0},
    {date:"2026-09-22", league:"La Liga",        home:"Barcelona",  away:"Cadiz",         fh:3, fa:1},
    {date:"2026-09-22", league:"La Liga",        home:"Sevilla",    away:"Almeria",       fh:1, fa:1},
    {date:"2026-09-21", league:"Serie A",        home:"Inter",      away:"Empoli",        fh:2, fa:0},
    {date:"2026-09-22", league:"Serie A",        home:"Napoli",     away:"Salernitana",   fh:4, fa:1},
    {date:"2026-09-22", league:"Serie A",        home:"Juventus",   away:"Roma",          fh:1, fa:0}
  ],

  // Popular leagues shown in the sidebar (icon + name). Counts are computed
  // live from `fixtures`; leagues with no fixtures still show with a 0/–.
  popularLeagues: [
    {name:"UEFA Champions League", icon:"\u26bd"},
    {name:"UEFA Europa League",    icon:"\ud83c\udfc6"},
    {name:"Premier League",        icon:"\ud83c\udff4"},
    {name:"La Liga",               icon:"\ud83c\uddea\ud83c\uddf8"},
    {name:"Bundesliga",            icon:"\ud83c\udde9\ud83c\uddea"},
    {name:"Serie A",               icon:"\ud83c\uddee\ud83c\uddf9"},
    {name:"Ligue 1",               icon:"\ud83c\uddeb\ud83c\uddf7"},
    {name:"Eredivisie",            icon:"\ud83c\uddf3\ud83c\uddf1"},
    {name:"Liga Portugal",         icon:"\ud83c\uddf5\ud83c\uddf9"},
    {name:"Brasileiro Serie A",    icon:"\ud83c\udde7\ud83c\uddf7"},
    {name:"Scottish Premiership",  icon:"\ud83c\udff4"},
    {name:"S\u00fcper Lig",            icon:"\ud83c\uddf9\ud83c\uddf7"},
    {name:"Saudi Pro League",      icon:"\ud83c\uddf8\ud83c\udde6"}
  ],

  countries: [
    "Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina",
    "Armenia","Australia","Austria","Belgium","Brazil","Bulgaria","Chile",
    "China","Colombia","Croatia","Denmark","England","France","Germany",
    "Greece","Italy","Japan","Mexico","Netherlands","Norway","Poland",
    "Portugal","Saudi Arabia","Scotland","Spain","Sweden","Switzerland",
    "Turkey","USA"
  ]
};
