/* preview.html: what is running locally. */
/* Live checks, so the page says what is actually up rather than assuming. */
const API = (window.BATO_CONFIG && window.BATO_CONFIG.api) || 'http://localhost:3000/api/v1';

function mark(dot, label, ok, text){
  document.getElementById(dot).className = 'dot ' + (ok ? 'on' : 'off');
  document.getElementById(label).textContent = text;
}

// The public website runs on its own server; config.js says where.
const SITE = window.BATO_CONFIG && window.BATO_CONFIG.site;
if (SITE) document.getElementById('siteLink').href = SITE;

mark('dWeb', 'tWeb', location.protocol !== 'file:' && location.port === '5173',
  location.port === '5173' ? 'Web server on :5173' : `Served from ${location.host || 'file://'} — use :5173`);

(async () => {
  try{
    const res = await fetch(API.replace('/api/v1', '') + '/health', { signal: AbortSignal.timeout(3000) });
    mark('dApi', 'tApi', res.ok, res.ok ? 'API on :3000' : 'API answered ' + res.status);
  }catch(_){
    mark('dApi', 'tApi', false, 'API not running');
  }

  try{
    const res = await fetch(API + '/settings/theme', { signal: AbortSignal.timeout(3000) });
    const json = await res.json();
    const t = json && json.data;
    mark('dTheme', 'tTheme', !!t, t ? `Theme: ${t.themePalette} · ${t.themeBackground}` : 'Theme unavailable');
  }catch(_){
    mark('dTheme', 'tTheme', false, 'Theme unavailable');
  }
})();
