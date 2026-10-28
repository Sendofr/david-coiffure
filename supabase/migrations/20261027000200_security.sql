-- Phase 1: forward-only hardening. Never delete existing business data.
-- Apply through Supabase migrations, not individually from the browser.
-- NOT VALID constraints enforce new writes while preserving legacy rows for audit.
begin;

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
-- New migrations must explicitly REVOKE PUBLIC EXECUTE on each RPC before
-- granting intended roles; PostgreSQL grants function execution to PUBLIC by default.

-- Table-level REVOKE does not remove grants previously made on individual columns.
do $$
declare t text; cols text;
begin
  foreach t in array array['profiles','staff','services','clients','appointments','products','stock_movements','sales','expenses'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    select string_agg(quote_ident(attname), ',') into cols from pg_attribute
      where attrelid = format('public.%I',t)::regclass and attnum > 0 and not attisdropped;
    execute format('revoke select (%s), insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',cols,cols,cols,cols,t);
  end loop;
end $$;

grant select on public.services to anon;
grant select on public.profiles,public.staff,public.services,public.clients,public.appointments,
  public.products,public.stock_movements,public.sales,public.expenses to authenticated;
grant insert,update,delete on public.staff,public.services,public.clients,public.appointments to authenticated;
grant insert,update on public.expenses to authenticated;
grant insert,delete on public.products to authenticated;
grant update (name,sku,category,unit,min_qty,cost_gs,sale_price_gs,active) on public.products to authenticated;

-- PUBLIC is an implicit role including anonymous visitors.
revoke all on function public.is_team_member(), public.can_manage(), public.my_staff_id(), public.initial_product_stock_zero() from public,anon,authenticated;
grant execute on function public.is_team_member(),public.can_manage(),public.my_staff_id() to authenticated;
revoke all on function public.record_stock_movement(uuid,numeric,text,text) from public,anon,authenticated;
revoke all on function public.register_sale(text,uuid,uuid,date,numeric,numeric,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.record_stock_movement(uuid,numeric,text,text) to authenticated;
grant execute on function public.register_sale(text,uuid,uuid,date,numeric,numeric,numeric,text,text,text) to authenticated;

-- Do not expose staff records as a public directory. A separate explicit public
-- presentation model can be introduced later if the salon approves it.
drop policy if exists staff_public_read on public.staff;
create policy staff_team_read on public.staff for select to authenticated
  using ((select public.is_team_member()));
drop policy if exists services_public_read on public.services;
create policy services_anon_read on public.services for select to anon using (active);
create policy services_team_read on public.services for select to authenticated
  using (active or (select public.is_team_member()));

-- Restrictive guards also protect against a legacy permissive policy left on an
-- upgraded installation. Grants still determine which commands are available.
create policy profiles_guard on public.profiles as restrictive for all to authenticated
  using (id = (select auth.uid()) or (select public.can_manage()))
  with check (false);
create policy staff_guard on public.staff as restrictive for all to authenticated
  using ((select public.is_team_member())) with check ((select public.can_manage()));
create policy services_anon_guard on public.services as restrictive for all to anon
  using (active) with check (false);
create policy services_guard on public.services as restrictive for all to authenticated
  using (active or (select public.is_team_member())) with check ((select public.can_manage()));
create policy staff_insert_guard on public.staff as restrictive for insert to authenticated
  with check ((select public.can_manage()));
create policy staff_update_guard on public.staff as restrictive for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy staff_delete_guard on public.staff as restrictive for delete to authenticated
  using ((select public.can_manage()));
create policy services_insert_guard on public.services as restrictive for insert to authenticated
  with check ((select public.can_manage()));
create policy services_update_guard on public.services as restrictive for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy services_delete_guard on public.services as restrictive for delete to authenticated
  using ((select public.can_manage()));
create policy clients_guard on public.clients as restrictive for all to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy appointments_read_guard on public.appointments as restrictive for select to authenticated
  using ((select public.can_manage()) or (staff_id = (select public.my_staff_id()) and (select public.is_team_member())));
create policy appointments_insert_guard on public.appointments as restrictive for insert to authenticated
  with check ((select public.can_manage()));
create policy appointments_update_guard on public.appointments as restrictive for update to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy appointments_delete_guard on public.appointments as restrictive for delete to authenticated
  using ((select public.can_manage()));
create policy products_guard on public.products as restrictive for all to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));
create policy movements_guard on public.stock_movements as restrictive for all to authenticated
  using ((select public.can_manage())) with check (false);
create policy sales_guard on public.sales as restrictive for all to authenticated
  using ((select public.can_manage())) with check (false);
create policy expenses_guard on public.expenses as restrictive for all to authenticated
  using ((select public.can_manage())) with check ((select public.can_manage()));

-- Numeric NaN compares greater than ordinary numbers in PostgreSQL; ordinary
-- nonnegative CHECKs alone do not exclude it. Fixed upper bounds exclude infinity.
alter table public.products add constraint products_finite_values check (
 stock_qty between 0 and 99999999999.999 and min_qty between 0 and 99999999999.999
 and (cost_gs is null or cost_gs between 0 and 999999999999.99)
 and (sale_price_gs is null or sale_price_gs between 0 and 999999999999.99)) not valid;
alter table public.services add constraint services_finite_price check (
 price_gs is null or price_gs between 0 and 99999999999999) not valid;
alter table public.sales add constraint sales_finite_values check (
 quantity > 0 and quantity <= 99999999999.999
 and unit_price_gs between 0 and 999999999999.99
 and unit_cost_gs between 0 and 999999999999.99 and isfinite(sale_date)) not valid;
alter table public.stock_movements add constraint movements_finite_values check (
 delta_qty between -99999999999.999 and 99999999999.999 and delta_qty <> 0
 and ((kind in ('entrada','ajuste_positivo') and delta_qty > 0)
 or (kind in ('consumo','venta','ajuste_negativo') and delta_qty < 0))) not valid;
alter table public.expenses add constraint expenses_finite_amount check (
 amount_gs > 0 and amount_gs <= 999999999999.99 and isfinite(expense_date)) not valid;
alter table public.clients add constraint clients_input_bounds check (
 length(btrim(name)) between 1 and 100 and length(btrim(phone)) between 1 and 30
 and coalesce(length(email),0) <= 254 and coalesce(length(notes),0) <= 4000) not valid;
alter table public.products add constraint products_input_bounds check (
 length(btrim(name)) between 1 and 140 and length(btrim(sku)) between 1 and 80) not valid;
alter table public.staff add constraint staff_input_bounds check (
 length(btrim(name)) between 1 and 120 and coalesce(length(specialty),0) <= 200) not valid;
alter table public.services add constraint services_input_bounds check (
 length(btrim(name)) between 1 and 140 and length(btrim(category)) between 1 and 80) not valid;
alter table public.appointments add constraint appointments_input_bounds check (
 length(btrim(client_name)) between 1 and 100 and length(btrim(client_phone)) between 1 and 30
 and coalesce(length(notes),0) <= 4000 and isfinite(appointment_date)) not valid;
alter table public.expenses add constraint expenses_input_bounds check (
 length(btrim(category)) between 1 and 80 and length(btrim(description)) between 1 and 180) not valid;
alter table public.sales add constraint sales_input_bounds check (
 coalesce(length(customer_name),0) <= 100 and coalesce(length(notes),0) <= 4000) not valid;
alter table public.stock_movements add constraint movements_input_bounds check (
 coalesce(length(note),0) <= 4000) not valid;

create index if not exists idx_profiles_staff on public.profiles(staff_id);
create index if not exists idx_appointments_staff_date on public.appointments(staff_id,appointment_date);
create index if not exists idx_stock_movements_product on public.stock_movements(product_id);

create or replace function public.record_stock_movement(
 p_product_id uuid,p_delta_qty numeric,p_kind text,p_note text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_existing numeric(14,3); v_id uuid;
begin
 if not public.can_manage() then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('entrada','consumo','ajuste_positivo','ajuste_negativo')
 or p_delta_qty is null or p_delta_qty = 0
 or not (p_delta_qty between -99999999999.999 and 99999999999.999)
 or p_delta_qty <> round(p_delta_qty,3) then
   raise exception 'Movimiento inválido' using errcode='22023';
 end if;
 if (p_kind in ('entrada','ajuste_positivo') and p_delta_qty < 0)
 or (p_kind in ('consumo','ajuste_negativo') and p_delta_qty > 0) then
   raise exception 'El signo no corresponde al tipo de movimiento' using errcode='22023';
 end if;
 if coalesce(length(p_note),0)>4000 then raise exception 'Motivo demasiado largo' using errcode='22023'; end if;
 select stock_qty into v_existing from public.products where id=p_product_id and active for update;
 if not found then raise exception 'Producto inexistente o inactivo' using errcode='22023'; end if;
 if v_existing + p_delta_qty < 0 then raise exception 'Stock insuficiente' using errcode='23514'; end if;
 update public.products set stock_qty=stock_qty+p_delta_qty where id=p_product_id;
 insert into public.stock_movements(product_id,kind,delta_qty,note,created_by)
 values(p_product_id,p_kind,p_delta_qty,nullif(p_note,''),auth.uid()) returning id into v_id;
 return v_id;
end $$;

create or replace function public.register_sale(
 p_kind text,p_product_id uuid,p_service_id uuid,p_sale_date date,p_quantity numeric,
 p_unit_price_gs numeric,p_unit_cost_gs numeric,p_payment_method text,p_customer_name text,p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
 v_sale_id uuid; v_qty numeric(14,3); v_price numeric(14,2); v_cost numeric(14,2);
 v_stock numeric(14,3); v_category text; v_default_price numeric;
begin
 if not public.can_manage() then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_sale_date is null or not isfinite(p_sale_date) or p_payment_method is null
 or p_payment_method not in ('Efectivo','Transferencia','Tarjeta','Otro') then
   raise exception 'Fecha o medio de pago inválido' using errcode='22023';
 end if;
 if p_quantity is null or not(p_quantity > 0 and p_quantity <= 99999999999.999)
 or p_quantity <> round(p_quantity,3) then raise exception 'Cantidad inválida' using errcode='22023'; end if;
 if (p_unit_price_gs is not null and (not(p_unit_price_gs between 0 and 999999999999.99) or p_unit_price_gs <> round(p_unit_price_gs,2)))
 or (p_unit_cost_gs is not null and (not(p_unit_cost_gs between 0 and 999999999999.99) or p_unit_cost_gs <> round(p_unit_cost_gs,2)))
 then raise exception 'Precio o costo inválido' using errcode='22023'; end if;
 if coalesce(length(p_customer_name),0)>100 or coalesce(length(p_notes),0)>4000
 then raise exception 'Texto demasiado largo' using errcode='22023'; end if;
 v_qty:=p_quantity;
 if p_kind='producto' then
   if p_product_id is null or p_service_id is not null then raise exception 'Producto inválido' using errcode='22023'; end if;
   select category,stock_qty,cost_gs,sale_price_gs into v_category,v_stock,v_cost,v_default_price
     from public.products where id=p_product_id and active for update;
   if not found or v_category<>'Venta' then raise exception 'Producto inexistente o no destinado a venta' using errcode='22023'; end if;
   if v_stock<v_qty then raise exception 'Stock insuficiente' using errcode='23514'; end if;
   if v_cost is null then raise exception 'Cargá el precio de compra del producto' using errcode='22023'; end if;
   v_price:=coalesce(p_unit_price_gs,v_default_price);
 elsif p_kind='servicio' then
   if p_service_id is null or p_product_id is not null or v_qty<>1 then raise exception 'Servicio o cantidad inválidos' using errcode='22023'; end if;
   select price_gs into v_default_price from public.services where id=p_service_id and active;
   if not found then raise exception 'Servicio inexistente' using errcode='22023'; end if;
   v_price:=coalesce(p_unit_price_gs,v_default_price); v_cost:=p_unit_cost_gs;
 else raise exception 'Tipo de venta inválido' using errcode='22023'; end if;
 if v_price is null or v_price < 0 or v_cost is null or v_cost < 0
 then raise exception 'Precio de venta o costo inválido' using errcode='22023'; end if;
 insert into public.sales(kind,product_id,service_id,sale_date,quantity,unit_price_gs,unit_cost_gs,payment_method,customer_name,notes,created_by)
 values(p_kind,p_product_id,p_service_id,p_sale_date,v_qty,v_price,v_cost,p_payment_method,nullif(p_customer_name,''),nullif(p_notes,''),auth.uid()) returning id into v_sale_id;
 if p_kind='producto' then
   update public.products set stock_qty=stock_qty-v_qty where id=p_product_id;
   insert into public.stock_movements(product_id,kind,delta_qty,note,created_by)
   values(p_product_id,'venta',-v_qty,'Venta '||v_sale_id,auth.uid());
 end if;
 return v_sale_id;
end $$;

comment on function public.register_sale(text,uuid,uuid,date,numeric,numeric,numeric,text,text,text)
 is 'Phase 1 single-line atomic sale; no idempotency key, cart or reversal yet. Trusted managers may override price; product cost always comes from inventory.';
commit;
