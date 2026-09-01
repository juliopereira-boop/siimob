// ─── Supabase connection ─────────────────────────────────────────────────────
// Replace these two values with your project's URL and anon key.
// NEVER put the service role key here — that stays server-side only.
const A1_URL = 'https://hmedoyrxcqgkkasivbsn.supabase.co';
const A1_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtZWRveXJ4Y3Fna2thc2l2YnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjQyMjUsImV4cCI6MjA5NzkwMDIyNX0.h3TspQHP6u9RN2inS8tUcpnkuVW3ymYNiWVJGJyQvaY';

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
    try {
      const u = JSON.parse(localStorage.getItem('a1_user') || 'null');
      // permissions é jsonb e normalmente chega como objeto. Se por qualquer
      // caminho vier como texto, todo `p.gerente` do sistema daria undefined e
      // a pessoa seria silenciosamente rebaixada. Normaliza num lugar só.
      if (u && typeof u.permissions === 'string') {
        try { u.permissions = JSON.parse(u.permissions); } catch { u.permissions = {}; }
      }
      return u;
    }
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
  },

  // Apelido de rest(). Os cadastros de despachantes, bancos e cartórios chamam
  // A1.tbl(), que nunca existiu — as três telas quebravam antes da primeira
  // requisição, sem listar e sem salvar.
  tbl(table) {
    return this.rest(table);
  },

  // ─── Leitura completa, em páginas ───────────────────────────────────────────
  // O PostgREST tem teto de linhas por resposta (1.000 no padrão do Supabase).
  // Uma consulta que passe disso volta CORTADA, com status 206 — e quem só olha
  // o corpo da resposta não percebe: o sistema mostra mil processos achando que
  // são todos. Com 74 processos isso é invisível; num cliente grande, o painel
  // e o relatório passam a mentir sem ninguém notar.
  //
  // Aqui a leitura vai até o fim, uma faixa por vez, e devolve junto quantos o
  // banco disse que existem. Se bater no teto de segurança, avisa em vez de
  // entregar um pedaço como se fosse o todo.
  async buscarTudo(url, opcoes = {}) {
    const tamanho = opcoes.tamanho || 1000;
    const tetoSeguranca = opcoes.teto || 50000;
    const linhas = [];
    let total = null, inicio = 0;

    for (;;) {
      const res = await fetch(url, {
        headers: this.headers({
          'Range-Unit': 'items',
          'Range': `${inicio}-${inicio + tamanho - 1}`,
          'Prefer': 'count=exact'
        })
      });
      if (!res.ok && res.status !== 206) {
        return { linhas, total: total ?? linhas.length, completo: false, erro: 'HTTP ' + res.status };
      }
      const parte = await res.json().catch(() => []);
      if (!Array.isArray(parte)) {
        return { linhas, total: total ?? linhas.length, completo: false, erro: 'resposta inesperada' };
      }
      linhas.push(...parte);

      // "0-999/2600" — o número depois da barra é o total de verdade.
      const faixa = res.headers.get('content-range') || '';
      const t = parseInt((faixa.split('/')[1] || ''), 10);
      if (!isNaN(t)) total = t;

      if (parte.length < tamanho) break;                 // acabou
      if (total != null && linhas.length >= total) break; // já tem tudo
      inicio += tamanho;
      if (linhas.length >= tetoSeguranca) {
        return { linhas, total: total ?? linhas.length, completo: false, erro: 'volume acima do teto' };
      }
    }
    return { linhas, total: total ?? linhas.length, completo: true, erro: null };
  },

  // ─── Storage (arquivos) — separado das tabelas do banco ─────────────────────
  // Uploads (documentos anexados, etc.) vão para o Storage do Supabase, não
  // para colunas de tabela. Cada objeto vive em '{bucket}/{tenant_id}/...';
  // as políticas do bucket isolam por tenant usando o mesmo token de sessão.
  async storageUpload(bucket, path, file) {
    const res = await fetch(`${A1_URL}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        'apikey': A1_KEY,
        'Authorization': `Bearer ${A1_KEY}`,
        'x-session-token': this.token,
        'x-upsert': 'true',
        'Content-Type': (file && file.type) || 'application/octet-stream'
      },
      body: file
    });
    return res.ok;
  },

  async storageSignedUrl(bucket, path, expiresIn = 60) {
    try {
      const res = await fetch(`${A1_URL}/storage/v1/object/sign/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          'apikey': A1_KEY,
          'Authorization': `Bearer ${A1_KEY}`,
          'x-session-token': this.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.signedURL ? `${A1_URL}/storage/v1${data.signedURL}` : null;
    } catch { return null; }
  },

  async storageRemove(bucket, path) {
    try {
      await fetch(`${A1_URL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: {
          'apikey': A1_KEY,
          'Authorization': `Bearer ${A1_KEY}`,
          'x-session-token': this.token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prefixes: [path] })
      });
    } catch {}
  }
};
