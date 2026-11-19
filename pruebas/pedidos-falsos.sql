-- Pedidos inventados de los últimos 30 días, para ver las métricas en la copia local (nunca en Supabase)
insert into productos (categoria_id, nombre, descripcion, precio) values
  (1, 'Poke salmón', 'Arroz, salmón, palta, mango', 9500), (1, 'Poke veggie', 'Arroz, palta, tofu', 8500);
insert into pedidos (nombre, telefono, fecha, turno, horario, modalidad, direccion, items, subtotal, envio, total, estado)
select 'Cliente ' || (g % 12), '22155500' || lpad((g % 12)::text, 2, '0'), d, turno_de(d),
       case when turno_de(d) = 'mediodia' then (array['12:00','12:30','13:00','13:30'])[1 + g % 4]
            else (array['20:00','20:30','21:00','21:30','22:00'])[1 + g % 5] end,
       case when g % 3 = 0 then 'envio' else 'retiro' end, case when g % 3 = 0 then 'Calle 7 nº 100' else '' end,
       jsonb_build_array(jsonb_build_object('id', pr.id, 'nombre', pr.nombre, 'categoria', c.nombre, 'precio', pr.precio, 'cantidad', 1 + g % 3)),
       pr.precio * (1 + g % 3), case when g % 3 = 0 then 1500 else 0 end,
       pr.precio * (1 + g % 3) + case when g % 3 = 0 then 1500 else 0 end,
       (array['entregado','entregado','entregado','confirmado','rechazado','pendiente'])[1 + g % 6]
from generate_series(1, 140) g
cross join lateral (select (hoy_ar() - (g % 30))::date as d) f
cross join lateral (select pr.* from productos pr join categorias c2 on c2.id = pr.categoria_id
                    where c2.turno = turno_de(f.d) order by (pr.id * 7 + g) % 23 limit 1) pr
join categorias c on c.id = pr.categoria_id;
