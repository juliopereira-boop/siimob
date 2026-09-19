const fs = require('fs');
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const cfg = fs.readFileSync(path.join(raiz, 'configuracoes.html'), 'utf8');
const pa = fs.readFileSync(path.join(raiz, 'pre-analise.html'), 'utf8');
const sql = fs.readFileSync(path.join(raiz, 'supabase/sql/2026-09-19_gestor_modulos_e_ciclo_distribuicao.sql'), 'utf8');

assert(cfg.includes('Módulos liberados'), 'cadastro do gestor deve falar em módulos');
assert(cfg.includes('Sem módulos marcados, é Gestor Geral'), 'sem marca deve explicar o escopo geral');
assert(sql.includes('not exists (') && sql.includes("'ver_dashboard_lead'"), 'SQL deve tratar ausência de marcas como gestor geral');
assert(sql.includes('a1_gestor_modulo(p_module_key)'), 'licença deve considerar escopo do gestor');

assert(cfg.includes("view:'ciclo-pa'"), 'configuração deve expor o Ciclo de Distribuição');
assert(cfg.includes("p_modo:modo,p_participantes:participantes"), 'tela deve persistir o ciclo por RPC');
assert(sql.includes('pg_advisory_xact_lock'), 'distribuição concorrente deve ser serializada');
assert(sql.includes("s.selo='FIM_POSITIVO'"), 'desempenho deve usar o selo estrutural do workflow');
assert(sql.includes("modo in ('LIVRE','DESEMPENHO')"), 'os dois critérios devem ser validados pelo banco');
assert(sql.includes('unique (tenant_id, analista_id)'), 'analista não pode ser duplicado no ciclo');
assert(sql.includes('pre_analise_id uuid not null unique'), 'retry da mesma pré-análise deve ser idempotente');
assert(sql.includes('new.empresa_id:=v_p.empresa_id') && sql.includes('new.correspondente_id:=v_p.correspondente_id'), 'trigger deve sobrescrever toda a hierarquia');

assert(pa.includes("A1.rpc('a1_pa_ciclo_estado')"), 'assistente deve consultar o estado real do ciclo');
assert(pa.includes("id=\"w-empresa\" ${roteia?'disabled':''}"), 'empresa deve ser bloqueada quando o ciclo está ativo');
assert(pa.includes("id=\"w-correspondente\" ${roteia?'disabled':''}"), 'correspondente deve ser bloqueado quando o ciclo está ativo');
assert(pa.includes("if (!roteamentoDeAnalistasAtivo())"), 'frontend não deve mandar atribuição manual com ciclo ativo');

console.log('OK ciclo de distribuição e escopo do gestor');
