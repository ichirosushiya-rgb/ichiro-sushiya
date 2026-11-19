#!/bin/sh
# Levanta una copia local de todo para probar sin tocar nada real (necesita Docker):
#   ichiro-db    Postgres 15 con los roles de Supabase y supabase/schema.sql
#   ichiro-rest  PostgREST (lo mismo que usa Supabase por dentro), en el puerto 54330
#   ichiro-web   el Worker (src/worker.js) corriendo en Deno, en http://127.0.0.1:8787
# La contraseña del panel local es: prueba-local-123
set -e
cd "$(dirname "$0")/.."
SECRETO="prueba-local-solo-para-desarrollo-0123456789"
docker rm -f ichiro-web ichiro-rest ichiro-db >/dev/null 2>&1 || true
docker network create ichiro-net >/dev/null 2>&1 || true
docker run -d --name ichiro-db --network ichiro-net -e POSTGRES_PASSWORD=local -p 54329:5432 postgres:15-alpine >/dev/null
for i in $(seq 1 30); do docker exec ichiro-db pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
docker exec -i ichiro-db psql -U postgres -v ON_ERROR_STOP=1 -q < pruebas/roles.sql
docker exec -i ichiro-db psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/schema.sql >/dev/null
echo "Base local lista"
[ "$1" = "--solo-base" ] && exit 0

docker run -d --name ichiro-rest --network ichiro-net -p 54330:3000 \
  -e PGRST_DB_URI="postgres://authenticator:local@ichiro-db:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" \
  postgrest/postgrest:v12.2.3 >/dev/null

CLAVE=$(python3 -I -c "
import base64, hmac, hashlib, json, sys
b = lambda d: base64.urlsafe_b64encode(d).rstrip(b'=').decode()
h = b(json.dumps({'alg':'HS256','typ':'JWT'}).encode()); p = b(json.dumps({'role':'service_role'}).encode())
s = b(hmac.new(sys.argv[1].encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest())
print(f'{h}.{p}.{s}')" "$SECRETO")

docker run -d --name ichiro-web --network ichiro-net -p 8787:8787 -v "$PWD":/app:ro \
  -e SUPABASE_REST_URL="http://ichiro-rest:3000" -e SUPABASE_SECRET_KEY="$CLAVE" -e ADMIN_TOKEN="prueba-local-123" \
  denoland/deno:latest run --allow-net --allow-read=/app --allow-env /app/pruebas/servidor.js >/dev/null
for i in $(seq 1 40); do curl -sf http://127.0.0.1:8787/api/carta >/dev/null 2>&1 && break; sleep 1; done
echo "Web local: http://127.0.0.1:8787  ·  Panel: http://127.0.0.1:8787/admin/  (contraseña: prueba-local-123)"
