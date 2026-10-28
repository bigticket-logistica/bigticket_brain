// ═══════════════════════════════════════════════════════════════════════════
// POSVENTA · CHILE  (pestaña PNR)
// Misma forma de leer los PNR que Posventa MX en The Eyes, con los colores del
// Brain. Solo visual: no hay tareas, WhatsApp ni botones de notificar.
//
// Datos (bigticket-cl), los escribe pnr-cl.cjs desde el VPS de Chile:
//   pnr_casos_cl      una fila por caso
//   pnr_historial_cl  cada cambio de estado (trigger trg_pnr_historial_cl)
//   pnr_avisos_cl     avisos por caso y canal; acá solo se mira "correo"
//
// Las tarjetas y la tabla "Estado de los casos" son el filtro de la lista.
// La lista parte en Esperando comprobante + Con Penalidad: son los casos que
// generan correo a postventa y donde se trabaja.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import ModuloCanonCL from "./Canon";
import BandejaPostventa from "./Bandeja";
import EvaluacionBiggy from "./Evaluacion";

// Quiénes ven "Biggy vs ejecutiva" (evaluación del Biggy). Para sumar a alguien,
// agrega su correo del Brain a esta lista.
const PUEDEN_EVALUAR = ["adriana.giummarra@bigticket.cl", "eduardo.stine@bigticket.cl"];

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

// Paleta del Brain. El verde queda para una sola cosa: el correo enviado.
const C = {
  navy: "#1a3a6b", navyTenue: "#eef2f8",
  naranja: "#F47B20", naranjaTenue: "#fdf1e6",
  penalidad: "#b8651c", penalidadTenue: "#fdf3e8",
  ladrillo: "#9e3b1b", ladrilloTenue: "#faece6",
  verde: "#1f7a5c", verdeTenue: "#e9f3ef",
  gris: "#8a94a6", grisTenue: "#f4f6f9",
  borde: "#e4e7ec", texto: "#1f2937", suave: "#475569", tenue: "#94a3b8",
};

let SLA_H = 96;   // plazo PNR MELI; se toma de postventa_sla_cl (editable en "Plazos")
const REFRESCO_MS = 60 * 1000;

async function api(path, opciones) {
  const o = opciones || {};
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: Object.assign({ apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" }, o.headers || {}),
    body: o.body,
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 250)}`);
  const texto = await r.text();
  return texto && texto.trim() ? JSON.parse(texto) : true;
}

// CECOs válidos en las bodegas compartidas (mismo mapa que pnr-cl.cjs en el VPS).
const CECOS_COMPARTIDAS = {
  SRM1: ["ML_RM_SRM1", "ML_CORDILLERA", "ML_PICHILEMU", "ML_SALAMANCA"],
  SRM2: ["ML_RM_SRM2", "ML_MELIPILLA", "ML_SAN_ANTONIO"],
  SRM3: ["ML_RM_SRM3", "ML_MELIPILLA"],
  SBB1: ["ML_ARAUCO", "ML_CAÑETE"],
};
const esSinCeco = (correo) => !!(correo && correo.destino === "sin_ceco" && !correo.enviado_en);

// Origen del envío, legible para el informe.
const nombreOrigen = (o) => {
  if (!o) return "—";
  if (o.startsWith("brain")) return "Botón Brain" + (o.includes("·") ? " ·" + o.split("·").slice(1).join("·") : "");
  return { automatico: "Automático", analista: "Analista (manual)", vps_manual: "VPS manual" }[o] || o;
};

// Los ocho estados de MELI con el nombre de la planilla de la analista.
const ESTADOS_PNR = [
  { clave: "WAITING_RECEIPT",  etiqueta: "Esperando comprobante",   corto: "Esperando compr.", motivo: "Pendiente de resolución", grupo: "responder" },
  { clave: "TO_BILL",          etiqueta: "Con Penalidad",           corto: "Con penalidad",    motivo: "Pendiente de resolución, con probabilidad de pasar a cobro 50%", grupo: "penalidad" },
  { clave: "UPLOADED_RECEIPT", etiqueta: "Comprobante Cargado",     corto: "Compr. cargado",   motivo: "Respuesta enviada a mandante", grupo: "meli" },
  { clave: "ASSIGNED",         etiqueta: "Pendiente de revisión",   corto: "Pend. revisión",   motivo: "Pendiente de revisión por Mercado Libre", grupo: "meli" },
  { clave: "ON_REVIEW",        etiqueta: "En Revisión",             corto: "En revisión",      motivo: "En revisión por Mercado Libre", grupo: "meli" },
  { clave: "WITHOUT_RECEIPT",  etiqueta: "Sin Comprobante Cargado", corto: "Sin comprobante",  motivo: "Sin respuesta, sin respaldo", grupo: "sinrespaldo" },
  { clave: "NOT_BILLED",       etiqueta: "Anulado",                 corto: "Anulado",          motivo: "Reclamo cerrado por cliente o por Mercado Libre", grupo: "cerrado" },
  { clave: "BILLED",           etiqueta: "Enviado a Facturación",   corto: "A facturación",    motivo: "Pasa a cobro", grupo: "cerrado" },
];
const POR_ESTADO = Object.fromEntries(ESTADOS_PNR.map((e) => [e.clave, e]));

const COLOR_ESTADO = {
  WAITING_RECEIPT: C.naranja, TO_BILL: C.penalidad, UPLOADED_RECEIPT: C.navy, ASSIGNED: C.navy,
  ON_REVIEW: C.navy, WITHOUT_RECEIPT: C.ladrillo, NOT_BILLED: C.verde, BILLED: C.ladrillo,
};

const GRUPOS = [
  { clave: "responder",   etiqueta: "Por responder", nota: "falta el comprobante", color: C.naranja,   tinte: C.naranjaTenue,   reloj: true },
  { clave: "penalidad",   etiqueta: "Con penalidad", nota: "pedir revisión",       color: C.penalidad, tinte: C.penalidadTenue, reloj: true },
  { clave: "meli",        etiqueta: "Con respaldo",  nota: "Mercado Libre revisa", color: C.navy,      tinte: C.navyTenue },
  { clave: "sinrespaldo", etiqueta: "Sin respaldo",  nota: "respondido sin foto",  color: C.ladrillo,  tinte: C.ladrilloTenue },
  { clave: "cerrado",     etiqueta: "Cerrados",      nota: "anulados y cobrados",  color: C.verde,     tinte: C.verdeTenue },
];
const POR_CLAVE = Object.fromEntries(GRUPOS.map((g) => [g.clave, g]));

// Un sub_estado que MELI invente mañana cae en "responder": aparece arriba.
const clasificar = (c) => (POR_ESTADO[c.sub_estado] ? POR_ESTADO[c.sub_estado].grupo : "responder");
const conReloj = (c) => !!POR_CLAVE[clasificar(c)].reloj;

const TZ = "America/Santiago";
const dinero = (v) => "$" + Math.round(Number(v) || 0).toLocaleString("es-CL");
const diaCL = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) : "");
const hoyCL = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const pct = (n, total) => (total ? ((n * 100) / total).toFixed(1) + "%" : "0%");
const fechaCorta = (iso) => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(",", "");
  } catch (e) { return "—"; }
};
const hhmm = (h) => `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
const nombreEstado = (sub) => (POR_ESTADO[sub] ? POR_ESTADO[sub].etiqueta : sub || "—");

function hace(iso, ahora) {
  if (!iso) return { texto: "", hoy: false };
  const min = Math.round((ahora - new Date(iso).getTime()) / 60000);
  const hoy = diaCL(iso) === hoyCL();
  if (min < 60) return { texto: `hace ${Math.max(min, 1)} min`, hoy };
  if (min < 2880) return { texto: `hace ${Math.round(min / 60)} h`, hoy };
  return { texto: `hace ${Math.round(min / 1440)} d`, hoy };
}

// ── Piezas de la fila ──────────────────────────────────────────────────────

// Edad del caso: cuenta hacia arriba desde que MELI lo abrió y no se detiene.
function VidaCaso({ c, ahora }) {
  if (!conReloj(c) || !c.fecha_caso) return null;
  const horas = (ahora - new Date(c.fecha_caso).getTime()) / 3600000;
  const pasado = horas >= SLA_H;
  return (
    <span style={{ display: "block", fontSize: 10, fontWeight: pasado ? 700 : 600,
      color: pasado ? C.ladrillo : C.tenue, fontVariantNumeric: "tabular-nums" }}>
      {hhmm(horas)}
    </span>
  );
}

// Plazo de 72 h con su barra. Solo corre donde nos toca mover.
function Reloj({ c, ahora }) {
  if (!conReloj(c)) {
    return (
      <span style={{ display: "block", lineHeight: 1.25 }}>
        <span style={{ fontSize: 11, color: C.gris }}>sin plazo</span>
        <span style={{ display: "block", fontSize: 9, color: C.tenue }}>{fechaCorta(c.fecha_caso)}</span>
      </span>
    );
  }
  if (!c.fecha_caso) return <span style={{ color: C.gris }}>—</span>;
  const transcurrido = (ahora - new Date(c.fecha_caso).getTime()) / 3600000;
  const resta = SLA_H - transcurrido;
  const vencido = resta <= 0;
  const color = vencido ? C.gris : resta < 3 ? C.ladrillo : resta < 8 ? C.naranja : C.navy;
  const ancho = Math.max(0, Math.min(100, (transcurrido / SLA_H) * 100));
  return (
    <span style={{ display: "block" }} title={vencido ? `Venció hace ${(-resta).toFixed(1)} h` : `Quedan ${resta.toFixed(1)} h`}>
      <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", width: 62, color }}>Posventa</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
          {vencido ? "vencido" : hhmm(resta)}
        </span>
        <span style={{ fontSize: 8.5, color: C.tenue }}>/{SLA_H}</span>
      </span>
      <span style={{ display: "block", height: 3, borderRadius: 2, background: "#e6eaf1", marginTop: 2 }}>
        <span style={{ display: "block", height: 3, borderRadius: 2, width: `${ancho}%`, background: vencido ? C.ladrillo : color }} />
      </span>
      <span style={{ display: "block", fontSize: 8.5, color: C.tenue, marginTop: 2 }}>{fechaCorta(c.fecha_caso)}</span>
    </span>
  );
}

// Aviso: una sola esfera. Verde con la fecha cuando el correo salió; hueca si no.
function EsferaCorreo({ correo, solicitud }) {
  const enviado = correo && correo.enviado_en && !correo.error;
  if (!enviado && esSinCeco(correo) && !(solicitud && solicitud.estado === "pendiente")) {
    return (
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.2 }}
        title={`No se envió: no se pudo asignar el CECO. ${correo.error || ""}`}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: C.ladrillo, border: `1.5px solid ${C.ladrillo}` }} />
        <span style={{ fontSize: 8.5, color: C.ladrillo, marginTop: 2, fontWeight: 700 }}>sin CECO</span>
      </span>
    );
  }
  if (!enviado && solicitud && solicitud.estado === "pendiente") {
    return (
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.2 }} title="En cola: el VPS lo envía en menos de un minuto">
        <span style={{ width: 10, height: 10, borderRadius: 5, background: C.naranjaTenue, border: `1.5px solid ${C.naranja}` }} />
        <span style={{ fontSize: 8.5, color: C.naranja, marginTop: 2 }}>en cola</span>
      </span>
    );
  }
  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.2 }}
      title={enviado ? `Correo enviado ${fechaCorta(correo.enviado_en)}${correo.destino ? " a " + correo.destino : ""}`
        : correo && correo.error ? `El correo falló: ${correo.error}` : "Correo pendiente"}>
      <span style={{ width: 10, height: 10, borderRadius: 5,
        background: enviado ? C.verde : "#fff",
        border: `1.5px solid ${enviado ? C.verde : correo && correo.error ? C.ladrillo : "#cbd5e1"}` }} />
      <span style={{ fontSize: 8.5, color: enviado ? C.verde : C.tenue, marginTop: 2, whiteSpace: "nowrap" }}>
        {enviado ? fechaCorta(correo.enviado_en) : ""}
      </span>
    </span>
  );
}

function ColOrden({ campo, orden, onClick, derecha, children }) {
  const activa = orden.campo === campo;
  return (
    <button onClick={() => onClick(campo)}
      style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit",
        letterSpacing: "inherit", textTransform: "inherit", textAlign: derecha ? "right" : "left",
        color: activa ? C.navy : C.tenue, fontWeight: activa ? 700 : 600 }}>
      {children}{activa ? (orden.dir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );
}

function Tarjeta({ grupo, monto, casos, activa, onClick, partes }) {
  return (
    <button onClick={onClick} title={`Ver solo ${grupo.etiqueta.toLowerCase()}`}
      style={{ flex: 1, minWidth: 158, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        background: activa ? grupo.tinte : "#fff",
        border: `1px solid ${activa ? grupo.color : C.borde}`, borderTop: `3px solid ${grupo.color}`,
        borderRadius: 12, padding: "11px 14px", boxShadow: activa ? `inset 0 0 0 1px ${grupo.color}` : "none" }}>
      <div style={{ fontSize: 10.5, color: activa ? grupo.color : C.suave, letterSpacing: .3,
        textTransform: "uppercase", fontWeight: activa ? 700 : 500 }}>{grupo.etiqueta}</div>
      <div style={{ fontSize: 23, fontWeight: 600, color: C.texto, lineHeight: 1.3 }}>{dinero(monto)}</div>
      <div style={{ fontSize: 11, color: C.tenue }}>{casos} {casos === 1 ? "caso" : "casos"} · {grupo.nota}</div>
      {partes && (
        <div style={{ display: "flex", gap: 10, marginTop: 7, paddingTop: 6, borderTop: `1px solid ${C.borde}`, flexWrap: "wrap" }}>
          {partes.map((p) => (
            <span key={p.clave} role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); p.onClick(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); p.onClick(); } }}
              style={{ fontSize: 10.5, cursor: "pointer", color: p.activa ? p.color : C.suave,
                fontWeight: p.activa ? 700 : 500, borderBottom: `2px solid ${p.activa ? p.color : "transparent"}` }}>
              {p.etiqueta} <strong style={{ color: p.color }}>{p.casos}</strong>
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function Cuadro({ titulo, extra, children }) {
  return (
    <div style={{ flex: 1, minWidth: 320, background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderBottom: `1px solid ${C.borde}`, background: C.grisTenue }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.texto }}>{titulo}</span>
        <span style={{ marginLeft: "auto" }}>{extra}</span>
      </div>
      {children}
    </div>
  );
}

// Foto del periodo a la izquierda, lo que se movió en un día a la derecha.
// Cada fila filtra la lista de abajo.
function TablaEstados({ casos, filtro, historial, dia, onDia, onFiltrar, onFiltrarMovidos }) {
  const total = casos.length;
  let totalMonto = 0;
  const por = {};
  for (const c of casos) {
    const k = c.sub_estado || "?";
    if (!por[k]) por[k] = { n: 0, monto: 0 };
    por[k].n += 1; por[k].monto += Number(c.monto || 0); totalMonto += Number(c.monto || 0);
  }

  const movidos = {}, origenes = {};
  let movidosTotal = 0;
  for (const lista of Object.values(historial || {})) {
    for (const m of lista) {
      if (diaCL(m.cambiado_en) !== dia) continue;
      const a = m.sub_estado_hacia, de = m.sub_estado_desde || "__nace";
      movidos[a] = (movidos[a] || 0) + 1;
      origenes[a] = origenes[a] || {};
      origenes[a][de] = (origenes[a][de] || 0) + 1;
      movidosTotal += 1;
    }
  }

  const GRID_A = "1fr 54px 84px 48px";
  const GRID_B = "1fr 64px";
  const cab = { fontSize: 9.5, letterSpacing: .3, textTransform: "uppercase", color: C.tenue, fontWeight: 600 };

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
      <Cuadro titulo="Estado de los casos">
        <div style={{ display: "grid", gridTemplateColumns: GRID_A, gap: 8, padding: "5px 14px", ...cab }}>
          <span>Estado</span><span style={{ textAlign: "right" }}>Casos</span>
          <span style={{ textAlign: "right" }}>Monto</span><span style={{ textAlign: "right" }}>%</span>
        </div>
        {ESTADOS_PNR.map((e) => {
          // Esperando comprobante y Con Penalidad van en una sola fila: esperan
          // lo mismo y comparten reloj. Cada mitad filtra por su cuenta.
          if (e.clave === "TO_BILL") return null;
          const fusiona = e.clave === "WAITING_RECEIPT";
          const pen = por.TO_BILL || { n: 0, monto: 0 };
          const d = por[e.clave] || { n: 0, monto: 0 };
          const n = d.n + (fusiona ? pen.n : 0);
          const monto = d.monto + (fusiona ? pen.monto : 0);
          const activa = filtro.tipo === "estado" && (filtro.valor === e.clave || (fusiona && filtro.valor === "TO_BILL"));
          const vacia = n === 0;
          return (
            <div key={e.clave} onClick={() => !vacia && onFiltrar(e.clave)} title={e.motivo}
              style={{ display: "grid", gridTemplateColumns: GRID_A, gap: 8, padding: "6px 14px",
                borderTop: `1px solid ${C.borde}`, cursor: vacia ? "default" : "pointer",
                background: activa ? C.naranjaTenue : "#fff", opacity: vacia ? .45 : 1 }}>
              <span style={{ fontSize: 12, fontWeight: activa ? 600 : 500, color: COLOR_ESTADO[e.clave],
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.etiqueta}
                {fusiona && pen.n > 0 && <span style={{ fontWeight: 600 }}> {d.n}</span>}
                {fusiona && pen.n > 0 && (
                  <>
                    <span style={{ color: C.tenue, fontWeight: 400 }}> · </span>
                    <span role="button" tabIndex={0}
                      onClick={(ev) => { ev.stopPropagation(); onFiltrar("TO_BILL"); }}
                      title={POR_ESTADO.TO_BILL.motivo}
                      style={{ color: COLOR_ESTADO.TO_BILL, fontWeight: 600, cursor: "pointer",
                        borderBottom: filtro.valor === "TO_BILL" ? `2px solid ${COLOR_ESTADO.TO_BILL}` : "none" }}>
                      {POR_ESTADO.TO_BILL.etiqueta} {pen.n}
                    </span>
                  </>
                )}
              </span>
              <span style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: C.texto, fontVariantNumeric: "tabular-nums" }}>{n}</span>
              <span style={{ textAlign: "right", fontSize: 12, color: C.texto, fontVariantNumeric: "tabular-nums" }}>{dinero(monto)}</span>
              <span style={{ textAlign: "right", fontSize: 11, color: C.tenue, fontVariantNumeric: "tabular-nums" }}>{pct(n, total)}</span>
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: GRID_A, gap: 8, padding: "7px 14px",
          borderTop: `2px solid ${C.navy}`, background: C.navyTenue }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.navy }}>Total</span>
          <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: C.navy }}>{total}</span>
          <span style={{ textAlign: "right", fontSize: 12, fontWeight: 700, color: C.navy }}>{dinero(totalMonto)}</span>
          <span style={{ textAlign: "right", fontSize: 11, color: C.navy }}>100%</span>
        </div>
      </Cuadro>

      <Cuadro titulo="Movimientos del día"
        extra={<input type="date" value={dia} max={hoyCL()} onChange={(e) => onDia(e.target.value)}
          style={{ fontSize: 11.5, padding: "2px 6px", borderRadius: 6, border: `1px solid ${C.borde}`, fontFamily: "inherit" }} />}>
        <div style={{ display: "grid", gridTemplateColumns: GRID_B, gap: 8, padding: "5px 14px", ...cab }}>
          <span>Pasaron a</span><span style={{ textAlign: "right" }}>Casos</span>
        </div>
        {ESTADOS_PNR.map((e) => {
          const n = movidos[e.clave] || 0;
          const activa = filtro.tipo === "movidos_estado" && filtro.valor === e.clave;
          const desde = Object.entries(origenes[e.clave] || {}).sort((a, b) => b[1] - a[1]);
          return (
            <Fragment key={e.clave}>
              <div onClick={() => n && onFiltrarMovidos(e.clave)}
                style={{ display: "grid", gridTemplateColumns: GRID_B, gap: 8, padding: "6px 14px",
                  borderTop: `1px solid ${C.borde}`, cursor: n ? "pointer" : "default",
                  background: activa ? C.naranjaTenue : "#fff", opacity: n ? 1 : .45 }}>
                <span style={{ fontSize: 12, fontWeight: activa ? 600 : 500, color: COLOR_ESTADO[e.clave] }}>{e.etiqueta}</span>
                <span style={{ textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums",
                  fontWeight: n ? 700 : 400, color: n ? C.naranja : C.tenue }}>{n || "—"}</span>
              </div>
              {activa && desde.map(([sub, cuantos]) => (
                <div key={sub} style={{ display: "grid", gridTemplateColumns: GRID_B, gap: 8,
                  padding: "3px 14px 3px 26px", background: C.naranjaTenue }}>
                  <span style={{ fontSize: 11, color: C.suave }}>
                    {sub === "__nace" ? "caso nuevo" : `desde ${nombreEstado(sub)}`}
                  </span>
                  <span style={{ textAlign: "right", fontSize: 11, color: C.suave }}>{cuantos}</span>
                </div>
              ))}
            </Fragment>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: GRID_B, gap: 8, padding: "7px 14px",
          borderTop: `2px solid ${C.navy}`, background: C.navyTenue }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.navy }}>Total</span>
          <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: C.navy }}>{movidosTotal || "—"}</span>
        </div>
      </Cuadro>
    </div>
  );
}

// ── Desplegable ────────────────────────────────────────────────────────────

function Dato({ etiqueta, valor }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 9.5, color: C.tenue, textTransform: "uppercase", letterSpacing: .3, fontWeight: 600 }}>{etiqueta}</div>
      <div style={{ fontSize: 12.5, color: C.texto, marginTop: 1, wordBreak: "break-word" }}>{valor || "—"}</div>
    </div>
  );
}

// Nombres legibles para las llaves del feed de MELI. Lo que no está acá se
// muestra con su llave tal cual, para que no se pierda ningún dato.
const NOMBRES_RAW = {
  "case.id": "Caso", "case.type": "Tipo", "case.date_created": "Creado en MELI",
  "case.route_code": "Código de ruta", "case.route_id": "ID de ruta", "case.svc_name": "Estación",
  "case.driver_name": "Conductor", "case.shipment_id": "ID de envío", "case.shipment_amount": "Monto",
  "case.state": "Estado", "case.priority": "Prioridad", "case.facility": "Centro",
  "case.carrier": "Transportista", "case.carrier_name": "Transportista",
};

function valorRaw(v) {
  if (v == null || v === "") return "—";
  if (typeof v !== "object") return String(v);
  if (v.amount != null) return dinero(v.amount) + (v.currency ? ` ${v.currency}` : "");
  if (v.sub_status || v.status) return [v.status, v.sub_status && nombreEstado(v.sub_status)].filter(Boolean).join(" · ");
  return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join(" · ");
}

function datosRaw(raw) {
  if (!raw) return [];
  const out = [];
  const vistos = new Set();
  for (const celda of raw.cells || []) {
    for (const linea of celda.lines || []) {
      for (const x of linea) {
        if (!x || !x.key || vistos.has(x.key)) continue;
        vistos.add(x.key);
        out.push({ llave: x.key, etiqueta: NOMBRES_RAW[x.key] || x.key.replace(/^case\./, "").replace(/_/g, " "), valor: valorRaw(x.value) });
      }
    }
  }
  // Lo que viene fuera de las celdas (case_id, priority, etc.)
  for (const [k, v] of Object.entries(raw)) {
    if (k === "cells" || vistos.has(k) || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 6)) continue;
    if (Array.isArray(v)) continue;
    out.push({ llave: k, etiqueta: k.replace(/_/g, " "), valor: valorRaw(v) });
  }
  return out;
}

function LineaTiempo({ movimientos }) {
  const ms = (movimientos || []).slice().sort((a, b) => new Date(b.cambiado_en) - new Date(a.cambiado_en));
  return (
    <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, background: "#fff", padding: "9px 11px", marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.suave, marginBottom: 6 }}>Movimientos en MELI</div>
      {!ms.length && <div style={{ fontSize: 11.5, color: C.tenue }}>Sin movimientos registrados.</div>}
      {ms.map((m) => (
        <div key={m.id} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "2.5px 0", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, color: C.tenue, minWidth: 92, fontVariantNumeric: "tabular-nums" }}>{fechaCorta(m.cambiado_en)}</span>
          <span style={{ fontSize: 11.5, color: C.tenue }}>{m.sub_estado_desde ? nombreEstado(m.sub_estado_desde) : "Nace"}</span>
          <span style={{ fontSize: 11, color: C.tenue }}>→</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: COLOR_ESTADO[m.sub_estado_hacia] || C.gris }}>{nombreEstado(m.sub_estado_hacia)}</span>
        </div>
      ))}
    </div>
  );
}

// Envío desde el Brain: CECO automático o elegido, con su supervisor a la vista.
function BloqueEnvio({ c, correo, onEnviar, supervisores }) {
  const sinCeco = esSinCeco(correo);
  const opciones = CECOS_COMPARTIDAS[c.service_center] || Object.keys(supervisores).sort();
  const [ceco, setCeco] = useState("");
  const [recordar, setRecordar] = useState(true);
  const sup = ceco && supervisores[ceco];
  return (
    <div onClick={(e) => e.stopPropagation()}>
      {sinCeco && (
        <div style={{ fontSize: 12, color: C.ladrillo, background: C.ladrilloTenue, borderRadius: 8, padding: "7px 9px", marginBottom: 8 }}>
          <strong>No se pudo asignar el CECO</strong>, así que el correo no salió.
          {correo.error && <div style={{ fontSize: 11, marginTop: 3 }}>{correo.error}</div>}
        </div>
      )}
      <div style={{ fontSize: 10, color: C.tenue, textTransform: "uppercase", letterSpacing: .3, fontWeight: 600, marginBottom: 3 }}>CECO</div>
      <select value={ceco} onChange={(e) => setCeco(e.target.value)}
        style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", borderRadius: 8, border: `1px solid ${sinCeco && !ceco ? C.ladrillo : C.borde}`, fontFamily: "inherit", marginBottom: 6 }}>
        <option value="">{sinCeco ? "Elige el CECO…" : "Automático (lo resuelve el sistema)"}</option>
        {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {ceco && (
        <div style={{ fontSize: 12, color: C.texto, marginBottom: 6 }}>
          Supervisor: <strong>{sup ? sup.supervisor : "sin supervisor cargado"}</strong>
        </div>
      )}
      {ceco && (
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11.5, color: C.suave, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} style={{ marginTop: 2 }} />
          Recordar este CECO para la patente y el conductor de este caso
        </label>
      )}
      <button disabled={sinCeco && !ceco} onClick={() => onEnviar(c, ceco || null, recordar)}
        style={{ width: "100%", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8,
          cursor: sinCeco && !ceco ? "default" : "pointer", opacity: sinCeco && !ceco ? .5 : 1,
          border: `1px solid ${C.naranja}`, background: C.naranja, color: "#fff", fontFamily: "inherit" }}>
        {sinCeco || ceco ? "Asignar y enviar" : "Enviar correo a postventa"}
      </button>
    </div>
  );
}

function Detalle({ c, raw, movimientos, correo, ahora, solicitud, onEnviar, supervisores }) {
  const e = POR_ESTADO[c.sub_estado];
  const datos = datosRaw(raw);
  const transcurrido = c.fecha_caso ? (ahora - new Date(c.fecha_caso).getTime()) / 3600000 : null;
  const enviado = correo && correo.enviado_en && !correo.error;

  return (
    <div style={{ padding: "12px 16px 14px 44px", background: C.grisTenue, borderTop: `1px solid ${C.borde}` }}>
      {c.sub_estado === "WITHOUT_RECEIPT" && (
        <div style={{ fontSize: 12.5, color: "#fff", background: C.ladrillo, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
          <strong>Se respondió a Mercado Libre sin comprobante.</strong> El caso queda sin respaldo y va camino al cobro.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(240px,1fr)", gap: 12 }}>
        <div>
          <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, background: "#fff", padding: "9px 11px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.suave }}>Caso y reclamo</span>
              <span style={{ fontSize: 10.5, color: C.tenue }}>{c.case_id} · envío {c.shipment_id || "—"}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
              <Dato etiqueta="Monto" valor={dinero(c.monto)} />
              <Dato etiqueta="Nace" valor={fechaCorta(c.fecha_caso)} />
              <Dato etiqueta="Edad" valor={transcurrido != null ? `${hhmm(transcurrido)} h` : "—"} />
              <Dato etiqueta="Estación" valor={c.service_center} />
              <Dato etiqueta="CECO" valor={c.ceco} />
              <Dato etiqueta="Supervisor" valor={c.supervisor} />
              <Dato etiqueta="CECO resuelto por" valor={c.ceco_como} />
              <Dato etiqueta="Ruta" valor={`${c.route_code || "—"} · ${c.route_id || "—"}`} />
              <Dato etiqueta="Conductor" valor={c.conductor} />
              <Dato etiqueta="Estado MELI" valor={e ? e.etiqueta : c.sub_estado} />
              <Dato etiqueta="Motivo" valor={e ? e.motivo : ""} />
              <Dato etiqueta="Periodo" valor={c.periodo} />
              <Dato etiqueta="Detectado por la torre" valor={fechaCorta(c.creado_en)} />
              <Dato etiqueta="Última lectura" valor={fechaCorta(c.actualizado_en)} />
            </div>
          </div>

          <div style={{ border: `1px solid ${C.borde}`, borderRadius: 10, background: "#fff", padding: "9px 11px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.suave, marginBottom: 6 }}>Todos los datos de MELI</div>
            {raw === undefined ? (
              <div style={{ fontSize: 11.5, color: C.tenue }}>Cargando…</div>
            ) : !datos.length ? (
              <div style={{ fontSize: 11.5, color: C.tenue }}>MELI no trajo datos adicionales para este caso.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: "8px 16px" }}>
                {datos.map((d) => <Dato key={d.llave} etiqueta={d.etiqueta} valor={d.valor} />)}
              </div>
            )}
          </div>

          <LineaTiempo movimientos={movimientos} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ border: `1px solid ${enviado ? C.verde : C.borde}`, borderRadius: 10,
            background: enviado ? C.verdeTenue : "#fff", padding: "9px 11px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: enviado ? C.verde : C.suave, marginBottom: 6 }}>Correo a postventa</div>
            {enviado ? (
              <div style={{ fontSize: 12, color: C.texto, lineHeight: 1.6 }}>
                Enviado el {fechaCorta(correo.enviado_en)}{correo.destino ? <> a <strong>{correo.destino}</strong></> : null}.
                {correo.ceco && <div><span style={{ color: C.suave }}>CECO</span> <strong>{correo.ceco}</strong>{correo.supervisor ? <> · {correo.supervisor}</> : null}</div>}
                {correo.origen && <div style={{ color: C.suave }}>{nombreOrigen(correo.origen)}</div>}
                {correo.asunto && <div style={{ fontSize: 11, color: C.tenue, marginTop: 2 }}>{correo.asunto}</div>}
              </div>
            ) : solicitud && solicitud.estado === "pendiente" ? (
              <div style={{ fontSize: 12, color: C.naranja }}>
                En cola desde las {fechaCorta(solicitud.solicitado_en).split(" ").pop()}. El VPS lo envía en menos de un minuto.
              </div>
            ) : (
              <>
                {correo && correo.error && !esSinCeco(correo) && <div style={{ fontSize: 12, color: C.ladrillo, marginBottom: 6 }}>Falló: {correo.error}</div>}
                {solicitud && solicitud.estado !== "enviado" && (
                  <div style={{ fontSize: 11.5, color: solicitud.estado === "error" ? C.ladrillo : C.suave, marginBottom: 6 }}>
                    Último intento desde el Brain ({fechaCorta(solicitud.procesado_en || solicitud.solicitado_en)}): {solicitud.resultado || solicitud.estado}
                  </div>
                )}
                {!correo ? <div style={{ fontSize: 12, color: C.tenue, marginBottom: 8 }}>Todavía no se envía.</div> : null}
                <BloqueEnvio c={c} correo={correo} onEnviar={onEnviar} supervisores={supervisores || {}} />
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

const GRID = "14px 92px 168px minmax(118px,1fr) 136px 150px 126px 90px 78px";

function Fila({ c, abierta, onAbrir, ahora, movimientos, correo, raw, fueraDePeriodo, solicitud, onEnviar, supervisores }) {
  const ultimoMov = (movimientos || []).reduce((mx, m) => (!mx || new Date(m.cambiado_en) > new Date(mx) ? m.cambiado_en : mx), null);
  const color = COLOR_ESTADO[c.sub_estado] || C.gris;
  const h = hace(ultimoMov, ahora);
  return (
    <Fragment>
      <div onClick={onAbrir} style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", gap: 10,
        padding: "8px 16px", borderTop: `1px solid ${C.borde}`, cursor: "pointer", background: abierta ? C.grisTenue : "#fff" }}>
        <span style={{ color: C.tenue, fontSize: 10 }}>{abierta ? "▾" : "▸"}</span>
        <span style={{ fontSize: 11.5, color: C.suave, fontVariantNumeric: "tabular-nums" }}>
          <VidaCaso c={c} ahora={ahora} />
          {c.case_id}
          {fueraDePeriodo && <span style={{ display: "block", fontSize: 8.5, color: C.naranja }}>{c.periodo}</span>}
        </span>
        <Reloj c={c} ahora={ahora} />
        <span style={{ minWidth: 0, fontSize: 13, color: C.texto, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.conductor || "Sin conductor"}
        </span>
        <span style={{ fontSize: 12, color: C.suave, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {c.route_code || "—"} · {c.service_center || "—"}
        </span>
        <span style={{ minWidth: 0, lineHeight: 1.25 }} title={c.ceco_como ? `CECO por ${c.ceco_como}` : ""}>
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            color: c.ceco === "POR CLASIFICAR" ? C.ladrillo : c.ceco ? C.texto : C.tenue }}>
            {c.ceco || "calculando…"}
          </span>
          <span style={{ display: "block", fontSize: 10, color: C.suave, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {c.supervisor || (c.ceco === "POR CLASIFICAR" ? "sin supervisor" : "")}
          </span>
        </span>
        <span style={{ textAlign: "center", lineHeight: 1.2, overflow: "hidden" }}>
          <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color, border: `1px solid ${color}`,
            borderRadius: 20, padding: "1px 7px", whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
            {POR_ESTADO[c.sub_estado] ? POR_ESTADO[c.sub_estado].corto : c.sub_estado}
          </span>
          {ultimoMov && (
            <span style={{ display: "block", fontSize: 8.5, color: h.hoy ? C.naranja : C.tenue }}>{h.texto}</span>
          )}
        </span>
        <EsferaCorreo correo={correo} solicitud={solicitud} />
        <span style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.texto }}>{dinero(c.monto)}</span>
      </div>
      {abierta && <Detalle c={c} raw={raw} movimientos={movimientos} correo={correo} ahora={ahora} solicitud={solicitud} onEnviar={onEnviar} supervisores={supervisores} />}
    </Fragment>
  );
}

// ── Informe de correos enviados ────────────────────────────────────────────

const haceDias = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
};
const horaCL = (iso) => (iso ? new Intl.DateTimeFormat("es-CL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "");
const fechaLarga = (iso) => (iso ? new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)) : "");

function InformeEnviados({ casos, correos }) {
  const [desde, setDesde] = useState(() => haceDias(6));
  const [hasta, setHasta] = useState(() => hoyCL());
  const [sc, setSc] = useState("todos");
  const [ceco, setCeco] = useState("todos");
  const [origen, setOrigen] = useState("todos");

  const porId = useMemo(() => Object.fromEntries(casos.map((c) => [c.case_id, c])), [casos]);
  const base = useMemo(() => Object.values(correos)
    .filter((a) => a.enviado_en && !a.error)
    .map((a) => ({ ...a, c: porId[a.case_id] || {} }))
    .filter((r) => { const d = diaCL(r.enviado_en); return d >= desde && d <= hasta; }), [correos, porId, desde, hasta]);

  const tipoOrigen = (o) => (!o ? "otro" : o.startsWith("brain") ? "brain" : o);
  const filas = base
    .filter((r) => sc === "todos" || r.c.service_center === sc)
    .filter((r) => ceco === "todos" || (r.ceco || "Sin dato") === ceco)
    .filter((r) => origen === "todos" || tipoOrigen(r.origen) === origen)
    .sort((a, b) => new Date(b.enviado_en) - new Date(a.enviado_en));

  const scs = [...new Set(base.map((r) => r.c.service_center).filter(Boolean))].sort();
  const cecos = [...new Set(base.map((r) => r.ceco || "Sin dato"))].sort();
  const monto = filas.reduce((s, r) => s + Number(r.c.monto || 0), 0);
  const cuenta = (f) => filas.filter(f).length;
  const porSc = {};
  for (const r of filas) { const k = r.c.service_center || "—"; porSc[k] = porSc[k] || { n: 0, monto: 0 }; porSc[k].n++; porSc[k].monto += Number(r.c.monto || 0); }

  const exportar = () => {
    const cols = ["Fecha", "Hora", "Caso", "SC", "CECO", "Supervisor", "Conductor", "Patente", "Monto", "Estado actual", "Periodo", "Origen", "Destino", "Asunto"];
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lineas = filas.map((r) => [fechaLarga(r.enviado_en), horaCL(r.enviado_en), r.case_id, r.c.service_center, r.ceco, r.supervisor,
      r.c.conductor, r.patente, Math.round(Number(r.c.monto || 0)), nombreEstado(r.c.sub_estado), r.c.periodo,
      nombreOrigen(r.origen), r.destino, r.asunto].map(q).join(";"));
    const blob = new Blob(["\ufeff" + [cols.map(q).join(";"), ...lineas].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pnr_correos_${desde}_a_${hasta}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const sel = { fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.borde}`, fontFamily: "inherit", background: "#fff" };
  const caja = (titulo, valor, nota, color) => (
    <div style={{ flex: 1, minWidth: 140, background: "#fff", border: `1px solid ${C.borde}`, borderTop: `3px solid ${color}`, borderRadius: 12, padding: "10px 14px" }}>
      <div style={{ fontSize: 10.5, color: C.suave, textTransform: "uppercase", letterSpacing: .3 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: C.texto, lineHeight: 1.3 }}>{valor}</div>
      <div style={{ fontSize: 11, color: C.tenue }}>{nota}</div>
    </div>
  );
  const GRID_I = "84px 46px 86px 52px 128px 132px minmax(140px,1fr) 64px 82px 128px 116px";

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, color: C.suave, fontWeight: 600 }}>DESDE</span>
        <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} style={sel} />
        <span style={{ fontSize: 11.5, color: C.suave, fontWeight: 600 }}>HASTA</span>
        <input type="date" value={hasta} min={desde} max={hoyCL()} onChange={(e) => setHasta(e.target.value)} style={sel} />
        <select value={sc} onChange={(e) => setSc(e.target.value)} style={sel}>
          <option value="todos">Todas las SC</option>{scs.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={ceco} onChange={(e) => setCeco(e.target.value)} style={sel}>
          <option value="todos">Todos los CECO</option>{cecos.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={origen} onChange={(e) => setOrigen(e.target.value)} style={sel}>
          <option value="todos">Todos los orígenes</option>
          <option value="automatico">Automático</option>
          <option value="brain">Botón Brain</option>
          <option value="analista">Analista (manual)</option>
          <option value="vps_manual">VPS manual</option>
        </select>
        <button onClick={exportar} disabled={!filas.length}
          style={{ marginLeft: "auto", fontSize: 12.5, padding: "6px 12px", borderRadius: 8, cursor: filas.length ? "pointer" : "default",
            border: `1px solid ${C.navy}`, background: C.navy, color: "#fff", fontWeight: 700, fontFamily: "inherit", opacity: filas.length ? 1 : .5 }}>
          Exportar CSV
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {caja("Correos enviados", filas.length, `${fechaLarga(desde + "T12:00:00")} al ${fechaLarga(hasta + "T12:00:00")}`, C.verde)}
        {caja("Monto reclamado", dinero(monto), "suma de los casos enviados", C.naranja)}
        {caja("Automáticos", cuenta((r) => tipoOrigen(r.origen) === "automatico"), "sin intervención", C.navy)}
        {caja("Desde el Brain", cuenta((r) => tipoOrigen(r.origen) === "brain"), "con el botón", C.navy)}
        {caja("Por clasificar", cuenta((r) => r.ceco === "POR CLASIFICAR"), "CECO asignado a mano en Pipefy", C.ladrillo)}
      </div>

      {Object.keys(porSc).length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {Object.entries(porSc).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => (
            <span key={k} onClick={() => setSc(sc === k ? "todos" : k)}
              style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                border: `1px solid ${sc === k ? C.navy : C.borde}`, background: sc === k ? C.navyTenue : "#fff", color: C.texto }}>
              <strong>{k}</strong> {v.n} · {dinero(v.monto)}
            </span>
          ))}
        </div>
      )}

      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1180 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID_I, gap: 10, padding: "7px 16px", background: C.grisTenue,
              fontSize: 9.5, letterSpacing: .3, textTransform: "uppercase", color: C.tenue, fontWeight: 600 }}>
              <span>Fecha</span><span>Hora</span><span>Caso</span><span>SC</span><span>CECO</span><span>Supervisor</span>
              <span>Conductor</span><span>Patente</span><span style={{ textAlign: "right" }}>Monto</span><span>Estado actual</span><span>Origen</span>
            </div>
            {!filas.length ? (
              <div style={{ padding: 28, textAlign: "center", color: C.suave, fontSize: 13, borderTop: `1px solid ${C.borde}` }}>
                No hay correos enviados con estos filtros.
              </div>
            ) : filas.map((r) => (
              <div key={r.case_id} title={r.asunto || ""}
                style={{ display: "grid", gridTemplateColumns: GRID_I, gap: 10, padding: "7px 16px", borderTop: `1px solid ${C.borde}`,
                  fontSize: 12, alignItems: "center", color: C.texto }}>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{fechaLarga(r.enviado_en)}</span>
                <span style={{ color: C.suave, fontVariantNumeric: "tabular-nums" }}>{horaCL(r.enviado_en)}</span>
                <span style={{ color: C.navy, fontWeight: 600 }}>{r.case_id}</span>
                <span>{r.c.service_center || "—"}</span>
                <span style={{ color: r.ceco === "POR CLASIFICAR" ? C.ladrillo : C.texto, fontWeight: r.ceco === "POR CLASIFICAR" ? 700 : 400 }}>{r.ceco || "—"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.supervisor || "—"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.c.conductor || "—"}</span>
                <span style={{ color: C.suave }}>{r.patente || "—"}</span>
                <span style={{ textAlign: "right", fontWeight: 600 }}>{dinero(r.c.monto)}</span>
                <span style={{ color: COLOR_ESTADO[r.c.sub_estado] || C.gris, fontWeight: 600, fontSize: 11.5 }}>{nombreEstado(r.c.sub_estado)}</span>
                <span style={{ color: C.suave, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nombreOrigen(r.origen)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pantalla ───────────────────────────────────────────────────────────────

export default function ModuloPnrCL({ usuario }) {
  const [vista, setVista] = useState("bandeja");
  const puedeEvaluar = PUEDEN_EVALUAR.includes(String((usuario && usuario.email) || "").toLowerCase().trim());
  const [slaPnr, setSlaPnr] = useState(96);
  SLA_H = slaPnr;
  const [solicitudes, setSolicitudes] = useState({});
  const [supervisores, setSupervisores] = useState({});
  const [casos, setCasos] = useState([]);
  const [historial, setHistorial] = useState({});
  const [correos, setCorreos] = useState({});
  const [raws, setRaws] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [supFiltro, setSupFiltro] = useState("todos");
  const [filtro, setFiltro] = useState({ tipo: "grupo", valor: "responder" });
  const [orden, setOrden] = useState({ campo: "sla", dir: "asc" });
  const [abiertas, setAbiertas] = useState(new Set());
  const [diaMov, setDiaMov] = useState(() => hoyCL());
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      const [filas, hist, avs, sols, sups] = await Promise.all([
        api("pnr_casos_cl?select=case_id,tipo,fecha_caso,route_code,route_id,service_center,conductor,shipment_id,monto,moneda,estado,sub_estado,periodo,actualizado_en,creado_en,ceco,supervisor,ceco_como&order=fecha_caso.desc&limit=5000"),
        api("pnr_historial_cl?select=id,case_id,sub_estado_desde,sub_estado_hacia,cambiado_en&order=cambiado_en.asc&limit=20000"),
        api("pnr_avisos_cl?canal=eq.correo&select=case_id,destino,enviado_en,error,asunto,ceco,supervisor,patente,origen&limit=10000"),
        api("pnr_solicitudes_cl?select=id,case_id,estado,resultado,solicitado_en,solicitado_por,procesado_en&order=solicitado_en.desc&limit=500"),
        api("pnr_supervisor_cl?select=ceco,supervisor,lider"),
      ]);
      api("postventa_sla_cl?origen=eq.pnr_meli&select=sla_horas").then((x) => { if (x && x[0]) setSlaPnr(Number(x[0].sla_horas) || 96); }).catch(() => {});
      setSupervisores(Object.fromEntries((sups || []).map((s) => [s.ceco, s])));
      const so = {};
      for (const s of sols || []) if (!so[s.case_id]) so[s.case_id] = s;   // la más reciente de cada caso
      setSolicitudes(so);
      const h = {};
      for (const m of hist || []) (h[m.case_id] = h[m.case_id] || []).push(m);
      const co = {};
      for (const a of avs || []) co[a.case_id] = a;
      setCasos(filas || []); setHistorial(h); setCorreos(co); setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 30000); return () => clearInterval(t); }, []);

  // Mientras haya algo en cola se relee cada 10 s, para ver la esfera ponerse verde.
  const hayEnCola = Object.values(solicitudes).some((s) => s.estado === "pendiente");
  useEffect(() => {
    if (!hayEnCola) return undefined;
    const t = setInterval(cargar, 10000);
    return () => clearInterval(t);
  }, [hayEnCola, cargar]);

  const enviarCorreo = async (c, ceco, recordar) => {
    const quien = (usuario && (usuario.nombre || usuario.email)) || "Brain";
    const sup = ceco && supervisores[ceco];
    const ok = window.confirm(`¿Enviar el correo del caso ${c.case_id} a postventa@bigticket.cl?\n\n` +
      `${c.service_center || ""} · ${c.conductor || ""} · ${dinero(c.monto)}\n` +
      (ceco ? `CECO ${ceco}${sup ? " · supervisor " + sup.supervisor : ""}${recordar ? "\nSe recordará para la patente y el conductor." : ""}\n` : "CECO automático\n") +
      "\nSe crea la tarjeta en Pipefy, igual que con el envío automático.");
    if (!ok) return;
    try {
      await api("pnr_solicitudes_cl", { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ case_id: c.case_id, solicitado_por: quien, ceco: ceco || null, recordar: !!recordar }) });
      setSolicitudes((p) => ({ ...p, [c.case_id]: { case_id: c.case_id, estado: "pendiente", solicitado_en: new Date().toISOString(), solicitado_por: quien } }));
      cargar();
    } catch (e) {
      setError("No se pudo pedir el envío: " + e.message);
    }
  };

  const periodos = useMemo(() => [...new Set(casos.map((c) => c.periodo).filter(Boolean))].sort().reverse(), [casos]);
  useEffect(() => { if (!periodo && periodos.length) setPeriodo(periodos[0]); }, [periodos, periodo]);

  const delPeriodo = useMemo(() => casos.filter((c) => !periodo || c.periodo === periodo), [casos, periodo]);

  // Los abiertos de periodos anteriores siguen en la lista: todavía se pueden pelear.
  const paraLista = useMemo(() => casos.filter((c) => !periodo || c.periodo === periodo || conReloj(c)), [casos, periodo]);

  const totales = useMemo(() => {
    const t = Object.fromEntries(GRUPOS.map((g) => [g.clave, { n: 0, monto: 0 }]));
    for (const c of delPeriodo) { const k = clasificar(c); t[k].n++; t[k].monto += Number(c.monto || 0); }
    return t;
  }, [delPeriodo]);

  const buscando = busqueda.trim().length > 0;

  const subEstadosDelGrupo = filtro.tipo === "grupo"
    ? ESTADOS_PNR.filter((e) => e.grupo === filtro.valor || (filtro.valor === "responder" && e.grupo === "penalidad"))
    : [];

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = buscando
      ? casos.filter((c) => [c.case_id, c.shipment_id, c.route_code, c.route_id, c.conductor, c.service_center]
          .some((v) => String(v || "").toLowerCase().includes(q)))
      : paraLista.filter((c) => {
          if (filtro.tipo === "todos") return c.periodo === periodo || !periodo;
          if (filtro.tipo === "movidos_estado") return (historial[c.case_id] || []).some((m) => m.sub_estado_hacia === filtro.valor && diaCL(m.cambiado_en) === diaMov);
          if (filtro.tipo === "movidos") return (historial[c.case_id] || []).some((m) => diaCL(m.cambiado_en) === diaMov);
          if (filtro.tipo === "estado") return c.sub_estado === filtro.valor;
          if (filtro.tipo === "sin_ceco") return esSinCeco(correos[c.case_id]) && !(solicitudes[c.case_id] && solicitudes[c.case_id].estado === "pendiente");
          if (filtro.valor === "responder") { const g = clasificar(c); return g === "responder" || g === "penalidad"; }
          return clasificar(c) === filtro.valor;
        });
    const valor = (c) => {
      if (orden.campo === "monto") return -Number(c.monto || 0);
      if (orden.campo === "caso") return Number(c.case_id || 0);
      if (!conReloj(c) || !c.fecha_caso) return 1e12 - new Date(c.fecha_caso || 0).getTime() / 1000;
      return new Date(c.fecha_caso).getTime() / 1000;   // más viejo = menos plazo = arriba
    };
    return base
      .filter((c) => supFiltro === "todos" || (supFiltro === "__sin" ? !c.supervisor : c.supervisor === supFiltro))
      .slice().sort((a, b) => { const d = valor(a) - valor(b); return orden.dir === "asc" ? d : -d; });
  }, [casos, paraLista, filtro, busqueda, buscando, orden, historial, diaMov, periodo, correos, solicitudes, supFiltro]);
  const listaSupervisores = useMemo(() => [...new Set(casos.map((c) => c.supervisor).filter(Boolean))].sort(), [casos]);

  const nSinCeco = casos.filter((c) => esSinCeco(correos[c.case_id]) && !(solicitudes[c.case_id] && solicitudes[c.case_id].estado === "pendiente")).length;

  const ordenar = (campo) => setOrden((o) => (o.campo === campo ? { campo, dir: o.dir === "asc" ? "desc" : "asc" } : { campo, dir: "asc" }));
  const fijar = (f) => { setBusqueda(""); setFiltro(f); setAbiertas(new Set()); };

  const abrirFila = async (c) => {
    const id = c.case_id;
    setAbiertas((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    if (raws[id] !== undefined) return;
    try {
      const r = await api(`pnr_casos_cl?case_id=eq.${id}&select=raw`);
      setRaws((p) => ({ ...p, [id]: (r && r[0] && r[0].raw) || null }));
    } catch (e) {
      setRaws((p) => ({ ...p, [id]: null }));
    }
  };

  const titulo = buscando ? "Resultados"
    : filtro.tipo === "estado" ? nombreEstado(filtro.valor)
    : filtro.tipo === "movidos_estado" ? `Pasaron a ${nombreEstado(filtro.valor)}`
    : filtro.tipo === "movidos" ? "Movidos del día"
    : filtro.tipo === "todos" ? "Todos"
    : filtro.tipo === "sin_ceco" ? "Sin CECO: asignar y enviar"
    : filtro.valor === "responder" ? "Por responder y con penalidad"
    : (POR_CLAVE[filtro.valor] || {}).etiqueta || "Casos";

  const pastilla = (activa, color, tinte) => ({
    fontSize: 11.5, padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${activa ? color : C.borde}`, background: activa ? tinte : "#fff",
    color: activa ? color : C.suave, fontWeight: activa ? 600 : 400,
  });

  return (
    <div style={{ padding: "14px 24px 24px", background: C.grisTenue, minHeight: "100%",
      fontFamily: "'Geist', system-ui, -apple-system, sans-serif" }}>

      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.navy, letterSpacing: -.3 }}>Posventa</span>
        {[["bandeja", "Bandeja"], ["casos", "PNR MELI"], ["canon", "Canon"], ["enviados", "Correos enviados"],
          ...(puedeEvaluar ? [["evaluacion", "Biggy vs ejecutiva"]] : [])].map(([k, et]) => (
          <button key={k} onClick={() => setVista(k)}
            style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${C.navy}`, background: vista === k ? C.navy : "#fff", color: vista === k ? "#fff" : C.navy }}>
            {et}
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {vista === "casos" && <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar caso, envío, ruta o conductor"
            style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.borde}`, minWidth: 240, fontFamily: "inherit" }} />}
          {vista === "casos" && <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.borde}`, fontFamily: "inherit" }}>
            {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>}
          <button onClick={cargar} style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
            border: `1px solid ${C.navy}`, background: "#fff", color: C.navy, fontWeight: 700, fontFamily: "inherit" }}>
            Actualizar
          </button>
        </span>
      </div>

      {error && (
        <div style={{ background: C.ladrilloTenue, border: `1px solid ${C.ladrillo}55`, color: C.ladrillo,
          borderRadius: 10, padding: "10px 14px", fontSize: 12.5, marginBottom: 12 }}>{error}</div>
      )}

      {nSinCeco > 0 && vista === "casos" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.ladrilloTenue, border: `1px solid ${C.ladrillo}66`,
          borderRadius: 10, padding: "10px 14px", marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: C.ladrillo }} />
          <span style={{ fontSize: 13, color: C.ladrillo }}>
            <strong>{nSinCeco} {nSinCeco === 1 ? "caso sin CECO" : "casos sin CECO"}</strong>: el sistema no pudo asignarlos y el correo no salió. Elige el CECO y envíalo.
          </span>
          <button onClick={() => { setVista("casos"); fijar({ tipo: "sin_ceco", valor: null }); }}
            style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${C.ladrillo}`, background: C.ladrillo, color: "#fff", fontFamily: "inherit" }}>
            Ver y asignar
          </button>
        </div>
      )}

      {vista === "enviados" && <InformeEnviados casos={casos} correos={correos} />}

      {vista === "canon" && <ModuloCanonCL />}

      {vista === "evaluacion" && puedeEvaluar && <EvaluacionBiggy usuario={usuario} />}

      {vista === "bandeja" && <BandejaPostventa usuario={usuario} onIrA={(v) => { setVista(v); if (v === "casos") fijar({ tipo: "sin_ceco", valor: null }); }} />}

      {vista === "casos" && <>
      {/* Tarjetas: son el filtro */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        {GRUPOS.map((g) => {
          if (g.clave === "penalidad") return null;
          const fusiona = g.clave === "responder";
          const pen = totales.penalidad;
          const activaGrupo = (v) => !buscando && filtro.tipo === "grupo" && filtro.valor === v;
          return (
            <Tarjeta key={g.clave} grupo={g}
              monto={totales[g.clave].monto + (fusiona ? pen.monto : 0)}
              casos={totales[g.clave].n + (fusiona ? pen.n : 0)}
              activa={activaGrupo(g.clave) || (fusiona && activaGrupo("penalidad"))}
              onClick={() => fijar({ tipo: "grupo", valor: g.clave })}
              partes={!fusiona ? null : [
                { clave: "responder", etiqueta: g.etiqueta, color: g.color, casos: totales.responder.n,
                  activa: activaGrupo("responder"), onClick: () => fijar({ tipo: "grupo", valor: "responder" }) },
                { clave: "penalidad", etiqueta: POR_CLAVE.penalidad.etiqueta, color: POR_CLAVE.penalidad.color, casos: pen.n,
                  activa: activaGrupo("penalidad"), onClick: () => fijar({ tipo: "grupo", valor: "penalidad" }) },
              ]} />
          );
        })}
      </div>

      <TablaEstados casos={delPeriodo} filtro={filtro} historial={historial} dia={diaMov} onDia={setDiaMov}
        onFiltrar={(clave) => fijar({ tipo: "estado", valor: clave })}
        onFiltrarMovidos={(clave) => fijar({ tipo: "movidos_estado", valor: clave })} />

      {/* Lista */}
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.texto }}>{titulo}</span>

          {!buscando && filtro.tipo === "grupo" && subEstadosDelGrupo.length > 1 && (
            <div style={{ display: "flex", gap: 4 }}>
              {subEstadosDelGrupo.map((e) => (
                <button key={e.clave} onClick={() => fijar({ tipo: "estado", valor: e.clave })}
                  style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
                    border: `1px solid ${COLOR_ESTADO[e.clave]}`, background: "#fff", color: COLOR_ESTADO[e.clave] }}>
                  {e.corto}
                </button>
              ))}
            </div>
          )}

          {!buscando && filtro.tipo === "estado" && (
            <button onClick={() => { const g = (POR_ESTADO[filtro.valor] || {}).grupo; fijar(g ? { tipo: "grupo", valor: g } : { tipo: "todos", valor: null }); }}
              style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${C.borde}`, background: "#fff", color: C.suave }}>
              ← todo el grupo
            </button>
          )}

          <button onClick={() => fijar({ tipo: "movidos", valor: null })}
            style={pastilla(!buscando && filtro.tipo === "movidos", C.naranja, C.naranjaTenue)}>Movidos del día</button>
          <button onClick={() => fijar({ tipo: "todos", valor: null })}
            style={pastilla(!buscando && filtro.tipo === "todos", C.navy, C.navyTenue)}>Todos</button>

          <select value={supFiltro} onChange={(e) => setSupFiltro(e.target.value)}
            style={{ marginLeft: "auto", fontSize: 11.5, padding: "4px 8px", borderRadius: 20, fontFamily: "inherit",
              border: `1px solid ${supFiltro !== "todos" ? C.navy : C.borde}`, color: supFiltro !== "todos" ? C.navy : C.suave, background: "#fff" }}>
            <option value="todos">Todos los supervisores</option>
            {listaSupervisores.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="__sin">Sin supervisor</option>
          </select>
          <span style={{ fontSize: 11.5, color: C.tenue }}>
            {lista.length} en pantalla{buscando ? " · todos los periodos" : ""}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1140 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "6px 16px",
              borderTop: `1px solid ${C.borde}`, background: C.grisTenue, fontSize: 9.5, letterSpacing: .3,
              textTransform: "uppercase", color: C.tenue, fontWeight: 600 }}>
              <span />
              <ColOrden campo="caso" orden={orden} onClick={ordenar}>Caso</ColOrden>
              <ColOrden campo="sla" orden={orden} onClick={ordenar}>SLA</ColOrden>
              <span>Conductor</span>
              <span>Ruta · estación</span>
              <span>CECO · supervisor</span>
              <span style={{ textAlign: "center" }}>Estado</span>
              <span style={{ textAlign: "center" }}>Aviso</span>
              <ColOrden campo="monto" orden={orden} onClick={ordenar} derecha>Monto</ColOrden>
            </div>

            {cargando ? (
              <div style={{ padding: 28, textAlign: "center", color: C.suave, fontSize: 13, borderTop: `1px solid ${C.borde}` }}>Cargando casos…</div>
            ) : !lista.length ? (
              <div style={{ padding: 28, textAlign: "center", color: C.suave, fontSize: 13, borderTop: `1px solid ${C.borde}` }}>
                {buscando ? `Ningún caso coincide con "${busqueda.trim()}".` : "Nada acá. Prueba con otra tarjeta o con otro periodo."}
              </div>
            ) : lista.map((c) => (
              <Fila key={c.case_id} c={c} abierta={abiertas.has(c.case_id)} onAbrir={() => abrirFila(c)} ahora={ahora}
                movimientos={historial[c.case_id]} correo={correos[c.case_id]} raw={raws[c.case_id]}
                fueraDePeriodo={!!periodo && c.periodo !== periodo}
                solicitud={solicitudes[c.case_id]} onEnviar={enviarCorreo} supervisores={supervisores} />
            ))}
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
