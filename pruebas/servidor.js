// Corre el Worker en Deno para probar en la compu (lo usa pruebas/base-nueva.sh).
// Imita lo que hace Cloudflare: env con las claves y ASSETS sirviendo public/.
import worker from "../src/worker.js";

const TIPOS = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", json: "application/json" };
const raiz = new URL("../public/", import.meta.url);

const ASSETS = {
  async fetch(req) {
    let ruta = decodeURIComponent(new URL(req.url).pathname);
    if (ruta.endsWith("/")) ruta += "index.html";
    if (ruta.includes("..")) return new Response("No", { status: 400 });
    try {
      const datos = await Deno.readFile(new URL("." + ruta, raiz));
      return new Response(datos, { headers: { "Content-Type": TIPOS[ruta.split(".").pop()] || "application/octet-stream" } });
    } catch {
      // Como Cloudflare: /admin → /admin/
      try { await Deno.stat(new URL("." + ruta + "/index.html", raiz)); return Response.redirect(new URL(ruta + "/", req.url), 307); } catch { /* */ }
      return new Response("No existe", { status: 404 });
    }
  },
};
const env = { ...Deno.env.toObject(), ASSETS };
const ctx = { waitUntil: (p) => p.catch((e) => console.error(e)) };

// Imitación mínima del Storage de Supabase, en memoria: /__storage/object/fotos/<nombre> (subir)
// y /__storage/object/public/fotos/<nombre> (ver). Se borra al reiniciar.
const fotos = new Map();
async function storage(req, ruta) {
  const subir = ruta.match(/^\/__storage\/object\/fotos\/([\w.-]+)$/);
  if (subir && req.method === "POST") {
    fotos.set(subir[1], { tipo: req.headers.get("content-type"), datos: new Uint8Array(await req.arrayBuffer()) });
    return Response.json({ Key: "fotos/" + subir[1] });
  }
  const ver = ruta.match(/^\/__storage\/object\/public\/fotos\/([\w.-]+)$/);
  const f = ver && fotos.get(ver[1]);
  if (f) return new Response(f.datos, { headers: { "Content-Type": f.tipo } });
  return new Response(JSON.stringify({ error: "Bucket not found" }), { status: 404 });
}

Deno.serve({ port: 8787, hostname: "0.0.0.0" }, (req) => {
  const ruta = new URL(req.url).pathname;
  if (ruta.startsWith("/__storage/")) return storage(req, ruta);
  return worker.fetch(req, env, ctx);
});
