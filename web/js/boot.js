/* Starts the scan the moment the page arrives, rather than after the reader script has
   downloaded: on a weak signal that is seconds of a traveller staring at a blank bus.
   reader.js picks up the request from window.__batoScan when it boots.

   Deliberately tiny and dependency-free, and it never throws: if anything here fails,
   reader.js simply makes the request itself. */
(function () {
  try {
    var m = location.pathname.match(/^\/(?:b|r)\/([^/]+)\/?$/);
    var q = new URLSearchParams(location.search);
    var code = String(m ? decodeURIComponent(m[1]) : (q.get('c') || q.get('code') || '')).trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(code)) return;

    var api = (window.BATO_CONFIG && window.BATO_CONFIG.api) || localStorage.getItem('bato.api') || 'http://localhost:3000/api/v1';
    var sid = localStorage.getItem('bato.sid');
    if (!sid) { sid = 'sid_' + Math.random().toString(36).slice(2, 14); localStorage.setItem('bato.sid', sid); }

    // The direction this phone chose for this bus's route in the last 12 hours, if it knows the route.
    var body = { sessionId: sid };
    try {
      var saved = JSON.parse(localStorage.getItem('bato.scan') || 'null');
      var dir = JSON.parse(localStorage.getItem('bato.direction') || 'null');
      var routeId = saved && saved.code === code && saved.data && saved.data.route && saved.data.route.id;
      if (routeId && dir && dir.routeId === routeId && Date.now() - dir.at < 12 * 3600 * 1000) body.direction = dir.direction;
    } catch (_) { /* no remembered direction */ }

    window.__batoScan = {
      code: code,
      body: body,
      promise: fetch(api + '/qr/r/' + encodeURIComponent(code), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    };
  } catch (_) { /* reader.js will make the request */ }
})();
