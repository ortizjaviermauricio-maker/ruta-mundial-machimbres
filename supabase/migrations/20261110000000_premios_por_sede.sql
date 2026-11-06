-- Inventario de la ruleta por sede. El ranking sigue siendo general y no cambia.
-- sede NULL = premio general (participa en todas las sedes).
-- sede con valor = nombre exacto de una sede de configuracion_campana; solo sale en facturas de esa sede.

alter table public.premios add column sede text;
create index idx_premios_sede on public.premios (sede) where sede is not null;

-- Normaliza y valida la sede solo cuando se crea el premio o se cambia su sede.
-- Los descuentos de inventario (update de cantidad) no pasan por esta validación.
create function public._validar_sede_premio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.sede := nullif(trim(coalesce(new.sede, '')), '');
  if new.sede is not null and lower(new.sede) = 'general' then
    new.sede := null;
  end if;
  if new.sede is null or (tg_op = 'UPDATE' and new.sede is not distinct from old.sede) then
    return new;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce(public._config()->'sedes', '[]'::jsonb)) s
    where s->>'nombre' = new.sede
  ) then
    raise exception 'La sede "%" del premio "%" no existe en la configuración.', new.sede, new.premio
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger premios_validar_sede before insert or update of sede on public.premios
for each row execute function public._validar_sede_premio();

-- El historial de cambios también registra la sede.
create or replace function public._registrar_cambio_premio() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_campo text;
begin
  if auth.uid() is null then
    return new;
  end if;
  foreach v_campo in array array['premio', 'categoria', 'cantidad', 'peso', 'visible_cliente', 'entrega_premio', 'patrocinador_id', 'sede']
  loop
    if (to_jsonb(old)->>v_campo) is distinct from (to_jsonb(new)->>v_campo) then
      insert into public.historial_premios (premio_id, premio, campo_modificado, valor_anterior, valor_nuevo, usuario)
      values (new.id, new.premio, v_campo, to_jsonb(old)->>v_campo, to_jsonb(new)->>v_campo, public.correo_actual());
    end if;
  end loop;
  return new;
end;
$$;

-- Igual que la versión anterior, más el filtro por sede de la factura.
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

  v_ya_gano := exists (select 1 from public.ganadores g where g.participante_id = v_participante.id and g.es_premio);
  v_solo_sin_premio := v_ya_gano and coalesce((c->>'unPremioPorFactura')::boolean, true);

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

-- Acepta "sede" (vacío o "General" = premio general). Una sede inexistente aborta todo el reemplazo.
create or replace function public.reemplazar_premios(p_premios jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
begin
  if not public.es_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  delete from public.premios where true;
  insert into public.premios (premio, categoria, cantidad, peso, visible_cliente, entrega_premio, activo, patrocinador_id, sede)
  select r.premio, coalesce(r.categoria, 'producto'), coalesce(r.cantidad, 0), coalesce(r.peso, 0),
         coalesce(r.visible_cliente, true), coalesce(r.entrega_premio, true), coalesce(r.activo, true), r.patrocinador_id,
         r.sede
  from jsonb_to_recordset(p_premios) as r(
    premio text, categoria text, cantidad integer, peso numeric, visible_cliente boolean,
    entrega_premio boolean, activo boolean, patrocinador_id bigint, sede text
  );
  get diagnostics v_total = row_count;
  perform public._auditar('Premios reemplazados', v_total || ' premios cargados.');
  return v_total;
end;
$$;

-- Igual que la versión vigente (20261108000000), más la sede de cada premio visible.
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
        'stock', p.cantidad, 'ilimitado', not p.entrega_premio, 'sede', p.sede
      ) order by p.sede nulls first, p.premio)
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

-- create or replace conserva los permisos, pero se reafirman para que la migración sea autosuficiente.
revoke all on function public._validar_sede_premio() from public, anon, authenticated;
revoke all on function public._registrar_cambio_premio() from public, anon, authenticated;
revoke all on function public.girar(text) from public;
grant execute on function public.girar(text) to anon, authenticated;
revoke all on function public.reemplazar_premios(jsonb) from public, anon;
grant execute on function public.reemplazar_premios(jsonb) to authenticated;
revoke all on function public.campana_publica() from public;
grant execute on function public.campana_publica() to anon, authenticated;
