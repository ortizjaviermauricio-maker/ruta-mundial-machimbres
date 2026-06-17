-- BLOQUEO CORRECTO DE FACTURA
-- Regla de negocio:
-- 1) Una factura solo se puede REGISTRAR una vez en participantes.
-- 2) Una factura puede GIRAR varias veces según sus oportunidades disponibles.
-- 3) Por eso NO debe existir índice único sobre ganadores.factura.

-- Eliminar blindaje anterior incorrecto: impedía varios giros por la misma factura.
drop index if exists ux_ganadores_factura_unica;

-- Mantener factura única en participantes.
create unique index if not exists ux_participantes_factura_unica
on participantes (upper(trim(factura)))
where factura is not null and trim(factura) <> '';
