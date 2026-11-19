-- 003 · Métricas del panel
-- Se corre una vez en Supabase → SQL Editor (después de 002_fotos.sql).
--
-- metricas(desde, hasta): todo calculado sobre el día de entrega del pedido (fecha).
-- Cuentan como venta los pedidos confirmados y entregados. Los pendientes, rechazados y
-- cancelados se informan aparte.

create or replace function metricas(p_desde date, p_hasta date) returns jsonb language sql stable as $$
  with p as (
    select * from pedidos where fecha between p_desde and p_hasta
  ), v as (
    select * from p where estado in ('confirmado', 'entregado')
  ), it as (
    select (i->>'nombre') as nombre, (i->>'categoria') as categoria,
           (i->>'cantidad')::int as cantidad, (i->>'precio')::int * (i->>'cantidad')::int as importe
    from v, jsonb_array_elements(v.items) i
  ), clientes as (
    select telefono, count(*) as n from v group by telefono
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'pedidos',     (select count(*) from v),
    'ventas',      (select coalesce(sum(total), 0) from v),
    'envios',      (select coalesce(sum(envio), 0) from v),
    'ticket',      (select coalesce(round(avg(total)), 0) from v),
    'unidades',    (select coalesce(sum(cantidad), 0) from it),
    'pendientes',  (select count(*) from p where estado = 'pendiente'),
    'perdidos',    (select count(*) from p where estado in ('rechazado', 'cancelado')),
    'clientes',    (select count(*) from clientes),
    'recurrentes', (select count(*) from clientes where n > 1),
    'por_dia', (
      select jsonb_agg(jsonb_build_object('fecha', d.f,
               'pedidos', (select count(*) from v where v.fecha = d.f),
               'ventas',  (select coalesce(sum(total), 0) from v where v.fecha = d.f)) order by d.f)
      from (select g::date as f from generate_series(p_desde, p_hasta, interval '1 day') g) d),
    'por_turno', (
      select coalesce(jsonb_object_agg(turno, jsonb_build_object('pedidos', n, 'ventas', s)), '{}'::jsonb)
      from (select turno, count(*) n, sum(total) s from v group by turno) x),
    'por_modalidad', (
      select coalesce(jsonb_object_agg(modalidad, n), '{}'::jsonb)
      from (select modalidad, count(*) n from v group by modalidad) x),
    'por_horario', (
      select coalesce(jsonb_agg(jsonb_build_object('horario', horario, 'pedidos', n) order by horario), '[]'::jsonb)
      from (select horario, count(*) n from v group by horario) x),
    'por_dia_semana', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'pedidos', n, 'ventas', s) order by d), '[]'::jsonb)
      from (select extract(isodow from fecha)::int d, count(*) n, sum(total) s from v group by 1) x),
    'productos', (
      select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'categoria', categoria,
               'cantidad', cantidad, 'ventas', importe) order by cantidad desc, importe desc), '[]'::jsonb)
      from (select nombre, categoria, sum(cantidad) cantidad, sum(importe) importe
            from it group by nombre, categoria order by 3 desc, 4 desc limit 15) x)
  )
$$;

revoke execute on function metricas(date, date) from public, anon, authenticated;
grant execute on function metricas(date, date) to service_role;
