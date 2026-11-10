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
//   · No salidas: fn_ca_no_salidas_dia + avisos enviados (ca_avisos_cl).
//   · Incumplimientos: tareas vencidas sin respuesta, por supervisor y mes.
//   · Configuración: plazos por tipo, justificaciones y correos (ca_*_cl).
// Todo en Supabase Chile, con la clave anon (como PNR).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";
const C = { navy: "#002E5D", naranja: "#FF6600", borde: "#e4e7ec", suave: "#475569", tenue: "#94a3b8", texto: "#1f2937", fondo: "#f4f6f9", rojo: "#9e3b1b", rojoT: "#faece6", verde: "#1f7a5c", verdeT: "#e9f3ef", ambar: "#b8651c", ambarT: "#fdf3e8" };

async function api(path, o = {}) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json", ...(o.headers || {}) },
    body: o.body,
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
  if (sub === "ca_flota") return <EstadoFlota />;
  if (sub === "ca_mantenciones") return <Mantenciones quien={quien} />;
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
          <option value="por_revisar">Por revisar</option><option value="devueltas">Devueltas al tercero</option><option value="aprobadas">Aprobadas</option><option value="corregidas">Corregidas a Biggy</option><option value="pedidas">Pedidas por evento</option><option value="todas">Todas</option>
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
      {f.estado === "pedidas" ? <Pedidas filas={pedidas.filter((x) => !f.texto || `${x.patente} ${x.empresa || ""}`.toLowerCase().includes(f.texto.toLowerCase()))} quien={quien} onCambio={cargar} /> :
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
        {[["programa", "Programa"], ["pautas", "Pautas por modelo"], ["talleres", "Talleres"]].map(([k, t]) => (
          <button key={k} style={btn(vista === k ? undefined : "sec")} onClick={() => setVista(k)}>{t}</button>
        ))}
      </div>
      {vista === "programa" && <ProgramaMnt />}
      {vista === "pautas" && <PautasMnt quien={quien} />}
      {vista === "talleres" && <TalleresMnt quien={quien} />}
    </div>
  );
}
function ProgramaMnt() {
  const [filas, setFilas] = useState(null);
  const [f, setF] = useState({ estado: "", texto: "" });
  const [abierta, setAbierta] = useState(null);
  useEffect(() => { rpc("fn_mnt_programa_cl").then(setFilas).catch(() => setFilas([])); }, []);
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
              {["Patente", "Modelo · CECO", "Empresa", "Última mantención", "Km actual", "Próxima pauta", "Faltan", "Fecha estimada", "Taller autorizado", "Estado"].map((h) => <th key={h} style={{ ...celda, fontSize: 12, color: C.suave }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {vis.length === 0 && <tr><td colSpan={10} style={{ ...celda, color: C.tenue, textAlign: "center" }}>Nada con este filtro.</td></tr>}
              {vis.map((x) => { const e = MN_ESTADO[x.estado] || [x.estado, C.fondo, C.suave]; return [
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
                </tr>,
                abierta === x.patente && <tr key={x.patente + "h"}><td colSpan={10} style={{ padding: 0, borderBottom: `1px solid ${C.borde}` }}><HistorialMnt patente={x.patente} /></td></tr>,
              ]; })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function HistorialMnt({ patente }) {
  const [h, setH] = useState(null);
  const [tipo, setTipo] = useState("");
  useEffect(() => { api(`ca_mnt_historial_cl?select=*&patente=eq.${encodeURIComponent(patente)}&order=fecha.desc&limit=200`).then(setH).catch(() => setH([])); }, [patente]);
  if (!h) return <div style={{ padding: 14, color: C.tenue, fontSize: 13 }}>Cargando historial…</div>;
  const vis = h.filter((x) => !tipo || x.tipo === tipo);
  const total = vis.reduce((s, x) => s + (Number(x.precio_total) || Number(x.costo) || 0), 0);
  return (
    <div style={{ padding: 14, background: "#fafbfd" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <b style={{ color: C.navy }}>Historial de {patente}</b>
        <select style={inp} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todo</option>{Object.entries(MN_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <span style={{ fontSize: 12.5, color: C.suave }}>{vis.length} registros · ${Math.round(total).toLocaleString("es-CL")}</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "#fff" }}>
        <thead><tr style={{ background: C.fondo, textAlign: "left" }}>{["Fecha", "Tipo", "Km", "Detalle", "Taller", "Costo", "Días"].map((t) => <th key={t} style={{ padding: "6px 8px", color: C.suave }}>{t}</th>)}</tr></thead>
        <tbody>{vis.map((x) => (
          <tr key={x.id} style={{ borderTop: `1px solid ${C.borde}` }}>
            <td style={{ padding: "6px 8px" }}>{fd(x.fecha)}</td><td style={{ padding: "6px 8px" }}>{MN_TIPO[x.tipo] || x.tipo}</td>
            <td style={{ padding: "6px 8px" }}>{kmf(x.km)}</td>
            <td style={{ padding: "6px 8px" }}>{x.tipo === "mantencion" && x.pauta_km ? `Pauta ${kmf(x.pauta_km)}` : x.detalle || x.item || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{x.taller || "—"}</td>
            <td style={{ padding: "6px 8px" }}>{x.costo || x.precio_total ? `$${Math.round(Number(x.precio_total) || Number(x.costo)).toLocaleString("es-CL")}` : "—"}</td>
            <td style={{ padding: "6px 8px" }}>{x.dias_taller ?? "—"}</td>
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
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Plazos de auditorías y bitácora</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}`, marginBottom: 18 }}>
          <tbody>{cfg.filter((c) => /^(aud_|flota_|auditoria_)/.test(c.clave)).map((c) => (
            <tr key={c.clave}>
              <td style={{ ...celda, width: 260 }}><b>{c.descripcion || c.clave}</b><div style={{ fontSize: 11.5, color: C.tenue }}>{c.clave}</div></td>
              <td style={celda}><input style={{ ...inp, width: 140 }} defaultValue={c.valor || ""} onBlur={(e) => { if (e.target.value !== (c.valor || "")) guardar("ca_config_cl", c.clave, "valor", e.target.value); }} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Correos y enlaces</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}` }}>
          <tbody>{cfg.filter((c) => !/^(aud_|flota_|auditoria_)/.test(c.clave)).map((c) => (
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
