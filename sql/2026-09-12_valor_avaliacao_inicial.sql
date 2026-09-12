-- Valor de avaliação informado na abertura da pré-análise.
-- Valores monetários são armazenados em centavos.
alter table public.a1_pre_analises
  add column if not exists valor_avaliacao_inicial bigint null;

comment on column public.a1_pre_analises.valor_avaliacao_inicial is
  'Valor de avaliação informado na abertura da pré-análise, em centavos; usado como valor imutável na decisão de crédito.';

-- A tela já bloqueia o campo; esta trava no banco impede alteração por REST
-- ou por qualquer cliente que envie outro valor na decisão de crédito.
create or replace function public.a1_pa_fixar_valor_avaliacao_inicial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valor bigint;
begin
  select valor_avaliacao_inicial
    into v_valor
    from public.a1_pre_analises
   where id = new.pre_analise_id;

  if v_valor is not null then
    new.valor_avaliacao := v_valor;
  end if;
  return new;
end;
$$;

drop trigger if exists a1_pa_fixar_valor_avaliacao_inicial on public.a1_pa_analises_credito;
create trigger a1_pa_fixar_valor_avaliacao_inicial
before insert on public.a1_pa_analises_credito
for each row execute function public.a1_pa_fixar_valor_avaliacao_inicial();