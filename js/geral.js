// ─── Configurações Gerais: as regras-mãe do cliente ──────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// Até aqui, quem podia criar um processo era decidido só por permissão — no
// perfil ou nas marcas da pessoa. Faltava o andar de cima: a regra do CLIENTE,
// que vale antes de qualquer permissão. Um cliente pode ter decidido que, na
// operação dele, venda não nasce solta: ela sempre vem de uma pré-análise. Essa
// decisão não é de pessoa, é de processo, e marcar caixa em quinze cadastros
// para representá-la seria descrever uma regra de empresa como se fosse
// coincidência de permissões.
//
// A ORDEM MANDA, E É SEMPRE ESTA:
//
//     regra do cliente (aqui)  →  permissão (perfil/pessoa)  →  RLS no banco
//
// Desligada a regra-mãe, NINGUÉM cria — nem o gestor, nem quem tem a marca. É o
// que o dono quis dizer com "configurações mães, acima das permissões". Ligada,
// ela não concede nada: continua valendo a permissão de sempre. Uma regra-mãe
// que desse permissão a alguém seria uma segunda porta para o mesmo poder, e
// portas paralelas foi exatamente o que os Perfis vieram acabar.
//
// O PADRÃO, QUANDO NÃO HÁ NADA GRAVADO, É O COMPORTAMENTO DE HOJE — nunca o
// mais restritivo. Cliente que nunca abriu esta tela não pode acordar com botão
// a menos: silêncio significa "como sempre foi", e quem muda isso é o gestor,
// de propósito. Por isso `criar_venda_avulsa` nasce desligada (venda solta não
// existia) e as outras duas nascem ligadas (sempre existiram).
//
// Mora em a1_config, chave 'geral', como o resto das configurações do cliente.
// Lida por pre-analise.html, comercial.html e pelas três telas do Repasse.

const A1_GERAL_PADRAO = {
  // Pré-análise sem depender de Lead. Hoje é o único jeito que existe, então
  // ligada; quando o módulo de Lead entrar, o cliente que quiser funil fechado
  // desliga aqui e a pré-análise passa a nascer só de um Lead.
  criar_pre_analise_avulsa: true,
  // Venda sem depender de pré-análise. Desligada por padrão porque venda solta
  // NÃO EXISTIA: hoje toda venda nasce de uma pré-análise aprovada. Ligar isto
  // é abrir um caminho novo, e abrir caminho novo é decisão de quem opera.
  criar_venda_avulsa: false,
  // Repasse sem depender de venda. Ligada por padrão porque é o que os três
  // clientes fazem hoje — a criação manual pela retaguarda é o fluxo normal
  // deles, e o Repasse nascido da Venda é que é a novidade.
  criar_repasse_avulso: true
};

// O que está gravado, com o padrão por baixo. Chave ausente vale o padrão, e
// não "false": esta é a diferença entre "o gestor decidiu desligar" e "ninguém
// nunca abriu esta tela".
function a1GeralNormalizar(bruto) {
  const v = (bruto && typeof bruto === 'object') ? bruto : {};
  const out = {};
  Object.keys(A1_GERAL_PADRAO).forEach(k => {
    out[k] = (k in v) ? (v[k] === true || v[k] === 'true') : A1_GERAL_PADRAO[k];
  });
  return out;
}

// Leitura única por tela. Falha de rede NÃO vira regra: devolve o padrão, que é
// o comportamento de hoje. "Não consegui perguntar" nunca pode virar "não pode"
// numa regra que governa o botão de criar — é a mesma disciplina de
// a1HasModule(), pelo mesmo motivo.
async function a1GeralCarregar() {
  try {
    const rows = await fetch(`${A1.rest('a1_config')}?key=eq.geral&select=value`, { headers: A1.headers() })
      .then(r => r.ok ? r.json() : []);
    let bruto = null;
    try { bruto = JSON.parse((rows && rows[0] && rows[0].value) || 'null'); } catch { bruto = null; }
    return a1GeralNormalizar(bruto);
  } catch {
    return a1GeralNormalizar(null);
  }
}

// O atalho que as telas usam. `G.geral` é preenchido no boot de cada uma.
function a1GeralPermite(geral, chave) {
  const g = a1GeralNormalizar(geral);
  return g[chave] === true;
}
