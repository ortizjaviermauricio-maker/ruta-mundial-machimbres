-- SUPABASE_PATROCINADORES_V2.sql
-- Ejecutar una sola vez antes de usar el módulo de patrocinadores.
-- Ruta al Mundial del Mueble 2026 - Machimbres y Maderas S.A.S.

create table if not exists patrocinadores (
  id bigserial primary key,
  nombre text not null,
  empresa text,
  responsable text,
  telefono text,
  correo text,
  logo_url text,
  banner_url text,
  pagina_web text,
  instagram text,
  whatsapp text,
  activo boolean default true,
  orden integer default 99,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table patrocinadores enable row level security;

drop policy if exists public_select_patrocinadores on patrocinadores;
drop policy if exists public_insert_patrocinadores on patrocinadores;
drop policy if exists public_update_patrocinadores on patrocinadores;
drop policy if exists public_delete_patrocinadores on patrocinadores;

create policy public_select_patrocinadores on patrocinadores for select using (true);
create policy public_insert_patrocinadores on patrocinadores for insert with check (true);
create policy public_update_patrocinadores on patrocinadores for update using (true);
create policy public_delete_patrocinadores on patrocinadores for delete using (true);

alter table premios add column if not exists patrocinador_id bigint references patrocinadores(id) on delete set null;
alter table participantes add column if not exists patrocinador_id bigint references patrocinadores(id) on delete set null;
alter table participantes add column if not exists marca_compra text;


-- LIMPIEZA Y BLOQUEO DE DUPLICADOS
-- Deja un solo registro por patrocinador (sin importar mayúsculas, tildes o espacios).
delete from patrocinadores
where id in (
  select id
  from (
    select id,
           row_number() over (
             partition by lower(trim(nombre))
             order by orden asc nulls last, created_at asc nulls last, id asc
           ) as rn
    from patrocinadores
  ) duplicados
  where rn > 1
);

create unique index if not exists uq_patrocinadores_nombre_normalizado
on patrocinadores (lower(trim(nombre)));


-- Ecofort como patrocinador base. El logo se sirve desde /public/ecofort-logo.png en el aplicativo.
insert into patrocinadores (nombre, empresa, logo_url, activo, orden)
values ('Ecofort', 'Ecofort', '/ecofort-logo.png', true, 1)
on conflict do nothing;

-- Opcional: índice para reportes por patrocinador.
create index if not exists idx_participantes_patrocinador_id on participantes(patrocinador_id);
create index if not exists idx_premios_patrocinador_id on premios(patrocinador_id);


-- V2.1: permite seleccionar varias marcas patrocinadoras en una sola factura.
alter table participantes add column if not exists patrocinadores_ids text;
