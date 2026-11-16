-- Ley 1581 de 2012: autorización obligatoria solo para la campaña; mercadeo y WhatsApp comercial
-- en una casilla aparte y voluntaria; declaración de mayoría de edad (Ley 643 de 2001, art. 4 b).

alter table public.autorizaciones_datos
  add column if not exists acepto_mercadeo boolean not null default false,
  add column if not exists texto_mercadeo text,
  add column if not exists declara_mayor_edad boolean;
alter table public.autorizaciones_datos alter column finalidades set default array['campanas'];

update public.configuracion_campana
set value = value || jsonb_build_object(
  'reglamento', 'ANIV39-V1',
  'autorizacion', 'ANIV39-DATOS-V1',
  'textoAutorizacion',
  'Autorizo a Machimbres y Maderas S.A.S. a tratar mis datos personales para registrar mi participación en la campaña «Cada lámina cuenta – 39 años», validar mis facturas, asignar giros y puntos, contactarme sobre mis premios y el ranking, entregar premios, prevenir fraudes y atender requerimientos de autoridades, según la política de tratamiento de datos de la campaña. Sé que puedo conocer, actualizar, rectificar y suprimir mis datos y revocar esta autorización.',
  'textoMercadeo',
  'Además, autorizo de forma voluntaria que Machimbres y Maderas S.A.S. me envíe información comercial, promociones y encuestas por WhatsApp, mensaje de texto, llamada o correo. Esta casilla es opcional y no afecta mi participación.'
)
where key = 'principal';

-- La lógica de registro existente queda como función interna; la pública agrega las nuevas validaciones.
alter function public.registrar_factura(jsonb) rename to _registrar_factura_base;
revoke all on function public._registrar_factura_base(jsonb) from public, anon, authenticated;

create function public.registrar_factura(p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb := public._config();
  v_mayor boolean := coalesce((p_datos->>'mayorEdad')::boolean, false);
  v_mercadeo boolean := coalesce((p_datos->>'aceptaMercadeo')::boolean, false);
  r jsonb;
begin
  if not v_mayor then
    raise exception 'Para participar debes ser mayor de 18 años.' using errcode = 'P0001';
  end if;
  r := public._registrar_factura_base(p_datos);
  update public.autorizaciones_datos a
  set declara_mayor_edad = true,
      acepto_mercadeo = a.acepto_tratamiento_datos and v_mercadeo,
      texto_mercadeo = case when a.acepto_tratamiento_datos and v_mercadeo then c->>'textoMercadeo' end,
      finalidades = case when a.acepto_tratamiento_datos and v_mercadeo
                         then array['campanas', 'marketing', 'whatsapp'] else array['campanas'] end
  from public.participantes p
  where p.token_hash = public._hash_token(r->>'token') and a.participante_id = p.id;
  return r;
end;
$$;
revoke all on function public.registrar_factura(jsonb) from public;
grant execute on function public.registrar_factura(jsonb) to anon, authenticated;

-- El formulario muestra los dos textos vigentes.
create or replace function public.texto_mercadeo() returns text
language sql stable security definer set search_path = '' as $$
  select public._config()->>'textoMercadeo'
$$;
revoke all on function public.texto_mercadeo() from public;
grant execute on function public.texto_mercadeo() to anon, authenticated;
