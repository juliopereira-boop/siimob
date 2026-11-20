// Never follow Meta's paging URL; use its cursor with a fixed Graph origin.
// withTokens: also returns each Page token, only for subscribing the Page to
// lead notices. It stays server-side and is never returned to the browser.
export const listMetaPagesWithTokens = (token, request = fetch) => listMetaPages(token, request, true);
export async function listMetaPages(token, request = fetch, withTokens = false) {
  const pages = [];
  const seen = new Set();
  const cursors = new Set();
  let cursor = '';
  for (let i = 0; i < 10; i++) {
    const url = new URL('https://graph.facebook.com/v27.0/me/accounts');
    url.searchParams.set('fields', withTokens ? 'id,name,access_token' : 'id,name');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('after', cursor);
    const res = await request(url, {headers:{Authorization:`Bearer ${token}`, Accept:'application/json'}, redirect:'error'});
    if (!res.ok) throw new Error('Meta pages unavailable');
    const data = await res.json();
    if (!Array.isArray(data.data)) throw new Error('Invalid Meta response');
    for (const page of data.data) {
      if (typeof page.id !== 'string' || !/^\d{1,32}$/.test(page.id) || typeof page.name !== 'string' || !page.name.trim() || page.name.length > 300 || seen.has(page.id)) throw new Error('Invalid Meta response');
      seen.add(page.id); pages.push({id:page.id,name:page.name,...(withTokens && typeof page.access_token === 'string' && page.access_token ? {access_token:page.access_token} : {})});
    }
    if (pages.length > 500) throw new Error('Too many pages');
    if (!data.paging?.next) return pages;
    const nextCursor = data.paging?.cursors?.after;
    if (typeof nextCursor !== 'string' || !nextCursor || cursors.has(nextCursor)) throw new Error('Invalid Meta pagination');
    cursors.add(nextCursor); cursor = nextCursor;
  }
  throw new Error('Meta pagination limit');
}
