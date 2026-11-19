# Ichiro Sushiya · web y panel

La web de Ichiro Sushiya (**ichirosushiya.com.ar**) y su panel de administración (**/admin**).
Sin paso de compilación: HTML, CSS y JS planos. Corre en Cloudflare Workers y los datos están en Supabase.

```
Navegador ──> Worker de Cloudflare (src/worker.js) ──> Supabase (PostgREST)
                     └──> Brevo (mail de aviso de cada pedido)
```

- **El navegador nunca habla con Supabase.** Todo pasa por `/api/...` en el Worker, que usa la clave secreta.
- **Las reglas de los pedidos están en la base** (`supabase/schema.sql` → `crear_pedido`): los precios salen de la
  base, el stock se descuenta en el momento y se valida el día, el horario y si los pedidos están abiertos.
- **Si la base no responde**, la web muestra la carta de `public/assets/menu.js` y el pedido se manda armado por
  WhatsApp, como antes. Nunca queda vacía.

## Archivos

| Archivo | Qué tiene |
|---|---|
| `public/index.html` · `public/assets/web.js` | La web: carta, carrito y formulario del pedido |
| `public/admin/` | El panel: pedidos, stock del día, carta y ajustes |
| `public/assets/menu.js` | La carta de respaldo (solo se usa si la base no responde) |
| `src/worker.js` | Las rutas `/api/carta`, `/api/pedido` y `/api/admin/*` |
| `src/supabase.js` · `src/mail.js` | Conexión con Supabase y el mail de aviso (Brevo) |
| `supabase/schema.sql` | Tablas, reglas y la carta inicial. Se corre una vez |
| `supabase/002_fotos.sql` | Fotos de los productos (columna y carpeta pública en Storage) |
| `diseno/` | Favicon e imagen para compartir el link: se editan en HTML y se exportan con `diseno/exportar.sh` |
| `pruebas/` | Copia local de todo en Docker, para probar sin tocar nada real |
| `wrangler.toml` | Configuración de Cloudflare |

## Cómo funciona

- **Turnos.** Lunes a viernes al mediodía: pokes. Sábados y domingos a la noche: sushi y demás. Cada categoría
  dice a qué turno pertenece. Un pedido es de un solo turno (la web no deja mezclar).
- **Pokes del día.** Un poke se puede pedir un día solo si está marcado en *Stock del día* para ese día.
  «Copiar de otro día» repite la carga de un día en otro.
- **Stock.** Vacío = sin límite; 0 = agotado. Rechazar o cancelar un pedido devuelve el stock.
- **Abrir y cerrar pedidos.** Los interruptores de arriba del panel cierran los pokes o el finde en toda la web.
- **Fotos.** Cada producto puede tener foto (Carta → Editar → Elegir foto). El panel la achica antes de subirla
  y en la web se ve a la derecha de la tarjeta, con el + encima.
- **Pedidos.** Entran como *pendiente* y llega un mail. Al confirmarlos aparece el botón verde para avisarle al
  cliente por WhatsApp con el mensaje ya escrito.

## Puesta en marcha (una sola vez)

1. **Supabase.** Crear el proyecto (región São Paulo). SQL Editor → pegar y correr, en orden, `supabase/schema.sql`
   y `supabase/002_fotos.sql` (fotos de los productos).
2. **Dirección del proyecto.** Supabase → Project Settings → Data API → *Project URL*. Va en `wrangler.toml`,
   en `SUPABASE_URL` (no es secreta).
3. **Secrets en Cloudflare.** Workers & Pages → `ichiro-sushiya` → Settings → Variables and Secrets → Add,
   tipo *Secret*:
   - `SUPABASE_SECRET_KEY`: Supabase → Project Settings → API Keys → *Secret key* (`sb_secret_...`).
   - `ADMIN_TOKEN`: la contraseña del panel. Larga (12 caracteres o más); es la misma para los dos.
   - `BREVO_API_KEY`: ver el paso 4.
4. **Mails (Brevo, gratis hasta 300 por día).** Crear la cuenta en brevo.com → Senders → agregar y verificar la
   casilla que manda los avisos → SMTP & API → API Keys → crear una y cargarla como `BREVO_API_KEY`. Si la casilla
   que manda no es la misma que recibe, agregar en `wrangler.toml` → `[vars]` → `MAIL_REMITENTE = "..."`.
   La casilla que recibe se pone en el panel: Ajustes → Contacto.
5. Entrar a **/admin** con la contraseña y cargar los pokes en *Carta* → Pokes.

Cada push a `main` publica solo en Cloudflare. `keep_vars = true` conserva los Secrets en cada deploy.

## Probar en la compu

Necesita Docker (usa las imágenes `postgres:15-alpine`, `postgrest/postgrest:v12.2.3` y `denoland/deno`):

```
./pruebas/base-nueva.sh
```

Levanta la base, PostgREST y el Worker: la web queda en http://127.0.0.1:8787 y el panel en /admin
(contraseña `prueba-local-123`). Nada de esto toca Supabase ni Cloudflare.

Las reglas de los pedidos (16 casos: precios, stock, turnos, cerrados, rechazos y que la clave pública no vea nada):

```
./pruebas/base-nueva.sh --solo-base && docker exec -i ichiro-db psql -U postgres -q < pruebas/reglas.sql
```

Tiene que terminar con `TODAS LAS REGLAS OK` y `ANON BLOQUEADO OK`.

**Al cambiar la base:** el cambio va en un archivo nuevo `supabase/0NN_que_cambia.sql` (para correr en Supabase)
y también en `supabase/schema.sql`, que siempre tiene que crear todo desde cero.
