-- Reglas del 12 nov 2026:
-- 1. Todas las compras suman al ranking general; el ranking público no muestra nombres (puesto, sede principal y puntos).
-- 2. En el registro el cliente indica cuánto de su factura es de cada marca de lámina; eso alimenta un ranking por marca.
-- 3. Un cliente gana máximo un premio de la ruleta en la campaña; después sus giros solo dan "Sigue intentando".
-- 4. mi_posicion(token) devuelve la posición del cliente sin exponer a los demás.

alter table public.participantes add column valores_marca jsonb not null default '{}'::jsonb
  check (jsonb_typeof(valores_marca) = 'object');
alter table public.patrocinadores add column ganadores_ranking integer not null default 2
  check (ganadores_ranking between 1 and 10);

update public.configuracion_campana
set value = value || '{"unPremioPorCliente": true}'::jsonb
where key = 'principal';

-- Marcas que aportan láminas para el ranking por marca (Primadera premia 3 puestos).
insert into public.patrocinadores (nombre, empresa, logo_url, orden, ganadores_ranking)
select v.nombre, v.nombre, v.logo, v.orden, v.ganadores
from (values ('Moduofi', null, 1, 2), ('Primadera', '/primadera-logo.svg', 2, 3), ('Ecofort', '/ecofort-logo.png', 3, 2))
  as v(nombre, logo, orden, ganadores)
where not exists (select 1 from public.patrocinadores s where lower(trim(s.nombre)) = lower(v.nombre));

create or replace function public.registrar_factura(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := public._config();
  v_factura text := public._normalizar_factura(p_datos->>'factura');
  v_sede text;
  v_nombre text := trim(coalesce(p_datos->>'nombre', ''));
  v_apellido text := trim(coalesce(p_datos->>'apellido', ''));
  v_celular text := regexp_replace(coalesce(p_datos->>'celular', ''), '\D', '', 'g');
  v_email text := lower(nullif(trim(coalesce(p_datos->>'correo', '')), ''));
  v_estado text := case when coalesce((c->>'validarEnCaja')::boolean, false) then 'pendiente' else 'aprobada' end;
  v_valor numeric;
  v_prefijo text;
  v_numero bigint;
  v_ultima bigint;
  v_oportunidades integer;
  v_puntos integer;
  v_patrocinadores bigint[];
  v_marcas text;
  v_valores jsonb := '{}'::jsonb;
  v_marca record;
  v_valor_marca numeric;
  v_suma_marcas numeric := 0;
  v_token text := public._nuevo_token();
  v_id uuid;
  v_prueba boolean := coalesce((c->>'modoPruebas')::boolean, false);
  v_autoriza boolean := coalesce((p_datos->>'autorizacion')::boolean, false);
  v_tipo_documento text := upper(trim(coalesce(p_datos->>'tipoDocumento', '')));
  v_numero_documento text := upper(regexp_replace(coalesce(p_datos->>'numeroDocumento', ''), '[\s.]', '', 'g'));
  v_reglamento boolean := coalesce((p_datos->>'aceptaReglamento')::boolean, (p_datos->>'autorizacion')::boolean, false);
begin
  if not coalesce((c->>'activa')::boolean, false)
     or now() < coalesce((c->>'fechaInicio')::timestamptz, '-infinity')
     or now() > coalesce((c->>'fechaFin')::timestamptz, 'infinity') then
    raise exception 'La campaña no está abierta en este momento.' using errcode = 'P0001';
  end if;
  if v_prueba and p_datos->>'codigoPrueba' is distinct from c->>'codigoPrueba' then
    raise exception 'Código de prueba incorrecto.' using errcode = 'P0001';
  end if;
  if not v_reglamento then
    raise exception 'Debe aceptar el reglamento de la campaña.' using errcode = 'P0001';
  end if;
  if not v_autoriza and not public._tiene_autorizacion(v_celular, c) then
    raise exception 'Debe aceptar el tratamiento de datos personales.' using errcode = 'P0001';
  end if;
  if v_autoriza and (v_tipo_documento not in ('CC', 'NIT', 'CE', 'PA') or v_numero_documento !~ '^[0-9A-Z-]{5,20}$') then
    raise exception 'Digite el tipo y número de documento.' using errcode = 'P0001';
  end if;
  if v_nombre = '' or char_length(v_nombre) > 120 or char_length(v_apellido) > 120 then
    raise exception 'Revise el nombre y el apellido.' using errcode = 'P0001';
  end if;
  if v_celular !~ '^[0-9]{7,15}$' then
    raise exception 'Digite un celular válido.' using errcode = 'P0001';
  end if;
  if v_email is not null and (char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Digite un correo válido o déjelo vacío.' using errcode = 'P0001';
  end if;

  -- La sede sale del prefijo de la factura, nunca de lo que elija el cliente.
  -- Si dos prefijos coinciden, gana el más largo.
  select s->>'prefijo', s->>'nombre' into v_prefijo, v_sede
  from jsonb_array_elements(coalesce(c->'sedes', '[]'::jsonb)) s
  where v_factura ~ ('^' || (s->>'prefijo') || '[0-9]{1,15}$')
  order by char_length(s->>'prefijo') desc
  limit 1;
  if v_prefijo is null then
    raise exception 'La factura debe empezar con el prefijo de la sede (%), seguido del número. Ejemplo: FE28501.',
      (select string_agg(s->>'prefijo', ', ') from jsonb_array_elements(coalesce(c->'sedes', '[]'::jsonb)) s)
      using errcode = 'P0001';
  end if;
  v_numero := substr(v_factura, char_length(v_prefijo) + 1)::bigint;
  v_ultima := coalesce((c->>('ultimaFactura' || v_prefijo))::bigint, 0);
  if v_numero <= v_ultima then
    raise exception 'La factura % es anterior al inicio de la campaña.', v_factura using errcode = 'P0001';
  end if;

  begin
    v_valor := (p_datos->>'valorCompra')::numeric;
  exception when others then
    raise exception 'Digite el valor de la compra.' using errcode = 'P0001';
  end;
  if v_valor is null or v_valor < coalesce((c->>'compraMinima')::numeric, 0) or v_valor > 100000000000 then
    raise exception 'La compra no cumple el valor mínimo de la campaña.' using errcode = 'P0001';
  end if;

  if (select count(*) from public.participantes p
      where p.celular = v_celular and p.fecha > now() - interval '1 day') >= 10 then
    raise exception 'Este celular alcanzó el límite de facturas por día. Acérquese a la caja.' using errcode = 'P0001';
  end if;

  -- Valor de cada marca de lámina en la factura. Solo cuentan patrocinadores activos;
  -- la suma no puede pasar del valor de la factura.
  if jsonb_typeof(coalesce(p_datos->'valoresMarca', '{}'::jsonb)) <> 'object' then
    raise exception 'Revise los valores por marca.' using errcode = 'P0001';
  end if;
  for v_marca in select key, value from jsonb_each(coalesce(p_datos->'valoresMarca', '{}'::jsonb)) loop
    if not exists (select 1 from public.patrocinadores s where s.activo and s.id::text = v_marca.key) then
      raise exception 'Una de las marcas no participa en la campaña.' using errcode = 'P0001';
    end if;
    begin
      v_valor_marca := nullif(trim(v_marca.value #>> '{}'), '')::numeric;
    exception when others then
      raise exception 'Revise el valor de cada marca.' using errcode = 'P0001';
    end;
    if v_valor_marca is null or v_valor_marca = 0 then continue; end if;
    if v_valor_marca < 0 then
      raise exception 'Revise el valor de cada marca.' using errcode = 'P0001';
    end if;
    v_suma_marcas := v_suma_marcas + v_valor_marca;
    v_valores := v_valores || jsonb_build_object(v_marca.key, v_valor_marca);
  end loop;
  if v_suma_marcas > v_valor then
    raise exception 'La suma de las marcas no puede superar el valor de la factura.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(s.id order by s.orden), '{}'), string_agg(s.nombre, ', ' order by s.orden)
  into v_patrocinadores, v_marcas
  from public.patrocinadores s
  where s.activo and (s.id::text in (select jsonb_array_elements_text(coalesce(p_datos->'patrocinadorIds', '[]'::jsonb)))
                      or v_valores ? s.id::text);

  v_oportunidades := public._calcular_oportunidades(v_valor, c);
  v_puntos := v_oportunidades * coalesce((c->>'puntosPorOportunidad')::integer, 0);

  begin
    insert into public.participantes (
      nombre, apellido, celular, email, sede, factura, prefijo_factura, factura_numero, valor, vendedor,
      puntos, oportunidades, estado, token_hash, version_reglamento, version_autorizacion, patrocinadores_ids, marca_compra, valores_marca, prueba
    ) values (
      v_nombre, nullif(v_apellido, ''), v_celular, v_email, v_sede, v_factura, v_prefijo, v_numero, v_valor,
      left(nullif(trim(coalesce(p_datos->>'vendedor', '')), ''), 120),
      v_puntos, v_oportunidades, v_estado, public._hash_token(v_token), c->>'reglamento', c->>'autorizacion',
      v_patrocinadores, v_marcas, v_valores, v_prueba
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'Esta factura ya fue registrada.' using errcode = 'P0001';
  end;

  insert into public.autorizaciones_datos (
    participante_id, nombre, celular, email, factura, sede, tipo_documento, numero_documento, acepto_tratamiento_datos, acepto_reglamento,
    version_autorizacion, version_reglamento, texto_autorizacion, user_agent, idioma_navegador, plataforma, origen
  ) values (
    v_id, trim(v_nombre || ' ' || v_apellido), v_celular, v_email, v_factura, v_sede,
    case when v_autoriza then v_tipo_documento end, case when v_autoriza then v_numero_documento end, v_autoriza, v_reglamento,
    case when v_autoriza then c->>'autorizacion' end, c->>'reglamento', case when v_autoriza then c->>'textoAutorizacion' end,
    left(p_datos->>'userAgent', 500), left(p_datos->>'idioma', 40), left(p_datos->>'plataforma', 80), left(p_datos->>'origen', 300)
  );

  return jsonb_build_object('token', v_token, 'factura', v_factura, 'oportunidades', v_oportunidades,
                            'puntos', v_puntos, 'estado', v_estado);
end;
$$;

create or replace function public.girar(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := public._config();
  v_participante public.participantes;
  v_premio public.premios;
  v_ya_gano boolean;
  v_solo_sin_premio boolean;
  v_excluidos uuid[] := '{}';
  v_total numeric;
  v_punto numeric;
  v_es_premio boolean;
begin
  if not coalesce((c->>'activa')::boolean, false) then
    raise exception 'La campaña no está abierta en este momento.' using errcode = 'P0001';
  end if;

  -- El bloqueo de la fila impide que dos giros simultáneos usen la misma oportunidad.
  select * into v_participante
  from public.participantes
  where token_hash = public._hash_token(p_token)
  for update;

  if not found then
    raise exception 'No encontramos esta factura en este dispositivo.' using errcode = 'P0001';
  end if;
  if v_participante.estado = 'pendiente' then
    raise exception 'Su factura aún está por validar en caja.' using errcode = 'P0001';
  end if;
  if v_participante.estado = 'rechazada' then
    raise exception 'Esta factura no fue aprobada.' using errcode = 'P0001';
  end if;
  if v_participante.usadas >= v_participante.oportunidades then
    raise exception 'Esta factura no tiene giros disponibles.' using errcode = 'P0001';
  end if;

  -- Con unPremioPorCliente, quien ya ganó un premio (en cualquier factura) solo puede sacar "Sigue intentando".
  -- El candado por celular evita que dos facturas del mismo cliente ganen a la vez.
  perform pg_advisory_xact_lock(hashtext('girar:' || v_participante.celular));
  v_ya_gano := exists (select 1 from public.ganadores g where g.participante_id = v_participante.id and g.es_premio and g.estado <> 'anulado');
  v_solo_sin_premio := (v_ya_gano and coalesce((c->>'unPremioPorFactura')::boolean, true))
    or (coalesce((c->>'unPremioPorCliente')::boolean, false) and exists (
      select 1 from public.ganadores g join public.participantes p2 on p2.id = g.participante_id
      where g.es_premio and g.estado <> 'anulado' and p2.celular = v_participante.celular and p2.prueba = v_participante.prueba));

  loop
    select sum(p.peso) into v_total
    from public.premios p
    where p.activo and p.peso > 0
      and not (p.id = any (v_excluidos))
      and (not p.entrega_premio or p.cantidad > 0)
      and (p.patrocinador_id is null or p.patrocinador_id = any (v_participante.patrocinadores_ids))
      and (p.sede is null or p.sede = v_participante.sede)
      and (not v_solo_sin_premio or lower(trim(p.premio)) = 'sigue intentando');

    if v_total is null then
      raise exception 'No hay premios disponibles en este momento. Avise al personal de la tienda.' using errcode = 'P0001';
    end if;

    v_punto := random()::numeric * v_total;
    select * into v_premio
    from (
      select p.*, sum(p.peso) over (order by p.id) as acumulado
      from public.premios p
      where p.activo and p.peso > 0
        and not (p.id = any (v_excluidos))
        and (not p.entrega_premio or p.cantidad > 0)
        and (p.patrocinador_id is null or p.patrocinador_id = any (v_participante.patrocinadores_ids))
        and (p.sede is null or p.sede = v_participante.sede)
        and (not v_solo_sin_premio or lower(trim(p.premio)) = 'sigue intentando')
    ) candidatos
    where candidatos.acumulado > v_punto
    order by candidatos.acumulado
    limit 1;

    exit when not v_premio.entrega_premio;

    -- Descuento atómico: si otro cliente se llevó la última unidad, se elige otro resultado.
    update public.premios set cantidad = cantidad - 1
    where id = v_premio.id and cantidad > 0;
    exit when found;
    v_excluidos := v_excluidos || v_premio.id;
  end loop;

  v_es_premio := lower(trim(v_premio.premio)) <> 'sigue intentando';

  update public.participantes set usadas = usadas + 1 where id = v_participante.id;

  insert into public.ganadores (
    participante_id, premio_id, nombre, celular, email, factura, sede, vendedor, premio, es_premio, estado
  ) values (
    v_participante.id, v_premio.id, trim(v_participante.nombre || ' ' || coalesce(v_participante.apellido, '')),
    v_participante.celular, v_participante.email, v_participante.factura, v_participante.sede,
    v_participante.vendedor, v_premio.premio, v_es_premio, case when v_es_premio then 'pendiente' else 'sin_premio' end
  );

  return jsonb_build_object(
    'premio', v_premio.premio, 'es_premio', v_es_premio,
    'restantes', v_participante.oportunidades - v_participante.usadas - 1
  );
end;
$$;

-- Ranking general: compra acumulada por celular. La sede es donde el cliente más compró.
create function public._ranking_general(c jsonb)
returns table (celular text, sede text, puntos bigint, total numeric, facturas integer, posicion bigint)
language sql stable security definer set search_path = '' as $$
  with base as (
    select p.* from public.participantes p
    where p.estado = 'aprobada' and (not p.prueba or coalesce((c->>'modoPruebas')::boolean, false))
  ), por_sede as (
    select b.celular, b.sede, sum(b.valor) as v, max(b.fecha) as f from base b group by b.celular, b.sede
  ), principal as (
    select distinct on (ps.celular) ps.celular, ps.sede from por_sede ps order by ps.celular, ps.v desc, ps.f desc
  ), tot as (
    select b.celular, sum(b.valor) as total, max(b.fecha) as ultima, count(*)::integer as facturas from base b group by b.celular
  ), pts as (
    select t.*, pr.sede,
           floor(t.total / greatest(coalesce((c->>'valorPorOportunidad')::numeric, 1), 1))::bigint
             * coalesce((c->>'puntosPorOportunidad')::bigint, 0) as puntos
    from tot t join principal pr using (celular)
  )
  select x.celular, x.sede, x.puntos, x.total, x.facturas,
         row_number() over (order by x.puntos desc, x.total desc, x.ultima, x.celular)
  from pts x
$$;

-- Ranking de una marca: suma del valor que el cliente registró para esa marca.
create function public._ranking_marca(c jsonb, p_marca bigint)
returns table (celular text, sede text, puntos bigint, total numeric, posicion bigint)
language sql stable security definer set search_path = '' as $$
  with base as (
    select p.celular, p.sede, p.fecha, (p.valores_marca->>p_marca::text)::numeric as v
    from public.participantes p
    where p.estado = 'aprobada' and (not p.prueba or coalesce((c->>'modoPruebas')::boolean, false))
      and p.valores_marca ? p_marca::text
  ), por_sede as (
    select b.celular, b.sede, sum(b.v) as v, max(b.fecha) as f from base b group by b.celular, b.sede
  ), principal as (
    select distinct on (ps.celular) ps.celular, ps.sede from por_sede ps order by ps.celular, ps.v desc, ps.f desc
  ), tot as (
    select b.celular, sum(b.v) as total, max(b.fecha) as ultima from base b group by b.celular
  ), pts as (
    select t.*, pr.sede,
           floor(t.total / greatest(coalesce((c->>'valorPorOportunidad')::numeric, 1), 1))::bigint
             * coalesce((c->>'puntosPorOportunidad')::bigint, 0) as puntos
    from tot t join principal pr using (celular)
    where t.total > 0
  )
  select x.celular, x.sede, x.puntos, x.total,
         row_number() over (order by x.total desc, x.ultima, x.celular)
  from pts x
$$;

create or replace function public.campana_publica() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := public._config();
begin
  return jsonb_build_object(
    'config', jsonb_build_object(
      'activa', coalesce((c->>'activa')::boolean, false),
      'modoPruebas', coalesce((c->>'modoPruebas')::boolean, false),
      'fechaInicio', c->>'fechaInicio',
      'fechaFin', c->>'fechaFin',
      'compraMinima', (c->>'compraMinima')::numeric,
      'valorPorOportunidad', (c->>'valorPorOportunidad')::numeric,
      'puntosPorOportunidad', (c->>'puntosPorOportunidad')::integer,
      'maxOportunidades', (c->>'maxOportunidades')::integer,
      'unPremioPorCliente', coalesce((c->>'unPremioPorCliente')::boolean, false),
      'whatsapp', c->>'whatsapp',
      'habeas', c->>'habeas',
      'reglamento', c->>'reglamento',
      'autorizacion', c->>'autorizacion',
      'sedes', coalesce(c->'sedes', '[]'::jsonb)
    ),
    'premios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.premio, 'categoria', p.categoria,
        'stock', p.cantidad, 'ilimitado', not p.entrega_premio, 'sede', p.sede
      ) order by p.sede nulls first, p.premio)
      from public.premios p
      where p.activo and p.visible_cliente
    ), '[]'::jsonb),
    'patrocinadores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'nombre', s.nombre, 'logo_url', s.logo_url, 'pagina_web', s.pagina_web,
        'instagram', s.instagram, 'whatsapp', s.whatsapp, 'ganadores', s.ganadores_ranking
      ) order by s.orden, s.id)
      from public.patrocinadores s
      where s.activo
    ), '[]'::jsonb),
    -- Sin nombres ni datos personales: puesto, sede principal y puntos.
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('posicion', r.posicion, 'sede', r.sede, 'puntos', r.puntos) order by r.posicion)
      from public._ranking_general(c) r
      where r.puntos > 0 and r.posicion <= 50
    ), '[]'::jsonb),
    'rankingMarcas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'nombre', s.nombre, 'ganadores', s.ganadores_ranking,
        'ranking', coalesce((
          select jsonb_agg(jsonb_build_object('posicion', r.posicion, 'sede', r.sede, 'puntos', r.puntos) order by r.posicion)
          from public._ranking_marca(c, s.id) r
          where r.posicion <= 10
        ), '[]'::jsonb)
      ) order by s.orden, s.id)
      from public.patrocinadores s
      where s.activo
    ), '[]'::jsonb)
  );
end;
$$;

-- Posición del cliente dueño de la factura (por su token), en el ranking general y en cada marca.
create function public.mi_posicion(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := public._config();
  v_celular text;
  v_general jsonb;
begin
  select p.celular into v_celular from public.participantes p where p.token_hash = public._hash_token(p_token);
  if v_celular is null then
    return null;
  end if;
  select jsonb_build_object('posicion', r.posicion, 'puntos', r.puntos, 'sede', r.sede) into v_general
  from public._ranking_general(c) r where r.celular = v_celular;
  return jsonb_build_object(
    'general', v_general,
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'posicion', r.posicion, 'puntos', r.puntos) order by s.orden)
      from public.patrocinadores s
      join lateral public._ranking_marca(c, s.id) r on r.celular = v_celular
      where s.activo
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public._ranking_general(jsonb) from public, anon, authenticated;
revoke all on function public._ranking_marca(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.registrar_factura(jsonb) from public;
grant execute on function public.registrar_factura(jsonb) to anon, authenticated;
revoke all on function public.girar(text) from public;
grant execute on function public.girar(text) to anon, authenticated;
revoke all on function public.campana_publica() from public;
grant execute on function public.campana_publica() to anon, authenticated;
revoke all on function public.mi_posicion(text) from public;
grant execute on function public.mi_posicion(text) to anon, authenticated;
