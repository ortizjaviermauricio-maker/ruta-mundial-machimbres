-- Plazo para reclamar premios (diasReclamo). Corre después de pruebas.sql. Ver tests/db/correr.sh.
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


update public.configuracion_campana
set value = value || '{"activa":true,"validarEnCaja":false,"modoPruebas":false,"unPremioPorCliente":true,"diasReclamo":8,"ultimaFacturaFD":0}'::jsonb;
-- Solo un premio con inventario y sin "Sigue intentando": el giro siempre gana.
update public.premios set activo = false;
insert into public.premios (premio, cantidad, peso, entrega_premio, visible_cliente) values ('Metro láser', 1, 100, true, true);

create temp table tv (k text primary key, v text);
grant all on tv to anon, authenticated;

set role anon;
do $$
declare
  base jsonb := '{"mayorEdad":true,"nombre":"Vera","apellido":"Paz","celular":"3109990001","sede":"DEKO LÁMINAS","autorizacion":true,"tipoDocumento":"CC","numeroDocumento":"99887766"}';
  tok text; r jsonb; fin date;
begin
  tok := public.registrar_factura(base || '{"factura":"FD1","valorCompra":3000000}')->>'token';
  insert into tv values ('vera', tok);
  r := public.girar(tok);
  if not (r->>'es_premio')::boolean or r->>'premio' <> 'Metro láser' then raise exception 'debía ganar: %', r; end if;
  if (r->>'dias_reclamo')::int <> 8 then raise exception 'dias_reclamo: %', r; end if;
  -- Vence al final del octavo día, hora de Colombia.
  fin := ((r->>'vence_at')::timestamptz at time zone 'America/Bogota' - interval '1 second')::date;
  if fin <> (now() at time zone 'America/Bogota')::date + 8 then raise exception 'fecha de vencimiento: %', r; end if;
end $$;
reset role;

do $$ begin
  if (select cantidad from public.premios where premio = 'Metro láser') <> 0 then raise exception 'inventario no descontado'; end if;
  -- Antes del plazo no vence nada.
  if public._vencer_premios() <> 0 then raise exception 'venció antes de tiempo'; end if;
end $$;

-- Se cumple el plazo.
update public.ganadores set vence_at = now() - interval '1 minute' where factura = 'FD1' and es_premio;

-- El anónimo no puede forzar vencimientos.
set role anon;
select pg_temp.falla('select public.vencer_premios()', 'permission denied');
select pg_temp.falla('select public._vencer_premios()', 'permission denied');
reset role;

-- El cajero intenta entregarlo: lo rechaza y el premio vuelve a la ruleta.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
select pg_temp.falla($$select public.marcar_entrega((select id from public.ganadores where factura = 'FD1' and es_premio))$$, 'venció');
do $$ begin
  if public.vencer_premios() <> 1 then raise exception 'el panel no venció el premio'; end if;
end $$;
select pg_temp.falla($$select public.marcar_entrega((select id from public.ganadores where factura = 'FD1' and es_premio))$$, 'venció');
reset role;
do $$ begin
  if (select estado from public.ganadores where factura = 'FD1' and es_premio) <> 'vencido' then raise exception 'no quedó vencido'; end if;
  if (select cantidad from public.premios where premio = 'Metro láser') <> 1 then raise exception 'inventario no devuelto'; end if;
  if (select estado from public.participantes where factura = 'FD1') <> 'aprobada' then raise exception 'la factura vencida salió del ranking'; end if;
  if not exists (select 1 from public.auditoria_admin where accion = 'Premios vencidos') then raise exception 'sin auditoría'; end if;
  -- Volver a vencer no devuelve dos veces.
  if public._vencer_premios() <> 0 then raise exception 'doble devolución'; end if;
end $$;

-- El mismo cliente ya ganó (aunque no reclamó): sus giros siguientes no dan premio.
update public.premios set activo = true where premio = 'Sigue intentando';
set role anon;
do $$
declare r jsonb;
begin
  r := public.girar((select v from tv where k = 'vera'));
  if (r->>'es_premio')::boolean then raise exception 'cliente con premio vencido volvió a ganar: %', r; end if;
end $$;
reset role;

-- Otro cliente puede ganar el premio devuelto.
update public.premios set peso = 0 where premio = 'Sigue intentando';
set role anon;
do $$
declare tok text; r jsonb;
begin
  tok := public.registrar_factura('{"mayorEdad":true,"nombre":"Rio","celular":"3109990002","sede":"DEKO LÁMINAS","autorizacion":true,"tipoDocumento":"CC","numeroDocumento":"11223344","factura":"FD2","valorCompra":1000000}'::jsonb)->>'token';
  r := public.girar(tok);
  if r->>'premio' <> 'Metro láser' then raise exception 'el premio devuelto no volvió a salir: %', r; end if;
end $$;
reset role;

-- Panel: el personal puede pedir el vencimiento al cargar.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
set role authenticated;
do $$ begin perform public.vencer_premios(); end $$;
reset role;

-- Mayoría de edad y autorización comercial separada (Ley 1581).
set role anon;
select pg_temp.falla($$select public.registrar_factura('{"nombre":"Menor","celular":"3109990077","sede":"DEKO LÁMINAS","autorizacion":true,"aceptaReglamento":true,"tipoDocumento":"CC","numeroDocumento":"55667788","factura":"FD77","valorCompra":1000000}')$$, 'mayor de 18');
do $$ begin
  perform public.registrar_factura('{"mayorEdad":true,"nombre":"Sin Mercadeo","celular":"3109990078","sede":"DEKO LÁMINAS","autorizacion":true,"tipoDocumento":"CC","numeroDocumento":"55667789","factura":"FD78","valorCompra":1000000}');
  perform public.registrar_factura('{"mayorEdad":true,"aceptaMercadeo":true,"nombre":"Con Mercadeo","celular":"3109990079","sede":"DEKO LÁMINAS","autorizacion":true,"tipoDocumento":"CC","numeroDocumento":"55667790","factura":"FD79","valorCompra":1000000}');
end $$;
select pg_temp.falla('select public._registrar_factura_base(''{}'')', 'permission denied');
reset role;
do $$ begin
  if (select acepto_mercadeo or finalidades <> array['campanas'] from public.autorizaciones_datos where factura = 'FD78') then raise exception 'mercadeo sin consentimiento'; end if;
  if not (select acepto_mercadeo and 'whatsapp' = any(finalidades) and texto_mercadeo is not null from public.autorizaciones_datos where factura = 'FD79') then raise exception 'mercadeo no guardado'; end if;
  if not (select declara_mayor_edad from public.autorizaciones_datos where factura = 'FD79') then raise exception 'mayor de edad'; end if;
end $$;

-- Las reglas internas no se publican.
do $$ begin
  if public.campana_publica()::text ~ 'unPremio' then raise exception 'campana_publica expone la regla de un premio'; end if;
end $$;


-- ===== Ruleta sin azar: obsequio según el valor de la factura =====
update public.configuracion_campana set value = value || '{"modoObsequio":true,"maxOportunidades":1,"valorPorOportunidad":1500000,"compraMinima":1,"unPremioPorCliente":true,"ultimaFacturaSTFD":0}'::jsonb;
update public.premios set activo = false where entrega_premio;
update public.premios set activo = true, peso = 0 where premio = 'Sigue intentando';
insert into public.premios (premio, cantidad, peso, entrega_premio, visible_cliente, sede, compra_minima) values
  ('Obs Puntas', 2, 0, true, true, 'Satélite', 1500000),
  ('Obs Nivelador', 1, 0, true, true, 'Satélite', 3000000),
  ('Obs Taladro', 1, 0, true, true, 'Satélite', 7500000),
  ('Obs Otra sede', 5, 0, true, true, 'DEKO LÁMINAS', 1500000);
set role anon;
do $$
declare r jsonb; t text;
  function_base jsonb := '{"mayorEdad":true,"sede":"Satélite","autorizacion":true,"tipoDocumento":"CC"}';
begin
  -- 8 millones: el rango más alto que alcanza.
  t := public.registrar_factura(function_base || '{"nombre":"Uno","celular":"3201000001","numeroDocumento":"70000001","factura":"STFD9001","valorCompra":8000000}')->>'token';
  r := public.girar(t);
  if r->>'premio' <> 'Obs Taladro' then raise exception 'rango alto: %', r; end if;
  if (r->>'restantes')::int <> 0 then raise exception 'un giro por factura: %', r; end if;
  -- 9 millones: el taladro se agotó, baja al siguiente rango.
  t := public.registrar_factura(function_base || '{"nombre":"Dos","celular":"3201000002","numeroDocumento":"70000002","factura":"STFD9002","valorCompra":9000000}')->>'token';
  if public.girar(t)->>'premio' <> 'Obs Nivelador' then raise exception 'baja de rango'; end if;
  -- 2 millones: rango básico, nunca un premio de otra sede.
  t := public.registrar_factura(function_base || '{"nombre":"Tres","celular":"3201000003","numeroDocumento":"70000003","factura":"STFD9003","valorCompra":2000000}')->>'token';
  if public.girar(t)->>'premio' <> 'Obs Puntas' then raise exception 'rango básico'; end if;
  -- El mismo cliente con otra factura grande: ya recibió su obsequio.
  t := public.registrar_factura(function_base || '{"nombre":"Tres","celular":"3201000003","numeroDocumento":"70000003","factura":"STFD9004","valorCompra":4000000}')->>'token';
  r := public.girar(t);
  if (r->>'es_premio')::boolean then raise exception 'dos obsequios a un cliente: %', r; end if;
  -- Factura menor al valor del giro: no gira, pero queda registrada.
  t := public.registrar_factura(function_base || '{"nombre":"Cuatro","celular":"3201000004","numeroDocumento":"70000004","factura":"STFD9005","valorCompra":900000}')->>'token';
  if (public.estado_factura(t)->>'oportunidades')::int <> 0 then raise exception 'sin giro bajo el mínimo'; end if;
end $$;
reset role;
do $$ begin
  if (select cantidad from public.premios where premio = 'Obs Otra sede') <> 5 then raise exception 'tocó otra sede'; end if;
  if (public.campana_publica()->'config'->>'modoObsequio')::boolean is not true then raise exception 'modo público'; end if;
  if not exists (select 1 from jsonb_array_elements(public.campana_publica()->'premios') e where (e->>'desde')::numeric = 7500000) then raise exception 'rango público'; end if;
end $$;

\echo PRUEBAS_VENCIMIENTO_OK
