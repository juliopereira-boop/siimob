const endpoint = 'https://www.googleapis.com/calendar/v3';
const client_id = Deno.env.get('SIIMOB_GOOGLE_CLIENT_ID') || '';
const client_secret = Deno.env.get('SIIMOB_GOOGLE_CLIENT_SECRET') || '';
const redirect_uri = (Deno.env.get('SUPABASE_URL') || '') + '/functions/v1/elia';
const scope =
  'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy';

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('O Google Agenda recusou a operação.');
  return response.status === 204 ? null : response.json();
}

export const googleConfigured = Boolean(
  client_id && client_secret && Deno.env.get('SIIMOB_ELIA_ENCRYPTION_KEY')
);
export const digest = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');

async function encryptionKey() {
  const secret = Deno.env.get('SIIMOB_ELIA_ENCRYPTION_KEY') || '';
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw Error('Chave de criptografia da agenda inválida.');
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(secret.match(/../g)!, byte => parseInt(byte, 16)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    new TextEncoder().encode(value)
  );
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(bytes)));
}

async function decrypt(value: string) {
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await encryptionKey(),
      bytes.slice(12)
    )
  );
}

export function authorization(state: string) {
  if (!googleConfigured) throw Error('A integração Google ainda não foi configurada.');
  return (
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id,
      redirect_uri,
      scope,
      state,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent'
    })
  );
}

function token(params: Record<string, string>) {
  return request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id, client_secret, ...params })
  });
}

export async function exchange(code: string) {
  const data = await token({ grant_type: 'authorization_code', code, redirect_uri });
  if (!data.refresh_token) throw Error('O Google não retornou acesso offline.');
  return encrypt(data.refresh_token);
}

export async function calendar(refresh: string, calendarId: string) {
  const { access_token } = await token({
    grant_type: 'refresh_token',
    refresh_token: await decrypt(refresh)
  });
  const root = '/calendars/' + encodeURIComponent(calendarId) + '/events';
  return (path: string, method = 'GET', body?: unknown) =>
    request(endpoint + (path.startsWith('/') ? path : root + path), {
      method,
      headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
}
