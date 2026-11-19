// Panel de Ichiro Sushiya: pedidos, stock del día, carta y ajustes.
// Cada llamada a /api/admin/* lleva la contraseña en el header X-Admin-Token
// (el Worker la compara con el Secret ADMIN_TOKEN de Cloudflare).

(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const precio = (n) => "$" + Number(n).toLocaleString("es-AR");
  const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const fechaLarga = (f) => { const d = new Date(f + "T12:00:00"); return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
  const fechaCorta = (f) => { const d = new Date(f + "T12:00:00"); return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()}`; };
  const turnoDe = (f) => { const g = new Date(f + "T12:00:00").getDay(); return g === 0 || g === 6 ? "finde" : "mediodia"; };
  const NOMBRE_TURNO = { mediodia: "Mediodía · lunes a viernes", finde: "Finde · sábados y domingos" };
  const hoyAR = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
  const sumarDias = (f, n) => { const d = new Date(f + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  // ---------------------------------------------------------------- Sesión y API
  let clave = "";
  try { clave = localStorage.getItem("ichiro-admin") || sessionStorage.getItem("ichiro-admin") || ""; } catch { /* */ }

  async function api(ruta, { method = "GET", body } = {}) {
    const r = await fetch("/api/admin/" + ruta, {
      method,
      headers: { "X-Admin-Token": clave, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const datos = await r.json().catch(() => ({}));
    if (r.status === 401) { salir(datos.error); throw new Error(datos.error || "Sesión vencida"); }
    if (!r.ok) throw new Error(datos.error || "Algo falló. Probá de nuevo.");
    return datos;
  }

  function toast(txt, mal = false) {
    const t = $("#toast");
    t.textContent = txt; t.className = "toast" + (mal ? " mal" : ""); t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), mal ? 6000 : 2500);
  }
  const conError = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (clave) toast(e.message, true); } };

  function salir(mensaje) {
    clave = "";
    try { localStorage.removeItem("ichiro-admin"); sessionStorage.removeItem("ichiro-admin"); } catch { /* */ }
    clearInterval(refresco);
    $("#app").hidden = true;
    $("#login").hidden = false;
    const e = $("#login-error");
    e.textContent = mensaje || ""; e.hidden = !mensaje || mensaje === "Sesión vencida";
  }
  $("#salir").onclick = () => salir();

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clave = $("#login-clave").value;
    const boton = e.submitter; boton.disabled = true;
    try {
      await api("ping");
      try {
        (($("#login-recordar").checked) ? localStorage : sessionStorage).setItem("ichiro-admin", clave);
      } catch { /* */ }
      $("#login-clave").value = "";
      entrar();
    } catch (err) {
      $("#login-error").textContent = err.message; $("#login-error").hidden = false;
      $("#login").hidden = false;
    } finally { boton.disabled = false; }
  });

  // ---------------------------------------------------------------- Navegación
  let tab = "pedidos";
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    irA(b.dataset.tab);
  });
  function irA(t) {
    tab = t;
    document.querySelectorAll("#tabs button").forEach((b) => {
      if (b.dataset.tab === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".vista").forEach((v) => (v.hidden = v.id !== "v-" + t));
    ({ pedidos: cargarPedidos, dia: cargarDia, carta: cargarCarta, ajustes: cargarAjustes })[t]();
  }

  let refresco = 0;
  async function entrar() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    await conError(cargarInterruptores)();
    irA("pedidos");
    clearInterval(refresco);
    refresco = setInterval(() => { if (tab === "pedidos" && !document.hidden) cargarPedidos(true); else contarPendientes(); }, 30000);
  }

  // ---------------------------------------------------------------- Abrir / cerrar pedidos
  let ajustes = {};
  async function cargarInterruptores() {
    ajustes = await api("ajustes");
    pintarInterruptores();
  }
  function pintarInterruptores() {
    $("#interruptores").innerHTML = [["mediodia", "Pokes del mediodía"], ["finde", "Pedidos del finde"]].map(([t, n]) => {
      const ab = !!ajustes["pedidos_" + t];
      return `<div class="switch ${ab ? "abierto" : "cerrado"}">
        <b>${n}</b><span class="estado">${ab ? "Abiertos" : "Cerrados"}</span>
        <button class="btn" data-turno="${t}">${ab ? "Cerrar" : "Abrir"}</button></div>`;
    }).join("");
  }
  $("#interruptores").addEventListener("click", conError(async (e) => {
    const b = e.target.closest("button[data-turno]"); if (!b) return;
    const clave_ = "pedidos_" + b.dataset.turno;
    const nuevo = !ajustes[clave_];
    if (!nuevo && !confirm(`¿Cerrar los ${b.dataset.turno === "finde" ? "pedidos del finde" : "pedidos de pokes"}? En la web se van a ver como «cerrados por ahora».`)) return;
    b.disabled = true;
    await api("ajustes", { method: "POST", body: { [clave_]: nuevo } });
    ajustes[clave_] = nuevo;
    pintarInterruptores();
    toast(nuevo ? "Pedidos abiertos en la web" : "Pedidos cerrados en la web");
  }));

  // ---------------------------------------------------------------- Pedidos
  let filtro = "activos";
  let pedidos = [];
  $("#filtros").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    filtro = b.dataset.f;
    document.querySelectorAll("#filtros button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    cargarPedidos();
  });

  async function contarPendientes() {
    try {
      const p = await api("pedidos?estado=pendiente");
      marcarPendientes(p.length);
    } catch { /* */ }
  }
  let pendientesAntes = null;
  function marcarPendientes(n) {
    const b = $("#badge");
    b.textContent = n; b.hidden = !n;
    document.title = (n ? `(${n}) ` : "") + "Panel · Ichiro Sushiya";
    if (pendientesAntes !== null && n > pendientesAntes) toast(n - pendientesAntes === 1 ? "Entró un pedido nuevo" : `Entraron ${n - pendientesAntes} pedidos nuevos`);
    pendientesAntes = n;
  }

  async function cargarPedidos(silencioso = false) {
    try {
      const desde = filtro === "cerrados" ? sumarDias(hoyAR(), -30) : "";
      pedidos = await api(`pedidos?estado=${filtro}${desde ? "&desde=" + desde : ""}`);
      if (filtro === "activos") marcarPendientes(pedidos.filter((p) => p.estado === "pendiente").length);
      else contarPendientes();
      pintarPedidos();
    } catch (e) { if (!silencioso && clave) toast(e.message, true); }
  }

  // Teléfono argentino → número de WhatsApp (549 + área + número)
  function numeroWa(tel) {
    let d = String(tel).replace(/\D/g, "");
    if (d.startsWith("549")) return d;
    if (d.startsWith("54")) return "549" + d.slice(2);
    if (d.startsWith("0")) d = d.slice(1);
    // 221 15 555-1234 → 2215551234 (solo si sobran justo los 2 dígitos del 15)
    if (d.length === 12) d = d.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
    return "549" + d;
  }
  function mensajeWa(p) {
    const items = p.items.map((i) => `• ${i.cantidad} × ${i.categoria} ${i.nombre}`).join("\n");
    const entrega = p.modalidad === "envio" ? `Lo enviamos a ${p.direccion}.` : "Lo retirás en el local.";
    if (p.estado === "rechazado" || p.estado === "cancelado") {
      return `¡Hola ${p.nombre}! Te escribimos de Ichiro Sushiya por tu pedido #${p.id} del ${fechaLarga(p.fecha).toLowerCase()}: lamentablemente no lo vamos a poder hacer. Disculpá las molestias.`;
    }
    return `¡Hola ${p.nombre}! Te confirmamos tu pedido #${p.id} de Ichiro Sushiya para el ${fechaLarga(p.fecha).toLowerCase()} a las ${p.horario}:\n\n${items}\n\nTotal: ${precio(p.total)}. ${entrega} ¡Gracias!`;
  }
  const linkWa = (p) => `https://wa.me/${numeroWa(p.telefono)}?text=${encodeURIComponent(mensajeWa(p))}`;

  function tarjetaPedido(p) {
    const acciones = {
      pendiente: `<button class="btn primario" data-accion="confirmado" data-id="${p.id}">Confirmar</button>
                  <button class="btn peligro" data-accion="rechazado" data-id="${p.id}">Rechazar</button>`,
      confirmado: `<a class="btn wa" href="${esc(linkWa(p))}" target="_blank" rel="noopener">Avisar por WhatsApp</a>
                   <button class="btn" data-accion="entregado" data-id="${p.id}">Entregado</button>
                   <button class="btn peligro" data-accion="cancelado" data-id="${p.id}">Cancelar</button>`,
      entregado: "",
      rechazado: `<a class="btn" href="${esc(linkWa(p))}" target="_blank" rel="noopener">Avisar por WhatsApp</a>`,
      cancelado: `<a class="btn" href="${esc(linkWa(p))}" target="_blank" rel="noopener">Avisar por WhatsApp</a>`,
    }[p.estado];
    const mapa = p.modalidad === "envio" ? `<a href="https://maps.google.com/?q=${encodeURIComponent(p.direccion)}" target="_blank" rel="noopener">${esc(p.direccion)}</a>` : "";
    return `<article class="ped ${p.estado}">
      <div class="ped-head"><span class="hora">${esc(p.horario)}</span><span class="estado ${p.estado}">${p.estado}</span></div>
      <div class="cliente">
        <b>#${p.id} · ${esc(p.nombre)}</b>
        <a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a>
        <span>${p.modalidad === "envio" ? "Envío: " + mapa : "Retira en el local"}</span>
      </div>
      <ul class="items">
        ${p.items.map((i) => `<li><span>${i.cantidad} × ${esc(i.categoria)} ${esc(i.nombre)}</span><span>${precio(i.precio * i.cantidad)}</span></li>`).join("")}
        ${p.envio ? `<li><span>Envío</span><span>${precio(p.envio)}</span></li>` : ""}
        <li class="total"><span>Total</span><span>${precio(p.total)}</span></li>
      </ul>
      ${p.notas ? `<p class="nota">${esc(p.notas)}</p>` : ""}
      ${acciones ? `<div class="ped-acciones">${acciones}</div>` : ""}
    </article>`;
  }

  function pintarPedidos() {
    const lista = $("#pedidos-lista");
    if (!pedidos.length) {
      lista.innerHTML = `<div class="vacio">${{ activos: "No hay pedidos pendientes ni confirmados.", pendiente: "No hay pedidos para confirmar.", confirmado: "No hay pedidos confirmados por entregar.", cerrados: "No hay pedidos cerrados en los últimos 30 días." }[filtro]}</div>`;
      return;
    }
    const porDia = {};
    for (const p of pedidos) (porDia[p.fecha] ||= []).push(p);
    lista.innerHTML = Object.entries(porDia).map(([f, ps]) => {
      const total = ps.filter((p) => p.estado !== "rechazado" && p.estado !== "cancelado").reduce((s, p) => s + p.total, 0);
      return `<div class="dia-grupo"><h3>${fechaLarga(f)}${f === hoyAR() ? " · hoy" : ""}<small>${ps.length} ${ps.length === 1 ? "pedido" : "pedidos"} · ${precio(total)}</small></h3>
        <div class="grilla">${ps.map(tarjetaPedido).join("")}</div></div>`;
    }).join("");
  }

  $("#pedidos-lista").addEventListener("click", conError(async (e) => {
    const b = e.target.closest("button[data-accion]"); if (!b) return;
    const estado = b.dataset.accion;
    const id = Number(b.dataset.id);
    const preguntas = { rechazado: "¿Rechazar este pedido? Se devuelve el stock.", cancelado: "¿Cancelar este pedido confirmado? Se devuelve el stock." };
    if (preguntas[estado] && !confirm(preguntas[estado])) return;
    b.disabled = true;
    const p = await api("estado", { method: "POST", body: { id, estado } });
    const i = pedidos.findIndex((x) => x.id === id);
    if (i >= 0) pedidos[i] = p;
    if (filtro === "pendiente" && estado !== "pendiente") pedidos = pedidos.filter((x) => x.id !== id || estado === "confirmado");
    pintarPedidos();
    contarPendientes();
    toast({ confirmado: "Confirmado. Avisale por WhatsApp con el botón verde.", rechazado: "Pedido rechazado", entregado: "Marcado como entregado", cancelado: "Pedido cancelado" }[estado]);
  }));

  // ---------------------------------------------------------------- Stock del día
  let diaSel = hoyAR();
  let dia = null;

  function pintarFechasDia() {
    const hoy = hoyAR();
    const fechas = Array.from({ length: 15 }, (_, i) => sumarDias(hoy, i));
    $("#dia-fechas").innerHTML = fechas.map((f) =>
      `<button data-fecha="${f}" aria-pressed="${f === diaSel}">${fechaCorta(f)}<small>${turnoDe(f) === "finde" ? "Finde" : "Pokes"}</small></button>`).join("");
    // Copiar desde: otros días del mismo turno (para atrás y para adelante)
    const opciones = Array.from({ length: 22 }, (_, i) => sumarDias(hoy, i - 7)).filter((f) => f !== diaSel && turnoDe(f) === turnoDe(diaSel));
    $("#dia-copiar-desde").innerHTML = `<option value="">Copiar de otro día…</option>` + opciones.map((f) => `<option value="${f}">${fechaLarga(f)}</option>`).join("");
  }
  $("#dia-fechas").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-fecha]"); if (!b) return;
    diaSel = b.dataset.fecha;
    cargarDia();
  });

  const cargarDia = conError(async () => {
    pintarFechasDia();
    dia = await api("dia?fecha=" + diaSel);
    pintarDia();
  });

  function pintarDia() {
    const pokes = dia.turno === "mediodia";
    $("#dia-titulo").textContent = fechaLarga(dia.fecha);
    $("#dia-sub").textContent = pokes
      ? "Marcá los pokes que hay ese día. Stock vacío = sin límite."
      : "Todo lo activo se puede pedir. Poné stock solo a lo que tenga límite (vacío = sin límite, 0 = agotado).";
    if (!dia.productos.length) {
      $("#dia-lista").innerHTML = `<div class="vacio">No hay productos de ${pokes ? "pokes" : "finde"} en la carta. Agregalos en la pestaña Carta.</div>`;
      return;
    }
    const cab = `<div class="fila cab ${pokes ? "con-check" : ""}">${pokes ? "<span></span>" : ""}<span>Producto</span><span>Stock</span><span style="text-align:right">Vendidos</span></div>`;
    $("#dia-lista").innerHTML = cab + dia.productos.map((p) => `
      <div class="fila ${pokes ? "con-check" : ""} ${p.activo ? "" : "inactivo"}" data-id="${p.id}" data-cargado="${p.cargado}">
        ${pokes ? `<input type="checkbox" class="ofrece" ${p.cargado ? "checked" : ""} aria-label="Hay ${esc(p.nombre)} ese día">` : ""}
        <span class="nom">${esc(p.nombre)}<small>${esc(p.categoria)}${p.activo ? "" : " · desactivado"}</small></span>
        <input type="number" class="stock" min="0" step="1" inputmode="numeric" placeholder="Sin límite" value="${p.stock ?? ""}" aria-label="Stock de ${esc(p.nombre)}">
        <span class="vend">${p.vendidos}${p.stock != null ? ` de ${p.stock}` : ""}</span>
      </div>`).join("");
  }
  // En pokes, escribir un stock marca el producto como ofrecido
  $("#dia-lista").addEventListener("input", (e) => {
    if (!e.target.classList.contains("stock")) return;
    const ch = $(".ofrece", e.target.closest(".fila"));
    if (ch && e.target.value !== "") ch.checked = true;
  });

  $("#dia-guardar").onclick = conError(async (e) => {
    const pokes = dia.turno === "mediodia";
    const filas = [...document.querySelectorAll("#dia-lista .fila[data-id]")].map((f) => {
      const stock = $(".stock", f).value.trim();
      const cargado = pokes ? $(".ofrece", f).checked : stock !== "" || f.dataset.cargado === "true";
      return { id: Number(f.dataset.id), cargado, stock: stock === "" ? null : Number(stock) };
    });
    e.target.disabled = true;
    try {
      dia = await api("dia", { method: "POST", body: { fecha: dia.fecha, filas } });
      pintarDia();
      toast("Día guardado");
    } finally { e.target.disabled = false; }
  });

  $("#dia-copiar").onclick = conError(async () => {
    const desde = $("#dia-copiar-desde").value;
    if (!desde) return toast("Elegí de qué día copiar", true);
    if (!confirm(`¿Copiar lo cargado el ${fechaLarga(desde).toLowerCase()} al ${fechaLarga(diaSel).toLowerCase()}?`)) return;
    dia = await api("copiar-dia", { method: "POST", body: { desde, hasta: diaSel } });
    pintarDia();
    toast("Copiado");
  });

  // ---------------------------------------------------------------- Carta
  let carta = { categorias: [], productos: [] };
  const cargarCarta = conError(async () => {
    carta = await api("carta");
    pintarCarta();
  });

  function pintarCarta() {
    $("#carta-lista").innerHTML = carta.categorias.map((c) => {
      const prods = carta.productos.filter((p) => p.categoria_id === c.id);
      return `<div class="cat ${c.activa ? "" : "inactiva"}">
        <div class="cat-head">
          <h3>${esc(c.nombre)}</h3><span class="turno">${NOMBRE_TURNO[c.turno]}</span>${c.activa ? "" : `<span class="turno">Desactivada</span>`}
          <span class="sp"></span>
          <button class="btn" data-editar-cat="${c.id}">Editar categoría</button>
          <button class="btn primario" data-nuevo-prod="${c.id}">+ Producto</button>
        </div>
        ${prods.length ? prods.map((p) => `
          <div class="prod ${p.activo ? "" : "inactivo"}">
            <span class="nom">${p.foto ? `<img class="mini" src="${esc(p.foto)}" alt="" loading="lazy">` : ""}${esc(p.nombre)}<small>${esc(p.descripcion)}</small></span>
            <label class="precio"><input type="number" min="0" step="1" inputmode="numeric" value="${p.precio}" data-precio="${p.id}" aria-label="Precio de ${esc(p.nombre)}"></label>
            <label class="check activo-wrap"><input type="checkbox" data-activo="${p.id}" ${p.activo ? "checked" : ""}> Activo</label>
            <button class="editar" data-editar-prod="${p.id}">Editar</button>
          </div>`).join("") : `<p class="sin-prod">Sin productos todavía.</p>`}
      </div>`;
    }).join("") || `<div class="vacio">No hay categorías. Creá la primera.</div>`;
  }

  async function guardarProducto(p) {
    const fila = await api("producto", { method: "POST", body: p });
    const i = carta.productos.findIndex((x) => x.id === fila.id);
    if (i >= 0) carta.productos[i] = fila; else carta.productos.push(fila);
    return fila;
  }

  // Precio y activo, directo desde la lista
  $("#carta-lista").addEventListener("change", conError(async (e) => {
    const t = e.target;
    if (t.dataset.precio) {
      const p = carta.productos.find((x) => x.id === Number(t.dataset.precio));
      const nuevo = Number(t.value);
      if (!Number.isInteger(nuevo) || nuevo < 0) { t.value = p.precio; return toast("El precio tiene que ser un número entero, sin puntos", true); }
      await guardarProducto({ ...p, precio: nuevo });
      t.classList.add("guardado");
      setTimeout(() => t.classList.remove("guardado"), 1500);
      toast(`${p.nombre}: ${precio(nuevo)}`);
    }
    if (t.dataset.activo) {
      const p = carta.productos.find((x) => x.id === Number(t.dataset.activo));
      await guardarProducto({ ...p, activo: t.checked });
      pintarCarta();
      toast(t.checked ? `${p.nombre} se ve en la web` : `${p.nombre} ya no se ve en la web`);
    }
  }));
  $("#carta-lista").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.precio) e.target.blur(); });
  $("#carta-lista").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.editarCat) editarCategoria(carta.categorias.find((c) => c.id === Number(b.dataset.editarCat)));
    if (b.dataset.nuevoProd) editarProducto({ categoria_id: Number(b.dataset.nuevoProd), activo: true, precio: "", nombre: "", descripcion: "", orden: 0 });
    if (b.dataset.editarProd) editarProducto(carta.productos.find((p) => p.id === Number(b.dataset.editarProd)));
  });
  $("#nueva-categoria").onclick = () => editarCategoria({ nombre: "", jp: "", turno: "finde", activa: true, orden: carta.categorias.length });

  // ---------------------------------------------------------------- Diálogo de edición
  const dlg = $("#dlg");
  let alGuardar = null, alBorrar = null;
  function abrirDialogo(titulo, campos, guardar, borrar) {
    $("#dlg-titulo").textContent = titulo;
    $("#dlg-campos").innerHTML = campos;
    $("#dlg-error").hidden = true;
    $("#dlg-borrar").hidden = !borrar;
    alGuardar = guardar; alBorrar = borrar;
    dlg.showModal();
  }
  const errorDialogo = (m) => { $("#dlg-error").textContent = m; $("#dlg-error").hidden = false; };
  $("#dlg-cancelar").onclick = () => dlg.close();
  $("#dlg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await alGuardar(); dlg.close(); } catch (err) { errorDialogo(err.message); }
  });
  $("#dlg-borrar").onclick = async () => {
    try { if (await alBorrar()) dlg.close(); } catch (err) { errorDialogo(err.message); }
  };

  // ---------------------------------------------------------------- Fotos
  let fotoNueva;      // undefined = no se tocó; "" = sacarla; url = la nueva
  let subiendo = false;

  // Achica la foto en el navegador (máx. 900 px, JPG) antes de subirla: pesa poco y carga rápido
  async function achicar(archivo) {
    const img = await createImageBitmap(archivo).catch(() => null);
    if (!img) throw new Error("No pude abrir esa foto. Probá con un JPG o PNG.");
    const escala = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.84));
  }

  document.addEventListener("change", conError(async (e) => {
    if (e.target.id !== "f-foto" || !e.target.files[0]) return;
    const prev = $("#f-foto-prev");
    subiendo = true;
    prev.textContent = "Subiendo…";
    try {
      const blob = await achicar(e.target.files[0]);
      const r = await fetch("/api/admin/foto", { method: "POST", headers: { "X-Admin-Token": clave, "Content-Type": "image/jpeg" }, body: blob });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "No se pudo subir la foto");
      fotoNueva = res.url;
      prev.textContent = "";
      prev.style.backgroundImage = `url('${res.url}')`;
      $("#f-foto-sacar").hidden = false;
    } catch (err) {
      prev.textContent = "Sin foto";
      throw err;
    } finally {
      subiendo = false;
      e.target.value = "";
    }
  }));
  document.addEventListener("click", (e) => {
    if (e.target.id !== "f-foto-sacar") return;
    fotoNueva = "";
    const prev = $("#f-foto-prev");
    prev.style.backgroundImage = "";
    prev.textContent = "Sin foto";
    e.target.hidden = true;
  });

  function editarProducto(p) {
    fotoNueva = undefined;
    const opciones = carta.categorias.map((c) => `<option value="${c.id}" ${c.id === p.categoria_id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("");
    abrirDialogo(p.id ? "Editar producto" : "Nuevo producto", `
      <label>Categoría<select id="f-cat">${opciones}</select></label>
      <label>Nombre<input id="f-nombre" maxlength="80" value="${esc(p.nombre)}" required></label>
      <label>Descripción<textarea id="f-desc" rows="2" maxlength="300">${esc(p.descripcion)}</textarea></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label>Precio<input id="f-precio" type="number" min="0" step="1" inputmode="numeric" value="${p.precio}" required></label>
        <label>Orden<input id="f-orden" type="number" step="1" value="${p.orden ?? 0}"></label>
      </div>
      <div class="foto-campo">
        <div class="foto-prev" id="f-foto-prev" ${p.foto ? `style="background-image:url('${esc(p.foto)}')"` : ""}>${p.foto ? "" : "Sin foto"}</div>
        <div class="foto-botones">
          <span class="ayuda">Foto <small>(opcional: se ve a la derecha de la tarjeta)</small></span>
          <label class="btn subir">Elegir foto<input type="file" id="f-foto" accept="image/*" hidden></label>
          <button type="button" class="btn" id="f-foto-sacar" ${p.foto ? "" : "hidden"}>Sacar foto</button>
        </div>
      </div>
      <label class="check"><input type="checkbox" id="f-activo" ${p.activo ? "checked" : ""}> Se ve en la web</label>`,
      async () => {
        if (subiendo) throw new Error("Esperá a que termine de subir la foto");
        const datos = {
          id: p.id, categoria_id: Number($("#f-cat").value), nombre: $("#f-nombre").value, descripcion: $("#f-desc").value,
          precio: Number($("#f-precio").value), orden: Number($("#f-orden").value) || 0, activo: $("#f-activo").checked,
          ...(fotoNueva !== undefined ? { foto: fotoNueva } : {}),
        };
        if ($("#f-precio").value === "") throw new Error("Poné el precio");
        await guardarProducto(datos);
        pintarCarta();
        toast("Producto guardado");
      },
      p.id && (async () => {
        if (!confirm(`¿Borrar «${p.nombre}»? Si solo querés esconderlo, desmarcá «Se ve en la web».`)) return false;
        await api("producto?id=" + p.id, { method: "DELETE" });
        carta.productos = carta.productos.filter((x) => x.id !== p.id);
        pintarCarta();
        toast("Producto borrado");
        return true;
      }));
  }

  function editarCategoria(c) {
    abrirDialogo(c.id ? "Editar categoría" : "Nueva categoría", `
      <label>Nombre<input id="f-nombre" maxlength="60" value="${esc(c.nombre)}" required></label>
      <label>En japonés <span class="ayuda">(opcional, se ve al lado del título)</span><input id="f-jp" maxlength="20" value="${esc(c.jp)}" lang="ja"></label>
      <label>¿Cuándo se pide?<select id="f-turno">
        <option value="mediodia" ${c.turno === "mediodia" ? "selected" : ""}>Mediodía · lunes a viernes (se cargan por día)</option>
        <option value="finde" ${c.turno === "finde" ? "selected" : ""}>Finde · sábados y domingos</option>
      </select></label>
      <label>Orden en la carta<input id="f-orden" type="number" step="1" value="${c.orden ?? 0}"></label>
      <label class="check"><input type="checkbox" id="f-activa" ${c.activa ? "checked" : ""}> Se ve en la web</label>`,
      async () => {
        const datos = { id: c.id, nombre: $("#f-nombre").value, jp: $("#f-jp").value, turno: $("#f-turno").value, orden: Number($("#f-orden").value) || 0, activa: $("#f-activa").checked };
        const fila = await api("categoria", { method: "POST", body: datos });
        const i = carta.categorias.findIndex((x) => x.id === fila.id);
        if (i >= 0) carta.categorias[i] = fila; else carta.categorias.push(fila);
        carta.categorias.sort((a, b) => a.orden - b.orden || a.id - b.id);
        pintarCarta();
        toast("Categoría guardada");
      },
      c.id && (async () => {
        if (carta.productos.some((p) => p.categoria_id === c.id)) throw new Error("Primero borrá o mové sus productos a otra categoría.");
        if (!confirm(`¿Borrar la categoría «${c.nombre}»?`)) return false;
        await api("categoria?id=" + c.id, { method: "DELETE" });
        carta.categorias = carta.categorias.filter((x) => x.id !== c.id);
        pintarCarta();
        toast("Categoría borrada");
        return true;
      }));
  }

  // ---------------------------------------------------------------- Ajustes
  const cargarAjustes = conError(async () => {
    ajustes = await api("ajustes");
    pintarInterruptores();
    const t = ajustes.textos || {};
    const campo = (id, etiqueta, valor, extra = "") => `<label>${etiqueta}<input id="${id}" value="${esc(valor ?? "")}" ${extra}></label>`;
    $("#ajustes-form").innerHTML = `
      <fieldset><legend>Pedidos</legend>
        <label class="check"><input type="checkbox" id="a-pm" ${ajustes.pedidos_mediodia ? "checked" : ""}> Se pueden pedir pokes (lunes a viernes)</label>
        <label class="check"><input type="checkbox" id="a-pf" ${ajustes.pedidos_finde ? "checked" : ""}> Se puede pedir para el finde (sábados y domingos)</label>
        <div class="dos">
          ${campo("a-dias", "Días para adelante que se pueden pedir", ajustes.dias_adelante, 'type="number" min="0" max="30"')}
          ${campo("a-antic", "Horas de anticipación mínima", ajustes.anticipacion_horas, 'type="number" min="0" max="72"')}
        </div>
        ${campo("a-envio", "Costo del envío (0 = «se coordina»)", ajustes.costo_envio, 'type="number" min="0" step="1"')}
      </fieldset>
      <fieldset><legend>Horarios que se pueden elegir</legend>
        ${campo("a-fm", 'Mediodía <span class="ayuda">separados por coma, ej: 12:00, 12:30, 13:00</span>', (ajustes.franjas_mediodia || []).join(", "))}
        ${campo("a-ff", 'Finde <span class="ayuda">separados por coma</span>', (ajustes.franjas_finde || []).join(", "))}
      </fieldset>
      <fieldset><legend>Textos de la web</legend>
        <div class="dos">
          ${campo("t-md", "Mediodía · días", t.mediodia_dias, 'maxlength="60"')}
          ${campo("t-mt", "Mediodía · título", t.mediodia_titulo, 'maxlength="60"')}
          ${campo("t-mh", "Mediodía · horario", t.mediodia_horario, 'maxlength="60"')}
          ${campo("t-me", "Mediodía · etiqueta", t.mediodia_etiqueta, 'maxlength="60"')}
          ${campo("t-fd", "Finde · días", t.finde_dias, 'maxlength="60"')}
          ${campo("t-ft", "Finde · título", t.finde_titulo, 'maxlength="60"')}
          ${campo("t-fh", "Finde · horario", t.finde_horario, 'maxlength="60" placeholder="Ej: 20:00 a 23:00 hs"')}
          ${campo("t-fe", "Finde · etiqueta", t.finde_etiqueta, 'maxlength="60"')}
        </div>
        ${campo("a-aviso", "Aviso debajo de los horarios", ajustes.aviso, 'maxlength="200"')}
      </fieldset>
      <fieldset><legend>Contacto</legend>
        <div class="dos">
          ${campo("a-wa", 'WhatsApp <span class="ayuda">solo números, con 549</span>', ajustes.whatsapp, 'inputmode="numeric"')}
          ${campo("a-ig", "Instagram (sin @)", ajustes.instagram)}
        </div>
        ${campo("a-mail", 'Mail que recibe el aviso de cada pedido', ajustes.mail_avisos, 'type="email"')}
      </fieldset>
      <div class="pie"><button class="btn primario" type="submit">Guardar ajustes</button></div>`;
  });

  $("#ajustes-form").addEventListener("submit", conError(async (e) => {
    e.preventDefault();
    const v = (id) => $("#" + id).value.trim();
    const franjas = (id) => v(id).split(/[,\s]+/).filter(Boolean).map((h) => h.replace(/^(\d):/, "0$1:"));
    const datos = {
      pedidos_mediodia: $("#a-pm").checked, pedidos_finde: $("#a-pf").checked,
      dias_adelante: Number(v("a-dias")), anticipacion_horas: Number(v("a-antic")), costo_envio: Number(v("a-envio")),
      franjas_mediodia: franjas("a-fm"), franjas_finde: franjas("a-ff"),
      textos: {
        mediodia_dias: v("t-md"), mediodia_titulo: v("t-mt"), mediodia_horario: v("t-mh"), mediodia_etiqueta: v("t-me"),
        finde_dias: v("t-fd"), finde_titulo: v("t-ft"), finde_horario: v("t-fh"), finde_etiqueta: v("t-fe"),
      },
      aviso: v("a-aviso"), whatsapp: v("a-wa").replace(/\D/g, ""), instagram: v("a-ig").replace(/^@/, ""), mail_avisos: v("a-mail"),
    };
    const boton = e.submitter; boton.disabled = true;
    try {
      await api("ajustes", { method: "POST", body: datos });
      ajustes = { ...ajustes, ...datos };
      pintarInterruptores();
      toast("Ajustes guardados");
    } finally { boton.disabled = false; }
  }));

  // ---------------------------------------------------------------- Arranque
  if (clave) {
    api("ping").then(entrar).catch(() => {});
  }
})();
