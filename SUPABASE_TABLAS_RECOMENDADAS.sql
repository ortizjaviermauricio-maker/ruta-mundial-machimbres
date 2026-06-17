
-- Tablas recomendadas para pasar de demo local a producción Vercel + Supabase

create table participantes (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz default now(),
  nombre text not null,
  taller text,
  celular text not null,
  email text not null,
  ciudad text,
  sede text,
  factura text not null unique,
  valor numeric not null,
  vendedor text,
  puntos integer,
  oportunidades integer,
  usadas integer default 0,
  version_reglamento text,
  version_autorizacion text
);

create table autorizaciones_datos (
  id uuid primary key default gen_random_uuid(),
  participante_id uuid references participantes(id),
  fecha timestamptz default now(),
  nombre text,
  celular text,
  email text,
  factura text,
  sede text,
  acepto_tratamiento_datos boolean,
  acepto_reglamento boolean,
  version_autorizacion text,
  version_reglamento text,
  texto_autorizacion text,
  ip text,
  user_agent text,
  idioma_navegador text,
  plataforma text,
  origen text
);

create table ganadores (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz default now(),
  nombre text,
  celular text,
  email text,
  factura text,
  sede text,
  vendedor text,
  premio text,
  nota text
);

create table premios (
  id uuid primary key default gen_random_uuid(),
  premio text not null,
  peso integer not null,
  cantidad integer not null,
  categoria text,
  activo boolean default true
);
