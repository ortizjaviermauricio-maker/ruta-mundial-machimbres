-- El ranking suma las compras de cada cliente: una factura aporta aunque no alcance para un giro,
-- y una compra grande no queda limitada por el máximo de giros por factura.

create or replace function public.campana_publica() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := public._config();
begin
  return jsonb_build_object(
    'config', jsonb_build_object(
      'activa', coalesce((c->>'activa')::boolean, false),
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
          where p.estado = 'aprobada'
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
