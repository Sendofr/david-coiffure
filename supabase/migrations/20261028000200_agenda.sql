-- Phase 2: real agenda, opt-in public booking, private configuration and audit.
-- Forward-only. Legacy appointments remain untouched, including overlaps.
begin;
create schema if not exists david_private;
revoke all on schema david_private from public,anon,authenticated,service_role;

create table public.staff_booking_settings (
 staff_id uuid primary key references public.staff(id) on delete cascade,
 public_enabled boolean not null default false
);
create table public.staff_working_hours (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.staff(id) on delete cascade,
 weekday integer not null check(weekday between 0 and 6),
 start_time time not null, end_time time not null,
 check(start_time < end_time and end_time < time '24:00' and extract(second from start_time)=0 and extract(second from end_time)=0)
);
create index on public.staff_working_hours(staff_id,weekday);
create table public.staff_schedule_exceptions (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.staff(id) on delete cascade,
 date date not null check(isfinite(date)),
 start_time time, end_time time,
 reason text not null default '' check(length(reason)<=500),
 check((start_time is null and end_time is null) or
 (start_time is not null and end_time is not null and start_time < end_time and end_time < time '24:00'
 and extract(second from start_time)=0 and extract(second from end_time)=0))
);
create index on public.staff_schedule_exceptions(staff_id,date);
create table public.staff_time_off (
 id uuid primary key default gen_random_uuid(),
 staff_id uuid not null references public.staff(id) on delete cascade,
 start_date date not null, end_date date not null,
 reason text not null default '' check(length(reason)<=500),
 check(isfinite(start_date) and isfinite(end_date) and start_date<=end_date)
);
create index on public.staff_time_off(staff_id,start_date,end_date);
create table public.salon_closures (
 id uuid primary key default gen_random_uuid(), start_date date not null, end_date date not null,
 reason text not null default '' check(length(reason)<=500),
 check(isfinite(start_date) and isfinite(end_date) and start_date<=end_date)
);
create table public.appointment_events (
 id uuid primary key default gen_random_uuid(),
 appointment_id uuid not null references public.appointments(id) on delete restrict,
 actor_id uuid references auth.users(id),
 source text not null check(source in ('team','public_request')),
 previous jsonb, next jsonb not null, created_at timestamptz not null default now()
);
create index on public.appointment_events(appointment_id,created_at);
create table david_private.booking_requests (
 request_id uuid primary key,
 appointment_id uuid not null unique references public.appointments(id) on delete restrict,
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
 ip_hash text not null check(ip_hash ~ '^[0-9a-f]{64}$'),
 phone_hash text not null check(phone_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now()
);
create index on david_private.booking_requests(ip_hash,created_at);
create index on david_private.booking_requests(phone_hash,created_at);
create index on david_private.booking_requests(created_at);
revoke all on all tables in schema david_private from public,anon,authenticated,service_role;

-- Configuration is never a public staff directory.
do $$ declare t text; begin
 foreach t in array array['staff_booking_settings','staff_working_hours','staff_schedule_exceptions','staff_time_off','salon_closures'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy managers on public.%I for all to authenticated using ((select public.can_manage())) with check ((select public.can_manage()))',t);
  if t='salon_closures' then
   execute format('create policy team_read on public.%I for select to authenticated using ((select public.is_team_member()))',t);
  else
   execute format('create policy assigned_read on public.%I for select to authenticated using (staff_id=(select public.my_staff_id()) and (select public.is_team_member()))',t);
  end if;
 end loop;
end $$;
alter table public.appointment_events enable row level security;
revoke all on public.appointment_events from public,anon,authenticated;
grant select on public.appointment_events to authenticated;
create policy managers_read on public.appointment_events for select to authenticated using((select public.can_manage()));
-- Appointments are cancelled, never deleted through the application.
revoke delete on public.appointments from public,anon,authenticated;

create function david_private.public_gateway() returns boolean language sql stable security definer set search_path='' as $$
 select current_setting('role',true)='service_role';
$$;
create function david_private.fits_schedule(p_staff_id uuid,p_date date,p_start time,p_end time)
returns boolean language sql stable security definer set search_path='' as $$
 select p_start<p_end
 and not exists(select 1 from public.salon_closures where p_date between start_date and end_date)
 and not exists(select 1 from public.staff_time_off where staff_id=p_staff_id and p_date between start_date and end_date)
 and case when exists(select 1 from public.staff_schedule_exceptions where staff_id=p_staff_id and date=p_date)
 then exists(select 1 from public.staff_schedule_exceptions where staff_id=p_staff_id and date=p_date and start_time<=p_start and end_time>=p_end)
 else exists(select 1 from public.staff_working_hours where staff_id=p_staff_id and weekday=extract(dow from p_date) and start_time<=p_start and end_time>=p_end)
 end;
$$;
create function david_private.lock_staff(p_staff_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(20261028,2);
 perform id from public.staff where id=p_staff_id for update;
 if not found then raise exception 'Profesional inexistente' using errcode='22023'; end if;
end $$;
create function david_private.schedule_lock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(20261028,2);
 -- Deterministic order also covers moving an interval between professionals.
 if tg_op='DELETE' then
  perform id from public.staff where id=old.staff_id order by id for update;
 elsif tg_op='INSERT' then
  perform id from public.staff where id=new.staff_id order by id for update;
 else
  perform id from public.staff where id in(old.staff_id,new.staff_id) order by id for update;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create function david_private.closure_lock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(20261028,2);
 if tg_op='DELETE' then return old; end if; return new;
end $$;

create function david_private.guard_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare duration integer; computed_end timestamp; staff_ok boolean;
begin
 if not public.can_manage() and not david_private.public_gateway() then
  raise exception 'No autorizado' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock_shared(20261028,2);
 if tg_op='UPDATE' then
  perform id from public.staff where id in(old.staff_id,new.staff_id) order by id for update;
  if old.status in('completado','cancelado','no-asistio') and
    (new.status<>old.status or row(new.staff_id,new.service_id,new.appointment_date,new.start_time) is distinct from row(old.staff_id,old.service_id,old.appointment_date,old.start_time)) then
   raise exception 'Cita cerrada: crear una nueva cita para reprogramar' using errcode='23514';
  end if;
 else perform id from public.staff where id=new.staff_id for update;
 end if;
 -- Terminal changes are permitted for legacy appointments without any schedule.
 if new.status not in('pendiente','confirmado','en-proceso') then return new; end if;
 if new.staff_id is null or new.service_id is null or not isfinite(new.appointment_date)
  or extract(second from new.start_time)<>0 then
  raise exception 'Cita incompleta o inicio inválido' using errcode='22023';
 end if;
 select active into staff_ok from public.staff where id=new.staff_id;
 if staff_ok is distinct from true then raise exception 'Profesional inactivo' using errcode='23514'; end if;
 select duration_minutes into duration from public.services where id=new.service_id and active for share;
 if not found then raise exception 'Servicio inactivo o inexistente' using errcode='23514'; end if;
 computed_end:=new.appointment_date+new.start_time+make_interval(mins=>duration);
 if computed_end::date<>new.appointment_date then raise exception 'La cita no puede atravesar medianoche' using errcode='23514'; end if;
 new.end_time:=computed_end::time;
 if not david_private.fits_schedule(new.staff_id,new.appointment_date,new.start_time,new.end_time) then
  raise exception 'Fuera del horario disponible' using errcode='23514';
 end if;
 if exists(select 1 from public.appointments a where a.staff_id=new.staff_id
  and a.appointment_date=new.appointment_date and a.status in('pendiente','confirmado','en-proceso')
  and a.id<>new.id and a.start_time<new.end_time and a.end_time>new.start_time) then
  raise exception 'Horario ocupado' using errcode='23P01';
 end if;
 return new;
end $$;
create trigger agenda_guard before insert or update on public.appointments for each row execute function david_private.guard_appointment();
create function david_private.audit_appointment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new; end if;
 insert into public.appointment_events(appointment_id,actor_id,source,previous,next)
 values(new.id,auth.uid(),case when david_private.public_gateway() then 'public_request' else 'team' end,
  case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
create trigger agenda_audit after insert or update on public.appointments for each row execute function david_private.audit_appointment();

-- Deferred validation allows atomic replacement of a whole week/day without
-- rejecting the temporary empty state between DELETE and INSERT.
create function david_private.validate_schedule_change() returns trigger language plpgsql security definer set search_path='' as $$
declare prior jsonb; following jsonb; s record; a record; d date; filter_weekday integer; d_from date; d_to date;
begin
 prior:=case when tg_op<>'INSERT' then to_jsonb(old) else null end;
 following:=case when tg_op<>'DELETE' then to_jsonb(new) else null end;
 for s in select value as data from jsonb_array_elements(jsonb_build_array(prior,following)) where value<>'null'::jsonb loop
  filter_weekday:=null; d:=null; d_from:=null; d_to:=null;
  if tg_table_name='staff_working_hours' then filter_weekday:=(s.data->>'weekday')::integer;
  elsif tg_table_name='staff_schedule_exceptions' then d:=(s.data->>'date')::date;
  else d_from:=(s.data->>'start_date')::date; d_to:=(s.data->>'end_date')::date; end if;
  for a in select * from public.appointments where staff_id=(s.data->>'staff_id')::uuid
   and status in('pendiente','confirmado','en-proceso') and appointment_date>=(now() at time zone 'America/Asuncion')::date
   and (filter_weekday is null or extract(dow from appointment_date)=filter_weekday)
   and (d is null or appointment_date=d)
   and (d_from is null or appointment_date between d_from and d_to)
  loop
   if not david_private.fits_schedule(a.staff_id,a.appointment_date,a.start_time,a.end_time) then
    raise exception 'El cambio de horario afecta citas activas; reprogramarlas o cancelarlas primero' using errcode='23514';
   end if;
  end loop;
 end loop;
 -- Reject overlapping working intervals / mixed closed and open overrides.
 if tg_table_name='staff_working_hours' then
  if exists(select 1 from public.staff_working_hours x join public.staff_working_hours y on x.staff_id=y.staff_id and x.weekday=y.weekday and x.id<y.id and x.start_time<y.end_time and x.end_time>y.start_time)
   then raise exception 'Horarios laborales superpuestos' using errcode='23514'; end if;
 elsif tg_table_name='staff_schedule_exceptions' then
  if exists(select 1 from public.staff_schedule_exceptions x join public.staff_schedule_exceptions y on x.staff_id=y.staff_id and x.date=y.date and x.id<y.id
   and (x.start_time is null or y.start_time is null or (x.start_time<y.end_time and x.end_time>y.start_time)))
   then raise exception 'Excepciones superpuestas o contradictorias' using errcode='23514'; end if;
 end if;
 return null;
end $$;
create function david_private.validate_closure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.appointments a join public.salon_closures c on a.appointment_date between c.start_date and c.end_date
  where a.status in('pendiente','confirmado','en-proceso') and a.appointment_date>=(now() at time zone 'America/Asuncion')::date) then
  raise exception 'El cierre afecta citas activas; reprogramarlas o cancelarlas primero' using errcode='23514';
 end if;
 return null;
end $$;
do $$ declare t text; begin
 foreach t in array array['staff_booking_settings','staff_working_hours','staff_schedule_exceptions','staff_time_off'] loop
  execute format('create trigger agenda_schedule_lock before insert or update or delete on public.%I for each row execute function david_private.schedule_lock()',t);
  if t<>'staff_booking_settings' then
   execute format('create constraint trigger agenda_schedule_validate after insert or update or delete on public.%I deferrable initially deferred for each row execute function david_private.validate_schedule_change()',t);
  end if;
 end loop;
end $$;
create trigger agenda_closure_lock before insert or update or delete on public.salon_closures for each row execute function david_private.closure_lock();
create constraint trigger agenda_closure_validate after insert or update or delete on public.salon_closures deferrable initially deferred for each row execute function david_private.validate_closure();

create function public.replace_working_hours(p_staff_id uuid,p_intervals jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage() then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_intervals is null or jsonb_typeof(p_intervals)<>'array' or jsonb_array_length(p_intervals)>42 then raise exception 'Horarios inválidos' using errcode='22023'; end if;
 perform david_private.lock_staff(p_staff_id);
 delete from public.staff_working_hours where staff_id=p_staff_id;
 insert into public.staff_working_hours(staff_id,weekday,start_time,end_time)
 select p_staff_id,x.weekday,x.start_time,x.end_time from jsonb_to_recordset(p_intervals) as x(weekday integer,start_time time,end_time time);
end $$;
create function public.replace_schedule_day(p_staff_id uuid,p_date date,p_intervals jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage() then raise exception 'No autorizado' using errcode='42501'; end if;
 if p_date is null or not isfinite(p_date) or p_intervals is null or jsonb_typeof(p_intervals)<>'array' or jsonb_array_length(p_intervals)>12 then raise exception 'Excepción inválida' using errcode='22023'; end if;
 perform david_private.lock_staff(p_staff_id);
 delete from public.staff_schedule_exceptions where staff_id=p_staff_id and date=p_date;
 if jsonb_array_length(p_intervals)=0 then insert into public.staff_schedule_exceptions(staff_id,date) values(p_staff_id,p_date);
 else
  if exists(select 1 from jsonb_array_elements(p_intervals) x where x->>'start_time' is null or x->>'end_time' is null) then raise exception 'Intervalo incompleto' using errcode='22023'; end if;
  insert into public.staff_schedule_exceptions(staff_id,date,start_time,end_time)
  select p_staff_id,p_date,x.start_time,x.end_time from jsonb_to_recordset(p_intervals) as x(start_time time,end_time time);
 end if;
end $$;

create function public.booking_catalog() returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select s.id,s.name from public.staff s join public.staff_booking_settings b on b.staff_id=s.id
 where s.active and b.public_enabled order by s.name,s.id;
$$;
create function david_private.slots(p_staff_id uuid,p_service_id uuid,p_date date,p_public boolean)
returns table(start_time text,end_time text) language plpgsql stable security definer set search_path='' as $$
declare duration integer;
begin
 if p_date is null or not isfinite(p_date) or p_date<date '1900-01-01' or p_date>date '9999-12-01' then raise exception 'Fecha inválida' using errcode='22023'; end if;
 if p_public and (p_date<(now() at time zone 'America/Asuncion')::date or p_date>(now() at time zone 'America/Asuncion')::date+90) then return; end if;
 if not exists(select 1 from public.staff where id=p_staff_id and active) then return; end if;
 if p_public and not exists(select 1 from public.staff_booking_settings where staff_id=p_staff_id and public_enabled) then return; end if;
 select duration_minutes into duration from public.services where id=p_service_id and active;
 if not found then return; end if;
 return query select to_char(t,'HH24:MI'),to_char(t+make_interval(mins=>duration),'HH24:MI')
 from generate_series(p_date::timestamp,p_date::timestamp+interval '23 hours 45 minutes',interval '15 minutes') t
 where (t+make_interval(mins=>duration))::date=p_date
 and (not p_public or t>=(now() at time zone 'America/Asuncion')+interval '60 minutes')
 and david_private.fits_schedule(p_staff_id,p_date,t::time,(t+make_interval(mins=>duration))::time)
 and not exists(select 1 from public.appointments a where a.staff_id=p_staff_id and a.appointment_date=p_date
  and a.status in('pendiente','confirmado','en-proceso') and a.start_time<(t+make_interval(mins=>duration))::time and a.end_time>t::time)
 order by t;
end $$;
create function public.available_slots(p_staff_id uuid,p_service_id uuid,p_date date)
returns table(start_time text,end_time text) language sql stable security definer set search_path='' as $$
 select * from david_private.slots(p_staff_id,p_service_id,p_date,true);
$$;
create function public.admin_available_slots(p_staff_id uuid,p_service_id uuid,p_date date)
returns table(start_time text,end_time text) language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage() then raise exception 'No autorizado' using errcode='42501'; end if;
 return query select * from david_private.slots(p_staff_id,p_service_id,p_date,false);
end $$;

create function public.request_booking(p_request_id uuid,p_name text,p_phone text,p_service_id uuid,p_staff_id uuid,
 p_date date,p_time time,p_ip_hash text,p_phone_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload text; previous david_private.booking_requests%rowtype; appointment uuid; duration integer;
begin
 if p_request_id is null or p_name is null or length(btrim(p_name)) not between 1 and 100
 or p_phone is null or p_phone!~'^\+[1-9][0-9]{7,14}$'
 or p_ip_hash is null or p_ip_hash!~'^[0-9a-f]{64}$' or p_phone_hash is null or p_phone_hash!~'^[0-9a-f]{64}$'
 or p_service_id is null or p_staff_id is null or p_date is null or not isfinite(p_date) or p_time is null
 or extract(second from p_time)<>0 or extract(minute from p_time)::integer%15<>0 then
  raise exception 'Solicitud inválida' using errcode='22023';
 end if;
 payload:=encode(sha256(convert_to(jsonb_build_object('name',btrim(p_name),'phone',p_phone,'service_id',p_service_id,
  'staff_id',p_staff_id,'date',p_date,'time',p_time)::text,'UTF8')),'hex');
 -- Salon scale: one short global booking lock also makes sliding rate decisions
 -- atomic across different staff. Appointment/schedule writes share staff locks.
 perform pg_advisory_xact_lock(20261028,3);
 select * into previous from david_private.booking_requests where request_id=p_request_id;
 if found then
  if previous.payload_hash<>payload then raise exception 'Identificador reutilizado con datos diferentes' using errcode='22023'; end if;
  return jsonb_build_object('reference',p_request_id,'status','pendiente');
 end if;
 if (select count(*) from david_private.booking_requests where ip_hash=p_ip_hash and created_at>now()-interval '10 minutes')>=5
 or (select count(*) from david_private.booking_requests where phone_hash=p_phone_hash and created_at>now()-interval '1 hour')>=3
 or (select count(*) from david_private.booking_requests where created_at>now()-interval '1 hour')>=100 then
  raise exception 'RATE_LIMITED' using errcode='P0001';
 end if;
 perform david_private.lock_staff(p_staff_id);
 if p_date<(now() at time zone 'America/Asuncion')::date or p_date>(now() at time zone 'America/Asuncion')::date+90
 or p_date+p_time<(now() at time zone 'America/Asuncion')+interval '60 minutes'
 or not exists(select 1 from public.staff_booking_settings where staff_id=p_staff_id and public_enabled) then
  raise exception 'Horario no disponible para solicitudes públicas' using errcode='23514';
 end if;
 select duration_minutes into duration from public.services where id=p_service_id and active for share;
 if not found then raise exception 'Servicio no disponible' using errcode='23514'; end if;
 insert into public.appointments(client_name,client_phone,service_id,staff_id,appointment_date,start_time,end_time,status)
 values(btrim(p_name),p_phone,p_service_id,p_staff_id,p_date,p_time,(p_time+make_interval(mins=>duration))::time,'pendiente') returning id into appointment;
 insert into david_private.booking_requests(request_id,appointment_id,payload_hash,ip_hash,phone_hash)
 values(p_request_id,appointment,payload,p_ip_hash,p_phone_hash);
 return jsonb_build_object('reference',p_request_id,'status','pendiente');
end $$;

revoke all on all functions in schema david_private from public,anon,authenticated,service_role;
revoke all on function public.booking_catalog(),public.available_slots(uuid,uuid,date),public.admin_available_slots(uuid,uuid,date),
 public.replace_working_hours(uuid,jsonb),public.replace_schedule_day(uuid,date,jsonb),
 public.request_booking(uuid,text,text,uuid,uuid,date,time,text,text) from public,anon,authenticated,service_role;
grant execute on function public.booking_catalog(),public.available_slots(uuid,uuid,date) to anon,authenticated;
grant execute on function public.admin_available_slots(uuid,uuid,date),public.replace_working_hours(uuid,jsonb),public.replace_schedule_day(uuid,date,jsonb) to authenticated;
grant execute on function public.request_booking(uuid,text,text,uuid,uuid,date,time,text,text) to service_role;
commit;
