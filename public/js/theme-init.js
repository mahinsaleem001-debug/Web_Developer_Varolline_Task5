// Sets the theme before the page paints (no flash). Kept as a file because the CSP blocks inline scripts.
(function () {
  try {
    var t = localStorage.getItem('inkwell-theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();
