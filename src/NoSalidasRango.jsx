// ═══════════════════════════════════════════════════════════════════════════
// NoSalidasRango.jsx — Consolidaciones Bitácora › "Cancelaciones y No Show"
// Todas las Cancelaciones y No Show que justificaron los supervisores en
// "No Salidas a Ruta", en un rango de fechas (desde el 6-nov-2026), en una
// sola tabla: fecha, SC, placa, motivo y comentario, empresa, fotos, la opinión
// de Biggy con la justificación del supervisor y si salió el correo.
// Fuente: vw_nosal_consolidado (bitacora_no_salidas_mx + correos_nosal_log).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, fechaHoyOperativa, sb } from "./shared";
import { FotoLink, etiquetaNosal } from "./NoSalidas";

const DESDE_INICIO = "2026-11-06";
const TIPO = { no_show: "No Show", cancelacion: "Cancelación" };
const TIPO_COLOR = { no_show: "#b91c1c", cancelacion: "#b45309" };
const BIGGY = { sirve: ["✓ sirve", "#166534", "#dcfce7"], no_sirve: ["⚠ no sirve", "#9a3412", "#ffedd5"], sin_revision: ["sin revisión", "#64748b", "#f1f5f9"] };
const CORREO = { enviado: ["✓ enviado", "#166534"], error: ["✕ error", "#b91c1c"], en_cola: ["en cola", "#64748b"], apagado: ["apagado", "#64748b"] };
const fh = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const arr = (v) => (Array.isArray(v) ? v : []);

export default function NoSalidasRango() {
  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState(DESDE_INICIO);
  const [hasta, setHasta] = useState(fechaHoyOperativa());
  const [sc, setSc] = useState("");
  const [tipo, setTipo] = useState("");
  const [filas, setFilas] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!abierto) return;
    (async () => {
      setFilas(null); setErr("");
      const { data, error } = await sb.from("vw_nosal_consolidado").select("*").gte("fecha", desde).lte("fecha", hasta)
        .order("fecha", { ascending: false }).order("sc").limit(5000);
      if (error) { setErr(error.message); setFilas([]); return; }
      setFilas(data || []);
    })();
  }, [abierto, desde, hasta]);

  const scs = useMemo(() => [...new Set((filas || []).map((f) => f.sc))].sort(), [filas]);
  const vis = useMemo(() => (filas || []).filter((f) => (!sc || f.sc === sc) && (!tipo || f.motivo === tipo)), [filas, sc, tipo]);
  const n = (fn) => vis.filter(fn).length;

  const descargar = () => descargarExcelMultihoja([{ nombre: "Cancelaciones y No Show", datos: [
    ["FECHA RUTA", "SC", "PLACA", "TIPO", "MOTIVO", "COMENTARIO", "EMPRESA", "PRUEBAS", "BIGGY", "JUSTIFICACION SUPERVISOR", "CODIGO TIMEMARK", "CORREO", "CORREO A", "RESPONDIDO POR", "RESPONDIDO EL"],
    ...vis.map((f) => [f.fecha, f.sc, f.placa || "", TIPO[f.motivo] || f.motivo, etiquetaNosal(f.etiqueta), f.comentario || "", f.empresa || "",
      arr(f.adjuntos).length, f.biggy_veredicto || "", f.justificacion_prueba || "", f.biggy_codigo || "",
      f.correo_estado || "", f.correo_para || "", f.guardado_por || f.por || "", f.guardado_at ? new Date(f.guardado_at).toLocaleString("es-MX", { timeZone: "America/Mexico_City" }) : ""]),
  ] }], `cancelaciones_noshow_${desde}_${hasta}${sc ? "_" + sc : ""}`);

  const inp = { padding: "5px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 12.5 };
  const th = { padding: "7px 8px", fontWeight: 700, color: "#fff", background: "#1e3a5f", textAlign: "left", whiteSpace: "nowrap", fontSize: 11 };
  const td = { padding: "7px 8px", borderTop: "1px solid #eef0f3", verticalAlign: "top", fontSize: 11.5 };
  const chip = (txt, color, bg) => <span style={{ fontSize: 10.5, fontWeight: 700, color, background: bg || "transparent", borderRadius: 4, padding: bg ? "1px 6px" : 0, whiteSpace: "nowrap" }}>{txt}</span>;

  return (
    <div className="form-card" style={{ marginBottom: 12 }}>
      <button onClick={() => setAbierto((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 14, fontWeight: 700, color: "#1e3a5f" }}>
        <span>{abierto ? "▼" : "▶"}</span> 🚫 Cancelaciones y No Show
        <span style={{ fontSize: 11.5, fontWeight: 500, color: "#64748b" }}>· todo lo que justificaron los supervisores, con comentarios, fotos, Biggy y correo</span>
      </button>
      {abierto && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={inp} /></label>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: "#374151" }}>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={inp} /></label>
            <select value={sc} onChange={(e) => setSc(e.target.value)} style={inp}><option value="">Todos los SC</option>{scs.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inp}><option value="">No Show y Cancelación</option><option value="no_show">Solo No Show</option><option value="cancelacion">Solo Cancelación</option></select>
            <button onClick={descargar} disabled={!vis.length} style={{ padding: "6px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: "pointer", opacity: vis.length ? 1 : 0.6 }}>⬇ Excel</button>
            {filas && <span style={{ marginLeft: "auto", fontSize: 12, color: "#374151" }}>
              <b>{vis.length}</b> casos · <b style={{ color: TIPO_COLOR.no_show }}>{n((f) => f.motivo === "no_show")}</b> No Show · <b style={{ color: TIPO_COLOR.cancelacion }}>{n((f) => f.motivo === "cancelacion")}</b> Cancelaciones · <b>{n((f) => f.biggy_veredicto === "no_sirve")}</b> con prueba dudosa · <b>{n((f) => f.correo_estado === "error")}</b> correos con error
            </span>}
          </div>
          {err && <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8 }}>No se pudo cargar: {err}</div>}
          {filas === null ? <div style={{ fontSize: 12, color: "#64748b" }}>Cargando…</div>
            : vis.length === 0 ? <div style={{ fontSize: 12, color: "#64748b" }}>No hay casos en ese rango.</div> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                  <thead><tr>{["Fecha ruta", "SC", "Placa", "Tipo", "Motivo / comentario", "Empresa", "Pruebas", "Biggy", "Correo", "Respondió"].map((h, i) => (
                    <th key={h} style={{ ...th, borderRadius: i === 0 ? "6px 0 0 6px" : i === 9 ? "0 6px 6px 0" : 0 }}>{h}</th>))}</tr></thead>
                  <tbody>
                    {vis.map((f) => {
                      const bg = BIGGY[f.biggy_veredicto];
                      const co = CORREO[f.correo_estado];
                      return (
                        <tr key={`${f.fecha}-${f.sc}-${f.travel_id}`}>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{f.fecha}</td>
                          <td style={{ ...td, fontWeight: 700, color: "#1e3a5f" }}>{f.sc}</td>
                          <td style={{ ...td, fontFamily: "monospace", fontWeight: 700 }}>{f.placa || "—"}<div style={{ fontFamily: "inherit", fontWeight: 400, color: "#94a3b8", fontSize: 10 }}>ruta {f.travel_id}</div></td>
                          <td style={td}>{chip(TIPO[f.motivo] || f.motivo, TIPO_COLOR[f.motivo] || "#374151")}</td>
                          <td style={{ ...td, minWidth: 200 }}>
                            {f.etiqueta && <b style={{ color: "#374151" }}>{etiquetaNosal(f.etiqueta)}</b>}
                            {f.comentario && <div style={{ color: "#6b7280", whiteSpace: "pre-wrap" }}>{f.comentario}</div>}
                            {!f.etiqueta && !f.comentario && <span style={{ color: "#9ca3af" }}>—</span>}
                          </td>
                          <td style={td}>{f.empresa || "—"}</td>
                          <td style={td}>{arr(f.adjuntos).length ? arr(f.adjuntos).map((a, i) => <FotoLink key={i} path={typeof a === "string" ? a : a?.path} />) : <span style={{ color: "#9ca3af" }}>—</span>}</td>
                          <td style={{ ...td, minWidth: 150 }}>
                            {bg ? chip(bg[0], bg[1], bg[2]) : <span style={{ color: "#9ca3af" }}>—</span>}
                            {f.biggy_detalle?.resumen && <div style={{ color: "#6b7280", marginTop: 3 }}>{f.biggy_detalle.resumen}</div>}
                            {f.justificacion_prueba && <div style={{ color: "#9a3412", marginTop: 3 }}>Supervisor: {f.justificacion_prueba}</div>}
                            {f.biggy_codigo && <div style={{ color: "#64748b", marginTop: 3 }}>Timemark: <b>{f.biggy_codigo}</b></div>}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            {co ? chip(co[0], co[1]) : <span style={{ color: "#9ca3af" }} title="Guardado antes de activar los correos">sin correo</span>}
                            {f.correo_enviado_at && <div style={{ color: "#94a3b8", fontSize: 10 }}>{fh(f.correo_enviado_at)}</div>}
                            {f.correo_estado === "error" && f.correo_detalle && <div style={{ color: "#b91c1c", fontSize: 10, maxWidth: 180, whiteSpace: "normal" }}>{f.correo_detalle}</div>}
                          </td>
                          <td style={{ ...td, color: "#6b7280", whiteSpace: "nowrap" }}>{f.guardado_por || f.por || "—"}<div style={{ fontSize: 10 }}>{fh(f.guardado_at)}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
