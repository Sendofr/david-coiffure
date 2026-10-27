#!/usr/bin/env bash
# Native PostgreSQL security/integrity tests. Disposable Docker only, never a URL.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker is required for isolated database tests.' >&2; exit 1; }
container="david-db-test-$$-$RANDOM"
results=$(mktemp -d)
cleanup() { docker rm -f -v "$container" >/dev/null 2>&1 || true; rm -rf "$results"; }
trap cleanup EXIT
# No published ports or network; test-only local trust cannot reach any live DB.
docker run --detach --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b >/dev/null
for attempt in $(seq 1 40); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 40 ]; then docker logs "$container"; exit 1; fi
  sleep 1
done
psql_test() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test < supabase/tests/bootstrap.sql >/dev/null
psql_test < supabase/migrations/20261027000100_baseline.sql >/dev/null
# Exercise upgrade over an existing populated baseline, including a historical
# column grant which must not survive hardening.
psql_test <<'SQL' >/dev/null
insert into public.services(name) values('Legacy upgrade sentinel');
insert into public.clients(name,phone) values('  ','__legacy_audit_fixture__');
grant update(stock_qty) on public.products to authenticated, public;
grant select(name) on public.staff to anon, public;
grant update(unit_cost_gs) on public.sales to authenticated, public;
SQL
psql_test < supabase/migrations/20261027000100_baseline.sql >/dev/null
psql_test < supabase/migrations/20261027000200_security.sql >/dev/null
psql_test <<'SQL' >/dev/null
do $$ begin
 if (select count(*) from public.services where name='Legacy upgrade sentinel')<>1
 then raise exception 'Upgrade lost existing data'; end if;
end $$;
delete from public.services where name='Legacy upgrade sentinel';
SQL
# NOT VALID preserves a pre-existing invalid row, but the read-only audit must
# diagnose it. Clean only this disposable test fixture, then require audit PASS.
if psql_test < supabase/audit-legacy.sql >"$results/legacy-audit" 2>&1; then
  echo 'Legacy audit missed an invalid historical row' >&2; exit 1
fi
if ! grep -q 'Legacy data violates Phase 1 checks' "$results/legacy-audit"; then
  cat "$results/legacy-audit"; exit 1
fi
psql_test -c "delete from public.clients where phone='__legacy_audit_fixture__'" >/dev/null
psql_test < supabase/audit-legacy.sql
psql_test < supabase/tests/roles.sql
# Exactly one concurrent sale can consume the last unit; the second must abort.
psql_test <<'SQL' >/dev/null
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000001','owner@test.invalid');
insert into public.profiles(id,role) values('00000000-0000-0000-0000-000000000001','owner');
insert into public.products(id,name,sku,category,cost_gs,sale_price_gs)
values('30000000-0000-0000-0000-000000000001','Concurrent product','CONCURRENT','Venta',40,100);
update public.products set stock_qty=1 where sku='CONCURRENT';
SQL
sale_sql="begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true); select public.register_sale('producto','30000000-0000-0000-0000-000000000001',null,current_date,1,100,40,'Efectivo','',''); select pg_sleep(1); commit;"
psql_test -c "$sale_sql" >"$results/first" 2>&1 & first=$!
psql_test -c "$sale_sql" >"$results/second" 2>&1 & second=$!
first_status=0; wait "$first" || first_status=$?
second_status=0; wait "$second" || second_status=$?
if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -ne 0 ]; } && ! { [ "$second_status" -eq 0 ] && [ "$first_status" -ne 0 ]; }; then
  cat "$results/first" "$results/second"; echo 'Concurrent sale outcome invalid' >&2; exit 1
fi
if ! grep -q 'Stock insuficiente' "$results/first" "$results/second"; then
  cat "$results/first" "$results/second"; echo 'Failed sale did not report insufficient stock' >&2; exit 1
fi
psql_test <<'SQL'
do $$ begin
 if (select stock_qty from public.products where sku='CONCURRENT')<>0
 or (select count(*) from public.sales)<>1
 or (select count(*) from public.stock_movements where kind='venta')<>1
 then raise exception 'Concurrent sale integrity failed'; end if;
end $$;
select 'PASS: concurrent sales: one succeeds, one rejected, stock zero, one sale/movement' as result;
SQL
