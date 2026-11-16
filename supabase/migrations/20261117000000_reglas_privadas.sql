-- Las reglas internas de entrega (un premio por cliente) no se publican: solo las conoce el administrador.
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

