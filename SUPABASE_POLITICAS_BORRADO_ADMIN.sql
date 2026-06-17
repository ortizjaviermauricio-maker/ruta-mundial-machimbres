-- POLITICAS NECESARIAS PARA QUE EL BOTON "BORRAR DEMO" ELIMINE DATOS REALES EN SUPABASE
-- Ejecutar una sola vez en Supabase > SQL Editor > Run.
-- Nota: estas politicas permiten que el frontend, usando la anon key, borre datos de las tablas indicadas.
-- En esta aplicacion el acceso administrativo se controla desde el panel Admin.

alter table participantes enable row level security;
alter table autorizaciones_datos enable row level security;
alter table ganadores enable row level security;
alter table auditoria_admin enable row level security;

drop policy if exists public_delete_participantes on participantes;
create policy public_delete_participantes on participantes for delete using (true);

drop policy if exists public_delete_autorizaciones on autorizaciones_datos;
create policy public_delete_autorizaciones on autorizaciones_datos for delete using (true);

drop policy if exists public_delete_ganadores on ganadores;
create policy public_delete_ganadores on ganadores for delete using (true);

drop policy if exists public_delete_auditoria_admin on auditoria_admin;
create policy public_delete_auditoria_admin on auditoria_admin for delete using (true);
