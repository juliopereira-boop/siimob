// ─── Os cadastros do módulo Leads, dentro de Configurações ───────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// As listas que o Leads usa — origens, portais, mensagens padrão, motivos de
// perda — moravam numa aba dentro do próprio crm.html. O dono foi direto:
// "tudo que for configuração vai estar em um único lugar". Configuração em dois
// lugares é o gestor procurando em um e achando no outro, e é também o caminho
// para duas listas de origem que não concordam.
//
// AS SEIS QUE NÃO VIERAM, E POR QUE
// O catálogo do CRM tinha seis cadastros que Configurações JÁ TEM, com outro
// nome e outra tabela:
//
//   corretores      → Configurações › Corretores      (a1_partners, type=corretor)
//   imobiliarias    → Configurações › Imobiliárias    (a1_partners, type=imobiliaria)
//   empreendimentos → Configurações › Empreendimentos (a1_developments)
//   bancos          → Configurações › Bancos          (a1_partners, type=banco)
//   regioes         → Configurações › Regionais
//   tipos_imovel    → Configurações › Modalidades de Imóvel
//
// Trazê-las criaria DUAS listas de corretor no mesmo sistema: uma em
// a1_partners, que o Repasse e a Venda leem, e outra num JSON do CRM, que só o
// CRM leria. O gestor cadastraria num lugar e o processo não acharia. Ficaram
// de fora de propósito, e o que já estiver gravado nelas continua no banco —
// nada foi apagado; apenas deixou de ganhar tela nova.
//
// ONDE OS DADOS MORAM
// Em a1_config, uma linha por cadastro, com as MESMAS chaves de antes
// (crm_sources, crm_brokers, crm_cad_<nome>). Nenhuma migração, nenhum dado
// perdido: quem já cadastrou origens continua com elas.
//
// Depende de: config.js, e de cfgModsCartao/cfgModsVista de configuracoes.html.

const LEADS_CAD_KEYMAP = { origens:'crm_sources', corretores:'crm_brokers' };
function leadsCadChave(k){ return LEADS_CAD_KEYMAP[k] || ('crm_cad_' + k); }

// A ordem é a de uso: o que se mexe toda semana em cima, o que se configura uma
// vez na vida embaixo.
const LEADS_CAD = [
  { key:'origens',       rotulo:'Origens de lead',    desc:'Canais de captação e o custo de cada um.',
    campos:[{k:'name',r:'Nome',req:true},{k:'tipo',r:'Tipo',tipo:'select',ops:['Digital','Indicação','Presencial','Parceria']},{k:'custo',r:'Custo por lead (R$)'}] },
  { key:'motivos_perda', rotulo:'Motivos de perda',   desc:'Por que um lead foi descartado.',
    campos:[{k:'name',r:'Motivo',req:true}] },
  { key:'modelos_msg',   rotulo:'Mensagens padrão',   desc:'Modelos de WhatsApp e e-mail.',
    campos:[{k:'name',r:'Título',req:true},{k:'canal',r:'Canal',tipo:'select',ops:['WhatsApp','E-mail']},{k:'corpo',r:'Mensagem',tipo:'textarea'}] },
  { key:'tags',          rotulo:'Tags de lead',       desc:'Etiquetas para agrupar leads.',
    campos:[{k:'name',r:'Nome',req:true},{k:'color',r:'Cor',tipo:'color'}] },
  { key:'portais',       rotulo:'Códigos de portais', desc:'ZAP, VivaReal, OLX e afins.',
    campos:[{k:'name',r:'Portal',req:true},{k:'codigo',r:'Código de integração'}] },
  { key:'finalidades',   rotulo:'Finalidades',        desc:'Compra, locação, investimento.',
    campos:[{k:'name',r:'Nome',req:true}] },
  { key:'tipos_visita',  rotulo:'Tipos de visita',    desc:'Visita técnica, avaliação, plantão.',
    campos:[{k:'name',r:'Nome',req:true},{k:'duracao',r:'Duração (min)'},{k:'desc',r:'Descrição'}] },
  { key:'equipes',       rotulo:'Equipes',            desc:'Times de venda.',
    campos:[{k:'name',r:'Nome',req:true}] },
  { key:'cat_corretor',  rotulo:'Categorias de corretor', desc:'Ouro, prata, bronze.',
    campos:[{k:'name',r:'Nome',req:true},{k:'desc',r:'Descrição'}] },
  { key:'segmentos',     rotulo:'Segmentos',          desc:'MCMV, médio padrão, alto padrão.',
    campos:[{k:'name',r:'Nome',req:true},{k:'desc',r:'Descrição'}] },
  { key:'incorporadoras',rotulo:'Incorporadoras',     desc:'Quem constrói o que você vende.',
    campos:[{k:'name',r:'Razão social',req:true},{k:'cnpj',r:'CNPJ'},{k:'contato',r:'Contato comercial'},{k:'phone',r:'Telefone'}] },
  { key:'pdv',           rotulo:'Pontos de venda',    desc:'Plantões e estandes.',
    campos:[{k:'name',r:'Nome',req:true},{k:'endereco',r:'Endereço'}] },
  { key:'garantias',     rotulo:'Garantias locatícias', desc:'Fiador, caução, seguro-fiança.',
    campos:[{k:'name',r:'Nome',req:true}] },
  { key:'sindicos',      rotulo:'Síndicos',           desc:'Contato para acesso a condomínios.',
    campos:[{k:'name',r:'Nome',req:true},{k:'phone',r:'Telefone'},{k:'email',r:'E-mail'},{k:'condominio',r:'Condomínio'}] }
];

const LEADS_CAD_DADOS = {};

function leadsEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function leadsCadCarregar(k){
  const linhas = await fetch(`${A1.rest('a1_config')}?key=eq.${leadsCadChave(k)}&select=value`,
    { headers:A1.headers() }).then(r => r.ok ? r.json() : []).catch(() => []);
  let lista = [];
  try { lista = JSON.parse((linhas && linhas[0] && linhas[0].value) || '[]'); } catch { lista = []; }
  LEADS_CAD_DADOS[k] = Array.isArray(lista) ? lista : [];
  return LEADS_CAD_DADOS[k];
}

async function leadsCadSalvar(k){
  const r = await fetch(A1.rest('a1_config'), { method:'POST', headers:A1.upsertHeaders(),
    body: JSON.stringify({ tenant_id: (A1.user || {}).tenant_id, key: leadsCadChave(k),
                           value: JSON.stringify(LEADS_CAD_DADOS[k] || []) }) });
  // Gravação que falha em silêncio é o pior caso: o gestor cadastra, fecha a
  // tela e descobre semanas depois que a lista estava vazia o tempo todo.
  if (!r.ok) throw new Error(await r.text().catch(() => 'erro ao salvar'));
}

function leadsCadDef(k){ return LEADS_CAD.find(c => c.key === k); }

// ── A tela de um cadastro ──────────────────────────────────────────────────
// Uma só, montada do catálogo. Catorze telas escritas à mão seriam catorze
// lugares para o botão "Excluir" se comportar de um jeito diferente.

async function leadsCadAbrir(k){
  const def = leadsCadDef(k);
  const alvo = document.getElementById('leads-cad-' + k);
  if (!def || !alvo) return;
  alvo.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--t3);font-size:.8rem">Carregando…</div>`;
  await leadsCadCarregar(k).catch(() => { LEADS_CAD_DADOS[k] = []; });
  leadsCadDesenhar(k);
}

function leadsCadDesenhar(k){
  const def = leadsCadDef(k);
  const alvo = document.getElementById('leads-cad-' + k);
  if (!def || !alvo) return;
  const lista = LEADS_CAD_DADOS[k] || [];
  const cols = def.campos.slice(0, 4);
  alvo.innerHTML = `
    <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="leadsCadEditar('${leadsEsc(k)}',-1)">+ Novo</button>
      <span style="font-size:.72rem;color:var(--t3)">${lista.length} item(ns)</span>
    </div>
    <div id="leads-cad-form-${leadsEsc(k)}"></div>
    ${lista.length ? `<div class="tbl-wrap"><table><thead><tr>
        ${cols.map(c => `<th>${leadsEsc(c.r)}</th>`).join('')}
        <th style="width:1%"></th></tr></thead><tbody>
        ${lista.map((it, i) => `<tr>
          ${cols.map(c => `<td>${c.tipo === 'color'
            ? `<span style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;background:${leadsEsc(it[c.k] || '#ccc')}"></span>`
            : leadsEsc(it[c.k] || '—')}</td>`).join('')}
          <td style="white-space:nowrap;text-align:right">
            <button class="btn btn-ghost btn-sm" onclick="leadsCadEditar('${leadsEsc(k)}',${i})">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="leadsCadExcluir('${leadsEsc(k)}',${i})">Excluir</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : `<div class="panel" style="padding:2.2rem;text-align:center;color:var(--t3);font-size:.8rem">
           Nada cadastrado aqui ainda. O botão acima cria o primeiro.</div>`}`;
}

function leadsCadEditar(k, i){
  const def = leadsCadDef(k);
  const wrap = document.getElementById('leads-cad-form-' + k);
  if (!def || !wrap) return;
  const it = i >= 0 ? (LEADS_CAD_DADOS[k] || [])[i] || {} : {};
  wrap.innerHTML = `<div class="panel" style="padding:1rem;margin-bottom:.9rem">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.7rem">
      ${def.campos.map(c => {
        const id = `lc-${leadsEsc(k)}-${leadsEsc(c.k)}`;
        const v = leadsEsc(it[c.k] || '');
        const rot = `<label style="display:block;font-size:.7rem;font-weight:600;color:var(--t2);margin-bottom:.25rem">${leadsEsc(c.r)}${c.req ? ' *' : ''}</label>`;
        if (c.tipo === 'textarea') return `<div style="grid-column:1/-1">${rot}<textarea id="${id}" rows="3" style="width:100%;padding:.45rem .6rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem;font-family:inherit">${v}</textarea></div>`;
        if (c.tipo === 'select') return `<div>${rot}<select id="${id}" style="width:100%;padding:.45rem .6rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem">
          <option value="">—</option>${c.ops.map(o => `<option${o === it[c.k] ? ' selected' : ''}>${leadsEsc(o)}</option>`).join('')}</select></div>`;
        if (c.tipo === 'color') return `<div>${rot}<input id="${id}" type="color" value="${v || '#0E8C7F'}" style="width:100%;height:36px;border:1px solid var(--border);border-radius:8px"></div>`;
        return `<div>${rot}<input id="${id}" value="${v}" style="width:100%;padding:.45rem .6rem;border:1px solid var(--border);border-radius:8px;font-size:.8rem"></div>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:.45rem;justify-content:flex-end;margin-top:.8rem">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('leads-cad-form-${leadsEsc(k)}').innerHTML=''">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="leadsCadGravar('${leadsEsc(k)}',${i})">Salvar</button>
    </div></div>`;
  const p = document.getElementById(`lc-${k}-${def.campos[0].k}`);
  if (p) p.focus();
}

async function leadsCadGravar(k, i){
  const def = leadsCadDef(k);
  if (!def) return;
  const item = {};
  for (const c of def.campos){
    const el = document.getElementById(`lc-${k}-${c.k}`);
    const v = el ? String(el.value || '').trim() : '';
    if (c.req && !v){
      if (typeof toast === 'function') toast(`Informe ${c.r.toLowerCase()}`, 'error');
      if (el) el.focus();
      return;
    }
    item[c.k] = v;
  }
  const lista = LEADS_CAD_DADOS[k] || (LEADS_CAD_DADOS[k] = []);
  if (i >= 0) lista[i] = item; else lista.push(item);
  try {
    await leadsCadSalvar(k);
    if (typeof toast === 'function') toast('Salvo', 'success');
    leadsCadDesenhar(k);
  } catch (e) {
    // Desfaz na memória: deixar na tela o que o banco recusou faz o gestor
    // acreditar que gravou.
    if (i >= 0) lista[i] = null; else lista.pop();
    LEADS_CAD_DADOS[k] = lista.filter(Boolean);
    if (typeof toast === 'function') toast('Não foi possível salvar: ' + String(e.message || e).slice(0,140), 'error');
    leadsCadDesenhar(k);
  }
}

async function leadsCadExcluir(k, i){
  const lista = LEADS_CAD_DADOS[k] || [];
  const it = lista[i];
  if (!it) return;
  if (!confirm(`Excluir "${it.name || 'este item'}"? Leads que já usam este valor continuam com ele gravado.`)) return;
  const copia = lista.slice();
  lista.splice(i, 1);
  try { await leadsCadSalvar(k); leadsCadDesenhar(k); }
  catch (e) {
    LEADS_CAD_DADOS[k] = copia;
    if (typeof toast === 'function') toast('Não foi possível excluir: ' + String(e.message || e).slice(0,140), 'error');
    leadsCadDesenhar(k);
  }
}

// ── O grupo no hub de Configurações ────────────────────────────────────────
// Chamado por cfgModsLiberar('crm'), ou seja: só existe com o módulo Leads
// licenciado. Sem licença, nem o cartão nem a sub-tela entram no DOM — o que
// não está no DOM ninguém acha com a busca do hub nem com o inspetor.

const LEADS_ICONE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B7568"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6M19 8v6"/></svg>`;

function leadsMontarConfig(){
  if (typeof cfgModsCartao !== 'function' || typeof cfgModsVista !== 'function') return;
  const grade = document.getElementById('cfg-cards-leads');
  if (!grade) return;
  LEADS_CAD.forEach(def => {
    cfgModsCartao({ id:'cfg-card-lead-' + def.key, modulo:'crm', grade:'cfg-cards-leads',
                    view:'lead-' + def.key, rotulo:def.rotulo, fundo:'#E6F4F1', icone:LEADS_ICONE });
    cfgModsVista('lead-' + def.key, def.rotulo, `
      <div class="cfg-explica">${leadsEsc(def.desc)} Esta lista alimenta os seletores do módulo Leads.</div>
      <div id="leads-cad-${leadsEsc(def.key)}"></div>`);
  });
  // O grupo só aparece quando há cartão dentro dele.
  const sec = document.getElementById('cfg-sec-leads');
  if (sec) sec.style.display = '';
}
