-- ════════════════════════════════════════════════════════════════════════════
-- EXCLUIR CLIENTE (superadmin): tudo ou nada
--
-- POR QUE ESTE ARQUIVO EXISTE
--   Ao excluir um cliente no superadmin, o navegador mandava três DELETE em
--   paralelo (usuários, parceiros, licenças de módulo) e depois o DELETE do
--   cliente. Tabelas novas (Central de atendimento, WhatsApp, IA, Meta, roleta,
--   sugestões) apontam para o cliente e para os usuários dele SEM cascata: o
--   DELETE dos usuários e o do cliente voltavam 409 (Conflict), mas o das
--   licenças já tinha passado. Resultado: cliente pela metade, sem módulos.
--
-- O QUE ELE FAZ
--   a1_sa_excluir_cliente(p_tenant): numa única transação, apaga as linhas do
--   cliente em toda tabela ligada a ele (chave para a1_tenants), anula ou apaga
--   as citações sem cascata aos usuários e parceiros dele, e por fim apaga o
--   cliente. Repete em voltas porque uma tabela pode depender de outra
--   (empreendimento -> unidade -> reserva). Também entra toda tabela com coluna
--   tenant_id, mesmo sem chave declarada. Linha de outro cliente nunca entra:
--   o filtro é sempre o id deste cliente (ou dos usuários/parceiros dele). A lista de tabelas é lida do
--   catálogo do Postgres: tabela nova com chave para o cliente entra sozinha.
--   Se qualquer passo falhar, NADA é apagado (a transação inteira volta).
--   Só a chave de serviço executa (o superadmin passa pela função sa-proxy).
--
-- O QUE ELE NÃO MUDA
--   Não apaga nada ao rodar: só cria a função. A exclusão continua sendo um
--   pedido explícito do superadmin, com a dupla confirmação da tela.
--   Arquivos no Storage (anexos) não são removidos por esta função.
--
-- COMO CONFERIR
--   select has_function_privilege('anon', 'a1_sa_excluir_cliente(uuid)', 'execute');          -- false
--   select has_function_privilege('service_role', 'a1_sa_excluir_cliente(uuid)', 'execute');  -- true
-- ════════════════════════════════════════════════════════════════════════════

create or replace function a1_sa_excluir_cliente(p_tenant uuid)
returns json language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_usuarios uuid[];
  v_parceiros uuid[];
  r record;
  v_pendente boolean;
  v_travadas text[];
  v_passo int := 0;
  v_n int;
  v_total int := 0;
  v_nome text;
begin
  select name into v_nome from a1_tenants where id = p_tenant;
  if v_nome is null then return json_build_object('ok', false, 'erro', 'nao_encontrado'); end if;
  perform pg_advisory_xact_lock(hashtextextended('excluir-cliente:' || p_tenant::text, 0));

  select coalesce(array_agg(id), '{}') into v_usuarios from a1_users where tenant_id = p_tenant;
  select coalesce(array_agg(id), '{}') into v_parceiros from a1_partners where tenant_id = p_tenant;

  -- Repete até nenhuma tabela reclamar: uma pode depender de outra
  -- (ex.: páginas da Meta apontam para a conexão da Meta).
  loop
    v_passo := v_passo + 1;
    v_pendente := false;
    v_travadas := '{}';
    for r in
      select distinct x.tabela, x.coluna, x.obrigatoria, x.alvo from (
        select c.conrelid::regclass as tabela, a.attname::text as coluna, a.attnotnull as obrigatoria,
               case c.confrelid when 'public.a1_tenants'::regclass then 't'
                                when 'public.a1_users'::regclass then 'u' else 'p' end as alvo
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and array_length(c.conkey, 1) = 1
           and (
             -- toda tabela com chave para o cliente: apaga as linhas DELE (com
             -- ou sem cascata, para desfazer cadeias como unidade -> reserva)
             c.confrelid = 'public.a1_tenants'::regclass
             -- usuários e parceiros do cliente citados sem cascata em outras tabelas
             or (c.confdeltype in ('a', 'r')
                 and c.confrelid in ('public.a1_users'::regclass, 'public.a1_partners'::regclass)))
        union all
        -- toda tabela com coluna tenant_id (mesmo sem chave declarada) é do cliente
        select format('%I.%I', col.table_schema, col.table_name)::regclass, 'tenant_id', true, 't'
          from information_schema.columns col
          join information_schema.tables tb on tb.table_schema = col.table_schema and tb.table_name = col.table_name
         where col.table_schema = 'public' and col.column_name = 'tenant_id' and col.data_type = 'uuid'
           and tb.table_type = 'BASE TABLE'
      ) x
    loop
      begin
        if r.alvo = 't' then
          execute format('delete from %s where %I = $1', r.tabela, r.coluna) using p_tenant;
        elsif r.obrigatoria then
          execute format('delete from %s where %I = any($1)', r.tabela, r.coluna)
            using case r.alvo when 'u' then v_usuarios else v_parceiros end;
        else
          execute format('update %s set %I = null where %I = any($1)', r.tabela, r.coluna, r.coluna)
            using case r.alvo when 'u' then v_usuarios else v_parceiros end;
        end if;
        get diagnostics v_n = row_count;
        v_total := v_total + v_n;
      exception when foreign_key_violation then
        v_pendente := true;
        v_travadas := v_travadas || (r.tabela::text || '.' || r.coluna::text || ': ' || sqlerrm);
      end;
    end loop;
    exit when not v_pendente;
    if v_passo >= 12 then
      raise exception 'dependencias_nao_resolvidas: %', array_to_string(v_travadas, ' | ')
        using errcode = 'foreign_key_violation';
    end if;
  end loop;

  delete from a1_users where tenant_id = p_tenant;
  delete from a1_partners where tenant_id = p_tenant;
  delete from a1_tenant_modules where tenant_id = p_tenant;
  delete from a1_tenants where id = p_tenant;
  return json_build_object('ok', true, 'cliente', v_nome, 'dependencias', v_total);
end $$;
revoke all on function a1_sa_excluir_cliente(uuid) from public, anon, authenticated;
grant execute on function a1_sa_excluir_cliente(uuid) to service_role;
