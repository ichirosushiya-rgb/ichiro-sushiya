-- Pruebas de las reglas de pedidos, sobre una base local recién creada (ver pruebas/README.md).
-- Cada bloque falla con un error si algo no da lo esperado. Deja la base con datos de prueba.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create or replace function pg_temp.espera_error(sql text, parte text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'ESPERABA ERROR «%» y no hubo', parte;
exception when others then
  if sqlerrm like 'ESPERABA%' then raise; end if;
  if position(parte in sqlerrm) = 0 then
    raise exception 'ESPERABA «%» y salió «%»', parte, sqlerrm;
  end if;
end $$;

-- Próximo día hábil y próximo sábado, siempre a partir de mañana (así el horario nunca «ya pasó»)
create temp table f as
select (select d::date from generate_series(hoy_ar() + 1, hoy_ar() + 8, '1 day') d
        where extract(isodow from d) between 1 and 5 limit 1) as habil,
       (select d::date from generate_series(hoy_ar() + 1, hoy_ar() + 8, '1 day') d
        where extract(isodow from d) = 6 limit 1) as sabado;

-- Un poke de prueba, cargado el día hábil con stock 3
insert into productos (categoria_id, nombre, descripcion, precio) values (1, 'Poke salmón', 'Arroz, salmón, palta', 9000);
select guardar_dia((select habil from f),
  jsonb_build_array(jsonb_build_object('id', (select id from productos where nombre = 'Poke salmón'), 'cargado', true, 'stock', 3)));

do $$
declare
  habil date := (select habil from f);
  sab date := (select sabado from f);
  poke bigint := (select id from productos where nombre = 'Poke salmón');
  calif bigint := (select id from productos where nombre = 'California');
  base jsonb := jsonb_build_object('nombre', 'Ana Prueba', 'telefono', '221 555-1234', 'modalidad', 'retiro', 'pago', 'transferencia');
  r jsonb;
  c jsonb;
begin
  -- 1. Pedido de pokes válido: precio de la base aunque el navegador mande otro
  r := crear_pedido(base || jsonb_build_object('fecha', habil, 'horario', '12:30',
         'items', jsonb_build_array(jsonb_build_object('id', poke, 'cantidad', 2, 'precio', 1))));
  assert (r->>'total')::int = 18000, 'total pokes: ' || (r->>'total');
  assert (select vendidos from disponibilidad where fecha = habil and producto_id = poke) = 2, 'vendidos 2';

  -- 2. No se pasa del stock (queda 1)
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', habil, 'horario', '13:00',
         'items', jsonb_build_array(jsonb_build_object('id', poke, 'cantidad', 2)))), 'No alcanza el stock');

  -- 3. Sushi un día hábil: no
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', habil, 'horario', '12:30',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'se pide los sábados y domingos');

  -- 4. Poke un sábado: no
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '21:00',
         'items', jsonb_build_array(jsonb_build_object('id', poke, 'cantidad', 1)))), 'de lunes a viernes');

  -- 5. Horario que no está en la lista
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '03:00',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'horario de la lista');

  -- 6. Sushi el finde, con envío a City Bell ($1.500), sin stock cargado = sin límite; repetidos se juntan
  update ajustes set valor = '[{"nombre":"La Plata","costo":0},{"nombre":"City Bell","costo":1500}]' where clave = 'zonas';
  r := crear_pedido(base || jsonb_build_object('fecha', sab, 'horario', '21:00', 'modalidad', 'envio', 'zona', 'City Bell', 'direccion', 'Calle 7 nº 123',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1), jsonb_build_object('id', calif, 'cantidad', 2))));
  assert (r->>'subtotal')::int = 25500 and (r->>'envio')::int = 1500 and (r->>'total')::int = 27000, 'total finde: ' || r::text;
  assert jsonb_array_length(r->'items') = 1, 'repetidos juntos';
  assert (r->>'sena')::int = 27000 and (r->>'saldo')::int = 0 and r->>'zona' = 'City Bell', 'transferencia = 100%: ' || r::text;

  -- 7. Envío sin dirección, sin zona o con una zona que no está en la lista; sin forma de pago
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '21:00', 'modalidad', 'envio', 'zona', 'La Plata',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'dirección');
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '21:00', 'modalidad', 'envio', 'direccion', 'Calle 7 nº 1',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'zona');
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '21:00', 'modalidad', 'envio', 'direccion', 'Calle 7 nº 1', 'zona', 'Marte',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'zona de entrega de la lista');
  perform pg_temp.espera_error(format('select crear_pedido(%L)', (base - 'pago') || jsonb_build_object('fecha', sab, 'horario', '21:00',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'cómo vas a pagar');

  -- 7b. Efectivo: seña del 50% (redondeada para arriba) y el resto al recibir
  c := crear_pedido(base || jsonb_build_object('pago', 'efectivo', 'fecha', sab, 'horario', '20:00',
         'items', jsonb_build_array(jsonb_build_object('id', (select id from productos where nombre = 'Tamago'), 'cantidad', 1))));
  assert (c->>'total')::int = 9500 and (c->>'sena')::int = 4750 and (c->>'saldo')::int = 4750 and c->>'pago' = 'efectivo', 'seña 50%: ' || c::text;
  perform cambiar_estado((c->>'id')::bigint, 'rechazado');

  -- 8. Stock del finde: con 4 cargados y 3 vendidos, se puede 1 más y no 2
  perform guardar_dia(sab, jsonb_build_array(jsonb_build_object('id', calif, 'cargado', true, 'stock', 4)));
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '21:00',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 2)))), 'No alcanza el stock');

  -- 9. Rechazar devuelve el stock; no se puede reabrir
  perform cambiar_estado((r->>'id')::bigint, 'rechazado');
  assert (select vendidos from disponibilidad where fecha = sab and producto_id = calif) = 0, 'stock devuelto';
  perform pg_temp.espera_error(format('select cambiar_estado(%s, %L)', r->>'id', 'confirmado'), 'no se puede reabrir');

  -- 10. Pedidos del finde cerrados desde el panel
  update ajustes set valor = 'false' where clave = 'pedidos_finde';
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '21:00',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'cerrados');
  update ajustes set valor = 'true' where clave = 'pedidos_finde';

  -- 11. Producto desactivado
  update productos set activo = false where id = calif;
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', sab, 'horario', '21:00',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'ya no está en la carta');
  update productos set activo = true where id = calif;

  -- 12. Teléfono corto y fecha fuera de rango
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('telefono', '123', 'fecha', sab, 'horario', '21:00',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'teléfono');
  perform pg_temp.espera_error(format('select crear_pedido(%L)', base || jsonb_build_object('fecha', hoy_ar() + 40, 'horario', '21:00',
         'items', jsonb_build_array(jsonb_build_object('id', calif, 'cantidad', 1)))), 'no se puede pedir todavía');

  -- 13. La carta pública: el poke figura solo el día hábil cargado, con lo que queda (1)
  c := carta_publica();
  assert (select (d->'quedan'->>poke::text)::int from jsonb_array_elements(c->'dias') d where (d->>'fecha')::date = habil) = 1, 'quedan pokes';
  assert not (c->'ajustes' ? 'mail_avisos'), 'el mail de avisos no es público';
  assert jsonb_array_length(c->'categorias') = 7, 'categorías';

  -- 14. Sacar del día un poke que ya tiene vendidos: queda con stock = vendidos
  perform guardar_dia(habil, jsonb_build_array(jsonb_build_object('id', poke, 'cargado', false)));
  assert (select stock from disponibilidad where fecha = habil and producto_id = poke) = 2, 'stock = vendidos';

  -- 15. Copiar el día hábil al siguiente hábil
  perform copiar_dia(habil, (select d::date from generate_series(habil + 1, habil + 7, '1 day') d where extract(isodow from d) between 1 and 5 limit 1));

  raise notice 'TODAS LAS REGLAS OK';
end $$;

-- 16. Con la clave pública (anon) no se ve ni se hace nada
set role anon;
do $$ begin
  perform pg_temp.espera_error('select * from pedidos', 'permission denied');
  perform pg_temp.espera_error('select carta_publica()', 'permission denied');
  raise notice 'ANON BLOQUEADO OK';
end $$;
reset role;
