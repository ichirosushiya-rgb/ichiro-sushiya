// Aviso por mail de cada pedido nuevo, con Brevo (gratis hasta 300 mails por día).
//   BREVO_API_KEY    Secret de Cloudflare. Sin ella no se manda nada (y no se rompe nada).
//   MAIL_REMITENTE   (opcional, var) la casilla que figura como remitente; tiene que estar
//                    verificada en Brevo → Senders. Si falta, se usa la misma casilla de avisos.
// La casilla que recibe los avisos se cambia desde el panel: Ajustes → Mail de avisos.

const precio = (n) => "$" + Number(n).toLocaleString("es-AR");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const diaLargo = (f) => {
  const d = new Date(f + "T12:00:00");
  return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
};

export async function avisarPedido(env, pedido, casilla, sitio) {
  if (!env.BREVO_API_KEY || !casilla) {
    console.warn("mail: falta BREVO_API_KEY o la casilla de avisos; no se avisa el pedido", pedido.id);
    return false;
  }
  const filas = pedido.items
    .map((it) => `<tr><td style="padding:4px 0">${it.cantidad} × ${esc(it.categoria)} ${esc(it.nombre)}</td>
      <td style="padding:4px 0;text-align:right">${precio(it.precio * it.cantidad)}</td></tr>`)
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#06063a;max-width:520px">
    <h2 style="margin:0 0 4px">Pedido nuevo #${pedido.id}</h2>
    <p style="margin:0 0 16px;color:#555">Para el <b>${esc(diaLargo(pedido.fecha))} a las ${esc(pedido.horario)}</b> ·
      ${pedido.modalidad === "envio" ? "Envío a " + esc(pedido.direccion) : "Retira en el local"}</p>
    <p style="margin:0 0 16px"><b>${esc(pedido.nombre)}</b> · ${esc(pedido.telefono)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">${filas}
      ${pedido.envio ? `<tr><td style="padding:4px 0">Envío</td><td style="text-align:right">${precio(pedido.envio)}</td></tr>` : ""}
      <tr><td style="padding:8px 0;border-top:1px solid #ddd"><b>Total</b></td>
      <td style="padding:8px 0;border-top:1px solid #ddd;text-align:right"><b>${precio(pedido.total)}</b></td></tr></table>
    ${pedido.notas ? `<p style="background:#f4f3f7;padding:10px;border-radius:8px">Nota: ${esc(pedido.notas)}</p>` : ""}
    <p style="margin-top:20px"><a href="${esc(sitio)}/admin/" style="background:#06063a;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none">Abrir el panel para confirmarlo</a></p>
  </div>`;

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: env.MAIL_REMITENTE || casilla, name: "Ichiro Sushiya" },
        to: [{ email: casilla }],
        subject: `Pedido nuevo #${pedido.id} · ${diaLargo(pedido.fecha)} ${pedido.horario} · ${precio(pedido.total)}`,
        htmlContent: html,
      }),
    });
    if (!res.ok) console.error("mail: Brevo respondió", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("mail: no se pudo avisar el pedido", pedido.id, err.message);
    return false;
  }
}
