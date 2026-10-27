-- DAVID COIFFURE · Esquema inicial para Supabase
-- Ejecutar en SQL Editor del proyecto del salón. No elimina datos existentes.
-- Los usuarios se crean en Supabase Auth y luego se les asigna rol manualmente.
create extension if not exists btree_gist;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null check (role in ('owner','manager','stylist')),
  created_at timestamptz not null default now()
);

create table if not exists public.staff(
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) <= 120),
  specialty text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists staff_id uuid references public.staff(id) on delete set null;

create table if not exists public.services(
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) <= 140),
  category text not null default 'OTROS',
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 600),
  price_gs numeric(14,0) check (price_gs is null or price_gs >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.clients(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments(
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_phone text not null,
  service_id uuid references public.services(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'pendiente'
    check (status in ('pendiente','confirmado','en-proceso','completado','cancelado','no-asistio')),
  notes text,
  created_at timestamptz not null default now(),
  constraint appointment_time_order check (end_time > start_time)
);

-- Los turnos confirmados y en proceso no pueden superponerse
-- para el mismo profesional, aunque haya solicitudes pendientes.
do $$
begin
 if not exists (
   select 1 from pg_constraint where conname = 'appointments_no_overlap'
   and conrelid = 'public.appointments'::regclass
 ) then
   alter table public.appointments
   add constraint appointments_no_overlap
   exclude using gist (
     staff_id with =,
     tsrange(appointment_date + start_time, appointment_date + end_time, '[)') with &&
   ) where (status in ('confirmado','en-proceso'));
 end if;
end $$;

create table if not exists public.products(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text not null unique,
  category text not null check (category in ('Consumible','Venta')),
  unit text not null default 'unidad' check (unit in ('unidad','tubo','ml','g')),
  stock_qty numeric(14,3) not null default 0 check (stock_qty >= 0),
  min_qty numeric(14,3) not null default 0 check (min_qty >= 0),
  cost_gs numeric(14,2) check (cost_gs is null or cost_gs >= 0),
  sale_price_gs numeric(14,2) check (sale_price_gs is null or sale_price_gs >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  kind text not null check (kind in ('entrada','consumo','venta','ajuste_positivo','ajuste_negativo')),
  delta_qty numeric(14,3) not null check (delta_qty <> 0),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Una operación por registro: producto vendido o servicio realizado.
-- Los importes y el costo de compra se conservan como valores históricos.
create table if not exists public.sales(
  id uuid primary key default gen_random_uuid(),
  sale_date date not null default current_date,
  kind text not null check (kind in ('producto','servicio')),
  product_id uuid references public.products(id) on delete restrict,
  service_id uuid references public.services(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price_gs numeric(14,2) not null check (unit_price_gs >= 0),
  unit_cost_gs numeric(14,2) not null check (unit_cost_gs >= 0),
  total_gs numeric(18,2) generated always as (quantity*unit_price_gs) stored,
  cost_total_gs numeric(18,2) generated always as (quantity*unit_cost_gs) stored,
  gross_profit_gs numeric(18,2) generated always as (quantity*(unit_price_gs-unit_cost_gs)) stored,
  payment_method text not null check (payment_method in ('Efectivo','Transferencia','Tarjeta','Otro')),
  customer_name text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint sale_single_subject check (
    (kind='producto' and product_id is not null and service_id is null)
    or (kind='servicio' and service_id is not null and product_id is null)
  )
);

create table if not exists public.expenses(
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  amount_gs numeric(14,2) not null check (amount_gs > 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_appointments_date on public.appointments(appointment_date);
create index if not exists idx_stock_movements_date on public.stock_movements(created_at desc);
create index if not exists idx_sales_date on public.sales(sale_date);
create index if not exists idx_expenses_date on public.expenses(expense_date);

-- Funciones de autorización en el motor de base de datos.
-- No se delega la autorización de roles al código del navegador.
create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role in ('owner','manager','stylist'));
$$;

create or replace function public.can_manage()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.role in ('owner','manager'));
$$;

create or replace function public.my_staff_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select staff_id from public.profiles where id = (select auth.uid());
$$;

alter table public.profiles enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.expenses enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.can_manage()));

drop policy if exists staff_public_read on public.staff;
create policy staff_public_read on public.staff for select to anon, authenticated
using (active = true or (select public.is_team_member()));
drop policy if exists staff_manage on public.staff;
create policy staff_manage on public.staff for all to authenticated
using ((select public.can_manage())) with check ((select public.can_manage()));

drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select to anon, authenticated
using (active = true or (select public.is_team_member()));
drop policy if exists services_manage on public.services;
create policy services_manage on public.services for all to authenticated
using ((select public.can_manage())) with check ((select public.can_manage()));

drop policy if exists clients_team_read on public.clients;
create policy clients_team_read on public.clients for select to authenticated
using ((select public.can_manage()));
drop policy if exists clients_manage on public.clients;
create policy clients_manage on public.clients for all to authenticated
using ((select public.can_manage())) with check ((select public.can_manage()));

drop policy if exists appointments_team_read on public.appointments;
create policy appointments_team_read on public.appointments for select to authenticated
using ((select public.can_manage()) or staff_id = (select public.my_staff_id()));
drop policy if exists appointments_manage on public.appointments;
create policy appointments_manage on public.appointments for all to authenticated
using ((select public.can_manage())) with check ((select public.can_manage()));

drop policy if exists products_team_read on public.products;
create policy products_team_read on public.products for select to authenticated
using ((select public.can_manage()));
drop policy if exists products_manage on public.products;
create policy products_manage on public.products for all to authenticated
using ((select public.can_manage())) with check ((select public.can_manage()));

drop policy if exists movements_team_read on public.stock_movements;
create policy movements_team_read on public.stock_movements for select to authenticated
using ((select public.can_manage()));

drop policy if exists sales_managers_read on public.sales;
create policy sales_managers_read on public.sales for select to authenticated
using ((select public.can_manage()));

drop policy if exists expenses_managers_all on public.expenses;
create policy expenses_managers_all on public.expenses for all to authenticated
using ((select public.can_manage())) with check ((select public.can_manage()));

-- Productos nuevos siempre parten con 0; se incrementan mediante movimiento.
create or replace function public.initial_product_stock_zero()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.stock_qty := 0;
  return new;
end;
$$;
drop trigger if exists product_initial_stock on public.products;
create trigger product_initial_stock before insert on public.products
for each row execute function public.initial_product_stock_zero();

-- RPC atómica: bloquea la fila de inventario, valida y registra auditoría.
create or replace function public.record_stock_movement(
  p_product_id uuid,
  p_delta_qty numeric,
  p_kind text,
  p_note text default ''
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_existing numeric(14,3);
  v_id uuid;
begin
  if not public.can_manage() then
    raise exception 'No autorizado';
  end if;
  if p_kind not in ('entrada','consumo','ajuste_positivo','ajuste_negativo') or
     p_delta_qty is null or p_delta_qty = 0 then
    raise exception 'Movimiento inválido';
  end if;
  if (p_kind in ('entrada','ajuste_positivo') and p_delta_qty < 0) or
     (p_kind in ('consumo','ajuste_negativo') and p_delta_qty > 0) then
    raise exception 'El signo no corresponde al tipo de movimiento';
  end if;
  select stock_qty into v_existing from public.products where id = p_product_id for update;
  if not found then raise exception 'Producto inexistente'; end if;
  if v_existing + p_delta_qty < 0 then raise exception 'Stock insuficiente'; end if;
  update public.products set stock_qty = stock_qty + p_delta_qty where id = p_product_id;
  insert into public.stock_movements(product_id,kind,delta_qty,note,created_by)
  values(p_product_id,p_kind,p_delta_qty,nullif(p_note,''),auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Una venta real se registra de forma atómica con su salida de stock.
-- No permite saldos negativos ni costos manipulados desde el navegador.
create or replace function public.register_sale(
  p_kind text,
  p_product_id uuid,
  p_service_id uuid,
  p_sale_date date,
  p_quantity numeric,
  p_unit_price_gs numeric,
  p_unit_cost_gs numeric,
  p_payment_method text,
  p_customer_name text,
  p_notes text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_qty numeric(14,3);
  v_price numeric(14,2);
  v_cost numeric(14,2);
  v_stock numeric(14,3);
  v_category text;
  v_default_price numeric(14,2);
begin
  if not public.can_manage() then raise exception 'No autorizado'; end if;
  if p_sale_date is null or p_payment_method not in ('Efectivo','Transferencia','Tarjeta','Otro') then
    raise exception 'Fecha o medio de pago inválido';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Cantidad inválida'; end if;
  v_qty := p_quantity;
  if p_kind = 'producto' then
    if p_product_id is null or p_service_id is not null then raise exception 'Producto inválido'; end if;
    select category,stock_qty,cost_gs,sale_price_gs
    into v_category,v_stock,v_cost,v_default_price
    from public.products where id=p_product_id and active=true for update;
    if not found or v_category <> 'Venta' then raise exception 'Producto inexistente o no destinado a venta'; end if;
    if v_stock < v_qty then raise exception 'Stock insuficiente'; end if;
    if v_cost is null then raise exception 'Cargá el precio de compra del producto'; end if;
    v_price := coalesce(p_unit_price_gs,v_default_price);
  elsif p_kind = 'servicio' then
    if p_service_id is null or p_product_id is not null or v_qty <> 1 then
      raise exception 'Servicio o cantidad inválidos';
    end if;
    select price_gs into v_default_price from public.services
    where id=p_service_id and active=true;
    if not found then raise exception 'Servicio inexistente'; end if;
    v_price := coalesce(p_unit_price_gs,v_default_price);
    v_cost := p_unit_cost_gs;
  else
    raise exception 'Tipo de venta inválido';
  end if;
  if v_price is null or v_price < 0 or v_cost is null or v_cost < 0 then
    raise exception 'Precio de venta o costo inválido';
  end if;
  insert into public.sales(
    kind,product_id,service_id,sale_date,quantity,unit_price_gs,unit_cost_gs,
    payment_method,customer_name,notes,created_by
  ) values (
    p_kind,p_product_id,p_service_id,p_sale_date,v_qty,v_price,v_cost,
    p_payment_method,nullif(p_customer_name,''),nullif(p_notes,''),auth.uid()
  ) returning id into v_sale_id;
  if p_kind = 'producto' then
    update public.products set stock_qty=stock_qty-v_qty where id=p_product_id;
    insert into public.stock_movements(product_id,kind,delta_qty,note,created_by)
    values(p_product_id,'venta',-v_qty,'Venta '||v_sale_id,auth.uid());
  end if;
  return v_sale_id;
end;
$$;

-- Los grants protegen incluso la API REST.
revoke all on public.profiles,public.staff,public.services,public.clients,
  public.appointments,public.products,public.stock_movements,public.sales,public.expenses from anon,authenticated;
grant select on public.staff,public.services to anon;
grant select on public.profiles,public.staff,public.services,public.clients,
  public.appointments,public.products,public.stock_movements,public.sales,public.expenses to authenticated;
grant insert,update,delete on public.staff,public.services,public.clients,public.appointments to authenticated;
grant insert,update on public.expenses to authenticated;
grant insert,delete on public.products to authenticated;
grant update (name,sku,category,unit,min_qty,cost_gs,sale_price_gs,active) on public.products to authenticated;
revoke all on function public.record_stock_movement(uuid,numeric,text,text) from public,anon;
grant execute on function public.record_stock_movement(uuid,numeric,text,text) to authenticated;
revoke all on function public.register_sale(text,uuid,uuid,date,numeric,numeric,numeric,text,text,text) from public,anon;
grant execute on function public.register_sale(text,uuid,uuid,date,numeric,numeric,numeric,text,text,text) to authenticated;

-- Bootstrap de un propietario, luego de invitarlo y crear su cuenta en Auth:
-- INSERT INTO public.profiles (id, display_name, role)
-- SELECT id, 'Propietario David Coiffure', 'owner'
-- FROM auth.users WHERE email = 'CORREO_REAL_DEL_PROPIETARIO'
-- ON CONFLICT (id) DO UPDATE SET role = excluded.role;
