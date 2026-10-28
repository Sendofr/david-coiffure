-- Server-authoritative six-month financial snapshot, independent of REST row caps.
-- Forward-only, no business data/schema rewrites. Apply after the two Phase 1 migrations.
begin;

create function public.report_financials(p_month date)
returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_valid boolean;
begin
  -- A logged-in session without an owner/manager profile must fail explicitly,
  -- rather than receive a plausible but RLS-filtered report of zero revenue.
  if not public.can_manage() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_month is null or not isfinite(p_month)
    or p_month < date '1900-01-01' or p_month > date '9999-12-01'
    or extract(day from p_month) <> 1 then
    raise exception 'Mes inválido: usar el primer día del mes (1900–9999)'
      using errcode = '22023';
  end if;

  -- STABLE uses the calling statement's MVCC snapshot. This one statement
  -- aggregates sales AND mutable expenses for all six months consistently;
  -- client pagination cannot otherwise guarantee cross-request consistency.
  -- Dates are salon business dates, without a conversion through server timezone.
  with months as (
    select (p_month - make_interval(months => i))::date as month
    from generate_series(0, 5) as series(i)
  ), sales_totals as (
    select date_trunc('month', s.sale_date::timestamp)::date as month,
      count(*) as sales_count,
      sum(s.total_gs) as revenue,
      sum(s.cost_total_gs) as direct_costs,
      bool_and(s.total_gs >= 0 and s.total_gs < 'Infinity'::numeric
        and s.cost_total_gs >= 0 and s.cost_total_gs < 'Infinity'::numeric) as valid
    from public.sales s
    where s.sale_date >= (p_month - interval '5 months')::date
      and s.sale_date < (p_month + interval '1 month')::date
    group by 1
  ), expense_totals as (
    select date_trunc('month', e.expense_date::timestamp)::date as month,
      count(*) as expenses_count,
      sum(e.amount_gs) as overhead,
      bool_and(e.amount_gs > 0 and e.amount_gs < 'Infinity'::numeric) as valid
    from public.expenses e
    where e.expense_date >= (p_month - interval '5 months')::date
      and e.expense_date < (p_month + interval '1 month')::date
    group by 1
  ), monthly as (
    select to_char(m.month, 'YYYY-MM') as month,
      coalesce(s.sales_count, 0) as "salesCount",
      coalesce(e.expenses_count, 0) as "expensesCount",
      coalesce(s.revenue, 0) as revenue,
      coalesce(s.direct_costs, 0) as "directCosts",
      coalesce(e.overhead, 0) as overhead,
      coalesce(s.revenue, 0) - coalesce(s.direct_costs, 0) as gross,
      coalesce(s.revenue, 0) - coalesce(s.direct_costs, 0) - coalesce(e.overhead, 0) as balance,
      coalesce(s.valid, true) and coalesce(e.valid, true) as valid
    from months m
    left join sales_totals s using (month)
    left join expense_totals e using (month)
  )
  select
    (select to_jsonb(selected) - 'valid' from monthly selected
      where selected.month = to_char(p_month, 'YYYY-MM'))
      || jsonb_build_object('history', jsonb_agg(to_jsonb(monthly) - 'valid' order by month)),
    bool_and(valid)
  into v_result, v_valid
  from monthly;

  -- Old NOT VALID constraints can coexist with historical invalid rows. Do not
  -- publish a report containing NaN/infinity as if it were an accurate balance.
  if v_valid is distinct from true then
    raise exception 'El período contiene importes históricos inválidos; revisar antes de informar'
      using errcode = '23514';
  end if;
  return v_result;
end;
$$;

revoke all on function public.report_financials(date) from public, anon, authenticated;
grant execute on function public.report_financials(date) to authenticated;
comment on function public.report_financials(date) is
  'Owner/manager only, RLS + explicit role check. One MVCC snapshot, selected business month and preceding five, no REST row cap. Operational estimate, not certified accounting profit.';

commit;
