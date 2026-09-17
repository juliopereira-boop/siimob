// A1.buscarTudo — a leitura em páginas, sob volume.
//
// POR QUE ESTE ARQUIVO EXISTE
// Nenhum teste do sistema exercitava a virada de página: o Supabase de mentira
// sempre respondeu `content-range: 0-1/2`, ou seja, uma página só. E com 235
// processos no maior cliente, a segunda página nunca acontecia em produção
// também. Era um trecho de código que ninguém tinha visto rodar — e que passa a
// mandar no sistema no dia em que um cliente cresce.
//
// Aqui não há navegador: `buscarTudo` é lida do arquivo de verdade e executada
// contra um servidor de mentira que PAGINA COMO O PostgREST — com Range,
// content-range e o filtro `or=` da paginação por chave. É o único jeito de
// provar a virada de página sem 40 mil linhas de verdade.
//
// O que estas provas guardam:
//   1. tudo chega, na ordem, sem repetir e sem pular
//   2. o total é pedido UMA vez, não a cada página
//   3. linhas com o mesmo carimbo de tempo não somem nem se duplicam
//   4. se o banco recusar o filtro por chave, a leitura NÃO quebra: volta para
//      o salto por deslocamento e termina certo
const fs = require('fs');
const path = require('path');
const { checa, resumo } = require('./comum');

// ── Carrega o A1 de verdade, sem navegador ──────────────────────────────────
// config.js é um arquivo de <script>, não um módulo. Ele é avaliado aqui dentro
// de um escopo com os poucos globais de navegador que usa, e devolve o A1 real
// — o mesmo objeto que a tela usa. Copiar a função para o teste provaria a
// cópia, não o sistema.
function carregarA1(fetchFalso) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const janela = {
    localStorage: { getItem: () => 'tok', setItem: () => {} },
    location: { pathname: '/thecred/repasse' },
    fetch: fetchFalso
  };
  const fn = new Function('window', 'localStorage', 'location', 'fetch',
    codigo + '\n;return A1;');
  return fn(janela, janela.localStorage, janela.location, fetchFalso);
}

// ── Servidor de mentira que pagina como o PostgREST ─────────────────────────
function servidor(linhas, opc = {}) {
  const estado = { pedidos: [], contagensPedidas: 0, usouChave: 0, usouSalto: 0 };
  const tamanho = opc.tamanho || 1000;

  const fetchFalso = async (url, init) => {
    const cab = (init && init.headers) || {};
    estado.pedidos.push(url);
    if (String(cab.Prefer || '').includes('count=exact')) estado.contagensPedidas++;

    const faixa = /(\d+)-(\d+)/.exec(cab.Range || '0-999');
    const de = Number(faixa[1]), ate = Number(faixa[2]);

    let base = linhas;
    const m = /[?&]or=\(([^&]+)\)/.exec(url);
    if (m) {
      if (opc.recusaChave) {
        estado.usouChave++;
        return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
      }
      estado.usouChave++;
      // "created_at.lt.X,and(created_at.eq.X,id.lt.Y)" — a mesma condição que o
      // banco aplicaria: veio depois do carimbo, ou empatou nele e vem depois
      // no id.
      const cru = decodeURIComponent(m[1]);
      const pc = /created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)/.exec(cru);
      if (!pc) throw new Error('filtro de chave em formato inesperado: ' + cru);
      const [, valor, id] = pc;
      base = linhas.filter(l => l.created_at < valor || (l.created_at === valor && l.id < id));
    } else if (de > 0) {
      estado.usouSalto++;
    }

    const pagina = base.slice(de, ate + 1);
    return {
      ok: true, status: pagina.length < tamanho ? 200 : 206,
      headers: { get: n => n === 'content-range' ? `${de}-${de + pagina.length - 1}/${linhas.length}` : null },
      json: async () => pagina
    };
  };
  return { fetchFalso, estado };
}

// Linhas em ordem decrescente de created_at, como a tela pede. `empates` diz
// quantas compartilham o mesmo carimbo — é onde a paginação por chave erra se o
// desempate por id não existir.
function gerar(n, empates = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const seq = String(n - i).padStart(6, '0');
    const carimbo = i < n - empates ? `2026-09-14T10:${seq}Z` : `2026-01-01T00:000000Z`;
    out.push({ id: 'id-' + seq, created_at: carimbo, nome: 'Processo ' + seq });
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (a.id < b.id ? 1 : -1)));
}

(async () => {
  const URL_ORD = 'https://x.supabase.co/rest/v1/a1_cases?module_key=eq.repasse&order=created_at.desc&select=id,created_at,nome';

  console.log('== 4.500 LINHAS, PAGINANDO POR CHAVE ==');
  {
    const linhas = gerar(4500);
    const { fetchFalso, estado } = servidor(linhas);
    const A1 = carregarA1(fetchFalso);
    const r = await A1.buscarTudo(URL_ORD);

    checa('trouxe todas as linhas', r.linhas.length === 4500, 'vieram ' + r.linhas.length);
    checa('e o total veio do banco, não da contagem local', r.total === 4500, String(r.total));
    checa('a leitura se declara completa', r.completo === true && r.erro === null);

    const ids = r.linhas.map(l => l.id);
    checa('nenhuma linha repetida', new Set(ids).size === ids.length,
      'repetidas: ' + (ids.length - new Set(ids).size));
    checa('nenhuma linha pulada',
      new Set(ids).size === new Set(linhas.map(l => l.id)).size);
    checa('a ordem do banco foi preservada',
      ids.join(',') === linhas.map(l => l.id).join(','));

    // O ponto da mudança: o total custa uma varredura inteira no banco. Pedi-lo
    // em cada página é pagar a mesma conta cinco vezes pelo mesmo número.
    checa('o total foi pedido UMA vez, não a cada página',
      estado.contagensPedidas === 1, 'pedido ' + estado.contagensPedidas + 'x');
    checa('as páginas seguintes andaram por chave, não por deslocamento',
      estado.usouChave === 4 && estado.usouSalto === 0,
      'chave=' + estado.usouChave + ' salto=' + estado.usouSalto);
  }

  console.log('\n== CARIMBOS EMPATADOS NÃO SOMEM NEM DUPLICAM ==');
  {
    // 1.200 linhas em que as 500 últimas dividem o MESMO created_at. Sem o
    // desempate por id, a virada de página cairia no meio do bloco empatado e
    // pularia ou repetiria — erro que só aparece em importação e carga em lote,
    // e que ninguém consegue reproduzir depois.
    const linhas = gerar(1200, 500);
    const { fetchFalso } = servidor(linhas);
    const A1 = carregarA1(fetchFalso);
    const r = await A1.buscarTudo(URL_ORD);

    const ids = r.linhas.map(l => l.id);
    checa('trouxe as 1.200', r.linhas.length === 1200, 'vieram ' + r.linhas.length);
    checa('sem repetir nenhuma', new Set(ids).size === 1200,
      'repetidas: ' + (ids.length - new Set(ids).size));
    checa('e sem perder nenhuma do bloco empatado',
      new Set(ids).size === new Set(linhas.map(l => l.id)).size);
  }

  console.log('\n== SE O BANCO RECUSAR O FILTRO, A LEITURA NÃO QUEBRA ==');
  {
    // A garantia que permite subir isto sem poder validar a sintaxe do filtro
    // contra o PostgREST de verdade: se ele responder 400, a leitura volta ao
    // salto por deslocamento e termina certa. Mais lenta, e correta.
    const linhas = gerar(2500);
    const { fetchFalso, estado } = servidor(linhas, { recusaChave: true });
    const A1 = carregarA1(fetchFalso);
    const r = await A1.buscarTudo(URL_ORD);

    checa('a recusa foi exercitada', estado.usouChave >= 1);
    checa('mesmo assim trouxe tudo', r.linhas.length === 2500, 'vieram ' + r.linhas.length);
    checa('sem repetir', new Set(r.linhas.map(l => l.id)).size === 2500);
    checa('e sem marcar erro na leitura', r.completo === true && r.erro === null,
      JSON.stringify({ completo: r.completo, erro: r.erro }));
    checa('caiu para o salto por deslocamento', estado.usouSalto >= 1,
      'salto=' + estado.usouSalto);
  }

  console.log('\n== CONSULTA SEM ORDEM CONTINUA NO CAMINHO ANTIGO ==');
  {
    // Lista pequena, sem `order`: não há chave para andar, e o salto é o certo.
    const linhas = gerar(1500);
    const { fetchFalso, estado } = servidor(linhas);
    const A1 = carregarA1(fetchFalso);
    const r = await A1.buscarTudo('https://x.supabase.co/rest/v1/a1_pa_participantes?papel=eq.TITULAR');

    checa('trouxe tudo', r.linhas.length === 1500, 'vieram ' + r.linhas.length);
    checa('nenhum filtro de chave foi montado', estado.usouChave === 0);
    checa('andou por deslocamento', estado.usouSalto >= 1);
  }

  console.log('\n== ERRO DE VERDADE NA PRIMEIRA PÁGINA CONTINUA SENDO ERRO ==');
  {
    // A volta atrás vale só para a página por chave. Um 500 na primeira página
    // é falha de leitura e tem de ser dito — é o aviso que apareceu para a
    // Raissa, e ele não pode ser engolido pela nova lógica.
    const A1 = carregarA1(async () => ({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => ''
    }));
    const r = await A1.buscarTudo(URL_ORD);
    checa('a leitura se declara incompleta', r.completo === false);
    checa('e diz qual foi o status', r.erro === 'HTTP 500', String(r.erro));
  }

  console.log('\n== LER POR LISTA DE IDS SEM ESTOURAR A URL ==');
  {
    // O defeito que isto guarda: `?id=in.(a,b,c...)` com todos os ids da tela.
    // Um uuid custa 37 bytes com a vírgula, então a ~450 ids a URL passa de
    // 16 KB e o servidor devolve 414 — dentro de um `.catch(() => [])`. A tela
    // não quebrava: passava a mostrar "Titular não informado" em TODA linha, o
    // que é um dado sumindo em silêncio.
    const uuid = i => `${String(i).padStart(8,'0')}-aaaa-bbbb-cccc-dddddddddddd`;
    const ids = Array.from({ length: 900 }, (_, i) => uuid(i));
    const linhas = ids.map((id, i) => ({ id, nome: 'P' + i }));

    const pedidos = [];
    const fetchFalso = async (url) => {
      pedidos.push(String(url));
      const m = /in\.\(([^)]*)\)/.exec(String(url));
      const pedidos_ids = m ? m[1].split(',') : [];
      const corpo = linhas.filter(l => pedidos_ids.includes(l.id));
      return { ok:true, status:200, text: async () => JSON.stringify(corpo),
        headers:{ get:(k) => k.toLowerCase() === 'content-range'
          ? `0-${Math.max(0, corpo.length - 1)}/${corpo.length}` : null },
        json: async () => corpo };
    };
    const A1 = carregarA1(fetchFalso);
    const r = await A1.buscarPorIds('https://x.supabase.co/rest/v1/a1_pa_pessoas?select=id,nome', 'id', ids);

    checa('trouxe TODAS as linhas, não só o primeiro lote', r.length === 900, 'vieram ' + r.length);
    checa('sem repetir nenhuma', new Set(r.map(x => x.id)).size === 900);
    // A prova que importa: nenhuma URL pode chegar perto do teto do servidor.
    const maior = Math.max(...pedidos.map(u => u.length));
    checa('e nenhuma URL passou de 8 KB', maior < 8000, 'a maior teve ' + maior + ' bytes');
    checa('foi preciso mais de uma ida', pedidos.length > 1, pedidos.length + ' pedido(s)');

    // Id repetido não vira consulta repetida, e lista vazia não vira consulta.
    const r2 = await A1.buscarPorIds('https://x.supabase.co/rest/v1/a1_pa_pessoas', 'id', [uuid(1), uuid(1)]);
    checa('id repetido é pedido uma vez só', r2.length === 1, 'vieram ' + r2.length);
    const antes = pedidos.length;
    const r3 = await A1.buscarPorIds('https://x.supabase.co/rest/v1/a1_pa_pessoas', 'id', []);
    checa('lista vazia não vai ao servidor', r3.length === 0 && pedidos.length === antes);
  }

  process.exit(resumo([]) ? 1 : 0);
})();
