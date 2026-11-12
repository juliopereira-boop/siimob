// O site público (/links, /contato, /blog) e a aba Site do superadmin.
//
// O PEDIDO DO DONO
//   "uma página como se fosse o linktree, que vai ficar na bio do insta, e no
//    meu superadmin eu possa criar os campos, links, banners (...) uma página
//    de Contato, uma página de blog"
//
// O que mais importa aqui é o que o visitante NÃO vê: link "javascript:" que o
// banco não deixaria gravar mas que a tela precisa recusar sozinha, HTML cru
// dentro do texto do post, e a página da bio que nunca fica vazia quando o
// banco não responde. O resto confere que cada pedido vai com o corpo certo.
const path = require('path');
const { pathToFileURL } = require('url');
const { abrir, checa, resumo } = require('./comum');

const posts = (p, re) =>
  p.evaluate(
    r =>
      window.__POSTS.filter(x => new RegExp(r).test(x.url)).map(x => ({ m: x.m, url: x.url, body: x.body })),
    re.source
  );
const texto = (p, sel) => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);

(async () => {
  let todos = [];

  // O módulo do site é ES puro; o Node avisa ao importá-lo daqui, e o aviso só
  // poluiria o log da suíte.
  const avisoOriginal = process.emitWarning;
  process.emitWarning = (w, ...r) =>
    /Module type|MODULE_TYPELESS/.test(String(w && w.message ? w.message : w))
      ? undefined
      : avisoOriginal.call(process, w, ...r);

  // ── Markdown: o que o texto do post pode e não pode virar ─────────────────
  console.log('\nO Markdown do blog');
  {
    const md = await import(pathToFileURL(path.join(__dirname, '../src/modules/site/markdown.js')).href);
    const h = md.markdown(
      [
        '## Título',
        'Texto com **negrito**, *itálico* e [link](https://siimob.com.br).',
        '[golpe](javascript:alert(1)) e [outro](//mal.com/x)',
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '![foto](https://x.com/a.png)',
        '![falsa](javascript:alert(1))',
        '[aspas](https://x.com/"onmouseover="alert(1))',
        '- um',
        '- dois',
        '> citação'
      ].join('\n\n')
    );
    checa(
      '## vira h2 e o texto ganha negrito, itálico e link',
      /<h2>Título<\/h2>/.test(h) &&
        /<strong>negrito<\/strong>/.test(h) &&
        /<em>itálico<\/em>/.test(h) &&
        /href="https:\/\/siimob\.com\.br" target="_blank"/.test(h)
    );
    checa(
      'link com javascript: vira texto puro',
      !/javascript:/i.test(h.replace(/>[^<]*</g, '><')) && /golpe/.test(h)
    );
    checa('link sem protocolo (//) também', !/href="\/\/mal/.test(h));
    checa('HTML digitado aparece como texto', !/<script>|<img src=x/i.test(h) && /&lt;script&gt;/.test(h));
    checa(
      'imagem só com endereço seguro',
      /<img src="https:\/\/x\.com\/a\.png"/.test(h) && !/<img[^>]+javascript/i.test(h)
    );
    checa('aspas no endereço não fogem do atributo', !/"onmouseover=/.test(h));
    checa('listas e citação', /<ul><li>um<\/li><li>dois<\/li><\/ul>/.test(h) && /<blockquote>/.test(h));
    checa(
      'endereço do post a partir do título',
      md.slugDe('Funil de Vendas: Ação & Gestão!') === 'funil-de-vendas-acao-gestao'
    );
    checa(
      'tempo de leitura nunca é zero',
      md.minutosDeLeitura('oi') === 1 && md.minutosDeLeitura('palavra '.repeat(660)) === 3
    );
  }

  // ── /links ────────────────────────────────────────────────────────────────
  console.log('\n/links, a página da bio');
  {
    const { b, p, erros } = await abrir('links');
    const itens = await p.$$eval('#lk-lista > *', els => els.map(e => e.className.split(' ')[0]));
    checa(
      'banner, destaque, botões e separador, na ordem do superadmin',
      itens.join(',') === 'lk-banner,lk-botao,lk-botao,lk-botao,lk-secao,lk-botao',
      itens.join(',')
    );
    checa(
      'o link com javascript: não aparece',
      !(await p.$('#lk-lista a[href^="javascript"]')) && !/Golpe/.test(await texto(p, '#lk-lista'))
    );
    checa('o endereço do próprio site abre na mesma aba', !(await p.$('#lk-lista a[href="/blog"][target]')));
    checa(
      'o de fora abre em nova aba',
      !!(await p.$('#lk-lista a[href^="https://wa.me"][target="_blank"][rel*="noopener"]'))
    );
    checa('o título SIIMOB sai com a marca', !!(await p.$('#lk-titulo .sx-nome i')));
    const redes = await p.$$eval('#lk-redes a', as => as.map(a => a.getAttribute('aria-label')));
    checa(
      'as redes vêm dos canais: WhatsApp, Instagram, LinkedIn e e-mail',
      redes.join(',') === 'WhatsApp,Instagram,LinkedIn,E-mail',
      redes.join(',')
    );
    checa('rede com endereço inseguro não aparece', !(await p.$('#lk-redes a[href^="javascript"]')));
    await p.evaluate(() => {
      // O clique conta e a navegação segue; aqui ela é segurada para o teste ler.
      document.querySelector('#lk-lista a[data-id="lk3"]').addEventListener('click', e => e.preventDefault());
    });
    await p.click('#lk-lista a[data-id="lk3"]');
    await p.waitForTimeout(200);
    const [cl] = await posts(p, /rpc\/a1_site_link_clique/);
    checa('o clique conta pelo id do item', !!cl && JSON.parse(cl.body).p_id === 'lk3');
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todos = todos.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('links', {
      antes: url => (/a1_site_(links|config)/.test(url) ? { message: 'relation does not exist' } : undefined)
    });
    const rot = await p.$$eval('#lk-lista a b', bs => bs.map(x => x.textContent));
    checa(
      'sem banco, a bio mostra os três caminhos do site',
      rot.join('|') === 'Conheça o SIIMOB|Blog|Contato',
      rot.join('|')
    );
    await b.close();
    todos = todos.concat(erros);
  }

  // ── /contato ──────────────────────────────────────────────────────────────
  console.log('\n/contato');
  {
    const { b, p, erros } = await abrir('contato');
    const zap = await p.getAttribute('#ct-canais a[href^="https://wa.me"]', 'href');
    checa('o WhatsApp abre com a mensagem pronta', /wa\.me\/5598999990000\?text=Ol/.test(zap || ''), zap);
    checa(
      'e-mail e telefone aparecem',
      !!(await p.$('#ct-canais a[href="mailto:contato@siimob.com.br"]')) &&
        !!(await p.$('#ct-canais a[href^="tel:"]'))
    );
    checa('o horário aparece', /Segunda a sexta/.test(await texto(p, '#ct-horario')));
    checa(
      'o cabeçalho marca Contato',
      (await texto(p, '.sx-nav-links a[aria-current="page"]')) === 'Contato'
    );
    await p.click('#ct-enviar');
    checa(
      'sem nome não envia',
      /nome/.test(await texto(p, '#ct-retorno')) &&
        (await p.getAttribute('#ct-nome', 'aria-invalid')) === 'true'
    );
    await p.fill('#ct-nome', 'Maria Teste');
    await p.fill('#ct-email', 'maria@');
    await p.click('#ct-enviar');
    checa('e-mail incompleto não envia', /e-mail/.test(await texto(p, '#ct-retorno')));
    await p.fill('#ct-email', 'maria@empresa.com.br');
    await p.click('#ct-enviar');
    checa('sem mensagem não envia', /mensagem/.test(await texto(p, '#ct-retorno')));
    checa('nada foi gravado até aqui', (await posts(p, /a1_leads/)).length === 0);
    await p.type('#ct-tel', '98999990000');
    checa('o telefone ganha a máscara', (await p.inputValue('#ct-tel')) === '(98) 99999-0000');
    await p.selectOption('#ct-assunto', 'Parcerias');
    await p.fill('#ct-msg', 'Quero conversar');
    await p.click('#ct-enviar');
    await p.waitForTimeout(400);
    const [lead] = await posts(p, /rest\/v1\/a1_leads/);
    const c = lead ? JSON.parse(lead.body) : {};
    checa(
      'a mensagem vai para a1_leads como contato, com o assunto',
      c.source === 'contato' &&
        c.name === 'Maria Teste' &&
        c.email === 'maria@empresa.com.br' &&
        c.segment === 'Parcerias' &&
        c.message === 'Quero conversar',
      lead ? lead.body : 'sem POST'
    );
    checa(
      'a tela confirma o recebimento',
      !(await p.$eval('#ct-ok', e => e.hidden)) && (await p.$eval('#ct-form', e => e.hidden))
    );
    await b.close();
    todos = todos.concat(erros);
  }

  // ── /blog ─────────────────────────────────────────────────────────────────
  console.log('\n/blog');
  {
    const { b, p, erros } = await abrir('blog');
    checa(
      'o post marcado como destaque abre a vitrine',
      /Artigo número 2/.test(await texto(p, '.bl-destaque h2'))
    );
    checa('a primeira página tem o destaque e mais 8', (await p.$$('#bl-grade .bl-card')).length === 8);
    const pil = await p.$$eval('.bl-pilula', bs => bs.map(x => x.textContent));
    checa(
      'as categorias saem dos posts',
      pil.join('|') === 'Todos|Dicas|Estratégia|Gestão de equipe',
      pil.join('|')
    );
    await p.click('.bl-pilula[data-cat="Dicas"]');
    await p.waitForTimeout(150);
    const cats = await p.$$eval('#bl-grade .bl-cat', s => [...new Set(s.map(x => x.textContent))]);
    checa('filtrar por categoria mostra só ela', cats.join('|') === 'Dicas', cats.join('|'));
    checa('e o endereço guarda o filtro', /\/blog\?categoria=Dicas$/.test(p.url()), p.url());
    await p.click('.bl-pilula[data-cat=""]');
    await p.fill('.bl-busca input', 'funil');
    await p.waitForTimeout(150);
    checa(
      'a busca acha pelo título',
      (await p.$$('#bl-grade .bl-card, #bl-grade .bl-destaque')).length === 1
    );
    await p.fill('.bl-busca input', 'nada disso');
    await p.waitForTimeout(150);
    checa('busca sem resultado diz isso', /Nenhum artigo encontrado/.test(await texto(p, '#bl-grade')));
    await p.fill('.bl-busca input', '');
    await p.waitForTimeout(150);
    await p.click('.bl-pg[data-p="2"]');
    await p.waitForTimeout(150);
    checa(
      'a segunda página traz o resto',
      (await p.$$('#bl-grade .bl-card')).length === 2 && /pagina=2/.test(p.url())
    );
    checa('nenhuma carga de XSS executou na lista', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todos = todos.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('blog/funil-de-vendas-imobiliario');
    checa('o post abre pelo endereço', /Funil de vendas imobiliário/.test(await texto(p, '.bl-post-cab h1')));
    checa(
      'o título da aba é o do post',
      /^Funil de vendas imobiliário.*\| Blog SIIMOB$/.test(await p.title())
    );
    checa(
      'o texto vira HTML',
      !!(await p.$('.bl-texto h2')) &&
        !!(await p.$('.bl-texto ul li')) &&
        !!(await p.$('.bl-texto blockquote'))
    );
    checa('o link javascript: do texto não vira link', !(await p.$('.bl-texto a[href^="javascript"]')));
    checa('o HTML cru do texto aparece como texto', /<img src=x/.test(await texto(p, '.bl-texto')));
    checa(
      'três artigos para continuar lendo, da mesma categoria primeiro',
      (await p.$$('.bl-relacionados .bl-card')).length === 3 &&
        /Estratégia/.test(await texto(p, '.bl-relacionados .bl-cat'))
    );
    checa(
      'compartilhar no WhatsApp leva o endereço do post',
      /wa\.me\/\?text=.*funil-de-vendas-imobiliario/.test(
        (await p.getAttribute('.bl-partilha a[href*="wa.me"]', 'href')) || ''
      )
    );
    checa('nenhuma carga de XSS executou no post', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todos = todos.concat(erros);
  }
  {
    const { b, p, erros } = await abrir('blog/nao-existe');
    checa(
      'endereço sem post diz que não encontrou',
      /Artigo não encontrado/.test(await texto(p, '#bl-vista h1'))
    );
    await b.close();
    todos = todos.concat(erros);
  }

  // ── Superadmin › Site ─────────────────────────────────────────────────────
  console.log('\nSuperadmin › Site');
  {
    const { b, p, erros } = await abrir('superadmin');
    await p.fill('#sa-key-input', 'chave');
    await p.click('[data-acao="saAuth"]');
    await p.waitForTimeout(1000);
    await p.click('#tab-site');
    await p.waitForTimeout(600);
    checa('a aba lista os itens da página de links', (await p.$$('#st-corpo tbody tr')).length === 7);
    // Novo botão
    await p.click('[data-acao="stNovoLink"]');
    await p.fill('#stl-titulo', 'Agende uma demonstração');
    await p.fill('#stl-url', 'javascript:alert(1)');
    await p.click('#stl-salvar');
    checa('endereço inseguro é recusado na tela', /https:\/\//.test(await texto(p, '#stl-erro')));
    await p.click('#stl-atalhos [data-url="/conheca#interesse"]');
    await p.selectOption('#stl-icone', 'calendario');
    await p.click('#stl-salvar');
    await p.waitForTimeout(400);
    const novo = (await posts(p, /rest\/v1\/a1_site_links$/)).find(x => x.m === 'POST');
    const nb = novo ? JSON.parse(novo.body) : {};
    checa(
      'o item novo vai com tipo, endereço, ícone e entra no fim da lista (maior ordem + 10)',
      nb.tipo === 'link' &&
        nb.url === '/conheca#interesse' &&
        nb.icone === 'calendario' &&
        nb.ordem === 17 &&
        nb.imagem_url === null,
      novo ? novo.body : 'sem POST'
    );
    // Ordem
    await p.click('[data-acao="stMoverLink"][data-id="lk2"][data-d="-1"]');
    await p.waitForTimeout(300);
    const ordens = (await posts(p, /a1_site_links\?id=eq\./))
      .filter(x => x.m === 'PATCH')
      .map(x => x.url.split('eq.')[1] + ':' + JSON.parse(x.body).ordem);
    checa(
      'subir um item troca a ordem dos dois',
      ordens.includes('lk2:10') && ordens.includes('lk1:20'),
      ordens.join(' ')
    );
    // Banner sem imagem
    await p.click('[data-acao="stNovoLink"]');
    await p.check('input[name="stl-tipo"][value="banner"]');
    await p.fill('#stl-titulo', 'Campanha');
    await p.fill('#stl-url', '/conheca');
    await p.click('#stl-salvar');
    checa('banner sem imagem é recusado', /imagem/.test(await texto(p, '#stl-erro')));
    await p.click('#modal-st-link [data-acao="stFechar"]');
    // Canais
    await p.click('[data-acao="stVista"][data-v="canais"]');
    await p.fill('#st-youtube', 'http://youtube.com/x');
    await p.click('[data-acao="stSalvarCanais"]');
    await p.waitForTimeout(200);
    checa('rede sem https é recusada', !(await posts(p, /a1_site_config/)).some(x => x.m === 'PATCH'));
    await p.fill('#st-youtube', 'https://youtube.com/@siimob');
    await p.fill('#st-whatsapp', '+55 (98) 99999-0000');
    await p.click('[data-acao="stSalvarCanais"]');
    await p.waitForTimeout(300);
    const cfg = (await posts(p, /a1_site_config/)).find(x => x.m === 'PATCH');
    const cb = cfg ? JSON.parse(cfg.body) : {};
    checa(
      'os canais são gravados, WhatsApp só com dígitos',
      cb.whatsapp === '5598999990000' && cb.youtube === 'https://youtube.com/@siimob',
      cfg ? cfg.body : 'sem PATCH'
    );
    // Novo artigo
    await p.click('[data-acao="stVista"][data-v="blog"]');
    await p.click('[data-acao="stNovoPost"]');
    await p.waitForTimeout(200);
    await p.type('#stp-titulo', 'Como organizar a reserva de unidades');
    checa(
      'o endereço nasce do título',
      (await p.inputValue('#stp-slug')) === 'como-organizar-a-reserva-de-unidades'
    );
    await p.click('#stp-publicar');
    checa('publicar sem texto é recusado', /texto/.test(await texto(p, '#stp-erro')));
    await p.click('#stp-conteudo');
    await p.click('[data-acao="stFerramenta"][data-f="h2"]');
    checa(
      'a ferramenta de título insere ##',
      /^## Título da seção/.test(await p.inputValue('#stp-conteudo'))
    );
    await p.click('[data-acao="stAbaPost"][data-a="previa"]');
    checa('a pré-visualização mostra o texto pronto', !!(await p.$('#stp-previa h2')));
    await p.click('[data-acao="stAbaPost"][data-a="escrever"]');
    await p.click('#stp-publicar');
    await p.waitForTimeout(400);
    const art = (await posts(p, /rest\/v1\/a1_blog_posts$/)).find(x => x.m === 'POST');
    const ab = art ? JSON.parse(art.body) : {};
    checa(
      'o artigo vai publicado, com endereço, tempo de leitura e data',
      ab.publicado === true &&
        ab.slug === 'como-organizar-a-reserva-de-unidades' &&
        ab.tempo_leitura === 1 &&
        !!ab.publicado_em,
      art ? art.body : 'sem POST'
    );
    checa('nenhuma carga de XSS executou no superadmin', (await p.evaluate(() => window.__XSS)) === 0);
    await b.close();
    todos = todos.concat(erros);
  }

  process.exit(resumo(todos) ? 1 : 0);
})();
