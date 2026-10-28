\set ON_ERROR_STOP on
begin;
create temp table assertions(n integer not null default 0);
insert into assertions values(0);
grant all on assertions to anon,authenticated;
create function pg_temp.ok(condition boolean,label text) returns void language plpgsql as $$
begin
 if condition is distinct from true then raise exception 'FAIL: %', label; end if;
 update assertions set n=n+1;
 raise notice 'PASS: %', label;
end $$;
create function pg_temp.denied(command text,expected_state text,label text) returns void language plpgsql as $$
begin
 begin
   execute command;
 exception when others then
   if sqlstate=expected_state then perform pg_temp.ok(true,label); return; end if;
   raise exception 'FAIL: %, expected %, received %: %',label,expected_state,sqlstate,sqlerrm;
 end;
 raise exception 'FAIL: % was allowed',label;
end $$;
-- Simulate unknown legacy permissive policies. Restrictive hardening must still
-- prevent unauthorized authenticated roles from seeing/writing private records.
create policy legacy_all_staff on public.staff for all to authenticated using (true) with check (true);
create policy legacy_all_services on public.services for all to authenticated using (true) with check (true);
create policy legacy_all_clients on public.clients for all to authenticated using (true) with check (true);
create policy legacy_all_appointments on public.appointments for all to authenticated using (true) with check (true);
create policy legacy_all_products on public.products for all to authenticated using (true) with check (true);
create policy legacy_all_profiles on public.profiles for all to authenticated using (true) with check (true);
create policy legacy_all_movements on public.stock_movements for all to authenticated using (true) with check (true);
create policy legacy_all_sales on public.sales for all to authenticated using (true) with check (true);
create policy legacy_all_expenses on public.expenses for all to authenticated using (true) with check (true);
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','owner@test.invalid'),
 ('00000000-0000-0000-0000-000000000002','manager@test.invalid'),
 ('00000000-0000-0000-0000-000000000003','stylist@test.invalid'),
 ('00000000-0000-0000-0000-000000000004','outsider@test.invalid');
insert into public.staff(id,name) values
 ('10000000-0000-0000-0000-000000000001','Assigned stylist'),
 ('10000000-0000-0000-0000-000000000002','Other stylist');
insert into public.profiles(id,display_name,role,staff_id) values
 ('00000000-0000-0000-0000-000000000001','Owner','owner',null),
 ('00000000-0000-0000-0000-000000000002','Manager','manager',null),
 ('00000000-0000-0000-0000-000000000003','Stylist','stylist','10000000-0000-0000-0000-000000000001');
insert into public.services(id,name,active,price_gs) values
 ('20000000-0000-0000-0000-000000000001','Active service',true,100),
 ('20000000-0000-0000-0000-000000000002','Inactive service',false,100);
insert into public.clients(name,phone) values ('Private client','000');
insert into public.appointments(client_name,client_phone,service_id,staff_id,appointment_date,start_time,end_time,status) values
 ('Assigned client','000','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2026-11-03','10:00','11:00','confirmado'),
 ('Other client','000','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','2026-11-03','10:00','11:00','confirmado');
insert into public.products(id,name,sku,category,cost_gs,sale_price_gs,stock_qty) values
 ('30000000-0000-0000-0000-000000000001','Product','TEST-SKU','Venta',40,100,999);
select pg_temp.ok((select stock_qty=0 from public.products),'Product starts at zero even if supplied');

set local role anon;
select pg_temp.ok((select count(*)=1 from public.services),'Anon sees only active services');
select pg_temp.denied('select * from public.staff','42501','Anon cannot inspect team');
select pg_temp.denied('select * from public.clients','42501','Anon cannot inspect clients');
select pg_temp.denied('select * from public.appointments','42501','Anon cannot inspect appointments');
select pg_temp.denied('select * from public.products','42501','Anon cannot inspect inventory');
select pg_temp.denied('select * from public.sales','42501','Anon cannot inspect sales');
select pg_temp.denied('select * from public.expenses','42501','Anon cannot inspect expenses');
select pg_temp.denied('select * from public.stock_movements','42501','Anon cannot inspect movements');
select pg_temp.denied('select * from public.profiles','42501','Anon cannot inspect profiles');
select pg_temp.denied('select public.can_manage()','42501','Anon cannot execute private auth helper');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001',1,'entrada','')$q$,'42501','Anon cannot call stock RPC');
select pg_temp.denied($q$insert into public.services(name) values('Injected')$q$,'42501','Anon cannot create services');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.ok((select count(*)=0 from public.clients),'Unprofiled user cannot read clients');
select pg_temp.ok((select count(*)=0 from public.staff),'Unprofiled user cannot read staff');
select pg_temp.ok((select count(*)=0 from public.appointments),'Unprofiled user cannot read appointments');
select pg_temp.ok((select count(*)=0 from public.products),'Unprofiled user cannot read inventory');
select pg_temp.denied($q$insert into public.profiles(id,role) values('00000000-0000-0000-0000-000000000004','owner')$q$,'42501','User cannot self provision owner');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,1,100,0,'Efectivo','','')$q$,'42501','Unprofiled user cannot sell');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.ok((select count(*)=1 from public.profiles),'Stylist sees own profile only');
select pg_temp.ok((select count(*)=1 from public.appointments),'Stylist sees only assigned appointments');
select pg_temp.ok((select count(*)=0 from public.clients),'Stylist cannot read client directory');
select pg_temp.ok((select count(*)=0 from public.products),'Stylist cannot read inventory costs');
select pg_temp.ok((select count(*)=0 from public.sales),'Stylist cannot read sales');
select pg_temp.ok((select count(*)=0 from public.expenses),'Stylist cannot read expenses');
select pg_temp.ok((select count(*)=0 from public.stock_movements),'Stylist cannot read movements');
select pg_temp.ok((select count(*)=2 from public.staff),'Stylist can read internal team catalog');
select pg_temp.ok((select count(*)=2 from public.services),'Stylist can read team service catalog');
select pg_temp.denied($q$insert into public.clients(name,phone) values('Attack','000')$q$,'42501','Stylist cannot create clients');
select pg_temp.denied($q$insert into public.appointments(client_name,client_phone,appointment_date,start_time,end_time) values('Attack','000',current_date,'10:00','11:00')$q$,'42501','Stylist cannot create appointments');
select pg_temp.denied($q$update public.profiles set role='owner'$q$,'42501','Stylist cannot escalate role');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001',1,'entrada','')$q$,'42501','Stylist cannot change stock');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,1,100,0,'Efectivo','','')$q$,'42501','Stylist cannot sell');

-- RLS-filtered UPDATE/DELETE returns zero rows rather than an exception.
with changed as (update public.clients set name='Forged' returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist client UPDATE affects zero rows');
with changed as (delete from public.clients returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist client DELETE affects zero rows');
with changed as (update public.appointments set status='cancelado' returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist assigned appointment UPDATE affects zero rows');
with changed as (delete from public.appointments returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist appointment DELETE affects zero rows');
with changed as (update public.staff set name='Forged' returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist staff UPDATE affects zero rows');
with changed as (delete from public.staff returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist staff DELETE affects zero rows');
with changed as (update public.services set price_gs=0 returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist service UPDATE affects zero rows');
with changed as (delete from public.services returning id)
select pg_temp.ok((select count(*)=0 from changed),'Stylist service DELETE affects zero rows');
select pg_temp.denied($q$insert into public.staff(name) values('Forged')$q$,'42501','Stylist staff INSERT rejected');
select pg_temp.denied($q$insert into public.services(name) values('Forged')$q$,'42501','Stylist service INSERT rejected');
select pg_temp.denied($q$insert into public.products(name,sku,category) values('Forged','FORGED','Venta')$q$,'42501','Stylist product INSERT rejected');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.ok((select count(*)=3 from public.profiles),'Owner can read team profiles');
select pg_temp.ok((select count(*)=2 from public.appointments),'Owner can read all appointments');
insert into public.clients(name,phone) values('Owner client','000');
select pg_temp.ok((select count(*)=2 from public.clients),'Owner can create and read clients');
select public.record_stock_movement('30000000-0000-0000-0000-000000000001',2,'entrada','Test receipt');
select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,'2026-11-03',1,100,999,'Efectivo','','');
select pg_temp.ok((select stock_qty=1 from public.products),'Sale decreases inventory');
select pg_temp.ok((select unit_cost_gs=40 and total_gs=100 and cost_total_gs=40 and gross_profit_gs=60 from public.sales),'Product historical cost ignores browser override and reports derived values');
select pg_temp.ok((select count(*)=2 from public.stock_movements),'Receipt and sale each leave movement');
select pg_temp.denied($q$update public.products set stock_qty=999$q$,'42501','Direct stock updates denied even to owner');
select pg_temp.denied($q$insert into public.sales(kind) values('producto')$q$,'42501','Direct sale inserts denied');
select pg_temp.denied($q$update public.sales set unit_cost_gs=0$q$,'42501','Historical sales immutable');
select pg_temp.denied($q$delete from public.sales$q$,'42501','Sales cannot be deleted');
select pg_temp.denied($q$insert into public.stock_movements(product_id,kind,delta_qty) values('30000000-0000-0000-0000-000000000001','entrada',100)$q$,'42501','Movement inserts only through RPC');
select pg_temp.denied($q$update public.stock_movements set delta_qty=999$q$,'42501','Movement history immutable');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,2,100,40,'Efectivo','','')$q$,'23514','Insufficient stock rejected');
select pg_temp.ok((select stock_qty=1 from public.products),'Rejected sale did not change inventory');
select pg_temp.ok((select count(*)=1 from public.sales),'Rejected sale left no financial row');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001',1,null,'')$q$,'22023','NULL movement kind rejected');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001','NaN','entrada','')$q$,'22023','NaN movement rejected');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001',0.0001,'entrada','')$q$,'22023','Subprecision movement rejected');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001',-1,'entrada','')$q$,'22023','Wrong movement sign rejected');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,'NaN',100,40,'Efectivo','','')$q$,'22023','NaN sale quantity rejected');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,0.0001,100,40,'Efectivo','','')$q$,'22023','Subprecision sale quantity rejected');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,1,'NaN',40,'Efectivo','','')$q$,'22023','NaN price rejected');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,1,0.001,40,'Efectivo','','')$q$,'22023','Subprecision price rejected');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001','Infinity','entrada','')$q$,'22023','Infinite movement rejected');
select pg_temp.denied($q$select public.record_stock_movement('30000000-0000-0000-0000-000000000001',null,'entrada','')$q$,'22023','NULL movement quantity rejected');
select pg_temp.denied($q$select public.register_sale(null,'30000000-0000-0000-0000-000000000001',null,current_date,1,100,40,'Efectivo','','')$q$,'22023','NULL sale kind rejected');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,1,100,40,null,'','')$q$,'22023','NULL payment method rejected');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,'infinity',1,100,40,'Efectivo','','')$q$,'22023','Infinite sale date rejected');
select pg_temp.denied($q$select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,'-Infinity',100,40,'Efectivo','','')$q$,'22023','Infinite quantity rejected');
select pg_temp.denied($q$select public.register_sale('servicio',null,'20000000-0000-0000-0000-000000000001',current_date,1,100,'NaN','Efectivo','','')$q$,'22023','NaN service cost rejected');
select pg_temp.denied($q$select public.register_sale('servicio',null,'20000000-0000-0000-0000-000000000001',current_date,1,100,null,'Efectivo','','')$q$,'22023','NULL service cost rejected');
select pg_temp.denied($q$insert into public.products(name,sku,category,min_qty) values('Invalid','INVALID','Venta','NaN')$q$,'23514','Direct NaN numeric rejected');
select pg_temp.denied($q$insert into public.products(name,sku,category) values('Duplicate','TEST-SKU','Venta')$q$,'23505','SKU uniqueness enforced');
select pg_temp.denied($q$insert into public.clients(name,phone) values('  ','000')$q$,'23514','Blank client name rejected');
select pg_temp.denied($q$insert into public.appointments(client_name,client_phone,staff_id,appointment_date,start_time,end_time,status) values('Conflict','000','10000000-0000-0000-0000-000000000001','2026-11-03','10:30','11:30','confirmado')$q$,'23P01','Confirmed appointment overlap rejected by PostgreSQL');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.ok((select count(*)=2 from public.clients),'Manager reads administrative clients');
insert into public.expenses(category,description,amount_gs) values('Operativo','Test expense',10);
select pg_temp.ok((select count(*)=1 from public.expenses),'Manager creates and reads expense');
select public.register_sale('servicio',null,'20000000-0000-0000-0000-000000000001',current_date,1,100,20,'Tarjeta','','');
select pg_temp.ok((select count(*)=2 from public.sales),'Manager can register service sale');
select pg_temp.denied($q$update public.profiles set role='owner'$q$,'42501','Manager cannot change roles');
reset role;
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not (p.proconfig @> array['search_path=""'])),'All application SECURITY DEFINER functions pin empty search_path');
select 'PASS: '||n||' database assertions' as result from assertions;
rollback;
