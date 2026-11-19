-- 002 · Fotos de los productos
-- Se corre una vez en Supabase → SQL Editor (después de schema.sql).
-- Agrega la foto a cada producto y crea el lugar donde se guardan (Storage, carpeta pública «fotos»).
-- Las fotos las sube el panel a través del Worker; desde afuera solo se pueden ver, no subir.

alter table productos add column if not exists foto text not null default '' check (length(foto) <= 500);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;

-- La carta pública ahora también manda la foto
create or replace function carta_publica() returns jsonb language plpgsql stable as $$
declare
  v_hoy   date := hoy_ar();
  v_dias  int  := least(greatest(coalesce((ajuste('dias_adelante'))::int, 7), 0), 30);
begin
  return jsonb_build_object(
    'hoy', v_hoy,
    'ajustes', ajustes_publicos(),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'nombre', c.nombre, 'jp', c.jp, 'turno', c.turno,
               'productos', coalesce((
                 select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre,
                                                     'descripcion', p.descripcion, 'precio', p.precio,
                                                     'foto', p.foto)
                                  order by p.orden, p.id)
                 from productos p where p.categoria_id = c.id and p.activo), '[]'::jsonb))
             order by c.orden, c.id)
      from categorias c where c.activa), '[]'::jsonb),
    'dias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fecha', d.f,
               'turno', turno_de(d.f),
               'abierto', coalesce((ajuste('pedidos_' || turno_de(d.f)))::boolean, false),
               'quedan', coalesce((
                 select jsonb_object_agg(x.producto_id::text,
                          case when x.stock is null then null else greatest(x.stock - x.vendidos, 0) end)
                 from disponibilidad x where x.fecha = d.f), '{}'::jsonb))
             order by d.f)
      from (select g::date as f from generate_series(v_hoy, v_hoy + v_dias, interval '1 day') g) d), '[]'::jsonb)
  );
end $$;

revoke execute on function carta_publica() from public, anon, authenticated;
grant execute on function carta_publica() to service_role;
