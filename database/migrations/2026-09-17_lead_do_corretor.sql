-- ══════════════════════════════════════════════════════════════════════════════
-- O lead é de quem o criou — e o corretor não se desvincula dele
-- ══════════════════════════════════════════════════════════════════════════════
--
-- POR QUE ESTE ARQUIVO EXISTE
-- Regra do dono, dita assim: "se um corretor criar um lead, esse lead tem que
-- ser automaticamente vinculado a ele, e ele não pode desvincular o lead dele,
-- fica vinculado o corretor e a imobiliária". O gestor tem o poder: escolhe na
-- criação e transfere depois.
--
-- METADE DISSO JÁ ESTAVA DE PÉ, e vale dizer qual: a política
-- a1_cases_crm_scope_update (2026-09-14) exige, no `with check`, que a linha
-- RESULTANTE de um update feito por corretor continue com o nome dele em
-- broker_name. Ou seja, trocar o corretor por outro, ou apagar o campo, já
-- falhava. O que faltava era a IMOBILIÁRIA — e faltava a mensagem: a recusa
-- vinha como violação de política, sem dizer por quê.
--
-- Este arquivo fecha os dois buracos com um gatilho, que é o lugar certo para
-- uma regra que precisa EXPLICAR. Política diz sim ou não; gatilho diz o motivo.
--
-- O QUE ESTE ARQUIVO NÃO MUDA
-- Nenhuma linha de dado, nenhuma política existente, e nada fora de
-- module_key = 'crm'. Gestor continua podendo tudo. Lead que já existe segue
-- como está — o gatilho só olha o que está sendo ALTERADO agora.
--
-- SEGURO DE RODAR DUAS VEZES.
begin;

create or replace function public.a1_crm_trava_dono()
returns trigger
language plpgsql
security definer
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_ator  uuid;
  v_nome  text;
  v_tipo  text;
  v_imob  text;
begin
  -- Só leads. Repasse e Registro moram na mesma tabela e não têm esta regra.
  if coalesce(new.module_key, '') <> 'crm' then return new; end if;

  -- O gestor manda. É ele quem escolhe o corretor na criação e quem transfere
  -- o lead depois — foi o que o dono confirmou quando perguntei.
  if a1_e_gestor() then return new; end if;

  v_ator := a1_ator();
  if v_ator is null then return new; end if;

  select p.name, p.type,
         (select i.name from a1_partners i
           where i.id = nullif(p.extra->>'imobiliaria_id','')::uuid)
    into v_nome, v_tipo, v_imob
    from a1_partners p
   where p.id = v_ator and p.tenant_id = new.tenant_id;

  if v_tipo is distinct from 'corretor' then return new; end if;

  -- ── Na criação: o lead nasce DELE, tenha a tela mandado o que tiver ──────
  -- Carimbar aqui e não confiar no que veio da tela é o ponto: o navegador é
  -- do usuário, e um POST montado à mão poria o lead no nome de outro corretor.
  if tg_op = 'INSERT' then
    new.broker_name := v_nome;
    -- A imobiliária só é imposta quando ele tem uma cadastrada. Sobrescrever
    -- com vazio apagaria o que o gestor tivesse preenchido antes.
    if v_imob is not null and v_imob <> '' then
      new.real_estate_name := v_imob;
    end if;
    return new;
  end if;

  -- ── Na alteração: ele não se desvincula nem se transfere ────────────────
  if lower(trim(coalesce(new.broker_name, ''))) is distinct from
     lower(trim(coalesce(old.broker_name, ''))) then
    raise exception 'O lead fica com o corretor que o atende. Só um gestor pode transferi-lo.'
      using errcode = 'check_violation';
  end if;

  if lower(trim(coalesce(new.real_estate_name, ''))) is distinct from
     lower(trim(coalesce(old.real_estate_name, ''))) then
    raise exception 'A imobiliária do lead vem do cadastro do corretor. Quem altera é um gestor.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke all on function public.a1_crm_trava_dono() from public;

drop trigger if exists a1_crm_trava_dono_t on public.a1_cases;
create trigger a1_crm_trava_dono_t
  before insert or update on public.a1_cases
  for each row execute function public.a1_crm_trava_dono();

commit;

-- ── CONFERÊNCIA ──────────────────────────────────────────────────────────────
-- Com uma sessão de CORRETOR:
--
-- 1. O lead nasce no nome dele, mesmo mandando outro:
--    insert into a1_cases (tenant_id, module_key, client_name, broker_name)
--    values (a1_tenant(), 'crm', 'Teste', 'Outro Corretor')
--    returning broker_name, real_estate_name;   -- volta o nome DELE
--
-- 2. Ele não transfere:
--    update a1_cases set broker_name = 'Outro' where id = '<o lead dele>';
--    -- ERRO: O lead fica com o corretor que o atende.
--
-- 3. Nem troca de imobiliária:
--    update a1_cases set real_estate_name = 'Outra Imob' where id = '<o lead dele>';
--    -- ERRO: A imobiliária do lead vem do cadastro do corretor.
--
-- 4. Mas edita o resto normalmente:
--    update a1_cases set client_phone = '98999990000' where id = '<o lead dele>';
--    -- passa
--
-- Com uma sessão de GESTOR, os três updates acima passam.
--
-- 5. E nada fora de Leads foi tocado. Os números têm de ser os mesmos de antes:
--    select module_key, count(*) from a1_cases group by 1 order by 1;
