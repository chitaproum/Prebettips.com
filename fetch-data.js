// Data fetcher layer to retrieve or provide mock match records
function getMatchData() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        group1: mockMatchesGroup1,
        group2: mockMatchesGroup2
      });
    }, 100);
  });
}