function denied() {
  return Object.assign(new Error('Meta denied form access'), {code:'forms_permission'});
}
async function metaGet(url, token, request) {
  const response = await request(url, {headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
  if (!response.ok) {
    const body = await response.json().catch(()=>({}));
    if (body?.error?.code === 10 || body?.error?.code === 200 || body?.error?.code === 190) throw denied();
    throw new Error('Meta unavailable');
  }
  return response.json();
}
export async function listMetaForms(userToken, pageId, request = fetch) {
  if (!/^\d{1,32}$/.test(pageId)) throw new Error('Invalid page');
  const pageUrl = new URL(`https://graph.facebook.com/v27.0/${pageId}`);
  pageUrl.searchParams.set('fields','access_token');
  const page = await metaGet(pageUrl,userToken,request);
  if (typeof page.access_token !== 'string' || !page.access_token) throw denied();
  const forms=[]; const ids=new Set(); const cursors=new Set(); let cursor='';
  for (let i=0;i<10;i++) {
    const url=new URL(`https://graph.facebook.com/v27.0/${pageId}/leadgen_forms`);
    url.searchParams.set('fields','id,name,status'); url.searchParams.set('limit','100');
    if (cursor) url.searchParams.set('after',cursor);
    const data=await metaGet(url,page.access_token,request);
    if (!Array.isArray(data.data)) throw new Error('Invalid Meta response');
    for (const form of data.data) {
      if (typeof form.id !== 'string' || !/^\d{1,32}$/.test(form.id) || typeof form.name !== 'string' || !form.name.trim() || form.name.length>300 || ids.has(form.id)) throw new Error('Invalid Meta response');
      ids.add(form.id);
      forms.push({id:form.id,name:form.name,status:typeof form.status === 'string' && /^[A-Z_]{1,30}$/.test(form.status) ? form.status : ''});
    }
    if (forms.length>500) throw new Error('Too many forms');
    if (!data.paging?.next) return forms;
    const next=data.paging?.cursors?.after;
    if (typeof next !== 'string' || !next || cursors.has(next)) throw new Error('Invalid pagination');
    cursors.add(next);cursor=next;
  }
  throw new Error('Meta pagination limit');
}
