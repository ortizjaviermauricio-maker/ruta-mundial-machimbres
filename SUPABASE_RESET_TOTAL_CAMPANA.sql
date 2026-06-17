-- RESET TOTAL DE DATOS DE PRUEBA PARA RUTA AL MUNDIAL DEL MUEBLE 2026
-- Ejecutar una sola vez en Supabase > SQL Editor > Run.
-- Crea una función segura para que el botón "Borrar demo" limpie de verdad Supabase.

create or replace function public.reset_campana_demo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tablas_limpiadas text[] := array[]::text[];
begin
  -- Limpieza fuerte y centralizada: elimina registros y reinicia IDs.
  -- CASCADE borra dependencias/relaciones para que no queden facturas bloqueadas.
  truncate table
    public.autorizaciones_datos,
    public.ganadores,
    public.participantes
  restart identity cascade;

  tablas_limpiadas := array['autorizaciones_datos','ganadores','participantes'];

  -- Si en alguna versión anterior existen tablas auxiliares de facturas/jugadas, se limpian sin fallar si no existen.
  if to_regclass('public.facturas_jugadas') is not null then
    execute 'truncate table public.facturas_jugadas restart identity cascade';
    tablas_limpiadas := array_append(tablas_limpiadas, 'facturas_jugadas');
  end if;

  if to_regclass('public.ruleta_historial') is not null then
    execute 'truncate table public.ruleta_historial restart identity cascade';
    tablas_limpiadas := array_append(tablas_limpiadas, 'ruleta_historial');
  end if;

  if to_regclass('public.participaciones') is not null then
    execute 'truncate table public.participaciones restart identity cascade';
    tablas_limpiadas := array_append(tablas_limpiadas, 'participaciones');
  end if;

  return jsonb_build_object(
    'ok', true,
    'tablas_limpiadas', tablas_limpiadas,
    'fecha', now()
  );
end;
$$;

grant execute on function public.reset_campana_demo() to anon;
grant execute on function public.reset_campana_demo() to authenticated;

-- Políticas mínimas para lectura/escritura normal de la app.
alter table participantes enable row level security;
alter table autorizaciones_datos enable row level security;
alter table ganadores enable row level security;
alter table auditoria_admin enable row level security;

drop policy if exists public_select_participantes on participantes;
create policy public_select_participantes on participantes for select using (true);
drop policy if exists public_insert_participantes on participantes;
create policy public_insert_participantes on participantes for insert with check (true);
drop policy if exists public_update_participantes on participantes;
create policy public_update_participantes on participantes for update using (true);
drop policy if exists public_delete_participantes on participantes;
create policy public_delete_participantes on participantes for delete using (true);

drop policy if exists public_select_autorizaciones on autorizaciones_datos;
create policy public_select_autorizaciones on autorizaciones_datos for select using (true);
drop policy if exists public_insert_autorizaciones on autorizaciones_datos;
create policy public_insert_autorizaciones on autorizaciones_datos for insert with check (true);
drop policy if exists public_delete_autorizaciones on autorizaciones_datos;
create policy public_delete_autorizaciones on autorizaciones_datos for delete using (true);

drop policy if exists public_select_ganadores on ganadores;
create policy public_select_ganadores on ganadores for select using (true);
drop policy if exists public_insert_ganadores on ganadores;
create policy public_insert_ganadores on ganadores for insert with check (true);
drop policy if exists public_delete_ganadores on ganadores;
create policy public_delete_ganadores on ganadores for delete using (true);

drop policy if exists public_select_auditoria_admin on auditoria_admin;
create policy public_select_auditoria_admin on auditoria_admin for select using (true);
drop policy if exists public_insert_auditoria_admin on auditoria_admin;
create policy public_insert_auditoria_admin on auditoria_admin for insert with check (true);
