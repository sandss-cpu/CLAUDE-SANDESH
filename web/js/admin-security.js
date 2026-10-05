/* ===========================================================================
   Security events: failed and locked sign-ins, new devices, account and role changes,
   exports of personal or financial data, QR code rotations, finance edits and looks
   at verification documents. Read from the API's one audit table.

   A classic script loaded after admin.js, sharing its globals (state, api, esc,
   renderMain, SECTIONS, SCREENS, Actions, fmtDate).
   =========================================================================== */

state.security = { kind: '', page: 1 };

const SECURITY_KIND = {
  '': 'Everything', signin: 'Sign-in', accounts: 'Accounts and roles', exports: 'Exports',
  qr: 'QR codes', finance: 'Income records', verification: 'Verification',
};
const SECURITY_ACTION = {
  'auth.failed': 'Failed sign-in', 'auth.locked': 'Sign-in locked', 'auth.new_device': 'New device',
  'auth.recovery_code': 'Recovery code used', 'auth.password_reset': 'Password reset', 'auth.logout_all': 'Signed out everywhere',
  'auth.mfa_enabled': 'Authenticator set up', 'auth.recovery_codes': 'New recovery codes',
  'user.role': 'Role changed', 'user.reset_mfa': 'Authenticator reset', 'user.suspend': 'Suspended', 'user.unsuspend': 'Unsuspended',
  'account.delete': 'Account deleted', 'account.export': 'Account data downloaded', 'newsletter.export': 'Newsletter list downloaded',
  'income.export': 'Income report downloaded', 'qr.rotate': 'QR code replaced', 'trip.unlock': 'Trip unlocked',
  'verification.view': 'Document opened', 'verification.upload': 'Document uploaded', 'verification.delete': 'Document deleted',
  'business.verify': 'Listing verified', 'business.tier': 'Tier changed',
};
/** Worth a second look at a glance. */
const SECURITY_ALERT = new Set(['auth.locked', 'auth.recovery_code', 'user.role', 'user.reset_mfa', 'account.delete', 'trip.unlock']);

async function screenSecurity(){
  const s = state.security;
  const q = new URLSearchParams({ page: String(s.page), ...(s.kind ? { kind: s.kind } : {}) });
  const r = await api(`/admin/security-events?${q}`);
  const n = (a) => r.last24h[a] || 0;
  return `
    <div class="top-row"><h2>Security events</h2></div>
    <div class="stat-grid">
      <div class="stat"><b>${n('auth.failed')}</b><span>Failed sign-ins, last 24 hours</span></div>
      <div class="stat"><b>${n('auth.locked')}</b><span>Sign-ins locked, last 24 hours</span></div>
      <div class="stat"><b>${n('auth.new_device')}</b><span>Sign-ins from a new device</span></div>
      <div class="stat"><b>${n('account.export') + n('newsletter.export') + n('income.export')}</b><span>Data downloads</span></div>
    </div>
    <div class="filters">
      <select aria-label="Which events" data-change="securityKind">
        ${Object.entries(SECURITY_KIND).map(([k, v]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    ${!r.items.length ? '<div class="empty">Nothing recorded.</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>What</th><th>Who</th><th>Detail</th><th>From</th></tr></thead>
        <tbody>${r.items.map((e) => `<tr>
          <td><small>${fmtDate(e.createdAt)}</small></td>
          <td>${SECURITY_ALERT.has(e.action) ? '<span class="pill REJECTED">!</span> ' : ''}<b>${esc(SECURITY_ACTION[e.action] || e.action)}</b>
            <div class="sec-kind">${esc(SECURITY_KIND[e.kind] || e.kind)}</div></td>
          <td>${e.actor ? `${esc(e.actor.name)}${e.actor.role ? `<div class="hint">${esc(e.actor.role.toLowerCase())}</div>` : ''}` : '<span class="hint">—</span>'}</td>
          <td>${esc(e.summary)}</td>
          <td>${e.from ? `<code title="Start of the hashed address: the same code means the same place">${esc(e.from)}</code>` : '<span class="hint">—</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      ${r.pages > 1 ? `<div class="row-actions site-gap">
        ${s.page > 1 ? '<button class="btn btn-sm" data-action="securityPage" data-by="-1">← Newer</button>' : ''}
        <span class="hint">Page ${r.page} of ${r.pages}</span>
        ${s.page < r.pages ? '<button class="btn btn-sm" data-action="securityPage" data-by="1">Older →</button>' : ''}</div>` : ''}`}
    <p class="hint">Addresses are never stored, only a salted hash; "From" shows its first characters so repeated attempts from one place stand out.
      After 13 months the hashes are cleared.</p>`;
}

Actions.on({ securityPage: (el) => { state.security.page = Math.max(1, state.security.page + Number(el.dataset.by)); renderMain(); } });
Actions.onChange({ securityKind: (el) => { state.security.kind = el.value; state.security.page = 1; renderMain(); } });

SECTIONS.splice(SECTIONS.findIndex(([k]) => k === 'users') + 1, 0, ['security', 'Security events', ['ADMIN']]);
SCREENS.security = screenSecurity;
