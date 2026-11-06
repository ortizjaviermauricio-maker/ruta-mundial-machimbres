-- La sede de la factura se toma automáticamente de su prefijo (FE, FD, STFD).
-- Así cada serie activa sus propios premios y el cliente no puede elegir una sede equivocada.

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

revoke all on function public.registrar_factura(jsonb) from public;
grant execute on function public.registrar_factura(jsonb) to anon, authenticated;
