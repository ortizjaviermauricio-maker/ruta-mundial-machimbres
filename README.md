# Ruleta de campañas — Machimbres y Maderas

Aplicación React + Vite publicada en Vercel, con Supabase como base de datos. El navegador público no toca tablas: registra y gira mediante funciones del servidor.

## Variables en Vercel

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Base de datos

Aplique `supabase/migrations/` en orden en un proyecto nuevo. La migración crea tablas, permisos, funciones y la configuración inicial con la campaña cerrada.

## Personal

1. Cree el usuario en Supabase > Authentication > Users. Mantenga desactivado el registro público.
2. Autorícelo con SQL: `insert into public.admins (email, rol) values ('correo@empresa.com', 'validador');`

Roles: `validador` verifica la factura original y entrega o anula premios. `admin` además configura la campaña.

## Lanzar una campaña

1. Cambie textos y reglamento en `src/campana.js`.
2. Cargue patrocinadores y premios desde el panel Personal.
3. Actualice la última factura por sede y marque "Campaña abierta".

## Pruebas

- `npm test`: lectura del CSV de premios.
- `npm run test:db`: seguridad, reglas y concurrencia contra un Postgres local.
