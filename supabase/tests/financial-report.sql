\set ON_ERROR_STOP on
begin;
create temp table financial_assertions(n integer not null default 0);
insert into financial_assertions values(0);
grant all on financial_assertions to anon,authenticated;
create function pg_temp.financial_ok(condition boolean,label text) returns void language plpgsql as $$
begin
 if condition is distinct from true then raise exception 'FAIL: %',label; end if;
 update financial_assertions set n=n+1;
 raise notice 'PASS: %',label;
end $$;
create function pg_temp.financial_denied(command text,expected_state text,label text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
   if sqlstate=expected_state then perform pg_temp.financial_ok(true,label); return; end if;
   raise exception 'FAIL: %, expected %, received %: %',label,expected_state,sqlstate,sqlerrm;
 end;
 raise exception 'FAIL: % was allowed',label;
end $$;
create temp table reports(label text primary key,data jsonb);
grant all on reports to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','owner@test.invalid'),
 ('00000000-0000-0000-0000-000000000002','manager@test.invalid'),
 ('00000000-0000-0000-0000-000000000003','stylist@test.invalid'),
 ('00000000-0000-0000-0000-000000000004','outsider@test.invalid');
insert into public.profiles(id,role) values
 ('00000000-0000-0000-0000-000000000001','owner'),
 ('00000000-0000-0000-0000-000000000002','manager'),
 ('00000000-0000-0000-0000-000000000003','stylist');
insert into public.services(id,name,price_gs) values
 ('20000000-0000-0000-0000-000000000001','Financial test service',100);
insert into public.sales(kind,service_id,sale_date,quantity,unit_price_gs,unit_cost_gs,payment_method,created_by)
 select 'servicio','20000000-0000-0000-0000-000000000001',date '2026-10-01'+((i-1)%31),1,100,40,'Efectivo','00000000-0000-0000-0000-000000000001'
 from generate_series(1,1505) as series(i);
insert into public.expenses(expense_date,category,description,amount_gs)
 select date '2026-10-01'+((i-1)%31),'Operativo','Bulk expense '||i,10
 from generate_series(1,1505) as series(i);
insert into public.sales(kind,service_id,sale_date,quantity,unit_price_gs,unit_cost_gs,payment_method) values
 ('servicio','20000000-0000-0000-0000-000000000001','2026-04-30',1,999,1,'Efectivo'),
 ('servicio','20000000-0000-0000-0000-000000000001','2026-05-01',1,200,50,'Efectivo'),
 ('servicio','20000000-0000-0000-0000-000000000001','2026-09-30',1,300,70,'Efectivo'),
 ('servicio','20000000-0000-0000-0000-000000000001','2026-11-01',1,10000,100,'Efectivo'),
 ('servicio','20000000-0000-0000-0000-000000000001','2024-02-29',1,123.45,23.45,'Efectivo');
insert into public.expenses(expense_date,category,description,amount_gs) values
 ('2026-04-30','Operativo','Outside window',999),
 ('2026-05-01','Operativo','First history month',20),
 ('2026-09-30','Operativo','Last prior month',30),
 ('2026-11-01','Operativo','Outside selected month',100),
 ('2024-02-29','Operativo','Leap day',4.50);

set local role anon;
select pg_temp.financial_denied($q$select public.report_financials('2026-10-01')$q$,'42501','Anonymous report denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.financial_denied($q$select public.report_financials('2026-10-01')$q$,'42501','Stylist report denied explicitly, not zero totals');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.financial_denied($q$select public.report_financials('2026-10-01')$q$,'42501','User without profile report denied');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.financial_denied($q$select public.report_financials('2026-10-01')$q$,'42501','Session without user report denied');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into reports values('owner',public.report_financials('2026-10-01'));
select pg_temp.financial_ok((select data->>'month'='2026-10' from reports where label='owner'),'Selected business month returned');
select pg_temp.financial_ok((select (data->>'salesCount')::bigint=1505 and (data->>'expensesCount')::bigint=1505 from reports where label='owner'),'All 1505 sales and 1505 expenses counted beyond REST cap');
select pg_temp.financial_ok((select (data->>'revenue')::numeric=150500 and (data->>'directCosts')::numeric=60200 from reports where label='owner'),'Full monthly revenue and historical direct costs');
select pg_temp.financial_ok((select (data->>'overhead')::numeric=15050 and (data->>'gross')::numeric=90300 and (data->>'balance')::numeric=75250 from reports where label='owner'),'Full monthly expenses, gross margin and estimated balance');
select pg_temp.financial_ok((select jsonb_array_length(data->'history')=6 from reports where label='owner'),'History contains exactly six months');
select pg_temp.financial_ok((select data#>>'{history,0,month}'='2026-05' and data#>>'{history,5,month}'='2026-10' from reports where label='owner'),'History ordered ascending includes selected month');
select pg_temp.financial_ok((select (data#>>'{history,0,revenue}')::numeric=200 and (data#>>'{history,0,balance}')::numeric=130 from reports where label='owner'),'First day of six-month window included, prior April excluded');
select pg_temp.financial_ok((select (data#>>'{history,4,revenue}')::numeric=300 and (data#>>'{history,4,balance}')::numeric=200 from reports where label='owner'),'Prior month last day included');
select pg_temp.financial_ok((select (data#>>'{history,1,salesCount}')::bigint=0 and (data#>>'{history,1,expensesCount}')::bigint=0 and (data#>>'{history,1,balance}')::numeric=0 from reports where label='owner'),'Empty months contain explicit zero counts and values');
select pg_temp.financial_ok((select data->'history'->5 = data-'history' from reports where label='owner'),'Selected summary and history use identical aggregate results');
insert into reports values('leap',public.report_financials('2024-02-01'));
select pg_temp.financial_ok((select (data->>'revenue')::numeric=123.45 and (data->>'directCosts')::numeric=23.45 and (data->>'overhead')::numeric=4.50 and (data->>'balance')::numeric=95.50 from reports where label='leap'),'Leap-day amounts preserve decimal precision');
insert into reports values('empty',public.report_financials('2025-01-01'));
select pg_temp.financial_ok((select (data->>'salesCount')::bigint=0 and (data->>'revenue')::numeric=0 and jsonb_array_length(data->'history')=6 from reports where label='empty'),'Entirely empty period returns a complete zero report');
set local timezone='Pacific/Auckland';
select pg_temp.financial_ok((select public.report_financials('2026-10-01')=data from reports where label='owner'),'Business-date month boundaries do not depend on database timezone');
set local timezone='America/Asuncion';
select pg_temp.financial_ok((select public.report_financials('2026-10-01')=data from reports where label='owner'),'Asuncion timezone preserves same financial business dates');
select pg_temp.financial_denied($q$select public.report_financials(null)$q$,'22023','NULL month rejected');
select pg_temp.financial_denied($q$select public.report_financials('infinity')$q$,'22023','Infinite month rejected');
select pg_temp.financial_denied($q$select public.report_financials('-infinity')$q$,'22023','Negative infinite month rejected');
select pg_temp.financial_denied($q$select public.report_financials('2026-10-15')$q$,'22023','Non-first day rejected');
select pg_temp.financial_denied($q$select public.report_financials('1899-12-01')$q$,'22023','Below supported date range rejected');
select pg_temp.financial_denied($q$select public.report_financials('10000-01-01')$q$,'22023','Above supported date range rejected');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.financial_ok((select public.report_financials('2026-10-01')=data from reports where label='owner'),'Manager authorized for same full financial report');
update public.expenses set amount_gs=25 where description='Bulk expense 1';
insert into reports values('updated',public.report_financials('2026-10-01'));
select pg_temp.financial_ok((select (data->>'overhead')::numeric=15065 and (data->>'balance')::numeric=75235 from reports where label='updated'),'Next report reflects mutable expense exactly');
reset role;
select pg_temp.financial_ok((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.report_financials(date)'::regprocedure),'Financial RPC is SECURITY INVOKER STABLE with pinned search_path');
select pg_temp.financial_ok(not has_function_privilege('anon','public.report_financials(date)','EXECUTE'),'Anonymous has no EXECUTE privilege, including PUBLIC inheritance');

-- Simulate a preserved pre-hardening NaN row without relaxing production checks:
-- remove the constraint ONLY inside this disposable test transaction, then restore
-- it NOT VALID, exactly reproducing the legacy state the audit addresses.
alter table public.expenses drop constraint expenses_finite_amount;
insert into public.expenses(expense_date,category,description,amount_gs) values('2026-10-10','Operativo','Legacy invalid expense','NaN');
alter table public.expenses add constraint expenses_finite_amount check (amount_gs > 0 and amount_gs <= 999999999999.99 and isfinite(expense_date)) not valid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.financial_denied($q$select public.report_financials('2026-10-01')$q$,'23514','Historical NaN expense makes report unavailable instead of misleading totals');
reset role;
select 'PASS: '||n||' financial report assertions with 1505 sales and 1505 expenses' as result from financial_assertions;
rollback;
