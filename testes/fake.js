// Supabase de mentira: responde a tudo o que as telas pedem, com dados que
// incluem caracteres perigosos, para provar que o HTML está escapado.
const XSS = `<img src=x onerror="window.__XSS=(window.__XSS||0)+1">`;
const ASPA = `Aspa" onfocus="window.__XSS=(window.__XSS||0)+1" x="`;

const D = {
  tenants: [{id:'t1',name:'THE CRED',slug:'thecred',tipo_cliente:'construtora',max_users:10,plan_key:'pro',status:'active'}],
  stages: [
    {id:'s1',name:'Documentação '+XSS,color:'#3D5CC8',group_key:'Centro',is_initial:true,is_final:false,position:1,module_key:'repasse'},
    {id:'s2',name:'Análise',color:'#12B981',group_key:'Centro',is_initial:false,is_final:false,position:2,module_key:'repasse'},
    {id:'s3',name:'Assinado',color:'#059669',group_key:'Centro',is_initial:false,is_final:true,position:3,module_key:'repasse'}],
  cases: [
    {id:'c1',tenant_id:'t1',module_key:'repasse',stage_id:'s1',stage_name:'Documentação',client_name:'Maria '+XSS,client_cpf:'52998224725',
     development:'Residencial das Flores',block:'B1',unit:'101',contract_value:250000,partner_name:'Correspondente A',
     broker_name:'Ana Souza',real_estate_name:'Imob Alfa',manager_name:'João Analista',observations:'obs '+XSS,is_new:true,
     created_at:'2026-08-01T10:00:00Z',stage_entered_at:'2026-08-01T10:00:00Z',
     attachment_pdf:'data:application/pdf;base64,JVBERi0xLjQK', attachment_name:'contrato-antigo.pdf',
     legacy_docs:[{id:'ld1',nome:'rg-antigo.pdf',data:'data:application/pdf;base64,JVBERi0xLjQK'}],
     payload:{regional:'Centro',convenio:'Convênio Alfa',agencia:'1234 - Centro',modalidade:'Imóvel na planta',estado:'SP',cidade:'Campinas',
              chave_que_nao_pode_sumir:'valor importante',data_venda:'2026-07-01'}},
    {id:'c2',tenant_id:'t1',module_key:'repasse',stage_id:'s3',stage_name:'Assinado',client_name:'Pedro Lima',client_cpf:'11144477735',
     development:'Parque das Águas',contract_value:180000,partner_name:'Correspondente B',broker_name:'Carla Dias',created_at:'2026-07-15T10:00:00Z',
     stage_entered_at:'2026-08-20T10:00:00Z',payload:{regional:'Centro',data_venda:'2026-07-01'}},
    {id:'c3',tenant_id:'t1',module_key:'repasse',stage_id:'s2',stage_name:'Análise',client_name:'Rui Santos',client_cpf:'52998224725',
     development:'Residencial das Flores',contract_value:150000,partner_name:'Correspondente A',broker_name:'Diego Melo',created_at:'2026-07-10T10:00:00Z',
     stage_entered_at:'2026-08-18T10:00:00Z',payload:{regional:'Centro',data_venda:'2026-08-08'}},
    {id:'c4',tenant_id:'t1',module_key:'repasse',stage_id:'s2',stage_name:'Análise',client_name:'Ivo Costa',client_cpf:'11144477735',
     development:'Parque das Águas',contract_value:90000,partner_name:'Correspondente A',broker_name:'Sem Equipe',created_at:'2026-07-05T10:00:00Z',
     stage_entered_at:'2026-08-17T10:00:00Z',payload:{regional:'Centro'}}],
  developments: [
    {id:'d1',tenant_id:'t1',name:'Residencial das Flores',regional:'Centro',estado:'SP',cidade:'Campinas',tipo:'blocos',unit_count:2,units:['B1-101','B1-102'],qtd_blocos:1,pavimentos:1,unidades_pav:2},
    {id:'d2',tenant_id:'t1',name:'Parque das Águas '+XSS,regional:'',tipo:'blocos',unit_count:0,units:[]},
    {id:'d3',tenant_id:'t1',name:'Empreendimento Sem Processo',regional:'',tipo:'blocos',unit_count:0,units:[]}],
  partners: [
    {id:'p1',tenant_id:'t1',type:'imobiliaria',name:'Imob Alfa '+ASPA,cpf:'11111111111',email:'a@x.com',is_active:true,approved:true},
    {id:'p20',tenant_id:'t1',type:'imobiliaria',name:'Imob Recem Cadastrada',cpf:'22233344455',is_active:true,approved:true},
    {id:'p21',tenant_id:'t1',type:'cca',name:'Usuario Novo CCA',cpf:'33344455566',is_active:true,approved:true,permissions:{}},
    {id:'p2',tenant_id:'t1',type:'analista',name:'João Analista',cpf:'22222222222',email:'j@x.com',is_active:true,approved:true,permissions:{}},
    {id:'p3',tenant_id:'t1',type:'corretor',name:'Ana Souza',cpf:'33333333333',is_active:true,approved:true,permissions:{etapas:{s1:'editar'}},extra:{coordenador_id:'p7'}},
    {id:'p4',tenant_id:'t1',type:'corretor',name:'Bruno '+XSS,cpf:'44444444444',is_active:true,approved:false,permissions:{},created_at:'2026-08-25T10:00:00Z',extra:{origem:'pre-cadastro',imobiliaria_nome:'Imob Alfa',enviado_em:'2026-08-25T10:00:00Z'}},
    {id:'p5',tenant_id:'t1',type:'convenio',name:'Convênio Alfa',is_active:true,approved:true},
    {id:'p6',tenant_id:'t1',type:'agencia',name:'Centro',is_active:true,approved:true,extra:{numero:'1234'}},
    {id:'p13',tenant_id:'t1',type:'modalidade',name:'Imóvel na planta',is_active:true,approved:true},
    {id:'p14',tenant_id:'t1',type:'modalidade',name:'Imóvel usado',is_active:true,approved:true},
    {id:'p7',tenant_id:'t1',type:'coordenador',name:'Marcos Lima',is_active:true,approved:true},
    {id:'p9',tenant_id:'t1',type:'coordenador',name:'Rita Alves',is_active:true,approved:true},
    {id:'p10',tenant_id:'t1',type:'corretor',name:'Carla Dias',cpf:'66666666666',is_active:true,approved:true,permissions:{},extra:{coordenador_id:'p7'}},
    {id:'p11',tenant_id:'t1',type:'corretor',name:'Diego Melo',cpf:'77777777777',is_active:true,approved:true,permissions:{},extra:{coordenador_id:'p9'}},
    {id:'p12',tenant_id:'t1',type:'corretor',name:'Sem Equipe',cpf:'12312312312',is_active:true,approved:true,permissions:{},extra:{}},
    {id:'p8',tenant_id:'t1',type:'cca',name:'Usuário Corr',cpf:'55555555555',is_active:true,approved:true,permissions:{}}],
  users: [{id:'u1',tenant_id:'t1',name:'Julio',cpf:'99999999999',role:'owner',is_active:true,last_seen:'2026-08-27T09:00:00Z'}],
  config: [{key:'regionais',value:'["Centro","Sul"]'},{key:'commission',value:'{}'},{key:'wf_lock_repasse',value:'false'},{key:'doc_types',value:'["RG","CPF"]'}],
  despachantes: [{id:'x1',nome:'Despachante '+XSS,email:'d@x.com',telefone:'11999999999'}],
  bancos: [{id:'b1',nome:'Banco '+XSS,codigo:'001'},{id:'b2',nome:'Caixa',codigo:'104'}],
  cartorios: [{id:'k1',nome:'Cartório '+XSS,municipio:'Campinas',uf:'SP'}],
  estados: [{uf:'MG',nome:'Minas Gerais'},{uf:'SP',nome:'São Paulo'}],
  municipios: {SP:['Campinas','Santos','São Paulo'], MG:['Belo Horizonte','Uberlândia']},
  precad_links: [{token:'tok123',imobiliaria_nome:'Imob Alfa',expires_at:'2026-09-30T12:00:00Z',usos:1,revoked:false}],
  corr_empresas: [{id:'e1',tenant_id:'t1',name:'Empresa Corr '+ASPA,cnpj:'00000000000000',is_active:true,regional:'Centro'},
                  {id:'e2',tenant_id:'t1',name:'Correspondente Sem Processo',cnpj:'11111111111111',is_active:true}],
  stage_edges: [{from_id:'s1',to_id:'s2'},{from_id:'s2',to_id:'s3'}],
  case_events: [{id:'ev1',case_id:'c1',type:'comment',description:'comentário '+XSS,actor_name:'Julio',created_at:'2026-08-02T10:00:00Z'}],
  stage_flags: [{id:'fl1',tenant_id:'t1',name:'Urgente',color:'#dc2626'}],
  // s1 = muitos processos recentes; s2 = poucos, mas parados há muito tempo
  extras: (()=>{ const out=[]; const hoje=Date.now();
    for(let i=0;i<20;i++) out.push({id:'x'+i,tenant_id:'t1',module_key:'repasse',stage_id:'s1',stage_name:'Documentação',
      client_name:'Recente '+i,created_at:new Date(hoje-2*864e5).toISOString(),
      stage_entered_at:new Date(hoje-2*864e5).toISOString(),payload:{}});
    for(let i=0;i<3;i++) out.push({id:'y'+i,tenant_id:'t1',module_key:'repasse',stage_id:'s2',stage_name:'Análise',
      client_name:'Parado '+i,created_at:new Date(hoje-90*864e5).toISOString(),
      stage_entered_at:new Date(hoje-90*864e5).toISOString(),payload:{}});
    return out; })(),
  stage_history: [], presence: [], leads: [], modules: [{key:'repasse',name:'Repasse'}],
};

// Os 23 processos de "extras" existem para o KPI de gargalo (muitos recentes
// numa etapa, poucos e parados em outra). Eles distorcem qualquer teste que
// conte cartões, então ficam DESLIGADOS por padrão: quem precisa deles pede.
let COM_EXTRAS = false;
function usarExtras(v) { COM_EXTRAS = v !== false; }

function responder(url, metodo) {
  const u = new URL(url);
  const p = u.pathname;
  const qs = u.search;
  if (p.includes('/rpc/a1_has_module')) return true;
  if (p.includes('/rpc/a1_touch_session')) return true;
  if (p.includes('/rpc/a1_ativos')) return 1;
  if (p.includes('/rpc/')) return {ok:true};
  if (metodo !== 'GET') return [{id:'novo-1'}];

  const t = p.split('/rest/v1/')[1] || '';
  const filtroTipo = (qs.match(/type=eq\.([a-z_]+)/)||[])[1];
  if (t === 'a1_tenants') return D.tenants;
  if (t === 'a1_stages') return D.stages;
  if (t === 'a1_cases') {
    // devolve SÓ as colunas pedidas, como o PostgREST faz — é o que prova que a
    // listagem deixou de baixar os anexos
    let r = COM_EXTRAS ? D.cases.concat(D.extras) : D.cases.slice();
    const id = (qs.match(/id=eq\.([a-z0-9-]+)/)||[])[1];
    if (id) r = r.filter(c=>c.id===id);
    const sel = (qs.match(/select=([^&]*)/)||[])[1];
    if (!sel) return r;
    const cols = decodeURIComponent(sel).split(',').map(s=>s.split(':').pop().trim());
    return r.map(c => { const o={}; for(const k of cols) if(k in c) o[k]=c[k]; return o; });
  }
  if (t === 'a1_stage_edges') return D.stage_edges;
  if (t === 'a1_stage_flags') return D.stage_flags;
  if (t === 'a1_config') return D.config;
  if (t === 'a1_developments') return D.developments;
  if (t === 'a1_users') return D.users;
  if (t === 'a1_case_events') return D.case_events;
  if (t === 'a1_stage_history') return D.stage_history;
  if (t === 'a1_presence') return D.presence;
  if (t === 'a1_leads') return D.leads;
  if (t === 'a1_modules' || t === 'a1_tenant_modules') return D.modules;
  if (t === 'a1_corr_empresas') return D.corr_empresas;
  if (t === 'a1_precad_links') return D.precad_links;
  if (t === 'a1_estados') return D.estados;
  if (t === 'a1_municipios') {
    const uf = (qs.match(/uf=eq\.([A-Z]{2})/)||[])[1];
    return (D.municipios[uf]||[]).map(n=>({nome:n, uf, codigo_ibge:1}));
  }
  if (t === 'despachantes') return D.despachantes;
  if (t === 'bancos') return D.bancos;
  if (t === 'cartorios') return D.cartorios;
  if (t === 'a1_partners') {
    let r = D.partners;
    if (filtroTipo) r = r.filter(x=>x.type===filtroTipo);
    if (/approved=eq\.false/.test(qs)) r = r.filter(x=>x.approved===false);
    if (/approved=eq\.true/.test(qs))  r = r.filter(x=>x.approved!==false);
    const id = (qs.match(/id=eq\.([a-z0-9-]+)/)||[])[1];
    if (id) r = r.filter(x=>x.id===id);
    return r;
  }
  return [];
}
module.exports = { responder, usarExtras, XSS, ASPA };
