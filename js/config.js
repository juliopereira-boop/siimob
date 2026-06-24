// ─── Supabase connection ─────────────────────────────────────────────────────
// Replace these two values with your project's URL and anon key.
// NEVER put the service role key here — that stays server-side only.
const A1_URL = 'https://YOUR_PROJECT_REF.supabase.co';
const A1_KEY = 'YOUR_ANON_KEY';

// ─── Slug extraction from URL ─────────────────────────────────────────────────
// URL pattern: /slug/module  e.g. /construtora-abc/repasse
function getSlugFromURL() {
  const parts = window.location.pathname.replace(/^\//, '').split('/');
  return parts[0] || null;
}

// ─── Active session (populated by auth.js after login) ───────────────────────
const A1 = {
  get token()  { return localStorage.getItem('a1_token'); },
  get slug()   { return localStorage.getItem('a1_slug')  || getSlugFromURL(); },
  get user()   {
    try { return JSON.parse(localStorage.getItem('a1_user') || 'null'); }
    catch { return null; }
  },

  // Base headers for ALL Supabase REST calls
  headers(extra = {}) {
    return {
      'Content-Type':    'application/json',
      'apikey':          A1_KEY,
      'Authorization':  `Bearer ${A1_KEY}`,
      'x-session-token': this.token,
      ...extra
    };
  },

  // Upsert header (Supabase merge-duplicate pattern)
  upsertHeaders() {
    return this.headers({ 'Prefer': 'resolution=merge-duplicates,return=representation' });
  },

  returnHeaders() {
    return this.headers({ 'Prefer': 'return=representation' });
  },

  // Base REST URL
  rest(table) {
    return `${A1_URL}/rest/v1/${table}`;
  },

  rpc(fn) {
    return `${A1_URL}/rest/v1/rpc/${fn}`;
  }
};
