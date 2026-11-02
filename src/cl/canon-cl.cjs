#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * CANON CL · copia de los casos de postventa de Canon al Brain
 *
 * SOLO LECTURA EN PIPEFY. Pipefy sigue funcionando igual que hoy; este proceso
 * copia sus tarjetas a bigticket-cl (tabla canon_casos_cl) y las completa con
 * DispatchTrack.
 *
 * DOS FUENTES
 *   formulario  pipe Cuidado al Cliente (306585515): el reclamo del cliente
 *               final. Canon = "Indique donde realizó su compra" = Canontex
 *               (también entra Rosen, marcado en `mandante`).
 *   correo      pipe Postventa Bigticket Chile (303396572): lo que la gente de
 *               Canon escribe a postventa@bigticket.cl. Canon = remitente
 *               @canontex.cl o cliente_1 = Canontex. Siempre va al supervisor.
 *
 *   A ese pipe también llegan las tarjetas que NACEN del formulario (asunto
 *   "C_RM || CUIDADO AL CLIENTE || pedido"). No son casos nuevos: de ellas se
 *   toma el supervisor, el plazo y la respuesta para el caso del formulario.
 *
 * DISPATCHTRACK
 *   Cada pedido (formato 00XXXXXXX) se consulta una vez: región, comuna y
 *   estado. Si Pipefy todavía no tiene CECO, sale de la región:
 *   Metropolitana → C_RM · Valparaiso → C_VIÑA. Otra región: queda vacío.
 *
 * CADA 5 MINUTOS
 *   La primera vuelta copia lo actualizado en los últimos PIPEFY_DIAS días
 *   (60 por defecto). Después, solo lo que cambió desde la vuelta anterior.
 *
 * Uso:
 *   cd /opt/meli-cl && source /root/.pnr_cl_env
 *   node canon-cl.cjs --un-ciclo     ← una vuelta y sale
 *   node canon-cl.cjs                ← residente, cada 5 min
 * ═══════════════════════════════════════════════════════════════════════════ */
const { CL_URL, CL_KEY, PIPEFY_TOKEN, DISPATCHTRACK_TOKEN } = process.env;
if (!CL_URL || !CL_KEY || !PIPEFY_TOKEN || !DISPATCHTRACK_TOKEN) {
  console.error("Faltan variables. Corre primero: source /root/.pnr_cl_env");
  process.exit(1);
}

const PIPE_FORMULARIO = "306585515";
const PIPE_POSTVENTA  = "303396572";
const DT_URL = process.env.DISPATCHTRACK_URL || "https://bigticket.dispatchtrack.com";
const INTERVALO = Number(process.env.CANON_INTERVALO_MS || 300000);
const DIAS_INICIO = Number(process.env.PIPEFY_DIAS || 60);
const UN_CICLO = process.argv.includes("--un-ciclo");

const log = (...a) => console.log(`[canon ${new Date().toISOString()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cab = { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" };

// ── Supabase ───────────────────────────────────────────────────────────────
async function sbGet(path) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, { headers: cab });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: "PATCH", headers: { ...cab, Prefer: "return=minimal" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`patch ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
// Upsert agrupando por columnas: así una fila sin CECO no borra el CECO que
// ya calculó DispatchTrack o que vino de la tarjeta de Postventa.
async function sbUpsert(filas) {
  const grupos = {};
  for (const f of filas) {
    const k = Object.keys(f).sort().join(",");
    (grupos[k] = grupos[k] || []).push(f);
  }
  for (const lote of Object.values(grupos)) {
    for (let i = 0; i < lote.length; i += 100) {
      const r = await fetch(`${CL_URL}/rest/v1/canon_casos_cl?on_conflict=card_id`, {
        method: "POST",
        headers: { ...cab, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(lote.slice(i, i + 100)),
      });
      if (!r.ok) throw new Error(`upsert ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
  }
}

// ── Historial de lo que hace el Biggy (postventa_eventos_cl) ───────────────
// Cada acción queda registrada para el detalle del caso en el Brain. Si falla
// el registro, el trabajo sigue: el historial no puede frenar la operación.
async function evento(card_id, tipo, detalle, tarea_id = null) {
  try {
    await fetch(`${CL_URL}/rest/v1/postventa_eventos_cl`, {
      method: "POST", headers: { ...cab, Prefer: "return=minimal" },
      body: JSON.stringify({ card_id: card_id ? String(card_id) : null, tarea_id, tipo, detalle: String(detalle || "").slice(0, 600) }),
    });
  } catch (e) {}
}

// ── Pipefy (solo lectura) ──────────────────────────────────────────────────
async function pipefy(query, variables) {
  const r = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${PIPEFY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error(`pipefy ${r.status}: ${JSON.stringify(j.errors || j).slice(0, 300)}`);
  return j.data;
}

const Q_CARDS = `query($pipe: ID!, $after: String, $desde: String!) {
  allCards(pipeId: $pipe, first: 50, after: $after,
           filter: { field: "updated_at", operator: gte, value: $desde }) {
    pageInfo { hasNextPage endCursor }
    edges { node { id title created_at updated_at finished_at current_phase { name } fields { field { id } value } } }
  }
}`;

async function tarjetasDesde(pipe, desde) {
  const out = [];
  let after = null;
  for (let pag = 0; pag < 60; pag++) {
    const d = await pipefy(Q_CARDS, { pipe, after, desde });
    for (const e of d.allCards.edges) out.push(e.node);
    if (!d.allCards.pageInfo.hasNextPage) break;
    after = d.allCards.pageInfo.endCursor;
    await sleep(300);
  }
  return out;
}

// ── Lectura de campos ──────────────────────────────────────────────────────
const campos = (card) => Object.fromEntries((card.fields || []).map((f) => [f.field.id, f.value]));
const primeroDeLista = (v) => {
  if (!v) return null;
  try { const a = JSON.parse(v); return Array.isArray(a) ? (a[0] || null) : v; } catch (e) { return v; }
};
// Pedidos de Canon: 9 dígitos que empiezan con 00. Puede venir más de uno.
const pedidosDe = (txt) => [...new Set(String(txt || "").match(/\b00\d{7}\b/g) || [])];
// Saca de los correos las referencias a imágenes y deja el texto legible.
const limpiarCorreo = (t) => String(t || "").replace(/\[cid:[^\]]*\]/g, "").replace(/\n{3,}/g, "\n\n").trim();

function deFormulario(card) {
  const c = campos(card);
  const asunto = c.indique_asunto_para_tarjeta_de_postventa || "";
  const cecoAsunto = (asunto.match(/^\s*(C_[A-ZÑ]+)/i) || [])[1];
  const fila = {
    card_id: String(card.id), canal: "formulario", creado_en: card.created_at,
    fase: card.current_phase ? card.current_phase.name : null, titulo: card.title,
    mandante: c.indique_donde_realiz_su_compra || null,
    pedido: pedidosDe(c.indique_el_id_de_pedido).join(" / ") || (c.indique_el_id_de_pedido || null),
    remitente: c.indique_su_nombre_y_apellido || null, correo: c.correo_electr_nico || null,
    motivo: c.indique_el_motivo_de_su_contacto || null, texto: c.comentarios || null,
    actualizado_en: new Date().toISOString(), raw: card,
  };
  if (card.finished_at) fila.cerrado_en = card.finished_at;
  if (cecoAsunto) fila.ceco = cecoAsunto.toUpperCase();
  // Lo que decidió la ejecutiva, según los campos que llena en la tarjeta.
  const tipo = String(c.tipo_de_reclamo || "").toLowerCase();
  const eje = tipo.includes("postventa") ? "supervisor"
    : tipo.includes("mandante") ? "mandante"
    : /^si/i.test(c.corresponde_a_sugerencia || "") ? "comentario"
    : /^si/i.test(c.caso_corresponde_a_post_venta || "") ? "supervisor"
    : null;
  if (eje) fila.ejecutiva_clasificacion = eje;
  const resp = c.indique_comentarios_para_el_cliente || c.indique_comentarios_para_el_mandante_1 || c.indique_comentarios_para_el_mandante;
  if (resp) fila.respuesta = resp;
  return fila;
}

const esCanonCorreo = (c) =>
  /@canontex\.cl\s*$/i.test(c.correo_solicitante || "") || /canontex/i.test(c.cliente_1 || "");

function deCorreo(card) {
  const c = campos(card);
  const texto = limpiarCorreo(c.descripci_n);
  const fila = {
    card_id: String(card.id), canal: "correo", creado_en: card.created_at,
    fase: card.current_phase ? card.current_phase.name : null, titulo: card.title,
    mandante: c.cliente_1 || "Canontex",
    pedido: pedidosDe(`${c.asunto || ""} ${texto}`).join(" / ") || null,
    remitente: c.remitente || null, correo: c.correo_solicitante || null,
    motivo: c.indique_motivo_1 || c.motivo_1 || null, texto,
    actualizado_en: new Date().toISOString(), raw: card,
  };
  const ceco = primeroDeLista(c.centro_de_costo);
  if (card.finished_at) fila.cerrado_en = card.finished_at;
  if (ceco) fila.ceco = ceco;
  if (c.nombre_supervisor) fila.supervisor = c.nombre_supervisor;
  if (c.fecha_l_mite_2) fila.fecha_limite = c.fecha_l_mite_2;
  if (c.repuesta) fila.respuesta = c.repuesta;
  return fila;
}

// ── Portal BigTicket (Operador Logístico) ──────────────────────────────────
// Reclamos y cancelaciones que los clientes B2B/B2C levantan desde el botón
// Ayuda de su portal. Llegan al pipe de Postventa con solicitante
// ayuda@bigticket.cl y asunto "Reclamo: OT | Motivo | Cliente - Ceco" o
// "Cancelación de envío: OT | Desistencia | Cliente - Ceco". La descripción
// trae los datos en líneas fijas; el email es el del cliente real (al que hay
// que responder, "Regla de Oro" del protocolo).
const esPortal = (card, c) =>
  /^(reclamo|cancelaci[oó]n de env[ií]o)\s*:/i.test(card.title || "") &&
  (/^(ayuda|soporte\.ti)@bigticket\.cl$/i.test(String(c.correo_solicitante || "").trim()) || /Workspace:/i.test(c.descripci_n || ""));

function dePortal(card) {
  const c = campos(card);
  const d = String(c.descripci_n || "");
  const linea = (et) => { const m = d.match(new RegExp(`^\\s*${et}\\s+(.+)$`, "im")); return m ? m[1].trim() : null; };
  const nombre = [linea("Nombre"), linea("Apellido")].filter((x) => x && x !== "-").join(" ") || null;
  const ws = (d.match(/Workspace:\s*([^|\n]+)/i) || [])[1];
  const ot = linea("OT");
  const fila = {
    card_id: String(card.id), canal: "portal", creado_en: card.created_at,
    fase: card.current_phase ? card.current_phase.name : null, titulo: card.title,
    mandante: ws ? ws.trim() : null, pedido: ot && ot !== "N/A" ? ot : null,
    remitente: nombre, correo: linea("Email"),
    motivo: [linea("Tipo"), linea("Motivo")].filter(Boolean).join(" · ") || null,
    texto: linea("Explicaci[oó]n"),
    actualizado_en: new Date().toISOString(), raw: card,
  };
  const ceco = primeroDeLista(c.centro_de_costo);
  if (card.finished_at) fila.cerrado_en = card.finished_at;
  if (ceco) fila.ceco = ceco;
  if (c.nombre_supervisor) fila.supervisor = c.nombre_supervisor;
  if (c.fecha_l_mite_2) fila.fecha_limite = c.fecha_l_mite_2;
  if (c.repuesta) fila.respuesta = c.repuesta;
  return fila;
}

// Tarjeta de Postventa creada desde el formulario: aporta supervisor, plazo y
// respuesta al caso del formulario con el mismo pedido.
async function enlazarConFormulario(card) {
  const c = campos(card);
  const pedidos = pedidosDe(card.title);
  if (!pedidos.length) return false;
  const cambios = {};
  const ceco = primeroDeLista(c.centro_de_costo) || (card.title.match(/^\s*(C_[A-ZÑ]+)/i) || [])[1];
  if (ceco) cambios.ceco = ceco.toUpperCase();
  if (c.nombre_supervisor) cambios.supervisor = c.nombre_supervisor;
  if (c.fecha_l_mite_2) cambios.fecha_limite = c.fecha_l_mite_2;
  if (c.repuesta) cambios.respuesta = c.repuesta;
  if (!Object.keys(cambios).length) return false;
  await sbPatch(`canon_casos_cl?canal=eq.formulario&pedido=like.*${pedidos[0]}*`, cambios);
  return true;
}

// ── DispatchTrack ──────────────────────────────────────────────────────────
const CECO_REGION = { METROPOLITANA: "C_RM", VALPARAISO: "C_VIÑA" };
const normal = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

async function despacho(pedido) {
  const r = await fetch(`${DT_URL}/api/external/v1/dispatches/${encodeURIComponent(pedido)}`, {
    headers: { "X-AUTH-TOKEN": DISPATCHTRACK_TOKEN, "Content-Type": "application/json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`dispatchtrack ${r.status}`);
  const j = await r.json();
  const d = j.response || {};
  const tag = (n) => ((d.tags || []).find((t) => normal(t.name) === normal(n)) || {}).value || null;
  return { region: tag("Region"), comuna: tag("Comuna"), estado: [d.status, d.substatus].filter(Boolean).join(" · ") || null };
}

// Completa región, comuna y estado de los casos que aún no los tienen.
// Máximo 40 por vuelta para no castigar la API.
async function completarDespachos() {
  const pend = await sbGet("canon_casos_cl?region=is.null&pedido=not.is.null&canal=neq.portal&select=card_id,pedido,ceco&order=creado_en.desc&limit=40");
  let n = 0;
  for (const c of pend) {
    const pedido = pedidosDe(c.pedido)[0];
    if (!pedido) { await sbPatch(`canon_casos_cl?card_id=eq.${c.card_id}`, { region: "sin pedido válido" }); continue; }
    try {
      const d = await despacho(pedido);
      const cambios = d
        ? { region: d.region || "sin región", comuna: d.comuna, estado_pedido: d.estado }
        : { region: "no encontrado en DispatchTrack" };
      if (!c.ceco && d && CECO_REGION[normal(d.region)]) cambios.ceco = CECO_REGION[normal(d.region)];
      await sbPatch(`canon_casos_cl?card_id=eq.${c.card_id}`, cambios);
      n++;
    } catch (e) { log(`✗ DispatchTrack ${pedido}: ${e.message}`); }
    await sleep(250);
  }
  return n;
}

// ── Biggy clasificador (modo sombra) ───────────────────────────────────────
// Lee el mensaje del cliente del formulario y lo clasifica según el instructivo
// "Biggy · Módulo Postventa Chile" (3.2). Solo guarda su decisión y la razón en
// canon_casos_cl: no escribe en Pipefy ni avisa a nadie. Sirve para medir
// cuánto coincide con la ejecutiva antes de dejarlo decidir.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODELO = process.env.CANON_MODELO || "claude-haiku-5-5";
const MAX_CLASIFICAR = Number(process.env.CANON_MAX_CLASIFICAR || 20);

const INSTRUCCIONES = `Eres el Biggy, el asistente de postventa de Bigticket, empresa de última milla en Chile.
Clasificas reclamos que clientes finales dejan en un formulario después de comprar en una tienda (Canon u otra) cuyo despacho hace Bigticket.

Lee el MENSAJE del cliente. El MOTIVO que eligió en el formulario es solo una pista: muchas veces marca "Problema con producto" o "Comentario" y en realidad es otra cosa. Decide por lo que dice el mensaje.

Categorías:
- "supervisor": problema de la ENTREGA que tiene que gestionar la operación. El pedido no llegó en la fecha comprometida, entrega fallida, lo marcaron entregado y no lo recibió, trato del repartidor, paquete dañado por el transporte. También ENTREGA INCOMPLETA: en un pedido con varios productos llegaron algunos y faltan otros ("llegaron 2 de los 6", "falta la base de la cama", "faltó el colchón"), porque primero hay que revisar si el bulto quedó en bodega o en ruta. También ANULAR O CANCELAR la compra o pedir que no se despache ("anular la compra", "no realizar el envío", "quiero cancelar porque no llegó"), porque hay que frenar el despacho. También las INSTRUCCIONES DE ENTREGA que la operación debe conocer antes de entregar: cambio de dirección, horario en que puede recibir, dejar en conserjería, llamar a un teléfono.
- "consulta": el cliente solo pregunta por el ESTADO o la fecha de su pedido, sin reclamar un incumplimiento: "¿cuándo llega?", "estado del envío", "no puedo ver el seguimiento", "¿llegan los dos productos?". Se contesta con el estado del pedido en el sistema de despacho, sin supervisor.
- "mandante": lo resuelve la TIENDA. El producto que llegó está malo o no es el que compró: color, talla o modelo equivocado, producto erróneo, falla o defecto, faltan piezas dentro de un producto sellado de fábrica. También: pide la devolución del dinero de un producto que ya recibió. También: críticas al producto o al embalaje de la tienda. Un producto que NO llegó no es mandante: es supervisor.
- "comentario": felicitaciones o sugerencias sin reclamo, o el cliente avisa que ya recibió el pedido o que el problema se resolvió ("recibí el producto, lo tenía mi vecina").
- "revision_manual": el mensaje es ambiguo, está vacío o no se entiende. Nunca adivines: si dudas entre dos categorías, usa revision_manual.

Sé breve: la razón en menos de 20 palabras y el resumen en menos de 50.
Responde SOLO con un objeto JSON, sin texto antes ni después, con esta forma:
{"clasificacion": "supervisor" | "consulta" | "mandante" | "comentario" | "revision_manual", "razon": "una frase corta de por qué", "resumen": "una o dos frases para el supervisor: qué pasó y qué pide el cliente, mencionando el pedido si viene"}`;

// Correcciones de la jefa del área (vista "Biggy vs ejecutiva" del Brain): los
// casos donde dijo que el Biggy se equivocó entran como ejemplos al clasificar.
let correcciones = { texto: "", leido: 0 };
async function correccionesClasificacion() {
  if (Date.now() - correcciones.leido < 15 * 60000) return correcciones.texto;
  try {
    const ev = await sbGet("postventa_evaluacion_cl?tema=eq.clasificacion&veredicto=in.(ejecutiva,ninguno)&comentario=not.is.null&select=card_id,veredicto,comentario&order=creado_en.desc&limit=25");
    const lineas = [];
    for (const e of ev) {
      const c = (await sbGet(`canon_casos_cl?card_id=eq.${e.card_id}&select=texto,ejecutiva_clasificacion,biggy_clasificacion`))[0];
      if (!c) continue;
      lineas.push(`- Mensaje: "${String(c.texto || "").slice(0, 200)}" → el Biggy dijo ${c.biggy_clasificacion}` +
        (e.veredicto === "ejecutiva" ? `, lo correcto era ${c.ejecutiva_clasificacion}` : ", ninguno acertó") + `. Comentario de la jefa: ${e.comentario}`);
    }
    correcciones = { texto: lineas.length ? `\n\nCORRECCIONES DE LA JEFA DEL ÁREA (aprende de estos casos):\n${lineas.join("\n")}` : "", leido: Date.now() };
  } catch (e) { correcciones.leido = Date.now(); }
  return correcciones.texto;
}

async function clasificarUno(c) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO, max_tokens: 900, system: INSTRUCCIONES + (await correccionesClasificacion()),
      messages: [{ role: "user", content:
        `MOTIVO elegido: ${c.motivo || "(sin motivo)"}\nPEDIDO: ${c.pedido || "(sin pedido)"}\nMENSAJE:\n${(c.texto || "(sin mensaje)").slice(0, 3000)}` }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`IA ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  const texto = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (j.stop_reason === "max_tokens") throw new Error("respuesta cortada por largo");
  // Toma solo el objeto JSON, aunque la IA agregue texto o ``` alrededor.
  const ini = texto.indexOf("{"), fin = texto.lastIndexOf("}");
  if (ini < 0 || fin <= ini) throw new Error(`respuesta sin JSON: ${texto.slice(0, 80)}`);
  const json = JSON.parse(texto.slice(ini, fin + 1));
  const validas = ["supervisor", "consulta", "mandante", "comentario", "revision_manual"];
  if (!validas.includes(json.clasificacion)) throw new Error(`clasificación no válida: ${json.clasificacion}`);
  return json;
}

async function clasificarPendientes() {
  if (!ANTHROPIC_API_KEY) return 0;
  const pend = await sbGet(`canon_casos_cl?canal=eq.formulario&biggy_clasificacion=is.null&select=card_id,motivo,pedido,texto&order=creado_en.desc&limit=${MAX_CLASIFICAR}`);
  let n = 0;
  for (const c of pend) {
    try {
      const x = await clasificarUno(c);
      await sbPatch(`canon_casos_cl?card_id=eq.${c.card_id}`, {
        biggy_clasificacion: x.clasificacion, biggy_razon: String(x.razon || "").slice(0, 500),
        biggy_resumen: String(x.resumen || "").slice(0, 1000), biggy_en: new Date().toISOString(),
      });
      await evento(c.card_id, "clasificacion", `Clasificó el formulario como ${x.clasificacion}: ${x.razon || ""}`);
      n++;
    } catch (e) {
      log(`✗ Biggy ${c.card_id}: ${e.message}`);
      // Si la respuesta no se pudo leer, queda marcada para no reintentarla en cada vuelta.
      if (!/IA (429|5\d\d)/.test(e.message)) {
        await sbPatch(`canon_casos_cl?card_id=eq.${c.card_id}`, { biggy_clasificacion: "error", biggy_razon: e.message.slice(0, 300), biggy_en: new Date().toISOString() }).catch(() => {});
      }
    }
    await sleep(300);
  }
  return n;
}

// ── Biggy revisor de respuestas (modo sombra) ──────────────────────────────
// Califica la respuesta del supervisor según el instructivo (sección 4):
// correcta, incompleta (y qué falta) o fuera de lugar. Compara contra los datos
// de DispatchTrack para detectar respuestas que contradicen el estado real.
// Solo guarda la calificación: no devuelve nada a nadie todavía.
const MAX_REVISAR = Number(process.env.CANON_MAX_REVISAR || 15);

const INSTRUCCIONES_REVISOR = `Eres el Biggy, asistente de postventa de Bigticket (última milla en Chile).
Revisas la RESPUESTA que dio un supervisor a un caso, antes de que se le conteste al cliente o a la tienda (Canon).

Calificaciones:
- "correcta": cumple todos los elementos que pide el tipo de caso.
- "incompleta": responde el caso, pero le falta algún elemento. Di exactamente qué falta.
- "fuera_de_lugar": no responde lo que se preguntó, es genérica ("ok", "se revisará", "listo") o habla de otra orden.

SOBRE EL ESTADO EN EL SISTEMA DE DESPACHO: es el estado de HOY, que puede ser días o semanas POSTERIOR a la respuesta. Es normal que la respuesta diga "en ruta", "programado para el día X" o "reasignado" y que hoy la orden figure entregada: eso NO es una contradicción, es la evolución esperada del pedido. Solo es contradicción si la respuesta afirma que una orden YA FUE ENTREGADA y hoy el sistema la muestra sin entregar (en ruta, pendiente o no existe). En ese caso es "fuera_de_lugar".

Elementos de una respuesta completa:
- CONSULTA DE ESTADO: el estado actual de la orden, la fecha de entrega o de reprogramación y, si no se entregó, el motivo.
- PROBLEMA CON ENTREGA: qué pasó, qué se hizo para resolverlo y la fecha de solución. Si la orden figura entregada, debe mencionar la evidencia (foto o firma).
- CANCELACIÓN DE ENVÍO: si se logró frenar el envío y en qué situación quedó (no retirado, retenido en bodega o retorno coordinado).
- Si el caso trae VARIAS órdenes, la respuesta debe cubrirlas todas; si omite alguna, es incompleta.

Ejemplos:
- Correcta: "Se corrigió la dirección y el pedido quedó reprogramado para el 25 de octubre en la tarde. Se contactó a la clienta para confirmar."
- Incompleta: "Se revisará con el cliente." Falta qué se hará y en qué fecha.
- Fuera de lugar: "Ok." / una respuesta sobre otra orden.

Sé muy breve: "falta" en menos de 15 palabras y "razon" en menos de 25.
Responde SOLO con un objeto JSON, sin texto antes ni después:
{"calificacion": "correcta" | "incompleta" | "fuera_de_lugar", "falta": "qué le falta (vacío si es correcta)", "razon": "una frase de por qué"}`;

function tipoParaRevision(c) {
  if (c.canal === "portal") return /^cancelaci/i.test(c.titulo || "") ? "CANCELACIÓN DE ENVÍO" : "PROBLEMA CON ENTREGA";
  if (c.canal === "correo") return "CONSULTA DE ESTADO (correo de Canon)";
  return c.biggy_clasificacion === "consulta" ? "CONSULTA DE ESTADO" : "PROBLEMA CON ENTREGA";
}

async function revisarUno(c, ordenes) {
  const despacho = c.canal === "correo"
    ? (ordenes.length ? ordenes.map((o) => `- ${o.orden}: ${o.encontrada ? `${o.estado || "sin estado"} · ${o.comuna || ""} ${o.region || ""}` : "no existe en el sistema de despacho"}`).join("\n") : "(sin órdenes identificadas)")
    : (c.estado_pedido ? `- ${c.pedido}: ${c.estado_pedido} · ${c.comuna || ""} ${c.region || ""}` : "(sin datos del sistema de despacho)");
  const contenido = `TIPO DE CASO: ${tipoParaRevision(c)}
ÓRDENES Y ESTADO ACTUAL (HOY) EN EL SISTEMA DE DESPACHO:
${despacho}
LO QUE SE PIDIÓ:
${String(c.texto || c.titulo || "").slice(0, 2500)}
RESPUESTA DEL SUPERVISOR:
${String(c.respuesta || "").slice(0, 2000)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, max_tokens: 1000, system: INSTRUCCIONES_REVISOR, messages: [{ role: "user", content: contenido }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`IA ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  const texto = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (j.stop_reason === "max_tokens") throw new Error("respuesta cortada por largo; se reintenta");
  const ini = texto.indexOf("{"), fin = texto.lastIndexOf("}");
  if (ini < 0 || fin <= ini) throw new Error(`respuesta sin JSON: ${texto.slice(0, 80)}`);
  const x = JSON.parse(texto.slice(ini, fin + 1));
  if (!["correcta", "incompleta", "fuera_de_lugar"].includes(x.calificacion)) throw new Error(`calificación no válida: ${x.calificacion}`);
  return x;
}

async function revisarRespuestas() {
  if (!ANTHROPIC_API_KEY) return 0;
  // Casos con respuesta que no se revisaron, o cuya respuesta cambió desde la revisión.
  const cand = await sbGet("canon_casos_cl?respuesta=not.is.null&select=card_id,canal,titulo,texto,pedido,respuesta,region,comuna,estado_pedido,biggy_clasificacion,revision_de,mandante,correo&order=creado_en.desc&limit=400");
  const pend = cand.filter((c) => c.revision_de !== c.respuesta)
    .filter((c) => c.canal === "portal" || /canontex/i.test(c.mandante || "") || /@canontex\.cl\s*$/i.test(c.correo || ""))
    .filter((c) => c.canal !== "formulario" || ["supervisor", "consulta"].includes(c.biggy_clasificacion))
    .slice(0, MAX_REVISAR);
  let n = 0;
  for (const c of pend) {
    try {
      const ordenes = c.canal === "correo"
        ? await sbGet(`canon_ordenes_cl?card_id=eq.${c.card_id}&select=orden,encontrada,estado,comuna,region`) : [];
      const x = await revisarUno(c, ordenes);
      await sbPatch(`canon_casos_cl?card_id=eq.${c.card_id}`, {
        revision_calificacion: x.calificacion, revision_falta: String(x.falta || "").slice(0, 300) || null,
        revision_razon: String(x.razon || "").slice(0, 400), revision_de: c.respuesta, revision_en: new Date().toISOString(),
      });
      n++;
    } catch (e) { log(`✗ revisor ${c.card_id}: ${e.message}`); }
    await sleep(300);
  }
  return n;
}

// ── Lector de correos de Canon ─────────────────────────────────────────────
// Saca todas las órdenes de cada correo de Canon (asunto, cuerpo y adjuntos
// Excel/CSV), las verifica en DispatchTrack y las agrupa por CECO: cada grupo
// será una tarea para su supervisor (instructivo 3.3).
//   · Candidatos: números de 7 a 10 dígitos. Los de 7 y 8 se completan con
//     ceros (1204868 = 001204868). Se descartan los que vienen después de
//     "factura", "boleta", "guía", "fono", "RUT", y los celulares (9 dígitos
//     que empiezan con 9).
//   · Solo es orden si EXISTE en DispatchTrack: una factura o un teléfono
//     nunca se vuelven orden.
//   · Un número con forma clara de pedido (10 dígitos 33…/39…, o 00XXXXXXX)
//     que no existe queda registrado como "no encontrada" → revisión manual.
let XLSX = null;
try { XLSX = require("xlsx"); } catch (e) { /* sin librería: solo cuerpo y asunto */ }
const MAX_CORREOS_LECTURA = Number(process.env.CANON_MAX_LECTURA || 10);
const RE_EXCLUIR = /(fact(ura)?|boleta|gu[ií]a|fono|tel([eé]fono)?|cel(ular)?|rut|n[°º]\s*doc)\W{0,4}$/i;

function candidatos(texto) {
  const out = new Map();                 // número normalizado → ¿forma clara de pedido?
  const re = /(?<![\d+])(\d{7,10})(?!\d)/g;
  let m;
  while ((m = re.exec(texto || ""))) {
    if (RE_EXCLUIR.test(texto.slice(Math.max(0, m.index - 16), m.index))) continue;
    let n = m[1];
    if (n.length === 7) n = "00" + n;
    else if (n.length === 8) n = "0" + n;
    if (n.length === 9 && n.startsWith("9")) continue;      // celular
    const fuerte = /^(33|39)\d{8}$/.test(n) || /^00\d{7}$/.test(n);
    out.set(n, out.get(n) || fuerte);
  }
  return out;
}

async function textoAdjuntos(raw) {
  if (!XLSX || !raw) return "";
  const c = campos(raw);
  let urls = [];
  try { urls = JSON.parse(c.adjunto_ticket || "[]"); } catch (e) {}
  const planillas = urls.filter((u) => /\.(xlsx|xls|csv)(\?|$)/i.test(u)).slice(0, 3);
  let texto = "";
  for (const u of planillas) {
    try {
      const r = await fetch(u);
      if (!r.ok) { log(`· adjunto no disponible (${r.status})`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 5 * 1024 * 1024) { log("· adjunto de más de 5 MB, se omite"); continue; }
      const libro = XLSX.read(buf, { type: "buffer", cellDates: false });
      for (const hoja of libro.SheetNames.slice(0, 5)) texto += "\n" + XLSX.utils.sheet_to_csv(libro.Sheets[hoja]);
    } catch (e) { log(`· no pude leer un adjunto: ${e.message}`); }
  }
  return texto;
}

async function buscarOrden(n) {
  let d = await despacho(n);
  // Con o sin ceros a la izquierda son la misma orden.
  if (!d && /^00\d{7}$/.test(n)) d = await despacho(n.replace(/^0+/, ""));
  return d;
}

async function leerCorreos() {
  const pend = await sbGet(`canon_casos_cl?canal=eq.correo&ordenes_en=is.null&select=card_id,titulo,texto,ceco,raw&order=creado_en.desc&limit=${MAX_CORREOS_LECTURA}`);
  let leidos = 0;
  for (const c of pend) {
    try {
      const cuerpo = candidatos(`${c.titulo || ""}\n${c.texto || ""}`);
      const adj = candidatos(await textoAdjuntos(c.raw));
      const todos = new Map([...cuerpo].map(([k, v]) => [k, { fuerte: v, fuente: "correo" }]));
      for (const [k, v] of adj) if (!todos.has(k)) todos.set(k, { fuerte: v, fuente: "adjunto" });

      const filas = [];
      for (const [n, info] of [...todos].slice(0, 40)) {
        try {
          const d = await buscarOrden(n);
          if (d) {
            filas.push({ card_id: c.card_id, orden: n, fuente: info.fuente, encontrada: true,
              region: d.region, comuna: d.comuna, estado: d.estado, ceco: CECO_REGION[normal(d.region)] || null });
          } else if (info.fuerte) {
            filas.push({ card_id: c.card_id, orden: n, fuente: info.fuente, encontrada: false,
              region: null, comuna: null, estado: null, ceco: null });
          }
        } catch (e) { log(`✗ DispatchTrack ${n}: ${e.message}`); }
        await sleep(200);
      }

      if (filas.length) {
        const r = await fetch(`${CL_URL}/rest/v1/canon_ordenes_cl?on_conflict=card_id,orden`, {
          method: "POST", headers: { ...cab, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(filas),
        });
        if (!r.ok) throw new Error(`ordenes ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }

      // Resumen para la bandeja: cuántas órdenes, cómo se reparten y qué faltó.
      const ok = filas.filter((f) => f.encontrada);
      const grupos = {};
      for (const f of ok) { const k = f.ceco || "otra región"; grupos[k] = (grupos[k] || 0) + 1; }
      const noEnc = filas.length - ok.length;
      const resumen = !filas.length ? "sin orden identificable"
        : [`${ok.length} ${ok.length === 1 ? "orden" : "órdenes"}`,
           ...Object.entries(grupos).map(([k, v]) => `${k} ${v}`),
           noEnc ? `${noEnc} no encontrada${noEnc > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
      const cambios = { ordenes_en: new Date().toISOString(), ordenes_resumen: resumen };
      // Si Pipefy no trae CECO y todas las órdenes son de uno solo, se usa ese.
      const cecos = Object.keys(grupos).filter((k) => k !== "otra región");
      if (!c.ceco && cecos.length === 1 && !grupos["otra región"]) cambios.ceco = cecos[0];
      await sbPatch(`canon_casos_cl?card_id=eq.${c.card_id}`, cambios);
      await evento(c.card_id, "ordenes", `Leyó el correo: ${resumen}`);
      leidos++;
    } catch (e) { log(`✗ lector ${c.card_id}: ${e.message}`); }
  }
  return leidos;
}

// ── Buzón postventa@bigticket.cl (Microsoft Graph, solo lectura) ───────────
// Guarda cada correo que llega al buzón con su hilo (conversationId) y su
// identificador, que es lo que después permite RESPONDER EN EL MISMO HILO.
// Lo clasifica por remitente y lo enlaza con su caso de Pipefy por el asunto.
//   canon        remitente @canontex.cl
//   portal       ayuda@ o soporte.ti@bigticket.cl (Portal OL)
//   pnr_propio   "Reclamo PNR …" que envía nuestro propio pnr-cl
//   otro         todo lo demás (Falabella, avisos de Pipefy…): se guarda, no es caso
const BUZON = process.env.BUZON_POSTVENTA || "postventa@bigticket.cl";
const DIAS_BUZON = Number(process.env.BUZON_DIAS || 30);
let tokenGraph = null, tokenVence = 0;

async function graphToken() {
  if (tokenGraph && Date.now() < tokenVence - 120000) return tokenGraph;
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET } = process.env;
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) return null;
  const r = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GRAPH_CLIENT_ID, client_secret: GRAPH_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`token Graph ${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  tokenGraph = j.access_token; tokenVence = Date.now() + (j.expires_in || 3600) * 1000;
  return tokenGraph;
}

function origenCorreo(de, asunto) {
  const d = String(de || "").toLowerCase().trim();
  if (/@canontex\.cl$/.test(d)) return "canon";
  if (/^(ayuda|soporte\.ti)@bigticket\.cl$/.test(d)) return "portal";
  if (/^reclamo pnr \d+/i.test(asunto || "")) return "pnr_propio";
  return "otro";
}

async function sincronizarBuzon() {
  const tk = await graphToken();
  if (!tk) return null;                       // sin credenciales de Graph: se omite
  const ult = await sbGet("postventa_correos_cl?select=recibido_en&order=recibido_en.desc&limit=1");
  const desde = ult[0] ? new Date(new Date(ult[0].recibido_en).getTime() - 10 * 60000).toISOString()
                       : new Date(Date.now() - DIAS_BUZON * 864e5).toISOString();
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(BUZON)}/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent(`receivedDateTime ge ${desde}`)}&$orderby=receivedDateTime asc&$top=50` +
    `&$select=id,conversationId,internetMessageId,receivedDateTime,from,subject,body,hasAttachments`;
  const filas = [];
  for (let pag = 0; url && pag < 20; pag++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tk}`, Prefer: 'outlook.body-content-type="text"' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`buzón ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
    for (const m of j.value || []) {
      const de = m.from && m.from.emailAddress ? m.from.emailAddress : {};
      filas.push({
        mensaje_id: m.id, hilo_id: m.conversationId, internet_id: m.internetMessageId,
        recibido_en: m.receivedDateTime, de_correo: de.address || null, de_nombre: de.name || null,
        asunto: m.subject || null, cuerpo: String((m.body && m.body.content) || "").slice(0, 20000),
        adjuntos: !!m.hasAttachments, origen: origenCorreo(de.address, m.subject),
      });
    }
    url = j["@odata.nextLink"] || null;
  }
  for (let i = 0; i < filas.length; i += 50) {
    const r = await fetch(`${CL_URL}/rest/v1/postventa_correos_cl?on_conflict=mensaje_id`, {
      method: "POST", headers: { ...cab, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(filas.slice(i, i + 50)),
    });
    if (!r.ok) throw new Error(`correos ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }

  // Enlace con el caso de Pipefy: misma fuente, mismo asunto, creado cerca de la hora del correo.
  const sinCaso = await sbGet("postventa_correos_cl?card_id=is.null&origen=in.(canon,portal)&select=mensaje_id,asunto,recibido_en&order=recibido_en.desc&limit=60");
  let enlazados = 0;
  for (const m of sinCaso) {
    if (!m.asunto) continue;
    const t0 = new Date(m.recibido_en).getTime();
    const cand = await sbGet(`canon_casos_cl?canal=in.(correo,portal)&titulo=eq.${encodeURIComponent(m.asunto)}&select=card_id,creado_en`);
    const mejor = cand.map((c) => ({ ...c, dif: Math.abs(new Date(c.creado_en).getTime() - t0) }))
      .filter((c) => c.dif < 2 * 3600000).sort((a, b) => a.dif - b.dif)[0];
    if (mejor) { await sbPatch(`postventa_correos_cl?mensaje_id=eq.${encodeURIComponent(m.mensaje_id)}`, { card_id: mejor.card_id }); enlazados++; }
  }
  return { nuevos: filas.length, enlazados };
}

// ── Tareas de postventa en la Bitácora Chile (piloto) ──────────────────────
// Solo para los CECO del piloto (POSTVENTA_TAREAS_CECOS, ej. "C_VIÑA") y solo
// casos nacidos desde POSTVENTA_TAREAS_DESDE: así nadie recibe tareas
// duplicadas mientras el resto sigue respondiendo en Pipefy.
//   · Correo de Canon: una tarea por CECO, cada una solo con sus órdenes.
//   · Formulario de entrega (clasificado supervisor): una tarea con su pedido.
// Respuesta del supervisor → el Biggy la revisa:
//   correcta → aprobada · incompleta → devuelta con "Falta: …"
//   segunda vez incompleta o fuera de lugar → revision_manual (Brain)
const CECOS_PILOTO = String(process.env.POSTVENTA_TAREAS_CECOS || "").split(",").map((s) => s.trim()).filter(Boolean);
const TAREAS_DESDE = process.env.POSTVENTA_TAREAS_DESDE || null;

async function crearTareas() {
  if (!CECOS_PILOTO.length || !TAREAS_DESDE) return 0;
  const casos = await sbGet(`canon_casos_cl?creado_en=gte.${encodeURIComponent(TAREAS_DESDE)}&cerrado_en=is.null` +
    `&canal=in.(correo,formulario)&select=card_id,canal,titulo,texto,pedido,ceco,fase,mandante,correo,biggy_clasificacion,ejecutiva_clasificacion,biggy_resumen,estado_pedido,comuna,creado_en,ordenes_en&limit=200`);
  const existentes = new Set((await sbGet(`postventa_tareas_cl?creada_en=gte.${encodeURIComponent(TAREAS_DESDE)}&select=card_id,ceco&limit=2000`))
    .map((x) => `${x.card_id}|${x.ceco}`));
  const sla = Object.fromEntries((await sbGet("postventa_sla_cl?select=origen,sla_horas")).map((x) => [x.origen, Number(x.sla_horas)]));
  const urg = Object.fromEntries((await sbGet("postventa_urgentes_cl?urgente=eq.true&select=caso,sla_horas")).map((x) => [x.caso, Number(x.sla_horas)]));
  const nuevas = [];

  for (const c of casos) {
    if (/resuelt|no amerita/i.test(c.fase || "")) continue;
    const esCanon = /canontex/i.test(c.mandante || "") || /@canontex\.cl\s*$/i.test(c.correo || "");
    if (!esCanon) continue;
    const origen = c.canal === "correo" ? "canon_correo" : "canon_formulario";
    const horas = urg[`canon:${c.card_id}`] || sla[origen] || 48;
    const vence = new Date(new Date(c.creado_en).getTime() + horas * 3600000).toISOString();
    const base = { card_id: c.card_id, origen, titulo: c.titulo, urgente: !!urg[`canon:${c.card_id}`], vence_en: vence,
      que_pide: String((c.biggy_resumen ? c.biggy_resumen + "\n\n" : "") + (c.texto || "")).slice(0, 4000) };

    if (c.canal === "correo") {
      if (!c.ordenes_en) continue;                          // esperar a que el lector saque las órdenes
      const ords = await sbGet(`canon_ordenes_cl?card_id=eq.${c.card_id}&encontrada=eq.true&select=orden,ceco,estado,comuna`);
      const porCeco = {};
      for (const o of ords) if (o.ceco) (porCeco[o.ceco] = porCeco[o.ceco] || []).push({ orden: o.orden, estado: o.estado, comuna: o.comuna });
      if (!ords.length && c.ceco) porCeco[c.ceco] = [];
      for (const [ceco, lista] of Object.entries(porCeco)) {
        if (!CECOS_PILOTO.includes(ceco) || existentes.has(`${c.card_id}|${ceco}`)) continue;
        nuevas.push({ ...base, ceco, ordenes: lista });
      }
    } else {
      const clas = c.ejecutiva_clasificacion || c.biggy_clasificacion;
      if (clas !== "supervisor" || !c.ceco || !CECOS_PILOTO.includes(c.ceco)) continue;
      if (existentes.has(`${c.card_id}|${c.ceco}`)) continue;
      nuevas.push({ ...base, ceco: c.ceco, ordenes: c.pedido ? [{ orden: c.pedido, estado: c.estado_pedido, comuna: c.comuna }] : [] });
    }
  }
  if (nuevas.length) {
    const r = await fetch(`${CL_URL}/rest/v1/postventa_tareas_cl?on_conflict=card_id,ceco`, {
      method: "POST", headers: { ...cab, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(nuevas),
    });
    if (!r.ok) throw new Error(`tareas ${r.status}: ${(await r.text()).slice(0, 200)}`);
    for (const x of nuevas) await evento(x.card_id, "tarea", `Creó la tarea en la Bitácora para ${x.ceco} (${(x.ordenes || []).length} orden/es), vence ${new Date(x.vence_en).toLocaleString("es-CL", { timeZone: "America/Santiago" })}`);
  }
  return nuevas.length;
}

async function revisarTareas() {
  if (!ANTHROPIC_API_KEY) return 0;
  const pend = await sbGet("postventa_tareas_cl?estado=eq.respondida&select=*&order=respondida_en&limit=10");
  let n = 0;
  for (const tarea of pend) {
    try {
      const c = { canal: tarea.origen === "canon_correo" ? "correo" : "formulario", titulo: tarea.titulo, texto: tarea.que_pide,
        respuesta: tarea.respuesta, pedido: (tarea.ordenes[0] || {}).orden, estado_pedido: (tarea.ordenes[0] || {}).estado,
        comuna: (tarea.ordenes[0] || {}).comuna, biggy_clasificacion: "supervisor" };
      const ords = (tarea.ordenes || []).map((o) => ({ ...o, encontrada: true }));
      const x = await revisarUno(c, ords);
      const veces = Number(tarea.veces_devuelta || 0);
      const estado = x.calificacion === "correcta" ? "aprobada"
        : x.calificacion === "incompleta" && veces < 1 ? "devuelta" : "revision_manual";
      await fetch(`${CL_URL}/rest/v1/postventa_tareas_cl?id=eq.${tarea.id}`, {
        method: "PATCH", headers: { ...cab, Prefer: "return=minimal" },
        body: JSON.stringify({ estado, revision_calificacion: x.calificacion, revision_falta: String(x.falta || "").slice(0, 300) || null,
          revision_razon: String(x.razon || "").slice(0, 400), revisada_en: new Date().toISOString(),
          veces_devuelta: estado === "devuelta" ? veces + 1 : veces, aprobada_en: estado === "aprobada" ? new Date().toISOString() : null }),
      });
      log(`· tarea ${tarea.id} (${tarea.ceco}): ${x.calificacion} → ${estado}`);
      await evento(tarea.card_id, "revision",
        estado === "aprobada" ? `Revisó la respuesta de ${tarea.ceco}: correcta, aprobada`
        : estado === "devuelta" ? `Devolvió la respuesta de ${tarea.ceco} al supervisor. Falta: ${x.falta || "—"}`
        : `Mandó la respuesta de ${tarea.ceco} a revisión manual (${x.calificacion}): ${x.razon || ""}`, tarea.id);
      n++;
    } catch (e) { log(`✗ tarea ${tarea.id}: ${e.message}`); }
    await sleep(300);
  }
  return n;
}


// ── Horario de envío de correos (postventa_config_cl, editable en el Brain) ──
// Fuera del horario no se envía nada: los correos quedan pendientes y salen
// en la primera vuelta después de que se abre. Si "desde" y "hasta" son iguales
// (por defecto 00:00 y 00:00), no hay restricción: envía las 24 horas.
let horarioCache = { desde: "00:00", hasta: "00:00", leido: 0 };
async function enHorarioDeEnvio() {
  if (Date.now() - horarioCache.leido > 5 * 60000) {
    try {
      const r = await fetch(`${process.env.CL_URL}/rest/v1/postventa_config_cl?clave=in.(envio_desde,envio_hasta)&select=clave,valor`,
        { headers: { apikey: process.env.CL_KEY, Authorization: `Bearer ${process.env.CL_KEY}` } });
      if (r.ok) for (const x of await r.json()) {
        if (x.clave === "envio_desde" && /^\d{2}:\d{2}$/.test(x.valor)) horarioCache.desde = x.valor;
        if (x.clave === "envio_hasta" && /^\d{2}:\d{2}$/.test(x.valor)) horarioCache.hasta = x.valor;
      }
    } catch (e) {}
    horarioCache.leido = Date.now();
  }
  const ahora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const { desde, hasta } = horarioCache;
  if (desde === hasta) return true;                    // desde = hasta: sin restricción (24 horas), como funcionaba antes
  return desde <= hasta ? ahora >= desde && ahora < hasta : ahora >= desde || ahora < hasta;   // también sirve si cruza medianoche
}

// ── Respuesta del Biggy por correo ─────────────────────────────────────────
// Cuando TODAS las tareas de un caso están aprobadas, el Biggy redacta una sola
// respuesta con lo que contestó cada supervisor y la envía desde el buzón:
//   · correo de Canon → respuesta en el MISMO HILO (replyAll, mantiene la copia)
//   · formulario      → correo nuevo al cliente final
// POSTVENTA_ENVIO: "apagado" (por defecto) · "prueba" (todo llega a
// POSTVENTA_PRUEBA_CORREO, nunca a Canon ni a clientes) · "real".
const MODO_ENVIO = (process.env.POSTVENTA_ENVIO || "apagado").toLowerCase();
const CORREO_PRUEBA_PV = process.env.POSTVENTA_PRUEBA_CORREO || "";
// Copia oculta de cada correo del Biggy (la jefatura ve lo mismo que recibe el cliente o Canon).
const COPIA_OCULTA = String(process.env.POSTVENTA_COPIA_CORREO || "").split(",").map((s) => s.trim()).filter((s) => s.includes("@"))
  .map((address) => ({ emailAddress: { address } }));

const INSTRUCCIONES_CORREO = `Eres el Biggy, de postventa de BigTicket (empresa de última milla en Chile). Redactas la respuesta por correo de un caso de postventa.

Reglas:
- Español de Chile, cordial y breve.
- Si escribes a CANON (la tienda), trato formal (usted / ustedes). Si escribes al CLIENTE FINAL, tutéalo.
- Indica siempre el número de cada orden y su estado o la solución concreta con fecha.
- Usa SOLO la información de la respuesta del supervisor y del estado de las órdenes. No inventes fechas, motivos ni compromisos.
- Si hay varias órdenes, una línea por orden.
- No repitas el correo original ni agregues asunto.
- Escribe desde el punto de vista de BigTicket hacia el destinatario: cuenta qué pasó y qué HICIMOS nosotros. Las instrucciones que se dejaron para el repartidor o la operación (llamar antes de llegar, dejar en conserjería, horario de entrega) se cuentan como algo que dejamos registrado para el repartidor, por ejemplo "dejamos registrado que el repartidor llame a Marcia antes de llegar". Nunca le pidas al destinatario que haga algo que le corresponde al repartidor.
- No repitas números de teléfono ni datos personales del cliente.
- Texto plano: sin asteriscos, negritas, viñetas con símbolos ni ningún formato.
- Termina con la firma exacta: "Equipo BigTicket".
Responde solo con el texto del correo, sin comillas ni explicaciones.`;

async function redactarCorreo(destino, caso, tareas) {
  const respuestas = tareas.map((t) => `Supervisor (${t.ceco}): ${t.respuesta}`).join("\n");
  const ordenes = tareas.flatMap((t) => (t.ordenes || []).map((o) => `- ${o.orden}: ${o.estado || "sin estado"}${o.comuna ? " · " + o.comuna : ""}`)).join("\n") || "(sin órdenes)";
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, max_tokens: 900, system: INSTRUCCIONES_CORREO, messages: [{ role: "user", content:
      `DESTINATARIO: ${destino === "canon" ? "CANON (trato formal)" : "CLIENTE FINAL (tutear)"}\n` +
      `LO QUE SE PIDIÓ:\n${String(caso.texto || caso.titulo || "").slice(0, 2500)}\n` +
      `ÓRDENES Y ESTADO:\n${ordenes}\nRESPUESTAS DE LOS SUPERVISORES:\n${respuestas}` }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`IA ${r.status}: ${JSON.stringify(j.error || j).slice(0, 200)}`);
  if (j.stop_reason === "max_tokens") throw new Error("correo cortado por largo; se reintenta");
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim()
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
}

async function graphPost(ruta, cuerpo) {
  const tk = await graphToken();
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(BUZON)}${ruta}`, {
    method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`Graph ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function enviarRespuestas() {
  if (MODO_ENVIO === "apagado" || !ANTHROPIC_API_KEY) return 0;
  if (!(await enHorarioDeEnvio())) return 0;          // fuera de horario: quedan pendientes y salen al abrir
  if (MODO_ENVIO === "prueba" && !CORREO_PRUEBA_PV.includes("@")) { log("✗ envío: modo prueba sin POSTVENTA_PRUEBA_CORREO"); return 0; }
  const aprobadas = await sbGet("postventa_tareas_cl?estado=eq.aprobada&correo_enviado_en=is.null&select=*&limit=50");
  const porCaso = {};
  for (const t of aprobadas) (porCaso[t.card_id] = porCaso[t.card_id] || []).push(t);
  let n = 0;
  for (const [cardId, lista] of Object.entries(porCaso).slice(0, 5)) {
    try {
      // Un solo correo por caso: todas sus tareas tienen que estar aprobadas.
      const todas = await sbGet(`postventa_tareas_cl?card_id=eq.${cardId}&select=id,estado`);
      if (todas.some((x) => x.estado !== "aprobada")) continue;
      const caso = (await sbGet(`canon_casos_cl?card_id=eq.${cardId}&select=card_id,canal,titulo,texto,correo`))[0];
      if (!caso) continue;
      const esCorreo = caso.canal === "correo";
      const texto = await redactarCorreo(esCorreo ? "canon" : "cliente", caso, lista);
      let destino;

      if (esCorreo) {
        const msj = (await sbGet(`postventa_correos_cl?card_id=eq.${cardId}&origen=eq.canon&select=mensaje_id&order=recibido_en.desc&limit=1`))[0];
        if (!msj) { log(`· caso ${cardId}: sin el correo original en el buzón, no se puede responder en el hilo`); continue; }
        if (MODO_ENVIO === "prueba") {
          destino = CORREO_PRUEBA_PV;
          await graphPost(`/messages/${encodeURIComponent(msj.mensaje_id)}/reply`, {
            message: { toRecipients: [{ emailAddress: { address: destino } }], ...(COPIA_OCULTA.length ? { bccRecipients: COPIA_OCULTA } : {}) },
            comment: `[PRUEBA · en modo real iría a Canon en este mismo hilo]\n\n${texto}`,
          });
        } else {
          destino = "hilo de Canon (responder a todos)";
          await graphPost(`/messages/${encodeURIComponent(msj.mensaje_id)}/replyAll`,
            { comment: texto, ...(COPIA_OCULTA.length ? { message: { bccRecipients: COPIA_OCULTA } } : {}) });
        }
      } else {
        if (!caso.correo || !caso.correo.includes("@")) { log(`· caso ${cardId}: el cliente no dejó correo`); continue; }
        destino = MODO_ENVIO === "prueba" ? CORREO_PRUEBA_PV : caso.correo;
        await graphPost("/sendMail", { message: {
          subject: `${MODO_ENVIO === "prueba" ? "[PRUEBA] " : ""}Tu pedido ${(lista[0].ordenes[0] || {}).orden || ""} · Respuesta de BigTicket`.trim(),
          body: { contentType: "Text", content: (MODO_ENVIO === "prueba" ? `[PRUEBA · en modo real iría a ${caso.correo}]\n\n` : "") + texto },
          toRecipients: [{ emailAddress: { address: destino } }],
          ...(COPIA_OCULTA.length ? { bccRecipients: COPIA_OCULTA } : {}),
        }, saveToSentItems: true });
      }

      for (const t of lista) {
        await fetch(`${CL_URL}/rest/v1/postventa_tareas_cl?id=eq.${t.id}`, {
          method: "PATCH", headers: { ...cab, Prefer: "return=minimal" },
          body: JSON.stringify({ correo_enviado_en: new Date().toISOString(), correo_destino: `${MODO_ENVIO}: ${destino}`, correo_texto: texto }),
        });
      }
      log(`✉ caso ${cardId} → ${destino} (${MODO_ENVIO})`);
      await evento(cardId, "correo", `Envió la respuesta por correo a ${destino}${MODO_ENVIO === "prueba" ? " (modo prueba)" : ""}`);
      n++;
    } catch (e) { log(`✗ envío caso ${cardId}: ${e.message}`); }
  }
  return n;
}

// ── Ciclo ──────────────────────────────────────────────────────────────────
let ultimaVuelta = null;

async function ciclo() {
  // 10 min de traslape: lo que se editó mientras corría la vuelta anterior no se pierde.
  const desde = ultimaVuelta
    ? new Date(ultimaVuelta.getTime() - 10 * 60000).toISOString()
    : new Date(Date.now() - DIAS_INICIO * 864e5).toISOString();
  const inicio = new Date();

  const form = await tarjetasDesde(PIPE_FORMULARIO, desde);
  await sbUpsert(form.map(deFormulario));

  const post = await tarjetasDesde(PIPE_POSTVENTA, desde);
  let correos = 0, enlazadas = 0, portal = 0;
  const filasCorreo = [];
  for (const card of post) {
    const c = campos(card);
    if (/CUIDADO AL CLIENTE/i.test(card.title || "")) {
      try { if (await enlazarConFormulario(card)) enlazadas++; } catch (e) { log(`✗ enlace ${card.id}: ${e.message}`); }
      continue;
    }
    if (esPortal(card, c)) { filasCorreo.push(dePortal(card)); portal++; continue; }
    if (esCanonCorreo(c)) { filasCorreo.push(deCorreo(card)); correos++; }
  }
  await sbUpsert(filasCorreo);

  const dt = await completarDespachos();
  let biggy = 0, lector = 0;
  try { biggy = await clasificarPendientes(); } catch (e) { log("✗ Biggy:", e.message); }
  try { lector = await leerCorreos(); } catch (e) { log("✗ lector:", e.message); }
  let revisor = 0;
  try { revisor = await revisarRespuestas(); } catch (e) { log("✗ revisor:", e.message); }
  let buzon = null;
  try { buzon = await sincronizarBuzon(); } catch (e) { log("✗ buzón:", e.message); }
  let tareas = 0, tareasRev = 0;
  try { tareas = await crearTareas(); } catch (e) { log("✗ tareas:", e.message); }
  try { tareasRev = await revisarTareas(); } catch (e) { log("✗ revisión de tareas:", e.message); }
  let enviados = 0;
  try { enviados = await enviarRespuestas(); } catch (e) { log("✗ envío:", e.message); }
  ultimaVuelta = inicio;
  return { form: form.length, revisadas: post.length, correos, enlazadas, portal, dt, biggy, lector, revisor, buzon, tareas, tareasRev, enviados };
}

(async () => {
  log(`Arrancando · cada ${INTERVALO / 1000}s · primera vuelta: últimos ${DIAS_INICIO} días`);
  async function vuelta() {
    try {
      const r = await ciclo();
      log(`formulario: ${r.form} tarjetas · postventa: ${r.revisadas} revisadas, ${r.correos} correos Canon, ${r.portal} del portal OL, ` +
          `${r.enlazadas} enlazadas al formulario · DispatchTrack: ${r.dt} pedidos · Biggy clasificó ${r.biggy} · correos leídos ${r.lector} · respuestas revisadas ${r.revisor}` +
          (r.buzon ? ` · buzón: ${r.buzon.nuevos} correos, ${r.buzon.enlazados} enlazados a su caso` : "") +
          (CECOS_PILOTO.length ? ` · tareas: ${r.tareas} nuevas, ${r.tareasRev} revisadas (piloto ${CECOS_PILOTO.join(", ")})` : "") +
          (MODO_ENVIO !== "apagado" ? ` · respuestas enviadas: ${r.enviados} (${MODO_ENVIO})` : ""));
    } catch (e) { log("✗", e.message); }
  }
  await vuelta();
  if (UN_CICLO) process.exit(0);
  setInterval(vuelta, INTERVALO);
})();
