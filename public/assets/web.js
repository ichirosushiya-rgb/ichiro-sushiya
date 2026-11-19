// La web de Ichiro Sushiya: la carta, el carrito y el pedido.
//
// La carta, los precios, los textos de horarios y lo que queda de cada día salen de la base
// (/api/carta, lo que se carga en el panel). Si la base no responde, se usa la carta de
// assets/menu.js y el pedido se manda armado por WhatsApp, como antes: la web nunca queda vacía.

(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const precio = (n) => "$" + Number(n).toLocaleString("es-AR");
  const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const DIAS_LARGOS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const fechaCorta = (f) => { const d = new Date(f + "T12:00:00"); return `${DIAS[d.getDay()]} ${d.getDate()}`; };
  const fechaLarga = (f) => { const d = new Date(f + "T12:00:00"); return `${DIAS_LARGOS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

  // ---------------------------------------------------------------- Datos
  let C = null; // la carta de la base
  async function cargar() {
    try {
      const r = await fetch("/api/carta", { cache: "no-store" });
      if (r.ok) C = await r.json();
    } catch { /* sin base: modo WhatsApp */ }
  }
  await cargar();
  const enLinea = () => !!C;

  const L = window.ICHIRO; // carta de respaldo
  const ajustes = () => (C ? C.ajustes : {
    whatsapp: L.whatsapp, instagram: L.instagram, aviso: L.aviso, textos: {},
  });

  // Categorías con sus productos en un solo formato
  function categorias() {
    if (C) return C.categorias.filter((c) => c.productos.length);
    return L.categorias.map((c) => ({
      id: c.id, nombre: c.nombre, jp: c.jp, turno: "finde",
      productos: c.items.map((it, i) => ({ id: c.id + "-" + i, nombre: it.n, descripcion: it.d, precio: it.p })),
    }));
  }
  const productos = () => categorias().flatMap((c) => c.productos.map((p) => ({ ...p, cat: c.nombre, catId: c.id, turno: c.turno })));
  const producto = (id) => productos().find((p) => String(p.id) === String(id));

  // ¿Qué días se puede pedir este producto, y cuántos quedan?
  function diasDe(p) {
    if (!C) return [];
    return C.dias.filter((d) => {
      if (d.turno !== p.turno || !d.abierto) return false;
      const k = String(p.id);
      if (p.turno === "mediodia" && !(k in d.quedan)) return false; // los pokes, solo los días cargados
      return !(k in d.quedan) || d.quedan[k] === null || d.quedan[k] > 0;
    }).filter((d) => franjasLibres(d.fecha, d.turno).length);
  }
  const quedan = (p, fecha) => {
    const d = C.dias.find((x) => x.fecha === fecha);
    const v = d && d.quedan[String(p.id)];
    return v === undefined || v === null ? Infinity : v;
  };
  const turnoAbierto = (t) => !C || !!C.ajustes["pedidos_" + t];

  // Ahora en Argentina, para no ofrecer horarios que ya pasaron
  function ahoraAR() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
  }
  function franjasLibres(fecha, turno) {
    const lista = (C && C.ajustes["franjas_" + turno]) || [];
    const ahora = ahoraAR();
    const margen = (Number(C && C.ajustes.anticipacion_horas) || 0) * 60;
    // Días siguientes: todas. Hoy: solo las que llegan con la anticipación pedida.
    return lista.filter((h) => {
      if (fecha > ahora.fecha) return true;
      if (fecha < ahora.fecha) return false;
      const [hh, mm] = h.split(":").map(Number);
      return hh * 60 + mm >= ahora.minutos + margen;
    });
  }

  // ---------------------------------------------------------------- Textos y contacto
  function pintarTextos() {
    const A = ajustes();
    const T = { aviso: A.aviso, ...(A.textos || {}) };
    document.querySelectorAll("[data-t]").forEach((el) => {
      const v = T[el.dataset.t];
      if (v === undefined) return;
      el.textContent = v;
      el.hidden = !v;
    });
    if (C) {
      $("#carta-ayuda").innerHTML ="Sumá lo que quieras con <b>+</b> y hacé tu pedido acá mismo. Te lo confirmamos por WhatsApp.";
    }
    const wa = A.whatsapp || L.whatsapp;
    const waLabel = wa.replace(/^549?(\d{3})(\d{3})(\d{4})$/, "+54 9 $1 $2-$3");
    document.querySelectorAll(".js-wa").forEach((a) => (a.href = `https://wa.me/${wa}?text=` + encodeURIComponent("¡Hola Ichiro Sushiya! Quiero hacer un pedido.")));
    document.querySelectorAll(".js-ig").forEach((a) => (a.href = "https://instagram.com/" + (A.instagram || L.instagram)));
    document.querySelectorAll(".js-wa-label").forEach((s) => (s.textContent = waLabel));
    document.querySelectorAll(".js-ig-label").forEach((s) => (s.textContent = "@" + (A.instagram || L.instagram)));
  }

  // ---------------------------------------------------------------- Carta
  const carrito = {};
  let filtro = "todo";
  const tabs = $("#tabs");
  const grid = $("#grid");

  function pintarTabs() {
    const cats = categorias();
    if (filtro !== "todo" && !cats.some((c) => String(c.id) === filtro)) filtro = "todo";
    tabs.innerHTML = [{ id: "todo", nombre: "Todo" }, ...cats]
      .map((c) => `<button data-cat="${esc(c.id)}" aria-pressed="${String(c.id) === filtro}">${esc(c.nombre)}</button>`).join("");
  }
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filtro = b.dataset.cat;
    tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    pintar();
  });

  function pintar() {
    const cats = categorias().filter((c) => filtro === "todo" || String(c.id) === filtro);
    grid.innerHTML = cats.map((c) => {
      const cerrado = enLinea() && !turnoAbierto(c.turno)
        ? `<p class="cerrado">${c.turno === "mediodia" ? "Los pedidos de pokes" : "Los pedidos del finde"} están cerrados por ahora.</p>` : "";
      return `<div class="grupo" id="sec-${esc(c.id)}">
        <div class="subtitulo"><h3>${esc(c.nombre)}</h3><span lang="ja">${esc(c.jp)}</span><small>${c.productos.length} ${c.productos.length === 1 ? "opción" : "opciones"}</small></div>
        ${cerrado}
        <div class="grid">${c.productos.map((p) => tarjeta({ ...p, cat: c.nombre, turno: c.turno })).join("")}</div>
      </div>`;
    }).join("") || `<p class="cerrado">Todavía no hay productos cargados.</p>`;
  }

  function tarjeta(p) {
    const q = carrito[p.id] || 0;
    let extra = "", disponible = true;
    if (enLinea()) {
      const dias = diasDe(p);
      disponible = dias.length > 0;
      if (p.turno === "mediodia" && disponible) {
        extra = `<div class="dias">${dias.slice(0, 5).map((d) => `<span>${fechaCorta(d.fecha)}</span>`).join("")}</div>`;
      } else if (!disponible && turnoAbierto(p.turno)) {
        extra = `<span class="agotado">${p.turno === "mediodia" ? "No hay días cargados esta semana" : "Agotado por ahora"}</span>`;
      }
    }
    return `<article class="card ${disponible ? "" : "no-disp"}">
      <h4>${esc(p.nombre)}</h4>
      <p>${esc(p.descripcion)}</p>
      ${extra}
      <div class="pie">
        <span class="precio">${precio(p.precio)}</span>
        <div class="qty ${q ? "activa" : ""}" data-id="${esc(p.id)}">
          <button class="menos" aria-label="Quitar ${esc(p.nombre)}">−</button>
          <span>${q}</span>
          <button class="mas" aria-label="Agregar ${esc(p.nombre)}" ${disponible ? "" : "disabled"}>+</button>
        </div>
      </div>
    </article>`;
  }

  let toastHasta = 0;
  function aviso(txt) {
    const t = $("#toast");
    t.textContent = txt; t.hidden = false;
    toastHasta = Date.now() + 4000;
    setTimeout(() => { if (Date.now() >= toastHasta) t.hidden = true; }, 4100);
  }

  grid.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const id = b.parentElement.dataset.id;
    const p = producto(id);
    if (!p) return;
    if (b.classList.contains("mas")) {
      const otro = Object.keys(carrito).map(producto).find((x) => x && x.turno !== p.turno);
      if (enLinea() && otro) {
        aviso("Los pokes (lunes a viernes) y el sushi del finde van en pedidos separados. Terminá este pedido y después armá el otro.");
        return;
      }
      carrito[id] = (carrito[id] || 0) + 1;
    } else {
      carrito[id] = Math.max(0, (carrito[id] || 0) - 1);
      if (!carrito[id]) delete carrito[id];
    }
    pintar(); actualizar();
  });

  // ---------------------------------------------------------------- Barra del pedido
  const barra = $("#pedido");
  const seleccion = () => Object.entries(carrito).map(([id, cant]) => ({ p: producto(id), cant })).filter((x) => x.p);

  function actualizar() {
    for (const id of Object.keys(carrito)) if (!producto(id)) delete carrito[id]; // ya no está en la carta
    const sel = seleccion();
    const cant = sel.reduce((s, x) => s + x.cant, 0);
    const total = sel.reduce((s, x) => s + x.cant * x.p.precio, 0);
    barra.classList.toggle("visible", cant > 0);
    if (!cant) barra.classList.remove("abierto");
    $("#res-cant").textContent = cant + (cant === 1 ? " producto" : " productos");
    $("#res-total").textContent = precio(total);
    $("#detalle-lista").innerHTML = sel.map((x) =>
      `<li><span>${x.cant} × ${esc(x.p.cat)} ${esc(x.p.nombre)}</span><b>${precio(x.cant * x.p.precio)}</b></li>`).join("");

    const enviar = $("#enviar");
    if (enLinea()) {
      enviar.removeAttribute("target");
      enviar.href = "#";
      $("#enviar-txt").textContent = "Continuar";
    } else {
      const msg = "¡Hola Ichiro Sushiya! Quiero hacer este pedido:\n\n" +
        sel.map((x) => `• ${x.cant} × ${x.p.cat} ${x.p.nombre} — ${precio(x.cant * x.p.precio)}`).join("\n") +
        `\n\nTotal: ${precio(total)}\n\nDía y horario: `;
      enviar.target = "_blank";
      enviar.href = `https://wa.me/${ajustes().whatsapp || L.whatsapp}?text=` + encodeURIComponent(msg);
    }
  }
  $("#ver").onclick = () => barra.classList.toggle("abierto");
  $("#vaciar").onclick = () => { for (const k in carrito) delete carrito[k]; pintar(); actualizar(); };
  $("#enviar").addEventListener("click", (e) => {
    if (!enLinea()) return; // modo WhatsApp: sigue el link
    e.preventDefault();
    abrirCheckout();
  });

  // ---------------------------------------------------------------- Formulario del pedido
  const dlg = $("#checkout");
  const turnoCarrito = () => seleccion()[0]?.p.turno;

  // Días en que se puede pedir TODO lo del carrito, con las cantidades elegidas
  function fechasPosibles() {
    const sel = seleccion();
    const turno = turnoCarrito();
    return C.dias.filter((d) => d.turno === turno && d.abierto && franjasLibres(d.fecha, turno).length &&
      sel.every((x) => diasDe(x.p).some((y) => y.fecha === d.fecha) && quedan(x.p, d.fecha) >= x.cant));
  }

  function pintarFechas() {
    const sel = $("#co-fecha");
    const antes = sel.value;
    const fechas = fechasPosibles();
    sel.innerHTML = fechas.map((d) => `<option value="${d.fecha}">${fechaLarga(d.fecha)}${d.fecha === C.hoy ? " (hoy)" : ""}</option>`).join("");
    if (fechas.some((d) => d.fecha === antes)) sel.value = antes;
    pintarHorarios();
    if (!fechas.length) {
      mostrarError(turnoCarrito() === "mediodia"
        ? "No hay un día con todos estos pokes disponibles. Probá sacando alguno o bajando cantidades."
        : "No hay un día con stock para todo el pedido. Probá bajando cantidades.");
    }
    return fechas.length > 0;
  }
  function pintarHorarios() {
    const f = $("#co-fecha").value;
    const sel = $("#co-horario");
    const antes = sel.value;
    const lista = f ? franjasLibres(f, turnoCarrito()) : [];
    sel.innerHTML = lista.map((h) => `<option>${h}</option>`).join("");
    if (lista.includes(antes)) sel.value = antes;
  }
  function pintarTotal() {
    const sub = seleccion().reduce((s, x) => s + x.cant * x.p.precio, 0);
    const costo = Number(C.ajustes.costo_envio) || 0;
    const envio = modalidad() === "envio" ? costo : 0;
    $("#co-envio-precio").textContent = costo ? `(+${precio(costo)})` : "(se coordina)";
    $("#co-total").textContent = precio(sub + envio);
    $("#co-dir-wrap").hidden = modalidad() !== "envio";
  }
  const modalidad = () => dlg.querySelector("input[name=modalidad]:checked").value;
  function mostrarError(txt) {
    const e = $("#co-error");
    e.textContent = txt || ""; e.hidden = !txt;
  }

  function abrirCheckout() {
    mostrarError("");
    $("#co-form").hidden = false;
    $("#co-listo").hidden = true;
    $("#co-items").innerHTML = seleccion().map((x) =>
      `<li><span>${x.cant} × ${esc(x.p.cat)} ${esc(x.p.nombre)}</span><b>${precio(x.cant * x.p.precio)}</b></li>`).join("");
    try {
      const guardado = JSON.parse(localStorage.getItem("ichiro-datos") || "{}");
      if (guardado.nombre && !$("#co-nombre").value) $("#co-nombre").value = guardado.nombre;
      if (guardado.telefono && !$("#co-telefono").value) $("#co-telefono").value = guardado.telefono;
      if (guardado.direccion && !$("#co-direccion").value) $("#co-direccion").value = guardado.direccion;
    } catch { /* sin almacenamiento */ }
    pintarFechas();
    pintarTotal();
    dlg.showModal();
  }
  $("#co-fecha").addEventListener("change", pintarHorarios);
  dlg.querySelectorAll("input[name=modalidad]").forEach((r) => r.addEventListener("change", pintarTotal));
  $("#co-cerrar").onclick = () => dlg.close();
  $("#co-listo-cerrar").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  $("#co-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    mostrarError("");
    const datos = {
      nombre: $("#co-nombre").value.trim(),
      telefono: $("#co-telefono").value.trim(),
      fecha: $("#co-fecha").value,
      horario: $("#co-horario").value,
      modalidad: modalidad(),
      direccion: $("#co-direccion").value.trim(),
      notas: $("#co-notas").value.trim(),
      web: $("#co-web").value,
      items: seleccion().map((x) => ({ id: x.p.id, cantidad: x.cant })),
    };
    if (!datos.fecha || !datos.horario) return mostrarError("Elegí el día y el horario.");
    if (datos.nombre.length < 2) return mostrarError("Escribí tu nombre.");
    if (datos.telefono.replace(/\D/g, "").length < 8) return mostrarError("Escribí tu WhatsApp con el código de área.");
    if (datos.modalidad === "envio" && datos.direccion.length < 5) return mostrarError("Escribí la dirección de entrega.");

    const boton = $("#co-enviar");
    boton.disabled = true; boton.textContent = "Enviando…";
    try {
      const r = await fetch("/api/pedido", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || "No pudimos tomar el pedido. Probá de nuevo.");
      try { localStorage.setItem("ichiro-datos", JSON.stringify({ nombre: datos.nombre, telefono: datos.telefono, direccion: datos.direccion })); } catch { /* */ }
      const p = res.pedido || {};
      $("#co-listo-txt").textContent = p.id
        ? `Tu pedido #${p.id} es para el ${fechaLarga(p.fecha).toLowerCase()} a las ${p.horario} (${precio(p.total)}). Te escribimos por WhatsApp para confirmarlo.`
        : "Te escribimos por WhatsApp para confirmarlo.";
      $("#co-form").hidden = true;
      $("#co-listo").hidden = false;
      for (const k in carrito) delete carrito[k];
      await cargar();
      pintarTabs(); pintar(); actualizar();
    } catch (err) {
      mostrarError(err.message);
      await cargar(); // el stock pudo cambiar: se recalcula lo que se puede pedir
      pintar(); actualizar();
      if (seleccion().length) pintarFechas();
    } finally {
      boton.disabled = false; boton.textContent = "Hacer pedido";
    }
  });

  // ---------------------------------------------------------------- Arranque
  pintarTextos();
  pintarTabs();
  pintar();
  actualizar();
})();
