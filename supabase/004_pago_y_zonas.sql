-- 004 · Forma de pago, seña y zonas de envío
-- Se corre una vez en Supabase → SQL Editor (después de 003_metricas.sql).
--   · Cada pedido guarda la forma de pago: transferencia (100% antes) o efectivo (seña por
--     transferencia y el resto al recibir), cuánto se transfiere y cuánto queda en efectivo.
--   · Los envíos piden la zona; cada zona tiene su costo (Panel → Ajustes → Zonas de envío).
--   · El panel puede marcar que llegó la transferencia.

alter table pedidos
  add column if not exists zona text not null default '',
  add column if not exists pago text not null default 'transferencia' check (pago in ('transferencia', 'efectivo')),
  add column if not exists sena integer not null default 0,
  add column if not exists saldo integer not null default 0,
  add column if not exists pago_recibido boolean not null default false;

insert into ajustes (clave, valor) values
  ('zonas', '[{"nombre":"La Plata","costo":0},{"nombre":"Los Porteños","costo":0},{"nombre":"City Bell","costo":0},{"nombre":"Villa Elisa","costo":0},{"nombre":"Gonnet","costo":0},{"nombre":"Tolosa","costo":0},{"nombre":"Ringuelet","costo":0}]'),
  ('datos_transferencia', '""'),
  ('sena_porcentaje', '50')
on conflict (clave) do nothing;

create or replace function ajustes_publicos() returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(clave, valor), '{}'::jsonb)
  from ajustes
  where clave in ('pedidos_mediodia', 'pedidos_finde', 'franjas_mediodia', 'franjas_finde',
                  'dias_adelante', 'anticipacion_horas', 'costo_envio', 'whatsapp', 'instagram',
                  'textos', 'aviso', 'zonas', 'datos_transferencia', 'sena_porcentaje')
$$;

create or replace function crear_pedido(p jsonb) returns jsonb language plpgsql as $$
declare
  tz           constant text := 'America/Argentina/Buenos_Aires';
  v_nombre     text := btrim(coalesce(p->>'nombre', ''));
  v_telefono   text := regexp_replace(coalesce(p->>'telefono', ''), '[^0-9+]', '', 'g');
  v_horario    text := btrim(coalesce(p->>'horario', ''));
  v_modalidad  text := coalesce(p->>'modalidad', '');
  v_direccion  text := btrim(coalesce(p->>'direccion', ''));
  v_notas      text := btrim(coalesce(p->>'notas', ''));
  v_pago       text := coalesce(p->>'pago', '');
  v_zona       text := btrim(coalesce(p->>'zona', ''));
  v_zonas      jsonb := coalesce(ajuste('zonas'), '[]'::jsonb);
  v_total      int;
  v_sena       int;
  v_fecha      date;
  v_turno      text;
  v_hoy        date := hoy_ar();
  v_items      jsonb := '[]'::jsonb;
  v_subtotal   int := 0;
  v_envio      int := 0;
  v_pedido     pedidos;
  r            record;
  v_prod       record;
begin
  if length(v_nombre) < 2 or length(v_nombre) > 80 then
    raise exception 'Escribí tu nombre';
  end if;
  if length(regexp_replace(v_telefono, '\D', '', 'g')) not between 8 and 15 then
    raise exception 'Revisá el teléfono: tiene que tener el código de área';
  end if;
  if v_modalidad not in ('retiro', 'envio') then
    raise exception 'Elegí si lo retirás o te lo enviamos';
  end if;
  if v_modalidad = 'envio' and length(v_direccion) < 5 then
    raise exception 'Escribí la dirección de entrega';
  end if;
  if v_modalidad = 'envio' and length(v_zona) < 2 then
    raise exception 'Elegí la zona de entrega';
  end if;
  if v_pago not in ('transferencia', 'efectivo') then
    raise exception 'Elegí cómo vas a pagar';
  end if;
  if length(v_direccion) > 200 or length(v_notas) > 300 then
    raise exception 'La dirección o las notas son demasiado largas';
  end if;

  begin
    v_fecha := (p->>'fecha')::date;
  exception when others then
    raise exception 'Elegí el día';
  end;
  if v_fecha is null then raise exception 'Elegí el día'; end if;
  v_turno := turno_de(v_fecha);

  if not coalesce((ajuste('pedidos_' || v_turno))::boolean, false) then
    raise exception '%', case v_turno when 'mediodia' then 'Los pedidos de pokes están cerrados por ahora'
                                      else 'Los pedidos del finde están cerrados por ahora' end;
  end if;
  if v_fecha < v_hoy or v_fecha > v_hoy + coalesce((ajuste('dias_adelante'))::int, 7) then
    raise exception 'Ese día no se puede pedir todavía';
  end if;
  if not coalesce(ajuste('franjas_' || v_turno), '[]'::jsonb) ? v_horario then
    raise exception 'Elegí un horario de la lista';
  end if;
  if ((v_fecha + v_horario::time) at time zone tz)
     < now() + make_interval(hours => coalesce((ajuste('anticipacion_horas'))::int, 0)) then
    raise exception 'Ese horario ya pasó o está muy cerca: elegí uno más tarde';
  end if;

  -- Los productos, juntando repetidos
  for r in
    select (e->>'id')::bigint as id, sum((e->>'cantidad')::int) as cant
    from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) e
    group by 1
    order by 1          -- siempre en el mismo orden: evita bloqueos cruzados entre pedidos
  loop
    if r.cant is null or r.cant < 1 or r.cant > 50 then
      raise exception 'Revisá las cantidades del pedido';
    end if;

    select pr.id, pr.nombre, pr.precio, c.nombre as categoria, c.turno into v_prod
    from productos pr join categorias c on c.id = pr.categoria_id
    where pr.id = r.id and pr.activo and c.activa;
    if not found then
      raise exception 'Uno de los productos ya no está en la carta: actualizá la página';
    end if;
    if v_prod.turno <> v_turno then
      raise exception '%', format('%s %s se pide %s', v_prod.categoria, v_prod.nombre,
        case v_prod.turno when 'mediodia' then 'de lunes a viernes al mediodía' else 'los sábados y domingos' end);
    end if;

    if v_turno = 'mediodia' then
      update disponibilidad set vendidos = vendidos + r.cant
      where fecha = v_fecha and producto_id = r.id and (stock is null or vendidos + r.cant <= stock);
    else
      insert into disponibilidad as d (fecha, producto_id, vendidos) values (v_fecha, r.id, r.cant)
      on conflict (fecha, producto_id) do update set vendidos = d.vendidos + excluded.vendidos
      where d.stock is null or d.vendidos + excluded.vendidos <= d.stock;
    end if;
    if not found then
      raise exception '%', format('No alcanza el stock de %s %s para ese día', v_prod.categoria, v_prod.nombre);
    end if;

    v_items := v_items || jsonb_build_object('id', v_prod.id, 'nombre', v_prod.nombre,
                 'categoria', v_prod.categoria, 'precio', v_prod.precio, 'cantidad', r.cant);
    v_subtotal := v_subtotal + v_prod.precio * r.cant;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'El pedido está vacío';
  end if;

  if v_modalidad = 'envio' then
    if jsonb_array_length(v_zonas) > 0 then
      select greatest(coalesce((z->>'costo')::int, 0), 0) into v_envio
      from jsonb_array_elements(v_zonas) z where z->>'nombre' = v_zona;
      if not found then
        raise exception 'Elegí la zona de entrega de la lista';
      end if;
    else
      v_envio := greatest(coalesce((ajuste('costo_envio'))::int, 0), 0);
    end if;
  end if;

  -- Transferencia: el 100% antes. Efectivo: la seña antes (por transferencia) y el resto al recibir.
  v_total := v_subtotal + v_envio;
  v_sena := case v_pago when 'transferencia' then v_total
            else ceil(v_total * least(greatest(coalesce((ajuste('sena_porcentaje'))::int, 50), 0), 100) / 100.0)::int end;

  insert into pedidos (nombre, telefono, fecha, turno, horario, modalidad, zona, direccion, notas,
                       items, subtotal, envio, total, pago, sena, saldo)
  values (v_nombre, v_telefono, v_fecha, v_turno, v_horario, v_modalidad,
          case when v_modalidad = 'envio' then v_zona else '' end,
          case when v_modalidad = 'envio' then v_direccion else '' end, v_notas,
          v_items, v_subtotal, v_envio, v_total, v_pago, v_sena, v_total - v_sena)
  returning * into v_pedido;

  return to_jsonb(v_pedido);
end $$;

revoke execute on function ajustes_publicos() from public, anon, authenticated;
revoke execute on function crear_pedido(jsonb) from public, anon, authenticated;
grant execute on function ajustes_publicos() to service_role;
grant execute on function crear_pedido(jsonb) to service_role;
