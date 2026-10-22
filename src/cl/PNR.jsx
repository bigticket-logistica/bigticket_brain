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
// La lista parte en Esperando comprobante, que es donde se trabaja.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";

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

const SLA_H = 48;
const REFRESCO_MS = 60 * 1000;

async function api(path) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}` },
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 250)}`);
  return r.json();
}

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

// Plazo de 48 h con su barra. Solo corre donde nos toca mover.
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
function EsferaCorreo({ correo }) {
  const enviado = correo && correo.enviado_en && !correo.error;
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

function Detalle({ c, raw, movimientos, correo, ahora }) {
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
              <div style={{ fontSize: 12, color: C.texto, lineHeight: 1.5 }}>
                Enviado el {fechaCorta(correo.enviado_en)}{correo.destino ? <> a <strong>{correo.destino}</strong></> : null}.
              </div>
            ) : correo && correo.error ? (
              <div style={{ fontSize: 12, color: C.ladrillo }}>Falló: {correo.error}</div>
            ) : (
              <div style={{ fontSize: 12, color: C.tenue }}>Todavía no se envía.</div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

const GRID = "14px 92px 168px minmax(118px,1fr) 150px 126px 90px 78px";

function Fila({ c, abierta, onAbrir, ahora, movimientos, correo, raw, fueraDePeriodo }) {
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
        <span style={{ textAlign: "center", lineHeight: 1.2, overflow: "hidden" }}>
          <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color, border: `1px solid ${color}`,
            borderRadius: 20, padding: "1px 7px", whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
            {POR_ESTADO[c.sub_estado] ? POR_ESTADO[c.sub_estado].corto : c.sub_estado}
          </span>
          {ultimoMov && (
            <span style={{ display: "block", fontSize: 8.5, color: h.hoy ? C.naranja : C.tenue }}>{h.texto}</span>
          )}
        </span>
        <EsferaCorreo correo={correo} />
        <span style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.texto }}>{dinero(c.monto)}</span>
      </div>
      {abierta && <Detalle c={c} raw={raw} movimientos={movimientos} correo={correo} ahora={ahora} />}
    </Fragment>
  );
}

// ── Pantalla ───────────────────────────────────────────────────────────────

export default function ModuloPnrCL() {
  const [casos, setCasos] = useState([]);
  const [historial, setHistorial] = useState({});
  const [correos, setCorreos] = useState({});
  const [raws, setRaws] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState({ tipo: "estado", valor: "WAITING_RECEIPT" });
  const [orden, setOrden] = useState({ campo: "sla", dir: "asc" });
  const [abiertas, setAbiertas] = useState(new Set());
  const [diaMov, setDiaMov] = useState(() => hoyCL());
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      const [filas, hist, avs] = await Promise.all([
        api("pnr_casos_cl?select=case_id,tipo,fecha_caso,route_code,route_id,service_center,conductor,shipment_id,monto,moneda,estado,sub_estado,periodo,actualizado_en,creado_en&order=fecha_caso.desc&limit=5000"),
        api("pnr_historial_cl?select=id,case_id,sub_estado_desde,sub_estado_hacia,cambiado_en&order=cambiado_en.asc&limit=20000"),
        api("pnr_avisos_cl?canal=eq.correo&select=case_id,destino,enviado_en,error&limit=10000"),
      ]);
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
          if (filtro.valor === "responder") { const g = clasificar(c); return g === "responder" || g === "penalidad"; }
          return clasificar(c) === filtro.valor;
        });
    const valor = (c) => {
      if (orden.campo === "monto") return -Number(c.monto || 0);
      if (orden.campo === "caso") return Number(c.case_id || 0);
      if (!conReloj(c) || !c.fecha_caso) return 1e12 - new Date(c.fecha_caso || 0).getTime() / 1000;
      return new Date(c.fecha_caso).getTime() / 1000;   // más viejo = menos plazo = arriba
    };
    return base.slice().sort((a, b) => { const d = valor(a) - valor(b); return orden.dir === "asc" ? d : -d; });
  }, [casos, paraLista, filtro, busqueda, buscando, orden, historial, diaMov, periodo]);

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
        <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: C.navy, borderRadius: 8, padding: "5px 12px" }}>PNR</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar caso, envío, ruta o conductor"
            style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.borde}`, minWidth: 240, fontFamily: "inherit" }} />
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.borde}`, fontFamily: "inherit" }}>
            {periodos.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
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

          <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.tenue }}>
            {lista.length} en pantalla{buscando ? " · todos los periodos" : ""}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1000 }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, padding: "6px 16px",
              borderTop: `1px solid ${C.borde}`, background: C.grisTenue, fontSize: 9.5, letterSpacing: .3,
              textTransform: "uppercase", color: C.tenue, fontWeight: 600 }}>
              <span />
              <ColOrden campo="caso" orden={orden} onClick={ordenar}>Caso</ColOrden>
              <ColOrden campo="sla" orden={orden} onClick={ordenar}>SLA</ColOrden>
              <span>Conductor</span>
              <span>Ruta · estación</span>
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
                fueraDePeriodo={!!periodo && c.periodo !== periodo} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
