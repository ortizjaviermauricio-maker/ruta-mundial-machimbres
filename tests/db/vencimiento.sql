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

-- Después de la fecha de cierre no se gira, aunque la factura se haya registrado antes.
update public.configuracion_campana set value = value || '{"activa":true,"modoPruebas":false}'::jsonb;
create temp table tc (t text); grant all on tc to anon;
set role anon;
insert into tc select public.registrar_factura('{"mayorEdad":true,"nombre":"Cierre","celular":"3201999001","sede":"Satélite","autorizacion":true,"tipoDocumento":"CC","numeroDocumento":"71999001","factura":"STFD9901","valorCompra":3000000}')->>'token';
reset role;
update public.configuracion_campana set value = value || jsonb_build_object('fechaFin', (now() - interval '1 minute')::text);
set role anon;
select pg_temp.falla(format('select public.girar(%L)', (select t from tc)), 'no está abierta');
reset role;
update public.configuracion_campana set value = value - 'fechaFin';

-- Sin límite diario: un cliente puede registrar muchas facturas el mismo día.
set role anon;
do $$ declare i int; begin
  for i in 1..15 loop
    perform public.registrar_factura(jsonb_build_object('mayorEdad',true,'nombre','Cliente Grande','autorizacion',true,'tipoDocumento','CC','numeroDocumento','71888001',
      'celular','3201888001','sede','Satélite','factura','STFD98'||lpad(i::text,3,'0'),'valorCompra',600000));
  end loop;
end $$;
reset role;

\echo PRUEBAS_VENCIMIENTO_OK
