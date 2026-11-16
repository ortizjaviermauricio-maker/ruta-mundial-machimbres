-- Sin límite de facturas por celular al día: entre más compre el cliente, mejor.
-- Queda opcional en la configuración (maxFacturasDia); vacío o 0 = sin límite.
do $do$
declare
  d text := pg_get_functiondef('public._registrar_factura_base(jsonb)'::regprocedure);
  viejo text := $v$  if (select count(*) from public.participantes p
      where p.celular = v_celular and p.fecha > now() - interval '1 day') >= 10 then$v$;
  nuevo text := $n$  if coalesce(nullif(c->>'maxFacturasDia', '')::integer, 0) > 0 and (select count(*) from public.participantes p
      where p.celular = v_celular and p.fecha > now() - interval '1 day') >= (c->>'maxFacturasDia')::integer then$n$;
begin
  if position(viejo in d) = 0 then
    raise exception 'No se encontró el límite diario en _registrar_factura_base';
  end if;
  execute replace(d, viejo, nuevo);
end
$do$;
