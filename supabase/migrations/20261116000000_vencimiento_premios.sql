-- Plazo para reclamar premios: pasado el plazo, el premio se pierde y vuelve a la ruleta.
-- El plazo se configura en el panel (diasReclamo, por defecto 8 días calendario) y vence
-- al final del último día, hora de Colombia. Un premio vencido sigue contando como
-- "ya ganó" para la regla de un premio por cliente, y la factura sigue en el ranking.

alter table public.ganadores add column if not exists vence_at timestamptz;
alter table public.ganadores drop constraint if exists ganadores_estado_check;
alter table public.ganadores add constraint ganadores_estado_check
  check (estado in ('sin_premio', 'pendiente', 'entregado', 'anulado', 'vencido'));
create index if not exists idx_ganadores_vence on public.ganadores (vence_at) where estado = 'pendiente';

update public.configuracion_campana
set value = value || '{"diasReclamo": 8}'::jsonb
where key = 'principal' and not (value ? 'diasReclamo');

create or replace function public._dias_reclamo(c jsonb) returns integer
language sql immutable set search_path = '' as $$
  select greatest(coalesce(nullif(c->>'diasReclamo', '')::integer, 8), 1)
$$;

-- Fin del último día del plazo en Colombia. Ej.: gana el 17 de nov, reclama hasta el 25 de nov a medianoche.
create or replace function public._fecha_vencimiento(c jsonb) returns timestamptz
language sql stable set search_path = '' as $$
  select (((now() at time zone 'America/Bogota')::date + public._dias_reclamo(c) + 1)::timestamp)
         at time zone 'America/Bogota'
$$;

-- Premios pendientes con plazo cumplido pasan a "vencido" y su unidad vuelve al inventario.
create or replace function public._vencer_premios() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  with vencidos as (
    update public.ganadores g
    set estado = 'vencido', entregado_at = now(), entregado_por = 'sistema',
        nota = 'No reclamado dentro del plazo'
    where g.es_premio and g.estado = 'pendiente' and g.vence_at is not null and g.vence_at <= now()
    returning g.premio_id
  ), por_premio as (
    select premio_id, count(*)::integer as n from vencidos where premio_id is not null group by premio_id
  ), devueltos as (
    update public.premios p set cantidad = p.cantidad + pp.n
    from por_premio pp
    where p.id = pp.premio_id and p.entrega_premio
    returning pp.n
  )
  select coalesce((select sum(n) from por_premio), 0)::integer into v_n;
  if v_n > 0 then
    perform public._auditar('Premios vencidos', v_n || ' premio(s) no reclamados volvieron a la ruleta');
  end if;
  return v_n;
end;
$$;
revoke all on function public._vencer_premios() from public, anon, authenticated;

-- El panel la llama al cargar, para ver los vencidos al día.
create or replace function public.vencer_premios() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_personal() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  return public._vencer_premios();
end;
$$;
revoke all on function public.vencer_premios() from public, anon;
grant execute on function public.vencer_premios() to authenticated;

-- Entregar un premio vencido no está permitido.
create or replace function public.marcar_entrega(p_ganador uuid, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_premio text;
  v_factura text;
  v_estado text;
  v_vence timestamptz;
begin
  if not public.es_personal() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  -- Una excepción revierte todo, así que aquí solo se rechaza; el paso a "vencido" lo hacen
  -- el siguiente giro o el panel al cargar.
  select estado, vence_at into v_estado, v_vence from public.ganadores where id = p_ganador and es_premio;
  if v_estado = 'vencido' or (v_estado = 'pendiente' and v_vence is not null and v_vence <= now()) then
    raise exception 'El plazo para reclamar este premio venció el %. No se puede entregar.',
      to_char((v_vence at time zone 'America/Bogota') - interval '1 second', 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  update public.ganadores
  set estado = 'entregado', entregado_at = now(), entregado_por = public.correo_actual(), nota = left(p_nota, 300)
  where id = p_ganador and es_premio and estado = 'pendiente'
  returning premio, factura into v_premio, v_factura;
  if not found then
    raise exception 'Este premio ya fue entregado o no existe.' using errcode = 'P0001';
  end if;
  perform public._auditar('Premio entregado', v_premio || ' / ' || v_factura);
  return jsonb_build_object('ok', true);
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
  v_vence timestamptz;
begin
  if not coalesce((c->>'activa')::boolean, false) then
    raise exception 'La campaña no está abierta en este momento.' using errcode = 'P0001';
  end if;

  -- Premios no reclamados a tiempo vuelven al inventario antes de sortear.
  perform public._vencer_premios();

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
  v_vence := case when v_es_premio then public._fecha_vencimiento(c) end;

  update public.participantes set usadas = usadas + 1 where id = v_participante.id;

  insert into public.ganadores (
    participante_id, premio_id, nombre, celular, email, factura, sede, vendedor, premio, es_premio, estado, vence_at
  ) values (
    v_participante.id, v_premio.id, trim(v_participante.nombre || ' ' || coalesce(v_participante.apellido, '')),
    v_participante.celular, v_participante.email, v_participante.factura, v_participante.sede,
    v_participante.vendedor, v_premio.premio, v_es_premio, case when v_es_premio then 'pendiente' else 'sin_premio' end, v_vence
  );

  return jsonb_build_object(
    'premio', v_premio.premio, 'es_premio', v_es_premio,
    'restantes', v_participante.oportunidades - v_participante.usadas - 1,
    'vence_at', v_vence, 'dias_reclamo', public._dias_reclamo(c)
  );
end;
$$;

revoke all on function public.girar(text) from public;
grant execute on function public.girar(text) to anon, authenticated;

-- El público ve el plazo para reclamar (texto de reglas).
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
      'diasReclamo', public._dias_reclamo(c),
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

