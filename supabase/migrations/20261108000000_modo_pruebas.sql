-- Modo pruebas privado, borrado de sus datos y autorización de datos solo para clientes nuevos.

alter table public.participantes add column prueba boolean not null default false;
create index idx_participantes_prueba on public.participantes (prueba) where prueba;
create index idx_autorizaciones_celular on public.autorizaciones_datos (celular);

update public.configuracion_campana
set value = value || '{"modoPruebas": false}'::jsonb
where key = 'principal';

-- Una autorización sirve mientras sea de la versión vigente; si cambia la versión, se vuelve a pedir.
create function public._tiene_autorizacion(p_celular text, p_config jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.autorizaciones_datos a
    where a.celular = p_celular and a.acepto_tratamiento_datos
      and a.version_autorizacion is not distinct from p_config->>'autorizacion'
  )
$$;

create function public.autorizacion_vigente(p_celular text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._tiene_autorizacion(regexp_replace(coalesce(p_celular, ''), '\D', '', 'g'), public._config())
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
      'whatsapp', c->>'whatsapp',
      'habeas', c->>'habeas',
      'reglamento', c->>'reglamento',
      'autorizacion', c->>'autorizacion',
      'sedes', coalesce(c->'sedes', '[]'::jsonb)
    ),
    'premios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.premio, 'categoria', p.categoria,
        'stock', p.cantidad, 'ilimitado', not p.entrega_premio
      ) order by p.premio)
      from public.premios p
      where p.activo and p.visible_cliente
    ), '[]'::jsonb),
    'patrocinadores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'nombre', s.nombre, 'logo_url', s.logo_url, 'pagina_web', s.pagina_web,
        'instagram', s.instagram, 'whatsapp', s.whatsapp
      ) order by s.orden, s.id)
      from public.patrocinadores s
      where s.activo
    ), '[]'::jsonb),
    -- Ranking sin celular, correo ni factura: solo primer nombre e inicial.
    -- Los puntos salen de la compra acumulada por cliente, sin el tope de giros por factura.
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', r.nombre, 'puntos', r.puntos, 'facturas', r.facturas) order by r.posicion)
      from (
        select a.nombre, a.puntos, a.facturas,
               row_number() over (order by a.puntos desc, a.total desc, a.ultima, a.celular) as posicion
        from (
          select
            p.celular,
            (array_agg(split_part(trim(p.nombre), ' ', 1)
              || case when coalesce(trim(p.apellido), '') <> '' then ' ' || left(trim(p.apellido), 1) || '.' else '' end
              order by p.fecha desc))[1] as nombre,
            floor(sum(p.valor) / greatest(coalesce((c->>'valorPorOportunidad')::numeric, 1), 1))::bigint
              * coalesce((c->>'puntosPorOportunidad')::bigint, 0) as puntos,
            sum(p.valor) as total,
            max(p.fecha) as ultima,
            count(*)::integer as facturas
          from public.participantes p
          where p.estado = 'aprobada' and (not p.prueba or coalesce((c->>'modoPruebas')::boolean, false))
          group by p.celular
        ) a
        where a.puntos > 0
        order by posicion
        limit 50
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.registrar_factura(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := public._config();
  v_factura text := public._normalizar_factura(p_datos->>'factura');
  v_sede text := trim(coalesce(p_datos->>'sede', ''));
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
  v_token text := public._nuevo_token();
  v_id uuid;
  v_prueba boolean := coalesce((c->>'modoPruebas')::boolean, false);
  v_autoriza boolean := coalesce((p_datos->>'autorizacion')::boolean, false);
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
  if v_nombre = '' or char_length(v_nombre) > 120 or char_length(v_apellido) > 120 then
    raise exception 'Revise el nombre y el apellido.' using errcode = 'P0001';
  end if;
  if v_celular !~ '^[0-9]{7,15}$' then
    raise exception 'Digite un celular válido.' using errcode = 'P0001';
  end if;
  if v_email is not null and (char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Digite un correo válido o déjelo vacío.' using errcode = 'P0001';
  end if;

  select s->>'prefijo' into v_prefijo
  from jsonb_array_elements(coalesce(c->'sedes', '[]'::jsonb)) s
  where s->>'nombre' = v_sede;
  if v_prefijo is null then
    raise exception 'Seleccione una sede válida.' using errcode = 'P0001';
  end if;
  if v_factura !~ ('^' || v_prefijo || '[0-9]{1,15}$') then
    raise exception 'La sede seleccionada exige facturas con prefijo %, seguido del número. Ejemplo: %28501.', v_prefijo, v_prefijo
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

  select coalesce(array_agg(s.id order by s.orden), '{}'), string_agg(s.nombre, ', ' order by s.orden)
  into v_patrocinadores, v_marcas
  from public.patrocinadores s
  where s.activo and s.id::text in (select jsonb_array_elements_text(coalesce(p_datos->'patrocinadorIds', '[]'::jsonb)));

  v_oportunidades := public._calcular_oportunidades(v_valor, c);
  v_puntos := v_oportunidades * coalesce((c->>'puntosPorOportunidad')::integer, 0);

  begin
    insert into public.participantes (
      nombre, apellido, celular, email, sede, factura, prefijo_factura, factura_numero, valor, vendedor,
      puntos, oportunidades, estado, token_hash, version_reglamento, version_autorizacion, patrocinadores_ids, marca_compra, prueba
    ) values (
      v_nombre, nullif(v_apellido, ''), v_celular, v_email, v_sede, v_factura, v_prefijo, v_numero, v_valor,
      left(nullif(trim(coalesce(p_datos->>'vendedor', '')), ''), 120),
      v_puntos, v_oportunidades, v_estado, public._hash_token(v_token), c->>'reglamento', c->>'autorizacion',
      v_patrocinadores, v_marcas, v_prueba
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'Esta factura ya fue registrada.' using errcode = 'P0001';
  end;

  insert into public.autorizaciones_datos (
    participante_id, nombre, celular, email, factura, sede, acepto_tratamiento_datos, acepto_reglamento,
    version_autorizacion, version_reglamento, texto_autorizacion, user_agent, idioma_navegador, plataforma, origen
  ) values (
    v_id, trim(v_nombre || ' ' || v_apellido), v_celular, v_email, v_factura, v_sede, v_autoriza, v_reglamento,
    case when v_autoriza then c->>'autorizacion' end, c->>'reglamento', case when v_autoriza then c->>'textoAutorizacion' end,
    left(p_datos->>'userAgent', 500), left(p_datos->>'idioma', 40), left(p_datos->>'plataforma', 80), left(p_datos->>'origen', 300)
  );

  return jsonb_build_object('token', v_token, 'factura', v_factura, 'oportunidades', v_oportunidades,
                            'puntos', v_puntos, 'estado', v_estado);
end;
$$;

-- Solo borra lo registrado en modo pruebas y devuelve al inventario los premios ganados en esas pruebas.
create function public.borrar_datos_prueba() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
begin
  if not public.es_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update public.premios pr set cantidad = pr.cantidad + d.ganados
  from (
    select g.premio_id, count(*)::integer as ganados
    from public.ganadores g
    join public.participantes p on p.id = g.participante_id
    where p.prueba and g.es_premio and g.estado <> 'anulado' and g.premio_id is not null
    group by g.premio_id
  ) d
  where pr.id = d.premio_id and pr.entrega_premio;
  delete from public.participantes where prueba;
  get diagnostics v_total = row_count;
  perform public._auditar('Datos de prueba borrados', v_total || ' facturas de prueba.');
  return jsonb_build_object('facturas', v_total);
end;
$$;

revoke all on function public._tiene_autorizacion(text, jsonb) from public, anon, authenticated;
revoke all on function public.autorizacion_vigente(text) from public;
grant execute on function public.autorizacion_vigente(text) to anon, authenticated;
revoke all on function public.borrar_datos_prueba() from public, anon, authenticated;
grant execute on function public.borrar_datos_prueba() to authenticated;
revoke all on function public.registrar_factura(jsonb) from public;
grant execute on function public.registrar_factura(jsonb) to anon, authenticated;
revoke all on function public.campana_publica() from public;
grant execute on function public.campana_publica() to anon, authenticated;
