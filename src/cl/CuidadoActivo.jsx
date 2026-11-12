// ═══════════════════════════════════════════════════════════════════════════
// cl/CuidadoActivo.jsx — Cuidado de Activo · Brain Chile
//
// Subpestañas que se suman a "Mantenciones · Cuidado de Activo":
//   · Tareas del supervisor: crear (detención, hallazgo, cámara, auditoría no
//     hecha, cita en taller), ver respuesta y evidencias, veredicto y envío a
//     Conciliaciones. Datos: vw_ca_tareas_brain_cl + fn_ca_tarea_*.
//   · Auditorías: bandeja de Maycol. Cada foto al lado de la anterior, lo que
//     dijo Biggy, checklist y veredicto (vw_ca_auditorias_brain_cl +
//     fn_ca_auditoria_detalle_brain / fn_ca_auditoria_veredicto). Sin correos.
//     "Pedir auditoría" por evento (nuevo, traspaso entrega + recepción, taller,
//     no programada): fn_ca_auditoria_pedir; lista en vw_ca_solicitudes_brain_cl.
//   · Estado de flota: fn_ca_estado_flota_cl (en ruta, alertas de domicilio y
//     GPS, no salida, jefatura) y % de uso contra la meta. Sin avisos.
//   · Mantenciones: programa por km (fn_mnt_programa_cl, odómetro de Geotab),
//     historial migrado de la biblia, pautas por modelo y talleres con historial.
//   · Ficha del activo: listado con estado documental (fn_ficha_lista_cl) y ficha
//     completa por patente (fn_ficha_cl): maestro, documentos, Geotab, conductores,
//     costos, mantención, auditorías, tareas e historial.
//   · Documentos: subir PDF o fotos (bucket ca-documentos-cl), revisar y confirmar;
//     el documento confirmado manda sobre la fecha de la biblia (vw_doc_vigente_cl).
//   · Reparaciones: solicitud → cotización → aprobación (cobro a) → OC → taller → cierre con gasto
//     (ca_rep_solicitudes_cl, fn_rep_avanzar), con reparación anterior y precio de referencia.
//   · Siniestros: registro (vw_siniestros_cl, fn_sin_guardar), deducible al tercero y «Enviar a cobro»,
//     días en taller, pérdida en venta (días × tarifa del CECO) e indicadores.
//   · Vida útil (Mantenciones → verificador y mantenedor por modelo): fn_mnt_vida_util_cl; veredicto por
//     desgaste en la ficha de autorización de Reparaciones y tarjeta en la Ficha del activo.
//   · Historial de gastos: vw_gastos_cl (componente estandarizado), registro con OC del Brain y datos de OT/OC/factura.
//   · Centro de alertas: bandeja única (fn_alertas_cl) y las 21 reglas de Adriana (ca_alertas_reglas_cl),
//     editables solo por Superadmin. Todavía no envía correos ni WhatsApp.
//   · Uso y detenciones (U3): paradas de Geotab cruzadas con las entregas y fallidos de MELI (vw_paradas_cl):
//     sin respaldo, entrega con exceso, entrega, fuera de ruta u operativa. Todavía no crea tareas.
//   · No salidas: fn_ca_no_salidas_dia + avisos enviados (ca_avisos_cl).
//   · Incumplimientos: tareas vencidas sin respuesta, por supervisor y mes.
//   · Configuración: plazos por tipo, justificaciones y correos (ca_*_cl).
// Todo en Supabase Chile, con la clave anon (como PNR).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { cargarSheetJS } from "../shared";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";
const C = { navy: "#002E5D", naranja: "#FF6600", borde: "#e4e7ec", suave: "#475569", tenue: "#94a3b8", texto: "#1f2937", fondo: "#f4f6f9", rojo: "#9e3b1b", rojoT: "#faece6", verde: "#1f7a5c", verdeT: "#e9f3ef", ambar: "#b8651c", ambarT: "#fdf3e8" };

async function api(path, o = {}) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json", ...(o.headers || {}) },
    body: o.body,
    cache: "no-store",   // siempre datos frescos (sin parámetros extra en la URL: Supabase los toma como filtros)
  });
  if (!r.ok) {
    let msg = await r.text();
    try { msg = JSON.parse(msg).message || msg; } catch { /* texto plano */ }
    throw new Error(String(msg).slice(0, 300));
  }
  const t = await r.text();
  return t && t.trim() ? JSON.parse(t) : true;
}
const rpc = (fn, args) => api(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args || {}) });
async function urlFirmada(path, bucket = "ca-pruebas-cl") {
  const r = await fetch(`${CL_URL}/storage/v1/object/sign/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 300 }),
  });
  const j = await r.json().catch(() => ({}));
  return j.signedURL ? `${CL_URL}/storage/v1${j.signedURL}` : null;
}

const fh = (s) => s ? new Date(s).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const hoyCL = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const ESTADO = {
  pendiente: ["Pendiente", C.ambarT, C.ambar], respondida: ["Respondida · por revisar", "#eef2f8", C.navy],
  aceptada: ["Justificada", C.verdeT, C.verde], rechazada: ["No justificada", C.rojoT, C.rojo],
  vencida: ["Vencida sin respuesta", C.rojoT, C.rojo], cerrada: ["Cerrada", C.fondo, C.suave],
};
const chip = (txt, bg, fg) => <span style={{ background: bg, color: fg, borderRadius: 20, padding: "2px 9px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{txt}</span>;
const btn = (tono) => ({ border: tono === "sec" ? `1px solid ${C.borde}` : "none", background: tono === "sec" ? "#fff" : tono === "rojo" ? C.rojo : tono === "verde" ? C.verde : C.navy, color: tono === "sec" ? C.navy : "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
const inp = { border: `1px solid ${C.borde}`, borderRadius: 8, padding: "7px 10px", fontSize: 13, fontFamily: "inherit" };

export default function CuidadoActivoCL({ usuario, sub }) {
  const quien = usuario?.email || usuario?.nombre || "brain";
  if (sub === "ca_pedido") return <AvancePedido quien={quien} rol={usuario?.rol} />;
  if (sub === "ca_alertas") return <CentroAlertas quien={quien} rol={usuario?.rol} />;
  if (sub === "ca_evaluacion") return <EvaluacionEjecutivo usuario={usuario} />;
  if (sub === "ca_indicadores") return <Indicadores quien={quien} rol={usuario?.rol} />;
  if (sub === "ca_ficha") return <FichaActivo quien={quien} />;
  if (sub === "ca_documentos") return <Documentos quien={quien} />;
  if (sub === "ca_flota") return <EstadoFlota />;
  if (sub === "ca_gps") return <GpsCamaras quien={quien} />;
  if (sub === "ca_uso") return <UsoDetenciones quien={quien} />;
  if (sub === "ca_mantenciones") return <Mantenciones quien={quien} />;
  if (sub === "ca_reparaciones") return <Reparaciones quien={quien} />;
  if (sub === "ca_siniestros") return <Siniestros quien={quien} />;
  if (sub === "ca_gastos") return <HistorialGastos quien={quien} />;
  if (sub === "ca_auditorias") return <Auditorias quien={quien} />;
  if (sub === "ca_nosalidas") return <NoSalidas />;
  if (sub === "ca_incumplimientos") return <Incumplimientos />;
  if (sub === "ca_config") return <Configuracion quien={quien} />;
  return <Tareas quien={quien} />;
}

// ── Tareas del supervisor ───────────────────────────────────────────────────
function Tareas({ quien }) {
  const [filas, setFilas] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [error, setError] = useState("");
  const [f, setF] = useState({ estado: "abiertas", tipo: "", ceco: "", desde: "", hasta: "", texto: "" });
  const [abierta, setAbierta] = useState(null);
  const [crear, setCrear] = useState(false);

  const cargar = async () => {
    try {
      const [t, tp] = await Promise.all([
        api("vw_ca_tareas_brain_cl?select=*&order=creada_at.desc&limit=500"),
        api("ca_tipos_cl?select=codigo,nombre,sla_horas,vence_fin_dia,pide_justificacion,pide_evidencia&activo=eq.true&order=orden"),
      ]);
      setFilas(t); setTipos(tp); setError("");
    } catch (e) { setError("No se pudieron cargar las tareas: " + e.message); setFilas([]); }
  };
  useEffect(() => { cargar(); const i = setInterval(cargar, 60000); return () => clearInterval(i); }, []);

  const cecos = useMemo(() => [...new Set((filas || []).map((x) => x.ceco).filter(Boolean))].sort(), [filas]);
  const vis = (filas || []).filter((x) => {
    if (f.estado === "abiertas" && !["pendiente", "respondida", "vencida"].includes(x.estado)) return false;
    if (f.estado === "por_revisar" && x.estado !== "respondida") return false;
    if (f.estado === "vencidas" && x.estado !== "vencida") return false;
    if (f.estado === "cerradas" && !["aceptada", "rechazada", "cerrada"].includes(x.estado)) return false;
    if (f.tipo && x.tipo !== f.tipo) return false;
    if (f.ceco && x.ceco !== f.ceco) return false;
    const d = (x.creada_at || "").slice(0, 10);
    if (f.desde && d < f.desde) return false;
    if (f.hasta && d > f.hasta) return false;
    if (f.texto && !`${x.patente} ${x.titulo} ${x.supervisor_nombre || ""}`.toLowerCase().includes(f.texto.toLowerCase())) return false;
    return true;
  });
  const n = (fn) => (filas || []).filter(fn).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {[["Pendientes del supervisor", n((x) => x.estado === "pendiente"), C.ambar],
          ["Respondidas por revisar", n((x) => x.estado === "respondida"), C.navy],
          ["Vencidas sin respuesta", n((x) => x.estado === "vencida"), C.rojo],
          ["Enviadas a Conciliaciones", n((x) => x.a_conciliaciones), C.suave]].map(([t, v, c]) => (
          <div key={t} style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 170px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
          <option value="abiertas">Abiertas</option><option value="por_revisar">Por revisar</option><option value="vencidas">Vencidas</option><option value="cerradas">Cerradas</option><option value="todas">Todas</option>
        </select>
        <select style={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          <option value="">Todos los tipos</option>{tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}
        </select>
        <select style={inp} value={f.ceco} onChange={(e) => setF({ ...f, ceco: e.target.value })}>
          <option value="">Todos los CECO</option>{cecos.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label style={{ fontSize: 12, color: C.suave }}>Desde <input type="date" style={inp} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
        <label style={{ fontSize: 12, color: C.suave }}>Hasta <input type="date" style={inp} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
        <input style={{ ...inp, flex: 1, minWidth: 160 }} placeholder="Buscar patente, supervisor…" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn()} onClick={() => setCrear(!crear)}>{crear ? "Cerrar" : "+ Nueva tarea"}</button>
        <button style={btn("sec")} onClick={cargar}>↻</button>
      </div>

      {crear && <NuevaTarea tipos={tipos} quien={quien} onListo={() => { setCrear(false); cargar(); }} />}
      {error && <div style={{ background: C.rojoT, color: C.rojo, borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 13 }}>{error}</div>}

      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: C.fondo, color: C.suave, textAlign: "left" }}>
            {["Creada", "Tipo", "Patente", "CECO · Supervisor", "Qué pasó", "Plazo", "Estado"].map((h) => <th key={h} style={{ padding: "9px 10px", fontWeight: 700, fontSize: 12 }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filas === null && <tr><td colSpan={7} style={{ padding: 18, color: C.tenue }}>Cargando…</td></tr>}
            {filas && vis.length === 0 && <tr><td colSpan={7} style={{ padding: 18, color: C.tenue }}>No hay tareas con estos filtros.</td></tr>}
            {vis.map((x) => {
              const e = ESTADO[x.estado] || [x.estado, C.fondo, C.suave];
              const ab = abierta === x.id;
              return [
                <tr key={x.id} onClick={() => setAbierta(ab ? null : x.id)} style={{ borderTop: `1px solid ${C.borde}`, cursor: "pointer", background: ab ? "#fafbfd" : "#fff" }}>
                  <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{fh(x.creada_at)}</td>
                  <td style={{ padding: "9px 10px" }}>{x.tipo_nombre}</td>
                  <td style={{ padding: "9px 10px", fontWeight: 700, color: C.navy }}>{x.patente}</td>
                  <td style={{ padding: "9px 10px" }}>{x.ceco || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.supervisor_nombre || x.supervisor_email || "sin supervisor"}</div></td>
                  <td style={{ padding: "9px 10px", maxWidth: 320 }}>{x.titulo}</td>
                  <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{x.vence_at ? (x.estado === "pendiente" ? `${x.horas_restantes} h` : fh(x.vence_at)) : "Sin plazo"}{x.atrasada ? <div style={{ color: C.rojo, fontSize: 11.5, fontWeight: 700 }}>atrasada</div> : null}</td>
                  <td style={{ padding: "9px 10px" }}>{chip(e[0], e[1], e[2])}{x.incumplimiento ? <div style={{ marginTop: 4 }}>{chip("Incumplimiento", C.rojoT, C.rojo)}</div> : null}{x.a_conciliaciones ? <div style={{ marginTop: 4 }}>{chip("En Conciliaciones", C.fondo, C.suave)}</div> : null}</td>
                </tr>,
                ab && <tr key={x.id + "-d"}><td colSpan={7} style={{ padding: 0, borderTop: `1px solid ${C.borde}` }}><Detalle t={x} quien={quien} onListo={cargar} /></td></tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NuevaTarea({ tipos, quien, onListo }) {
  const [d, setD] = useState({ tipo: "detencion", patente: "", titulo: "", detalle: "", fecha: "", mapa: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const tp = tipos.find((t) => t.codigo === d.tipo);
  const guardar = async () => {
    if (!d.patente.trim() || !d.titulo.trim()) { setMsg("Falta la patente y el título."); return; }
    setBusy(true); setMsg("");
    try {
      await rpc("fn_ca_tarea_crear", {
        p_tipo: d.tipo, p_patente: d.patente, p_titulo: d.titulo.trim(), p_detalle: d.detalle.trim() || null,
        p_datos: d.mapa.trim() ? { mapa: d.mapa.trim() } : {}, p_fecha_evento: d.fecha ? new Date(d.fecha).toISOString() : null, p_por: quien,
      });
      onListo();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 10 }}>Nueva tarea al supervisor</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <label style={{ fontSize: 12, color: C.suave }}>Tipo<select style={{ ...inp, width: "100%" }} value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })}>{tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}</select></label>
        <label style={{ fontSize: 12, color: C.suave }}>Patente<input style={{ ...inp, width: "100%" }} value={d.patente} onChange={(e) => setD({ ...d, patente: e.target.value.toUpperCase() })} placeholder="SVFB74" /></label>
        <label style={{ fontSize: 12, color: C.suave }}>Cuándo ocurrió<input type="datetime-local" style={{ ...inp, width: "100%" }} value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></label>
        <label style={{ fontSize: 12, color: C.suave }}>Link al mapa (opcional)<input style={{ ...inp, width: "100%" }} value={d.mapa} onChange={(e) => setD({ ...d, mapa: e.target.value })} placeholder="https://maps.google.com/…" /></label>
      </div>
      <label style={{ fontSize: 12, color: C.suave, display: "block", marginTop: 10 }}>Título (lo que ve primero el supervisor)<input style={{ ...inp, width: "100%" }} value={d.titulo} onChange={(e) => setD({ ...d, titulo: e.target.value })} placeholder="Detención de 23 min en Av. Grecia 1234" /></label>
      <label style={{ fontSize: 12, color: C.suave, display: "block", marginTop: 10 }}>Detalle<textarea rows={3} style={{ ...inp, width: "100%" }} value={d.detalle} onChange={(e) => setD({ ...d, detalle: e.target.value })} placeholder="Horas, conductor, tercero, qué se vio…" /></label>
      <div style={{ fontSize: 12, color: C.suave, marginTop: 8 }}>
        El CECO y el supervisor salen solos de Vehículos BT. Plazo: {tp ? (tp.vence_fin_dia ? "hasta las 23:59 de hoy" : tp.sla_horas ? `${tp.sla_horas} h` : "sin plazo") : "—"}.
        Al guardar, se avisa por correo al supervisor y al ejecutivo.
      </div>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 10 }}><button style={btn()} disabled={busy} onClick={guardar}>{busy ? "Creando…" : "Crear y avisar"}</button></div>
    </div>
  );
}

function Detalle({ t, quien, onListo }) {
  const [hist, setHist] = useState(null);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { api(`ca_tareas_eventos_cl?select=tipo,detalle,actor,creado_at&tarea_id=eq.${t.id}&order=creado_at`).then(setHist).catch(() => setHist([])); }, [t.id]);
  const ev = Array.isArray(t.datos?.evidencias) ? t.datos.evidencias : [];
  const abrir = async (p) => { const u = await urlFirmada(p); if (u) window.open(u, "_blank"); else alert("No se pudo abrir el archivo."); };
  const accion = async (fn, args) => {
    setBusy(true); setMsg("");
    try { await rpc(fn, args); setNota(""); onListo(); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const sugerido = t.datos?.criterio_sugerido || t.justificacion_criterio;
  return (
    <div style={{ padding: 16, background: "#fafbfd", display: "grid", gridTemplateColumns: "minmax(260px, 1.2fr) minmax(240px, 1fr)", gap: 20 }}>
      <div>
        {t.detalle && <div style={{ fontSize: 13, color: C.texto, whiteSpace: "pre-wrap", marginBottom: 8 }}>{t.detalle}</div>}
        <div style={{ fontSize: 12.5, color: C.suave }}>Ocurrió: {fh(t.fecha_evento)} · Vence: {fh(t.vence_at)} · Creada por {t.creada_por}</div>
        {t.datos?.mapa && <a href={t.datos.mapa} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: C.navy, fontWeight: 700 }}>🗺️ Ver en el mapa</a>}

        <div style={{ marginTop: 12, fontWeight: 800, color: C.navy, fontSize: 13 }}>Respuesta del supervisor</div>
        {t.respondida_at ? (
          <div style={{ fontSize: 13, marginTop: 4 }}>
            <b>{t.justificacion_nombre || "Sin motivo"}</b>{sugerido ? <span style={{ color: C.suave }}> · criterio del catálogo: {sugerido === "justifica" ? "justifica" : sugerido === "no_justifica" ? "no justifica" : "revisar"}</span> : null}
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{t.respuesta}</div>
            <div style={{ color: C.tenue, fontSize: 12, marginTop: 4 }}>{t.respondida_por} · {fh(t.respondida_at)}</div>
            {ev.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{ev.map((a, i) => <button key={i} style={btn("sec")} onClick={() => abrir(a.path)}>📎 {a.nombre || "evidencia"}</button>)}</div>}
          </div>
        ) : <div style={{ fontSize: 13, color: C.tenue, marginTop: 4 }}>Todavía no responde.</div>}

        {t.veredicto && <div style={{ fontSize: 13, marginTop: 10 }}><b>Veredicto:</b> {t.veredicto === "justifica" ? "Justifica" : t.veredicto === "no_justifica" ? "No justifica" : "Revisar"}{t.veredicto_nota ? ` · ${t.veredicto_nota}` : ""} <span style={{ color: C.tenue }}>({t.veredicto_por}, {fh(t.veredicto_at)})</span></div>}

        {["respondida", "vencida", "aceptada", "rechazada"].includes(t.estado) && (
          <div style={{ marginTop: 12 }}>
            <textarea rows={2} style={{ ...inp, width: "100%" }} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota del veredicto (la lee el supervisor)" />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <button style={btn("verde")} disabled={busy} onClick={() => accion("fn_ca_tarea_veredicto", { p_id: t.id, p_veredicto: "justifica", p_nota: nota || null, p_por: quien })}>Justifica</button>
              <button style={btn("rojo")} disabled={busy} onClick={() => accion("fn_ca_tarea_veredicto", { p_id: t.id, p_veredicto: "no_justifica", p_nota: nota || null, p_por: quien })}>No justifica</button>
              <button style={btn("sec")} disabled={busy} onClick={() => accion("fn_ca_tarea_veredicto", { p_id: t.id, p_veredicto: "revisar", p_nota: nota || null, p_por: quien })}>Revisar</button>
              {["rechazada", "vencida"].includes(t.estado) && !t.a_conciliaciones && (
                <button style={btn()} disabled={busy} onClick={() => { if (window.confirm("¿Enviar a Conciliaciones? Queda marcada para el cobro al tercero.")) accion("fn_ca_tarea_conciliaciones", { p_id: t.id, p_por: quien, p_nota: nota || null }); }}>Enviar a Conciliaciones</button>
              )}
            </div>
          </div>
        )}
        {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      </div>
      <div>
        <div style={{ fontWeight: 800, color: C.navy, fontSize: 13, marginBottom: 6 }}>Historial</div>
        {hist === null ? <div style={{ fontSize: 12.5, color: C.tenue }}>Cargando…</div> : (
          <div style={{ borderLeft: `2px solid ${C.borde}`, paddingLeft: 12 }}>
            {hist.map((e, i) => (
              <div key={i} style={{ fontSize: 12.5, marginBottom: 8 }}>
                <div style={{ color: C.tenue }}>{fh(e.creado_at)} · {e.actor}</div>
                <div><b>{e.tipo.replace(/_/g, " ")}</b>{e.detalle ? `: ${e.detalle}` : ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Auditorías de terceros (bandeja de Maycol) ──────────────────────────────
const AU_TIPO = { vehiculo: "Vehículo", limpieza: "Limpieza" };
const AU_ESTADO = {
  enviada: ["Enviada · Biggy pendiente", "#eef2f8", C.navy], revisar: ["Por revisar", C.ambarT, C.ambar],
  aprobada: ["Aprobada", C.verdeT, C.verde], rehacer: ["Devuelta: repetir fotos", C.rojoT, C.rojo], rechazada: ["Rechazada", C.rojoT, C.rojo],
};
const AU_BIGGY = { aprobada: ["Cumple", C.verdeT, C.verde], revisar: ["Con hallazgo", C.ambarT, C.ambar], rehacer: ["No cumple", C.rojoT, C.rojo] };
const AU_VER = { cumple: "Cumple", cumple_hallazgo: "Cumple con hallazgo", no_cumple: "No cumple" };
const AU_FOTO = { ok: ["ok", C.verdeT, C.verde], rehacer: ["repetir", C.rojoT, C.rojo], dano: ["daño", C.ambarT, C.ambar], sucio: ["sucio", C.ambarT, C.ambar] };

function Auditorias({ quien }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");
  const [f, setF] = useState({ estado: "por_revisar", tipo: "", texto: "" });
  const [abierta, setAbierta] = useState(null);
  const [pedir, setPedir] = useState(false);
  const [pedidas, setPedidas] = useState([]);
  const cargar = async () => {
    try {
      const [a, p] = await Promise.all([
        api("vw_ca_auditorias_brain_cl?select=*&order=enviada_at.desc&limit=500"),
        api("vw_ca_solicitudes_brain_cl?select=*&order=creada_at.desc&limit=300"),
      ]);
      setFilas(a); setPedidas(p); setError("");
    }
    catch (e) { setError("No se pudieron cargar las auditorías: " + e.message); setFilas([]); }
  };
  useEffect(() => { cargar(); const i = setInterval(cargar, 60000); return () => clearInterval(i); }, []);
  const vis = (filas || []).filter((x) => {
    if (f.estado === "por_revisar" && !["revisar", "enviada"].includes(x.estado)) return false;
    if (f.estado === "aprobadas" && x.estado !== "aprobada") return false;
    if (f.estado === "devueltas" && x.estado !== "rehacer") return false;
    if (f.estado === "corregidas" && !x.biggy_corregido) return false;
    if (f.tipo && x.tipo !== f.tipo) return false;
    if (f.texto && !`${x.patente} ${x.empresa || ""} ${x.ceco || ""} ${x.hecha_por_nombre || ""}`.toLowerCase().includes(f.texto.toLowerCase())) return false;
    return true;
  });
  const n = (fn) => (filas || []).filter(fn).length;
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {[["Por revisar", n((x) => x.estado === "revisar"), C.ambar],
          ["Biggy pendiente", n((x) => x.estado === "enviada"), C.navy],
          ["Devueltas al tercero", n((x) => x.estado === "rehacer"), C.rojo],
          ["Aprobadas", n((x) => x.estado === "aprobada"), C.verde],
          ["Correcciones a Biggy", n((x) => x.biggy_corregido), C.suave]].map(([t, v, c]) => (
          <div key={t} style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 150px" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
          <option value="por_revisar">Por revisar</option><option value="devueltas">Devueltas al tercero</option><option value="aprobadas">Aprobadas</option><option value="corregidas">Corregidas a Biggy</option><option value="pedidas">Pedidas por evento</option><option value="todas">Todas</option><option value="quien">¿Quién lleva auditoría?</option><option value="devoluciones">Devoluciones de vehículo</option>
        </select>
        <select style={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          <option value="">Vehículo y limpieza</option><option value="vehiculo">Vehículo</option><option value="limpieza">Limpieza</option>
        </select>
        <input style={{ ...inp, minWidth: 220 }} placeholder="Patente, empresa, CECO o quién la hizo" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn("sec")} onClick={cargar}>Actualizar</button>
        <button style={btn()} onClick={() => setPedir(!pedir)}>{pedir ? "Cerrar" : "+ Pedir auditoría"}</button>
      </div>
      {pedir && <PedirAuditoria quien={quien} onListo={() => { setPedir(false); setF({ ...f, estado: "pedidas" }); cargar(); }} />}
      {error && <div style={{ color: C.rojo, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {f.estado === "devoluciones" ? <DevolucionesBrain quien={quien} texto={f.texto} /> : f.estado === "quien" ? <QuienLlevaAuditoria quien={quien} texto={f.texto} /> : f.estado === "pedidas" ? <Pedidas filas={pedidas.filter((x) => !f.texto || `${x.patente} ${x.empresa || ""}`.toLowerCase().includes(f.texto.toLowerCase()))} quien={quien} onCambio={cargar} /> :
       filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              {["Patente", "Empresa · CECO", "Tipo", "Periodo", "Enviada", "Hecha por", "Biggy propone", "Estado"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={8} style={{ ...celda, color: C.tenue, textAlign: "center" }}>No hay auditorías con este filtro.</td></tr>}
              {vis.map((x) => {
                const es = AU_ESTADO[x.estado] || [x.estado, C.fondo, C.suave];
                const bg = AU_BIGGY[x.biggy_propuesta];
                return [
                  <tr key={x.id} style={{ cursor: "pointer", background: abierta === x.id ? "#fafbfd" : "#fff" }} onClick={() => setAbierta(abierta === x.id ? null : x.id)}>
                    <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                    <td style={celda}>{x.empresa || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.ceco || ""}</div></td>
                    <td style={celda}>{x.subtipo_nombre || AU_TIPO[x.tipo] || x.tipo}{x.solicitud_motivo && <div style={{ color: C.tenue, fontSize: 12 }}>{x.solicitud_motivo}</div>}</td>
                    <td style={celda}>{x.periodo}</td>
                    <td style={celda}>{fh(x.enviada_at)}</td>
                    <td style={celda}>{x.hecha_por_nombre || "—"}</td>
                    <td style={celda}>{bg ? chip(bg[0], bg[1], bg[2]) : <span style={{ color: C.tenue }}>—</span>}</td>
                    <td style={celda}>{chip(es[0], es[1], es[2])}{x.veredicto && <div style={{ fontSize: 12, color: C.suave, marginTop: 4 }}>{AU_VER[x.veredicto]}{x.biggy_corregido ? " · corrigió a Biggy" : ""}</div>}</td>
                  </tr>,
                  abierta === x.id && <tr key={x.id + "d"}><td colSpan={8} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><DetalleAuditoria a={x} quien={quien} onListo={() => { setAbierta(null); cargar(); }} /></td></tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PedirAuditoria({ quien, onListo }) {
  const [tipos, setTipos] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [d, setD] = useState({ subtipo: "traspaso", patente: "", motivo: "", rut: "", vence: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api("ca_auditoria_subtipos_cl?select=*&activo=eq.true&order=orden").then(setTipos).catch(() => setTipos([]));
    rpc("fn_ca_empresas_portal_cl").then(setEmpresas).catch(() => setEmpresas([]));
  }, []);
  const opciones = [{ codigo: "traspaso", nombre: "Traspaso a otro conductor (entrega + recepción)" },
    ...tipos.filter((t) => !t.codigo.startsWith("traspaso_"))];
  const plazo = d.subtipo === "traspaso" ? tipos.find((t) => t.codigo === "traspaso_entrega")?.plazo_horas : tipos.find((t) => t.codigo === d.subtipo)?.plazo_horas;
  const guardar = async () => {
    if (!d.patente.trim()) return setMsg("Falta la patente.");
    if (d.subtipo === "traspaso" && !d.rut) return setMsg("Elige la empresa que recibe el vehículo.");
    setBusy(true); setMsg("");
    try {
      const n = await rpc("fn_ca_auditoria_pedir", { p_subtipo: d.subtipo, p_patente: d.patente, p_motivo: d.motivo || null,
        p_rut_recibe: d.subtipo === "traspaso" ? d.rut : null, p_vence: d.vence ? new Date(d.vence).toISOString() : null, p_por: quien });
      alert(n === 2 ? "Listo: se pidieron 2 auditorías (la de quien entrega y la de quien recibe)." : "Listo: auditoría pedida.");
      onListo();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 10 }}>Pedir auditoría por evento</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label style={{ fontSize: 12, color: C.suave }}>Tipo<select style={{ ...inp, width: "100%" }} value={d.subtipo} onChange={(e) => setD({ ...d, subtipo: e.target.value })}>
          {opciones.map((t) => <option key={t.codigo} value={t.codigo}>{t.nombre}</option>)}</select></label>
        <label style={{ fontSize: 12, color: C.suave }}>Patente<input style={{ ...inp, width: "100%" }} value={d.patente} onChange={(e) => setD({ ...d, patente: e.target.value.toUpperCase() })} placeholder="JFTC63" /></label>
        {d.subtipo === "traspaso" && (
          <label style={{ fontSize: 12, color: C.suave }}>Empresa que recibe<select style={{ ...inp, width: "100%" }} value={d.rut} onChange={(e) => setD({ ...d, rut: e.target.value })}>
            <option value="">Elige…</option>{[...empresas].sort((a, b) => String(a.empresa).localeCompare(String(b.empresa))).map((x) => <option key={x.rut} value={x.rut}>{x.empresa} · {x.rut}</option>)}</select></label>
        )}
        <label style={{ fontSize: 12, color: C.suave }}>Vence (opcional)<input type="datetime-local" style={{ ...inp, width: "100%" }} value={d.vence} onChange={(e) => setD({ ...d, vence: e.target.value })} /></label>
      </div>
      <label style={{ fontSize: 12, color: C.suave, display: "block", marginTop: 10 }}>Motivo (lo ve el transportista)<input style={{ ...inp, width: "100%" }} value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} placeholder="Ej.: cambio de conductor desde el lunes / cita en taller Kovacs el jueves 10:00" /></label>
      <div style={{ fontSize: 12, color: C.suave, marginTop: 8 }}>
        {d.subtipo === "traspaso" ? "Se piden dos auditorías: la empresa que entrega certifica cómo lo deja y la que recibe, cómo lo recibe. " : ""}
        Si no eliges el vencimiento, el plazo es de {plazo || 24} h. Al transportista le aparece en su portal; no se envía correo.
      </div>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 10 }}><button style={btn()} disabled={busy} onClick={guardar}>{busy ? "Pidiendo…" : "Pedir auditoría"}</button></div>
    </div>
  );
}

// ¿Quién lleva auditoría? El equipo decide por vehículo (con motivo e historial)
function QuienLlevaAuditoria({ quien, texto }) {
  const [filas, setFilas] = useState(null);
  const [sel, setSel] = useState({});
  const [ver, setVer] = useState("todos");
  const cargar = () => api("vw_ca_aud_flota_cl?select=*&order=empresa,patente&limit=3000").then(setFilas).catch(() => setFilas([]));
  useEffect(() => { cargar(); }, []);
  const vis = (filas || []).filter((x) => (ver === "todos" || (ver === "lleva" ? x.lleva : !x.lleva))
    && (!texto || `${x.patente} ${x.empresa || ""} ${x.ceco || ""}`.toLowerCase().includes(texto.toLowerCase())));
  const marcados = Object.keys(sel).filter((k) => sel[k]);
  const marcar = async (pats, lleva, quitar = false) => {
    if (!pats.length) return;
    let motivo = "";
    if (!quitar) { motivo = window.prompt(`${lleva ? "Marcar que SÍ lleva" : "Marcar que NO lleva"} auditoría: ${pats.length} vehículo(s).\n\n¿Motivo?`, ""); if (!motivo) return; }
    try { await rpc("fn_ca_aud_marcar", { p_patentes: pats, p_lleva: lleva, p_motivo: motivo, p_por: quien, p_quitar: quitar }); setSel({}); cargar(); } catch (e) { alert(e.message); }
  };
  const n = (fn) => (filas || []).filter(fn).length;
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5 };
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>Vehículos activos del portal. Los que no llevan auditoría no generan la tarea «Auditoría no realizada» ni cuentan en el cumplimiento mensual. Por defecto todos llevan, salvo los de Bigticket (empresa en Configuración); cualquier vehículo se puede cambiar aquí, con motivo.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        {[["todos", `Todos (${n(() => true)})`], ["lleva", `Llevan (${n((x) => x.lleva)})`], ["no", `No llevan (${n((x) => !x.lleva)})`]].map(([k, t]) => <button key={k} style={btn(ver === k ? undefined : "sec")} onClick={() => setVer(k)}>{t}</button>)}
        <span style={{ flex: 1 }} />
        <button style={btn("sec")} disabled={!marcados.length} onClick={() => marcar(marcados, true)}>Sí lleva ({marcados.length})</button>
        <button style={btn("sec")} disabled={!marcados.length} onClick={() => marcar(marcados, false)}>No lleva ({marcados.length})</button>
        <button style={btn("sec")} disabled={!marcados.length} onClick={() => marcar(marcados, true, true)}>Volver a la regla</button>
      </div>
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              <th style={celda}><input type="checkbox" checked={vis.length > 0 && vis.every((x) => sel[x.patente])} onChange={(e) => setSel(e.target.checked ? Object.fromEntries(vis.map((x) => [x.patente, true])) : {})} /></th>
              {["Patente", "Transportista", "CECO", "¿Lleva auditoría?", "Motivo"].map((h) => <th key={h} style={{ ...celda, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>
              {vis.map((x) => (
                <tr key={x.patente}>
                  <td style={celda}><input type="checkbox" checked={!!sel[x.patente]} onChange={(e) => setSel({ ...sel, [x.patente]: e.target.checked })} /></td>
                  <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td><td style={celda}>{x.empresa}</td><td style={celda}>{x.ceco}</td>
                  <td style={celda}>
                    <button style={{ ...btn(x.lleva ? "verde" : "sec"), padding: "3px 10px", fontSize: 12 }} onClick={() => marcar([x.patente], !x.lleva)}>{x.lleva ? "Sí" : "No"}</button>
                    <span style={{ fontSize: 11.5, color: C.tenue, marginLeft: 6 }}>{x.fuente === "manual" ? "decidido a mano" : x.fuente === "regla" ? "por la regla (Bigticket)" : ""}</span>
                  </td>
                  <td style={{ ...celda, color: C.suave }}>{x.motivo ? `${x.motivo} · ${x.por || ""} · ${fh(x.at)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Devoluciones de vehículo avisadas por el transportista desde su portal
const DEV_EST = { solicitada: ["Por gestionar", C.ambarT, C.ambar], en_traspaso: ["Traspaso en curso", "#eef2f8", C.navy], completada: ["Completada", C.verdeT, C.verde], rechazada: ["Rechazada", C.fondo, C.suave] };
function DevolucionesBrain({ quien, texto }) {
  const [filas, setFilas] = useState(null);
  const [empresas, setEmpresas] = useState([]);
  const [abierta, setAbierta] = useState(null);
  const [g, setG] = useState({ rut: "", nota: "", fecha: "" });
  const cargar = () => api("ca_devoluciones_cl?select=*&order=solicitado_at.desc&limit=500").then(setFilas).catch(() => setFilas([]));
  useEffect(() => { cargar(); rpc("fn_ca_empresas_portal_cl").then((r) => setEmpresas(r || [])).catch(() => {}); }, []);
  const gestionar = async (x, accion) => {
    try { const r = await rpc("fn_dev_gestionar", { p_id: x.id, p_accion: accion, p_rut_recibe: g.rut || null, p_nota: g.nota || null, p_por: quien, p_fecha_recepcion: g.fecha || x.fecha_entrega || null }); alert(r); setAbierta(null); setG({ rut: "", nota: "", fecha: "" }); cargar(); }
    catch (e) { alert(e.message); }
  };
  const vis = (filas || []).filter((x) => !texto || `${x.patente} ${x.empresa || ""} ${x.folio || ""}`.toLowerCase().includes(texto.toLowerCase()));
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>El transportista avisa desde su portal que deja un vehículo. Al supervisor del CECO le llega una tarea en su bitácora para coordinar la entrega. Aquí se inicia el traspaso (auditoría de entrega para quien lo deja y de recepción para quien lo recibe), se rechaza o se cierra.</div>
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Folio", "Patente", "Transportista · CECO", "Motivo", "Entrega", "Avisó", "Estado"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={7} style={{ ...celda, color: C.tenue, textAlign: "center" }}>No hay devoluciones.</td></tr>}
              {vis.map((x) => { const e = DEV_EST[x.estado] || [x.estado, C.fondo, C.suave]; return [
                <tr key={x.id} style={{ cursor: "pointer", background: abierta === x.id ? "#fafbfd" : "#fff" }} onClick={() => { setAbierta(abierta === x.id ? null : x.id); setG({ rut: "", nota: "", fecha: x.fecha_entrega || "" }); }}>
                  <td style={{ ...celda, fontWeight: 700, color: C.navy }}>{x.folio}</td><td style={{ ...celda, fontWeight: 800 }}>{x.patente}</td>
                  <td style={celda}>{x.empresa}<div style={{ color: C.tenue, fontSize: 12 }}>{x.ceco}</div></td>
                  <td style={celda}>{x.motivo}{x.detalle && <div style={{ color: C.tenue, fontSize: 12 }}>{x.detalle}</div>}</td>
                  <td style={celda}>{x.fecha_entrega ? fd(x.fecha_entrega) : "—"}</td>
                  <td style={celda}>{fh(x.solicitado_at)}<div style={{ color: C.tenue, fontSize: 12 }}>{x.solicitado_nombre || x.solicitado_por}</div></td>
                  <td style={celda}>{chip(e[0], e[1], e[2])}{x.destino_empresa && <div style={{ color: C.tenue, fontSize: 12 }}>pasa a {x.destino_empresa}</div>}</td>
                </tr>,
                abierta === x.id && <tr key={x.id + "g"}><td colSpan={7} style={{ padding: 12, background: "#fafbfd", borderBottom: `1px solid ${C.borde}` }}>
                  {x.estado === "solicitada" ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <label style={{ fontSize: 12, color: C.suave }}>Empresa que recibe el vehículo
                        <select style={{ ...inp, display: "block", minWidth: 280 }} value={g.rut} onChange={(ev) => setG({ ...g, rut: ev.target.value })}>
                          <option value="">Elige…</option>{empresas.filter((m) => m.rut !== x.rut_empresa).map((m) => <option key={m.rut} value={m.rut}>{m.empresa}</option>)}
                        </select></label>
                      <label style={{ fontSize: 12, color: C.suave }}>Recepción física (fecha del traspaso)<input type="date" style={{ ...inp, display: "block" }} value={g.fecha} onChange={(ev) => setG({ ...g, fecha: ev.target.value })} /></label>
                      <label style={{ fontSize: 12, color: C.suave }}>Nota<input style={{ ...inp, display: "block", minWidth: 220 }} value={g.nota} onChange={(ev) => setG({ ...g, nota: ev.target.value })} /></label>
                      <button style={btn()} onClick={() => gestionar(x, "traspaso")}>Iniciar traspaso</button>
                      <button style={btn("sec")} onClick={() => gestionar(x, "rechazar")}>Rechazar (con nota)</button>
                    </div>
                  ) : x.estado === "en_traspaso" ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13 }}>Auditoría de entrega pedida a {x.empresa} y de recepción a {x.destino_empresa} (recepción el {fd(x.fecha_recepcion)}). Al aprobar la auditoría de recepción, el vehículo pasa solo a {x.destino_empresa} y esta devolución se cierra.</span>
                      <button style={btn("verde")} onClick={() => gestionar(x, "completar")}>Marcar completada</button>
                    </div>
                  ) : <span style={{ fontSize: 13, color: C.suave }}>{x.estado === "rechazada" ? `Rechazada: ${x.nota || ""}` : "Completada"} · {x.gestion_por} · {fh(x.gestion_at)}</span>}
                </td></tr>,
              ]; })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Pedidas({ filas, quien, onCambio }) {
  const [busy, setBusy] = useState(false);
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  const cancelar = async (id) => {
    if (!window.confirm("¿Cancelar esta auditoría pedida?")) return;
    setBusy(true);
    try { await rpc("fn_ca_auditoria_cancelar", { p_id: id, p_por: quien }); onCambio(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const estado = (x) => x.estado === "cancelada" ? ["Cancelada", C.fondo, C.suave]
    : x.enviada_at ? [x.atrasada ? "Hecha fuera de plazo" : "Hecha", C.verdeT, C.verde]
    : x.auditoria_id ? [x.atrasada ? "En curso · atrasada" : "En curso", C.ambarT, C.ambar]
    : x.atrasada ? ["Atrasada", C.rojoT, C.rojo] : ["Pendiente", C.ambarT, C.ambar];
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
        <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
          {["Patente", "Tipo", "Empresa que la hace", "Motivo", "Vence", "Pedida por", "Estado", ""].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={8} style={{ ...celda, color: C.tenue, textAlign: "center" }}>No hay auditorías pedidas.</td></tr>}
          {filas.map((x) => { const e = estado(x); return (
            <tr key={x.id}>
              <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
              <td style={celda}>{x.subtipo_nombre}</td>
              <td style={celda}>{x.empresa || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.rut_empresa}</div></td>
              <td style={celda}>{x.motivo || "—"}</td>
              <td style={celda}>{fh(x.vence_at)}</td>
              <td style={celda}>{x.creada_por}<div style={{ color: C.tenue, fontSize: 12 }}>{fh(x.creada_at)}</div></td>
              <td style={celda}>{chip(e[0], e[1], e[2])}</td>
              <td style={celda}>{x.estado === "pendiente" && !x.enviada_at && <button style={btn("sec")} disabled={busy} onClick={() => cancelar(x.id)}>Cancelar</button>}</td>
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}

function DetalleAuditoria({ a, quien, onListo }) {
  const [d, setD] = useState(null);
  const [urls, setUrls] = useState({});
  const [rehacer, setRehacer] = useState({});
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { (async () => {
    try {
      const r = await rpc("fn_ca_auditoria_detalle_brain", { p_id: a.id });
      setD(r);
      const marc = {}; for (const x of r.fotos || []) if (x.biggy_estado === "rehacer") marc[x.item] = true;
      setRehacer(marc);
      const paths = [...new Set((r.fotos || []).flatMap((x) => [x.path, x.anterior_path]).filter(Boolean))];
      const pares = await Promise.all(paths.map(async (p) => [p, await urlFirmada(p, "ca-auditorias-cl")]));
      setUrls(Object.fromEntries(pares));
    } catch (e) { setMsg(e.message); setD({ fotos: [], checklist: [] }); }
  })(); }, [a.id]);
  const veredicto = async (v) => {
    setBusy(true); setMsg("");
    try {
      await rpc("fn_ca_auditoria_veredicto", { p_id: a.id, p_veredicto: v, p_nota: nota || null, p_rehacer: Object.keys(rehacer).filter((k) => rehacer[k]), p_por: quien });
      onListo();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  if (!d) return <div style={{ padding: 16, color: C.tenue, fontSize: 13 }}>Cargando fotos…</div>;
  const marcadas = Object.values(rehacer).filter(Boolean).length;
  const img = (p, alt) => p && urls[p]
    ? <a href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt={alt} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.borde}` }} /></a>
    : <div style={{ height: 150, borderRadius: 8, border: `1px dashed ${C.borde}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.tenue, fontSize: 12, textAlign: "center", padding: 6 }}>{p ? "No se pudo abrir" : "Sin foto"}</div>;
  return (
    <div style={{ padding: 16, background: "#fafbfd" }}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, marginBottom: 12 }}>
        {a.tipo === "vehiculo" && <div><b>Km escrito:</b> {a.km ?? "—"}</div>}
        {a.biggy_km && <div style={{ color: a.biggy_km.alerta ? C.rojo : C.texto, fontWeight: a.biggy_km.alerta ? 700 : 400 }}>
          <b>Km en la foto:</b> {a.biggy_km.foto ?? "no se lee"} · <b>Geotab:</b> {a.biggy_km.geotab ?? "sin dato"}
          {a.biggy_km.geotab_fecha ? <span style={{ color: C.tenue, fontWeight: 400 }}> ({fh(a.biggy_km.geotab_fecha)})</span> : null}
          {a.biggy_km.alerta ? ` · ⚠ ${a.biggy_km.detalle}` : " · ✓ coincide"}
        </div>}
        <div><b>Auditoría anterior:</b> {d.anterior_id ? fh(d.anterior_fecha) : "no hay"}</div>
        {a.energia && <div><b>Energía:</b> {a.energia}</div>}
      </div>
      {a.biggy_resumen && <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}><b style={{ color: C.navy }}>🤖 Biggy:</b> {a.biggy_resumen}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
        {(d.fotos || []).map((x) => {
          const fe = AU_FOTO[x.biggy_estado];
          return (
            <div key={x.item} style={{ background: "#fff", border: `1px solid ${rehacer[x.item] ? C.rojo : C.borde}`, borderRadius: 12, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <b style={{ fontSize: 13, color: C.navy }}>{x.nombre}{!x.activo && <span style={{ color: C.tenue, fontWeight: 400 }}> (ya no se pide)</span>}</b>
                {fe ? chip(fe[0], fe[1], fe[2]) : chip("sin revisar", C.fondo, C.suave)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div><div style={{ fontSize: 11, color: C.suave, marginBottom: 2 }}>Actual · {fh(x.tomada_at)}</div>{img(x.path, x.nombre)}</div>
                <div><div style={{ fontSize: 11, color: C.suave, marginBottom: 2 }}>Anterior</div>{img(x.anterior_path, x.nombre + " anterior")}</div>
              </div>
              {x.biggy_nota && <div style={{ fontSize: 12, color: C.texto, marginTop: 6 }}>{x.biggy_nota}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 12 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", color: C.rojo, fontWeight: 700 }}>
                  <input type="checkbox" checked={!!rehacer[x.item]} onChange={(e) => setRehacer({ ...rehacer, [x.item]: e.target.checked })} /> Repetir
                </label>
                {x.lat && x.lng && <a href={`https://maps.google.com/?q=${x.lat},${x.lng}`} target="_blank" rel="noreferrer" style={{ color: C.navy }}>🗺️ Dónde se tomó</a>}
              </div>
            </div>
          );
        })}
      </div>

      {a.tipo === "vehiculo" && (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 14 }}>
          <div style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 800, color: C.navy, marginBottom: 4 }}>Checklist</div>
            {(d.checklist || []).length === 0 ? <div style={{ color: C.tenue }}>Sin respuestas.</div> :
              d.checklist.map((c, i) => <div key={i} style={{ color: c.cumple ? C.texto : C.rojo, fontWeight: c.cumple ? 400 : 700 }}>{c.cumple ? "✓" : "✗ Hallazgo:"} {c.pregunta}</div>)}
          </div>
          <div style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 800, color: C.navy, marginBottom: 4 }}>¿Amerita reparación?</div>
            {a.amerita_reparacion === null || a.amerita_reparacion === undefined ? <span style={{ color: C.tenue }}>Sin respuesta</span>
              : a.amerita_reparacion ? <span style={{ color: C.rojo, fontWeight: 700 }}>Sí · {a.reparacion_obs}</span> : "No"}
            {a.amerita_reparacion && <div style={{ marginTop: 6 }}><button style={btn("sec")} onClick={async () => {
              const comp = window.prompt(`Crear la solicitud de reparación de ${a.patente}.\n\n¿Qué componente? (por ejemplo FRENOS, NEUMATICOS, PUERTAS TRASERAS)`, "");
              if (!comp) return;
              try { const id = await rpc("fn_rep_desde_auditoria", { p_auditoria: a.id, p_componente: comp, p_por: quien }); alert(`Solicitud de reparación creada. Queda en Reparaciones como «Cotizando».`); } catch (e) { alert(e.message); }
            }}>Crear solicitud de reparación</button></div>}
          </div>
        </div>
      )}

      {a.veredicto && <div style={{ fontSize: 13, marginTop: 12 }}><b>Veredicto:</b> {AU_VER[a.veredicto]}{a.revision_nota ? ` · ${a.revision_nota}` : ""} <span style={{ color: C.tenue }}>({a.revisada_por}, {fh(a.revisada_at)})</span></div>}

      <div style={{ marginTop: 14 }}>
        <textarea rows={2} style={{ ...inp, width: "100%" }} value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Motivo para el transportista (si no cumple) o descripción del hallazgo" />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          <button style={btn("verde")} disabled={busy} onClick={() => veredicto("cumple")}>Cumple</button>
          <button style={{ ...btn(), background: C.ambar }} disabled={busy} onClick={() => { if (window.confirm("Se crea una tarea de hallazgo al supervisor (48 h) y se le avisa por correo según el modo de correos (en prueba solo te llega a ti). ¿Seguir?")) veredicto("cumple_hallazgo"); }}>Cumple con hallazgo</button>
          <button style={btn("rojo")} disabled={busy} onClick={() => veredicto("no_cumple")}>No cumple · repetir {marcadas} foto{marcadas === 1 ? "" : "s"}</button>
          <span style={{ fontSize: 12, color: C.tenue }}>Si no cumple, el tercero ve en su portal qué fotos repetir (sin correo). Con hallazgo se crea la tarea al supervisor.</span>
        </div>
        {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  );
}

// ── Estado de flota ─────────────────────────────────────────────────────────
const FL_ESTADO = {
  en_ruta: ["En ruta", C.verdeT, C.verde], salio: ["Salió", C.verdeT, C.verde],
  en_bodega: ["Con viaje · en bodega", "#eef2f8", C.navy], por_salir: ["Con viaje · por salir", "#eef2f8", C.navy],
  alerta_domicilio: ["Alerta · en domicilio", C.rojoT, C.rojo], alerta_gps: ["Alerta · GPS", C.ambarT, C.ambar],
  no_salida: ["No salida", C.rojoT, C.rojo], jefatura: ["Asignada a jefatura", C.fondo, C.suave], otra_operacion: ["Otra operación", C.fondo, C.suave],
};
// Confirmaciones de flota de los supervisores (bitácora → «Confirmar mi flota»)
function ConfirmacionesFlota() {
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState(null);
  useEffect(() => { rpc("fn_ca_flota_confirmaciones_resumen").then(setFilas).catch(() => setFilas([])); }, []);
  if (filas === null) return null;
  const atrasadas = filas.filter((x) => x.atrasada).length;
  const difs = filas.reduce((t, x) => t + (x.diferencias || []).length, 0);
  const MARCA = { taller: "En taller", detenido: "Detenido sin conductor", no_es_mio: "No es de su CECO" };
  return (
    <div style={{ background: "#fff", border: `1px solid ${atrasadas ? C.ambar : C.borde}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
      <a href="#" style={{ color: C.navy, fontWeight: 800, fontSize: 13.5 }} onClick={(e) => { e.preventDefault(); setAbierto(!abierto); }}>
        {abierto ? "▾" : "▸"} Confirmaciones de flota de los supervisores · {atrasadas} CECO atrasados · {difs} diferencias
      </a>
      {abierto && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 }}>
          <thead><tr style={{ textAlign: "left", color: C.suave }}>{["CECO", "Supervisor", "Última confirmación", "Estado", "Diferencias informadas"].map((h) => <th key={h} style={{ padding: "4px 6px" }}>{h}</th>)}</tr></thead>
          <tbody>{filas.map((x) => (
            <tr key={x.ceco} style={{ borderTop: `1px solid ${C.fondo}` }}>
              <td style={{ padding: "5px 6px", fontWeight: 700 }}>{x.ceco}</td><td style={{ padding: "5px 6px" }}>{x.supervisor || "—"}</td>
              <td style={{ padding: "5px 6px" }}>{x.ultima_at ? fh(x.ultima_at) : "nunca"}</td>
              <td style={{ padding: "5px 6px" }}>{x.atrasada ? chip("Atrasada", C.ambarT, C.ambar) : chip("Al día", C.verdeT, C.verde)}</td>
              <td style={{ padding: "5px 6px" }}>{(x.diferencias || []).length ? x.diferencias.map((d) => `${d.patente}: ${MARCA[d.estado] || d.estado}${d.nota ? ` (${d.nota})` : ""}`).join(" · ") : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function EstadoFlota() {
  const [fecha, setFecha] = useState(hoyCL());
  const [filas, setFilas] = useState(null);
  const [meta, setMeta] = useState(90);
  const [f, setF] = useState({ estado: "", ceco: "", texto: "" });
  const [hora, setHora] = useState(null);
  const cargar = async () => {
    try {
      const [r, m] = await Promise.all([rpc("fn_ca_estado_flota_cl", { p_fecha: fecha }), api("ca_config_cl?clave=eq.flota_meta_uso&select=valor")]);
      setFilas(r || []); setHora(new Date());
      const v = parseFloat(m?.[0]?.valor); if (Number.isFinite(v)) setMeta(v);
    } catch (e) { setFilas([]); }
  };
  useEffect(() => { setFilas(null); cargar(); const i = setInterval(cargar, 300000); return () => clearInterval(i); }, [fecha]);   // eslint-disable-line react-hooks/exhaustive-deps
  const op = (filas || []).filter((x) => x.grupo === "meli");
  const conViaje = op.filter((x) => x.estado !== "no_salida").length;
  const uso = op.length ? Math.round((conViaje / op.length) * 1000) / 10 : 0;
  const n = (e) => (filas || []).filter((x) => x.estado === e).length;
  const cecos = [...new Set((filas || []).map((x) => x.ceco))].sort();
  const vis = (filas || []).filter((x) => (!f.estado || (f.estado === "alertas" ? x.estado.startsWith("alerta") : x.estado === f.estado))
    && (!f.ceco || x.ceco === f.ceco)
    && (!f.texto || `${x.patente} ${x.supervisor || ""} ${x.empresa || ""} ${x.conductor || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c, est) => (
    <div onClick={() => est !== undefined && setF({ ...f, estado: f.estado === est ? "" : est })}
      style={{ background: "#fff", border: `1px solid ${f.estado && f.estado === est ? c : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 140px", cursor: est !== undefined ? "pointer" : "default" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div>
    </div>
  );
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  const esHoy = fecha === hoyCL();
  return (
    <div>
      <ConfirmacionesFlota />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 200px" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: uso >= meta ? C.verde : C.naranja || "#FF6600" }}>{filas ? `${uso}%` : "…"}</div>
          <div style={{ fontSize: 12.5, color: C.suave }}>Uso del día · meta {meta}% · {conViaje} de {op.length} vehículos MELI con viaje</div>
        </div>
        {esHoy && kpi("En ruta", n("en_ruta"), C.verde, "en_ruta")}
        {esHoy && kpi("Alertas", n("alerta_domicilio") + n("alerta_gps"), C.rojo, "alertas")}
        {kpi("No salida", n("no_salida"), C.rojo, "no_salida")}
        {kpi("Sin motivo", (filas || []).filter((x) => x.estado === "no_salida" && !x.motivo).length, C.ambar)}
        {kpi("Jefatura / otra op.", n("jefatura") + n("otra_operacion"), C.suave)}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input type="date" style={inp} value={fecha} max={hoyCL()} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <select style={inp} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
          <option value="">Todos los estados</option><option value="alertas">Solo alertas</option>
          {Object.entries(FL_ESTADO).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
        <select style={inp} value={f.ceco} onChange={(e) => setF({ ...f, ceco: e.target.value })}>
          <option value="">Todos los CECO</option>{cecos.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input style={{ ...inp, minWidth: 220 }} placeholder="Patente, supervisor, empresa o conductor" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn("sec")} onClick={cargar}>Actualizar</button>
        <span style={{ fontSize: 12, color: C.tenue }}>{esHoy ? `GPS al ${hora ? hora.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) : "…"} · se actualiza cada 5 min` : "Fecha pasada: solo salió / no salió"}</span>
      </div>
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              {["Patente", "CECO", "Supervisor", "Empresa · conductor", "Estado", "Viaje", "GPS", "Motivo no salida"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={8} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Nada con este filtro.</td></tr>}
              {vis.map((x) => { const e = FL_ESTADO[x.estado] || [x.estado, C.fondo, C.suave]; return (
                <tr key={x.patente}>
                  <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                  <td style={celda}>{x.ceco}</td>
                  <td style={celda}>{x.supervisor || "—"}</td>
                  <td style={celda}>{x.empresa || "—"}{x.conductor && <div style={{ color: C.tenue, fontSize: 12 }}>{x.conductor}</div>}</td>
                  <td style={celda}>{chip(e[0], e[1], e[2])}</td>
                  <td style={celda}>{x.rutas ? <>{x.hora_ruta ? `${x.hora_ruta} · ` : ""}<span style={{ color: C.tenue, fontSize: 12 }}>{x.rutas}</span></> : "—"}</td>
                  <td style={{ ...celda, fontSize: 12, color: C.suave }}>{x.gps_fecha ? fh(x.gps_fecha) : "sin equipo"}{x.en_bodega ? " · en bodega" : x.en_domicilio ? " · en domicilio" : ""}</td>
                  <td style={celda}>{x.estado === "no_salida" ? (x.motivo ? chip(x.motivo, C.fondo, C.suave) : chip("Sin motivo", C.rojoT, C.rojo)) : "—"}{x.comentario ? <div style={{ fontSize: 12, color: C.suave, marginTop: 3 }}>{x.comentario}</div> : null}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Mantenciones: programa por km, pautas y talleres ───────────────────────
const MN_ESTADO = {
  vencida: ["Vencida", C.rojoT, C.rojo], proxima: ["Próxima", C.ambarT, C.ambar], al_dia: ["Al día", C.verdeT, C.verde],
  sin_pauta: ["Sin pauta", C.fondo, C.suave], sin_km: ["Sin km de Geotab", C.fondo, C.suave], inactivo: ["Inactivo", C.fondo, C.tenue],
};
const MN_TIPO = { mantencion: "Mantención", reparacion: "Reparación", siniestro: "Siniestro", otro: "Otro", garantia: "Garantía" };
const kmf = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("es-CL"));
const fd = (s) => (s ? new Date(s + "T12:00:00").toLocaleDateString("es-CL") : "—");
function Mantenciones({ quien }) {
  const [vista, setVista] = useState("programa");
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["programa", "Programa"], ["vida", "Vida útil (verificador)"], ["pautas", "Pautas por modelo"], ["vidamod", "Vida útil por modelo"], ["talleres", "Talleres"]].map(([k, t]) => (
          <button key={k} style={btn(vista === k ? undefined : "sec")} onClick={() => setVista(k)}>{t}</button>
        ))}
      </div>
      {vista === "programa" && <ProgramaMnt quien={quien} />}
      {vista === "pautas" && <PautasMnt quien={quien} />}
      {vista === "vida" && <VerificadorVU />}
      {vista === "vidamod" && <VidaModeloMnt quien={quien} />}
      {vista === "talleres" && <TalleresMnt quien={quien} />}
    </div>
  );
}
function ProgramaMnt({ quien }) {
  const [filas, setFilas] = useState(null);
  const [avisos, setAvisos] = useState({});
  const [f, setF] = useState({ estado: "", texto: "" });
  const [abierta, setAbierta] = useState(null);
  const [busy, setBusy] = useState("");
  const [citas, setCitas] = useState({});
  const [form, setForm] = useState(null);   // { patente, modo: "agendar" | "registrar" }
  const cargar = () => {
    rpc("fn_mnt_programa_cl").then(setFilas).catch(() => setFilas([]));
    api("ca_mnt_citas_cl?select=*&estado=eq.agendada").then((r) => setCitas(Object.fromEntries((r || []).map((c) => [c.patente, c])))).catch(() => setCitas({}));
    api("vw_mnt_avisos_cl?select=*&order=creado_at.desc&limit=1000").then((r) => {
      const m = {}; for (const a of r || []) m[`${a.patente}|${a.pauta}`] = a; setAvisos(m);
    }).catch(() => setAvisos({}));
  };
  useEffect(cargar, []);
  const avisar = async (x, forzar = false) => {
    let pauta = x.proxima_pauta;
    if (forzar) {
      const r = window.prompt(`Forzar el aviso de ${x.patente}${x.estado === "sin_pauta" ? " (su modelo no tiene pauta)" : ` (hoy está ${(MN_ESTADO[x.estado] || [x.estado])[0].toLowerCase()}, faltan ${kmf(x.faltan_km)} km)`}.\n\n¿Qué pauta toca? (km)`, pauta || "");
      if (r === null) return;
      pauta = Number(String(r).replace(/\D/g, ""));
      if (!pauta) return alert("Indica la pauta en km, por ejemplo 90000.");
    }
    if (!window.confirm(`Avisar la mantención de ${x.patente} (pauta ${kmf(pauta)} km)${forzar ? " de forma adelantada" : ""}:\n\n• Se crea una tarea al supervisor con el taller, su dirección y el plazo.\n• Al transportista le aparece el aviso en su portal.\n\nLos correos salen según el modo de correos (en prueba solo te llegan a ti). ¿Seguir?`)) return;
    setBusy(x.patente);
    try { await rpc("fn_mnt_avisar", { p_patente: x.patente, p_por: quien, p_forzar: forzar, p_pauta: forzar ? pauta : null }); cargar(); }
    catch (e) { alert(e.message); } finally { setBusy(""); }
  };
  const n = (e) => (filas || []).filter((x) => x.estado === e).length;
  const vis = (filas || []).filter((x) => (!f.estado ? x.estado !== "inactivo" : x.estado === f.estado)
    && (!f.texto || `${x.patente} ${x.modelo || ""} ${x.empresa || ""} ${x.ceco || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c, e) => (
    <div onClick={() => setF({ ...f, estado: f.estado === e ? "" : e })} style={{ background: "#fff", border: `1px solid ${f.estado === e ? c : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 130px", cursor: "pointer" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div>
    </div>
  );
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {kpi("Vencidas", n("vencida"), C.rojo, "vencida")}
        {kpi("Próximas", n("proxima"), C.ambar, "proxima")}
        {kpi("Al día", n("al_dia"), C.verde, "al_dia")}
        {kpi("Sin pauta", n("sin_pauta"), C.suave, "sin_pauta")}
        {kpi("Sin km de Geotab", n("sin_km"), C.suave, "sin_km")}
        {kpi("Inactivos", n("inactivo"), C.tenue, "inactivo")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input style={{ ...inp, minWidth: 240 }} placeholder="Patente, modelo, empresa o CECO" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <span style={{ fontSize: 12, color: C.tenue }}>Km de Geotab, se actualiza cada 6 h. Próxima = última pauta hecha + intervalo del modelo.</span>
      </div>
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              {["Patente", "Modelo · CECO", "Empresa", "Última mantención", "Km actual", "Próxima pauta", "Faltan", "Fecha estimada", "Taller autorizado", "Estado", "Aviso"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={11} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Nada con este filtro.</td></tr>}
              {vis.map((x) => { const e = MN_ESTADO[x.estado] || [x.estado, C.fondo, C.suave]; const av = avisos[`${x.patente}|${x.proxima_pauta}`]; return [
                <tr key={x.patente} style={{ cursor: "pointer", background: abierta === x.patente ? "#fafbfd" : "#fff" }} onClick={() => setAbierta(abierta === x.patente ? null : x.patente)}>
                  <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                  <td style={celda}>{x.modelo || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.ceco}</div></td>
                  <td style={celda}>{x.empresa || "—"}</td>
                  <td style={celda}>{x.ultima_pauta ? <>Pauta {kmf(x.ultima_pauta)}<div style={{ color: C.tenue, fontSize: 12 }}>{fd(x.ultima_fecha)} · {kmf(x.ultima_km)} km · {x.ultima_taller || ""}</div></> : <span style={{ color: C.tenue }}>Sin registro</span>}</td>
                  <td style={celda}>{kmf(x.km_actual)}{x.km_fecha && <div style={{ color: C.tenue, fontSize: 12 }}>{fd(x.km_fecha)}</div>}</td>
                  <td style={celda}>{x.proxima_pauta ? kmf(x.proxima_pauta) : "—"}{x.intervalo && <div style={{ color: C.tenue, fontSize: 12 }}>cada {kmf(x.intervalo)}</div>}</td>
                  <td style={{ ...celda, fontWeight: 700, color: x.faltan_km <= 0 ? C.rojo : C.texto }}>{x.faltan_km === null || x.faltan_km === undefined ? "—" : x.faltan_km <= 0 ? `+${kmf(-x.faltan_km)} pasado` : `${kmf(x.faltan_km)} km`}</td>
                  <td style={celda}>{x.fecha_estimada ? fd(x.fecha_estimada) : "—"}{x.km_dia && <div style={{ color: C.tenue, fontSize: 12 }}>{kmf(Math.round(x.km_dia))} km/día</div>}</td>
                  <td style={celda}>{x.taller || "—"}</td>
                  <td style={celda}>{chip(e[0], e[1], e[2])}</td>
                  <td style={celda} onClick={(ev) => ev.stopPropagation()}>
                    {citas[x.patente] && <div style={{ fontSize: 12, color: C.navy, fontWeight: 700, marginBottom: 4 }}>📅 Cita {fh(citas[x.patente].cita_at)}<div style={{ fontWeight: 400, color: C.suave }}>{citas[x.patente].taller}</div></div>}
                    {av ? <>
                      {chip("Avisado", "#eef2f8", C.navy)}
                      <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 3 }}>{fh(av.creado_at)}</div>
                      <div style={{ fontSize: 11.5, color: C.suave }}>Tarea: {(ESTADO[av.tarea_estado] || [av.tarea_estado || "—"])[0]}</div>
                      <div style={{ fontSize: 11.5, color: C.suave }}>Transportista: {av.visto_tercero_at ? `lo vio ${fh(av.visto_tercero_at)}` : "aún no lo ve"}</div>
                      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                        <button style={btn("sec")} onClick={() => setForm({ patente: x.patente, modo: "agendar" })}>{citas[x.patente] ? "Cambiar cita" : "Agendar"}</button>
                        <button style={btn("verde")} onClick={() => setForm({ patente: x.patente, modo: "registrar" })}>Registrar hecha</button>
                      </div>
                    </> : x.estado === "inactivo" ? <span style={{ color: C.tenue }}>—</span> : <>
                      {["proxima", "vencida"].includes(x.estado)
                        ? <button style={btn(x.estado === "vencida" ? "rojo" : undefined)} disabled={busy === x.patente} onClick={() => avisar(x)}>{busy === x.patente ? "Avisando…" : "Avisar"}</button>
                        : <button style={btn("sec")} disabled={busy === x.patente} onClick={() => avisar(x, true)}>{busy === x.patente ? "Avisando…" : "Forzar aviso"}</button>}
                      <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 12 }}>
                        <a href="#" style={{ color: C.navy }} onClick={(ev) => { ev.preventDefault(); setForm({ patente: x.patente, modo: "agendar" }); }}>Agendar</a>
                        <a href="#" style={{ color: C.verde }} onClick={(ev) => { ev.preventDefault(); setForm({ patente: x.patente, modo: "registrar" }); }}>Registrar hecha</a>
                      </div>
                    </>}
                  </td>
                </tr>,
                form?.patente === x.patente && <tr key={x.patente + "f"}><td colSpan={11} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><FormMnt x={x} modo={form.modo} quien={quien} onListo={(m) => { setForm(null); if (m) alert(m); cargar(); }} /></td></tr>,
                abierta === x.patente && <tr key={x.patente + "h"}><td colSpan={11} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><HistorialMnt patente={x.patente} quien={quien} /></td></tr>,
              ]; })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function FormMnt({ x, modo, quien, onListo }) {
  const hoy = hoyCL();
  const [d, setD] = useState({ taller: x.taller ? String(x.taller).split("/")[0].trim() : "", cita: "", fecha: hoy, km: x.km_actual || "", pauta: x.proxima_pauta || "", costo: "", dias: "", detalle: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const enviar = async () => {
    setBusy(true); setMsg("");
    try {
      const r = modo === "agendar"
        ? await rpc("fn_mnt_agendar", { p_patente: x.patente, p_taller: d.taller, p_cita: d.cita ? new Date(d.cita).toISOString() : null, p_por: quien })
        : await rpc("fn_mnt_registrar", { p_patente: x.patente, p_fecha: d.fecha, p_km: Number(d.km) || null, p_pauta: Number(d.pauta) || null, p_taller: d.taller,
            p_costo: d.costo === "" ? null : Number(d.costo), p_dias: d.dias === "" ? null : Number(d.dias), p_detalle: d.detalle || null, p_por: quien });
      onListo(r);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const campo = (k, t, props = {}) => <label style={{ fontSize: 12, color: C.suave }}>{t}<input style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...props} /></label>;
  return (
    <div style={{ padding: 14, background: "#fafbfd" }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 8 }}>{modo === "agendar" ? `Agendar la mantención de ${x.patente}` : `Registrar la mantención hecha de ${x.patente}`}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {campo("taller", "Taller")}
        {modo === "agendar" ? campo("cita", "Día y hora", { type: "datetime-local" }) : <>
          {campo("fecha", "Fecha", { type: "date", max: hoy })}
          {campo("km", "Km en la mantención", { type: "number" })}
          {campo("pauta", "Pauta hecha (km)", { type: "number" })}
          {campo("costo", "Costo ($)", { type: "number" })}
          {campo("dias", "Días en taller", { type: "number" })}
        </>}
      </div>
      {modo === "registrar" && <div style={{ marginTop: 10 }}>{campo("detalle", "Detalle (opcional)")}</div>}
      <div style={{ fontSize: 12, color: C.suave, marginTop: 8 }}>
        {modo === "agendar" ? "Al agendar se le pide al transportista la auditoría de entrega a taller, con plazo hasta la hora de la cita." : "Al registrar se recalcula la próxima pauta, se oculta el aviso del transportista y se le pide la auditoría de retiro de taller."}
      </div>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button style={btn(modo === "registrar" ? "verde" : undefined)} disabled={busy} onClick={enviar}>{busy ? "Guardando…" : modo === "agendar" ? "Agendar" : "Registrar"}</button>
        <button style={btn("sec")} onClick={() => onListo(null)}>Cancelar</button>
      </div>
    </div>
  );
}

function HistorialMnt({ patente, quien = "brain" }) {
  const [h, setH] = useState(null);
  const [tipo, setTipo] = useState("");
  const [nuevo, setNuevo] = useState(null);
  const cargarH = () => api(`ca_mnt_historial_cl?select=*&patente=eq.${encodeURIComponent(patente)}&order=fecha.desc&limit=200`).then(setH).catch(() => setH([]));
  useEffect(() => { cargarH(); }, [patente]);   // eslint-disable-line react-hooks/exhaustive-deps
  const guardarNuevo = async () => {
    try {
      await rpc("fn_mnt_historial_agregar", { p_tipo: nuevo.tipo, p_patente: patente, p_fecha: nuevo.fecha, p_km: nuevo.km === "" ? null : Number(nuevo.km), p_detalle: nuevo.detalle || null,
        p_taller: nuevo.taller || null, p_costo: nuevo.costo === "" ? null : Number(nuevo.costo), p_dias: nuevo.dias === "" ? null : Number(nuevo.dias), p_responsable: nuevo.responsable || null, p_por: quien });
      setNuevo(null); cargarH();
    } catch (e) { alert(e.message); }
  };
  const borrar = async (id) => { if (!window.confirm("¿Borrar este registro?")) return; try { await rpc("fn_mnt_historial_borrar", { p_id: id, p_por: quien }); cargarH(); } catch (e) { alert(e.message); } };
  if (!h) return <div style={{ padding: 14, color: C.tenue, fontSize: 13 }}>Cargando historial…</div>;
  const vis = h.filter((x) => !tipo || x.tipo === tipo);
  const total = vis.reduce((s, x) => s + (Number(x.precio_total) || Number(x.costo) || 0), 0);
  return (
    <div style={{ padding: 14, background: "#fafbfd" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <b style={{ color: C.navy }}>Historial de {patente}</b>
        <select style={inp} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todo</option>{Object.entries(MN_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <span style={{ fontSize: 12.5, color: C.suave }}>{vis.length} registros · ${Math.round(total).toLocaleString("es-CL")}</span>
        <button style={btn("sec")} onClick={() => setNuevo(nuevo ? null : { tipo: "otro", fecha: hoyCL(), km: "", detalle: "", taller: "", costo: "", dias: "", responsable: "BIGTICKET" })}>{nuevo ? "Cancelar" : "+ Agregar registro"}</button>
      </div>
      {nuevo && (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 10, padding: 10, marginBottom: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
          <label style={{ fontSize: 12, color: C.suave }}>Tipo<select style={{ ...inp, width: "100%" }} value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}>{Object.entries(MN_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {[["fecha", "Fecha", "date"], ["km", "Km", "number"], ["detalle", "Detalle", "text"], ["taller", "Taller", "text"], ["costo", "Costo ($)", "number"], ["dias", "Días en taller", "number"]].map(([k, t, ty]) => (
            <label key={k} style={{ fontSize: 12, color: C.suave }}>{t}<input type={ty} max={k === "fecha" ? hoyCL() : undefined} style={{ ...inp, width: "100%" }} value={nuevo[k]} onChange={(e) => setNuevo({ ...nuevo, [k]: e.target.value })} /></label>
          ))}
          <label style={{ fontSize: 12, color: C.suave }}>Paga<select style={{ ...inp, width: "100%" }} value={nuevo.responsable} onChange={(e) => setNuevo({ ...nuevo, responsable: e.target.value })}><option value="BIGTICKET">BigTicket</option><option value="TERCERO">Tercero</option><option value="SEGURO">Seguro</option></select></label>
          <button style={btn()} onClick={guardarNuevo}>Guardar</button>
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "#fff" }}>
        <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Fecha", "Tipo", "Km", "Detalle", "Taller", "Costo", "Días"].map((t) => <th key={t} style={{ padding: "6px 8px", color: C.suave }}>{t}</th>)}</tr></thead>
        <tbody>{vis.map((x) => (
          <tr key={x.id} style={{ borderTop: `1px solid ${C.borde}` }}>
            <td style={{ padding: "6px 8px" }}>{fd(x.fecha)}</td><td style={{ padding: "6px 8px" }}>{MN_TIPO[x.tipo] || x.tipo}</td>
            <td style={{ padding: "6px 8px" }}>{kmf(x.km)}</td>
            <td style={{ padding: "6px 8px" }}>{x.tipo === "mantencion" && x.pauta_km ? `Pauta ${kmf(x.pauta_km)}` : x.detalle || x.item || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{x.taller || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{x.costo || x.precio_total ? `$${Math.round(Number(x.precio_total) || Number(x.costo)).toLocaleString("es-CL")}` : "—"}</td>
            <td style={{ padding: "6px 8px" }}>{x.dias_taller ?? "—"}{x.fuente === "brain" && <a href="#" title="Borrar (cargado desde el Brain)" style={{ color: C.rojo, marginLeft: 8 }} onClick={(e) => { e.preventDefault(); borrar(x.id); }}>✕</a>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
function PautasMnt({ quien }) {
  const [p, setP] = useState(null);
  const [modelos, setModelos] = useState([]);
  const [nuevo, setNuevo] = useState({ modelo: "", km: "", taller: "" });
  const [msg, setMsg] = useState("");
  const cargar = () => {
    api("ca_mnt_pautas_cl?select=*&order=modelo").then(setP).catch(() => setP([]));
    api("ca_activos_cl?select=modelo").then((r) => setModelos([...new Set((r || []).map((x) => x.modelo).filter(Boolean))].sort())).catch(() => {});
  };
  useEffect(cargar, []);
  const guardar = async (modelo, km, taller) => {
    setMsg("");
    try { await rpc("fn_mnt_guardar_pauta", { p_modelo: modelo, p_km: Number(km), p_taller: taller || null, p_por: quien }); cargar(); setNuevo({ modelo: "", km: "", taller: "" }); }
    catch (e) { setMsg(e.message); }
  };
  const sinPauta = modelos.filter((m) => !(p || []).some((x) => x.modelo === m));
  return (
    <div>
      {sinPauta.length > 0 && <div style={{ background: C.ambarT, color: C.ambar, borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>Modelos de la flota sin pauta: <b>{sinPauta.join(", ")}</b>. Sin pauta no se calcula su próxima mantención.</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}` }}>
        <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Modelo", "Cada (km)", "Taller autorizado"].map((t) => <th key={t} style={{ padding: "8px 10px", color: C.suave, fontSize: 12 }}>{t}</th>)}</tr></thead>
        <tbody>
          {(p || []).map((x) => (
            <tr key={x.modelo} style={{ borderTop: `1px solid ${C.borde}` }}>
              <td style={{ padding: "8px 10px", fontWeight: 700 }}>{x.modelo}</td>
              <td style={{ padding: "8px 10px" }}><input type="number" style={{ ...inp, width: 120 }} defaultValue={x.km_intervalo} onBlur={(e) => Number(e.target.value) !== x.km_intervalo && guardar(x.modelo, e.target.value, x.taller)} /></td>
              <td style={{ padding: "8px 10px" }}><input style={{ ...inp, width: 280 }} defaultValue={x.taller || ""} onBlur={(e) => e.target.value !== (x.taller || "") && guardar(x.modelo, x.km_intervalo, e.target.value)} /></td>
            </tr>
          ))}
          <tr style={{ borderTop: `1px solid ${C.borde}`, background: "#fafbfd" }}>
            <td style={{ padding: "8px 10px" }}><input list="mn-modelos" style={{ ...inp, width: 240 }} placeholder="Nuevo modelo" value={nuevo.modelo} onChange={(e) => setNuevo({ ...nuevo, modelo: e.target.value })} /><datalist id="mn-modelos">{sinPauta.map((m) => <option key={m} value={m} />)}</datalist></td>
            <td style={{ padding: "8px 10px" }}><input type="number" style={{ ...inp, width: 120 }} placeholder="km" value={nuevo.km} onChange={(e) => setNuevo({ ...nuevo, km: e.target.value })} /></td>
            <td style={{ padding: "8px 10px" }}><input style={{ ...inp, width: 200 }} placeholder="Taller" value={nuevo.taller} onChange={(e) => setNuevo({ ...nuevo, taller: e.target.value })} /> <button style={btn()} onClick={() => guardar(nuevo.modelo, nuevo.km, nuevo.taller)}>Agregar</button></td>
          </tr>
        </tbody>
      </table>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ fontSize: 12, color: C.tenue, marginTop: 8 }}>Cada cambio queda en el historial (ca_mnt_cambios_cl) con quién y cuándo.</div>
    </div>
  );
}
function TalleresMnt({ quien }) {
  const [t, setT] = useState(null);
  const [nuevo, setNuevo] = useState("");
  const [msg, setMsg] = useState("");
  const cargar = () => api("ca_mnt_talleres_cl?select=*&order=nombre").then(setT).catch(() => setT([]));
  useEffect(() => { cargar(); }, []);
  const guardar = async (nombre, campo, valor) => {
    setMsg("");
    try { await rpc("fn_mnt_guardar_taller", { p_nombre: nombre, p_campo: campo, p_valor: valor, p_por: quien }); if (campo === "nuevo" || campo === "activo") cargar(); }
    catch (e) { setMsg(e.message); }
  };
  const cols = [["direccion", "Dirección", 240], ["comuna", "Comuna", 120], ["contacto", "Contacto", 150], ["telefono", "Teléfono", 120], ["correo", "Correo", 180], ["canal", "Canal de agenda", 140]];
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>La dirección y el contacto van en la tarea al supervisor y en el aviso al transportista cuando toca una mantención.</div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1100 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Taller", ...cols.map((c) => c[1]), "Activo"].map((h) => <th key={h} style={{ padding: "8px 10px", color: C.suave, fontSize: 12 }}>{h}</th>)}</tr></thead>
          <tbody>
            {(t || []).map((x) => (
              <tr key={x.nombre} style={{ borderTop: `1px solid ${C.borde}`, opacity: x.activo ? 1 : 0.5 }}>
                <td style={{ padding: "8px 10px", fontWeight: 700 }}>{x.nombre}</td>
                {cols.map(([k, , w]) => <td key={k} style={{ padding: "6px 8px" }}><input style={{ ...inp, width: w }} defaultValue={x[k] || ""} onBlur={(e) => e.target.value !== (x[k] || "") && guardar(x.nombre, k, e.target.value)} /></td>)}
                <td style={{ padding: "6px 8px" }}><input type="checkbox" checked={!!x.activo} onChange={(e) => guardar(x.nombre, "activo", String(e.target.checked))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input style={{ ...inp, width: 260 }} placeholder="Nuevo taller" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        <button style={btn()} onClick={() => { if (nuevo.trim()) { guardar(nuevo, "nuevo", ""); setNuevo(""); } }}>Agregar</button>
      </div>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

// ── Ficha del activo ────────────────────────────────────────────────────────
const DOC_EST = { vencido: ["Vencido", C.rojoT, C.rojo], por_vencer: ["Por vencer", C.ambarT, C.ambar], sin_dato: ["Sin dato", C.fondo, C.suave], al_dia: ["Al día", C.verdeT, C.verde], no_aplica: ["No aplica", C.fondo, C.tenue] };
const pesos = (v) => (v === null || v === undefined ? "—" : `$${Math.round(Number(v)).toLocaleString("es-CL")}`);
function FichaActivo({ quien }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ activo: "ACTIVO", doc: "", texto: "" });
  const [abierta, setAbierta] = useState(null);
  useEffect(() => { rpc("fn_ficha_lista_cl").then(setFilas).catch(() => setFilas([])); }, []);
  if (abierta) return <FichaDetalle patente={abierta} quien={quien} onVolver={() => setAbierta(null)} />;
  const act = (filas || []).filter((x) => x.estado === "ACTIVO");
  const n = (e) => act.filter((x) => x.estado_doc === e).length;
  const vis = (filas || []).filter((x) => (!f.activo || (f.activo === "ACTIVO" ? x.estado === "ACTIVO" : x.estado !== "ACTIVO"))
    && (!f.doc || x.estado_doc === f.doc)
    && (!f.texto || `${x.patente} ${x.modelo || ""} ${x.empresa || ""} ${x.ceco || ""} ${x.supervisor || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c, doc, activo = "ACTIVO") => (
    <div onClick={() => setF({ ...f, doc: f.doc === doc && f.activo === activo ? "" : doc, activo })}
      style={{ background: "#fff", border: `1px solid ${f.doc === doc && f.activo === activo ? c : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 130px", cursor: "pointer" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div>
    </div>
  );
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {kpi("Documento vencido", n("vencido"), C.rojo, "vencido")}
        {kpi("Por vencer", n("por_vencer"), C.ambar, "por_vencer")}
        {kpi("Sin dato", n("sin_dato"), C.suave, "sin_dato")}
        {kpi("Al día", n("al_dia"), C.verde, "al_dia")}
        {kpi("Inactivos", (filas || []).filter((x) => x.estado !== "ACTIVO").length, C.tenue, "", "INACTIVO")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.activo} onChange={(e) => setF({ ...f, activo: e.target.value })}>
          <option value="ACTIVO">Activos</option><option value="INACTIVO">Inactivos</option><option value="">Todos</option>
        </select>
        <select style={inp} value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value })}>
          <option value="">Todo estado documental</option>{Object.entries(DOC_EST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </select>
        <input style={{ ...inp, minWidth: 260 }} placeholder="Patente, modelo, empresa, CECO o supervisor" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
      </div>
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              {["Patente", "Modelo · año", "CECO · supervisor", "Empresa", "Documentos", "Próximo vencimiento", "Km", "Mantención"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={8} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Nada con este filtro.</td></tr>}
              {vis.map((x) => { const d = DOC_EST[x.estado_doc] || [x.estado_doc || "—", C.fondo, C.suave]; const m = MN_ESTADO[x.mnt_estado]; return (
                <tr key={x.patente} style={{ cursor: "pointer" }} onClick={() => setAbierta(x.patente)}>
                  <td style={{ ...celda, fontWeight: 800, color: C.navy, textDecoration: "underline" }}>{x.patente}</td>
                  <td style={celda}>{x.modelo || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.anio || ""}</div></td>
                  <td style={celda}>{x.ceco || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.supervisor || ""}</div></td>
                  <td style={celda}>{x.empresa || "—"}</td>
                  <td style={celda}>{chip(d[0], d[1], d[2])}</td>
                  <td style={celda}>{x.doc_proximo ? <>{x.doc_proximo}<div style={{ color: C.tenue, fontSize: 12 }}>{fd(x.doc_proximo_vence)}</div></> : "—"}</td>
                  <td style={celda}>{kmf(x.km_actual)}</td>
                  <td style={celda}>{m ? chip(m[0], m[1], m[2]) : "—"}{x.mnt_faltan !== null && x.mnt_faltan !== undefined && <div style={{ color: C.tenue, fontSize: 12 }}>{x.mnt_faltan <= 0 ? "pasada" : `faltan ${kmf(x.mnt_faltan)} km`}</div>}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function FichaDetalle({ patente, quien, onVolver }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [vu, setVu] = useState([]);
  useEffect(() => { rpc("fn_ficha_cl", { p_patente: patente }).then(setD).catch((e) => { setErr(e.message); setD({}); }); rpc("fn_mnt_vida_util_cl").then((r) => setVu((r || []).filter((x) => x.patente === patente))).catch(() => setVu([])); }, [patente]);
  const card = (t, cont) => (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 8 }}>{t}</div>{cont}
    </div>
  );
  const fila = (k, v) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.fondo}` }}><span style={{ color: C.suave }}>{k}</span><b style={{ textAlign: "right" }}>{v ?? "—"}</b></div>;
  if (!d) return <div style={{ color: C.tenue }}>Cargando ficha…</div>;
  const m = d.maestro || {}, ev = d.en_vivo || {}, co = d.conductores || {}, cs = d.costos || {}, mn = d.mantencion;
  const pt = cs.por_tipo || {};
  const rotAlta = (co.distintos || 0) >= 3;
  return (
    <div>
      <button style={btn("sec")} onClick={onVolver}>← Volver al listado</button>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "12px 0", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: C.navy }}>{patente}</h2>
        <span style={{ color: C.suave }}>{[m.marca, m.modelo, m.anio].filter(Boolean).join(" · ")}</span>
        {m.estado && chip(m.estado, m.estado === "ACTIVO" ? C.verdeT : C.fondo, m.estado === "ACTIVO" ? C.verde : C.suave)}
      </div>
      {err && <div style={{ color: C.rojo, marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        {card("Datos maestros", <>
          {fila("Tipo", m.tipo_vehiculo)}{fila("Energía", m.energia)}{fila("CECO", m.ceco_operacion || m.ceco)}{fila("Supervisor", m.supervisor)}
          {fila("Empresa asignada", m.empresa)}{fila("RUT empresa", m.rut_empresa)}{fila("VIN", m.vin)}{fila("Motor", m.motor)}
          {fila("Valor de compra", pesos(m.valor_compra))}{fila("Leasing", [m.leasing_banco, m.leasing_estado].filter(Boolean).join(" · ") || "—")}
          {m.observacion && <div style={{ fontSize: 12.5, color: C.suave, marginTop: 6 }}>{m.observacion}</div>}
        </>)}
        {card("Documentos", <>
          {(d.documentos || []).map((x) => { const e = DOC_EST[x.estado] || [x.estado, C.fondo, C.suave]; return (
            <div key={x.nombre} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 0", borderBottom: `1px solid ${C.fondo}` }}>
              <span><b>{x.nombre}</b>{x.detalle && <div style={{ color: C.tenue, fontSize: 12 }}>{x.detalle}</div>}
                {x.falta_vigente && <div style={{ color: C.ambar, fontSize: 11.5 }}>El último archivo subido vence el {fd(x.doc_vence)}: falta subir el vigente</div>}</span>
              <span style={{ textAlign: "right" }}>{fd(x.vence)} {chip(e[0], e[1], e[2])}
                <div style={{ fontSize: 11.5, marginTop: 2 }}>
                  {x.path ? <a href="#" style={{ color: C.verde }} onClick={async (ev) => { ev.preventDefault(); const u = await urlFirmada(x.path, "ca-documentos-cl"); if (u) window.open(u, "_blank"); }}>📎 Ver respaldo</a> : <span style={{ color: C.tenue }}>sin respaldo</span>}
                  {" · "}
                  <label style={{ color: C.navy, cursor: "pointer", textDecoration: "underline" }}>Subir
                    <input type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={async (ev) => {
                      const file = ev.target.files?.[0]; ev.target.value = ""; if (!file) return;
                      const v = x.tipo === "padron" ? "" : window.prompt(`¿Fecha de vencimiento del ${x.nombre}? (AAAA-MM-DD, o déjalo vacío y que lo lea Biggy)`, "");
                      if (v === null) return;
                      try { await subirDocumento(file, { patente, tipo: x.tipo, vence: /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null, quien });
                            alert("Subido. Queda en Documentos para confirmar."); } catch (e) { alert(e.message); }
                    }} />
                  </label>
                </div></span>
            </div>
          ); })}
          <div style={{ fontSize: 12, color: C.tenue, marginTop: 6 }}>La fecha viene del documento confirmado o, si no hay, de la biblia. Lo que subas queda en Cuidado de Activo → Documentos para confirmar.</div>
        </>)}
        {card("Datos en vivo (Geotab)", <>
          {fila("Odómetro", ev.km ? `${kmf(ev.km)} km` : null)}{fila("Lectura del odómetro", ev.km_fecha ? fd(ev.km_fecha) : null)}
          {fila("Última comunicación", ev.gps_fecha ? fh(ev.gps_fecha) : "sin equipo")}{fila("Velocidad", ev.velocidad !== undefined && ev.velocidad !== null ? `${ev.velocidad} km/h` : null)}
          {fila("Dónde está", ev.en_bodega ? "En bodega" : ev.en_estacionamiento ? "En su estacionamiento" : ev.lat ? "En ruta / fuera de zonas" : null)}
          {ev.lat && ev.lng && <a href={`https://maps.google.com/?q=${ev.lat},${ev.lng}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: C.navy }}>🗺️ Ver en el mapa</a>}
        </>)}
        {card(`Conductores (últimos ${co.dias || 30} días)`, <>
          {fila("Último conductor", co.ultimo)}{fila("Última ruta", co.ultimo_fecha ? fd(co.ultimo_fecha) : null)}
          {fila("Días con ruta", co.dias_con_ruta)}
          {fila("Conductores distintos", <span style={{ color: rotAlta ? C.rojo : C.texto }}>{co.distintos ?? 0}{rotAlta ? " · rotación alta" : ""}</span>)}
          {(co.lista || []).map((c) => <div key={c.conductor} style={{ fontSize: 12.5, color: C.suave, padding: "2px 0" }}>{c.conductor} · {c.dias} días · último {fd(c.ultimo)}</div>)}
        </>)}
        {card("Costo acumulado", <>
          {["mantencion", "reparacion", "siniestro", "otro", "garantia"].map((t) => pt[t] && fila(`${MN_TIPO[t]} (${pt[t].n})`, pesos(pt[t].total)))}
          {fila("Total", pesos(cs.total))}
          {fila("% del valor de compra", cs.valor_compra && cs.total ? `${Math.round((Number(cs.total) / Number(cs.valor_compra)) * 1000) / 10}%` : null)}
          {fila("Días en taller", cs.dias_taller)}
        </>)}
        {card("Mantención", mn ? <>
          {fila("Estado", (MN_ESTADO[mn.estado] || [mn.estado])[0])}{fila("Última pauta", mn.ultima_pauta ? `${kmf(mn.ultima_pauta)} · ${fd(mn.ultima_fecha)}` : "sin registro")}
          {fila("Próxima pauta", mn.proxima_pauta ? kmf(mn.proxima_pauta) : null)}{fila("Faltan", mn.faltan_km !== null && mn.faltan_km !== undefined ? `${kmf(mn.faltan_km)} km` : null)}
          {fila("Fecha estimada", mn.fecha_estimada ? fd(mn.fecha_estimada) : null)}{fila("Taller autorizado", mn.taller)}
        </> : <div style={{ color: C.tenue, fontSize: 13 }}>Sin datos.</div>)}
        {card("Vida útil de componentes", vu.length === 0 ? <div style={{ color: C.tenue, fontSize: 13 }}>Su modelo no tiene vida útil cargada.</div> :
          vu.map((x) => { const e = VU_ESTADO[x.estado] || [x.estado, C.fondo, C.suave]; return (
            <div key={x.componente} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.fondo}` }}>
              <span>{x.componente}<div style={{ color: C.tenue, fontSize: 11.5 }}>{x.ultimo_fecha ? `último cambio ${fd(x.ultimo_fecha)}` : "sin cambio registrado"}</div></span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}><BarraVU pct={x.pct} />{chip(e[0], e[1], e[2])}</span>
            </div>
          ); }))}
        {card("Auditorías", (d.auditorias || []).length === 0 ? <div style={{ color: C.tenue, fontSize: 13 }}>Sin auditorías.</div> :
          d.auditorias.map((a) => <div key={a.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.fondo}` }}>
            <b>{a.subtipo || (a.tipo === "vehiculo" ? "Vehículo" : "Limpieza")}</b> · {a.estado}{a.veredicto ? ` · ${a.veredicto}` : ""}<div style={{ color: C.tenue, fontSize: 12 }}>{a.enviada_at ? fh(a.enviada_at) : "sin enviar"}</div></div>))}
        {card("Tareas del supervisor", !d.tareas || d.tareas.length === 0 ? <div style={{ color: C.tenue, fontSize: 13 }}>Sin tareas.</div> :
          d.tareas.map((t) => <div key={t.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.fondo}` }}>{t.titulo || t.tipo}<div style={{ color: C.tenue, fontSize: 12 }}>{(ESTADO[t.estado] || [t.estado])[0]}</div></div>))}
      </div>
      <div style={{ marginTop: 14, background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden" }}><HistorialMnt patente={patente} quien={quien} /></div>
    </div>
  );
}

// ── Documentos del activo ───────────────────────────────────────────────────
const DOC_TIPO = { padron: "Primera inscripción / padrón", soap: "SOAP", rt: "Revisión técnica", gases: "Emisión de gases", permiso: "Permiso de circulación",
  seguro_vehiculo: "Seguro del vehículo", seguro_carga: "Seguro de carga", leasing: "Leasing", otro: "Otro" };
const DOC_ESTADO = { por_leer: ["Por leer (Biggy)", "#eef2f8", C.navy], por_confirmar: ["Por confirmar", C.ambarT, C.ambar], confirmado: ["Confirmado", C.verdeT, C.verde], rechazado: ["Rechazado", C.fondo, C.suave] };
async function subirDocumento(file, { patente = null, tipo = null, vence = null, quien }) {
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name}: pesa más de 30 MB`);
  const limpio = String(file.name || "archivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  const path = `${patente || "sin_patente"}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${limpio}`;
  let ultimo = "";
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(`${CL_URL}/storage/v1/object/ca-documentos-cl/${path}`, {
        method: "POST", headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" }, body: file,
      });
      if (!r.ok) { ultimo = (await r.text()).slice(0, 160); if (r.status < 500 && r.status !== 429) break; }
      else return await rpc("fn_doc_registrar", { p_path: path, p_nombre: file.name, p_mime: file.type || null, p_patente: patente, p_tipo: tipo, p_vence: vence, p_por: quien });
    } catch (e) { ultimo = e.message; }
    await new Promise((ok) => setTimeout(ok, 1500 * intento));
  }
  throw new Error(`${file.name}: ${ultimo || "no se pudo subir"}`);
}
function Documentos({ quien }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ estado: "pendientes", texto: "" });
  const [abierta, setAbierta] = useState(null);
  const [carga, setCarga] = useState({ tipo: "", patente: "" });
  const [subiendo, setSubiendo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [hora, setHora] = useState(null);
  const [sel, setSel] = useState({});
  const completo = (x) => x.estado === "por_confirmar" && x.tipo && x.tipo !== "seguro" && (x.patentes || []).length > 0 && (x.vence || ["otro", "padron"].includes(x.tipo));
  const confirmarSel = async () => {
    const lista = (filas || []).filter((x) => sel[x.id] && completo(x));
    if (!lista.length) return;
    if (!window.confirm(`Confirmar ${lista.length} documento${lista.length === 1 ? "" : "s"} con lo que leyó Biggy (tipo, patente y vencimiento que se ven en la lista).\n\nConfirma solo los que ya revisaste. ¿Seguir?`)) return;
    setCargando(true); let ok = 0; const err = [];
    for (const x of lista) {
      try { await rpc("fn_doc_confirmar", { p_id: x.id, p_tipo: x.tipo, p_patentes: x.patentes, p_vence: x.vence, p_aseguradora: x.aseguradora, p_poliza: x.poliza, p_por: quien }); ok++; }
      catch (e) { err.push(`${x.nombre_archivo}: ${e.message}`); }
    }
    setSel({}); await cargar();
    alert(`${ok} de ${lista.length} confirmados.${err.length ? "\n\n" + err.join("\n") : ""}`);
  };
  const [errorCarga, setErrorCarga] = useState("");
  const cargar = async () => {
    setCargando(true);
    try { setFilas(await api(`ca_documentos_cl?select=*&order=cargado_at.desc&limit=2000`)); setHora(new Date()); setErrorCarga(""); }
    catch (e) { setErrorCarga(`No se pudo cargar la lista (${e.message}). Los documentos no se pierden: pulsa «Actualizar» en unos segundos.`); setFilas((x) => x || []); }
    finally { setCargando(false); }
  };
  useEffect(() => { cargar(); }, []);
  // Mientras haya documentos «por leer», se actualiza sola cada minuto (Biggy lee cada 5 min en el VPS)
  const hayPorLeer = (filas || []).some((x) => x.estado === "por_leer");
  useEffect(() => { if (!hayPorLeer) return; const i = setInterval(cargar, 60000); return () => clearInterval(i); }, [hayPorLeer]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [avance, setAvance] = useState([]);   // [{ nombre, estado: "espera" | "subiendo" | "ok" | "error", msg }]
  useEffect(() => {
    if (!subiendo) return;
    const aviso = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [subiendo]);
  const subir = async (files) => {
    const lista = [...(files || [])]; if (!lista.length) return;
    const est = lista.map((f) => ({ nombre: f.name, estado: "espera", msg: "" }));
    setAvance([...est]);
    let sig = 0, hechos = 0;
    setSubiendo(`Subiendo 0 de ${lista.length}…`);
    const trabajador = async () => {
      while (sig < lista.length) {
        const i = sig++;
        est[i].estado = "subiendo"; setAvance([...est]);
        try { await subirDocumento(lista[i], { patente: carga.patente || null, tipo: carga.tipo || null, quien }); est[i].estado = "ok"; }
        catch (e) { est[i].estado = "error"; est[i].msg = e.message; }
        hechos++; setSubiendo(`Subiendo ${hechos} de ${lista.length}…`); setAvance([...est]);
      }
    };
    await Promise.all([trabajador(), trabajador(), trabajador()]);   // 3 archivos a la vez
    setSubiendo(""); setF((x) => ({ ...x, estado: "pendientes" })); cargar();
    const malos = est.filter((x) => x.estado === "error").length;
    alert(`${lista.length - malos} de ${lista.length} archivos subidos.${malos ? `\n\n${malos} con error: se muestran en rojo; puedes volver a subirlos.` : ""}\n\nQuedan «por leer»: Biggy los lee uno por uno y la lista se actualiza sola.`);
  };
  const n = (e) => (filas || []).filter((x) => x.estado === e).length;
  const vis = (filas || []).filter((x) => (f.estado === "pendientes" ? ["por_leer", "por_confirmar"].includes(x.estado) : !f.estado || x.estado === f.estado)
    && (!f.texto || `${(x.patentes || []).join(" ")} ${x.nombre_archivo || ""} ${x.aseguradora || ""} ${x.poliza || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ background: "#fff", border: `1px dashed ${C.navy}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Subir documentos (uno o muchos a la vez)</div>
        <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>PDF o foto del padrón (primera inscripción), SOAP, revisión técnica, emisión de gases, permiso de circulación, seguro del vehículo, seguro de carga o contrato de leasing. Si todos son del mismo tipo o de la misma patente, indícalo y te ahorras corregir después; si no, déjalo vacío y Biggy lo lee.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={inp} value={carga.tipo} onChange={(e) => setCarga({ ...carga, tipo: e.target.value })}>
            <option value="">Tipo: que lo lea Biggy</option>{Object.entries(DOC_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input style={{ ...inp, width: 170 }} placeholder="Patente (opcional)" value={carga.patente} onChange={(e) => setCarga({ ...carga, patente: e.target.value.toUpperCase() })} />
          <label style={{ ...btn(), display: "inline-block", cursor: subiendo ? "wait" : "pointer" }}>
            {subiendo || "Elegir archivos"}
            <input type="file" multiple accept="application/pdf,image/*" style={{ display: "none" }} disabled={!!subiendo} onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {subiendo && <div style={{ fontSize: 12.5, color: C.ambar, marginTop: 8 }}>No cierres ni recargues esta página hasta que termine la carga.</div>}
        {avance.length > 0 && (
          <div style={{ marginTop: 10, maxHeight: 180, overflowY: "auto", fontSize: 12.5, border: `1px solid ${C.fondo}`, borderRadius: 8, padding: "6px 8px" }}>
            {avance.map((a, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", color: a.estado === "error" ? C.rojo : a.estado === "ok" ? C.verde : C.suave }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nombre}</span>
                <span>{a.estado === "ok" ? "✓ subido" : a.estado === "error" ? `✕ ${a.msg.replace(a.nombre + ": ", "")}` : a.estado === "subiendo" ? "subiendo…" : "en espera"}</span>
              </div>
            ))}
            {!subiendo && <a href="#" style={{ color: C.navy, fontSize: 12 }} onClick={(e) => { e.preventDefault(); setAvance([]); }}>Limpiar</a>}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
          <option value="pendientes">Pendientes ({n("por_leer") + n("por_confirmar")})</option>
          <option value="por_leer">Por leer ({n("por_leer")})</option><option value="por_confirmar">Por confirmar ({n("por_confirmar")})</option>
          <option value="confirmado">Confirmados ({n("confirmado")})</option><option value="rechazado">Rechazados ({n("rechazado")})</option><option value="">Todos</option>
        </select>
        <input style={{ ...inp, minWidth: 240 }} placeholder="Patente, archivo, aseguradora o póliza" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn("sec")} disabled={cargando} onClick={cargar}>{cargando ? "Actualizando…" : "Actualizar"}</button>
        {f.estado === "rechazado" && n("rechazado") > 0 && <button style={btn("sec")} disabled={cargando} onClick={async () => {
          if (!window.confirm(`Devolver a revisión los ${n("rechazado")} documentos rechazados. ¿Seguir?`)) return;
          setCargando(true); for (const x of (filas || []).filter((y) => y.estado === "rechazado")) { try { await rpc("fn_doc_reabrir", { p_id: x.id, p_por: quien }); } catch { /* sigue */ } }
          await cargar(); setF({ ...f, estado: "pendientes" });
        }}>Devolver todos a revisión</button>}
        {(filas || []).some(completo) && <>
          <button style={btn("sec")} onClick={() => setSel(Object.fromEntries(vis.filter((x) => completo(x) && x.biggy?.confianza === "alta").map((x) => [x.id, true])))}>Marcar los completos (confianza alta)</button>
          <button style={btn("verde")} disabled={cargando || !Object.values(sel).some(Boolean)} onClick={confirmarSel}>Confirmar seleccionados ({(filas || []).filter((x) => sel[x.id] && completo(x)).length})</button>
        </>}
        <span style={{ fontSize: 12, color: C.tenue }}>
          {hora ? `Actualizado a las ${hora.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
          {hayPorLeer ? " · hay documentos por leer: Biggy los lee cada 5 min y esta lista se actualiza sola cada minuto" : ""}
        </span>
      </div>
      {errorCarga && <div style={{ background: C.rojoT, color: C.rojo, borderRadius: 10, padding: "10px 12px", fontSize: 13, marginBottom: 10 }}>{errorCarga}</div>}
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              {["", "Archivo", "Tipo", "Patentes", "Vence", "Aseguradora · póliza", "Subido", "Estado"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={8} style={{ ...celda, color: C.tenue, textAlign: "center" }}>{errorCarga ? "No se pudo cargar la lista." : `No hay documentos con este filtro. En total hay ${(filas || []).length}: revisa el filtro de arriba.`}</td></tr>}
              {vis.map((x) => { const e = DOC_ESTADO[x.estado] || [x.estado, C.fondo, C.suave]; return [
                <tr key={x.id} style={{ cursor: "pointer", background: abierta === x.id ? "#fafbfd" : "#fff" }} onClick={() => setAbierta(abierta === x.id ? null : x.id)}>
                  <td style={celda} onClick={(ev) => ev.stopPropagation()}>{completo(x)
                    ? <input type="checkbox" checked={!!sel[x.id]} onChange={(ev) => setSel({ ...sel, [x.id]: ev.target.checked })} />
                    : x.estado === "por_confirmar" ? <span title="Falta tipo, patente o vencimiento: ábrelo y complétalo" style={{ color: C.ambar }}>!</span> : null}</td>
                  <td style={{ ...celda, fontWeight: 700, color: C.navy, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{x.nombre_archivo || x.path}{x.biggy?.confianza && x.estado === "por_confirmar" && <div style={{ fontSize: 11.5, fontWeight: 400, color: x.biggy.confianza === "alta" ? C.verde : C.ambar }}>Biggy: confianza {x.biggy.confianza}</div>}</td>
                  <td style={celda}>{DOC_TIPO[x.tipo] || "—"}</td>
                  <td style={celda}>{(x.patentes || []).join(", ") || "—"}</td>
                  <td style={celda}>{x.vence ? fd(x.vence) : "—"}</td>
                  <td style={celda}>{[x.aseguradora, x.poliza].filter(Boolean).join(" · ") || "—"}</td>
                  <td style={celda}>{fh(x.cargado_at)}<div style={{ color: C.tenue, fontSize: 12 }}>{x.cargado_por}</div></td>
                  <td style={celda}>{chip(e[0], e[1], e[2])}</td>
                </tr>,
                abierta === x.id && <tr key={x.id + "d"}><td colSpan={8} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><DetalleDocumento doc={x} quien={quien} onListo={() => { setAbierta(null); cargar(); }} /></td></tr>,
              ]; })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function DetalleDocumento({ doc, quien, onListo }) {
  const sug = doc.biggy || {};
  const [d, setD] = useState({ tipo: doc.tipo || sug.tipo || "", patentes: (doc.patentes?.length ? doc.patentes : sug.patentes || []).join(", "),
    vence: doc.vence || sug.vence || "", aseguradora: doc.aseguradora || sug.aseguradora || "", poliza: doc.poliza || sug.poliza || "" });
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { urlFirmada(doc.path, "ca-documentos-cl").then(setUrl); }, [doc.path]);
  const esPdf = (doc.mime || doc.path || "").toLowerCase().includes("pdf");
  const confirmar = async () => {
    setBusy(true); setMsg("");
    try { await rpc("fn_doc_confirmar", { p_id: doc.id, p_tipo: d.tipo, p_patentes: d.patentes.split(/[\s,;]+/).filter(Boolean), p_vence: d.vence || null, p_aseguradora: d.aseguradora || null, p_poliza: d.poliza || null, p_por: quien }); onListo(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const rechazar = async () => {
    const nota = window.prompt("¿Por qué se rechaza? (ilegible, no es del vehículo, duplicado, no es el documento)\n\nOjo: si el documento solo está VENCIDO, no lo rechaces: confírmalo. Queda como historial y la ficha avisa que hay que renovarlo."); if (nota === null) return;
    setBusy(true); try { await rpc("fn_doc_rechazar", { p_id: doc.id, p_nota: nota, p_por: quien }); onListo(); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const campo = (k, t, props = {}) => <label style={{ fontSize: 12, color: C.suave }}>{t}<input style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...props} /></label>;
  return (
    <div style={{ padding: 14, background: "#fafbfd", display: "grid", gridTemplateColumns: "minmax(280px, 1.2fr) minmax(260px, 1fr)", gap: 14 }}>
      <div>
        {!url ? <div style={{ color: C.tenue, fontSize: 13 }}>Abriendo el archivo…</div>
          : esPdf ? <iframe title="documento" src={url} style={{ width: "100%", height: 420, border: `1px solid ${C.borde}`, borderRadius: 8, background: "#fff" }} />
          : <img src={url} alt="documento" style={{ maxWidth: "100%", maxHeight: 420, borderRadius: 8, border: `1px solid ${C.borde}` }} />}
        {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: C.navy }}>Abrir en otra pestaña</a>}
      </div>
      <div>
        {doc.biggy && <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 10, padding: "8px 10px", fontSize: 12.5, marginBottom: 10 }}><b style={{ color: C.navy }}>🤖 Biggy leyó:</b> {sug.resumen || "—"}</div>}
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ fontSize: 12, color: C.suave }}>Tipo<select style={{ ...inp, width: "100%" }} value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })}>
            <option value="">Elige…</option>{Object.entries(DOC_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {campo("patentes", "Patente(s) — una póliza puede cubrir varias, sepáralas con coma")}
          {campo("vence", "Vence", { type: "date" })}
          {["seguro_vehiculo", "seguro_carga", "soap"].includes(d.tipo) && <>{campo("aseguradora", "Aseguradora")}{campo("poliza", "N° de póliza")}</>}
          {d.tipo === "padron" && <div style={{ fontSize: 12, color: C.tenue }}>El padrón no vence: basta con el archivo.</div>}
        </div>
        {doc.nota && <div style={{ fontSize: 12.5, color: C.suave, marginTop: 8 }}>Nota: {doc.nota}</div>}
        {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
        {doc.estado !== "confirmado" && <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button style={btn("verde")} disabled={busy} onClick={confirmar}>Confirmar</button>
          <button style={btn("sec")} disabled={busy} onClick={rechazar}>Rechazar</button>
        </div>}
        {doc.estado === "confirmado" && <div style={{ fontSize: 12.5, color: C.verde, marginTop: 12 }}>Confirmado por {doc.confirmado_por} el {fh(doc.confirmado_at)}. La fecha ya está en la ficha.</div>}
        {doc.estado === "rechazado" && <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 6 }}>Rechazado por {doc.confirmado_por} el {fh(doc.confirmado_at)}. No cuenta para la ficha.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={btn()} disabled={busy} onClick={async () => { setBusy(true); try { await rpc("fn_doc_reabrir", { p_id: doc.id, p_por: quien }); onListo(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } }}>Devolver a revisión</button>
            <button style={btn("rojo")} disabled={busy} onClick={async () => { if (!window.confirm("¿Eliminar este documento? Úsalo solo si está duplicado o es un archivo equivocado.")) return; setBusy(true); try { await rpc("fn_doc_eliminar", { p_id: doc.id, p_por: quien }); onListo(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } }}>Eliminar</button>
          </div>
        </div>}
      </div>
    </div>
  );
}

// ── Reparaciones ────────────────────────────────────────────────────────────
const REP_ETAPA = {
  solicitada: ["Solicitada", "#eef2f8", C.navy], cotizando: ["Cotizando", "#eef2f8", C.navy], para_aprobar: ["Para aprobar", C.ambarT, C.ambar],
  aprobada: ["Aprobada", C.verdeT, C.verde], en_taller: ["En taller", "#eef2f8", C.navy], cerrada: ["Cerrada", C.fondo, C.suave],
  rechazada: ["Rechazada", C.rojoT, C.rojo], historica: ["Histórica (biblia)", C.fondo, C.tenue],
};
const REP_COBRO = { bigticket: "BigTicket", tercero: "Tercero", seguro: "Seguro" };
function Reparaciones({ quien }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ etapa: "abiertas", texto: "" });
  const [abierta, setAbierta] = useState(null);
  const [nueva, setNueva] = useState(false);
  const cargar = () => api("ca_rep_solicitudes_cl?select=*&order=id.desc&limit=1000").then(setFilas).catch(() => setFilas([]));
  useEffect(() => { cargar(); }, []);
  const n = (e) => (filas || []).filter((x) => x.etapa === e).length;
  const abiertas = ["solicitada", "cotizando", "para_aprobar", "aprobada", "en_taller"];
  const vis = (filas || []).filter((x) => (f.etapa === "abiertas" ? abiertas.includes(x.etapa) : !f.etapa || x.etapa === f.etapa)
    && (!f.texto || `${x.folio || ""} ${x.patente} ${x.componente || ""} ${x.descripcion || ""} ${x.taller || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c, e) => (
    <div onClick={() => setF({ ...f, etapa: f.etapa === e ? "abiertas" : e })} style={{ background: "#fff", border: `1px solid ${f.etapa === e ? c : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 120px", cursor: "pointer" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div>
    </div>
  );
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      {n("para_aprobar") > 0 && f.etapa !== "para_aprobar" && (
        <div style={{ background: C.ambarT, border: `1px solid ${C.ambar}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ color: C.ambar, fontWeight: 700 }}>⏳ Hay {n("para_aprobar")} reparación{n("para_aprobar") === 1 ? "" : "es"} esperando aprobación.</span>
          <button style={btn()} onClick={() => setF({ ...f, etapa: "para_aprobar" })}>Ver para aprobar</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {kpi("Cotizando", n("solicitada") + n("cotizando"), C.navy, "cotizando")}
        {kpi("Para aprobar", n("para_aprobar"), C.ambar, "para_aprobar")}
        {kpi("Aprobadas", n("aprobada"), C.verde, "aprobada")}
        {kpi("En taller", n("en_taller"), C.navy, "en_taller")}
        {kpi("Cerradas", n("cerrada"), C.suave, "cerrada")}
        {kpi("Históricas (biblia)", n("historica"), C.tenue, "historica")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.etapa} onChange={(e) => setF({ ...f, etapa: e.target.value })}>
          <option value="abiertas">Abiertas</option>{Object.entries(REP_ETAPA).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}<option value="">Todas</option>
        </select>
        <input style={{ ...inp, minWidth: 240 }} placeholder="Folio, patente, componente o taller" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn()} onClick={() => setNueva(!nueva)}>{nueva ? "Cerrar" : "+ Nueva reparación"}</button>
      </div>
      {nueva && <NuevaReparacion quien={quien} onListo={() => { setNueva(false); setF({ ...f, etapa: "abiertas" }); cargar(); }} />}
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              {["Folio", "Patente", "Componente", "Taller", "Cotizado", "Aprobado", "Cobro a", "Solicitada", "Etapa"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={9} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Nada con este filtro.</td></tr>}
              {vis.map((x) => { const e = REP_ETAPA[x.etapa] || [x.etapa, C.fondo, C.suave]; return [
                <tr key={x.id} style={{ cursor: "pointer", background: abierta === x.id ? "#fafbfd" : "#fff" }} onClick={() => setAbierta(abierta === x.id ? null : x.id)}>
                  <td style={{ ...celda, fontWeight: 700, color: C.navy }}>{x.folio}</td>
                  <td style={{ ...celda, fontWeight: 800 }}>{x.patente}</td>
                  <td style={celda}>{x.componente}<div style={{ color: C.tenue, fontSize: 12 }}>{x.descripcion}</div></td>
                  <td style={celda}>{x.taller || "—"}</td>
                  <td style={celda}>{pesos(x.monto_cotizado)}</td>
                  <td style={celda}>{pesos(x.monto_aprobado)}</td>
                  <td style={celda}>{REP_COBRO[x.cobro_a] || "—"}</td>
                  <td style={celda}>{fd(x.fecha_solicitud)}</td>
                  <td style={celda}>{chip(e[0], e[1], e[2])}</td>
                </tr>,
                abierta === x.id && <tr key={x.id + "d"}><td colSpan={9} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><FichaReparacion s={x} quien={quien} onCambio={cargar} /></td></tr>,
              ]; })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function NuevaReparacion({ quien, onListo }) {
  const [d, setD] = useState({ patente: "", componente: "", descripcion: "", origen: "ejecutivo", taller: "", monto: "" });
  const [talleres, setTalleres] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("ca_mnt_talleres_cl?select=nombre&activo=eq.true&order=nombre").then((r) => setTalleres((r || []).map((x) => x.nombre))).catch(() => {}); }, []);
  const guardar = async () => {
    setBusy(true); setMsg("");
    try { await rpc("fn_rep_crear", { p_patente: d.patente, p_componente: d.componente, p_descripcion: d.descripcion || null, p_origen: d.origen, p_taller: d.taller || null, p_monto: d.monto === "" ? null : Number(d.monto), p_por: quien }); onListo(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const campo = (k, t, props = {}) => <label style={{ fontSize: 12, color: C.suave }}>{t}<input style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...props} /></label>;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 10 }}>Nueva solicitud de reparación</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
        {campo("patente", "Patente", { onChange: (e) => setD({ ...d, patente: e.target.value.toUpperCase() }) })}
        {campo("componente", "Componente", { list: "rep-comp", placeholder: "FRENOS, NEUMATICOS…" })}
        <datalist id="rep-comp">{["FRENOS", "NEUMATICOS", "EMBRAGUE", "TREN DELANTERO", "BANDEJAS", "SISTEMA ELECTRICO", "PARABRISAS", "LUCES", "PUERTAS TRASERAS", "DIAGNOSTICO", "AMORTIGUADORES", "BATERIA"].map((c) => <option key={c} value={c} />)}</datalist>
        <label style={{ fontSize: 12, color: C.suave }}>Origen<select style={{ ...inp, width: "100%" }} value={d.origen} onChange={(e) => setD({ ...d, origen: e.target.value })}>
          <option value="ejecutivo">Ejecutivo</option><option value="supervisor">Pedido del supervisor</option><option value="auditoria">Hallazgo de auditoría</option><option value="verificador">Alerta de vida útil</option></select></label>
        {campo("taller", "Taller (opcional)", { list: "rep-taller" })}
        <datalist id="rep-taller">{talleres.map((t) => <option key={t} value={t} />)}</datalist>
        {campo("monto", "Monto cotizado (opcional)", { type: "number" })}
      </div>
      <div style={{ marginTop: 10 }}>{campo("descripcion", "Descripción")}</div>
      <div style={{ fontSize: 12, color: C.suave, marginTop: 8 }}>Si ya tienes el monto cotizado, queda «Para aprobar»; si no, queda «Cotizando».</div>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 10 }}><button style={btn()} disabled={busy} onClick={guardar}>{busy ? "Guardando…" : "Crear solicitud"}</button></div>
    </div>
  );
}
// Ficha de autorización en una ventana imprimible (el navegador la guarda como PDF)
function imprimirFichaRep(s, ref, dif, med) {
  const p = (v) => (v === null || v === undefined || v === "" ? "—" : v);
  const $ = (v) => (v === null || v === undefined ? "—" : `$${Math.round(Number(v)).toLocaleString("es-CL")}`);
  const filas = [
    ["Folio", s.folio], ["Patente · modelo", `${s.patente} · ${p(ref?.modelo)}`], ["Componente", s.componente], ["Descripción", s.descripcion], ["Origen", s.origen],
    ["Taller", s.taller], ["Monto cotizado", $(s.monto_cotizado)], ["Monto aprobado", $(s.monto_aprobado)], ["Cobro a", s.cobro_a],
    ["Reparación anterior del componente", ref?.anterior ? `${fd(ref.anterior.fecha)} · ${p(ref.anterior.taller)} · ${$(ref.anterior.costo)}` : "no hay"],
    ["Precio de referencia (mediana)", med ? `${$(med)} (${ref?.casos || 0} casos)` : "sin casos"], ["Cotizado vs referencia", dif === null ? "—" : `${dif > 0 ? "+" : ""}${dif}%`],
    ["Vida útil del componente", ref?.vida_util ? `${Math.round(ref.vida_util.pct || 0)}% · ${ref.vida_util.veredicto}` : "—"],
    ["Garantía vigente", ref?.garantia ? `${ref.garantia.folio} hasta ${fd(ref.garantia.hasta)}` : "no"],
    ["Montos repetidos del taller", (ref?.repetidos || []).length ? `${ref.repetidos.length} en 12 meses` : "no"],
    ["Decisión", s.decision ? `${s.decision} · ${p(s.decision_por)} · ${fh(s.decision_at)}` : "pendiente"], ["Nota", s.decision_nota], ["N° de OC", s.oc_numero],
  ];
  const w = window.open("", "_blank");
  if (!w) return alert("El navegador bloqueó la ventana: permite las ventanas emergentes para el Brain.");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ficha ${s.folio}</title>
  <style>body{font-family:Arial,sans-serif;color:#1f2937;margin:32px}h1{color:#002E5D;font-size:20px;margin:0}h2{color:#FF6600;font-size:13px;margin:4px 0 18px}
  table{border-collapse:collapse;width:100%;font-size:13px}td{padding:7px 10px;border-bottom:1px solid #e4e7ec}td:first-child{color:#475569;width:38%}
  .firma{margin-top:48px;display:flex;gap:40px}.firma div{flex:1;border-top:1px solid #94a3b8;padding-top:6px;font-size:12px;color:#475569;text-align:center}</style></head>
  <body><h1>Ficha de autorización de reparación · ${s.folio}</h1><h2>BigTicket · Cuidado de Activo · ${new Date().toLocaleDateString("es-CL")}</h2>
  <table>${filas.map(([k, v]) => `<tr><td>${k}</td><td><b>${p(v)}</b></td></tr>`).join("")}</table>
  <div class="firma"><div>Ejecutivo Cuidado de Activo</div><div>Jefatura · aprobación</div></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
  w.document.close();
}

function FichaReparacion({ s, quien, onCambio }) {
  const [ref, setRef] = useState(null);
  const [d, setD] = useState({ monto: s.monto_cotizado || "", taller: s.taller || "", cobro_a: s.cobro_a || "", nota: "", oc: s.oc_numero || "", fecha: hoyCL(), gasto: "", km: "", dias: "", garantia_meses: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { rpc("fn_rep_referencia", { p_id: s.id }).then(setRef).catch(() => setRef({})); }, [s.id]);
  const accion = async (a, datos) => {
    setBusy(true); setMsg("");
    try { const r = await rpc("fn_rep_avanzar", { p_id: s.id, p_accion: a, p_datos: datos, p_por: quien }); if (r && r !== "Listo.") alert(r); onCambio(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const med = ref?.mediana ? Number(ref.mediana) : null;
  const base = Number(s.monto_cotizado || d.monto) || null;
  const dif = med && base ? Math.round((base / med - 1) * 100) : null;
  const fila = (k, v) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.fondo}` }}><span style={{ color: C.suave }}>{k}</span><b style={{ textAlign: "right" }}>{v ?? "—"}</b></div>;
  const campo = (k, t, props = {}) => <label style={{ fontSize: 12, color: C.suave }}>{t}<input style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...props} /></label>;
  return (
    <div style={{ padding: 14, background: "#fafbfd", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Ficha de autorización</div>
        {fila("Patente · modelo", `${s.patente} · ${ref?.modelo || "—"}`)}
        {fila("Componente", s.componente)}
        {fila("Origen", s.origen)}
        {fila("Reparación anterior del componente", ref?.anterior ? `${fd(ref.anterior.fecha)} · ${ref.anterior.taller || "—"} · ${pesos(ref.anterior.costo)}` : "no hay")}
        {fila(`Precio de referencia (mediana, ${ref?.casos || 0} casos)`, med ? pesos(med) : "sin casos")}
        {ref?.vida_util && fila(`Veredicto por desgaste (${ref.vida_util.componente})`, <span style={{ color: String(ref.vida_util.veredicto).startsWith("revisar") ? C.rojo : ref.vida_util.veredicto === "evaluar" ? C.ambar : C.verde }}>
          {ref.vida_util.pct !== null && ref.vida_util.pct !== undefined ? `${Math.round(ref.vida_util.pct)}% de vida útil · ` : ""}{ref.vida_util.veredicto}</span>)}
        {dif !== null && fila("Cotizado vs referencia", <span style={{ color: dif > 20 ? C.rojo : dif < -20 ? C.verde : C.texto }}>{dif > 0 ? "+" : ""}{dif}%</span>)}
        {ref?.garantia && <div style={{ background: C.rojoT, color: C.rojo, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, margin: "6px 0" }}>
          <b>En garantía:</b> {ref.garantia.folio} en {ref.garantia.taller || "taller"} (salida {fd(ref.garantia.salida)}, {ref.garantia.meses} meses) cubre hasta el {fd(ref.garantia.hasta)}. Corresponde reclamarla al taller, no pagarla de nuevo.</div>}
        {(ref?.repetidos || []).length > 0 && <div style={{ background: C.ambarT, color: C.ambar, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, margin: "6px 0" }}>
          <b>Monto repetido:</b> {s.taller} ya cobró exactamente {pesos(ref.repetidos[0].costo)} en {ref.repetidos.length} reparación{ref.repetidos.length === 1 ? "" : "es"} de los últimos 12 meses: {ref.repetidos.slice(0, 4).map((x) => `${x.patente} ${fd(x.fecha)}`).join(", ")}. Revisa que no sea una cotización copiada.</div>}
        {fila("Decisión", s.decision ? `${s.decision} · ${s.decision_por || ""} · ${fh(s.decision_at)}` : "pendiente")}
        {s.decision_nota && <div style={{ fontSize: 12.5, color: C.suave, marginTop: 4 }}>{s.decision_nota}</div>}
        {s.gasto_final && fila("Gasto final", pesos(s.gasto_final))}
        {(ref?.eventos || []).length > 0 && <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 8 }}>{ref.eventos.map((e, i) => <div key={i}>{fh(e.at)} · {e.accion} · {e.por}</div>)}</div>}
        <button style={{ ...btn("sec"), marginTop: 10 }} onClick={() => imprimirFichaRep(s, ref, dif, med)}>Imprimir ficha / PDF</button>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12 }}>
        {["solicitada", "cotizando"].includes(s.etapa) && <>
          <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Registrar la cotización</div>
          <div style={{ display: "grid", gap: 8 }}>{campo("taller", "Taller")}{campo("monto", "Monto cotizado", { type: "number" })}</div>
          <button style={{ ...btn(), marginTop: 10 }} disabled={busy} onClick={() => accion("cotizar", { monto: Number(d.monto) || null, taller: d.taller })}>Pasar a «Para aprobar»</button>
        </>}
        {s.etapa === "para_aprobar" && <>
          <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Decisión</div>
          <div style={{ display: "grid", gap: 8 }}>
            {campo("monto", "Monto a aprobar", { type: "number" })}
            <label style={{ fontSize: 12, color: C.suave }}>Cobro a (obligatorio para autorizar)<select style={{ ...inp, width: "100%" }} value={d.cobro_a} onChange={(e) => setD({ ...d, cobro_a: e.target.value })}>
              <option value="">Elige…</option>{Object.entries(REP_COBRO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {campo("nota", "Nota (opcional)")}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button style={btn("verde")} disabled={busy} onClick={() => { if (window.confirm("Al autorizar se crea una tarea al supervisor para coordinar el ingreso al taller (el correo sale según el modo de correos: en prueba solo te llega a ti). ¿Seguir?")) accion("decidir", { decision: "autorizada", cobro_a: d.cobro_a, monto: Number(d.monto) || null, nota: d.nota }); }}>Autorizar</button>
            <button style={btn("rojo")} disabled={busy} onClick={() => accion("decidir", { decision: "rechazada", nota: d.nota })}>Rechazar</button>
            <button style={btn("sec")} disabled={busy} onClick={() => accion("decidir", { decision: "pendiente", nota: d.nota })}>Dejar pendiente</button>
          </div>
        </>}
        {s.etapa === "aprobada" && <>
          <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Aprobada · {pesos(s.monto_aprobado)} · cobro a {REP_COBRO[s.cobro_a]}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}>{campo("oc", "N° de OC (opcional)")}</div>
            <button style={btn("sec")} disabled={busy} onClick={() => accion("oc", { oc: d.oc })}>Guardar OC</button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ flex: "1 1 160px" }}>{campo("fecha", "Ingreso a taller", { type: "date", max: hoyCL() })}</div>
            <button style={btn()} disabled={busy} onClick={() => accion("taller", { fecha: d.fecha })}>Pasar a «En taller»</button>
          </div>
          <div style={{ fontSize: 12, color: C.tenue, marginTop: 4 }}>Al pasar a taller se le pide al transportista la auditoría de entrega a taller.
          </div>
        </>}
        {["aprobada", "en_taller"].includes(s.etapa) && <>
          <div style={{ fontWeight: 800, color: C.navy, margin: "14px 0 6px" }}>Cerrar con el gasto real</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {campo("fecha", "Fecha de salida", { type: "date", max: hoyCL() })}{campo("gasto", "Gasto final ($)", { type: "number" })}
            {campo("km", "Km (opcional)", { type: "number" })}{campo("dias", "Días en taller (opcional)", { type: "number" })}
            {campo("garantia_meses", "Garantía (meses)", { type: "number" })}
          </div>
          <button style={{ ...btn("verde"), marginTop: 10 }} disabled={busy} onClick={() => accion("cerrar", { fecha: d.fecha, gasto: Number(d.gasto) || null, km: d.km === "" ? null : Number(d.km), dias: d.dias === "" ? null : Number(d.dias), garantia_meses: d.garantia_meses === "" ? null : Number(d.garantia_meses) })}>Cerrar reparación</button>
          <div style={{ fontSize: 12, color: C.tenue, marginTop: 6 }}>Queda en el historial del vehículo y se pide la auditoría de retiro de taller. Si el gasto supera lo aprobado en más de 10 %, se avisa (no bloquea).</div>
        </>}
        {["cerrada", "rechazada", "historica"].includes(s.etapa) && <div style={{ fontSize: 13, color: C.suave }}>{s.etapa === "historica" ? "Solicitud aprobada que vino de la planilla de Adriana. Solo para consulta." : `Solicitud ${s.etapa}.`}</div>}
        {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  );
}

// ── Siniestros ──────────────────────────────────────────────────────────────
const SIN_ESTADO = { abierto: ["Abierto", C.ambarT, C.ambar], en_taller: ["En taller", "#eef2f8", C.navy], cerrado: ["Cerrado", C.fondo, C.suave], cerrado_baja: ["Cerrado por baja", C.fondo, C.tenue] };
// Listas de la hoja «VALIDACIÓN DATOS» del seguimiento de Adriana
const SIN_CAUSANTE = ["Chofer", "Tercero involucrado"];
const SIN_TRIP = ["Propia", "Externo"];
function Siniestros({ quien }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ estado: "abiertos", texto: "" });
  const [abierta, setAbierta] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const cargar = () => api("vw_siniestros_cl?select=*&order=fecha_siniestro.desc&limit=1000").then(setFilas).catch(() => setFilas([]));
  const [importando, setImportando] = useState("");
  // SEGUIMIENTO SINIESTROS de Adriana (hoja BASE). reset = true: borra antes lo importado y no editado a mano.
  const importarSeguimiento = async (file, reset) => {
    if (!file) return;
    try {
      if (reset) {
        const pv = await rpc("fn_sin_reset_previa");
        if (!window.confirm(`Resetear y cargar el seguimiento:\n\n• Se borran ${pv.se_borran} siniestros importados (consolidado y seguimiento) que nadie editó a mano. Quedan respaldados.\n• Se quedan ${pv.se_quedan_editados} editados a mano y ${pv.se_quedan_brain} registrados en el Brain.\n\nDespués se carga el archivo completo. ¿Seguir?`)) return;
      }
      setImportando("Leyendo el seguimiento…");
      const XLSX = await cargarSheetJS();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const hoja = wb.SheetNames.find((n) => /^base$/i.test(n.trim())) || wb.SheetNames.find((n) => /base/i.test(n));
      if (!hoja) throw new Error(`El archivo no tiene la hoja «BASE» (hojas: ${wb.SheetNames.join(", ")})`);
      const iso = (v) => v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : v;
      const filasX = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: null }).map((r) => {
        const o = {}; for (const [k, v] of Object.entries(r)) { const kk = String(k).toUpperCase().replace(/\s+/g, " ").trim(); if (kk !== "HECHOS") o[kk] = iso(v); }   // el relato no se envía
        return o;
      }).filter((r) => r["PATENTE"]);
      if (!filasX.length) throw new Error("La hoja BASE no trae filas con patente");
      if (reset) { setImportando("Reseteando…"); await rpc("fn_sin_reset", { p_por: quien }); }
      const tot = {};
      for (let i = 0; i < filasX.length; i += 100) {
        setImportando(`Cargando ${Math.min(i + 100, filasX.length)} de ${filasX.length}…`);
        const r = await rpc("fn_sin_importar_seguimiento", { p_filas: filasX.slice(i, i + 100), p_por: quien });
        for (const [k, v] of Object.entries(r || {})) tot[k] = (tot[k] || 0) + Number(v || 0);
      }
      alert(`Seguimiento «${hoja}»: ${filasX.length} filas.\n\n• Nuevos: ${tot.nuevos || 0}\n• Completados (ya estaban, p. ej. del consolidado): ${tot.completados || 0}\n• Editados a mano en el Brain (no se tocan): ${tot.editados_a_mano || 0}\n• Mercadería (se omiten): ${tot.mercaderia || 0}${tot.patente_no_esta ? `\n• Patente que no está en la ficha: ${tot.patente_no_esta}` : ""}${tot.sin_fecha ? `\n• Sin fecha del siniestro: ${tot.sin_fecha}` : ""}\n\nEl relato (HECHOS) no se guarda.`);
      cargar();
    } catch (e) { alert(e.message); } finally { setImportando(""); }
  };
  // Carga la hoja SINIESTROS del consolidado de vehículos (la «biblia»). Se puede repetir con el archivo actualizado.
  const importar = async (file) => {
    if (!file) return;
    setImportando("Leyendo el Excel…");
    try {
      const XLSX = await cargarSheetJS();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const hoja = wb.SheetNames.find((n) => /siniestro/i.test(n));
      if (!hoja) throw new Error(`El archivo no tiene una hoja «SINIESTROS» (hojas: ${wb.SheetNames.join(", ")})`);
      const crudas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: null });
      const norm = (k) => String(k).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
      const fecha = (v) => { if (!v) return null; if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10); const m = String(v).match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : String(v).slice(0, 10); };
      const filasX = crudas.map((r) => { const o = {}; for (const [k, v] of Object.entries(r)) o[norm(k)] = v; return {
        fecha: fecha(o["FECHA DE SERVICIO"] || o["FECHA SINIESTRO"] || o["FECHA"]), patente: o["PATENTE"], ceco: o["CECOS"] || o["CECO"], km: o["ODOMETRO"],
        item: o["ITEM"], taller: o["TALLER"], costo: o["COSTO"], dias: o["DIAS EN TALLER"], responsable: o["RESPONSABLE"], precio_total: o["PRECIO REPARACION TOTAL"] }; })
        .filter((r) => r.patente && r.fecha);
      if (!filasX.length) throw new Error("La hoja de siniestros no trae filas con patente y fecha");
      const tot = { nuevos: 0, actualizados: 0, omitidos: 0, patente_no_esta: 0 };
      for (let i = 0; i < filasX.length; i += 200) {
        setImportando(`Cargando ${Math.min(i + 200, filasX.length)} de ${filasX.length}…`);
        const r = await rpc("fn_sin_importar", { p_filas: filasX.slice(i, i + 200), p_por: quien });
        for (const k of Object.keys(tot)) tot[k] += Number(r?.[k] || 0);
      }
      alert(`Hoja «${hoja}»: ${filasX.length} filas.\n\n• Nuevos: ${tot.nuevos}\n• Actualizados: ${tot.actualizados}\n• Sin cambios o editados a mano en el Brain: ${tot.omitidos}${tot.patente_no_esta ? `\n• Patente que no está en la ficha de activos: ${tot.patente_no_esta}` : ""}`);
      cargar();
    } catch (e) { alert(e.message); } finally { setImportando(""); }
  };
  useEffect(() => { cargar(); }, []);
  const todos = filas || [];
  const abiertos = todos.filter((x) => ["abierto", "en_taller"].includes(x.estado));
  const suma = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const conDias = todos.filter((x) => x.dias_taller !== null && x.dias_taller !== undefined);
  const pctChofer = todos.length ? Math.round((todos.filter((x) => x.causante === "Chofer").length / todos.length) * 100) : 0;
  const porAnio = {}; for (const x of todos) { const y = String(x.fecha_siniestro || "").slice(0, 4); if (y) porAnio[y] = (porAnio[y] || 0) + (Number(x.costo_reparacion) || 0); }
  const reinc = Object.entries(todos.reduce((m, x) => { m[x.patente] = (m[x.patente] || 0) + 1; return m; }, {})).filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]);
  const reincC = Object.entries(todos.filter((x) => x.conductor).reduce((m, x) => { m[x.conductor] = (m[x.conductor] || 0) + 1; return m; }, {})).filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1]);
  const vis = todos.filter((x) => (f.estado === "abiertos" ? ["abierto", "en_taller"].includes(x.estado) : !f.estado || x.estado === f.estado)
    && (!f.texto || `${x.folio} ${x.patente} ${x.conductor || ""} ${x.compania || ""} ${x.numero_siniestro || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c) => <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 140px" }}><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div></div>;
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        {kpi("Siniestros", todos.length, C.navy)}{kpi("Abiertos", abiertos.length, C.ambar)}
        {kpi("Costo de reparación", pesos(suma(todos, "costo_reparacion")), C.texto)}{kpi("Deducibles", pesos(suma(todos, "deducible")), C.texto)}
        {kpi("Pérdida en venta estimada", pesos(suma(todos, "perdida_venta")), C.rojo)}
        {kpi("Días en taller promedio", conDias.length ? Math.round(suma(conDias, "dias_taller") / conDias.length) : "—", C.texto)}
        {kpi("Causante chofer", `${pctChofer}%`, C.texto)}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: C.suave, marginBottom: 12 }}>
        <span><b>Costo por año:</b> {Object.keys(porAnio).sort().map((y) => `${y} ${pesos(porAnio[y])}`).join(" · ") || "—"}</span>
        <span><b>Reincidencia patente:</b> {reinc.slice(0, 5).map(([p, k]) => `${p} (${k})`).join(", ") || "—"}</span>
        <span><b>Reincidencia conductor:</b> {reincC.slice(0, 5).map(([p, k]) => `${p} (${k})`).join(", ") || "—"}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
          <option value="abiertos">Abiertos</option>{Object.entries(SIN_ESTADO).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}<option value="">Todos</option>
        </select>
        <input style={{ ...inp, minWidth: 240 }} placeholder="Folio, patente, conductor, compañía o N°" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn()} onClick={() => setNuevo(!nuevo)}>{nuevo ? "Cerrar" : "+ Nuevo siniestro"}</button>
        <label style={{ ...btn("sec"), display: "inline-block", cursor: importando ? "wait" : "pointer" }}>
          {importando || "Actualizar desde el seguimiento"}
          <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} disabled={!!importando} onChange={(e) => { importarSeguimiento(e.target.files?.[0], false); e.target.value = ""; }} />
        </label>
        <label style={{ ...btn("sec"), display: "inline-block", cursor: importando ? "wait" : "pointer", color: C.rojo }}>
          Resetear y cargar seguimiento
          <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} disabled={!!importando} onChange={(e) => { importarSeguimiento(e.target.files?.[0], true); e.target.value = ""; }} />
        </label>
        <label style={{ ...btn("sec"), display: "inline-block", cursor: importando ? "wait" : "pointer" }}>
          {importando ? "…" : "Cargar consolidado (Excel)"}
          <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} disabled={!!importando} onChange={(e) => { importar(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>
      {nuevo && <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, marginBottom: 14 }}><FormSiniestro quien={quien} onListo={() => { setNuevo(false); cargar(); }} /></div>}
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
              {["Folio", "Fecha", "Patente", "Conductor · causante", "Compañía · N°", "Deducible", "Costo", "Días taller", "Estado"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={9} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Nada con este filtro.</td></tr>}
              {vis.map((x) => { const e = SIN_ESTADO[x.estado] || [x.estado, C.fondo, C.suave]; return [
                <tr key={x.id} style={{ cursor: "pointer", background: abierta === x.id ? "#fafbfd" : "#fff" }} onClick={() => setAbierta(abierta === x.id ? null : x.id)}>
                  <td style={{ ...celda, fontWeight: 700, color: C.navy }}>{x.folio}{["consolidado", "seguimiento"].includes(x.origen) && <div style={{ color: C.tenue, fontSize: 11.5, fontWeight: 400 }}>del {x.origen}</div>}</td>
                  <td style={celda}>{fd(x.fecha_siniestro)}</td>
                  <td style={{ ...celda, fontWeight: 800 }}>{x.patente}</td>
                  <td style={celda}>{x.conductor || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.causante || ""}</div></td>
                  <td style={celda}>{x.compania || "—"}<div style={{ color: C.tenue, fontSize: 12 }}>{x.numero_siniestro || ""}</div></td>
                  <td style={celda}>{pesos(x.deducible)}{x.cobro_enviado_at && <div style={{ color: C.verde, fontSize: 12 }}>enviado a cobro</div>}</td>
                  <td style={celda}>{pesos(x.costo_reparacion)}</td>
                  <td style={celda}>{x.dias_taller === null || x.dias_taller === undefined ? "—" : x.taller_en_curso ? `${x.dias_taller} · en curso` : x.dias_taller}</td>
                  <td style={celda}>{chip(e[0], e[1], e[2])}{x.estado_origen && x.estado_origen.toLowerCase() !== x.estado && <div style={{ color: C.tenue, fontSize: 11.5 }}>{x.estado_origen.toLowerCase()}</div>}</td>
                </tr>,
                abierta === x.id && <tr key={x.id + "d"}><td colSpan={9} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><FormSiniestro s={x} quien={quien} onListo={() => { setAbierta(null); cargar(); }} /></td></tr>,
              ]; })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function FormSiniestro({ s = null, quien, onListo }) {
  const ini = s || {};
  const [d, setD] = useState({ patente: ini.patente || "", fecha_siniestro: ini.fecha_siniestro || hoyCL(), fecha_apertura: ini.fecha_apertura || "", entrada_taller: ini.entrada_taller || "", salida_taller: ini.salida_taller || "",
    conductor: ini.conductor || "", tripulacion: ini.tripulacion || "", causante: ini.causante || "", compania: ini.compania || "", numero_siniestro: ini.numero_siniestro || "",
    taller: ini.taller || "", danos: ini.danos || "", deducible: ini.deducible ?? "", costo_reparacion: ini.costo_reparacion ?? "", resolucion: ini.resolucion || "" });
  const [conductores, setConductores] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const cerrado = ["cerrado", "cerrado_baja"].includes(ini.estado);
  const [cambios, setCambios] = useState([]);
  useEffect(() => { if (s) api(`ca_siniestros_cambios_cl?siniestro_id=eq.${s.id}&select=*&order=at.desc&limit=20`).then(setCambios).catch(() => setCambios([])); }, [s?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d.patente.length >= 6 && d.fecha_siniestro) rpc("fn_sin_conductores", { p_patente: d.patente, p_fecha: d.fecha_siniestro }).then((r) => setConductores([...new Set((r || []).map((x) => x.conductor))])).catch(() => {}); }, [d.patente, d.fecha_siniestro]);
  const datos = () => { const o = {}; for (const [k, v] of Object.entries(d)) o[k] = v === "" ? null : v; return o; };
  const guardar = async () => { setBusy(true); setMsg(""); try { await rpc("fn_sin_guardar", { p_id: s ? s.id : null, p_datos: datos(), p_por: quien }); onListo(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  const cobro = async () => { if (!window.confirm(`Enviar a cobro el deducible de ${pesos(d.deducible)} al tercero. ¿Seguir?`)) return; setBusy(true); try { await rpc("fn_sin_guardar", { p_id: s.id, p_datos: datos(), p_por: quien }); await rpc("fn_sin_enviar_cobro", { p_id: s.id, p_por: quien }); onListo(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  const cerrar = async (baja) => { if (!window.confirm(baja ? "Cerrar por baja del vehículo. ¿Seguir?" : "Cerrar el siniestro: el costo queda en el historial del vehículo. ¿Seguir?")) return; setBusy(true); try { await rpc("fn_sin_guardar", { p_id: s.id, p_datos: datos(), p_por: quien }); await rpc("fn_sin_cerrar", { p_id: s.id, p_resolucion: d.resolucion || null, p_baja: baja, p_por: quien }); onListo(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  const campo = (k, t, props = {}) => <label style={{ fontSize: 12, color: C.suave }}>{t}<input style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...props} /></label>;
  const lista = (k, t, ops) => <label style={{ fontSize: 12, color: C.suave }}>{t}<select style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })}><option value="">—</option>{ops.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
  return (
    <div style={{ padding: 14, background: "#fafbfd" }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 10 }}>{s ? `${s.folio} · ${s.patente}` : "Nuevo siniestro de vehículo"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {campo("patente", "Patente", { disabled: !!s, onChange: (e) => setD({ ...d, patente: e.target.value.toUpperCase() }) })}
        {campo("fecha_siniestro", "Fecha del siniestro", { type: "date", max: hoyCL() })}
        {campo("fecha_apertura", "Apertura en la compañía", { type: "date" })}
        {campo("entrada_taller", "Entrada a taller", { type: "date" })}
        {campo("salida_taller", "Salida de taller", { type: "date" })}
        {campo("conductor", "Conductor", { list: "sin-cond", placeholder: conductores.length ? "Elige del maestro de viajes" : "" })}
        <datalist id="sin-cond">{conductores.map((c) => <option key={c} value={c} />)}</datalist>
        {lista("tripulacion", "Tripulación", SIN_TRIP)}
        {lista("causante", "Causante", SIN_CAUSANTE)}
        {campo("compania", "Compañía")}
        {campo("numero_siniestro", "N° de siniestro")}
        {campo("taller", "Taller")}
        {campo("deducible", "Deducible ($) · al tercero", { type: "number" })}
        {campo("costo_reparacion", "Costo de reparación total ($)", { type: "number" })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
        {campo("danos", "Daños")}
        {campo("resolucion", "Resolución")}
      </div>
      <div style={{ fontSize: 12, color: C.tenue, marginTop: 8 }}>El relato del siniestro no se guarda (tiene datos de terceros). El deducible siempre se descuenta al tercero.
        {d.entrada_taller && !cerrado ? " Mientras el vehículo esté en taller, conviene dejarlo Inactivo · Siniestrado en la ficha de la flota." : ""}</div>
      {s && s.dias_taller !== null && s.dias_taller !== undefined && <div style={{ fontSize: 13, marginTop: 8 }}><b>Días en taller:</b> {s.dias_taller}{s.taller_en_curso ? " (en curso)" : ""} · <b>Pérdida en venta estimada:</b> {pesos(s.perdida_venta)}{s.tarifa_dia ? ` (${pesos(s.tarifa_dia)} por día)` : " (sin tarifa para su CECO)"}</div>}
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <button style={btn()} disabled={busy} onClick={guardar}>{s ? "Guardar cambios" : "Registrar siniestro"}</button>
        {s && !s.cobro_enviado_at && <button style={btn("sec")} disabled={busy} onClick={cobro}>Enviar a cobro</button>}
        {s && !cerrado && <button style={btn("verde")} disabled={busy} onClick={() => cerrar(false)}>Cerrar siniestro</button>}
        {s && !cerrado && <button style={btn("sec")} disabled={busy} onClick={() => cerrar(true)}>Cerrar por baja</button>}
        {s && cerrado && <span style={{ fontSize: 12, color: C.tenue }}>Siniestro cerrado: puedes completar o corregir sus datos; cada cambio queda registrado.</span>}
      </div>
      {cambios.length > 0 && <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 8 }}>{cambios.map((c) => <div key={c.id}>{fh(c.at)} · {c.por} cambió: {Object.keys(c.cambios || {}).join(", ")}</div>)}</div>}
      {s?.cobro_enviado_at && <div style={{ fontSize: 12.5, color: C.verde, marginTop: 8 }}>Deducible enviado a cobro el {fh(s.cobro_enviado_at)} por {s.cobro_enviado_por}. Queda listo para Conciliaciones.</div>}
    </div>
  );
}

// ── Vida útil de componentes ────────────────────────────────────────────────
const VU_ESTADO = { supera: ["Supera el límite", C.rojoT, C.rojo], alerta: ["En alerta", C.ambarT, C.ambar], en_protocolo: ["En protocolo", "#eef2f8", C.navy], ok: ["Ok", C.verdeT, C.verde], sin_dato: ["Sin dato", C.fondo, C.suave] };
function BarraVU({ pct }) {
  if (pct === null || pct === undefined) return <span style={{ color: C.tenue }}>—</span>;
  const v = Math.min(Number(pct), 130), col = pct >= 100 ? C.rojo : pct >= 85 ? C.ambar : C.verde;
  return <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 90, height: 8, background: C.fondo, borderRadius: 4, overflow: "hidden" }}><div style={{ width: `${Math.min(v, 100)}%`, height: "100%", background: col }} /></div><b style={{ color: col, fontSize: 12.5 }}>{Math.round(pct)}%</b></div>;
}
function VerificadorVU() {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ estado: "atencion", comp: "", texto: "" });
  useEffect(() => { rpc("fn_mnt_vida_util_cl").then(setFilas).catch(() => setFilas([])); }, []);
  const n = (e) => (filas || []).filter((x) => x.estado === e).length;
  const comps = [...new Set((filas || []).map((x) => x.componente))].sort();
  const vis = (filas || []).filter((x) => (f.estado === "atencion" ? ["supera", "alerta"].includes(x.estado) : !f.estado || x.estado === f.estado)
    && (!f.comp || x.componente === f.comp) && (!f.texto || `${x.patente} ${x.modelo} ${x.ceco || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c, e) => <div onClick={() => setF({ ...f, estado: f.estado === e ? "atencion" : e })} style={{ background: "#fff", border: `1px solid ${f.estado === e ? c : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 130px", cursor: "pointer" }}><div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div></div>;
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {kpi("Supera el límite", n("supera"), C.rojo, "supera")}{kpi("En alerta", n("alerta"), C.ambar, "alerta")}
        {kpi("En protocolo", n("en_protocolo"), C.navy, "en_protocolo")}{kpi("Ok", n("ok"), C.verde, "ok")}{kpi("Sin dato", n("sin_dato"), C.suave, "sin_dato")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select style={inp} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="atencion">Supera + en alerta</option>{Object.entries(VU_ESTADO).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}<option value="">Todos</option></select>
        <select style={inp} value={f.comp} onChange={(e) => setF({ ...f, comp: e.target.value })}><option value="">Todos los componentes</option>{comps.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input style={{ ...inp, minWidth: 220 }} placeholder="Patente, modelo o CECO" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <span style={{ fontSize: 12, color: C.tenue }}>Km desde el último cambio (historial) contra la vida útil del modelo. «Sin dato» = no hay cambio registrado con km. No crea solicitudes sola.</span>
      </div>
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Patente", "Modelo · CECO", "Componente", "Último cambio", "Km desde el cambio", "Vida útil", "Uso", "Estado"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={8} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Nada con este filtro.</td></tr>}
              {vis.map((x) => { const e = VU_ESTADO[x.estado] || [x.estado, C.fondo, C.suave]; return (
                <tr key={x.patente + x.componente}>
                  <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                  <td style={celda}>{x.modelo}<div style={{ color: C.tenue, fontSize: 12 }}>{x.ceco}</div></td>
                  <td style={celda}>{x.componente}</td>
                  <td style={celda}>{x.ultimo_fecha ? <>{fd(x.ultimo_fecha)} · {kmf(x.ultimo_km)} km<div style={{ color: C.tenue, fontSize: 12, maxWidth: 260 }}>{x.ultimo_detalle}</div></> : <span style={{ color: C.tenue }}>sin registro</span>}</td>
                  <td style={celda}>{x.regla_meses ? `${x.meses_desde ?? "—"} meses` : kmf(x.km_desde)}</td>
                  <td style={celda}>{x.regla_meses ? `${x.regla_meses} meses` : `${kmf(x.vida_km)} km`}</td>
                  <td style={celda}><BarraVU pct={x.pct} /></td>
                  <td style={celda}>{chip(e[0], e[1], e[2])}{x.solicitud_folio && <div style={{ color: C.tenue, fontSize: 12 }}>{x.solicitud_folio}</div>}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function VidaModeloMnt({ quien }) {
  const [v, setV] = useState(null);
  const [comps, setComps] = useState([]);
  const [nuevo, setNuevo] = useState({ modelo: "", componente: "", km: "", regla: "" });
  const [msg, setMsg] = useState("");
  const cargar = () => {
    api("ca_mnt_vida_util_cl?select=*&order=modelo,componente").then(setV).catch(() => setV([]));
    api("ca_mnt_componentes_cl?select=*&order=componente").then(setComps).catch(() => setComps([]));
  };
  useEffect(cargar, []);
  const guardar = async (modelo, componente, km, regla) => { setMsg(""); try { await rpc("fn_mnt_guardar_vida", { p_modelo: modelo, p_componente: componente, p_km: km === "" || km === null ? null : Number(km), p_regla: regla || null, p_por: quien }); cargar(); setNuevo({ modelo: "", componente: "", km: "", regla: "" }); } catch (e) { setMsg(e.message); } };
  const guardarPatron = async (c, patron) => { setMsg(""); try { await rpc("fn_mnt_guardar_componente", { p_componente: c, p_patron: patron, p_por: quien }); cargar(); } catch (e) { setMsg(e.message); } };
  const modelos = [...new Set((v || []).map((x) => x.modelo))];
  const compsUsados = [...new Set((v || []).map((x) => x.componente))];
  return (
    <div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto", marginBottom: 14 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 700 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}><th style={{ padding: "8px 10px", color: C.suave, fontSize: 12 }}>Modelo</th>{compsUsados.map((c) => <th key={c} style={{ padding: "8px 10px", color: C.suave, fontSize: 12 }}>{c}</th>)}</tr></thead>
          <tbody>{modelos.map((m) => (
            <tr key={m} style={{ borderTop: `1px solid ${C.borde}` }}>
              <td style={{ padding: "6px 10px", fontWeight: 700 }}>{m}</td>
              {compsUsados.map((c) => { const x = (v || []).find((y) => y.modelo === m && y.componente === c); return (
                <td key={c} style={{ padding: "6px 8px" }}><input style={{ ...inp, width: 100 }} defaultValue={x ? (x.km ?? x.regla ?? "") : ""} placeholder="—"
                  onBlur={(e) => { const val = e.target.value.trim(); const antes = x ? String(x.km ?? x.regla ?? "") : ""; if (val === antes || val === "") return; /^\d+$/.test(val) ? guardar(m, c, val, null) : guardar(m, c, null, val); }} /></td>
              ); })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
        <label style={{ fontSize: 12, color: C.suave }}>Modelo<input style={{ ...inp, width: 220 }} value={nuevo.modelo} onChange={(e) => setNuevo({ ...nuevo, modelo: e.target.value })} /></label>
        <label style={{ fontSize: 12, color: C.suave }}>Componente<input list="vu-comps" style={{ ...inp, width: 180 }} value={nuevo.componente} onChange={(e) => setNuevo({ ...nuevo, componente: e.target.value })} /></label>
        <datalist id="vu-comps">{comps.map((c) => <option key={c.componente} value={c.componente} />)}</datalist>
        <label style={{ fontSize: 12, color: C.suave }}>Km de vida útil<input type="number" style={{ ...inp, width: 120 }} value={nuevo.km} onChange={(e) => setNuevo({ ...nuevo, km: e.target.value })} /></label>
        <label style={{ fontSize: 12, color: C.suave }}>o regla en meses<input style={{ ...inp, width: 110 }} placeholder="6 MESES" value={nuevo.regla} onChange={(e) => setNuevo({ ...nuevo, regla: e.target.value })} /></label>
        <button style={btn()} onClick={() => guardar(nuevo.modelo, nuevo.componente, nuevo.km, nuevo.regla)}>Agregar</button>
      </div>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Cómo se reconoce cada componente en el historial</div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 8 }}>Palabras que se buscan en el detalle de cada reparación o mantención, separadas por «|». Por ejemplo, FRENOS = FRENO|PASTILL|DISCO.</div>
      <table style={{ borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}` }}>
        <tbody>{comps.map((c) => (
          <tr key={c.componente} style={{ borderTop: `1px solid ${C.borde}` }}>
            <td style={{ padding: "6px 10px", fontWeight: 700 }}>{c.componente}</td>
            <td style={{ padding: "6px 8px" }}><input style={{ ...inp, width: 360 }} defaultValue={c.patron} onBlur={(e) => e.target.value !== c.patron && guardarPatron(c.componente, e.target.value)} /></td>
          </tr>
        ))}</tbody>
      </table>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

// ── Historial de gastos ─────────────────────────────────────────────────────
function HistorialGastos({ quien }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ desde: "", hasta: "", tipo: "", texto: "", sinOc: false });
  const [abierta, setAbierta] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [comps, setComps] = useState([]);
  const cargar = () => api("vw_gastos_cl?select=*&order=fecha.desc.nullslast&limit=5000").then(setFilas).catch(() => setFilas([]));
  useEffect(() => { cargar(); api("ca_mnt_componentes_cl?select=componente&order=componente").then((r) => setComps((r || []).map((x) => x.componente))).catch(() => {}); }, []);
  const todos = filas || [];
  const anio = new Date().getFullYear();
  const suma = (arr) => arr.reduce((t, x) => t + (Number(x.gasto) || 0), 0);
  const pct = (fn) => todos.length ? Math.round((todos.filter(fn).length / todos.length) * 100) : 0;
  const porAnioTipo = {}; for (const x of todos) { if (!x.anio) continue; porAnioTipo[x.anio] = porAnioTipo[x.anio] || {}; porAnioTipo[x.anio][x.tipo] = (porAnioTipo[x.anio][x.tipo] || 0) + (Number(x.gasto) || 0); }
  const top = (k) => Object.entries(todos.reduce((m, x) => { const c = x[k] || "—"; m[c] = (m[c] || 0) + (Number(x.gasto) || 0); return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const vis = todos.filter((x) => (!f.desde || x.fecha >= f.desde) && (!f.hasta || x.fecha <= f.hasta) && (!f.tipo || x.tipo === f.tipo) && (!f.sinOc || !x.oc)
    && (!f.texto || `${x.patente} ${x.taller || ""} ${x.detalle || ""} ${x.componente_std || ""} ${x.oc || ""} ${x.factura || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c = C.texto) => <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 140px" }}><div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div></div>;
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5, verticalAlign: "top" };
  const tablaTop = (t, arr) => (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12, flex: "1 1 260px" }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>{t}</div>
      {arr.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0", borderBottom: `1px solid ${C.fondo}` }}><span>{k}</span><b>{pesos(v)}</b></div>)}
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {kpi("Gasto total", pesos(suma(todos)), C.navy)}{kpi(`Gasto ${anio}`, pesos(suma(todos.filter((x) => x.anio === anio))), C.navy)}
        {kpi("Reparaciones", pesos(suma(todos.filter((x) => x.tipo === "reparacion"))))}{kpi("Mantenciones", pesos(suma(todos.filter((x) => x.tipo === "mantencion"))))}
        {kpi("% con OC", `${pct((x) => !!x.oc)}%`, C.ambar)}{kpi("% con factura", `${pct((x) => !!x.factura)}%`, C.ambar)}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12, flex: "2 1 420px", overflowX: "auto" }}>
          <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Gasto por año y tipo</div>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
            <thead><tr style={{ textAlign: "right", color: C.suave }}><th style={{ textAlign: "left" }}>Año</th>{Object.values(MN_TIPO).map((t) => <th key={t}>{t}</th>)}<th>Total</th></tr></thead>
            <tbody>{Object.keys(porAnioTipo).sort().reverse().map((y) => (
              <tr key={y} style={{ textAlign: "right", borderTop: `1px solid ${C.fondo}` }}><td style={{ textAlign: "left", fontWeight: 700 }}>{y}</td>
                {Object.keys(MN_TIPO).map((t) => <td key={t}>{porAnioTipo[y][t] ? pesos(porAnioTipo[y][t]) : "—"}</td>)}
                <td><b>{pesos(Object.values(porAnioTipo[y]).reduce((a, b) => a + b, 0))}</b></td></tr>
            ))}</tbody>
          </table>
        </div>
        {tablaTop("Por patente (top 10)", top("patente"))}
        {tablaTop("Por taller (top 10)", top("taller"))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input type="date" style={inp} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} title="Desde" />
        <input type="date" style={inp} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} title="Hasta" />
        <select style={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos los ítems</option>{Object.entries(MN_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input style={{ ...inp, minWidth: 220 }} placeholder="Patente, taller, detalle, OC o factura" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <label style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={f.sinOc} onChange={(e) => setF({ ...f, sinOc: e.target.checked })} /> Solo sin OC</label>
        <button style={btn()} onClick={() => setNuevo(!nuevo)}>{nuevo ? "Cerrar" : "+ Registrar gasto"}</button>
        <span style={{ fontSize: 12.5, color: C.suave }}>{vis.length} registros · {pesos(suma(vis))}</span>
      </div>
      {nuevo && <FormGasto comps={comps} quien={quien} onListo={() => { setNuevo(false); cargar(); }} />}
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Fecha", "Patente", "Ítem", "Componente / pauta", "Detalle", "Taller", "Costo", "Días", "OC", "Factura"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>
              {vis.slice(0, 500).map((x) => [
                <tr key={x.id} style={{ cursor: "pointer", background: abierta === x.id ? "#fafbfd" : "#fff" }} onClick={() => setAbierta(abierta === x.id ? null : x.id)}>
                  <td style={celda}>{fd(x.fecha)}</td><td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                  <td style={celda}>{MN_TIPO[x.tipo] || x.tipo}</td>
                  <td style={celda}>{x.tipo === "mantencion" ? (x.pauta_km ? `Pauta ${kmf(x.pauta_km)}${x.tipo_mantencion ? ` · ${x.tipo_mantencion}` : ""}` : "—") : x.componente_std || "—"}</td>
                  <td style={{ ...celda, maxWidth: 260 }}>{x.detalle || "—"}</td><td style={celda}>{x.taller || "—"}</td>
                  <td style={celda}>{pesos(x.gasto)}{x.tipo === "siniestro" && Number(x.costo_total) > Number(x.gasto) && <div style={{ color: C.tenue, fontSize: 11.5 }}>total {pesos(x.costo_total)}</div>}</td>
                  <td style={celda}>{x.dias_taller ?? "—"}</td>
                  <td style={celda}>{x.oc || <span style={{ color: C.tenue }}>—</span>}</td><td style={celda}>{x.factura || <span style={{ color: C.tenue }}>—</span>}</td>
                </tr>,
                abierta === x.id && <tr key={x.id + "e"}><td colSpan={10} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><EditarGasto g={x} comps={comps} quien={quien} onListo={() => { setAbierta(null); cargar(); }} /></td></tr>,
              ])}
            </tbody>
          </table>
          {vis.length > 500 && <div style={{ padding: 10, fontSize: 12.5, color: C.tenue }}>Se muestran los 500 más recientes de {vis.length}. Filtra por fecha o patente para ver el resto.</div>}
        </div>
      )}
    </div>
  );
}
function FormGasto({ comps, quien, onListo }) {
  const [d, setD] = useState({ tipo: "reparacion", patente: "", fecha: hoyCL(), km: "", pauta_km: "", tipo_mantencion: "completa", componente: "", accion: "", detalle: "", taller: "", costo: "", dias_taller: "", responsable: "BIGTICKET", ot: "", factura: "", factura_fecha: "", pago_fecha: "", asignar_oc: true });
  const [msg, setMsg] = useState("");
  const guardar = async () => {
    setMsg(""); const o = {}; for (const [k, v] of Object.entries(d)) o[k] = v === "" ? null : v;
    try { await rpc("fn_gasto_registrar", { p_datos: o, p_por: quien }); onListo(); } catch (e) { setMsg(e.message); }
  };
  const campo = (k, t, props = {}) => <label style={{ fontSize: 12, color: C.suave }}>{t}<input style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...props} /></label>;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 10 }}>Registrar gasto</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <label style={{ fontSize: 12, color: C.suave }}>Ítem<select style={{ ...inp, width: "100%" }} value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value })}>{Object.entries(MN_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {campo("patente", "Patente", { onChange: (e) => setD({ ...d, patente: e.target.value.toUpperCase() }) })}
        {campo("fecha", "Fecha de servicio", { type: "date", max: hoyCL() })}
        {campo("km", "Km (vacío = Geotab)", { type: "number" })}
        {d.tipo === "mantencion" && <>{campo("pauta_km", "Pauta (km)", { type: "number" })}
          <label style={{ fontSize: 12, color: C.suave }}>Tipo<select style={{ ...inp, width: "100%" }} value={d.tipo_mantencion} onChange={(e) => setD({ ...d, tipo_mantencion: e.target.value })}><option value="completa">Completa</option><option value="media">Media</option></select></label></>}
        {d.tipo === "reparacion" && <>
          <label style={{ fontSize: 12, color: C.suave }}>Componente<select style={{ ...inp, width: "100%" }} value={d.componente} onChange={(e) => setD({ ...d, componente: e.target.value })}><option value="">Elige…</option>{[...comps, "OTROS"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          {campo("accion", "Acción (cambio, reparación…)")}</>}
        {campo("taller", "Taller")}{campo("costo", "Costo ($)", { type: "number" })}{campo("dias_taller", "Días en taller", { type: "number" })}
        <label style={{ fontSize: 12, color: C.suave }}>Paga<select style={{ ...inp, width: "100%" }} value={d.responsable} onChange={(e) => setD({ ...d, responsable: e.target.value })}><option value="BIGTICKET">BigTicket</option><option value="TERCERO">Tercero</option><option value="SEGURO">Seguro</option></select></label>
        {campo("ot", "OT")}{campo("factura", "Factura")}{campo("factura_fecha", "Fecha factura", { type: "date" })}{campo("pago_fecha", "Fecha de pago", { type: "date" })}
      </div>
      <div style={{ marginTop: 10 }}>{campo("detalle", "Detalle")}</div>
      <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}><input type="checkbox" checked={d.asignar_oc} onChange={(e) => setD({ ...d, asignar_oc: e.target.checked })} /> Asignar OC del Brain (correlativo OC-CL-…)</label>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ marginTop: 10 }}><button style={btn()} onClick={guardar}>Registrar</button></div>
    </div>
  );
}
function EditarGasto({ g, comps, quien, onListo }) {
  const [d, setD] = useState({ componente: g.componente || "", accion: g.accion || "", ot: g.ot || "", oc: g.oc || "", factura: g.factura || "", factura_fecha: g.factura_fecha || "", pago_fecha: g.pago_fecha || "" });
  const [msg, setMsg] = useState("");
  const guardar = async (asignar) => {
    setMsg(""); const o = {}; for (const [k, v] of Object.entries(d)) o[k] = v === "" ? null : v; if (asignar) o.asignar_oc = true;
    try { const r = await rpc("fn_gasto_actualizar", { p_id: g.id, p_datos: o, p_por: quien }); if (asignar) alert(`OC asignada: ${r}`); onListo(); } catch (e) { setMsg(e.message); }
  };
  const campo = (k, t, props = {}) => <label style={{ fontSize: 12, color: C.suave }}>{t}<input style={{ ...inp, width: "100%" }} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...props} /></label>;
  return (
    <div style={{ padding: 12, background: "#fafbfd" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {g.tipo === "reparacion" && <label style={{ fontSize: 12, color: C.suave }}>Componente<select style={{ ...inp, width: "100%" }} value={d.componente || g.componente_std || ""} onChange={(e) => setD({ ...d, componente: e.target.value })}><option value="">—</option>{[...comps, "OTROS"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>}
        {g.tipo === "reparacion" && campo("accion", "Acción")}
        {campo("ot", "OT")}{campo("oc", "OC")}{campo("factura", "Factura")}{campo("factura_fecha", "Fecha factura", { type: "date" })}{campo("pago_fecha", "Fecha de pago", { type: "date" })}
      </div>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 6 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button style={btn()} onClick={() => guardar(false)}>Guardar</button>
        {!g.oc && <button style={btn("sec")} onClick={() => guardar(true)}>Asignar OC del Brain</button>}
        <span style={{ fontSize: 12, color: C.tenue }}>Origen: {g.fuente}{g.editado_por ? ` · editado por ${g.editado_por}` : ""}</span>
      </div>
    </div>
  );
}

// ── Centro de alertas ───────────────────────────────────────────────────────
const AL_GRAV = { alta: ["Alta", C.rojoT, C.rojo], media: ["Media", C.ambarT, C.ambar], baja: ["Baja", C.fondo, C.suave] };
function CentroAlertas({ quien, rol }) {
  const [vista, setVista] = useState("bandeja");
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["bandeja", "Bandeja"], ["envios", "Envíos por correo"], ["reglas", "Reglas"]].map(([k, t]) => <button key={k} style={btn(vista === k ? undefined : "sec")} onClick={() => setVista(k)}>{t}</button>)}
      </div>
      {vista === "bandeja" ? <BandejaAlertas /> : vista === "envios" ? <EnviosAlertas /> : <ReglasAlertas quien={quien} puede={rol === "superadmin"} />}
    </div>
  );
}
function BandejaAlertas() {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ modulo: "", grav: "", texto: "" });
  const [hora, setHora] = useState(null);
  const cargar = () => rpc("fn_alertas_cl").then((r) => { setFilas(r || []); setHora(new Date()); }).catch(() => setFilas([]));
  useEffect(() => { cargar(); const i = setInterval(cargar, 300000); return () => clearInterval(i); }, []);
  const ord = { alta: 0, media: 1, baja: 2 };
  const mods = [...new Set((filas || []).map((x) => x.modulo))];
  const vis = (filas || []).filter((x) => (!f.modulo || x.modulo === f.modulo) && (!f.grav || x.gravedad === f.grav)
    && (!f.texto || `${x.patente} ${x.titulo} ${x.detalle || ""}`.toLowerCase().includes(f.texto.toLowerCase())))
    .sort((a, b) => (ord[a.gravedad] - ord[b.gravedad]) || String(a.modulo).localeCompare(String(b.modulo)) || String(a.patente).localeCompare(String(b.patente)));
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {["alta", "media", "baja"].map((g) => { const e = AL_GRAV[g]; const n = (filas || []).filter((x) => x.gravedad === g).length; return (
          <div key={g} onClick={() => setF({ ...f, grav: f.grav === g ? "" : g })} style={{ background: "#fff", border: `1px solid ${f.grav === g ? e[2] : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 120px", cursor: "pointer" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: e[2] }}>{n}</div><div style={{ fontSize: 12.5, color: C.suave }}>Gravedad {e[0].toLowerCase()}</div>
          </div>); })}
        {mods.map((m) => { const n = (filas || []).filter((x) => x.modulo === m).length; return (
          <div key={m} onClick={() => setF({ ...f, modulo: f.modulo === m ? "" : m })} style={{ background: "#fff", border: `1px solid ${f.modulo === m ? C.navy : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 120px", cursor: "pointer" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.navy }}>{n}</div><div style={{ fontSize: 12.5, color: C.suave }}>{m}</div>
          </div>); })}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input style={{ ...inp, minWidth: 240 }} placeholder="Patente o texto" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn("sec")} onClick={cargar}>Actualizar</button>
        <span style={{ fontSize: 12, color: C.tenue }}>{hora ? `Calculado a las ${hora.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}` : ""} · se recalcula cada 5 min · todavía no se envían correos ni WhatsApp</span>
      </div>
      {filas === null ? <div style={{ color: C.tenue }}>Calculando alertas…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Gravedad", "Módulo", "Patente", "Alerta", "Detalle", "Avisa a", "Dónde se gestiona"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={7} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Sin alertas con este filtro.</td></tr>}
              {vis.map((x, i) => { const e = AL_GRAV[x.gravedad] || [x.gravedad, C.fondo, C.suave]; return (
                <tr key={i}>
                  <td style={celda}>{chip(e[0], e[1], e[2])}</td><td style={celda}>{x.modulo}</td>
                  <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente || "—"}</td>
                  <td style={{ ...celda, fontWeight: 700 }}>{x.titulo}</td><td style={{ ...celda, color: C.suave }}>{x.detalle || "—"}</td>
                  <td style={celda}>{x.avisa_a}</td><td style={{ ...celda, color: C.navy }}>{x.donde}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function EnviosAlertas() {
  const [cfg, setCfg] = useState({});
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const cargar = () => {
    api("ca_config_cl?clave=in.(resumen_diario,resumen_hora,resumen_jefes,correo_modo,correo_prueba,correo_ejecutivo,correo_jefatura,esc_activo,esc_n3_horas,esc_criticos,resumen_programados,resumen_sem_dia,resumen_sem_hora,resumen_operaciones,correo_finanzas)&select=clave,valor")
      .then((r) => setCfg(Object.fromEntries((r || []).map((x) => [x.clave, x.valor])))).catch(() => {});
    api("ca_resumenes_cl?select=*&order=enviado_at.desc&limit=60").then(setLog).catch(() => setLog([]));
    api("ca_escalamientos_cl?select=*&order=enviado_at.desc&limit=100").then(setEsc).catch(() => setEsc([]));
  };
  const [esc, setEsc] = useState(null);
  const enviarProg = async (tipo, nombre) => {
    if (!window.confirm(`Enviar ahora el resumen «${nombre}».\n\nModo de correos: ${cfg.correo_modo || "prueba"}. ¿Seguir?`)) return;
    setBusy(true);
    try { const r = await rpc("fn_ca_resumenes_programados", { p_tipo: tipo }); alert((r?.enviados || []).length ? `Enviado (modo ${r?.modo}).` : "No había nada que enviar."); cargar(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const DIAS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const escalar = async () => {
    if (!window.confirm(`Revisar ahora las tareas sin resolver y enviar el escalamiento.\n\nModo de correos: ${cfg.correo_modo || "prueba"}. Cada tarea se escala una sola vez por nivel. ¿Seguir?`)) return;
    setBusy(true);
    try { const r = await rpc("fn_ca_escalar", { p_forzar: true }); alert(`Listo: nivel 2 (ejecutivo) ${r?.nivel2 ?? 0} tareas · nivel 3 (jefatura) ${r?.nivel3 ?? 0} tareas.`); cargar(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  useEffect(cargar, []);
  const probar = async () => {
    if (!window.confirm(`Enviar el resumen del día ahora.\n\nModo de correos: ${cfg.correo_modo || "prueba"}${(cfg.correo_modo || "prueba") !== "activo" ? ` → todo llega solo a ${cfg.correo_prueba || "correo_prueba"}` : " → ¡llega a los destinatarios reales!"}\n\n¿Seguir?`)) return;
    setBusy(true);
    try { const r = await rpc("fn_ca_resumen_diario", { p_forzar: true }); alert(`Listo: ${r?.correos ?? 0} correos (modo ${r?.modo}).`); cargar(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const fila = (k, v) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.fondo}` }}><span style={{ color: C.suave }}>{k}</span><b>{v || "—"}</b></div>;
  const prueba = (cfg.correo_modo || "prueba") !== "activo";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 8 }}>Resumen diario de la flota</div>
        <div style={{ background: prueba ? C.ambarT : C.rojoT, color: prueba ? C.ambar : C.rojo, borderRadius: 8, padding: "8px 10px", fontSize: 12.5, marginBottom: 8 }}>
          {prueba ? `Modo de correos: PRUEBA. Todo llega solo a ${cfg.correo_prueba || "correo_prueba"}.` : "Modo de correos: ACTIVO. Los correos llegan a los destinatarios reales."}
        </div>
        {fila("Envío automático", cfg.resumen_diario === "activo" ? "Activo" : "Apagado")}
        {fila("Hora de envío", cfg.resumen_hora)}
        {fila("Ejecutivo", cfg.correo_ejecutivo)}{fila("Jefatura", cfg.correo_jefatura)}{fila("Jefes de operaciones", cfg.resumen_jefes)}
        {fila("Supervisores", "cada uno con sus CECO (Supervisores)")}
        <div style={{ fontSize: 12, color: C.tenue, margin: "8px 0" }}>Se cambia en Configuración: resumen_diario, resumen_hora y resumen_jefes. Contenido: uso del día contra la meta, no salidas sin motivo, en domicilio con viaje, GPS sin señal, la lista de vehículos a revisar y las alertas de gravedad alta.</div>
        <button style={btn()} disabled={busy} onClick={probar}>{busy ? "Enviando…" : "Enviar resumen ahora"}</button>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 8 }}>Escalamiento de tareas sin resolver</div>
        {fila("Envío automático", cfg.esc_activo === "activo" ? "Activo (cada hora)" : "Apagado")}
        {fila("Nivel 1", "Supervisor (la tarea)")}
        {fila("Nivel 2 · vencido el SLA", cfg.correo_ejecutivo)}
        {fila(`Nivel 3 · ${cfg.esc_n3_horas || 24} h después o crítico`, cfg.correo_jefatura)}
        {fila("Tipos críticos", cfg.esc_criticos)}
        <div style={{ fontSize: 12, color: C.tenue, margin: "8px 0" }}>Una tarea sin respuesta ni veredicto, con el plazo vencido, se escala una sola vez por nivel. Se cambia en Configuración: esc_activo, esc_n3_horas y esc_criticos.</div>
        <button style={btn("sec")} disabled={busy} onClick={escalar}>Revisar y escalar ahora</button>
        {esc && esc.length > 0 && <div style={{ fontSize: 12, color: C.suave, marginTop: 8 }}>Escaladas: nivel 2 · {esc.filter((x) => x.nivel === 2).length} tareas · nivel 3 · {esc.filter((x) => x.nivel === 3).length} tareas · última {fh(esc[0].enviado_at)}</div>}
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 8 }}>Resúmenes programados</div>
        {fila("Envío automático", cfg.resumen_programados === "activo" ? `Activo · ${DIAS[Number(cfg.resumen_sem_dia) || 1]} ${cfg.resumen_sem_hora || ""}` : "Apagado")}
        {fila("Operaciones (documentos)", cfg.resumen_operaciones)}{fila("Finanzas (renovación masiva)", cfg.correo_finanzas)}
        {[["documentos", "Documentos vencidos y por vencer", "semanal · ejecutivo, jefatura y Operaciones"], ["masiva", "Renovación masiva (60 días)", "semanal, solo si hay muchos vencimientos · Finanzas"],
          ["siniestros", "Siniestros abiertos", "semanal · ejecutivo y jefatura"], ["auditorias", "Cumplimiento de auditorías del mes anterior", "mensual, día 1 · ejecutivo y jefatura"]].map(([k, t, d]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.fondo}` }}>
            <span style={{ fontSize: 13 }}><b>{t}</b><div style={{ fontSize: 11.5, color: C.tenue }}>{d}</div></span>
            <button style={btn("sec")} disabled={busy} onClick={() => enviarProg(k, t)}>Enviar ahora</button>
          </div>
        ))}
        <div style={{ fontSize: 12, color: C.tenue, marginTop: 8 }}>Se cambia en Configuración: resumen_programados, resumen_sem_dia, resumen_sem_hora, resumen_operaciones, correo_finanzas, doc_masiva_dias y doc_masiva_min.</div>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 8 }}>Últimos envíos</div>
        {log === null ? <div style={{ color: C.tenue }}>Cargando…</div> : log.length === 0 ? <div style={{ color: C.tenue, fontSize: 13 }}>Todavía no se envía ningún resumen.</div> :
          log.map((x) => <div key={x.id} style={{ fontSize: 12.5, padding: "4px 0", borderBottom: `1px solid ${C.fondo}` }}>
            <b>{fh(x.enviado_at)}</b> · {({ flota_diario: "Flota diario", flota_diario_sup: "Flota supervisor", documentos: "Documentos", masiva: "Renovación masiva", siniestros: "Siniestros", auditorias: "Auditorías" })[x.tipo] || x.tipo} · {x.destinatario} · {x.ok ? <span style={{ color: C.verde }}>enviado</span> : <span style={{ color: C.rojo }}>no enviado</span>}
            {x.detalle && String(x.tipo).startsWith("flota") && <span style={{ color: C.tenue }}> · uso {x.detalle.uso ?? "—"}% · {x.detalle.no_salidas} sin motivo · {x.detalle.alertas_altas} alertas altas</span>}
          </div>)}
      </div>
    </div>
  );
}

function ReglasAlertas({ quien, puede }) {
  const [r, setR] = useState(null);
  const [msg, setMsg] = useState("");
  const cargar = () => api("ca_alertas_reglas_cl?select=*&order=orden").then(setR).catch(() => setR([]));
  useEffect(() => { cargar(); }, []);
  const guardar = async (codigo, campo, valor) => { setMsg(""); try { await rpc("fn_alerta_regla_guardar", { p_codigo: codigo, p_campo: campo, p_valor: valor, p_por: quien }); if (campo === "activo") cargar(); } catch (e) { setMsg(e.message); } };
  const ed = (x, k, w) => puede ? <input style={{ ...inp, width: w }} defaultValue={x[k] || ""} onBlur={(e) => e.target.value !== (x[k] || "") && guardar(x.codigo, k, e.target.value)} /> : (x[k] || "—");
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>Las 21 reglas de Adriana. {puede ? "Puedes editarlas (eres Superadmin); cada cambio queda en el historial." : "Solo un Superadmin puede editarlas."} Las marcadas «Próximamente» dependen de módulos que todavía no existen (uso y detenciones, cámaras, combustible).</div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1100 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Módulo", "Regla", "Umbral", "Avisa a", "Canal", "SLA", "Si no se resuelve", "Estado", "Activa"].map((h) => <th key={h} style={{ padding: "8px 10px", color: C.suave }}>{h}</th>)}</tr></thead>
          <tbody>{(r || []).map((x) => (
            <tr key={x.codigo} style={{ borderTop: `1px solid ${C.borde}`, opacity: x.activo ? 1 : 0.5 }}>
              <td style={{ padding: "6px 10px" }}>{x.modulo}</td><td style={{ padding: "6px 10px", fontWeight: 700 }}>{x.regla}</td>
              <td style={{ padding: "6px 8px" }}>{ed(x, "umbral", 150)}</td><td style={{ padding: "6px 8px" }}>{ed(x, "avisa_a", 150)}</td>
              <td style={{ padding: "6px 8px" }}>{ed(x, "canal", 120)}</td><td style={{ padding: "6px 8px" }}>{ed(x, "sla", 70)}</td><td style={{ padding: "6px 8px" }}>{ed(x, "escalamiento", 150)}</td>
              <td style={{ padding: "6px 10px" }}>{x.implementada ? chip("En la bandeja", C.verdeT, C.verde) : chip("Próximamente", C.fondo, C.tenue)}</td>
              <td style={{ padding: "6px 10px" }}><input type="checkbox" disabled={!puede} checked={!!x.activo} onChange={(e) => guardar(x.codigo, "activo", String(e.target.checked))} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {msg && <div style={{ color: C.rojo, fontSize: 13, marginTop: 8 }}>{msg}</div>}
      <div style={{ fontSize: 12, color: C.tenue, marginTop: 8 }}>El umbral real de cada cálculo sigue en Configuración (por ejemplo, km de aviso de mantención o días de «por vencer»). Aquí queda la definición de la regla, a quién avisa y por qué canal.</div>
    </div>
  );
}

// ── Uso y detenciones ───────────────────────────────────────────────────────
const UZ = { calle: ["Calle", C.ambarT, C.ambar], bodega: ["Bodega", C.fondo, C.suave], estacionamiento: ["Su estacionamiento", C.fondo, C.suave] };
const UC = {
  sin_respaldo: ["Sin respaldo", C.rojoT, C.rojo], entrega_con_exceso: ["Entrega con exceso", C.ambarT, C.ambar],
  entrega: ["Entrega", C.verdeT, C.verde], interrupcion: ["Interrupción registrada", C.verdeT, C.verde], interrupcion_excedida: ["Interrupción excedida", C.ambarT, C.ambar],
  aviso_pendiente: ["Aviso por revisar del supervisor", "#eef2f8", C.navy],
  fuera_de_ruta: ["Fuera de ruta", "#eef2f8", C.navy], operativa: ["Operativa", C.fondo, C.suave],
};
function ReglasDetencion({ quien, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [cfg, setCfg] = useState([]);
  const [msg, setMsg] = useState("");
  const cargar = () => api("ca_config_cl?clave=like.det_*&clave=neq.det_tareas&select=clave,valor,descripcion&order=clave").then(setCfg).catch(() => setCfg([]));
  useEffect(() => { if (abierto) cargar(); }, [abierto]);
  const guardar = async (clave, valor) => {
    setMsg("");
    try { await rpc("fn_ca_mantenedor_guardar", { p_tabla: "ca_config_cl", p_clave: clave, p_campo: "valor", p_valor: String(valor), p_por: quien }); await cargar(); setMsg("Guardado. La clasificación se recalcula con el valor nuevo."); onCambio(); }
    catch (e) { setMsg(e.message); }
  };
  const nombre = { det_umbral_min: "Umbral de detención (min)", det_radio_m: "Radio de la entrega (m)", det_margen_min: "Margen de tiempo (min)", det_min_por_entrega: "Minutos por parada de MELI",
    det_espera_h: "Horas de espera antes de decidir", det_colacion_max_min: "Colación: máximo (min)", det_colacion_tras_h: "Colación: desde las N horas de ruta", det_bano_max_min: "Baño: máximo por pausa (min)", det_carga_max_min: "Carga eléctrica: máximo (min)" };
  return (
    <div style={{ marginBottom: 12 }}>
      <a href="#" style={{ color: C.navy, fontSize: 13, fontWeight: 700 }} onClick={(e) => { e.preventDefault(); setAbierto(!abierto); }}>{abierto ? "▾" : "▸"} Reglas del cruce (editables)</a>
      {abierto && (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12, marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
          {cfg.map((c) => (
            <label key={c.clave} style={{ fontSize: 12, color: C.suave }}>
              <b style={{ color: C.texto }}>{nombre[c.clave] || c.clave}</b>
              <input type="number" style={{ ...inp, width: "100%", marginTop: 4 }} defaultValue={c.valor} onBlur={(e) => e.target.value !== c.valor && guardar(c.clave, e.target.value)} />
              <div style={{ fontSize: 11.5, color: C.tenue, marginTop: 2 }}>{c.descripcion}</div>
            </label>
          ))}
          <div style={{ gridColumn: "1 / -1", fontSize: 12, color: msg.startsWith("Guardado") ? C.verde : msg ? C.rojo : C.tenue }}>{msg || "Cada cambio queda en el historial de Configuración. El umbral también define qué paradas guarda el programa de Geotab desde la próxima pasada."}</div>
        </div>
      )}
    </div>
  );
}
function TareasDetencion() {
  const [r, setR] = useState(null);
  const [activo, setActivo] = useState(null);
  useEffect(() => {
    rpc("fn_det_detectar", { p_crear: false }).then(setR).catch(() => setR([]));
    api("ca_config_cl?clave=eq.det_tareas&select=valor").then((x) => setActivo(x?.[0]?.valor === "activo")).catch(() => setActivo(false));
  }, []);
  if (r === null) return null;
  const nuevas = r.filter((x) => x.resultado === "se crearía");
  const hora = (s) => new Date(s).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{ background: activo ? C.verdeT : C.ambarT, border: `1px solid ${activo ? C.verde : C.ambar}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
      <b style={{ color: activo ? C.verde : C.ambar }}>{activo ? "Tareas al supervisor: ACTIVAS." : "Tareas al supervisor: APAGADAS (simulación)."}</b>{" "}
      {activo ? "Cada hora se crea la tarea «Detención no autorizada» de las paradas que siguen sin explicación 2 h después de terminar."
              : `Con el interruptor activo se crearían ${nuevas.length} tarea${nuevas.length === 1 ? "" : "s"} (de los últimos 3 días). Se activa en Configuración → det_tareas = activo.`}
      {nuevas.length > 0 && (
        <div style={{ marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
          {nuevas.map((x) => <div key={x.parada_id} style={{ fontSize: 12.5, color: C.texto, padding: "2px 0" }}><b>{x.patente}</b> · {hora(x.inicio)} · {x.minutos} min ({x.min_sin_explicar} sin explicar) · {(UC[x.clasificacion] || [x.clasificacion])[0]}{x.conductor ? ` · ${x.conductor}` : ""}{x.empresa ? ` · ${x.empresa}` : ""}</div>)}
        </div>
      )}
    </div>
  );
}
function UsoDetenciones({ quien }) {
  const [fecha, setFecha] = useState(hoyCL());
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ vista: "revisar", texto: "" });
  const [camAbierta, setCamAbierta] = useState(null);
  const [ia, setIa] = useState({});
  useEffect(() => {
    const ids = (filas || []).filter((x) => x.camara_eventos > 0).map((x) => `"${String(x.id).replace(/"/g, "")}"`);
    if (!ids.length) { setIa({}); return; }
    api(`gps_paradas_camara_ia_cl?select=*&parada_id=in.(${encodeURIComponent(ids.join(","))})`).then((r) => setIa(Object.fromEntries((r || []).map((x) => [x.parada_id, x])))).catch(() => setIa({}));
  }, [filas]);
  const cargar = () => {
    const d0 = new Date(`${fecha}T00:00:00-03:00`), d1 = new Date(d0.getTime() + 864e5);
    api(`vw_paradas_cl?select=*&inicio=gte.${d0.toISOString()}&inicio=lt.${d1.toISOString()}&order=inicio.desc&limit=3000`).then(setFilas).catch(() => setFilas([]));
  };
  useEffect(() => { setFilas(null); cargar(); }, [fecha]);   // eslint-disable-line react-hooks/exhaustive-deps
  const todos = filas || [];
  const n = (fn) => todos.filter(fn).length;
  const vis = todos.filter((x) => (f.vista === "revisar" ? ["sin_respaldo", "entrega_con_exceso", "interrupcion_excedida"].includes(x.clasificacion) : f.vista === "todas" ? true : x.clasificacion === f.vista)
    && (!f.texto || `${x.patente} ${x.conductor || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c, k) => <div onClick={() => setF({ ...f, vista: k })} style={{ background: "#fff", border: `1px solid ${f.vista === k ? c : C.borde}`, borderRadius: 12, padding: "12px 16px", flex: "1 1 130px", cursor: "pointer" }}><div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12.5, color: C.suave }}>{t}</div></div>;
  const celda = { padding: "8px 10px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  const hora = (s) => s ? new Date(s).toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <div>
      <div style={{ background: "#eef2f8", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: C.navy, marginBottom: 12 }}>
        Cada parada de 10 min o más de Geotab se cruza con las entregas y los intentos fallidos de MELI de esa patente y con las interrupciones (colación, baño, carga) que registra el transportista en su portal (a menos de 150 m y en la misma ventana de tiempo, editable en Configuración).
        <b> Sin respaldo</b> = en la calle, durante la ruta y sin ninguna entrega cerca. <b>Entrega con exceso</b> = hubo entrega, pero la parada duró bastante más de lo que la justifica. Las entregas de MELI llegan con 1 a 2 horas de atraso; por eso la decisión se toma 2 h después de terminada la parada.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {kpi("Para revisar", n((x) => ["sin_respaldo", "entrega_con_exceso", "interrupcion_excedida"].includes(x.clasificacion)), C.rojo, "revisar")}
        {kpi("Sin respaldo", n((x) => x.clasificacion === "sin_respaldo"), C.rojo, "sin_respaldo")}
        {kpi("Entrega con exceso", n((x) => x.clasificacion === "entrega_con_exceso"), C.ambar, "entrega_con_exceso")}
        {kpi("Interrupción excedida", n((x) => x.clasificacion === "interrupcion_excedida"), C.ambar, "interrupcion_excedida")}
        {kpi("Entregas", n((x) => x.clasificacion === "entrega"), C.verde, "entrega")}
        {kpi("Interrupciones registradas", n((x) => x.clasificacion === "interrupcion"), C.verde, "interrupcion")}
        {kpi("Avisos por revisar", n((x) => x.clasificacion === "aviso_pendiente"), C.navy, "aviso_pendiente")}
        {kpi("Fuera de ruta", n((x) => x.clasificacion === "fuera_de_ruta"), C.navy, "fuera_de_ruta")}
        {kpi("Operativas (bodega / estacionamiento)", n((x) => x.clasificacion === "operativa"), C.suave, "operativa")}
        {kpi("Todas", todos.length, C.texto, "todas")}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input type="date" style={inp} value={fecha} max={hoyCL()} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <input style={{ ...inp, minWidth: 220 }} placeholder="Patente o conductor" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn("sec")} onClick={cargar}>Actualizar</button>
        <span style={{ fontSize: 12, color: C.tenue }}>Paradas de Geotab cada 1 hora · entregas de MELI según el scraper de detalle</span>
      </div>
      <ReglasDetencion quien={quien} onCambio={cargar} />
      <TareasDetencion key={fecha} />
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Patente", "Desde – hasta", "Min", "Clasificación", "Entregas MELI cerca", "Interrupción", "Sin explicar", "Cámara", "Zona · ruta", "Conductor", "Mapa"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={11} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Sin paradas con este filtro.</td></tr>}
              {vis.map((x) => { const c = UC[x.clasificacion] || [x.clasificacion, C.fondo, C.suave]; const z = UZ[x.zona] || [x.zona]; return [
                <tr key={x.id}>
                  <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                  <td style={celda}>{hora(x.inicio)} – {x.en_curso ? <b style={{ color: C.ambar }}>en curso</b> : hora(x.fin)}</td>
                  <td style={{ ...celda, fontWeight: 700, color: x.minutos >= 45 ? C.rojo : C.texto }}>{x.minutos}</td>
                  <td style={celda}>{chip(c[0], c[1], c[2])}</td>
                  <td style={celda}>{x.paquetes || x.fallidos ? <>{x.paradas_meli} parada{x.paradas_meli === 1 ? "" : "s"} · {x.paquetes} paq.{x.fallidos ? ` · ${x.fallidos} fallido${x.fallidos === 1 ? "" : "s"}` : ""}<div style={{ color: C.tenue, fontSize: 12 }}>a {x.dist_min_m} m</div></> : <span style={{ color: C.tenue }}>—</span>}</td>
                  <td style={celda}>{x.interrupciones ? <>{String(x.interrupcion_tipos || "").replace("colacion", "colación").replace("bano", "baño")}<div style={{ color: C.tenue, fontSize: 12 }}>justifica {x.interrupcion_min} min</div>{x.colacion_temprana && <div style={{ color: C.ambar, fontSize: 12 }}>colación antes de las 4 h de ruta</div>}</> : <span style={{ color: C.tenue }}>—</span>}</td>
                  <td style={{ ...celda, fontWeight: 700, color: x.min_sin_explicar > 10 && x.clasificacion !== "operativa" ? C.rojo : C.suave }}>{x.clasificacion === "operativa" ? "—" : `${x.min_sin_explicar} min`}</td>
                  <td style={celda}>{x.camara_eventos ? <a href="#" style={{ color: x.camara_cubierta ? C.rojo : C.navy, fontWeight: 700 }} onClick={(e) => { e.preventDefault(); setCamAbierta(camAbierta === x.id ? null : x.id); }}>📹 {x.camara_eventos}{x.camara_cubierta ? " · cubierta" : ""}</a> : <span style={{ color: C.tenue }}>—</span>}
                    {x.camara_tipos && <div style={{ color: C.tenue, fontSize: 11.5 }}>{x.camara_tipos}</div>}
                    {ia[x.id]?.resumen && <div style={{ fontSize: 11.5, color: ia[x.id].camara_tapada || ia[x.id].posible_uso_personal ? C.rojo : C.suave, maxWidth: 220 }}>🤖 {ia[x.id].resumen}</div>}</td>
                  <td style={celda}>{z[0]}{x.zona_nombre ? ` · ${x.zona_nombre}` : ""}<div style={{ color: C.tenue, fontSize: 12 }}>{x.hora_inicio_ruta ? `ruta ${x.hora_inicio_ruta} – ${x.hora_fin_ruta || "en curso"}` : "sin ruta"}</div></td>
                  <td style={celda}>{x.conductor || "—"}</td>
                  <td style={celda}><a href={`https://maps.google.com/?q=${x.lat},${x.lng}`} target="_blank" rel="noreferrer" style={{ color: C.navy }}>🗺️ Ver</a></td>
                </tr>,
                camAbierta === x.id && (x.camara_detalle || []).length > 0 && <tr key={x.id + "c"}><td colSpan={11} style={{ padding: 12, background: "#fafbfd", borderBottom: `1px solid ${C.borde}` }}>
                  <div style={{ fontWeight: 800, color: C.navy, fontSize: 13, marginBottom: 8 }}>Cámara Fleetup · {x.patente} durante la parada</div>
                  {ia[x.id] && (ia[x.id].error ? <div style={{ fontSize: 12.5, color: C.tenue, marginBottom: 8 }}>Biggy no pudo revisar las imágenes: {ia[x.id].error}</div> : (
                    <div style={{ background: "#eef2f8", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, marginBottom: 8 }}>
                      <b>🤖 Biggy:</b> {ia[x.id].resumen}
                      <div style={{ color: C.suave, marginTop: 2 }}>Conductor visible: {ia[x.id].conductor_visible || "—"} · Vehículo: {ia[x.id].vehiculo || "—"} · Lugar: {ia[x.id].lugar || "—"}
                        {ia[x.id].camara_tapada ? " · CÁMARA TAPADA" : ""}{ia[x.id].posible_uso_personal ? " · posible uso personal" : ""} · confianza {ia[x.id].confianza || "—"} · {ia[x.id].imagenes} imágenes</div>
                      <div style={{ color: C.tenue, fontSize: 11.5, marginTop: 2 }}>Biggy describe lo que se ve; la decisión es del supervisor y de Cuidado de Activo.</div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {x.camara_detalle.map((ev, i) => (
                      <div key={i} style={{ background: "#fff", border: `1px solid ${ev.cubierta ? C.rojo : C.borde}`, borderRadius: 10, padding: 8, width: 220, fontSize: 12.5 }}>
                        {ev.miniatura && <img src={ev.miniatura} alt="" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, background: C.fondo }} />}
                        <div style={{ fontWeight: 700, marginTop: 4 }}>{ev.tipo || "Evento"}{ev.cubierta ? " · cámara cubierta" : ""}</div>
                        <div style={{ color: C.tenue }}>{hora(ev.hora)}{ev.riesgo ? ` · riesgo ${ev.riesgo}` : ""}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          {ev.video_exterior && <a href={ev.video_exterior} target="_blank" rel="noreferrer" style={{ color: C.navy }}>▶ Exterior</a>}
                          {ev.video_interior && <a href={ev.video_interior} target="_blank" rel="noreferrer" style={{ color: C.navy }}>▶ Interior</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                </td></tr>,
              ]; })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Evaluación del ejecutivo (solo jefatura y Superadmin) ───────────────────
function EvaluacionEjecutivo({ usuario }) {
  const lunes = (d) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x.toISOString().slice(0, 10); };
  const mas = (s, n) => { const x = new Date(s + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const [desde, setDesde] = useState(mas(lunes(new Date()), -7));
  const [d, setD] = useState(null);
  const [acceso, setAcceso] = useState(null);
  const hasta = mas(desde, 6);
  useEffect(() => {
    api("ca_config_cl?clave=eq.correo_jefatura&select=valor").then((r) => {
      const jef = String(r?.[0]?.valor || "").toLowerCase();
      setAcceso(usuario?.rol === "superadmin" || (!!jef && String(usuario?.email || "").toLowerCase() === jef));
    }).catch(() => setAcceso(usuario?.rol === "superadmin"));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (acceso) { setD(null); rpc("fn_eval_ejecutivo", { p_desde: desde, p_hasta: hasta }).then(setD).catch((e) => setD({ error: e.message })); } }, [acceso, desde]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (acceso === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  if (!acceso) return <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 16, color: C.suave }}>Esta pestaña es solo para jefatura y Superadmin.</div>;
  const cumple = (x) => {
    if (x.valor === null || x.valor === undefined || x.meta === null || x.meta === undefined || x.meta === "") return null;
    return x.sentido === "menor" ? Number(x.valor) <= Number(x.meta) : Number(x.valor) >= Number(x.meta);
  };
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5 };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <button style={btn("sec")} onClick={() => setDesde(mas(desde, -7))}>‹ Semana anterior</button>
        <b style={{ color: C.navy }}>Semana del {fd(desde)} al {fd(hasta)}</b>
        <button style={btn("sec")} onClick={() => setDesde(mas(desde, 7))}>Semana siguiente ›</button>
        <span style={{ fontSize: 12, color: C.tenue }}>Metas editables en Configuración (eval_meta_*). Los indicadores marcados «hoy» muestran la foto actual.</span>
      </div>
      {!d ? <div style={{ color: C.tenue }}>Calculando…</div> : d.error ? <div style={{ color: C.rojo }}>{d.error}</div> : <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 16 }}>
          {(d.indicadores || []).map((x) => { const c = cumple(x); return (
            <div key={x.clave} style={{ background: "#fff", border: `1px solid ${c === false ? C.rojo : c ? C.verde : C.borde}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 12.5, color: C.suave, fontWeight: 700 }}>{x.nombre}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: c === false ? C.rojo : c ? C.verde : C.navy }}>{x.valor === null || x.valor === undefined ? "—" : `${x.valor}${x.unidad ? ` ${x.unidad}` : ""}`}</div>
              <div style={{ fontSize: 12, color: C.tenue }}>{x.meta !== null && x.meta !== undefined && x.meta !== "" ? `Meta ${x.sentido === "menor" ? "≤" : "≥"} ${x.meta}${x.unidad ? ` ${x.unidad}` : ""} · ` : ""}{x.detalle}</div>
            </div>
          ); })}
        </div>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Alertas de la semana y tiempo de reacción</div>
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Alerta", "Patente", "Aviso", "Gestión", "Reacción", "Resultado"].map((h) => <th key={h} style={{ ...celda, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>
              {(d.reaccion || []).length === 0 && <tr><td colSpan={6} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Sin alertas en esta semana.</td></tr>}
              {(d.reaccion || []).map((x, i) => (
                <tr key={i}>
                  <td style={celda}>{x.alerta}</td><td style={{ ...celda, fontWeight: 700 }}>{x.patente || "—"}</td>
                  <td style={celda}>{fh(x.aviso)}</td><td style={celda}>{x.gestion ? fh(x.gestion) : <span style={{ color: C.ambar }}>pendiente</span>}</td>
                  <td style={{ ...celda, fontWeight: 700, color: Number(x.horas) > 24 ? C.rojo : C.texto }}>{x.horas} h</td><td style={celda}>{x.resultado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}

// ── Avance del pedido (documento de Adriana del 12-nov-2026) ────────────────
const PED_EST = { hecho: ["Hecho", C.verdeT, C.verde], en_curso: ["En curso", "#eef2f8", C.navy], pendiente: ["Pendiente", C.fondo, C.suave], bloqueado: ["Bloqueado", C.ambarT, C.ambar] };
function AvancePedido({ quien, rol }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ estado: "", seccion: "", texto: "" });
  const [editando, setEditando] = useState(null);
  const puede = rol === "superadmin";
  const cargar = () => api("ca_pedido_cl?select=*&order=orden").then(setFilas).catch(() => setFilas([]));
  useEffect(() => { cargar(); }, []);
  const guardar = async (x, estado, nota) => {
    try { await rpc("fn_pedido_actualizar", { p_codigo: x.codigo, p_estado: estado, p_nota: nota, p_por: quien }); setEditando(null); cargar(); } catch (e) { alert(e.message); }
  };
  if (filas === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const n = (e) => filas.filter((x) => x.estado === e).length;
  const pct = filas.length ? Math.round((n("hecho") * 100) / filas.length) : 0;
  const secciones = [...new Set(filas.map((x) => x.seccion))];
  const vis = filas.filter((x) => (!f.estado || x.estado === f.estado) && (!f.seccion || x.seccion === f.seccion)
    && (!f.texto || `${x.codigo} ${x.titulo} ${x.nota || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
          <div style={{ fontWeight: 800, color: C.navy }}>Pedido de desarrollo de Cuidado de Activo · 12-11-2026</div>
          <div style={{ fontSize: 13, color: C.suave }}>{n("hecho")} de {filas.length} ítems hechos · {pct}%</div>
        </div>
        <div style={{ height: 10, background: C.fondo, borderRadius: 6, overflow: "hidden", marginTop: 8, display: "flex" }}>
          <div style={{ width: `${(n("hecho") * 100) / filas.length}%`, background: C.verde }} />
          <div style={{ width: `${(n("en_curso") * 100) / filas.length}%`, background: C.navy }} />
          <div style={{ width: `${(n("bloqueado") * 100) / filas.length}%`, background: C.ambar }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {Object.entries(PED_EST).map(([k, e]) => (
          <div key={k} onClick={() => setF({ ...f, estado: f.estado === k ? "" : k })} style={{ background: "#fff", border: `1px solid ${f.estado === k ? e[2] : C.borde}`, borderRadius: 12, padding: "10px 14px", flex: "1 1 120px", cursor: "pointer" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: e[2] }}>{n(k)}</div><div style={{ fontSize: 12.5, color: C.suave }}>{e[0]}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select style={inp} value={f.seccion} onChange={(e) => setF({ ...f, seccion: e.target.value })}><option value="">Todas las secciones</option>{secciones.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <input style={{ ...inp, minWidth: 240 }} placeholder="Código o texto" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <span style={{ fontSize: 12, color: C.tenue, alignSelf: "center" }}>{puede ? "Puedes cambiar el estado de cada ítem (queda con historial)." : "Solo lectura."}</span>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Código", "Sección", "Qué", "Estado", "Nota", "Actualizado"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
          <tbody>{vis.map((x) => { const e = PED_EST[x.estado] || [x.estado, C.fondo, C.suave]; return (
            <tr key={x.codigo}>
              <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.codigo}</td>
              <td style={{ ...celda, color: C.suave, fontSize: 12 }}>{x.seccion}</td>
              <td style={celda}>{x.titulo}</td>
              <td style={celda}>{editando === x.codigo ? (
                <select style={inp} defaultValue={x.estado} onChange={(ev) => guardar(x, ev.target.value, x.nota)}>{Object.entries(PED_EST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
              ) : <span onClick={() => puede && setEditando(x.codigo)} style={{ cursor: puede ? "pointer" : "default" }}>{chip(e[0], e[1], e[2])}</span>}</td>
              <td style={{ ...celda, color: C.suave }}>{puede && editando === x.codigo
                ? <input style={{ ...inp, width: "100%" }} defaultValue={x.nota || ""} onBlur={(ev) => ev.target.value !== (x.nota || "") && guardar(x, x.estado, ev.target.value)} />
                : (x.nota || "—")}</td>
              <td style={{ ...celda, fontSize: 12, color: C.tenue }}>{x.actualizado_por ? `${x.actualizado_por} · ` : ""}{fh(x.actualizado_at)}</td>
            </tr>
          ); })}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── GPS y cámaras (pedido F-02) ─────────────────────────────────────────────
const GPS_EST = { ok: ["Transmitiendo", C.verdeT, C.verde], caido: ["Caído (> 24 h)", C.ambarT, C.ambar], caido_escalar: ["Caído > 5 días", C.rojoT, C.rojo], sin_equipo: ["Sin equipo en Geotab", C.fondo, C.suave] };
const CAM_EST = { ok: ["Con eventos", C.verdeT, C.verde], cubierta: ["Cámara cubierta", C.rojoT, C.rojo], sin_eventos: ["Sin eventos 3 días", C.ambarT, C.ambar], sin_camara: ["Sin cámara", C.fondo, C.suave] };
function GpsCamaras({ quien }) {
  const [vista, setVista] = useState("equipos");
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["equipos", "Equipos"], ["caidos", "Equipos caídos"], ["eventos", "Eventos de cámara"], ["proveedores", "Proveedores"]].map(([k, t]) => <button key={k} style={btn(vista === k ? undefined : "sec")} onClick={() => setVista(k)}>{t}</button>)}
      </div>
      {vista === "equipos" ? <EquiposGps /> : vista === "caidos" ? <EquiposCaidos /> : vista === "proveedores" ? <Proveedores quien={quien} /> : <EventosCamara />}
    </div>
  );
}
function EquiposGps() {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ gps: "", cam: "", texto: "" });
  useEffect(() => { rpc("fn_gps_camaras_estado_cl").then(setFilas).catch(() => setFilas([])); }, []);
  if (filas === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const n = (k, v) => filas.filter((x) => x[k] === v).length;
  const vis = filas.filter((x) => (!f.gps || x.gps_estado === f.gps) && (!f.cam || x.cam_estado === f.cam) && (!f.texto || `${x.patente} ${x.ceco || ""} ${x.empresa || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const kpi = (t, v, c, k, val) => <div onClick={() => setF({ ...f, [k]: f[k] === val ? "" : val })} style={{ background: "#fff", border: `1px solid ${f[k] === val ? c : C.borde}`, borderRadius: 12, padding: "10px 14px", flex: "1 1 120px", cursor: "pointer" }}><div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12, color: C.suave }}>{t}</div></div>;
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 13, verticalAlign: "top" };
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 6 }}>GPS</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>{Object.entries(GPS_EST).map(([k, e]) => <span key={k} style={{ display: "contents" }}>{kpi(e[0], n("gps_estado", k), e[2], "gps", k)}</span>)}</div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 6 }}>Cámaras (Fleetup)</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>{Object.entries(CAM_EST).map(([k, e]) => <span key={k} style={{ display: "contents" }}>{kpi(e[0], n("cam_estado", k), e[2], "cam", k)}</span>)}</div>
      <input style={{ ...inp, minWidth: 240, marginBottom: 12 }} placeholder="Patente, CECO o empresa" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Patente", "CECO · empresa", "GPS", "Última señal", "Cámara", "Último evento", "Eventos hoy", "Riesgo alto hoy", "Cubierta (7 días)"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
          <tbody>{vis.map((x) => { const g = GPS_EST[x.gps_estado] || [x.gps_estado]; const c = CAM_EST[x.cam_estado] || [x.cam_estado]; return (
            <tr key={x.patente}>
              <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
              <td style={celda}>{x.ceco}<div style={{ color: C.tenue, fontSize: 12 }}>{x.empresa}</div></td>
              <td style={celda}>{chip(g[0], g[1], g[2])}</td>
              <td style={celda}>{x.gps_ultima ? fh(x.gps_ultima) : "—"}{x.gps_horas !== null && x.gps_horas >= 1 && <div style={{ color: C.tenue, fontSize: 12 }}>hace {x.gps_horas >= 48 ? `${Math.round(x.gps_horas / 24)} días` : `${Math.round(x.gps_horas)} h`}</div>}</td>
              <td style={celda}>{chip(c[0], c[1], c[2])}{x.camara && <div style={{ color: C.tenue, fontSize: 12 }}>{x.camara}</div>}</td>
              <td style={celda}>{x.cam_ultimo ? fh(x.cam_ultimo) : "—"}</td>
              <td style={celda}>{x.cam_eventos_hoy || "—"}</td>
              <td style={{ ...celda, fontWeight: 700, color: x.cam_riesgo_alto_hoy ? C.rojo : C.tenue }}>{x.cam_riesgo_alto_hoy || "—"}</td>
              <td style={{ ...celda, fontWeight: 700, color: x.cam_cubierta_7d ? C.rojo : C.tenue }}>{x.cam_cubierta_7d || "—"}</td>
            </tr>
          ); })}</tbody>
        </table>
      </div>
    </div>
  );
}
function EquiposCaidos() {
  const [filas, setFilas] = useState(null);
  const [ver, setVer] = useState("abiertos");
  useEffect(() => { api("ca_equipos_caidos_cl?select=*&order=abierto_at.desc&limit=500").then(setFilas).catch(() => setFilas([])); }, []);
  if (filas === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const vis = filas.filter((x) => (ver === "abiertos" ? !x.cerrado_at : !!x.cerrado_at));
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 13 };
  const dias = (a, b) => Math.max(0, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 864e5));
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>Cada GPS con más de 24 h sin transmitir abre un caso: alerta al ejecutivo, ticket por correo al proveedor (Proveedores → Geotab) y tarea al supervisor para coordinar. Se cierra solo cuando Geotab vuelve a recibir datos; a los 5 días sin cerrar escala a jefatura. Los avisos quedan apagados hasta el 1-dic (equipos_avisos).</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button style={btn(ver === "abiertos" ? undefined : "sec")} onClick={() => setVer("abiertos")}>Abiertos ({filas.filter((x) => !x.cerrado_at).length})</button>
        <button style={btn(ver === "cerrados" ? undefined : "sec")} onClick={() => setVer("cerrados")}>Cerrados ({filas.filter((x) => x.cerrado_at).length})</button>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Patente", "Sin señal desde", "Días", "Ticket al proveedor", "Escalado", "Cierre"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}</tr></thead>
          <tbody>
            {vis.length === 0 && <tr><td colSpan={6} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Sin casos.</td></tr>}
            {vis.map((x) => (
              <tr key={x.id}>
                <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                <td style={celda}>{x.desde ? fh(x.desde) : "—"}</td>
                <td style={{ ...celda, fontWeight: 700, color: dias(x.desde || x.abierto_at, x.cerrado_at) >= 5 ? C.rojo : C.texto }}>{dias(x.desde || x.abierto_at, x.cerrado_at)}</td>
                <td style={celda}>{x.ticket_at ? <>{fh(x.ticket_at)}<div style={{ color: C.tenue, fontSize: 12 }}>{x.ticket_para}</div></> : <span style={{ color: C.tenue }}>pendiente</span>}</td>
                <td style={celda}>{x.escalado_at ? fh(x.escalado_at) : "—"}</td>
                <td style={celda}>{x.cerrado_at ? fh(x.cerrado_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Proveedores({ quien }) {
  const [filas, setFilas] = useState(null);
  const [msg, setMsg] = useState("");
  const cargar = () => api("ca_proveedores_cl?select=*&order=codigo").then(setFilas).catch(() => setFilas([]));
  useEffect(() => { cargar(); }, []);
  const guardar = async (codigo, campo, valor) => { setMsg(""); try { await rpc("fn_proveedor_guardar", { p_codigo: codigo, p_campo: campo, p_valor: valor, p_por: quien }); setMsg("Guardado."); cargar(); } catch (e) { setMsg(e.message); } };
  if (filas === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const campo = (x, k, w) => <input style={{ ...inp, width: w }} defaultValue={x[k] || ""} onBlur={(e) => e.target.value !== (x[k] || "") && guardar(x.codigo, k, e.target.value)} />;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>A estos correos llegan los tickets (por ejemplo, el de GPS caído va al correo de Geotab). Cada cambio queda con historial.</div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Proveedor", "Servicio", "Correo para tickets", "Contacto", "Teléfono"].map((h) => <th key={h} style={{ padding: "8px 10px", color: C.suave, fontSize: 12 }}>{h}</th>)}</tr></thead>
          <tbody>{filas.map((x) => (
            <tr key={x.codigo} style={{ borderTop: `1px solid ${C.borde}` }}>
              <td style={{ padding: "6px 8px" }}>{campo(x, "nombre", 170)}</td><td style={{ padding: "6px 8px" }}>{campo(x, "servicio", 120)}</td>
              <td style={{ padding: "6px 8px" }}>{campo(x, "correo", 230)}</td><td style={{ padding: "6px 8px" }}>{campo(x, "contacto", 160)}</td><td style={{ padding: "6px 8px" }}>{campo(x, "telefono", 120)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg === "Guardado." ? C.verde : C.rojo }}>{msg}</div>}
    </div>
  );
}

function EventosCamara() {
  const [desde, setDesde] = useState(hoyCL());
  const [hasta, setHasta] = useState(hoyCL());
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ texto: "", tipo: "", riesgo: "", cubierta: false });
  const cargar = () => {
    const d0 = new Date(`${desde}T00:00:00-03:00`), d1 = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 864e5);
    setFilas(null);
    api(`vw_fleetup_eventos_cl?select=*&event_time=gte.${d0.toISOString()}&event_time=lt.${d1.toISOString()}&order=event_time.desc&limit=5000`).then(setFilas).catch(() => setFilas([]));
  };
  useEffect(() => { cargar(); }, [desde, hasta]);   // eslint-disable-line react-hooks/exhaustive-deps
  const todos = filas || [];
  const tipos = [...new Set(todos.map((x) => x.event_type).filter(Boolean))].sort();
  const vis = todos.filter((x) => (!f.tipo || x.event_type === f.tipo) && (!f.riesgo || x.risk_level === f.riesgo) && (!f.cubierta || x.is_covered)
    && (!f.texto || `${x.patente} ${x.ceco || ""} ${x.empresa || ""}`.toLowerCase().includes(f.texto.toLowerCase())));
  const porTipo = Object.entries(vis.reduce((m, x) => { m[x.event_type] = (m[x.event_type] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const porPatente = Object.entries(vis.reduce((m, x) => { m[x.patente] = (m[x.patente] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const celda = { padding: "6px 8px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: C.suave }}>Desde <input type="date" style={inp} value={desde} max={hoyCL()} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
        <label style={{ fontSize: 12, color: C.suave }}>Hasta <input type="date" style={inp} value={hasta} max={hoyCL()} onChange={(e) => e.target.value && setHasta(e.target.value)} /></label>
        <select style={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos los tipos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select style={inp} value={f.riesgo} onChange={(e) => setF({ ...f, riesgo: e.target.value })}><option value="">Todos los riesgos</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => <option key={r} value={r}>{r}</option>)}</select>
        <label style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={f.cubierta} onChange={(e) => setF({ ...f, cubierta: e.target.checked })} /> Solo cámara cubierta</label>
        <input style={{ ...inp, minWidth: 200 }} placeholder="Patente, CECO o empresa" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <span style={{ fontSize: 12.5, color: C.suave }}>{filas === null ? "Cargando…" : `${vis.length} eventos`}</span>
      </div>
      {filas !== null && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {[["Por tipo", porTipo], ["Patentes con más eventos", porPatente]].map(([t, arr]) => (
            <div key={t} style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12, flex: "1 1 260px" }}>
              <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6, fontSize: 13 }}>{t}</div>
              {arr.slice(0, 10).map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}><span>{k}</span><b>{v}</b></div>)}
            </div>
          ))}
        </div>
      )}
      {filas !== null && (
        <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Hora", "Patente", "CECO · empresa", "Tipo", "Riesgo", "Marcas", "Video"].map((h) => <th key={h} style={{ ...celda, color: C.suave }}>{h}</th>)}</tr></thead>
            <tbody>{vis.slice(0, 500).map((x) => (
              <tr key={x.event_id}>
                <td style={celda}>{fh(x.event_time)}</td><td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente || "—"}</td>
                <td style={celda}>{x.ceco}<div style={{ color: C.tenue, fontSize: 11.5 }}>{x.empresa}</div></td>
                <td style={celda}>{x.event_type}</td>
                <td style={{ ...celda, fontWeight: 700, color: ["HIGH", "CRITICAL"].includes(x.risk_level) ? C.rojo : C.suave }}>{x.risk_level || "—"}</td>
                <td style={celda}>{x.is_covered && chip("Cubierta", C.rojoT, C.rojo)} {x.is_critical && chip("Crítico", C.ambarT, C.ambar)}</td>
                <td style={celda}>{x.outward_video && <a href={x.outward_video} target="_blank" rel="noreferrer" style={{ color: C.navy, marginRight: 8 }}>▶ Exterior</a>}{x.inward_video && <a href={x.inward_video} target="_blank" rel="noreferrer" style={{ color: C.navy }}>▶ Interior</a>}</td>
              </tr>
            ))}</tbody>
          </table>
          {vis.length > 500 && <div style={{ padding: 10, fontSize: 12.5, color: C.tenue }}>Se muestran los 500 más recientes de {vis.length}. Usa los filtros para ver el resto.</div>}
          <div style={{ padding: "8px 10px", fontSize: 11.5, color: C.tenue }}>Los enlaces de video de Fleetup se renuevan cada 30 min para los eventos de ayer y hoy; los más antiguos pueden haber vencido. El puntaje de Fleetup no entra en los indicadores.</div>
        </div>
      )}
    </div>
  );
}

// ── Indicadores (pedido sección 5): incumplimientos del mes y multas del Anexo III ──
function Indicadores({ quien, rol }) {
  const [vista, setVista] = useState("geotab");
  const [mes, setMes] = useState(hoyCL().slice(0, 7));
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        {[["geotab", "Conducción Geotab"], ["mes", "Incumplimientos del mes"], ["detalle", "Detalle de faltas"], ["uso", "Uso fuera de horario"], ["multas", "Multas (Anexo III)"]].map(([k, t]) => <button key={k} style={btn(vista === k ? undefined : "sec")} onClick={() => setVista(k)}>{t}</button>)}
        {vista !== "multas" && <label style={{ fontSize: 12.5, color: C.suave, marginLeft: 8 }}>Mes <input type="month" style={inp} value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></label>}
      </div>
      {vista === "geotab" ? <ConduccionGeotab mes={mes} /> : vista === "mes" ? <IncumplimientosMes mes={mes} /> : vista === "detalle" ? <DetalleFaltas mes={mes} /> : vista === "uso" ? <UsoFueraHorario mes={mes} /> : <MultasAnexo quien={quien} puede={rol === "superadmin"} />}
    </div>
  );
}
function IncumplimientosMes({ mes }) {
  const [filas, setFilas] = useState(null);
  const [uf, setUf] = useState({});
  useEffect(() => { setFilas(null); rpc("fn_ca_registro_mes_cl", { p_mes: `${mes}-01` }).then(setFilas).catch(() => setFilas([])); }, [mes]);
  useEffect(() => { api("ca_multas_cl?select=numero,monto").then((r) => setUf(Object.fromEntries((r || []).map((x) => [x.numero, Number(x.monto)])))).catch(() => {}); }, []);
  if (filas === null) return <div style={{ color: C.tenue }}>Calculando…</div>;
  const tot = (k) => filas.reduce((t, x) => t + Number(x[k] || 0), 0);
  const exportar = async () => {
    const XLSX = await cargarSheetJS();
    const data = filas.map((x) => ({ RUT: x.rut, TERCERO: x.empresa, PATENTE: x.patente, CECO: x.ceco, "UF CONDUCCIÓN GEOTAB": (x.faltas_12 || 0) * (uf[12] ?? 0), "NOTA GEOTAB ACUMULADA": x.nota_geotab ?? "",
      "UF AUSENCIAS": x.faltas_1 * (uf[1] ?? 0), "FECHA DE FALTA": x.fechas_1 || "",
      "DETENCIONES": x.detenciones, "NO JUSTIFICADAS": x.no_justificadas,
      "EVENTOS GRAVES CÁMARA": x.eventos_graves, "CÁMARA CUBIERTA": x.camara_cubierta, "UF AUDITORÍA": x.faltas_13 * (uf[13] ?? 0), "FECHA DE NO CUMPLIMIENTO": x.fechas_13 || "",
      "UF USO NO AUTORIZADO": x.faltas_14 * (uf[14] ?? 0), "FECHA DE USO INDEBIDO": x.fechas_14 || "", "TOTAL UF": Number(x.uf_total) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "INCUMPLIMIENTOS");
    XLSX.writeFile(wb, `Incumplimientos_${mes}.xlsx`);
  };
  const kpi = (t, v, c = C.navy) => <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "10px 14px", flex: "1 1 140px" }}><div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12, color: C.suave }}>{t}</div></div>;
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {kpi("Total UF del mes", tot("uf_total"), C.rojo)}{kpi("Detenciones", tot("detenciones"))}{kpi("No justificadas (falta 14)", tot("faltas_14"), C.rojo)}
        {kpi("No presentación (falta 1)", tot("faltas_1"), C.rojo)}{kpi("Auditorías no hechas (falta 13)", tot("faltas_13"), C.ambar)}{kpi("Eventos graves de cámara", tot("eventos_graves"))}{kpi("Cámara cubierta", tot("camara_cubierta"))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <button style={btn()} onClick={exportar} disabled={!filas.length}>Exportar a Excel</button>
        <span style={{ fontSize: 12, color: C.tenue }}>Faltas 1 (no salida por FALTA TERCERO), 13 y 14. Las faltas 10 (domicilios) y 12 (nota Geotab) se suman cuando estén sus datos. «Enviar a cobro» depende de Conciliaciones.</span>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Tercero", "Patente", "CECO", "Nota Geotab", "No presentación · fechas", "Detenciones", "No justificadas · fechas", "Auditorías no hechas · fechas", "Eventos graves", "Cubierta", "Total UF"].map((h) => <th key={h} style={{ ...celda, color: C.suave }}>{h}</th>)}</tr></thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={11} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Sin incumplimientos ni eventos en este mes.</td></tr>}
            {filas.map((x) => (
              <tr key={x.patente}>
                <td style={celda}>{x.empresa || "—"}<div style={{ color: C.tenue, fontSize: 11.5 }}>{x.rut}</div></td>
                <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td><td style={celda}>{x.ceco}</td>
                <td style={{ ...celda, fontWeight: 700, color: x.nota_geotab !== null && x.nota_geotab < 90 ? C.rojo : C.texto }}>{x.nota_geotab ?? "—"}{x.faltas_12 ? " · falta 12" : ""}</td>
                <td style={celda}>{x.faltas_1 ? <><b style={{ color: C.rojo }}>{x.faltas_1}</b> · {x.fechas_1}</> : "—"}</td>
                <td style={celda}>{x.detenciones || "—"}</td>
                <td style={celda}>{x.faltas_14 ? <><b style={{ color: C.rojo }}>{x.faltas_14}</b> · {x.fechas_14}</> : "—"}</td>
                <td style={celda}>{x.faltas_13 ? <><b style={{ color: C.ambar }}>{x.faltas_13}</b> · {x.fechas_13}</> : "—"}</td>
                <td style={celda}>{x.eventos_graves || "—"}</td><td style={celda}>{x.camara_cubierta || "—"}</td>
                <td style={{ ...celda, fontWeight: 800, color: Number(x.uf_total) ? C.rojo : C.tenue }}>{Number(x.uf_total) ? `${x.uf_total} UF` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function DetalleFaltas({ mes }) {
  const [filas, setFilas] = useState(null);
  useEffect(() => {
    const d0 = new Date(`${mes}-01T00:00:00-03:00`); const d1 = new Date(d0); d1.setMonth(d1.getMonth() + 1);
    setFilas(null);
    api(`vw_ca_faltas_cl?select=*&fecha=gte.${d0.toISOString()}&fecha=lt.${d1.toISOString()}&order=fecha.desc`).then(setFilas).catch(() => setFilas([]));
  }, [mes]);
  if (filas === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5 };
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
        <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Fecha", "Falta", "Patente", "Tercero", "Detalle", "UF"].map((h) => <th key={h} style={{ ...celda, color: C.suave }}>{h}</th>)}</tr></thead>
        <tbody>
          {filas.length === 0 && <tr><td colSpan={6} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Sin faltas en este mes.</td></tr>}
          {filas.map((x) => (
            <tr key={x.falta + x.origen_id}>
              <td style={celda}>{fh(x.fecha)}</td><td style={{ ...celda, fontWeight: 700 }}>N° {x.falta}</td>
              <td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td><td style={celda}>{x.empresa || "—"}</td>
              <td style={celda}>{x.detalle}</td><td style={{ ...celda, fontWeight: 700 }}>{x.uf ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
// Tablero «Gestión de indicadores» · conducción Geotab (I-05 a I-08)
const RIESGO_COL = { "Básico": C.verde, "Leve": C.navy, "Medio": C.ambar, "Alto": C.rojo };
function ConduccionGeotab({ mes }) {
  const [mesRows, setMesRows] = useState(null);
  const [dias, setDias] = useState([]);
  const [f, setF] = useState({ tipo: "", ceco: "", texto: "" });
  const [orden, setOrden] = useState({ k: "nota", asc: true });
  const [abierta, setAbierta] = useState(null);
  const [cfgR, setCfgR] = useState({ basico: 95, leve: 75, medio: 60, min: 90, activa: "no" });
  useEffect(() => {
    setMesRows(null);
    const d0 = `${mes}-01`; const fin = new Date(`${mes}-01T12:00:00`); fin.setMonth(fin.getMonth() + 1);
    Promise.all([
      api(`vw_geo_mes_cl?select=*&mes=eq.${d0}`),
      api(`vw_gps_seguridad_cl?select=fecha,patente,ceco,tipo,empresa,km,vel_max,conduccion_min,ralenti_min,frenado,aceleracion,giro,exceso,cinturon,ocurrencias,puntaje&fecha=gte.${d0}&fecha=lt.${fin.toISOString().slice(0, 10)}&order=fecha&limit=20000`),
      api("ca_config_cl?clave=in.(geo_riesgo_basico,geo_riesgo_leve,geo_riesgo_medio,geo_nota_minima,geo_falta12_activa)&select=clave,valor"),
    ]).then(([m, d, c]) => {
      setMesRows(m || []); setDias(d || []);
      const o = Object.fromEntries((c || []).map((x) => [x.clave, x.valor]));
      setCfgR({ basico: Number(o.geo_riesgo_basico || 95), leve: Number(o.geo_riesgo_leve || 75), medio: Number(o.geo_riesgo_medio || 60), min: Number(o.geo_nota_minima || 90), activa: o.geo_falta12_activa || "no" });
    }).catch(() => { setMesRows([]); setDias([]); });
  }, [mes]);
  if (mesRows === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const riesgo = (n) => n === null || n === undefined ? "—" : n >= cfgR.basico ? "Básico" : n >= cfgR.leve ? "Leve" : n >= cfgR.medio ? "Medio" : "Alto";
  const cecos = [...new Set(mesRows.map((x) => x.ceco).filter(Boolean))].sort();
  const pasa = (x) => (!f.tipo || x.tipo === f.tipo) && (!f.ceco || x.ceco === f.ceco);
  const vis = mesRows.filter((x) => pasa(x) && (!f.texto || `${x.patente} ${x.empresa || ""}`.toLowerCase().includes(f.texto.toLowerCase())))
    .sort((a, b) => { const va = a[orden.k] ?? "", vb = b[orden.k] ?? ""; const c = typeof va === "number" || !isNaN(Number(va)) ? Number(va) - Number(vb) : String(va).localeCompare(String(vb)); return orden.asc ? c : -c; });
  const diasSel = dias.filter(pasa);
  const porDia = Object.entries(diasSel.reduce((m, x) => { (m[x.fecha] = m[x.fecha] || []).push(Number(x.puntaje)); return m; }, {})).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, arr]) => [d.slice(8, 10) + "-" + d.slice(5, 7), Math.round((arr.reduce((t, v) => t + v, 0) / arr.length) * 10) / 10]);
  const prom = vis.length ? Math.round((vis.reduce((t, x) => t + Number(x.nota || 0), 0) / vis.length) * 10) / 10 : null;
  const bajo = vis.filter((x) => Number(x.nota) < cfgR.min).length;
  const th = (k, t) => <th key={k} onClick={() => setOrden({ k, asc: orden.k === k ? !orden.asc : true })} style={{ padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12, color: C.suave, cursor: "pointer", whiteSpace: "nowrap" }}>{t}{orden.k === k ? (orden.asc ? " ▲" : " ▼") : ""}</th>;
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5 };
  const kpi = (t, v, c = C.navy) => <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: "10px 14px", flex: "1 1 140px" }}><div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12, color: C.suave }}>{t}</div></div>;
  const maxDia = Math.max(1, ...porDia.map((x) => x[1]));
  return (
    <div>
      <div style={{ background: C.ambarT, color: C.ambar, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 12 }}>
        Puntaje <b>provisional</b>: se calcula con las ocurrencias de las 5 reglas de Geotab y pesos editables (Configuración, geo_peso_*). Falta calibrarlo con el informe Safety Scorecard. La falta N° 12 está {cfgR.activa === "si" ? "ENCENDIDA" : "apagada"} (geo_falta12_activa).
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select style={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">BT y terceros</option><option value="BT">BT</option><option value="Tercero">Tercero</option></select>
        <select style={inp} value={f.ceco} onChange={(e) => setF({ ...f, ceco: e.target.value })}><option value="">Todos los CECO</option>{cecos.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input style={{ ...inp, minWidth: 200 }} placeholder="Patente o empresa" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {kpi("Nota promedio del mes", prom ?? "—", prom !== null && prom < cfgR.min ? C.rojo : C.verde)}{kpi(`Patentes con nota < ${cfgR.min}`, bajo, C.rojo)}
        {kpi("Patentes", vis.length)}{kpi("Ocurrencias", vis.reduce((t, x) => t + Number(x.ocurrencias || 0), 0))}{kpi("Km", Math.round(vis.reduce((t, x) => t + Number(x.km || 0), 0)).toLocaleString("es-CL"))}
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, color: C.navy, fontSize: 13, marginBottom: 8 }}>Evolución diaria del puntaje (promedio de la selección)</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
          {porDia.map(([d, v]) => (
            <div key={d} title={`${d}: ${v}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: 10, color: C.suave }}>{v}</span>
              <div style={{ width: "100%", height: `${(v / maxDia) * 90}px`, background: v < cfgR.min ? C.ambar : C.verde, borderRadius: 3 }} />
              <span style={{ fontSize: 10, color: C.tenue }}>{d.slice(0, 2)}</span>
            </div>
          ))}
          {porDia.length === 0 && <span style={{ fontSize: 12.5, color: C.tenue }}>Sin datos del mes.</span>}
        </div>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>
            {th("empresa", "Empresa")}{th("patente", "Patente")}{th("tipo", "Tipo")}{th("ceco", "CECO")}{th("nota", "Nota acumulada")}{th("nota", "Riesgo")}{th("km", "Km")}
            {th("aceleracion", "Aceleración")}{th("frenado", "Frenado")}{th("giro", "Giro")}{th("exceso", "Exceso > 8 %")}{th("cinturon", "Cinturón")}{th("vel_max", "Vel. máx.")}
          </tr></thead>
          <tbody>{vis.map((x) => [
            <tr key={x.patente} style={{ cursor: "pointer", background: abierta === x.patente ? "#fafbfd" : "#fff" }} onClick={() => setAbierta(abierta === x.patente ? null : x.patente)}>
              <td style={celda}>{x.empresa || "—"}</td><td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td><td style={celda}>{x.tipo}</td><td style={celda}>{x.ceco || "—"}</td>
              <td style={{ ...celda, fontWeight: 800, color: Number(x.nota) < cfgR.min ? C.rojo : C.texto }}>{x.nota}</td>
              <td style={{ ...celda, fontWeight: 700, color: RIESGO_COL[riesgo(Number(x.nota))] }}>{riesgo(Number(x.nota))}</td>
              <td style={celda}>{Math.round(x.km)}</td><td style={celda}>{x.aceleracion}</td><td style={celda}>{x.frenado}</td><td style={celda}>{x.giro}</td><td style={celda}>{x.exceso}</td><td style={celda}>{x.cinturon}</td><td style={celda}>{x.vel_max} km/h</td>
            </tr>,
            abierta === x.patente && <tr key={x.patente + "d"}><td colSpan={13} style={{ padding: 10, background: "#fafbfd", borderBottom: `1px solid ${C.borde}` }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ color: C.suave, textAlign: "left" }}>{["Día", "Puntaje", "Km", "Conducción", "Ralentí", "Vel. máx.", "Acel.", "Fren.", "Giro", "Exceso", "Cinturón"].map((h) => <th key={h} style={{ padding: "3px 8px" }}>{h}</th>)}</tr></thead>
                <tbody>{dias.filter((d) => d.patente === x.patente).map((d) => (
                  <tr key={d.fecha}><td style={{ padding: "3px 8px" }}>{fd(d.fecha)}</td><td style={{ padding: "3px 8px", fontWeight: 700, color: Number(d.puntaje) < cfgR.min ? C.rojo : C.texto }}>{d.puntaje}</td>
                    <td style={{ padding: "3px 8px" }}>{d.km}</td><td style={{ padding: "3px 8px" }}>{d.conduccion_min} min</td><td style={{ padding: "3px 8px" }}>{d.ralenti_min} min</td><td style={{ padding: "3px 8px" }}>{d.vel_max} km/h</td>
                    <td style={{ padding: "3px 8px" }}>{d.aceleracion}</td><td style={{ padding: "3px 8px" }}>{d.frenado}</td><td style={{ padding: "3px 8px" }}>{d.giro}</td><td style={{ padding: "3px 8px" }}>{d.exceso}</td><td style={{ padding: "3px 8px" }}>{d.cinturon}</td></tr>
                ))}</tbody>
              </table>
            </td></tr>,
          ])}</tbody>
        </table>
      </div>
    </div>
  );
}

// Tablero «Uso fuera de horario» (I-09 a I-12)
function Barras({ titulo, datos, color = C.navy }) {
  const max = Math.max(1, ...datos.map((d) => d[1]));
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, padding: 12, flex: "1 1 280px" }}>
      <div style={{ fontWeight: 800, color: C.navy, fontSize: 13, marginBottom: 8 }}>{titulo}</div>
      {datos.length === 0 && <div style={{ fontSize: 12.5, color: C.tenue }}>Sin datos.</div>}
      {datos.slice(0, 12).map(([k, v]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
          <span style={{ width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.suave }} title={k}>{k}</span>
          <div style={{ flex: 1, background: C.fondo, borderRadius: 4, height: 14 }}><div style={{ width: `${(v * 100) / max}%`, background: color, height: "100%", borderRadius: 4 }} /></div>
          <b style={{ width: 28, textAlign: "right" }}>{v}</b>
        </div>
      ))}
    </div>
  );
}
function UsoFueraHorario({ mes }) {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ autorizado: "", patente: "", ceco: "" });
  useEffect(() => {
    const d0 = new Date(`${mes}-01T00:00:00-03:00`); const d1 = new Date(d0); d1.setMonth(d1.getMonth() + 1);
    setFilas(null);
    api(`vw_ca_uso_fuera_horario_cl?select=*&fecha=gte.${d0.toISOString()}&fecha=lt.${d1.toISOString()}&order=fecha.desc`).then(setFilas).catch(() => setFilas([]));
  }, [mes]);
  if (filas === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const cecos = [...new Set(filas.map((x) => x.ceco).filter(Boolean))].sort();
  const vis = filas.filter((x) => (!f.autorizado || x.autorizado === f.autorizado) && (!f.ceco || x.ceco === f.ceco) && (!f.patente || String(x.patente).toLowerCase().includes(f.patente.toLowerCase())));
  const contar = (k) => Object.entries(vis.reduce((m, x) => { const c = x[k] || "—"; m[c] = (m[c] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const porDia = Object.entries(vis.reduce((m, x) => { const d = new Date(x.fecha).toLocaleDateString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit" }); m[d] = (m[d] || 0) + 1; return m; }, {})).sort((a, b) => a[0].split("-").reverse().join().localeCompare(b[0].split("-").reverse().join()));
  const n = (v) => vis.filter((x) => x.autorizado === v).length;
  const kpi = (t, v, c, val) => <div onClick={() => val !== undefined && setF({ ...f, autorizado: f.autorizado === val ? "" : val })} style={{ background: "#fff", border: `1px solid ${f.autorizado === val ? c : C.borde}`, borderRadius: 12, padding: "10px 14px", flex: "1 1 140px", cursor: val !== undefined ? "pointer" : "default" }}><div style={{ fontSize: 24, fontWeight: 800, color: c }}>{v}</div><div style={{ fontSize: 12, color: C.suave }}>{t}</div></div>;
  const celda = { padding: "7px 9px", borderBottom: `1px solid ${C.borde}`, fontSize: 12.5, verticalAlign: "top" };
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select style={inp} value={f.autorizado} onChange={(e) => setF({ ...f, autorizado: e.target.value })}><option value="">Uso autorizado: todos</option><option value="Sí">Sí</option><option value="No">No</option><option value="Pendiente">Pendiente</option></select>
        <select style={inp} value={f.ceco} onChange={(e) => setF({ ...f, ceco: e.target.value })}><option value="">Todos los CECO</option>{cecos.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input style={{ ...inp, width: 140 }} placeholder="Patente" value={f.patente} onChange={(e) => setF({ ...f, patente: e.target.value })} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {kpi("Eventos", vis.length, C.navy)}{kpi("Autorizados", n("Sí"), C.verde, "Sí")}{kpi("No autorizados", n("No"), C.rojo, "No")}{kpi("Pendientes", n("Pendiente"), C.ambar, "Pendiente")}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Barras titulo="Eventos por CECO" datos={contar("ceco")} />
        <Barras titulo="Evolución en el período" datos={porDia} color={C.suave} />
        <Barras titulo="Eventos por empresa de transporte" datos={contar("empresa")} />
        <Barras titulo="Eventos por vehículo" datos={contar("patente")} color={C.ambar} />
        <Barras titulo="Motivo del uso" datos={contar("motivo")} color={C.verde} />
      </div>
      <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Comentarios</div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Empresa", "Fecha", "Patente", "Tiempo", "Motivo", "Comentario", "Autorizado"].map((h) => <th key={h} style={{ ...celda, color: C.suave }}>{h}</th>)}</tr></thead>
          <tbody>
            {vis.length === 0 && <tr><td colSpan={7} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Sin eventos con este filtro.</td></tr>}
            {vis.map((x) => (
              <tr key={x.id}>
                <td style={celda}>{x.empresa || "—"}</td><td style={celda}>{fh(x.fecha)}</td><td style={{ ...celda, fontWeight: 800, color: C.navy }}>{x.patente}</td>
                <td style={celda}>{x.minutos ? `${x.minutos} min` : "—"}</td><td style={celda}>{x.motivo}</td>
                <td style={{ ...celda, maxWidth: 320 }}>{x.comentario || "—"}</td>
                <td style={{ ...celda, fontWeight: 700, color: x.autorizado === "Sí" ? C.verde : x.autorizado === "No" ? C.rojo : C.ambar }}>{x.autorizado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MultasAnexo({ quien, puede }) {
  const [filas, setFilas] = useState(null);
  const [msg, setMsg] = useState("");
  const cargar = () => api("ca_multas_cl?select=*&order=numero").then(setFilas).catch(() => setFilas([]));
  useEffect(() => { cargar(); }, []);
  const guardar = async (n, campo, valor) => { setMsg(""); try { await rpc("fn_multa_guardar", { p_numero: n, p_campo: campo, p_valor: valor, p_por: quien }); setMsg("Guardado."); cargar(); } catch (e) { setMsg(e.message); } };
  if (filas === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: C.suave, marginBottom: 10 }}>Anexo III «De las multas y sanciones». Todas se aplican cada vez que ocurren. {puede ? "Puedes editar el monto (queda con historial)." : "Solo un Superadmin puede editar."}</div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
          <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["N°", "Falta", "Monto", "Unidad"].map((h) => <th key={h} style={{ padding: "8px 10px", color: C.suave, fontSize: 12 }}>{h}</th>)}</tr></thead>
          <tbody>{filas.map((x) => (
            <tr key={x.numero} style={{ borderTop: `1px solid ${C.borde}` }}>
              <td style={{ padding: "6px 10px", fontWeight: 800 }}>{x.numero}</td><td style={{ padding: "6px 10px" }}>{x.falta}</td>
              <td style={{ padding: "6px 8px" }}>{puede ? <input type="number" step="0.5" style={{ ...inp, width: 90 }} defaultValue={x.monto} onBlur={(e) => String(e.target.value) !== String(x.monto) && guardar(x.numero, "monto", e.target.value)} /> : x.monto}</td>
              <td style={{ padding: "6px 10px", color: C.suave }}>{x.unidad}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg === "Guardado." ? C.verde : C.rojo }}>{msg}</div>}
    </div>
  );
}

// ── No salidas ──────────────────────────────────────────────────────────────
function NoSalidas() {
  const [fecha, setFecha] = useState(hoyCL());
  const [filas, setFilas] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [solo, setSolo] = useState("sin_motivo");
  useEffect(() => {
    setFilas(null);
    rpc("fn_ca_no_salidas_dia", { p_fecha: fecha }).then(setFilas).catch(() => setFilas([]));
    api(`ca_avisos_cl?select=*&fecha=eq.${fecha}&order=creado_at.desc`).then(setAvisos).catch(() => setAvisos([]));
  }, [fecha]);
  const noSal = (filas || []).filter((x) => !x.salio);
  const vis = noSal.filter((x) => solo === "todas" ? true : solo === "sin_motivo" ? !x.motivo : ["EN PANNE", "EN TALLER"].includes(x.motivo));
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input type="date" style={inp} value={fecha} max={hoyCL()} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <select style={inp} value={solo} onChange={(e) => setSolo(e.target.value)}>
          <option value="sin_motivo">Sin motivo</option><option value="panne">En panne o taller</option><option value="todas">Todas las que no salieron</option>
        </select>
        <span style={{ fontSize: 12.5, color: C.suave }}>
          {filas ? `${(filas || []).length} vehículos · ${noSal.length} no salieron · ${noSal.filter((x) => !x.motivo).length} sin motivo` : "Cargando…"}
        </span>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: C.fondo, color: C.suave, textAlign: "left" }}>{["Patente", "CECO", "Supervisor", "Empresa", "Motivo", "Registrado"].map((h) => <th key={h} style={{ padding: "9px 10px", fontSize: 12 }}>{h}</th>)}</tr></thead>
          <tbody>
            {filas && vis.length === 0 && <tr><td colSpan={6} style={{ padding: 18, color: C.tenue }}>Nada en esta lista.</td></tr>}
            {vis.map((x) => (
              <tr key={x.patente} style={{ borderTop: `1px solid ${C.borde}` }}>
                <td style={{ padding: "8px 10px", fontWeight: 700, color: C.navy }}>{x.patente}</td>
                <td style={{ padding: "8px 10px" }}>{x.ceco}</td>
                <td style={{ padding: "8px 10px" }}>{x.supervisor || "—"}</td>
                <td style={{ padding: "8px 10px" }}>{x.empresa || "—"}</td>
                <td style={{ padding: "8px 10px" }}>{x.motivo ? chip(x.motivo, ["EN PANNE", "EN TALLER"].includes(x.motivo) ? C.ambarT : C.fondo, ["EN PANNE", "EN TALLER"].includes(x.motivo) ? C.ambar : C.suave) : chip("Sin motivo", C.rojoT, C.rojo)}{x.comentario ? <div style={{ fontSize: 12, color: C.suave, marginTop: 3 }}>{x.comentario}</div> : null}</td>
                <td style={{ padding: "8px 10px", fontSize: 12, color: C.suave }}>{x.registrado_por ? `${x.registrado_por} · ${fh(x.registrado_at)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontWeight: 800, color: C.navy, fontSize: 13, marginBottom: 6 }}>Avisos enviados ese día</div>
      {avisos.length === 0 ? <div style={{ fontSize: 12.5, color: C.tenue }}>Ninguno (el de supervisores sale a las 20:30; el resumen a Maycol, a las 08:00 del día siguiente).</div> : avisos.map((a) => (
        <div key={a.id} style={{ fontSize: 12.5, marginBottom: 4 }}>{fh(a.creado_at)} · <b>{a.tipo === "no_salidas_resumen" ? "Resumen a Maycol" : "Aviso al supervisor"}</b> · {a.destinatario} · {a.enviado ? "enviado" : "NO enviado"}{Array.isArray(a.detalle?.placas) ? ` · ${a.detalle.placas.join(", ")}` : ""}</div>
      ))}
    </div>
  );
}

// ── Incumplimientos ─────────────────────────────────────────────────────────
function Incumplimientos() {
  const [filas, setFilas] = useState(null);
  const [mes, setMes] = useState(hoyCL().slice(0, 7));
  useEffect(() => { api("vw_ca_tareas_brain_cl?select=*&order=creada_at.desc&limit=2000").then(setFilas).catch(() => setFilas([])); }, []);
  const delMes = (filas || []).filter((x) => (x.creada_at || "").slice(0, 7) === mes);
  const porSup = useMemo(() => {
    const m = {};
    for (const x of delMes) {
      const k = x.supervisor_nombre || x.supervisor_email || "Sin supervisor";
      m[k] = m[k] || { sup: k, ceco: x.ceco, total: 0, respondidas: 0, vencidas: 0, rechazadas: 0 };
      m[k].total += 1;
      if (x.respondida_at) m[k].respondidas += 1;
      if (x.incumplimiento) m[k].vencidas += 1;
      if (x.estado === "rechazada") m[k].rechazadas += 1;
    }
    return Object.values(m).sort((a, b) => b.vencidas - a.vencidas || b.total - a.total);
  }, [delMes]);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input type="month" style={inp} value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
        <span style={{ fontSize: 12.5, color: C.suave }}>Tareas creadas en el mes: {delMes.length}</span>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: C.fondo, color: C.suave, textAlign: "left" }}>{["Supervisor", "CECO", "Tareas", "Respondidas a tiempo", "Vencidas sin respuesta (incumplimiento)", "No justificadas"].map((h) => <th key={h} style={{ padding: "9px 10px", fontSize: 12 }}>{h}</th>)}</tr></thead>
          <tbody>
            {filas === null && <tr><td colSpan={6} style={{ padding: 18, color: C.tenue }}>Cargando…</td></tr>}
            {filas && porSup.length === 0 && <tr><td colSpan={6} style={{ padding: 18, color: C.tenue }}>Sin tareas en este mes.</td></tr>}
            {porSup.map((r) => (
              <tr key={r.sup} style={{ borderTop: `1px solid ${C.borde}` }}>
                <td style={{ padding: "8px 10px", fontWeight: 700, color: C.navy }}>{r.sup}</td>
                <td style={{ padding: "8px 10px" }}>{r.ceco || "—"}</td>
                <td style={{ padding: "8px 10px" }}>{r.total}</td>
                <td style={{ padding: "8px 10px" }}>{r.respondidas}</td>
                <td style={{ padding: "8px 10px", color: r.vencidas ? C.rojo : C.texto, fontWeight: r.vencidas ? 800 : 400 }}>{r.vencidas}</td>
                <td style={{ padding: "8px 10px" }}>{r.rechazadas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Configuración ───────────────────────────────────────────────────────────
function Configuracion({ quien }) {
  const [tipos, setTipos] = useState(null);
  const [just, setJust] = useState([]);
  const [cfg, setCfg] = useState([]);
  const [msg, setMsg] = useState("");
  const cargar = () => Promise.all([
    api("ca_tipos_cl?select=*&order=orden"), api("ca_justificaciones_cl?select=*&order=orden"), api("ca_config_cl?select=*&order=clave"),
  ]).then(([a, b, c]) => { setTipos(a); setJust(b); setCfg(c); }).catch((e) => setMsg(e.message));
  useEffect(() => { cargar(); }, []);
  const guardar = async (tabla, clave, campo, valor) => {
    setMsg("");
    try { await rpc("fn_ca_mantenedor_guardar", { p_tabla: tabla, p_clave: clave, p_campo: campo, p_valor: valor === null ? null : String(valor), p_por: quien }); await cargar(); setMsg("Guardado."); }
    catch (e) { setMsg(e.message); }
  };
  if (tipos === null) return <div style={{ color: C.tenue }}>Cargando…</div>;
  const celda = { padding: "8px 10px", borderTop: `1px solid ${C.borde}` };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {msg && <div style={{ fontSize: 13, color: msg === "Guardado." ? C.verde : C.rojo }}>{msg}</div>}
      <div>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Tipos de tarea y plazos</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 12 }}>
          <thead><tr style={{ background: C.fondo, color: C.suave, textAlign: "left" }}>{["Tipo", "Plazo (horas)", "Vence a las 23:59", "Incumplimiento", "Activo"].map((h) => <th key={h} style={{ padding: "8px 10px", fontSize: 12 }}>{h}</th>)}</tr></thead>
          <tbody>{tipos.map((t) => (
            <tr key={t.codigo}>
              <td style={celda}><b>{t.nombre}</b><div style={{ fontSize: 11.5, color: C.tenue }}>{t.para === "operaciones" ? "Para Operaciones" : "Para el supervisor"}</div></td>
              <td style={celda}><input type="number" min="0" style={{ ...inp, width: 80 }} defaultValue={t.sla_horas ?? ""} onBlur={(e) => { const v = e.target.value === "" ? null : e.target.value; if (String(v ?? "") !== String(t.sla_horas ?? "")) guardar("ca_tipos_cl", t.codigo, "sla_horas", v); }} /></td>
              <td style={celda}><input type="checkbox" defaultChecked={t.vence_fin_dia} onChange={(e) => guardar("ca_tipos_cl", t.codigo, "vence_fin_dia", e.target.checked)} /></td>
              <td style={celda}><input type="checkbox" defaultChecked={t.genera_incumplimiento} onChange={(e) => guardar("ca_tipos_cl", t.codigo, "genera_incumplimiento", e.target.checked)} /></td>
              <td style={celda}><input type="checkbox" defaultChecked={t.activo} onChange={(e) => guardar("ca_tipos_cl", t.codigo, "activo", e.target.checked)} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Justificaciones de detención y su criterio</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}` }}>
          <thead><tr style={{ background: C.fondo, color: C.suave, textAlign: "left" }}>{["Motivo (lo ve el supervisor)", "Criterio (solo el Brain)", "Regla", "Activo"].map((h) => <th key={h} style={{ padding: "8px 10px", fontSize: 12 }}>{h}</th>)}</tr></thead>
          <tbody>{just.map((j) => (
            <tr key={j.codigo}>
              <td style={celda}><b>{j.nombre}</b></td>
              <td style={celda}><select style={inp} defaultValue={j.criterio} onChange={(e) => guardar("ca_justificaciones_cl", j.codigo, "criterio", e.target.value)}><option value="justifica">Justifica</option><option value="revisar">Revisar</option><option value="no_justifica">No justifica</option></select></td>
              <td style={celda}><input style={{ ...inp, width: "100%" }} defaultValue={j.detalle || ""} onBlur={(e) => { if (e.target.value !== (j.detalle || "")) guardar("ca_justificaciones_cl", j.codigo, "detalle", e.target.value); }} /></td>
              <td style={celda}><input type="checkbox" defaultChecked={j.activo} onChange={(e) => guardar("ca_justificaciones_cl", j.codigo, "activo", e.target.checked)} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Plazos y reglas (auditorías, flota, detenciones, mantenciones, documentos, reparaciones, siniestros)</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}`, marginBottom: 18 }}>
          <tbody>{cfg.filter((c) => /^(aud_|flota_|auditoria_|det_|mnt_|doc_|rep_|vu_|sin_|ficha_|esc_|resumen_|correo_finanzas)/.test(c.clave)).map((c) => (
            <tr key={c.clave}>
              <td style={{ ...celda, width: 260 }}><b>{c.descripcion || c.clave}</b><div style={{ fontSize: 11.5, color: C.tenue }}>{c.clave}</div></td>
              <td style={celda}><input style={{ ...inp, width: 140 }} defaultValue={c.valor || ""} onBlur={(e) => { if (e.target.value !== (c.valor || "")) guardar("ca_config_cl", c.clave, "valor", e.target.value); }} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Correos y enlaces</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}` }}>
          <tbody>{cfg.filter((c) => !/^(aud_|flota_|auditoria_|det_|mnt_|doc_|rep_|vu_|sin_|ficha_|esc_|resumen_|correo_finanzas)/.test(c.clave)).map((c) => (
            <tr key={c.clave}>
              <td style={{ ...celda, width: 260 }}><b>{c.clave}</b><div style={{ fontSize: 11.5, color: C.tenue }}>{c.descripcion}</div></td>
              <td style={celda}><input style={{ ...inp, width: "100%" }} defaultValue={c.valor || ""} onBlur={(e) => { if (e.target.value !== (c.valor || "")) guardar("ca_config_cl", c.clave, "valor", e.target.value); }} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: C.tenue }}>Cada cambio queda en el historial (ca_cambios_cl) con usuario, fecha, valor anterior y nuevo.</div>
    </div>
  );
}
