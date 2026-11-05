-- Esquema completo y seguro de la campaña de la ruleta.
-- Regla central: el navegador público no toca tablas. Solo llama funciones que validan en el servidor.

-- ============ Tablas ============

create table public.admins (
  email text primary key check (email = lower(email)),
  rol text not null check (rol in ('admin', 'validador')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.configuracion_campana (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.patrocinadores (
  id bigint generated always as identity primary key,
  nombre text not null,
  empresa text,
  responsable text,
  telefono text,
  correo text,
  logo_url text,
  banner_url text,
  pagina_web text,
  instagram text,
  whatsapp text,
  activo boolean not null default true,
  orden integer not null default 99,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_patrocinadores_nombre on public.patrocinadores (lower(trim(nombre)));

create table public.premios (
  id uuid primary key default gen_random_uuid(),
  premio text not null,
  categoria text not null default 'producto',
  cantidad integer not null default 0 check (cantidad >= 0),
  peso numeric not null default 0 check (peso >= 0),
  visible_cliente boolean not null default true,
  entrega_premio boolean not null default true, -- false = sin límite de inventario
  activo boolean not null default true,
  patrocinador_id bigint references public.patrocinadores (id) on delete set null
);
create index idx_premios_patrocinador on public.premios (patrocinador_id);

create table public.historial_premios (
  id bigint generated always as identity primary key,
  premio_id uuid,
  premio text,
  campo_modificado text,
  valor_anterior text,
  valor_nuevo text,
  usuario text,
  created_at timestamptz not null default now()
);

create table public.participantes (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  nombre text not null check (char_length(nombre) between 1 and 120),
  apellido text check (char_length(apellido) <= 120),
  celular text not null check (celular ~ '^[0-9]{7,15}$'),
  email text check (char_length(email) <= 200),
  sede text not null,
  factura text not null unique check (factura ~ '^[A-Z]+[0-9]+$'),
  prefijo_factura text not null,
  factura_numero bigint not null,
  valor numeric not null check (valor >= 0),
  vendedor text check (char_length(vendedor) <= 120),
  puntos integer not null default 0,
  oportunidades integer not null default 0,
  usadas integer not null default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  validado_por text,
  validado_at timestamptz,
  nota_validacion text,
  token_hash text not null unique,
  version_reglamento text,
  version_autorizacion text,
  patrocinadores_ids bigint[] not null default '{}',
  marca_compra text,
  check (usadas <= oportunidades)
);
create index idx_participantes_estado on public.participantes (estado);
create index idx_participantes_celular on public.participantes (celular);

create table public.autorizaciones_datos (
  id uuid primary key default gen_random_uuid(),
  participante_id uuid references public.participantes (id) on delete cascade,
  fecha timestamptz not null default now(),
  nombre text,
  celular text,
  email text,
  factura text,
  sede text,
  acepto_tratamiento_datos boolean not null,
  acepto_reglamento boolean not null,
  version_autorizacion text,
  version_reglamento text,
  texto_autorizacion text,
  user_agent text,
  idioma_navegador text,
  plataforma text,
  origen text
);
create index idx_autorizaciones_participante on public.autorizaciones_datos (participante_id);

create table public.ganadores (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  participante_id uuid references public.participantes (id) on delete cascade,
  premio_id uuid references public.premios (id) on delete set null,
  nombre text,
  celular text,
  email text,
  factura text,
  sede text,
  vendedor text,
  premio text not null,
  es_premio boolean not null,
  estado text not null check (estado in ('sin_premio', 'pendiente', 'entregado')),
  entregado_at timestamptz,
  entregado_por text,
  nota text
);
create index idx_ganadores_participante on public.ganadores (participante_id);
create index idx_ganadores_premio on public.ganadores (premio_id);

create table public.auditoria_admin (
  id bigint generated always as identity primary key,
  usuario text not null,
  accion text not null,
  detalle text,
  created_at timestamptz not null default now()
);

create table public.backups_campana (
  id bigint generated always as identity primary key,
  tipo text not null default 'manual',
  data jsonb not null,
  usuario text,
  created_at timestamptz not null default now()
);

-- ============ Permisos de personal ============

create function public.rol_actual() returns text
language sql stable security definer set search_path = '' as $$
  select a.rol
  from public.admins a
  join auth.users u on lower(u.email) = a.email
  where u.id = auth.uid() and a.activo and u.email_confirmed_at is not null
$$;

create function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.rol_actual() = 'admin', false)
$$;

create function public.es_personal() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.rol_actual() is not null
$$;

create function public.correo_actual() returns text
language sql stable security definer set search_path = '' as $$
  select lower(u.email) from auth.users u where u.id = auth.uid()
$$;

-- ============ Seguridad de tablas ============

do $$
declare t text;
begin
  foreach t in array array['admins','configuracion_campana','patrocinadores','premios','historial_premios',
                           'participantes','autorizaciones_datos','ganadores','auditoria_admin','backups_campana']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

grant select on public.admins, public.participantes, public.ganadores, public.autorizaciones_datos,
                public.auditoria_admin to authenticated;
grant select, insert, update on public.configuracion_campana to authenticated;
grant select, insert, update, delete on public.patrocinadores, public.premios to authenticated;
grant select on public.historial_premios to authenticated;
grant select, insert on public.backups_campana to authenticated;

create policy admins_lectura on public.admins for select to authenticated using (public.es_admin());
create policy config_admin on public.configuracion_campana for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy patrocinadores_admin on public.patrocinadores for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy premios_admin on public.premios for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy historial_admin on public.historial_premios for select to authenticated using (public.es_admin());
create policy participantes_personal on public.participantes for select to authenticated using (public.es_personal());
create policy ganadores_personal on public.ganadores for select to authenticated using (public.es_personal());
create policy autorizaciones_admin on public.autorizaciones_datos for select to authenticated using (public.es_admin());
create policy auditoria_admin_lectura on public.auditoria_admin for select to authenticated using (public.es_admin());
create policy backups_admin on public.backups_campana for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ============ Utilidades internas ============

create function public._config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.configuracion_campana where key = 'principal'), '{}'::jsonb)
$$;

create function public._hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

create function public._nuevo_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create function public._normalizar_factura(p_factura text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_factura, ''), '[\s-]', '', 'g'))
$$;

create function public._calcular_oportunidades(p_valor numeric, p_config jsonb) returns integer
language sql stable set search_path = '' as $$
  select least(
    floor(p_valor / greatest(coalesce((p_config->>'valorPorOportunidad')::numeric, 1), 1))::integer,
    coalesce((p_config->>'maxOportunidades')::integer, 1)
  )
$$;

create function public._auditar(p_accion text, p_detalle text) returns void
language sql security definer set search_path = '' as $$
  insert into public.auditoria_admin (usuario, accion, detalle)
  values (coalesce(public.correo_actual(), 'sistema'), p_accion, p_detalle)
$$;

-- ============ Funciones públicas ============

create function public.campana_publica() returns jsonb
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
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', r.nombre, 'puntos', r.puntos, 'facturas', r.facturas)
                       order by r.puntos desc, r.nombre)
      from (
        select
          min(split_part(trim(p.nombre), ' ', 1)
              || case when coalesce(trim(p.apellido), '') <> '' then ' ' || left(trim(p.apellido), 1) || '.' else '' end) as nombre,
          sum(p.puntos)::integer as puntos,
          count(*)::integer as facturas
        from public.participantes p
        where p.estado = 'aprobada'
        group by p.celular
        order by 2 desc
        limit 50
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

create function public.registrar_factura(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := public._config();
  v_factura text := public._normalizar_factura(p_datos->>'factura');
  v_sede text := trim(coalesce(p_datos->>'sede', ''));
  v_nombre text := trim(coalesce(p_datos->>'nombre', ''));
  v_apellido text := trim(coalesce(p_datos->>'apellido', ''));
  v_celular text := regexp_replace(coalesce(p_datos->>'celular', ''), '\D', '', 'g');
  v_email text := lower(nullif(trim(coalesce(p_datos->>'correo', '')), ''));
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
begin
  if not coalesce((c->>'activa')::boolean, false)
     or now() < coalesce((c->>'fechaInicio')::timestamptz, '-infinity')
     or now() > coalesce((c->>'fechaFin')::timestamptz, 'infinity') then
    raise exception 'La campaña no está abierta en este momento.' using errcode = 'P0001';
  end if;
  if not coalesce((p_datos->>'autorizacion')::boolean, false) then
    raise exception 'Debe aceptar el tratamiento de datos personales y el reglamento.' using errcode = 'P0001';
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

  if (select count(*) from public.participantes p where p.celular = v_celular and p.estado = 'pendiente') >= 5 then
    raise exception 'Este celular tiene varias facturas por validar. Acérquese a la caja.' using errcode = 'P0001';
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
      puntos, oportunidades, token_hash, version_reglamento, version_autorizacion, patrocinadores_ids, marca_compra
    ) values (
      v_nombre, nullif(v_apellido, ''), v_celular, v_email, v_sede, v_factura, v_prefijo, v_numero, v_valor,
      left(nullif(trim(coalesce(p_datos->>'vendedor', '')), ''), 120),
      v_puntos, v_oportunidades, public._hash_token(v_token), c->>'reglamento', c->>'autorizacion',
      v_patrocinadores, v_marcas
    ) returning id into v_id;
  exception when unique_violation then
    raise exception 'Esta factura ya fue registrada.' using errcode = 'P0001';
  end;

  insert into public.autorizaciones_datos (
    participante_id, nombre, celular, email, factura, sede, acepto_tratamiento_datos, acepto_reglamento,
    version_autorizacion, version_reglamento, texto_autorizacion, user_agent, idioma_navegador, plataforma, origen
  ) values (
    v_id, trim(v_nombre || ' ' || v_apellido), v_celular, v_email, v_factura, v_sede, true, true,
    c->>'autorizacion', c->>'reglamento', c->>'textoAutorizacion',
    left(p_datos->>'userAgent', 500), left(p_datos->>'idioma', 40), left(p_datos->>'plataforma', 80), left(p_datos->>'origen', 300)
  );

  return jsonb_build_object('token', v_token, 'factura', v_factura, 'oportunidades', v_oportunidades,
                            'puntos', v_puntos, 'estado', 'pendiente');
end;
$$;

create function public.estado_factura(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'factura', p.factura, 'estado', p.estado, 'nota', p.nota_validacion,
    'restantes', case when p.estado = 'aprobada' then p.oportunidades - p.usadas else 0 end,
    'oportunidades', p.oportunidades, 'marcas', p.marca_compra
  )
  from public.participantes p
  where p.token_hash = public._hash_token(p_token)
$$;

-- Permite retomar los giros desde otro celular o si se borró el navegador.
create function public.recuperar_factura(p_factura text, p_celular text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := public._nuevo_token();
begin
  update public.participantes
  set token_hash = public._hash_token(v_token)
  where factura = public._normalizar_factura(p_factura)
    and celular = regexp_replace(coalesce(p_celular, ''), '\D', '', 'g');
  if not found then
    raise exception 'No encontramos una factura con ese celular.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('token', v_token);
end;
$$;

create function public.girar(p_token text) returns jsonb
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

-- ============ Funciones del personal ============

create function public.validar_factura(p_id uuid, p_aprobar boolean, p_valor numeric default null, p_nota text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := public._config();
  v_participante public.participantes;
  v_valor numeric;
  v_oportunidades integer;
begin
  if not public.es_personal() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  select * into v_participante from public.participantes where id = p_id for update;
  if not found then
    raise exception 'Factura no encontrada.' using errcode = 'P0001';
  end if;
  if v_participante.usadas > 0 then
    raise exception 'Esta factura ya tiene giros usados y no se puede cambiar.' using errcode = 'P0001';
  end if;

  v_valor := coalesce(p_valor, v_participante.valor);
  if p_aprobar and v_valor < coalesce((c->>'compraMinima')::numeric, 0) then
    raise exception 'El valor confirmado no alcanza la compra mínima.' using errcode = 'P0001';
  end if;
  v_oportunidades := public._calcular_oportunidades(v_valor, c);

  update public.participantes set
    estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
    valor = v_valor,
    oportunidades = v_oportunidades,
    puntos = v_oportunidades * coalesce((c->>'puntosPorOportunidad')::integer, 0),
    validado_por = public.correo_actual(),
    validado_at = now(),
    nota_validacion = left(p_nota, 300)
  where id = p_id;

  perform public._auditar(
    case when p_aprobar then 'Factura aprobada' else 'Factura rechazada' end,
    v_participante.factura || ' / valor digitado: ' || v_participante.valor || ' / valor confirmado: ' || v_valor
  );
  return jsonb_build_object('ok', true, 'oportunidades', v_oportunidades);
end;
$$;

create function public.marcar_entrega(p_ganador uuid, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_premio text;
  v_factura text;
begin
  if not public.es_personal() then
    raise exception 'No autorizado.' using errcode = '42501';
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

create function public.registrar_auditoria(p_accion text, p_detalle text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_personal() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  perform public._auditar(left(p_accion, 120), left(p_detalle, 1000));
end;
$$;

-- Reemplaza todos los premios en una sola transacción: si algo falla, los anteriores siguen intactos.
create function public.reemplazar_premios(p_premios jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
begin
  if not public.es_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  delete from public.premios where true;
  insert into public.premios (premio, categoria, cantidad, peso, visible_cliente, entrega_premio, activo, patrocinador_id)
  select r.premio, coalesce(r.categoria, 'producto'), coalesce(r.cantidad, 0), coalesce(r.peso, 0),
         coalesce(r.visible_cliente, true), coalesce(r.entrega_premio, true), coalesce(r.activo, true), r.patrocinador_id
  from jsonb_to_recordset(p_premios) as r(
    premio text, categoria text, cantidad integer, peso numeric, visible_cliente boolean,
    entrega_premio boolean, activo boolean, patrocinador_id bigint
  );
  get diagnostics v_total = row_count;
  perform public._auditar('Premios reemplazados', v_total || ' premios cargados.');
  return v_total;
end;
$$;

create function public.reiniciar_campana(p_confirmacion text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_admin() then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  if p_confirmacion is distinct from 'BORRAR TODO' then
    raise exception 'Confirmación incorrecta.' using errcode = 'P0001';
  end if;
  delete from public.ganadores where true;
  delete from public.autorizaciones_datos where true;
  delete from public.participantes where true;
  perform public._auditar('Reinicio de campaña', 'Se borraron participantes, autorizaciones y resultados.');
  return jsonb_build_object('ok', true);
end;
$$;

-- ============ Ejecución de funciones ============

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;
end $$;

grant execute on function
  public.campana_publica(), public.registrar_factura(jsonb), public.estado_factura(text),
  public.recuperar_factura(text, text), public.girar(text)
to anon, authenticated;

grant execute on function
  public.rol_actual(), public.es_admin(), public.es_personal(),
  public.validar_factura(uuid, boolean, numeric, text), public.marcar_entrega(uuid, text),
  public.registrar_auditoria(text, text), public.reemplazar_premios(jsonb), public.reiniciar_campana(text)
to authenticated;

-- ============ Datos iniciales ============

insert into public.admins (email, rol) values ('ortiz.javiermauricio@hotmail.com', 'admin');

insert into public.configuracion_campana (key, value) values ('principal', jsonb_build_object(
  'activa', false,
  'fechaInicio', null,
  'fechaFin', null,
  'compraMinima', 500000,
  'valorPorOportunidad', 1000000,
  'puntosPorOportunidad', 5000,
  'maxOportunidades', 5,
  'unPremioPorFactura', true,
  'ultimaFacturaFE', 31135,
  'ultimaFacturaFD', 13065,
  'ultimaFacturaSTFD', 2207,
  'whatsapp', '317 636 6356',
  'habeas', 'habeasdata@machimbresymaderas.com',
  'reglamento', 'ANIV39-PENDIENTE',
  'autorizacion', 'SIGPDP-AUT-ANIV39-PENDIENTE',
  'textoAutorizacion', 'Acepta tratamiento de datos personales y reglamento de la campaña 39 años de Machimbres y Maderas.',
  'sedes', jsonb_build_array(
    jsonb_build_object('nombre', 'Machimbres y Maderas S.A.S.', 'prefijo', 'FE'),
    jsonb_build_object('nombre', 'DEKO LÁMINAS', 'prefijo', 'FD'),
    jsonb_build_object('nombre', 'Satélite', 'prefijo', 'STFD')
  )
));
