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
Deno.serve({ port: 8787, hostname: "0.0.0.0" }, (req) => worker.fetch(req, env, ctx));
