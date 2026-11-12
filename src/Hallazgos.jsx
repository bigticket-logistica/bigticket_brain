// ═══════════════════════════════════════════════════════════════════════════
// Hallazgos.jsx — Capacidad → Hallazgos.
// Casos donde lo que cobra MELI no coincide con lo que pasó, guardados con su
// historia y sus pruebas (archivos del robot de evidencias, con sha256), para
// reclamar aunque MELI corrija o cambie su reporte después.
//   · fn_hallazgos(desde, hasta) · fn_hallazgo_estado(id, estado, nota, monto, por)
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, fechaOperativaOffset, sb } from "./shared";

const AZUL = "#002E5D";
const NARANJA = "#FF6600";
const GRIS = "#64748b";
const BORDE = "#e4e7ec";
const BUCKET = "evidencias-meli";

const TIPO = {
  cambio_placa: "Cambio de placa",
  ruta_en_otro_codigo: "Ruta anotada en otro código",
  ruta_no_acreditada: "Ruta ejecutada no acreditada",
  otro: "Otro",
};
const ESTADO = {
  detectado: ["Detectado", "#b45309", "#fef3c7"],
  reclamado: ["Reclamado", "#1d4ed8", "#dbeafe"],
  aceptado: ["Aceptado por MELI", "#047857", "#d1fae5"],
  rechazado: ["Rechazado por MELI", "#b91c1c", "#fee2e2"],
  descartado: ["Descartado", "#475569", "#f1f5f9"],
};
const EVIDENCIA = { capacidad_meli: "Reporte de Capacidad de MELI", rutas_ejecutadas_meli: "Rutas ejecutadas según MELI", rostering_deadlock: "Rostering al cierre", pedido_semanal: "Pedidos de la semana" };
const fCorta = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "");
const fHora = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const pesos = (n) => (n == null ? "" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN" }));

function Pill({ estado }) {
  const [t, c, bg] = ESTADO[estado] || [estado, GRIS, "#f1f5f9"];
  return <span style={{ background: bg, color: c, fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 10, whiteSpace: "nowrap" }}>{t}</span>;
}

function LinkEvidencia({ ev }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let vivo = true;
    sb.storage.from(BUCKET).createSignedUrl(ev.path, 3600).then(({ data }) => { if (vivo && data?.signedUrl) setUrl(data.signedUrl); });
    return () => { vivo = false; };
  }, [ev.path]);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12, padding: "3px 0" }}>
      {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: AZUL, fontWeight: 600 }}>📎 {EVIDENCIA[ev.tipo] || ev.tipo}</a> : <span style={{ color: GRIS }}>📎 {EVIDENCIA[ev.tipo] || ev.tipo}</span>}
      <span style={{ color: GRIS }}>capturado {fHora(ev.capturado_at)}</span>
      <span style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 10.5 }} title={ev.sha256}>sha256 {String(ev.sha256 || "").slice(0, 16)}…</span>
    </div>
  );
}

// Texto del reclamo, listo para pegar en el correo o el ticket a MELI
function textoReclamo(h) {
  const d = h.datos || {};
  return [
    `Reclamo hard no show SDD · ${h.sc} · ${fCorta(h.fecha_ruta)}`,
    "",
    h.historia,
    "",
    "Datos:",
    `- Placa con la que MELI cobra: ${h.placa_meli || "—"}${h.ruta_meli ? ` (ruta ${h.ruta_meli} sin ejecutar)` : " (viaje sin ruta)"}`,
    `- Camioneta y ruta que salieron: ${h.placa_torre || "—"} · ruta ${h.ruta_torre || "—"}${d.salida ? ` · salida ${d.salida}` : ""}`,
    d.paquetes_total != null ? `- Paquetes: ${d.paquetes_entregados ?? "?"} de ${d.paquetes_total} entregados (lista de rutas ejecutadas de MELI)` : null,
    d.codigo_meli ? `- MELI anotó la ruta ejecutada en el código ${d.codigo_meli}, sin pedido` : null,
    h.travel_id ? `- Viaje: ${h.travel_id}` : null,
    h.chofer ? `- Chofer: ${h.chofer}` : null,
    "",
    "Pruebas (capturas de los reportes de MELI de ese día):",
    ...(h.evidencias || []).map((e) => `- ${EVIDENCIA[e.tipo] || e.tipo}, capturado ${fHora(e.capturado_at)} · sha256 ${e.sha256}`),
  ].filter((x) => x !== null).join("\n");
}

export default function Hallazgos({ usuario }) {
  const quien = (usuario && (usuario.nombre || usuario.email)) || "Brain";
  const [desde, setDesde] = useState(fechaOperativaOffset(-45));
  const [hasta, setHasta] = useState(fechaOperativaOffset(0));
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fEstado, setFEstado] = useState("");
  const [fSc, setFSc] = useState("");
  const [abierto, setAbierto] = useState(null);
  const [copiado, setCopiado] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: err } = await sb.rpc("fn_hallazgos", { p_desde: desde, p_hasta: hasta });
    if (err) setError(err.message); else setLista(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  const scs = useMemo(() => [...new Set(lista.map((h) => h.sc))].sort(), [lista]);
  const filtrados = useMemo(() => lista.filter((h) => (!fEstado || h.estado === fEstado) && (!fSc || h.sc === fSc)), [lista, fEstado, fSc]);
  const cuenta = (e) => lista.filter((h) => h.estado === e).length;

  async function cambiarEstado(h, estado) {
    const nota = window.prompt(`Nota para "${ESTADO[estado][0]}" (opcional)`, h.nota || "");
    if (nota === null) return;
    let monto = null;
    if (estado === "reclamado" || estado === "aceptado") {
      const m = window.prompt("Monto cobrado por MELI en este caso, en pesos (opcional)", h.monto ?? "");
      if (m === null) return;
      monto = m.trim() ? Number(m.replace(/[^0-9.]/g, "")) : null;
    }
    const { error: err } = await sb.rpc("fn_hallazgo_estado", { p_id: h.id, p_estado: estado, p_nota: nota, p_monto: monto, p_por: quien });
    if (err) { alert(err.message); return; }
    cargar();
  }

  async function copiar(h) {
    try { await navigator.clipboard.writeText(textoReclamo(h)); setCopiado(h.id); setTimeout(() => setCopiado(null), 2000); }
    catch { alert(textoReclamo(h)); }
  }

  async function excel() {
    const filas = [["ID", "FECHA RUTA", "SC", "SUPERVISOR", "TIPO", "PLACA MELI", "RUTA MELI", "PLACA QUE SALIO", "RUTA QUE SALIO", "VIAJE", "CHOFER", "CODIGO MELI", "PAQUETES ENTREGADOS", "PAQUETES TOTAL", "ESTADO", "MONTO", "NOTA", "HISTORIA", "PRUEBAS (SHA256)", "CREADO POR", "CREADO EL"]];
    for (const h of filtrados) {
      const d = h.datos || {};
      filas.push([h.id, h.fecha_ruta, h.sc, h.supervisor || "", TIPO[h.tipo] || h.tipo, h.placa_meli || "", h.ruta_meli || "", h.placa_torre || "", h.ruta_torre || "", h.travel_id || "", h.chofer || "",
        d.codigo_meli || "", d.paquetes_entregados ?? "", d.paquetes_total ?? "", (ESTADO[h.estado] || [h.estado])[0], h.monto ?? "", h.nota || "", h.historia,
        (h.evidencias || []).map((e) => `${EVIDENCIA[e.tipo] || e.tipo}: ${e.sha256}`).join(" | "), h.creado_por, fHora(h.creado_at)]);
    }
    await descargarExcelMultihoja([{ nombre: "Hallazgos", datos: filas }], `hallazgos_meli_${desde}_a_${hasta}`);
  }

  const input = { border: `1px solid ${BORDE}`, borderRadius: 8, padding: "6px 8px", fontSize: 12, background: "#fff" };
  const caja = { background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14 };
  const boton = (color = AZUL) => ({ padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "none", borderRadius: 8, cursor: "pointer", background: color, color: "#fff" });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: GRIS }}>Desde<br /><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={input} /></label>
        <label style={{ fontSize: 11, color: GRIS }}>Hasta<br /><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={input} /></label>
        <label style={{ fontSize: 11, color: GRIS }}>Estado<br />
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)} style={input}><option value="">Todos</option>{Object.entries(ESTADO).map(([k, [t]]) => <option key={k} value={k}>{t} ({cuenta(k)})</option>)}</select></label>
        <label style={{ fontSize: 11, color: GRIS }}>Service Center<br />
          <select value={fSc} onChange={(e) => setFSc(e.target.value)} style={input}><option value="">Todos</option>{scs.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <button type="button" onClick={cargar} style={{ ...input, cursor: "pointer" }}>↻ Actualizar</button>
        <button type="button" onClick={excel} style={{ ...input, cursor: "pointer", fontWeight: 600 }}>⬇ Excel</button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        {[["Por reclamar", cuenta("detectado"), "#b45309"], ["Reclamados", cuenta("reclamado"), "#1d4ed8"], ["Aceptados", cuenta("aceptado"), "#047857"], ["Rechazados", cuenta("rechazado"), "#b91c1c"]].map(([t, n, c]) => (
          <div key={t} style={{ ...caja, minWidth: 150, padding: "10px 14px" }}>
            <div style={{ fontSize: 11, color: GRIS }}>{t}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: n ? c : "#94a3b8" }}>{n}</div>
          </div>
        ))}
        <div style={{ ...caja, minWidth: 180, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: GRIS }}>Monto recuperado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#047857" }}>{pesos(lista.filter((h) => h.estado === "aceptado").reduce((t, h) => t + (Number(h.monto) || 0), 0))}</div>
        </div>
      </div>

      {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {loading && <div style={{ color: GRIS, fontSize: 12 }}>Cargando…</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtrados.map((h) => {
          const d = h.datos || {};
          const ab = abierto === h.id;
          return (
            <div key={h.id} style={{ ...caja, padding: 0, overflow: "hidden" }}>
              <button type="button" onClick={() => setAbierto(ab ? null : h.id)}
                style={{ width: "100%", background: "none", border: "none", padding: "12px 14px", cursor: "pointer", display: "grid", gridTemplateColumns: "18px 110px 150px 1fr 1fr 160px", gap: 12, alignItems: "center", textAlign: "left", fontSize: 12.5 }}>
                <span style={{ color: GRIS }}>{ab ? "▼" : "▶"}</span>
                <span style={{ color: GRIS }}>{fCorta(h.fecha_ruta)}</span>
                <span><b>{h.sc}</b><div style={{ fontSize: 11, color: GRIS }}>{h.supervisor || "—"}</div></span>
                <span><b>{TIPO[h.tipo] || h.tipo}</b><div style={{ fontSize: 11, color: GRIS }}>MELI cobra {h.placa_meli || "—"} · salió {h.placa_torre || "—"}</div></span>
                <span style={{ color: "#334155" }}>{d.paquetes_total != null ? `${d.paquetes_entregados ?? "?"} de ${d.paquetes_total} paquetes entregados` : ""}{d.codigo_meli ? ` · anotada en ${d.codigo_meli}` : ""}</span>
                <span style={{ textAlign: "right" }}><Pill estado={h.estado} />{h.monto != null && <div style={{ fontSize: 11, color: GRIS, marginTop: 3 }}>{pesos(h.monto)}</div>}</span>
              </button>
              {ab && (
                <div style={{ borderTop: `1px solid ${BORDE}`, padding: "12px 14px 14px 44px", background: "#fafbfc" }}>
                  <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.55, marginBottom: 12, maxWidth: 900 }}>{h.historia}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginBottom: 12, fontSize: 12 }}>
                    {[["Placa con la que MELI cobra", `${h.placa_meli || "—"}${h.ruta_meli ? ` · ruta ${h.ruta_meli}` : " · sin ruta"}`],
                      ["Lo que salió", `${h.placa_torre || "—"} · ruta ${h.ruta_torre || "—"}${d.salida ? ` · ${d.salida}` : ""}`],
                      ["Viaje", h.travel_id || "—"], ["Chofer", h.chofer || "—"],
                      ...(d.codigo_meli ? [["MELI la anotó en", `${d.codigo_meli}, sin pedido`]] : []),
                      ...(d.placas_rostering ? [["Placas del viaje ese día", d.placas_rostering.join(" → ")]] : []),
                    ].map(([t, v]) => <div key={t}><div style={{ color: GRIS, fontSize: 11 }}>{t}</div><div style={{ fontWeight: 600, color: "#334155" }}>{v}</div></div>)}
                  </div>
                  <div style={{ fontSize: 11, color: GRIS, fontWeight: 600, marginBottom: 4 }}>PRUEBAS</div>
                  {(h.evidencias || []).length ? h.evidencias.map((e) => <LinkEvidencia key={e.id} ev={e} />) : <div style={{ fontSize: 12, color: "#b45309" }}>Sin evidencias del robot para esta fecha</div>}
                  {h.nota && <div style={{ marginTop: 10, fontSize: 12, color: "#334155" }}><b>Nota:</b> {h.nota}</div>}
                  <div style={{ fontSize: 11, color: GRIS, marginTop: 8 }}>Guardado por {h.creado_por} el {fHora(h.creado_at)}{h.actualizado_at ? ` · última actualización ${h.actualizado_por} el ${fHora(h.actualizado_at)}` : ""}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => copiar(h)} style={boton(NARANJA)}>{copiado === h.id ? "✓ Copiado" : "Copiar para MELI"}</button>
                    {h.estado !== "reclamado" && <button type="button" onClick={() => cambiarEstado(h, "reclamado")} style={boton("#1d4ed8")}>Marcar reclamado</button>}
                    {h.estado !== "aceptado" && <button type="button" onClick={() => cambiarEstado(h, "aceptado")} style={boton("#047857")}>MELI aceptó</button>}
                    {h.estado !== "rechazado" && <button type="button" onClick={() => cambiarEstado(h, "rechazado")} style={boton("#b91c1c")}>MELI rechazó</button>}
                    {h.estado !== "descartado" && <button type="button" onClick={() => cambiarEstado(h, "descartado")} style={boton("#64748b")}>Descartar</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!loading && !filtrados.length && <div style={{ ...caja, color: GRIS, textAlign: "center", fontSize: 12 }}>Sin hallazgos en este rango.</div>}
      </div>
    </div>
  );
}
