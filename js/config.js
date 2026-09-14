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
  //
  // ── POR QUE NÃO É MAIS "Range: 20000-20999" ────────────────────────────────
  // Saltar por deslocamento parece paginar, mas não é: para entregar a página
  // 21, o banco precisa achar, ordenar e DESCARTAR as 20 mil linhas anteriores.
  // A página 1 custa uma página; a 21 custa vinte e uma. Somando, o custo de ler
  // tudo cresce com o QUADRADO do volume — medido nesta base com 40 mil
  // processos, só a primeira página levava 106 ms, e havia mais vinte depois
  // dela, cada uma pior que a anterior. É assim que uma tela que funciona com
  // 300 processos devolve HTTP 500 por estouro de tempo com 40 mil.
  //
  // A paginação por CHAVE não descarta nada: cada página pede "o que vem depois
  // do último que eu já vi", e o índice entra direto no ponto. Toda página custa
  // o mesmo, e ler tudo passa a crescer em linha reta com o volume.
  //
  // O desempate por `id` não é capricho: duas linhas podem ter o mesmo carimbo
  // de tempo (importação, criação em lote), e sem ele uma delas seria pulada ou
  // repetida a cada virada de página — erro que só aparece no cliente grande e
  // que ninguém consegue reproduzir depois.
  //
  // Quando a consulta não tem `order` de coluna única, ou já usa `or=`, ou não
  // traz `id`, o salto por deslocamento continua valendo: é o caminho de trás,
  // correto e mais lento, para as listas pequenas onde isso não pesa.
  //
  // ── E O TOTAL ──────────────────────────────────────────────────────────────
  // `count=exact` faz o banco percorrer TODAS as linhas que casam, não só a
  // página. Pedir isso em cada uma das 40 páginas é pagar a conta 40 vezes pelo
  // mesmo número. Agora ele é pedido UMA vez, na primeira página, e reusado.
  _chaveDeOrdem(url) {
    if (/[?&]or=/.test(url)) return null;             // `or=` próprio: não dá para somar o nosso
    const m = /[?&]order=([^&]+)/.exec(url);
    if (!m) return null;
    const partes = decodeURIComponent(m[1]).split(',');
    if (partes.length !== 1) return null;             // ordem composta: fora do escopo
    const [col, dir] = partes[0].split('.');
    if (!col || /\./.test(col)) return null;
    return { col, desc: (dir || 'asc').toLowerCase().startsWith('desc') };
  },

  async buscarTudo(url, opcoes = {}) {
    const tamanho = opcoes.tamanho || 1000;
    const tetoSeguranca = opcoes.teto || 50000;
    const linhas = [];
    let total = null, inicio = 0, marco = null, semChave = false;
    const chaveDaOrdem = opcoes.chave === false ? null : this._chaveDeOrdem(url);

    for (;;) {
      // Com chave, a faixa é sempre a primeira: quem anda é o filtro, não o
      // deslocamento. Sem chave, é o salto de antes.
      const de = marco ? 0 : inicio;
      const cabecalhos = { 'Range-Unit': 'items', 'Range': `${de}-${de + tamanho - 1}` };
      // O total é pedido só na primeira volta. Nas seguintes ele já é conhecido.
      if (total == null) cabecalhos['Prefer'] = 'count=exact';

      let alvo = url;
      if (marco) {
        const op = chaveDaOrdem.desc ? 'lt' : 'gt';
        // "veio depois deste carimbo, OU tem o mesmo carimbo e vem depois no id"
        const c = chaveDaOrdem.col;
        alvo += `&or=(${c}.${op}.${encodeURIComponent(marco.valor)},`
             +  `and(${c}.eq.${encodeURIComponent(marco.valor)},id.${op}.${encodeURIComponent(marco.id)}))`;
      }

      const res = await fetch(alvo, { headers: this.headers(cabecalhos) });
      if (!res.ok && res.status !== 206) {
        // A paginação por chave monta um filtro que o banco pode recusar (uma
        // coluna que não aceita comparação, um tipo inesperado). Se isso
        // acontecer, ela NÃO derruba a tela: volta para o salto por
        // deslocamento, que é o caminho antigo — mais lento, e correto. Uma
        // otimização que quebra a leitura é pior que a lentidão que ela cura.
        if (marco) {
          inicio = linhas.length;
          marco = null;
          semChave = true;
          continue;
        }
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
      if (!isNaN(t) && total == null) total = t;

      if (parte.length < tamanho) break;                 // acabou
      if (total != null && linhas.length >= total) break; // já tem tudo

      const chave = semChave ? null : chaveDaOrdem;
      if (chave) {
        const ultima = parte[parte.length - 1];
        // Sem o valor da chave ou sem id nesta linha, a próxima página não tem
        // de onde partir: cair para o salto é melhor que repetir a mesma página
        // para sempre.
        if (ultima && ultima[chave.col] != null && ultima.id != null) {
          marco = { valor: ultima[chave.col], id: ultima.id };
        } else {
          inicio = linhas.length;
          marco = null;
        }
      } else {
        inicio += tamanho;
      }

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
