// ═══════════════════════════════════════════════════════════════════════════
// POSTVENTA CHILE · BANDEJA  (instructivo Biggy Postventa Chile, v1 26-oct-2026)
//
// Todos los casos de MELI y Canon en una sola lista, como en la maqueta:
// pestañas Todos / PNR MELI / Canon / Revisión manual, indicadores, filtros,
// tabla y panel de revisión manual. Colores y fuente del Brain.
//
// Fuentes (bigticket-cl):
//   pnr_casos_cl + pnr_avisos_cl   PNR de MELI (pnr-cl.cjs)
//   canon_casos_cl                 Canon formulario y correo (canon-cl.cjs)
//   postventa_sla_cl               plazos por origen, editables por los analistas
//   postventa_urgentes_cl          casos marcados urgentes, con su plazo
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

const C = {
  navy: "#1a3a6b", navyTenue: "#eef2f8",
  naranja: "#F47B20", naranjaTenue: "#fdf1e6",
  ambar: "#a35d0f", ambarTenue: "#fdf3e3",
  rojo: "#b42318", rojoTenue: "#fdecea",
  verde: "#1f7a5c", verdeTenue: "#e7f4ee",
  amarillo: "#8a6d00", amarilloTenue: "#fdf6d8",
  azul: "#2a5aa8", azulTenue: "#e8eef9",
  gris: "#6b7280", grisTenue: "#f1f3f6",
  fondo: "#f4f5f7", borde: "#e3e6eb", texto: "#1f2937", suave: "#4b5563", tenue: "#9aa3af",
};
const FUENTE = "'Geist', system-ui, -apple-system, sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const TZ = "America/Santiago";

async function api(path, op) {
  const o = op || {};
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: Object.assign({ apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" }, o.headers || {}),
    body: o.body,
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t && t.trim() ? JSON.parse(t) : true;
}

const fechaCorta = (iso) => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .format(new Date(iso)).replace(",", "");
  } catch (e) { return "—"; }
};
const diaSemana = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date(ms));
function horasUsadas(desdeIso, hastaMs, sinDomingos) {
  if (!desdeIso) return 0;
  const ini = new Date(desdeIso).getTime();
  if (!sinDomingos) return Math.max(0, (hastaMs - ini) / 3600000);
  const PASO = 15 * 60000;
  let t = ini, total = 0;
  while (t < hastaMs) { const s = Math.min(hastaMs, t + PASO); if (diaSemana(t) !== "Sun") total += s - t; t = s; }
  return total / 3600000;
}
// Un solo formato por persona: "NATIVIDAD AEDO" y "natividad aedo" → "Natividad Aedo".
const nombrePropio = (n) => (!n ? n : String(n).toLowerCase().replace(/(^|[\s(])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase()));
const textoHoras = (h) => (h >= 48 ? `${Math.floor(h / 24)} días` : h >= 24 ? "1 día" : h >= 1 ? `${Math.floor(h)} h` : `${Math.max(1, Math.round(h * 60))} min`);

// ── Normalización de cada fuente a una fila de la bandeja ──────────────────

const ESTADO_PNR = {
  WAITING_RECEIPT: { estado: "Asignado", abierto: true },
  TO_BILL: { estado: "Con penalidad", abierto: true },
  UPLOADED_RECEIPT: { estado: "Respondido en Logistic", respuesta: "Comprobante cargado" },
  ASSIGNED: { estado: "En revisión MELI", respuesta: "Comprobante cargado" },
  ON_REVIEW: { estado: "En revisión MELI", respuesta: "Comprobante cargado" },
  WITHOUT_RECEIPT: { estado: "Sin respaldo", respuesta: "Sin comprobante" },
  NOT_BILLED: { estado: "Anulado", cerrado: true },
  BILLED: { estado: "Cerrado con cobro", cerrado: true },
};

function filaPnr(c, aviso) {
  const e = ESTADO_PNR[c.sub_estado] || { estado: c.sub_estado || "—", abierto: true };
  const sinCeco = !c.ceco || c.ceco === "POR CLASIFICAR" || (aviso && aviso.destino === "sin_ceco" && !aviso.enviado_en);
  return {
    clave: `pnr:${c.case_id}`, origen: "pnr_meli", origenTxt: "MELI · Logistic", tipo: "PNR MELI",
    titulo: `PNR ${c.case_id}`, sub: `Ruta ${c.route_code || "—"} · ${c.service_center || "—"}`,
    clasificacion: "Reclamo PNR", ceco: c.ceco, responsable: nombrePropio(c.supervisor) || "—",
    creado: c.fecha_caso, abierto: !!e.abierto, cerrado: !!e.cerrado, estado: e.estado,
    revision: e.respuesta ? { txt: e.respuesta, tono: e.respuesta === "Sin comprobante" ? "malo" : "bueno" } : e.abierto ? { txt: "Sin respuesta", tono: "neutro" } : null,
    manual: e.abierto && sinCeco ? "No se pudo asignar el CECO: el correo a postventa no salió" : null,
    accionManual: "Asignar CECO en la pestaña PNR MELI",
    buscar: [c.case_id, c.conductor, c.route_code, c.service_center, c.ceco, c.supervisor].join(" "),
    detalle: [
      ["Conductor", c.conductor], ["Estación", c.service_center], ["Ruta", c.route_code],
      ["Monto", c.monto != null ? "$" + Math.round(c.monto).toLocaleString("es-CL") : null],
      ["CECO resuelto por", c.ceco_como], ["Correo a postventa", aviso && aviso.enviado_en ? fechaCorta(aviso.enviado_en) : "no enviado"],
    ],
  };
}

function clasificacionCanon(c) {
  const f = String(c.fase || "").toLowerCase();
  if (c.canal === "correo") return "Postventa supervisor";
  if (f.includes("pendiente")) return "Por clasificar";
  if (f.includes("mandante")) return "Postventa mandante";
  if (f.includes("postventa")) return "Postventa supervisor";
  if (/comentario|sugerencia/i.test(c.motivo || "")) return "Comentario o sugerencia";
  return "Cerrado sin clasificar";
}

// Clasificación del Biggy y de la ejecutiva, con los nombres del instructivo.
const NOMBRE_CLAS = {
  supervisor: "Postventa supervisor", consulta: "Consulta de estado", mandante: "Postventa mandante",
  comentario: "Comentario o sugerencia", revision_manual: "Revisión manual",
};

function filaCanon(c, supSugerido) {
  const clas = clasificacionCanon(c);
  const biggy = c.canal === "formulario" && c.biggy_clasificacion && c.biggy_clasificacion !== "error" ? c.biggy_clasificacion : null;
  const resuelto = /resuelt/i.test(c.fase || "");
  const deSupervisor = clas === "Postventa supervisor";
  const abierto = !resuelto && (deSupervisor ? !c.respuesta : clas === "Por clasificar");
  const responsable = clas === "Postventa mandante" ? "Canon (Dahianna)"
    : clas === "Comentario o sugerencia" ? "Sin gestión"
    : nombrePropio(c.supervisor) || (supSugerido ? `${nombrePropio(supSugerido)} (sugerido)` : "—");
  const estado = resuelto ? (clas === "Comentario o sugerencia" ? "Registrado" : "Cerrado")
    : clas === "Postventa mandante" ? "Derivado a Canon"
    : clas === "Por clasificar" ? "Por clasificar"
    : c.respuesta ? "Respondido" : c.supervisor ? "Asignado" : "Sin asignar";

  let manual = null, accion = "Revisar el caso";
  if (!resuelto && deSupervisor) {
    if (/no encontrado/i.test(c.region || "")) { manual = "Orden no encontrada en DispatchTrack: no se puede definir C_RM o C_VIÑA"; accion = "Buscar y asignar"; }
    else if (/sin pedido|sin región/i.test(c.region || "")) { manual = "Sin número de orden identificable"; accion = c.canal === "correo" ? "Revisar el correo" : "Buscar y asignar"; }
    else if (!c.ceco && c.region) { manual = `Región ${c.region}: no corresponde a C_RM ni C_VIÑA`; accion = "Asignar CECO"; }
  }
  if (!resuelto && !manual && c.respuesta && c.revision_calificacion === "fuera_de_lugar" && c.revision_de === c.respuesta) {
    manual = `Respuesta fuera de lugar: ${c.revision_razon || "no responde lo pedido"}`; accion = "Revisar la respuesta";
  }
  if (!resuelto && c.canal === "correo" && !manual && c.ordenes_resumen) {
    if (/sin orden/i.test(c.ordenes_resumen)) { manual = "Correo sin orden identificable: no se encontró ninguna orden en DispatchTrack"; accion = "Revisar el correo"; }
    else if (/no encontrada/i.test(c.ordenes_resumen)) { manual = `Hay órdenes que no existen en DispatchTrack (${c.ordenes_resumen})`; accion = "Revisar órdenes"; }
  }
  if (clas === "Por clasificar" && !manual) {
    manual = biggy === "revision_manual"
      ? `El Biggy no pudo decidir: ${c.biggy_razon || "mensaje ambiguo"}`
      : "Formulario sin clasificar: ¿problema de entrega o de producto?";
    accion = "Clasificar";
  }

  const origen = c.canal === "correo" ? "canon_correo" : "canon_formulario";
  return {
    clave: `canon:${c.card_id}`, origen, origenTxt: c.canal === "correo" ? "Canon · Correo" : "Canon · Formulario", tipo: "Canon",
    titulo: c.canal === "correo" ? "Correo Canon" : `Formulario · ${c.pedido || "sin pedido"}`,
    sub: c.canal === "correo" ? (c.ordenes_resumen ? `${c.ordenes_resumen} · ${c.titulo || ""}` : (c.titulo || "")) : "Cliente final",
    cardId: c.card_id, ordenesResumen: c.ordenes_resumen,
    clasificacion: biggy ? NOMBRE_CLAS[biggy] : clas, ceco: clas === "Postventa mandante" ? "Mandante" : c.ceco, responsable,
    biggy, ejecutiva: c.ejecutiva_clasificacion || null,
    biggyRazon: c.biggy_razon, biggyResumen: c.biggy_resumen,
    creado: c.creado_en, abierto, cerrado: resuelto, estado,
    revision: !deSupervisor ? { txt: "No aplica", tono: "neutro" } : c.respuesta ? (revisionBiggy(c) || { txt: "Por revisar", tono: "neutro" }) : { txt: "Sin respuesta", tono: "neutro" },
    calificacion: c.respuesta ? c.revision_calificacion : null, revisionRazon: c.revision_razon,
    manual, accionManual: accion,
    pipefy: `https://app.pipefy.com/open-cards/${c.card_id}`,
    buscar: [c.pedido, c.remitente, c.titulo, c.texto, c.ceco, c.supervisor, c.card_id].join(" "),
    detalle: [
      [c.canal === "correo" ? "Remitente" : "Cliente", c.remitente], ["Pedido", c.pedido],
      ["Motivo marcado", c.motivo], ["Región (DispatchTrack)", c.region], ["Comuna", c.comuna],
      ["Estado del pedido", c.estado_pedido], ["Fase en Pipefy", c.fase],
    ],
    texto: c.texto, respuesta: c.respuesta,
  };
}

function filaPortal(c) {
  const cancelacion = /^cancelaci/i.test(c.titulo || "");
  const cerrado = /resuelt|no amerita/i.test(c.fase || "");
  const abierto = !cerrado && !c.respuesta;
  return {
    clave: `portal:${c.card_id}`, origen: cancelacion ? "portal_cancelacion" : "portal_reclamo",
    origenTxt: cancelacion ? "Portal · Cancelación" : "Portal · Reclamo", tipo: "Portal",
    titulo: `${cancelacion ? "Cancelación" : "Reclamo"} · ${c.pedido || "sin OT"}`,
    sub: [c.mandante, c.remitente].filter(Boolean).join(" · ") || "Cliente del portal",
    clasificacion: cancelacion ? "Cancelación de envío" : (String(c.motivo || "").split(" · ")[1] || "Reclamo portal"),
    ceco: c.ceco, responsable: nombrePropio(c.supervisor) || "—",
    creado: c.creado_en, abierto, cerrado, estado: cerrado ? "Cerrado" : c.respuesta ? "Respondido" : c.supervisor ? "Asignado" : "Sin asignar",
    revision: c.respuesta ? (revisionBiggy(c) || { txt: "Por revisar", tono: "neutro" }) : abierto ? { txt: "Sin respuesta", tono: "neutro" } : null,
    calificacion: c.respuesta ? c.revision_calificacion : null, revisionRazon: c.revision_razon,
    manual: abierto && cancelacion && !c.supervisor ? "Cancelación sin asignar: hay que frenar el envío cuanto antes" : null,
    accionManual: "Ver caso",
    pipefy: `https://app.pipefy.com/open-cards/${c.card_id}`,
    buscar: [c.pedido, c.mandante, c.remitente, c.correo, c.titulo, c.texto].join(" "),
    detalle: [
      ["Cliente", c.remitente], ["Empresa (workspace)", c.mandante], ["OT", c.pedido],
      ["Email del cliente (responder aquí)", c.correo], ["Motivo", c.motivo], ["Fase en Pipefy", c.fase],
    ],
    texto: c.texto, respuesta: c.respuesta,
  };
}

// ── Piezas visuales ────────────────────────────────────────────────────────

function Pastilla({ txt, color, fondo, title }) {
  return (
    <span title={title} style={{ display: "inline-block", fontSize: 11.5, fontWeight: 600, color, background: fondo,
      borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{txt}</span>
  );
}
const colorOrigen = (o) => (o === "pnr_meli" ? [C.amarillo, C.amarilloTenue] : /^portal/.test(o) ? ["#6b4fa0", "#f1edf8"] : [C.azul, C.azulTenue]);
const colorRevision = (t) => (t === "bueno" ? [C.verde, C.verdeTenue] : t === "malo" ? [C.ambar, C.ambarTenue] : t === "rojo" ? [C.rojo, C.rojoTenue] : [C.gris, C.grisTenue]);

// Calificación del Biggy revisor (modo sombra) → pastilla de la columna "Revisión de la respuesta".
function revisionBiggy(c) {
  if (!c.revision_calificacion || c.revision_de !== c.respuesta) return null;
  if (c.revision_calificacion === "correcta") return { txt: "Correcta", tono: "bueno" };
  if (c.revision_calificacion === "incompleta") return { txt: `Incompleta${c.revision_falta ? ": falta " + c.revision_falta : ""}`, tono: "malo" };
  return { txt: "Fuera de lugar", tono: "rojo" };
}

function PastillaSla({ f, cfg, urg, ahora }) {
  if (!f.abierto) return <Pastilla txt="No aplica" color={C.gris} fondo={C.grisTenue} />;
  const plazo = urg ? Number(urg.sla_horas) : Number(cfg.sla_horas);
  const usado = horasUsadas(f.creado, ahora, cfg.sin_domingos);
  const resta = plazo - usado;
  if (resta <= 0) return <Pastilla txt={`Vencido ${textoHoras(-resta)}`} color={C.rojo} fondo={C.rojoTenue} title={`Plazo ${plazo} h`} />;
  const aviso = Number(cfg.aviso_horas);
  if (resta <= aviso) return <Pastilla txt={`Vence en ${textoHoras(resta)}`} color={C.ambar} fondo={C.ambarTenue} title={`Plazo ${plazo} h · aviso a las ${aviso} h`} />;
  return <Pastilla txt={textoHoras(resta)} color={C.verde} fondo={C.verdeTenue} title={`Plazo ${plazo} h`} />;
}

function Indicador({ etiqueta, valor, color, nota }) {
  return (
    <div style={{ flex: 1, minWidth: 170, background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ fontSize: 13, color: C.suave, lineHeight: 1.3 }}>{etiqueta}</div>
      <div style={{ fontSize: 34, fontWeight: 700, color: color || C.texto, lineHeight: 1.25, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      {nota && <div style={{ fontSize: 11.5, color: C.tenue }}>{nota}</div>}
    </div>
  );
}

function Campo({ etiqueta, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: C.suave, flex: 1, minWidth: 140 }}>
      {etiqueta}{children}
    </label>
  );
}
const control = { fontSize: 13.5, padding: "9px 11px", borderRadius: 9, border: `1px solid ${C.borde}`, background: "#fff", fontFamily: FUENTE, color: C.texto };

// Editor de plazos: los analistas cambian horas, aviso y domingos por origen.
function EditorPlazos({ sla, usuario, onCerrar, onGuardado }) {
  const [filas, setFilas] = useState(() => sla.map((s) => ({ ...s })));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const nombre = { pnr_meli: "PNR MELI", canon_formulario: "Canon · Formulario", canon_correo: "Canon · Correo",
    portal_reclamo: "Portal OL · Reclamo", portal_cancelacion: "Portal OL · Cancelación" };
  const guardar = async () => {
    setGuardando(true); setError("");
    try {
      for (const f of filas) {
        await api(`postventa_sla_cl?origen=eq.${f.origen}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ sla_horas: Number(f.sla_horas), aviso_horas: Number(f.aviso_horas), sin_domingos: !!f.sin_domingos,
            actualizado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain", actualizado_en: new Date().toISOString() }) });
      }
      onGuardado(); onCerrar();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };
  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 22, width: "min(620px,100%)", fontFamily: FUENTE }}>
        <div style={{ fontSize: 19, fontWeight: 700, color: C.navy }}>Plazos de respuesta</div>
        <div style={{ fontSize: 13, color: C.suave, margin: "4px 0 16px" }}>Rigen para todos los casos abiertos apenas los guardas. Un caso urgente usa su propio plazo.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr .8fr .9fr", gap: 10, fontSize: 12, color: C.suave, marginBottom: 6 }}>
          <span>Origen</span><span>Plazo (horas)</span><span>Avisar con (horas)</span><span>Descontar domingos</span>
        </div>
        {filas.map((f, i) => (
          <div key={f.origen} style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr .8fr .9fr", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.borde}` }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.texto }}>{nombre[f.origen] || f.origen}</span>
            <input type="number" min="1" value={f.sla_horas} onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, sla_horas: e.target.value } : x))} style={control} />
            <input type="number" min="0" value={f.aviso_horas} onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, aviso_horas: e.target.value } : x))} style={control} />
            <input type="checkbox" checked={!!f.sin_domingos} onChange={(e) => setFilas((p) => p.map((x, j) => j === i ? { ...x, sin_domingos: e.target.checked } : x))} style={{ width: 18, height: 18 }} />
          </div>
        ))}
        {error && <div style={{ color: C.rojo, fontSize: 12.5, marginTop: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onCerrar} style={{ ...control, cursor: "pointer" }}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} style={{ ...control, cursor: "pointer", background: C.navy, color: "#fff", border: `1px solid ${C.navy}`, fontWeight: 700 }}>
            {guardando ? "Guardando…" : "Guardar plazos"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Órdenes de un correo de Canon, agrupadas por CECO: cada grupo es la tarea de un supervisor.
function OrdenesCorreo({ cardId, supPorCeco }) {
  const [ordenes, setOrdenes] = useState(null);
  useEffect(() => {
    api(`canon_ordenes_cl?card_id=eq.${cardId}&select=orden,fuente,encontrada,region,comuna,estado,ceco&order=ceco`)
      .then((x) => setOrdenes(x || [])).catch(() => setOrdenes([]));
  }, [cardId]);
  if (ordenes === null) return <div style={{ fontSize: 12.5, color: C.tenue }}>Leyendo órdenes…</div>;
  if (!ordenes.length) return <div style={{ fontSize: 12.5, color: C.tenue }}>El lector todavía no procesó este correo, o no encontró órdenes.</div>;
  const grupos = {};
  for (const o of ordenes) { const k = o.encontrada ? (o.ceco || "Otra región") : "No encontradas en DispatchTrack"; (grupos[k] = grupos[k] || []).push(o); }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Object.entries(grupos).map(([k, lista]) => {
        const malo = k.startsWith("No encontradas") || k === "Otra región";
        const sup = supPorCeco[k];
        return (
          <div key={k} style={{ border: `1px solid ${malo ? C.naranja + "66" : C.borde}`, borderRadius: 10, padding: "8px 10px", background: malo ? C.ambarTenue : "#fff" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: malo ? C.ambar : C.navy, marginBottom: 4 }}>
              {k}{!malo && sup ? ` · tarea para ${nombrePropio(sup)}` : ""} · {lista.length} {lista.length === 1 ? "orden" : "órdenes"}
            </div>
            {lista.map((o) => (
              <div key={o.orden} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 8, fontSize: 12, padding: "2px 0" }}>
                <span style={{ fontFamily: MONO }}>{o.orden}</span>
                <span style={{ color: C.suave }}>{o.encontrada ? [o.comuna, o.region].filter(Boolean).join(", ") : "no existe en DispatchTrack"}</span>
                <span style={{ color: C.suave }}>{o.estado || (o.fuente === "adjunto" ? "desde el adjunto" : "")}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Detalle del caso: datos, texto de origen, respuesta y marca de urgente.
function Detalle({ f, urg, onUrgente, supPorCeco }) {
  const [horas, setHoras] = useState(urg ? String(urg.sla_horas) : "12");
  return (
    <div style={{ padding: "14px 20px 18px", background: C.fondo, borderTop: `1px solid ${C.borde}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(260px,1fr)", gap: 14 }}>
        <div>
          {f.biggy && (
            <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.texto, marginBottom: 4 }}>
                Clasificación del Biggy: <span style={{ color: C.navy }}>{NOMBRE_CLAS[f.biggy]}</span>
                {f.ejecutiva && (
                  <span style={{ fontWeight: 500, color: f.ejecutiva === f.biggy ? C.verde : C.ambar }}>
                    {" "}· ejecutiva: {NOMBRE_CLAS[f.ejecutiva]} {f.ejecutiva === f.biggy ? "(coincide)" : "(distinta)"}
                  </span>
                )}
              </div>
              {f.biggyRazon && <div style={{ fontSize: 12.5, color: C.suave }}>Por qué: {f.biggyRazon}</div>}
              {f.biggyResumen && <div style={{ fontSize: 13, color: C.texto, marginTop: 6 }}>{f.biggyResumen}</div>}
            </div>
          )}
          {f.origen === "canon_correo" && f.cardId && (
            <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.texto, marginBottom: 8 }}>Órdenes del correo</div>
              <OrdenesCorreo cardId={f.cardId} supPorCeco={supPorCeco || {}} />
            </div>
          )}
          {f.texto && (
            <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.texto, marginBottom: 6 }}>{f.origen === "canon_correo" ? "Correo de Canon" : "Lo que escribió el cliente"}</div>
              <div style={{ fontSize: 13.5, color: C.texto, whiteSpace: "pre-wrap", lineHeight: 1.55, maxHeight: 240, overflow: "auto", background: C.grisTenue, borderRadius: 10, padding: "10px 12px" }}>{f.texto}</div>
            </div>
          )}
          <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.texto, marginBottom: 6 }}>Respuesta del supervisor</div>
            <div style={{ fontSize: 13.5, color: f.respuesta ? C.texto : C.tenue, whiteSpace: "pre-wrap" }}>{f.respuesta || (f.origen === "pnr_meli" ? "Se responde en Logistic cargando el comprobante." : "Todavía sin respuesta.")}</div>
            {f.calificacion && f.revision && (
              <div style={{ marginTop: 8, fontSize: 12.5 }}>
                <strong>Revisión del Biggy:</strong>{" "}
                <span style={{ color: colorRevision(f.revision.tono)[0], fontWeight: 700 }}>{f.revision.txt}</span>
                {f.revisionRazon && <div style={{ color: C.suave, marginTop: 2 }}>{f.revisionRazon}</div>}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
            {f.detalle.map(([k, v]) => (
              <div key={k}><div style={{ fontSize: 11.5, color: C.tenue }}>{k}</div><div style={{ fontSize: 13, color: C.texto, wordBreak: "break-word" }}>{v || "—"}</div></div>
            ))}
          </div>
          {f.abierto && (
            <div style={{ background: urg ? C.rojoTenue : "#fff", border: `1px solid ${urg ? C.rojo + "55" : C.borde}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: urg ? C.rojo : C.texto, marginBottom: 6 }}>{urg ? `Urgente · plazo ${urg.sla_horas} h` : "Prioridad normal"}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" min="1" value={horas} onChange={(e) => setHoras(e.target.value)} style={{ ...control, width: 90 }} />
                <span style={{ fontSize: 12.5, color: C.suave }}>horas</span>
                <button onClick={() => onUrgente(f, true, Number(horas))} style={{ ...control, cursor: "pointer", background: C.rojo, color: "#fff", border: `1px solid ${C.rojo}`, fontWeight: 700 }}>
                  {urg ? "Cambiar plazo" : "Marcar urgente"}
                </button>
                {urg && <button onClick={() => onUrgente(f, false)} style={{ ...control, cursor: "pointer" }}>Quitar</button>}
              </div>
            </div>
          )}
          {f.pipefy && (
            <a href={f.pipefy} target="_blank" rel="noreferrer" style={{ ...control, textAlign: "center", textDecoration: "none", color: C.navy, border: `1px solid ${C.navy}`, fontWeight: 700 }}>
              Abrir tarjeta en Pipefy
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const GRID = "minmax(170px,1.3fr) 150px minmax(140px,1fr) 128px minmax(130px,1fr) 118px minmax(130px,1fr) minmax(120px,.9fr)";

export default function BandejaPostventa({ usuario, onIrA }) {
  const [pnr, setPnr] = useState([]);
  const [avisos, setAvisos] = useState({});
  const [canon, setCanon] = useState([]);
  const [sla, setSla] = useState([]);
  const [urgentes, setUrgentes] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ultima, setUltima] = useState(null);
  const [pestana, setPestana] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [fClas, setFClas] = useState("todas");
  const [fCeco, setFCeco] = useState("todos");
  const [fSup, setFSup] = useState("todos");
  const [fPrio, setFPrio] = useState("todas");
  const [fEstado, setFEstado] = useState("abiertos");
  const [abierta, setAbierta] = useState(null);
  const [editarPlazos, setEditarPlazos] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      const [p, a, c, s, u] = await Promise.all([
        api("pnr_casos_cl?select=case_id,sub_estado,service_center,route_code,conductor,ceco,supervisor,ceco_como,fecha_caso,monto&order=fecha_caso.desc&limit=3000"),
        api("pnr_avisos_cl?canal=eq.correo&select=case_id,destino,enviado_en&limit=10000"),
        api("canon_casos_cl?select=card_id,canal,creado_en,fase,titulo,mandante,pedido,remitente,correo,motivo,texto,ceco,supervisor,respuesta,region,comuna,estado_pedido,ordenes_resumen,revision_calificacion,revision_falta,revision_razon,revision_de,biggy_clasificacion,biggy_razon,biggy_resumen,ejecutiva_clasificacion&order=creado_en.desc&limit=3000"),
        api("postventa_sla_cl?select=*&order=origen"),
        api("postventa_urgentes_cl?urgente=eq.true&select=*"),
      ]);
      setPnr(p || []);
      setAvisos(Object.fromEntries((a || []).map((x) => [x.case_id, x])));
      setCanon((c || []).filter((x) => x.canal === "portal" || /canontex/i.test(x.mandante || "") || /@canontex\.cl\s*$/i.test(x.correo || "")));
      setSla(s || []);
      setUrgentes(Object.fromEntries((u || []).map((x) => [x.caso, x])));
      setUltima(new Date()); setError("");
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); const t = setInterval(cargar, 60000); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  const cfg = useMemo(() => {
    const m = Object.fromEntries(sla.map((s) => [s.origen, s]));
    const def = { pnr_meli: 96, canon_formulario: 48, canon_correo: 48, portal_reclamo: 48, portal_cancelacion: 4 };
    return (o) => m[o] || { origen: o, sla_horas: def[o] || 48, aviso_horas: 24, sin_domingos: false };
  }, [sla]);

  // Supervisor sugerido por CECO para Canon: el más frecuente entre los asignados.
  const supPorCeco = useMemo(() => {
    const k = {};
    for (const c of canon) if (c.ceco && c.supervisor) { k[c.ceco] = k[c.ceco] || {}; k[c.ceco][c.supervisor] = (k[c.ceco][c.supervisor] || 0) + 1; }
    return Object.fromEntries(Object.entries(k).map(([ce, v]) => [ce, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));
  }, [canon]);

  const filas = useMemo(() => [
    ...pnr.map((c) => filaPnr(c, avisos[c.case_id])),
    ...canon.filter((c) => c.canal !== "portal").map((c) => filaCanon(c, c.ceco ? supPorCeco[c.ceco] : null)),
    ...canon.filter((c) => c.canal === "portal").map(filaPortal),
  ], [pnr, avisos, canon, supPorCeco]);

  const resta = useCallback((f) => {
    const c = cfg(f.origen), u = urgentes[f.clave];
    return (u ? Number(u.sla_horas) : Number(c.sla_horas)) - horasUsadas(f.creado, ahora, c.sin_domingos);
  }, [cfg, urgentes, ahora]);

  const abiertos = filas.filter((f) => f.abierto);
  const manuales = filas.filter((f) => f.manual);
  const ind = {
    abiertos: abiertos.length,
    porVencer: abiertos.filter((f) => { const r = resta(f); return r > 0 && r <= 24; }).length,
    vencidos: abiertos.filter((f) => resta(f) <= 0).length,
  };
  const cuenta = { todos: filas.length, pnr: filas.filter((f) => f.origen === "pnr_meli").length,
    canon: filas.filter((f) => f.tipo === "Canon").length, portal: filas.filter((f) => f.tipo === "Portal").length, manual: manuales.length };

  // Revisor en sombra: incompletas y fuera de lugar son las que volverían al supervisor.
  const revisadas = filas.filter((f) => f.calificacion).length;
  const devueltas = filas.filter((f) => f.calificacion === "incompleta" || f.calificacion === "fuera_de_lugar").length;

  // Coincidencia del Biggy con la ejecutiva (modo sombra), donde los dos clasificaron.
  const comparables = filas.filter((f) => f.biggy && f.ejecutiva && f.biggy !== "revision_manual");
  const coincidencia = comparables.length ? Math.round((comparables.filter((f) => f.biggy === f.ejecutiva).length * 100) / comparables.length) : null;

  const opciones = (fn) => [...new Set(filas.map(fn).filter((x) => x && x !== "—"))].sort();
  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return filas
      .filter((f) => pestana === "todos" || (pestana === "pnr" ? f.origen === "pnr_meli" : pestana === "canon" ? f.tipo === "Canon" : pestana === "portal" ? f.tipo === "Portal" : !!f.manual))
      .filter((f) => fClas === "todas" || f.clasificacion === fClas)
      .filter((f) => fCeco === "todos" || f.ceco === fCeco)
      .filter((f) => fSup === "todos" || f.responsable === fSup)
      .filter((f) => fPrio === "todas" || (fPrio === "urgente" ? !!urgentes[f.clave] : !urgentes[f.clave]))
      .filter((f) => fEstado === "todos" || (fEstado === "abiertos" ? f.abierto : fEstado === "cerrados" ? !f.abierto : f.estado === fEstado))
      .filter((f) => !q || f.buscar.toLowerCase().includes(q))
      .sort((a, b) => (a.abierto !== b.abierto ? (a.abierto ? -1 : 1) : a.abierto ? resta(a) - resta(b) : new Date(b.creado) - new Date(a.creado)))
      .slice(0, 400);
  }, [filas, pestana, fClas, fCeco, fSup, fPrio, fEstado, busqueda, urgentes, resta]);

  const marcarUrgente = async (f, urgente, horas) => {
    try {
      await api("postventa_urgentes_cl?on_conflict=caso", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ caso: f.clave, origen: f.origen, urgente, sla_horas: horas || null,
          marcado_por: (usuario && (usuario.nombre || usuario.email)) || "Brain", marcado_en: new Date().toISOString() }]) });
      cargar();
    } catch (e) { setError("No se pudo guardar la prioridad: " + e.message); }
  };

  const minutosDesde = ultima ? Math.max(0, Math.round((ahora - ultima.getTime()) / 60000)) : null;
  const pestanas = [["todos", "Todos"], ["pnr", "PNR MELI"], ["canon", "Canon"], ["portal", "Portal OL"], ["manual", "Revisión manual"]];

  return (
    <div style={{ fontFamily: FUENTE, color: C.texto }}>
      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 30, fontWeight: 800, color: C.texto, letterSpacing: -.5 }}>Postventa Chile</div>
          <div style={{ fontSize: 14, color: C.suave, marginTop: 2 }}>
            Todos los casos de MELI, Canon y el Portal OL{minutosDesde != null ? ` · actualizado hace ${minutosDesde} min` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 4 }}>
            {pestanas.map(([k, et]) => {
              const act = pestana === k;
              return (
                <button key={k} onClick={() => setPestana(k)}
                  style={{ fontFamily: FUENTE, fontSize: 13.5, fontWeight: act ? 700 : 500, border: "none", cursor: "pointer", borderRadius: 9, padding: "9px 14px",
                    background: act ? C.navy : "transparent", color: act ? "#fff" : k === "manual" && cuenta.manual ? C.ambar : C.texto }}>
                  {et} · {cuenta[k]}
                </button>
              );
            })}
          </div>
          <button onClick={() => setEditarPlazos(true)} style={{ ...control, cursor: "pointer", fontWeight: 600, color: C.navy }}>Plazos</button>
        </div>
      </div>

      {error && <div style={{ background: C.rojoTenue, color: C.rojo, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {/* Indicadores */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Indicador etiqueta="Casos abiertos" valor={ind.abiertos} />
        <Indicador etiqueta="Por vencer (menos de 24 h)" valor={ind.porVencer} color={C.ambar} />
        <Indicador etiqueta="Vencidos" valor={ind.vencidos} color={C.rojo} />
        <Indicador etiqueta="Respuestas que el Biggy devolvería" valor={revisadas ? devueltas : "—"} color={C.ambar}
          nota={revisadas ? `${Math.round((devueltas * 100) / revisadas)}% de ${revisadas} revisadas · modo sombra` : "revisando…"} />
        <Indicador etiqueta="El Biggy coincide con la ejecutiva" valor={coincidencia == null ? "—" : `${coincidencia}%`} color={C.verde}
          nota={coincidencia == null ? "clasificando…" : `en ${comparables.length} formularios de Canon · modo sombra`} />
      </div>

      {/* Filtros y tabla */}
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "14px 16px", borderBottom: `1px solid ${C.borde}` }}>
          <Campo etiqueta="Buscar"><input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="N° de caso, orden o chofer" style={{ ...control, minWidth: 220 }} /></Campo>
          <Campo etiqueta="Clasificación"><select value={fClas} onChange={(e) => setFClas(e.target.value)} style={control}><option value="todas">Todas</option>{opciones((f) => f.clasificacion).map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta="CECO"><select value={fCeco} onChange={(e) => setFCeco(e.target.value)} style={control}><option value="todos">Todos</option>{opciones((f) => f.ceco).map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta="Responsable"><select value={fSup} onChange={(e) => setFSup(e.target.value)} style={control}><option value="todos">Todos</option>{opciones((f) => f.responsable).map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta="Prioridad"><select value={fPrio} onChange={(e) => setFPrio(e.target.value)} style={control}><option value="todas">Todas</option><option value="urgente">Urgente</option><option value="normal">Normal</option></select></Campo>
          <Campo etiqueta="Estado"><select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={control}>
            <option value="abiertos">Abiertos</option><option value="cerrados">Cerrados</option><option value="todos">Todos</option>
            {opciones((f) => f.estado).map((x) => <option key={x}>{x}</option>)}
          </select></Campo>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1120 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "12px 20px", fontSize: 12, fontWeight: 600, color: C.suave, borderBottom: `1px solid ${C.borde}` }}>
              <span>Caso</span><span>Origen</span><span>Clasificación del Biggy</span><span>CECO</span><span>Responsable</span><span>Plazo</span><span>Revisión de la respuesta</span><span>Estado</span>
            </div>
            {cargando ? (
              <div style={{ padding: 30, textAlign: "center", color: C.suave }}>Cargando casos…</div>
            ) : !lista.length ? (
              <div style={{ padding: 30, textAlign: "center", color: C.suave }}>No hay casos con estos filtros. Prueba con Estado: Todos.</div>
            ) : lista.map((f) => {
              const [oc, of] = colorOrigen(f.origen);
              const urg = urgentes[f.clave];
              const [rc, rf] = f.revision ? colorRevision(f.revision.tono) : [C.gris, C.grisTenue];
              const esta = abierta === f.clave;
              return (
                <Fragment key={f.clave}>
                  <div onClick={() => setAbierta(esta ? null : f.clave)}
                    style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "14px 20px", borderBottom: `1px solid ${C.borde}`, alignItems: "center",
                      cursor: "pointer", background: esta ? C.fondo : "#fff" }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{f.titulo}</span>
                      <span style={{ display: "block", fontSize: 12, color: urg ? C.rojo : C.suave, fontWeight: urg ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {urg ? `URGENTE · plazo ${urg.sla_horas} h` : f.sub}
                      </span>
                    </span>
                    <span><Pastilla txt={f.origenTxt} color={oc} fondo={of} /></span>
                    <span style={{ fontSize: 13.5, lineHeight: 1.25 }}>
                      {f.clasificacion}
                      {f.biggy && f.ejecutiva && f.biggy !== f.ejecutiva && (
                        <span style={{ display: "block", fontSize: 11, color: C.ambar }}>ejecutiva: {NOMBRE_CLAS[f.ejecutiva]}</span>
                      )}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, color: f.ceco === "POR CLASIFICAR" ? C.rojo : C.texto }}>{f.ceco || "—"}</span>
                    <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis" }}>{f.responsable}</span>
                    <span><PastillaSla f={f} cfg={cfg(f.origen)} urg={urg} ahora={ahora} /></span>
                    <span>{f.revision ? <Pastilla txt={f.revision.txt} color={rc} fondo={rf} /> : <Pastilla txt="No aplica" color={C.gris} fondo={C.grisTenue} />}</span>
                    <span style={{ fontSize: 13.5, color: f.manual ? C.ambar : C.texto, fontWeight: f.manual ? 600 : 400 }}>{f.manual ? "Revisión manual" : f.estado}</span>
                  </div>
                  {esta && <Detalle f={f} urg={urg} onUrgente={marcarUrgente} supPorCeco={supPorCeco} />}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Revisión manual */}
      {manuales.length > 0 && (
        <div style={{ marginTop: 18, background: C.ambarTenue + "99", border: `1px solid ${C.naranja}55`, borderRadius: 14, padding: "16px 16px 18px" }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.ambar }}>Revisión manual</div>
          <div style={{ fontSize: 13.5, color: C.suave, margin: "2px 0 14px" }}>Lo que el sistema no pudo resolver solo. Meta: menos del 10% de los casos.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
            {manuales.slice(0, 12).map((f) => (
              <div key={f.clave} style={{ background: "#fff", border: `1px solid ${C.naranja}44`, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700 }}>{f.titulo}</span>
                  <span style={{ fontSize: 12, color: C.suave }}>{f.origenTxt.split(" · ")[1]}</span>
                </div>
                <div style={{ fontSize: 13, color: C.ambar }}>{f.manual}</div>
                <div>
                  <button onClick={() => {
                      if (f.origen === "pnr_meli" && onIrA) onIrA("casos");
                      else { setPestana("manual"); setFEstado("todos"); setAbierta(f.clave); }
                    }}
                    style={{ ...control, cursor: "pointer", color: C.navy, border: `1px solid ${C.navy}`, fontWeight: 700 }}>
                    {f.accionManual}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {manuales.length > 12 && <div style={{ fontSize: 12.5, color: C.suave, marginTop: 10 }}>Y {manuales.length - 12} más en la pestaña Revisión manual.</div>}
        </div>
      )}

      {editarPlazos && <EditorPlazos sla={sla} usuario={usuario} onCerrar={() => setEditarPlazos(false)} onGuardado={cargar} />}
    </div>
  );
}
