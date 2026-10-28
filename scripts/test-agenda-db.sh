#!/usr/bin/env bash
# Isolated Phase 2 PostgreSQL tests, never accepts a remote database URL.
set -euo pipefail
cd "$(dirname "$0")/.."
container="david-agenda-test-$$-$RANDOM"
results=$(mktemp -d)
cleanup() { docker rm -f -v "$container" >/dev/null 2>&1 || true; rm -rf "$results"; }
trap cleanup EXIT
docker run --detach --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b >/dev/null
for attempt in $(seq 1 40); do
 if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
 if [ "$attempt" -eq 40 ]; then docker logs "$container"; exit 1; fi
 sleep 1
done
psql_test() { docker exec -i "$container" psql -X -U postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test < supabase/tests/bootstrap.sql >/dev/null
psql_test -c 'create role service_role nologin bypassrls' >/dev/null
for migration in supabase/migrations/*.sql; do
 if [[ "$migration" == *20261028000200* ]]; then
  psql_test <<'SQL' >/dev/null
insert into public.staff(id,name) values('99999999-0000-0000-0000-000000000001','Legacy professional');
insert into public.appointments(client_name,client_phone,staff_id,appointment_date,start_time,end_time,status) values
 ('Legacy pending A','000','99999999-0000-0000-0000-000000000001',current_date+7,'10:00','11:00','pendiente'),
 ('Legacy pending B','000','99999999-0000-0000-0000-000000000001',current_date+7,'10:30','11:30','pendiente');
SQL
 fi
 psql_test < "$migration" >/dev/null
done
psql_test -c "do \$\$ begin if (select count(*) from public.appointments where client_name like 'Legacy pending%')<>2 then raise exception 'Legacy appointment lost'; end if; end \$\$;" >/dev/null
psql_test < supabase/tests/agenda.sql
