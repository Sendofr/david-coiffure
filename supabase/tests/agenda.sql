\set ON_ERROR_STOP on
begin;
create temp table agenda_assertions(n integer not null default 0);
insert into agenda_assertions values(0);
grant all on agenda_assertions to anon,authenticated,service_role;
create temp table agenda_date(d date);
insert into agenda_date values((now() at time zone 'America/Asuncion')::date+7);
grant select on agenda_date to anon,authenticated,service_role;
create function pg_temp.agenda_ok(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'FAIL: %',label; end if; update agenda_assertions set n=n+1; raise notice 'PASS: %',label; end $$;
create function pg_temp.agenda_denied(command text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute command; set constraints all immediate; set constraints all deferred;
 exception when others then
  if sqlstate=expected then perform pg_temp.agenda_ok(true,label); return; end if;
  raise exception 'FAIL: %, expected %, received %: %',label,expected,sqlstate,sqlerrm;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end $$;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','owner@test.invalid'),('00000000-0000-0000-0000-000000000002','manager@test.invalid'),
 ('00000000-0000-0000-0000-000000000003','stylist@test.invalid'),('00000000-0000-0000-0000-000000000004','outsider@test.invalid');
insert into public.staff(id,name) values('10000000-0000-0000-0000-000000000001','Bookable stylist'),('10000000-0000-0000-0000-000000000002','Private stylist');
insert into public.services(id,name,duration_minutes) values('20000000-0000-0000-0000-000000000001','One hour',60),('20000000-0000-0000-0000-000000000002','Two hours',120);
insert into public.profiles(id,role,staff_id) values('00000000-0000-0000-0000-000000000001','owner',null),('00000000-0000-0000-0000-000000000002','manager',null),('00000000-0000-0000-0000-000000000003','stylist','10000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.replace_working_hours('10000000-0000-0000-0000-000000000001',(select jsonb_agg(jsonb_build_object('weekday',i,'start_time',a,'end_time',b)) from generate_series(0,6)i cross join(values('09:00','12:00'),('13:00','18:00'))hours(a,b)));
insert into public.staff_booking_settings(staff_id) values('10000000-0000-0000-0000-000000000001');
select pg_temp.agenda_ok((select count(*)=0 from public.booking_catalog()),'Public staff opt-in defaults false');
update public.staff_booking_settings set public_enabled=true where staff_id='10000000-0000-0000-0000-000000000001';
set constraints all immediate; set constraints all deferred;
select pg_temp.agenda_ok((select count(*)=1 from public.booking_catalog()),'Only explicitly opted-in staff appear');
select pg_temp.agenda_ok((select count(*)=26 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select d from agenda_date))),'Availability respects two working intervals and full service duration');
select pg_temp.agenda_ok(not exists(select 1 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select d from agenda_date)) where start_time>='11:15' and start_time<'13:00'),'No slot spans or starts during lunch break');
select pg_temp.agenda_ok((select count(*)=0 from public.available_slots('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',(select d from agenda_date))),'Private staff availability not disclosed');
select pg_temp.agenda_ok((select count(*)=0 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(now() at time zone 'America/Asuncion')::date+91)),'Public horizon limited to 90 days');
select public.replace_schedule_day('10000000-0000-0000-0000-000000000001',(select d from agenda_date),'[{"start_time":"10:00","end_time":"12:00"}]');
set constraints all immediate; set constraints all deferred;
select pg_temp.agenda_ok((select count(*)=5 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select d from agenda_date))),'Day override replaces weekly intervals');
select public.replace_schedule_day('10000000-0000-0000-0000-000000000001',(select d from agenda_date),'[]');
select pg_temp.agenda_ok((select count(*)=0 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select d from agenda_date))),'Empty override closes day');
delete from public.staff_schedule_exceptions where staff_id='10000000-0000-0000-0000-000000000001';
insert into public.staff_time_off(staff_id,start_date,end_date,reason) select '10000000-0000-0000-0000-000000000001',d,d+2,'Vacation' from agenda_date;
select pg_temp.agenda_ok((select count(*)=0 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select d from agenda_date))),'Vacation blocks availability');
delete from public.staff_time_off where staff_id='10000000-0000-0000-0000-000000000001';
insert into public.salon_closures(start_date,end_date,reason) select d,d,'Closed salon' from agenda_date;
select pg_temp.agenda_ok((select count(*)=0 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select d from agenda_date))),'Salon closure blocks availability');
delete from public.salon_closures;
set constraints all immediate; set constraints all deferred;
select pg_temp.agenda_denied($q$select public.replace_working_hours('10000000-0000-0000-0000-000000000001','[{"weekday":1,"start_time":"09:00","end_time":"12:00"},{"weekday":1,"start_time":"10:00","end_time":"13:00"}]')$q$,'23514','Overlapping working intervals rejected');

set local role anon;
select pg_temp.agenda_ok((select count(*)=1 from public.booking_catalog()),'Anonymous sees minimal opted-in catalog');
select pg_temp.agenda_denied('select * from public.staff_working_hours','42501','Anonymous cannot read private working hours');
select pg_temp.agenda_denied('select * from public.appointment_events','42501','Anonymous cannot read audit');
select pg_temp.agenda_denied($q$select public.admin_available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',current_date)$q$,'42501','Anonymous cannot use unrestricted admin availability');
select pg_temp.agenda_denied($q$select public.request_booking(gen_random_uuid(),'Visitor','+595981123456','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',current_date+7,'09:00',repeat('a',64),repeat('b',64))$q$,'42501','Anonymous cannot bypass CAPTCHA gateway RPC grants');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select pg_temp.agenda_ok((select count(*)=14 from public.staff_working_hours),'Stylist reads own working hours');
select pg_temp.agenda_denied($q$select public.replace_working_hours('10000000-0000-0000-0000-000000000001','[]')$q$,'42501','Stylist cannot change working hours');
select pg_temp.agenda_denied($q$insert into public.salon_closures(start_date,end_date) values(current_date,current_date)$q$,'42501','Stylist cannot close salon');
select pg_temp.agenda_denied($q$select public.request_booking(gen_random_uuid(),'Visitor','+595981123456','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',current_date+7,'09:00',repeat('a',64),repeat('b',64))$q$,'42501','Authenticated user cannot bypass booking gateway');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.agenda_ok((select count(*)=0 from public.staff_working_hours),'User without profile cannot inspect working hours');
select pg_temp.agenda_denied($q$select public.replace_schedule_day('10000000-0000-0000-0000-000000000001',current_date,'[]')$q$,'42501','User without profile cannot change schedule');

reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select pg_temp.agenda_ok(public.request_booking('50000000-0000-0000-0000-000000000001','Public visitor','+595981123456','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select d from agenda_date),'09:00',repeat('a',64),repeat('b',64))=jsonb_build_object('reference','50000000-0000-0000-0000-000000000001','status','pendiente'),'Gateway creates pending request, returns only reference and status');
select pg_temp.agenda_ok(public.request_booking('50000000-0000-0000-0000-000000000001','Public visitor','+595981123456','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select d from agenda_date),'09:00',repeat('c',64),repeat('d',64))->>'reference'='50000000-0000-0000-0000-000000000001','Same payload/request UUID safely replays even changed IP');
select pg_temp.agenda_denied($q$select public.request_booking('50000000-0000-0000-0000-000000000001','Changed visitor','+595981123456','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select d from agenda_date),'09:00',repeat('a',64),repeat('b',64))$q$,'22023','Idempotency UUID with changed payload rejected');
select pg_temp.agenda_denied($q$select public.request_booking(gen_random_uuid(),'Conflict','+595981999999','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select d from agenda_date),'09:30',repeat('c',64),repeat('d',64))$q$,'23P01','Pending request blocks overlapping booking');
select pg_temp.agenda_denied($q$select public.request_booking(gen_random_uuid(),'Break','+595981999999','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select d from agenda_date),'11:30',repeat('c',64),repeat('d',64))$q$,'23514','Booking cannot span lunch break');
select pg_temp.agenda_denied($q$select public.request_booking(gen_random_uuid(),'Invalid','0999999','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',(select d from agenda_date),'10:00',repeat('c',64),repeat('d',64))$q$,'22023','Gateway validates canonical phone again');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.agenda_ok((select count(*)=1 from public.appointments where client_name='Public visitor'),'Replay did not duplicate appointment');
select pg_temp.agenda_ok((select end_time='10:00' and status='pendiente' from public.appointments where client_name='Public visitor'),'End time derived from service and pending status saved');
select pg_temp.agenda_ok((select count(*)=1 from public.appointment_events where source='public_request'),'Public request audit persisted without a user actor');
select pg_temp.agenda_denied($q$select public.replace_schedule_day('10000000-0000-0000-0000-000000000001',(select d from agenda_date),'[]')$q$,'23514','Cannot close day containing pending appointment');
select pg_temp.agenda_denied($q$insert into public.staff_time_off(staff_id,start_date,end_date) select '10000000-0000-0000-0000-000000000001',d,d from agenda_date$q$,'23514','Vacation cannot invalidate pending appointment');
select pg_temp.agenda_denied($q$insert into public.salon_closures(start_date,end_date) select d,d from agenda_date$q$,'23514','Salon closure cannot invalidate active appointment');
update public.appointments set status='confirmado' where client_name='Public visitor';
update public.appointments set start_time='10:00',end_time='10:01' where client_name='Public visitor';
select pg_temp.agenda_ok((select end_time='11:00' from public.appointments where client_name='Public visitor'),'Reschedule ignores manipulated browser end time');
update public.appointments set status='en-proceso' where client_name='Public visitor';
update public.appointments set status='completado' where client_name='Public visitor';
select pg_temp.agenda_denied($q$update public.appointments set status='pendiente' where client_name='Public visitor'$q$,'23514','Closed appointment cannot be silently reopened');
select pg_temp.agenda_denied($q$delete from public.appointments where client_name='Public visitor'$q$,'42501','Team cannot delete appointment history');
select pg_temp.agenda_denied($q$update public.appointment_events set next='{}'$q$,'42501','Audit is immutable to managers');
select pg_temp.agenda_ok((select count(*)=5 from public.appointment_events where appointment_id=(select id from public.appointments where client_name='Public visitor')),'Create, confirm, reschedule, start, completion all audited');
select pg_temp.agenda_ok((select count(*)=26 from public.available_slots('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',(select d from agenda_date))),'Completed appointment releases slot');
update public.appointments set status='cancelado' where client_name='Legacy pending A';
select pg_temp.agenda_ok((select status='cancelado' from public.appointments where client_name='Legacy pending A'),'Legacy unscheduled pending appointment can be cancelled');
-- Roll back all fixtures; separate sessions exercise real concurrent commits.
reset role;
select pg_temp.agenda_ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='david_private' and p.prosecdef and not (p.proconfig @> array['search_path=""'])),'Private SECURITY DEFINER helpers pin search_path');
select 'PASS: '||n||' agenda assertions' as result from agenda_assertions;
rollback;
