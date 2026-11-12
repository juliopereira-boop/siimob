import { createHandler } from './handler.mjs';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const handler = createHandler({
  verifyToken: Deno.env.get('SIIMOB_META_VERIFY_TOKEN') || '',
  appSecret: Deno.env.get('SIIMOB_META_APP_SECRET') || '',
  async saveEvents(events: Array<{page_id: string; leadgen_id: string; form_id: string}>) {
    if (!supabaseUrl || !serviceKey) throw new Error('Database unavailable');
    const url = new URL('/rest/v1/siimob_meta_webhook_events', supabaseUrl);
    url.searchParams.set('on_conflict', 'page_id,leadgen_id');
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(events),
    });
    if (!res.ok) throw new Error('Event storage failed');
  },
});

Deno.serve(handler);
