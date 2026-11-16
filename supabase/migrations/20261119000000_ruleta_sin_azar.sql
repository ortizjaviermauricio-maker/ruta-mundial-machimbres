-- Ruleta de entretenimiento, sin azar: cada factura desde el valor del giro da un giro, y el obsequio
-- lo define el valor de la factura (rango del premio), hasta agotar existencias por sede.
-- Un obsequio por cliente en la campaña. Con modoObsequio apagado se vuelve al sorteo por pesos.

alter table public.premios add column if not exists compra_minima numeric not null default 0;

update public.premios set compra_minima = case
  when premio ilike 'Taladro%' then 7500000
  when premio ilike 'Metro láser%' then 5000000
  when premio ilike 'Nivelador%' then 3000000
  else 1500000 end
where entrega_premio;

update public.configuracion_campana
set value = value || '{"modoObsequio": true, "maxOportunidades": 1}'::jsonb
where key = 'principal';

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
  v_obsequio boolean := coalesce((c->>'modoObsequio')::boolean, false);
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

  if v_obsequio then
    -- Sin azar: el obsequio lo define el valor de la factura. Se entrega el de mayor rango que la factura
    -- alcanza y que tenga existencias en su sede; si no hay, el siguiente rango hacia abajo.
    loop
      v_premio := null;
      if not v_solo_sin_premio then
        select p.* into v_premio
        from public.premios p
        where p.activo and p.entrega_premio and p.cantidad > 0
          and not (p.id = any (v_excluidos))
          and p.compra_minima <= v_participante.valor
          and (p.patrocinador_id is null or p.patrocinador_id = any (v_participante.patrocinadores_ids))
          and (p.sede is null or p.sede = v_participante.sede)
          and lower(trim(p.premio)) <> 'sigue intentando'
        order by p.compra_minima desc, p.cantidad desc, p.premio, p.id
        limit 1;
      end if;
      if v_premio.id is null then
        select p.* into v_premio from public.premios p
        where lower(trim(p.premio)) = 'sigue intentando' order by p.activo desc limit 1;
        if v_premio.id is null then
          raise exception 'No hay obsequios configurados. Avise al personal de la tienda.' using errcode = 'P0001';
        end if;
        exit;
      end if;
      update public.premios set cantidad = cantidad - 1 where id = v_premio.id and cantidad > 0;
      exit when found;
      v_excluidos := v_excluidos || v_premio.id;
    end loop;
  else
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
  end if;

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
      'diasReclamo', public._dias_reclamo(c),
      'modoObsequio', coalesce((c->>'modoObsequio')::boolean, false),
      'whatsapp', c->>'whatsapp',
      'habeas', c->>'habeas',
      'reglamento', c->>'reglamento',
      'autorizacion', c->>'autorizacion',
      'sedes', coalesce(c->'sedes', '[]'::jsonb)
    ),
    'premios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.premio, 'categoria', p.categoria,
        'stock', p.cantidad, 'ilimitado', not p.entrega_premio, 'sede', p.sede, 'desde', p.compra_minima
      ) order by p.sede nulls first, p.compra_minima, p.premio)
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


update public.configuracion_campana set value = value || '{"reglamento": "ANIV39-V2"}'::jsonb where key = 'principal';
