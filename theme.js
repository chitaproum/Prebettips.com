/* Apply saved / preferred theme before first paint (avoids a flash). */
(function () {
  var t = null;
  try { t = localStorage.getItem('pbt-theme'); } catch (e) {}
  if (!t && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark';
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
})();
