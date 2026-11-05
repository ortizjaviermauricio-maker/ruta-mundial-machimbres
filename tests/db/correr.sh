#!/usr/bin/env bash
# Crea un Postgres temporal, aplica las migraciones y corre las pruebas.
# Requiere PostgreSQL instalado. Ejecutar como un usuario distinto de root o desde root con `su postgres`.
set -euo pipefail

BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DIR=$(mktemp -d)
SOCK=/tmp/pgruleta
PUERTO=55439
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)

mkdir -p "$SOCK"
"$BIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$DIR" -o "-p $PUERTO -k $SOCK -c listen_addresses=''" -w -l "$DIR/log" start >/dev/null
trap '"$BIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT

PSQL=(psql -h "$SOCK" -p "$PUERTO" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" <<'SQL'
-- Réplica mínima de lo que Supabase trae por defecto.
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
SQL

for m in "$RAIZ"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$m"; done
"${PSQL[@]}" -f "$RAIZ/tests/db/pruebas.sql"
node "$RAIZ/tests/db/concurrencia.mjs" "$PUERTO" postgres
