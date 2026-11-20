// /privacidade e /termos: as páginas legais do site.
//
// A Meta exige um endereço público de política de privacidade, com instruções
// de exclusão de dados, para o app de leads sair do modo de desenvolvimento.
// Este teste confere que as duas páginas abrem pelo endereço bonito, que o
// texto tem o que a Meta e a LGPD pedem (CNPJ, encarregado, exclusão) e que os
// links do site apontam para elas, não mais para o FAQ do /indica.
const fs = require('fs');
const path = require('path');
const { abrir, checa, resumo } = require('./comum');

const texto = (p, sel) => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');

(async () => {
  let todos = [];

  console.log('== /privacidade ==');
  {
    const { b, p, erros } = await abrir('privacidade');
    checa(
      'abre pelo endereço bonito',
      (await p.title()) === 'Política de Privacidade | SIIMOB',
      await p.title()
    );
    const corpo = await texto(p, '.lg-texto');
    checa('mostra o CNPJ', corpo.includes('57.210.027/0001-26'));
    checa(
      'mostra o e-mail do encarregado',
      !!(await p.$('.lg-texto a[href="mailto:siimob.plataforma@gmail.com"]'))
    );
    checa('tem a seção de exclusão com âncora própria', !!(await p.$('section#exclusao h2')));
    checa('explica os dados recebidos da Meta', /Meta Lead Ads/.test(corpo) && /token/i.test(corpo));
    const itens = await p.$$eval('#lg-indice-lista a', a => a.map(x => x.getAttribute('href')));
    const secoes = await p.$$eval('.lg-texto section[id]', s => s.map(x => '#' + x.id));
    checa(
      'o índice lista todas as seções, na ordem',
      JSON.stringify(itens) === JSON.stringify(secoes),
      itens.join(' ')
    );
    checa('o índice tira o número do título', !/^\d/.test(await texto(p, '#lg-indice-lista a')));
    checa('cabeçalho do site montado', !!(await p.$('#sx-nav .sx-marca')));
    checa('rodapé leva aos termos', !!(await p.$('#sx-rodape a[href="/termos"]')));
    await p.click('#lg-indice-lista a[href="#exclusao"]');
    await p.waitForTimeout(500);
    checa('clicar no índice leva à seção', /#exclusao$/.test(p.url()), p.url());
    await p.setViewportSize({ width: 390, height: 800 });
    const vaza = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    checa('no celular não rola de lado', !vaza);
    await b.close();
    todos = todos.concat(erros);
  }

  console.log('\n== /termos ==');
  {
    const { b, p, erros } = await abrir('termos');
    checa('abre pelo endereço bonito', (await p.title()) === 'Termos de Uso | SIIMOB', await p.title());
    const corpo = await texto(p, '.lg-texto');
    checa('mostra o CNPJ', corpo.includes('57.210.027/0001-26'));
    checa('remete à política de privacidade', !!(await p.$('.lg-texto a[href="/privacidade"]')));
    checa('tem foro e lei aplicável', /foro/.test(corpo) && /LGPD/.test(corpo));
    checa('índice montado', (await p.$$('#lg-indice-lista a')).length >= 10);
    await b.close();
    todos = todos.concat(erros);
  }

  console.log('\n== Rotas e links ==');
  {
    const vercel = JSON.parse(ler('vercel.json'));
    const red = ler('public/_redirects');
    for (const r of ['privacidade', 'termos']) {
      checa(
        `/${r} está no vercel.json e no _redirects`,
        vercel.rewrites.some(x => x.source === `/${r}` && x.destination === `/${r}.html`) &&
          new RegExp(`^/${r}\\s+/${r}\\.html\\s+200$`, 'm').test(red)
      );
      checa(`/${r} está no sitemap`, ler('public/sitemap.xml').includes(`https://siimob.com/${r}<`));
    }
    checa(
      'o site principal leva às duas',
      /href="\/privacidade"/.test(ler('src/pages/index/index.html')) &&
        /href="\/termos"/.test(ler('src/pages/index/index.html'))
    );
    for (const f of ['src/pages/indica/index.html', 'src/pages/indica-cadastro/index.html']) {
      const h = ler(f);
      checa(
        `${f.split('/')[2]}: "política de privacidade" leva a /privacidade`,
        !/#duvidas">pol[ií]tica de privacidade/i.test(h) && h.includes('href="/privacidade"')
      );
    }
  }

  process.exit(resumo(todos) ? 1 : 0);
})();
