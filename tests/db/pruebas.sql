-- Pruebas de seguridad y reglas contra un Postgres local. Ver tests/db/correr.sh.
\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.falla(p_sql text, p_contiene text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'NO FALLÓ: %', p_sql using errcode = 'XX999';
exception
  when sqlstate 'XX999' then raise;
  when others then
    if position(p_contiene in sqlerrm) = 0 then
      raise exception 'Error inesperado en [%]: %', p_sql, sqlerrm;
    end if;
end $$;
grant execute on function pg_temp.falla(text, text) to anon, authenticated;

-- Personal de prueba
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-000000000001', 'ortiz.javiermauricio@hotmail.com', now()),
  ('00000000-0000-0000-0000-000000000002', 'caja@machimbres.test', now()),
  ('00000000-0000-0000-0000-000000000003', 'intruso@machimbres.test', now()),
  ('00000000-0000-0000-0000-000000000004', 'sinconfirmar@machimbres.test', null);
insert into public.admins (email, rol) values ('caja@machimbres.test', 'validador'), ('sinconfirmar@machimbres.test', 'admin');

update public.configuracion_campana set value = value || '{"activa":true,"validarEnCaja":true,"ultimaFacturaFE":100,"valorPorOportunidad":500000,"puntosPorOportunidad":100,"maxOportunidades":10}'::jsonb;
insert into public.patrocinadores (nombre) values ('Ecofort');
insert into public.premios (premio, cantidad, peso, entrega_premio, visible_cliente, patrocinador_id) values
  ('Sigue intentando', 0, 50, false, false, null),
  ('Gorra', 3, 50, true, true, null),
  ('Bono Ecofort', 100, 1000, true, true, 1);

-- ===== Anónimo: no toca ninguna tabla =====
set role anon;
select pg_temp.falla('select * from public.participantes', 'permission denied');
select pg_temp.falla('select * from public.configuracion_campana', 'permission denied');
select pg_temp.falla('select * from public.ganadores', 'permission denied');
select pg_temp.falla('select * from public.admins', 'permission denied');
select pg_temp.falla('insert into public.ganadores (premio, es_premio, estado) values (''x'', true, ''pendiente'')', 'permission denied');
select pg_temp.falla('update public.premios set cantidad = 999', 'permission denied');
select pg_temp.falla('delete from public.participantes', 'permission denied');
select pg_temp.falla('select public.reiniciar_campana(''BORRAR TODO'')', 'permission denied');
select pg_temp.falla('select public.validar_factura(gen_random_uuid(), true)', 'permission denied');
select pg_temp.falla('select public.reemplazar_premios(''[]'')', 'permission denied');
select pg_temp.falla('select public._config()', 'permission denied');

-- ===== Lectura pública sin datos personales ni parámetros internos =====
do $$
declare c text := public.campana_publica()::text;
begin
  if c ~ 'ultimaFactura|adminPass|peso|probabilidad|celular' then raise exception 'campana_publica expone datos internos: %', c; end if;
  if (public.campana_publica()->'config'->>'activa') <> 'true' then raise exception 'config'; end if;
end $$;

-- ===== Registro =====
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
do $$
declare base jsonb := '{"nombre":"Ana María","apellido":"Rojas","celular":"300 123 4567","sede":"Machimbres y Maderas S.A.S.","autorizacion":true}';
begin
  insert into t values ('t1', public.registrar_factura(base || '{"factura":"fe-101","valorCompra":1600000}')->>'token');
  insert into t values ('t2', public.registrar_factura(base || '{"factura":"FE102","valorCompra":99000000,"patrocinadorIds":[1,999]}')->>'token');
end $$;
select pg_temp.falla($$select public.registrar_factura('{"nombre":"A","celular":"3001234567","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE101","valorCompra":600000}')$$, 'ya fue registrada');
select pg_temp.falla($$select public.registrar_factura('{"nombre":"A","celular":"3001234567","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE100","valorCompra":600000}')$$, 'anterior al inicio');
select pg_temp.falla($$select public.registrar_factura('{"nombre":"A","celular":"3001234567","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FD500","valorCompra":600000}')$$, 'prefijo');
select pg_temp.falla($$select public.registrar_factura('{"nombre":"A","celular":"3001234567","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE500","valorCompra":100}')$$, 'mínimo');
select pg_temp.falla($$select public.registrar_factura('{"nombre":"A","celular":"3001234567","sede":"Machimbres y Maderas S.A.S.","factura":"FE500","valorCompra":600000}')$$, 'reglamento');
select pg_temp.falla($$select public.registrar_factura('{"nombre":"A","celular":"abc","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE500","valorCompra":600000}')$$, 'celular');

-- ===== Sin validar no gira, ni con token falso =====
select pg_temp.falla(format('select public.girar(%L)', (select v from t where k = 't1')), 'por validar');
select pg_temp.falla($$select public.girar('falso')$$, 'No encontramos');
do $$ begin
  if (public.campana_publica()->'ranking') <> '[]'::jsonb then raise exception 'ranking incluye facturas sin aprobar'; end if;
end $$;
reset role;

-- ===== Usuario autenticado sin rol =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
set role authenticated;
select pg_temp.falla('select public.reiniciar_campana(''BORRAR TODO'')', 'No autorizado');
select pg_temp.falla('select public.validar_factura((select gen_random_uuid()), true)', 'No autorizado');
do $$ begin
  if (select count(*) from public.participantes) <> 0 then raise exception 'intruso ve participantes'; end if;
  if (select count(*) from public.premios) <> 0 then raise exception 'intruso ve premios'; end if;
end $$;
select pg_temp.falla('insert into public.premios (premio) values (''x'')', 'row-level security');
reset role;

-- ===== Correo sin confirmar no otorga permisos =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
set role authenticated;
do $$ begin if public.es_personal() then raise exception 'correo sin confirmar tiene permisos'; end if; end $$;
reset role;

-- ===== Validador: ve y aprueba, pero no administra =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$
declare v_id uuid; v_id2 uuid; r jsonb;
begin
  select id into v_id from public.participantes where factura = 'FE101';
  select id into v_id2 from public.participantes where factura = 'FE102';
  r := public.validar_factura(v_id, true);
  if (r->>'oportunidades')::int <> 3 then raise exception 'oportunidades: %', r; end if;
  -- El valor inflado se corrige en caja: de 99 millones a 2 millones.
  r := public.validar_factura(v_id2, true, 2000000);
  if (r->>'oportunidades')::int <> 4 then raise exception 'valor corregido: %', r; end if;
end $$;
select pg_temp.falla('select public.reiniciar_campana(''BORRAR TODO'')', 'No autorizado');
select pg_temp.falla('select public.reemplazar_premios(''[]'')', 'No autorizado');
do $$ begin
  if (select count(*) from public.configuracion_campana) <> 0 then raise exception 'validador ve configuración'; end if;
end $$;
select pg_temp.falla('update public.participantes set usadas = 0', 'permission denied');
reset role;

-- ===== Giros: 3 oportunidades, un solo premio real por factura =====
set role anon;
do $$
declare tok text := (select v from t where k = 't1'); r jsonb; premios int := 0; i int;
begin
  for i in 1..3 loop
    r := public.girar(tok);
    if (r->>'restantes')::int <> 3 - i then raise exception 'restantes: %', r; end if;
    if (r->>'es_premio')::boolean then premios := premios + 1; end if;
  end loop;
  if premios > 1 then raise exception 'más de un premio en una factura'; end if;
  if (public.estado_factura(tok)->>'restantes')::int <> 0 then raise exception 'estado'; end if;
end $$;
select pg_temp.falla(format('select public.girar(%L)', (select v from t where k = 't1')), 'no tiene giros');
-- Una factura sin la marca no puede ganar el premio del patrocinador.
reset role;
do $$ begin
  if exists (select 1 from public.ganadores where factura = 'FE101' and premio = 'Bono Ecofort') then
    raise exception 'premio de patrocinador entregado sin la marca';
  end if;
  if exists (select 1 from public.ganadores where premio = 'Sigue intentando' and es_premio) then raise exception 'sin premio contado'; end if;
end $$;

-- ===== Ranking anónimo =====
do $$
declare r text := (public.campana_publica()->'ranking')::text;
begin
  if r !~ 'Ana R\.' then raise exception 'ranking: %', r; end if;
  if r ~ 'Rojas|FE10|300' then raise exception 'ranking expone datos: %', r; end if;
end $$;

-- ===== Recuperar acceso =====
set role anon;
select pg_temp.falla($$select public.recuperar_factura('FE102', '3000000000')$$, 'No encontramos');
do $$
declare viejo text := (select v from t where k = 't2'); nuevo text;
begin
  nuevo := public.recuperar_factura('FE102', '3001234567')->>'token';
  if public.estado_factura(viejo) is not null then raise exception 'token viejo sigue vivo'; end if;
  if public.estado_factura(nuevo) is null then raise exception 'token nuevo'; end if;
end $$;
reset role;

-- ===== Entrega de premios =====
insert into public.ganadores (premio, es_premio, estado, factura) values ('Prueba', true, 'pendiente', 'FE900');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$ begin
  perform public.marcar_entrega((select id from public.ganadores where factura = 'FE900'));
end $$;
select pg_temp.falla($$select public.marcar_entrega((select id from public.ganadores where factura = 'FE900'))$$, 'ya fue entregado');
reset role;

-- ===== Administrador =====
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
do $$ begin
  if public.rol_actual() <> 'admin' then raise exception 'rol'; end if;
  if (select count(*) from public.configuracion_campana) <> 1 then raise exception 'admin sin configuración'; end if;
  if (select count(*) from public.auditoria_admin where accion = 'Factura aprobada') <> 2 then raise exception 'auditoría'; end if;
end $$;
select pg_temp.falla($$select public.reemplazar_premios('[{"premio":"Sin cantidad","peso":-1}]')$$, 'check');
do $$ begin
  if (select count(*) from public.premios) <> 3 then raise exception 'reemplazo no fue atómico'; end if;
end $$;
select pg_temp.falla($$select public.reiniciar_campana('si')$$, 'Confirmación');
select public.reiniciar_campana('BORRAR TODO');
do $$ begin
  if (select count(*) from public.participantes) + (select count(*) from public.ganadores) <> 0 then raise exception 'reinicio'; end if;
end $$;
reset role;

-- ===== Sin caja: registra y gira de inmediato; la factura falsa se anula al reclamar =====
update public.configuracion_campana set value = value || '{"validarEnCaja":false,"unPremioPorFactura":true}'::jsonb;
delete from public.premios where true;
insert into public.premios (premio, cantidad, peso, entrega_premio) values ('Taladro', 1, 100, true);
set role anon;
do $$
declare d jsonb := '{"nombre":"Eva Paz","celular":"3005550000","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE800","valorCompra":600000}';
  r jsonb; g jsonb;
begin
  r := public.registrar_factura(d);
  if r->>'estado' <> 'aprobada' then raise exception 'debía quedar aprobada: %', r; end if;
  g := public.girar(r->>'token');
  if g->>'premio' <> 'Taladro' then raise exception 'giro: %', g; end if;
end $$;
select pg_temp.falla($$select public.registrar_factura('{"nombre":"Otro","celular":"3005550001","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE-800","valorCompra":600000}')$$, 'ya fue registrada');
select pg_temp.falla($$select public.anular_premio(gen_random_uuid(), 'x')$$, 'permission denied');
reset role;
do $$ begin
  if (select cantidad from public.premios where premio = 'Taladro') <> 0 then raise exception 'stock'; end if;
  if (public.campana_publica()->'ranking')::text !~ 'Eva' then raise exception 'ranking sin Eva'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.falla($$select public.anular_premio((select id from public.ganadores where factura = 'FE800'), ' ')$$, 'motivo');
select public.anular_premio((select id from public.ganadores where factura = 'FE800'), 'La factura no existe');
reset role;
do $$ begin
  if (select cantidad from public.premios where premio = 'Taladro') <> 1 then raise exception 'stock no devuelto'; end if;
  if (select estado from public.ganadores where factura = 'FE800') <> 'anulado' then raise exception 'estado'; end if;
  if (public.campana_publica()->'ranking')::text ~ 'Eva' then raise exception 'anulada sigue en ranking'; end if;
end $$;

-- ===== Ranking por compra acumulada =====
update public.configuracion_campana set value = value || '{"validarEnCaja":false,"valorPorOportunidad":1000000,"puntosPorOportunidad":5000,"maxOportunidades":5,"compraMinima":500000}'::jsonb;
set role anon;
select public.registrar_factura('{"nombre":"Rita","apellido":"Vega","celular":"3005550101","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE901","valorCompra":900000}');
select public.registrar_factura('{"nombre":"Rita","apellido":"Vega","celular":"3005550101","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE902","valorCompra":900000}');
select public.registrar_factura('{"nombre":"Beto","apellido":"Paz","celular":"3005550102","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE903","valorCompra":20000000}');
select public.registrar_factura('{"nombre":"Cora","apellido":"Luna","celular":"3005550103","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE904","valorCompra":700000}');
select public.registrar_factura('{"nombre":"Ada","apellido":"Mora","celular":"3005550104","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE905","valorCompra":1100000}');
select public.registrar_factura('{"nombre":"Ida","apellido":"Mesa","celular":"3005550105","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE906","valorCompra":1500000}');
reset role;
do $$
declare
  r jsonb := public.campana_publica()->'ranking';
  beto jsonb := (select e from jsonb_array_elements(r) e where e->>'nombre' = 'Beto P.');
  rita jsonb := (select e from jsonb_array_elements(r) e where e->>'nombre' = 'Rita V.');
begin
  if (beto->>'puntos')::bigint <> 100000 then raise exception 'sin tope: %', r; end if;
  if (rita->>'puntos')::bigint <> 5000 or (rita->>'facturas')::int <> 2 then raise exception 'acumulado: %', r; end if;
  if r::text ~ 'Cora' then raise exception 'menos de un giro acumulado no puntúa: %', r; end if;
  if r->0->>'nombre' <> 'Beto P.' then raise exception 'orden: %', r; end if;
  if (select array_agg(e->>'nombre' order by o) from jsonb_array_elements(r) with ordinality t(e, o) where e->>'nombre' in ('Rita V.', 'Ida M.', 'Ada M.'))
     <> array['Rita V.', 'Ida M.', 'Ada M.'] then raise exception 'desempate por compra: %', r; end if;
end $$;

-- ===== Modo pruebas y autorización solo para nuevos =====
update public.configuracion_campana set value = value || '{"modoPruebas":true,"codigoPrueba":"M39-TEST","validarEnCaja":false}'::jsonb;
update public.premios set cantidad = 1 where premio = 'Taladro';
update public.premios set peso = 0 where premio <> 'Taladro';
set role anon;
select pg_temp.falla($$select public.registrar_factura('{"nombre":"Tia","apellido":"Rey","celular":"3005550201","sede":"Machimbres y Maderas S.A.S.","aceptaReglamento":true,"autorizacion":true,"factura":"FE911","valorCompra":1000000}')$$, 'Código de prueba');
select pg_temp.falla($$select public.registrar_factura('{"nombre":"Tia","apellido":"Rey","celular":"3005550201","sede":"Machimbres y Maderas S.A.S.","aceptaReglamento":true,"factura":"FE911","valorCompra":1000000,"codigoPrueba":"M39-TEST"}')$$, 'tratamiento de datos');
select pg_temp.falla($$select public.registrar_factura('{"nombre":"Tia","apellido":"Rey","celular":"3005550201","sede":"Machimbres y Maderas S.A.S.","aceptaReglamento":false,"autorizacion":true,"factura":"FE911","valorCompra":1000000,"codigoPrueba":"M39-TEST"}')$$, 'reglamento');
do $$
declare r jsonb;
begin
  if public.autorizacion_vigente('300 555 0201') then raise exception 'nueva no debía tener autorización'; end if;
  r := public.registrar_factura('{"nombre":"Tia","apellido":"Rey","celular":"3005550201","sede":"Machimbres y Maderas S.A.S.","aceptaReglamento":true,"autorizacion":true,"factura":"FE911","valorCompra":1000000,"codigoPrueba":"M39-TEST"}');
  perform public.girar(r->>'token');
  if not public.autorizacion_vigente('300 555 0201') then raise exception 'autorización no reconocida'; end if;
  r := public.registrar_factura('{"nombre":"Tia","apellido":"Rey","celular":"3005550201","sede":"Machimbres y Maderas S.A.S.","aceptaReglamento":true,"factura":"FE912","valorCompra":1000000,"codigoPrueba":"M39-TEST"}');
  if r->>'estado' <> 'aprobada' then raise exception 'recurrente: %', r; end if;
end $$;
select pg_temp.falla($$select public.borrar_datos_prueba()$$, 'permission denied');
reset role;
do $$ begin
  if (select count(*) from public.autorizaciones_datos where celular = '3005550201' and acepto_tratamiento_datos) <> 1 then raise exception 'la segunda factura no debía crear autorización'; end if;
  if (select cantidad from public.premios where premio = 'Taladro') <> 0 then raise exception 'giro no descontó'; end if;
  if (public.campana_publica()->'config')::text ~ 'M39-TEST' then raise exception 'código expuesto'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
insert into public.admins (email, rol) values ('ortiz.javiermauricio@hotmail.com', 'admin') on conflict do nothing;
set role authenticated;
select public.borrar_datos_prueba();
reset role;
do $$ begin
  if exists (select 1 from public.participantes where prueba) then raise exception 'quedaron pruebas'; end if;
  if exists (select 1 from public.autorizaciones_datos where celular = '3005550201') then raise exception 'quedó autorización de prueba'; end if;
  if (select cantidad from public.premios where premio = 'Taladro') <> 1 then raise exception 'inventario no devuelto'; end if;
  if (select count(*) from public.participantes where not prueba) = 0 then raise exception 'borró datos reales'; end if;
end $$;
update public.configuracion_campana set value = value || '{"modoPruebas":false}'::jsonb;

-- ===== Campaña cerrada =====
update public.configuracion_campana set value = value || '{"activa":false}'::jsonb;
set role anon;
select pg_temp.falla($$select public.registrar_factura('{"nombre":"A","celular":"3001234567","sede":"Machimbres y Maderas S.A.S.","autorizacion":true,"factura":"FE700","valorCompra":600000}')$$, 'no está abierta');
reset role;

\echo PRUEBAS_SECUENCIALES_OK
