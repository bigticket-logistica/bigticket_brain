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
  const cargar = async () => {
    try { setFilas(await api("vw_ca_auditorias_brain_cl?select=*&order=enviada_at.desc&limit=500")); setError(""); }
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
          <option value="por_revisar">Por revisar</option><option value="devueltas">Devueltas al tercero</option><option value="aprobadas">Aprobadas</option><option value="corregidas">Corregidas a Biggy</option><option value="todas">Todas</option>
        </select>
        <select style={inp} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          <option value="">Vehículo y limpieza</option><option value="vehiculo">Vehículo</option><option value="limpieza">Limpieza</option>
        </select>
        <input style={{ ...inp, minWidth: 220 }} placeholder="Patente, empresa, CECO o quién la hizo" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} />
        <button style={btn("sec")} onClick={cargar}>Actualizar</button>
      </div>
      {error && <div style={{ color: C.rojo, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {filas === null ? <div style={{ color: C.tenue }}>Cargando…</div> : (
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
                    <td style={celda}>{AU_TIPO[x.tipo] || x.tipo}</td>
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
        {a.tipo === "vehiculo" && <div><b>Km declarado:</b> {a.km ?? "—"}</div>}
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
        <div style={{ fontWeight: 800, color: C.navy, marginBottom: 6 }}>Correos y enlaces</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff", border: `1px solid ${C.borde}` }}>
          <tbody>{cfg.map((c) => (
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
