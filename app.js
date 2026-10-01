document.addEventListener('DOMContentLoaded', () => {
  if (typeof getMatchData === 'function') {
    getMatchData().then(data => {
      renderTable(data.group1, 'match-table-body');
      renderTable(data.group2, 'match-table-body-bottom');
    });
  } else {
    renderTable(mockMatchesGroup1, 'match-table-body');
    renderTable(mockMatchesGroup2, 'match-table-body-bottom');
  }
  
  setupFilters();
});

function renderTable(matches, targetId) {
  const container = document.getElementById(targetId);
  if (!container) return;
  
  container.innerHTML = matches.map(m => `
    <tr>
      <td><input type="checkbox" class="pick-check"></td>
      <td style="color: var(--text-muted);">${m.date}</td>
      <td style="color: var(--text-muted);">${m.league}</td>
      <td class="col-match">${m.homeTeam} v ${m.awayTeam}</td>
      <td class="prob-cell">
        <span class="prob-val" style="color: #3fb950;">${m.probHome}%</span>
        <div class="prob-bar"><div class="prob-fill-green" style="width:${m.probHome}%"></div></div>
      </td>
      <td class="prob-cell">
        <span class="prob-val" style="color: var(--text-muted);">${m.probDraw}%</span>
        <div class="prob-bar"><div class="prob-fill-orange" style="width:${m.probDraw}%"></div></div>
      </td>
      <td class="prob-cell">
        <span class="prob-val" style="color: var(--text-muted);">${m.probAway}%</span>
        <div class="prob-bar"><div class="prob-fill-red" style="width:${m.probAway}%"></div></div>
      </td>
      <td>
        <div class="tip-box">
          ${m.predictedTip}
          <span class="tip-score">${m.predictedScore}</span>
        </div>
      </td>
      <td><input type="checkbox"></td>
    </tr>
  `).join('');
}

function setupFilters() {
  const leagueSelect = document.getElementById('league-select');
  const searchInput = document.getElementById('global-search');

  function filterData() {
    const leagueVal = leagueSelect ? leagueSelect.value : 'all';
    const query = searchInput ? searchInput.value.toLowerCase() : '';

    const filterFn = m => {
      const matchLeague = leagueVal === 'all' || m.league === leagueVal;
      const matchSearch = m.homeTeam.toLowerCase().includes(query) || m.awayTeam.toLowerCase().includes(query);
      return matchLeague && matchSearch;
    };

    renderTable(mockMatchesGroup1.filter(filterFn), 'match-table-body');
    renderTable(mockMatchesGroup2.filter(filterFn), 'match-table-body-bottom');
  }

  if (leagueSelect) leagueSelect.addEventListener('change', filterData);
  if (searchInput) searchInput.addEventListener('input', filterData);
}