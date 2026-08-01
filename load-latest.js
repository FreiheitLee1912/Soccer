/* Load the newest committed country data before rendering the board.
   The timestamp bypasses CDN/browser caches on every visit. Data refreshes
   themselves are performed safely by GitHub Actions; no secret is exposed. */
(() => {
  const loader = document.currentScript;
  const status = document.getElementById('sub');
  const stamp = Date.now();
  const fail = () => {
    document.body.classList.remove('data-loading');
    document.body.classList.add('data-load-error');
    if (status) status.textContent = loader.dataset.error || 'Unable to load the latest data.';
  };
  const load = (src, done) => {
    const script = document.createElement('script');
    script.src = `${src}?v=${stamp}`;
    script.onload = done;
    script.onerror = fail;
    document.body.appendChild(script);
  };
  if (status) status.textContent = loader.dataset.loading || 'Loading latest data…';
  load(loader.dataset.file, () => {
    if (!window.TRANSFER_DATA) return fail();
    load('app.js', () => document.body.classList.remove('data-loading'));
  });
})();
