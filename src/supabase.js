// Cliente mínimo de Supabase (PostgREST) para el Worker.
// Usa la clave SECRETA: vive solo en los Secrets de Cloudflare, nunca en el navegador.
//   SUPABASE_URL          https://<proyecto>.supabase.co (wrangler.toml → [vars])
//   SUPABASE_SECRET_KEY   sb_secret_... (Cloudflare → Worker → Settings → Variables and Secrets)
//   SUPABASE_REST_URL     (solo para las pruebas locales) PostgREST directo, sin /rest/v1

export class ErrorBase extends Error {
  constructor(mensaje, codigo, status) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

export async function sb(env, ruta, { method = "GET", body, prefer } = {}) {
  const clave = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const base = env.SUPABASE_REST_URL || (env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1" : "");
  if (!base || !clave) throw new ErrorBase("Falta configurar Supabase (SUPABASE_URL y SUPABASE_SECRET_KEY)", "config", 503);

  const res = await fetch(`${base}/${ruta}`, {
    method,
    headers: {
      apikey: clave,
      Authorization: `Bearer ${clave}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  if (!res.ok) throw new ErrorBase((datos && datos.message) || `Supabase HTTP ${res.status}`, datos && datos.code, res.status);
  return datos;
}

export const rpc = (env, nombre, args = {}) => sb(env, `rpc/${nombre}`, { method: "POST", body: args });
