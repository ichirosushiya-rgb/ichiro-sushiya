// Worker de Ichiro Sushiya (Cloudflare Workers + archivos estáticos de public/).
//
//   /api/carta            la carta, los ajustes públicos y lo que queda de cada día (web)
//   /api/pedido           crea un pedido (web) y avisa por mail
//   /api/admin/...        el panel; cada llamada trae el header X-Admin-Token = ADMIN_TOKEN
//   todo lo demás         archivos de public/ (la web y /admin/)
//
// Secrets en Cloudflare: SUPABASE_SECRET_KEY, ADMIN_TOKEN (la contraseña del panel), BREVO_API_KEY.
// Las reglas de los pedidos (precios, stock, días) están en la base: supabase/schema.sql.

import { sb, rpc, ErrorBase } from "./supabase.js";
import { avisarPedido } from "./mail.js";

const json = (datos, status = 200, extra = {}) =>
  new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
const error = (mensaje, status = 400) => json({ error: mensaje }, status);

// ------------------------------------------------------------ Límites simples por IP
// (en memoria de cada instancia del Worker: frena abusos obvios, no es un muro)
const visitas = new Map();
function pasado(clave, max, minutos) {
  const ahora = Date.now();
  const lista = (visitas.get(clave) || []).filter((t) => ahora - t < minutos * 60000);
  if (lista.length >= max) return true;
  lista.push(ahora);
  visitas.set(clave, lista);
  if (visitas.size > 5000) visitas.clear();
  return false;
}
const ipDe = (req) => req.headers.get("cf-connecting-ip") || "local";

// ------------------------------------------------------------ Contraseña del panel
async function esAdmin(req, env) {
  const esperado = env.ADMIN_TOKEN || "";
  const recibido = req.headers.get("x-admin-token") || "";
  if (esperado.length < 8 || !recibido) return false;
  // Se comparan los hash, siempre del mismo largo, sin cortar al primer carácter distinto
  const hash = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(esperado), hash(recibido)]);
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

// ------------------------------------------------------------ Validaciones del panel
const texto = (v, max, min = 0) => typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
const entero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLAVES_TEXTOS = ["mediodia_dias", "mediodia_titulo", "mediodia_horario", "mediodia_etiqueta",
  "finde_dias", "finde_titulo", "finde_horario", "finde_etiqueta"];

const VALIDAR_AJUSTE = {
  pedidos_mediodia: (v) => typeof v === "boolean",
  pedidos_finde: (v) => typeof v === "boolean",
  franjas_mediodia: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 30 && v.every((h) => HORA.test(h)),
  franjas_finde: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 30 && v.every((h) => HORA.test(h)),
  dias_adelante: (v) => entero(v, 0, 30),
  anticipacion_horas: (v) => entero(v, 0, 72),
  costo_envio: (v) => entero(v, 0, 1000000),
  whatsapp: (v) => typeof v === "string" && /^\d{8,15}$/.test(v),
  instagram: (v) => typeof v === "string" && /^[A-Za-z0-9._]{0,30}$/.test(v),
  mail_avisos: (v) => typeof v === "string" && (v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
  aviso: (v) => texto(v, 200),
  textos: (v) => v && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).every((k) => CLAVES_TEXTOS.includes(k) && texto(v[k], 60)),
};

function validarProducto(p) {
  if (!entero(p.categoria_id, 1, 1e12)) return "Elegí la categoría";
  if (!texto(p.nombre, 80, 1)) return "El nombre tiene que tener entre 1 y 80 letras";
  if (!texto(p.descripcion ?? "", 300)) return "La descripción es demasiado larga";
  if (!entero(p.precio, 0, 10000000)) return "Revisá el precio (número entero, sin puntos)";
  if (typeof p.activo !== "boolean") return "Falta si está activo";
  if (!entero(p.orden ?? 0, -1000, 100000)) return "Revisá el orden";
  return null;
}
function validarCategoria(c) {
  if (!texto(c.nombre, 60, 1)) return "El nombre tiene que tener entre 1 y 60 letras";
  if (!texto(c.jp ?? "", 20)) return "El texto en japonés es demasiado largo";
  if (!["mediodia", "finde"].includes(c.turno)) return "Elegí el turno";
  if (typeof c.activa !== "boolean") return "Falta si está activa";
  if (!entero(c.orden ?? 0, -1000, 100000)) return "Revisá el orden";
  return null;
}
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------ Rutas
async function leerJson(req) {
  try { return await req.json(); } catch { return null; }
}

async function api(req, env, ctx, url) {
  const ruta = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const metodo = req.method;

  // ---------- Web
  if (ruta === "carta" && metodo === "GET") {
    return json(await rpc(env, "carta_publica")); // sin caché: el stock y los precios cambian desde el panel
  }

  if (ruta === "pedido" && metodo === "POST") {
    if (pasado("pedido:" + ipDe(req), 6, 10)) return error("Hiciste muchos pedidos seguidos: esperá unos minutos", 429);
    const p = await leerJson(req);
    if (!p || typeof p !== "object") return error("Pedido inválido");
    if (p.web) return json({ ok: true }); // campo trampa: lo completan solo los robots
    const datos = {
      nombre: p.nombre, telefono: p.telefono, fecha: p.fecha, horario: p.horario,
      modalidad: p.modalidad, direccion: p.direccion, notas: p.notas,
      items: Array.isArray(p.items) ? p.items.slice(0, 60).map((i) => ({ id: i.id, cantidad: i.cantidad })) : [],
    };
    const pedido = await rpc(env, "crear_pedido", { p: datos });
    ctx.waitUntil((async () => {
      const casilla = (await sb(env, "ajustes?clave=eq.mail_avisos&select=valor"))[0]?.valor;
      await avisarPedido(env, pedido, casilla, url.origin);
    })().catch((e) => console.error("aviso del pedido:", e.message)));
    return json({ ok: true, pedido: { id: pedido.id, fecha: pedido.fecha, horario: pedido.horario, total: pedido.total } });
  }

  // ---------- Panel
  if (!ruta.startsWith("admin/")) return error("No existe", 404);
  // 10 contraseñas incorrectas desde la misma IP → 15 minutos de espera
  const fallos = (visitas.get("fallo:" + ipDe(req)) || []).filter((t) => Date.now() - t < 15 * 60000);
  if (fallos.length >= 10) return error("Demasiados intentos: probá de nuevo en 15 minutos", 429);
  if (!(await esAdmin(req, env))) {
    visitas.set("fallo:" + ipDe(req), [...fallos, Date.now()]);
    return error(env.ADMIN_TOKEN ? "Contraseña incorrecta" : "Falta configurar ADMIN_TOKEN en Cloudflare", 401);
  }
  const a = ruta.slice(6);
  const q = url.searchParams;

  if (a === "ping") return json({ ok: true });

  if (a === "pedidos" && metodo === "GET") {
    const estado = q.get("estado") || "activos";
    const filtro = {
      activos: "estado=in.(pendiente,confirmado)",
      pendiente: "estado=eq.pendiente",
      confirmado: "estado=eq.confirmado",
      cerrados: "estado=in.(entregado,rechazado,cancelado)",
      todos: "",
    }[estado];
    if (filtro === undefined) return error("Filtro desconocido");
    const desde = q.get("desde");
    const partes = [filtro, desde && FECHA.test(desde) ? `fecha=gte.${desde}` : "",
      estado === "cerrados" || estado === "todos" ? "order=fecha.desc,horario.desc,id.desc" : "order=fecha.asc,horario.asc,id.asc",
      "limit=300"].filter(Boolean);
    return json(await sb(env, "pedidos?" + partes.join("&")));
  }

  if (a === "estado" && metodo === "POST") {
    const b = await leerJson(req);
    if (!b || !entero(b.id, 1, 1e15)) return error("Pedido inválido");
    return json(await rpc(env, "cambiar_estado", { p_id: b.id, p_estado: b.estado }));
  }

  if (a === "dia" && metodo === "GET") {
    const f = q.get("fecha");
    if (!FECHA.test(f || "")) return error("Fecha inválida");
    return json(await rpc(env, "dia_admin", { p_fecha: f }));
  }
  if (a === "dia" && metodo === "POST") {
    const b = await leerJson(req);
    if (!b || !FECHA.test(b.fecha || "") || !Array.isArray(b.filas)) return error("Datos inválidos");
    const filas = b.filas.map((f) => ({ id: f.id, cargado: !!f.cargado, stock: f.stock === "" || f.stock == null ? null : Number(f.stock) }));
    if (filas.some((f) => !entero(f.id, 1, 1e15) || (f.stock !== null && !entero(f.stock, 0, 100000)))) {
      return error("Revisá los números de stock (enteros, sin puntos)");
    }
    return json(await rpc(env, "guardar_dia", { p_fecha: b.fecha, p_filas: filas }));
  }
  if (a === "copiar-dia" && metodo === "POST") {
    const b = await leerJson(req);
    if (!b || !FECHA.test(b.desde || "") || !FECHA.test(b.hasta || "")) return error("Fechas inválidas");
    return json(await rpc(env, "copiar_dia", { p_desde: b.desde, p_hasta: b.hasta }));
  }

  if (a === "carta" && metodo === "GET") {
    const [categorias, productos] = await Promise.all([
      sb(env, "categorias?order=orden.asc,id.asc"),
      sb(env, "productos?order=orden.asc,id.asc"),
    ]);
    return json({ categorias, productos });
  }

  if (a === "producto" || a === "categoria") {
    const tabla = a === "producto" ? "productos" : "categorias";
    if (metodo === "DELETE") {
      const id = Number(q.get("id"));
      if (!entero(id, 1, 1e15)) return error("Id inválido");
      await sb(env, `${tabla}?id=eq.${id}`, { method: "DELETE" });
      return json({ ok: true });
    }
    if (metodo === "POST") {
      const b = await leerJson(req);
      if (!b) return error("Datos inválidos");
      const campos = a === "producto"
        ? { categoria_id: b.categoria_id, nombre: b.nombre?.trim(), descripcion: (b.descripcion ?? "").trim(), precio: b.precio, activo: b.activo, orden: b.orden ?? 0 }
        : { nombre: b.nombre?.trim(), jp: (b.jp ?? "").trim(), turno: b.turno, activa: b.activa, orden: b.orden ?? 0 };
      const problema = a === "producto" ? validarProducto(campos) : validarCategoria(campos);
      if (problema) return error(problema);
      const fila = b.id
        ? await sb(env, `${tabla}?id=eq.${Number(b.id)}`, { method: "PATCH", body: campos, prefer: "return=representation" })
        : await sb(env, tabla, { method: "POST", body: campos, prefer: "return=representation" });
      if (!fila?.length) return error("No encontré lo que querías modificar", 404);
      return json(fila[0]);
    }
  }

  if (a === "ajustes" && metodo === "GET") {
    const filas = await sb(env, "ajustes?select=clave,valor");
    return json(Object.fromEntries(filas.map((f) => [f.clave, f.valor])));
  }
  if (a === "ajustes" && metodo === "POST") {
    const b = await leerJson(req);
    if (!b || typeof b !== "object") return error("Datos inválidos");
    const filas = [];
    for (const [clave, valor] of Object.entries(b)) {
      const validar = VALIDAR_AJUSTE[clave];
      if (!validar) return error(`Ajuste desconocido: ${clave}`);
      let v = valor;
      if (clave.startsWith("franjas_") && Array.isArray(v)) v = [...new Set(v.map((h) => String(h).trim()))].sort();
      if (typeof v === "string") v = v.trim();
      if (!validar(v)) return error(`Revisá «${clave.replace(/_/g, " ")}»`);
      filas.push({ clave, valor: v });
    }
    if (filas.length) await sb(env, "ajustes", { method: "POST", body: filas, prefer: "resolution=merge-duplicates" });
    return json({ ok: true });
  }

  return error("No existe", 404);
}

// Mensajes de la base que se pueden mostrar tal cual
function respuestaDeError(err) {
  if (err instanceof ErrorBase) {
    if (err.codigo === "P0001") return error(err.message, 400);                 // reglas de los pedidos
    if (err.codigo === "23503") return error("No se puede borrar: tiene productos o datos que dependen de esto. Desactivalo o mové sus productos primero.", 409);
    if (err.codigo === "23514" || err.codigo === "22P02") return error("Revisá los datos: hay un valor que no corresponde", 400);
    if (err.codigo === "config") return error(err.message, 503);
    // Problemas de puesta en marcha: se dicen claros (no revelan nada secreto)
    if (err.status === 401 || err.status === 403) return error("La clave de Supabase (SUPABASE_SECRET_KEY) no es válida", 503);
    if (err.codigo === "PGRST202" || err.codigo === "42P01" || err.codigo === "PGRST205") return error("Falta crear las tablas: correr supabase/schema.sql en Supabase", 503);
  }
  console.error("api:", err && err.message);
  return error("Algo falló de nuestro lado. Probá de nuevo en un rato.", 500);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return (await api(req, env, ctx, url)) || error("No existe", 404);
      } catch (err) {
        return respuestaDeError(err);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
