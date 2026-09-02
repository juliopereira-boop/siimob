// Anexar documento no cartão do cliente. O relato da produção: anexa, o sistema
// diz que salvou, e ao voltar no cliente o documento não está lá.
const { abrir, checa, resumo } = require('./comum');

const anexar = (p, nome) => p.evaluate(async n => {
  await attachDoc(new File(['conteudo do arquivo'], n, { type:'application/pdf' }));
}, nome);

const abrirDocs = async p => {
  await p.evaluate(() => openCard('c1'));
  await p.waitForTimeout(900);
  await p.evaluate(() => switchModalTab('docs', document.querySelector('#modal-card-bg .modal-tab[data-mtab="docs"]')));
  await p.waitForTimeout(700);
};

const listados = p => p.evaluate(() => (document.getElementById('mc-body') || {}).textContent || '');

(async () => {
  const { b, p, erros } = await abrir('repasse.html');
  console.log('== ANEXAR UM DOCUMENTO ==');
  await abrirDocs(p);

  await anexar(p, 'rg-do-cliente.pdf');
  await p.waitForTimeout(900);

  const patches = () => p.evaluate(() => (window.__POSTS||[])
    .filter(x => /a1_cases\?id=eq/.test(x.url) && x.m === 'PATCH')
    .map(x => JSON.parse(x.body)));

  { const ps = await patches();
    const comDoc = ps.filter(x => Array.isArray(x.documents));
    checa('o anexo foi gravado no banco', comDoc.length > 0, JSON.stringify(ps).slice(0,200));
    const ultimo = comDoc[comDoc.length-1];
    checa('com o nome do arquivo', !!ultimo && ultimo.documents.some(d => d.name === 'rg-do-cliente.pdf'),
      JSON.stringify(ultimo && ultimo.documents)); }

  checa('aparece na lista logo depois de anexar',
    /rg-do-cliente\.pdf/.test(await listados(p)), (await listados(p)).slice(0,160));

  checa('o processo em memória também recebeu o documento', await p.evaluate(() => {
    const c = G.cases.find(x => x.id === 'c1');
    return Array.isArray(c.documents) && c.documents.some(d => d.name === 'rg-do-cliente.pdf');
  }), 'G.cases não foi atualizado');

  console.log('\n== FECHAR E VOLTAR NO CLIENTE ==');
  await p.evaluate(() => closeModal('modal-card-bg'));
  await p.waitForTimeout(400);
  await abrirDocs(p);
  checa('o documento continua lá ao reabrir o cartão',
    /rg-do-cliente\.pdf/.test(await listados(p)), (await listados(p)).slice(0,200));

  console.log('\n== ANEXAR E CLICAR EM SALVAR ==');
  await anexar(p, 'contrato-assinado.pdf');
  await p.waitForTimeout(800);
  // volta para a aba Dados, que é de onde o Salvar funciona
  await p.evaluate(() => switchModalTab('det', document.querySelector('#modal-card-bg .modal-tab[data-mtab="det"]')));
  await p.waitForTimeout(400);
  await p.evaluate(() => saveCase());
  await p.waitForTimeout(1000);

  checa('salvar não apaga o documento do banco', await p.evaluate(() => {
    const ps = (window.__POSTS||[]).filter(x => /a1_cases\?id=eq/.test(x.url) && x.m === 'PATCH')
      .map(x => JSON.parse(x.body));
    // o último PATCH do Salvar não pode mandar documents vazio
    const ultimo = ps[ps.length-1];
    return !('documents' in ultimo) || (Array.isArray(ultimo.documents) && ultimo.documents.length >= 2);
  }), 'o Salvar mandou documents por cima');

  await abrirDocs(p);
  { const t = await listados(p);
    checa('os DOIS documentos continuam lá depois de salvar',
      /rg-do-cliente\.pdf/.test(t) && /contrato-assinado\.pdf/.test(t), t.slice(0,240)); }

  console.log('\n== REMOVER UM DOCUMENTO ==');
  await p.evaluate(() => {
    const c = G.editingCaseData;
    const d = c.documents.find(x => x.name === 'rg-do-cliente.pdf');
    return removeDoc(d.id);
  });
  await p.waitForTimeout(900);
  { const t = await listados(p);
    checa('o removido sai da lista', !/rg-do-cliente\.pdf/.test(t), t.slice(0,200));
    checa('o outro fica', /contrato-assinado\.pdf/.test(t), t.slice(0,200)); }
  checa('a remoção também vale para o processo em memória', await p.evaluate(() => {
    const c = G.cases.find(x => x.id === 'c1');
    return !c.documents.some(d => d.name === 'rg-do-cliente.pdf')
        &&  c.documents.some(d => d.name === 'contrato-assinado.pdf');
  }));
  await p.evaluate(() => closeModal('modal-card-bg'));
  await p.waitForTimeout(300);
  await abrirDocs(p);
  checa('e continua removido ao reabrir', !/rg-do-cliente\.pdf/.test(await listados(p)));

  checa('nenhum XSS', (await p.evaluate(() => window.__XSS||0)) === 0);
  const n = resumo(erros); await b.close(); process.exit(n ? 1 : 0);
})();
