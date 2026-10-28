-- Read-only preflight on an authorized staging copy before production migration.
-- Prints counts only, never customer records. Does not validate or change data.
-- Required: SQL owner with SELECT on these nine application tables.
\set ON_ERROR_STOP on
begin read only;
do $$
declare c record; failures bigint; seen integer:=0; invalid_rows bigint:=0;
begin
 for c in
  select conrelid::regclass as relation, conname, convalidated,
   pg_get_expr(conbin,conrelid) as expression
  from pg_constraint
  where connamespace='public'::regnamespace and contype='c'
   and conname = any(array[
    'products_finite_values','services_finite_price','sales_finite_values',
    'movements_finite_values','expenses_finite_amount','clients_input_bounds',
    'products_input_bounds','staff_input_bounds','services_input_bounds',
    'appointments_input_bounds','expenses_input_bounds','sales_input_bounds',
    'movements_input_bounds'])
 loop
  seen:=seen+1;
  execute format('select count(*) from %s where (%s) is false',c.relation,c.expression) into failures;
  raise notice '%: violating rows=%, validated=%',c.conname,failures,c.convalidated;
  invalid_rows:=invalid_rows+failures;
 end loop;
 if seen<>13 then raise exception 'Expected 13 Phase 1 checks; found %. Apply hardening on staging first.',seen; end if;
 if invalid_rows>0 then raise exception 'Legacy data violates Phase 1 checks. Review and correct through an authorized, audited procedure.'; end if;
 raise notice 'PASS: all 13 Phase 1 constraints have zero violating rows. This audit does not mark constraints VALIDATED.';
end $$;
rollback;
