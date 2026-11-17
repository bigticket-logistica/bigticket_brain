// ═══════════════════════════════════════════════════════════════════════════
// NoSalidas.jsx — "No Salidas a Ruta" de la Bitácora, visto desde el Brain.
// Lo usan Administración → Consolidaciones Bitácora (Pagos.jsx), el Pool
// (Indicadores Operacionales MX) y Capacidad. Un solo código para los tres.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { sb } from "./shared";

const BUCKET_BITACORA = "bitacora-cancelaciones-meli";

function FotoLink({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data, error } = await sb.storage.from(BUCKET_BITACORA).createSignedUrl(path, 3600);
        if (cancel) return;
        if (error || !data?.signedUrl) setErr(true);
        else setUrl(data.signedUrl);
      } catch { if (!cancel) setErr(true); }
    })();
    return () => { cancel = true; };
  }, [path]);

  const nombre = String(path).split("/").pop();
  const esPdf = /\.pdf$/i.test(nombre);
  if (err) return <span style={{ fontSize: 11, color: "#dc2626" }}>⚠ {nombre} (no disponible)</span>;
  if (!url) return <span style={{ fontSize: 11, color: "#9ca3af" }}>Cargando {nombre}…</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#1e3a5f", textDecoration: "none", border: "1px solid #d1d5db", borderRadius: 5, padding: "3px 8px", marginRight: 6, marginBottom: 4, background: "#fff" }}>
      {esPdf ? "📄" : "🖼"} {nombre.length > 22 ? nombre.slice(0, 22) + "…" : nombre}
    </a>
  );
}

// ── No Salidas a Ruta (Bitácora, desde nov-2026) ─────────────────────────
// Rutas que no salieron (no rosterizadas o rosterizadas sin ruta, según la
// Torre) y lo que respondió el supervisor al día siguiente. Fuente:
// fn_no_salidas_dia (vw_torre_control_dia + bitacora_no_salidas_mx).
// Primera bitácora con el ítem: la del 5-nov-2026 (responde las rutas del 4-nov).
// Antes de esa fecha el panel no muestra no salidas pendientes.
const NOSAL_DESDE = "2026-11-05";
const NOSAL_CASO = { sin_rostering: "No rosterizada", sin_salida: "Rosterizada sin ruta" };
const NOSAL_MOTIVO = { no_show: "No Show", cancelacion: "Cancelación", si_salio: "Sí salió a ruta", otros: "Otros" };
const NOSAL_COLOR = { no_show: "#b91c1c", cancelacion: "#b45309", si_salio: "#047857", otros: "#475569" };
// Motivo detallado (etiqueta) que elige el supervisor para No Show y Cancelación
const NOSAL_ETIQUETA = {
  falla_mecanica: "Falla mecánica", llegada_tarde: "Llegada tarde", baja_proveedor: "Baja de proveedor",
  bloqueo_pausa_driver: "Bloqueo o pausa del driver", no_se_presento: "No se presentó", indicacion_otr: "Indicación de OTR",
  bajo_volumen: "Bajo volumen", cambio_eta: "Cambio de ETA", reasignacion_otra_mlp: "Reasignación de ruta a otra MLP", otros: "Otros",
};
const etiquetaNosal = (k) => (k ? NOSAL_ETIQUETA[k] || k : "");

// sc (opcional): si viene, el SC va dentro de la cabecera y el bloque se ve como
// una tarjeta propia (Capacidad lista varios SC uno tras otro).
function NoSalidasSC({ filas = [], fechaRuta, noAplica = false, abiertoInicial = false, sc = null }) {
  if (noAplica) return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb", fontSize: 12, color: "#9ca3af" }}>
      🚫 No Salidas a Ruta: este ítem existe desde la bitácora del {NOSAL_DESDE}. Para días anteriores ve Cancelaciones y No Show en el formulario.
    </div>
  );
  // Contraída por defecto: se ve el resumen (rutas y sin responder) y se abre con el botón
  const [abierto, setAbierto] = useState(abiertoInicial);
  // Biggy (opinión sobre la prueba) y correo enviado, por ruta: vienen de vw_nosal_consolidado
  const [extra, setExtra] = useState({});
  const ids = filas.filter((f) => f.motivo === "no_show" || f.motivo === "cancelacion").map((f) => String(f.travel_id));
  const clave = ids.join(",");
  useEffect(() => {
    if (!abierto || !ids.length) return;
    let cancel = false;
    sb.from("vw_nosal_consolidado")
      .select("travel_id, fecha, sc, biggy_veredicto, biggy_detalle, justificacion_prueba, biggy_codigo, correo_estado, correo_enviado_at, correo_detalle")
      .in("travel_id", ids)
      .then(({ data }) => {
        if (cancel) return;
        const m = {};
        for (const x of data || []) m[String(x.travel_id)] = x;
        setExtra(m);
      });
    return () => { cancel = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, clave]);
  const resp = filas.filter((f) => f.guardado_at).length;
  const pend = filas.length - resp;
  const fh = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const color = filas.length === 0 ? "#cbd5e1" : pend > 0 ? "#dc2626" : "#16a34a";
  const contenedor = sc
    ? { marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 12px", background: "#fff", boxShadow: `inset 4px 0 0 ${color}` }
    : { marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" };
  return (
    <div style={contenedor}>
      <button onClick={() => setAbierto((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 700, color: "#374151", textAlign: "left" }}>
        <span style={{ color: "#94a3b8", width: 10 }}>{abierto ? "▼" : "▶"}</span>
        {sc && <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "#1e3a5f", borderRadius: 5, padding: "2px 8px", fontFamily: "monospace" }}>{sc}</span>}
        <span>🚫 No Salidas a Ruta del {fechaRuta}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>· {filas.length} {filas.length === 1 ? "ruta" : "rutas"}</span>
        {pend > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: "#dc2626", borderRadius: 4, padding: "1px 7px" }}>{pend} sin responder</span>}
        {filas.length > 0 && pend === 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#166534", background: "#dcfce7", borderRadius: 4, padding: "1px 7px" }}>{resp} de {filas.length} respondidas</span>}
        {pend > 0 && resp > 0 && <span style={{ fontSize: 10.5, fontWeight: 600, color: "#64748b" }}>{resp} respondidas</span>}
        <span style={{ fontSize: 10, fontWeight: 500, color: "#9ca3af" }}>las responde el supervisor en su bitácora</span>
        {filas.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#1e3a5f", textDecoration: "underline", textUnderlineOffset: 3 }}>{abierto ? "Ocultar detalle ▴" : "Ver detalle ▾"}</span>}
      </button>
      {abierto && (filas.length === 0 ? (
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>Ese día no hubo rutas sin salir en este SC.</div>
      ) : (
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead><tr style={{ background: "#f8fafc", color: "#64748b", textAlign: "left" }}>
              {["Placa / chofer", "Caso", "Qué pasó", "Tipo", "Vehículo", "Empresa", "Motivo / comentario", "Pruebas", "Biggy", "Correo", "Respondió"].map((h) => (
                <th key={h} style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.travel_id} style={{ borderTop: "1px solid #eef0f3", background: f.guardado_at ? "#fff" : "#fff7ed", verticalAlign: "top" }}>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{f.placa || "Sin placa"}</span>
                    <div style={{ color: "#6b7280" }}>{f.chofer || "Sin chofer"}{f.eta ? ` · ${String(f.eta).slice(0, 5)}` : ""}</div>
                  </td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{NOSAL_CASO[f.caso] || f.caso}<div style={{ color: "#9ca3af", fontSize: 10 }}>{f.estado}</div></td>
                  <td style={{ padding: "6px 8px" }}>
                    {f.motivo
                      ? <b style={{ color: NOSAL_COLOR[f.motivo] || "#374151" }}>{NOSAL_MOTIVO[f.motivo] || f.motivo}</b>
                      : <span style={{ color: "#dc2626", fontWeight: 700 }}>Sin responder</span>}
                    {f.motivo === "si_salio" && f.ruta_declarada && <div style={{ color: "#6b7280" }}>Ruta {f.ruta_declarada}</div>}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{f.tipo_ruta === "SPOT" ? "Spot" : f.tipo_ruta || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>{f.vehiculo || "—"}{f.vehiculo_meli && <div style={{ color: "#9ca3af", fontSize: 10 }}>MELI: {f.vehiculo_meli}</div>}</td>
                  <td style={{ padding: "6px 8px" }}>{f.empresa || "—"}{f.empresa && !f.tercero_id && <div style={{ color: "#b45309", fontSize: 10 }}>escrita a mano</div>}</td>
                  <td style={{ padding: "6px 8px", minWidth: 160 }}>
                    {f.etiqueta && <b style={{ color: f.etiqueta === "otros" ? "#475569" : "#374151" }}>{etiquetaNosal(f.etiqueta)}</b>}
                    {f.comentario && <div style={{ color: "#6b7280", whiteSpace: "pre-wrap" }}>{f.comentario}</div>}
                    {!f.etiqueta && !f.comentario && <span style={{ color: "#9ca3af" }}>—</span>}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    {(Array.isArray(f.adjuntos) ? f.adjuntos : []).map((a, i) => <FotoLink key={i} path={typeof a === "string" ? a : a?.path} />)}
                    {!(Array.isArray(f.adjuntos) && f.adjuntos.length) && <span style={{ color: "#9ca3af" }}>—</span>}
                  </td>
                  {(() => {
                    const x = extra[String(f.travel_id)];
                    const aplica = f.motivo === "no_show" || f.motivo === "cancelacion";
                    const bg = { sirve: ["✓ sirve", "#166534", "#dcfce7"], no_sirve: ["⚠ no sirve", "#9a3412", "#ffedd5"], sin_revision: ["sin revisión", "#64748b", "#f1f5f9"] }[x?.biggy_veredicto];
                    const co = { enviado: ["✓ enviado", "#166534"], error: ["✕ error", "#b91c1c"], en_cola: ["en cola", "#64748b"], apagado: ["apagado", "#64748b"] }[x?.correo_estado];
                    const chip = (t, c, b) => <span style={{ fontSize: 10.5, fontWeight: 700, color: c, background: b || "transparent", borderRadius: 4, padding: b ? "1px 6px" : 0, whiteSpace: "nowrap" }}>{t}</span>;
                    return (<>
                      <td style={{ padding: "6px 8px", minWidth: 170 }}>
                        {!aplica ? <span style={{ color: "#9ca3af" }}>—</span> : bg ? chip(bg[0], bg[1], bg[2]) : <span style={{ color: "#9ca3af" }} title="Guardado antes de que Biggy revisara las pruebas">sin revisión</span>}
                        {x?.biggy_detalle?.resumen && <div style={{ color: "#6b7280", marginTop: 3 }}>{x.biggy_detalle.resumen}</div>}
                        {x?.justificacion_prueba && <div style={{ color: "#9a3412", marginTop: 3 }}>Supervisor: {x.justificacion_prueba}</div>}
                        {x?.biggy_codigo && <div style={{ color: "#64748b", marginTop: 3 }}>Timemark: <b>{x.biggy_codigo}</b></div>}
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                        {!aplica ? <span style={{ color: "#9ca3af" }}>—</span> : co ? chip(co[0], co[1]) : <span style={{ color: "#9ca3af" }} title="Guardado antes de activar los correos">sin correo</span>}
                        {x?.correo_enviado_at && <div style={{ color: "#94a3b8", fontSize: 10 }}>{fh(x.correo_enviado_at)}</div>}
                        {x?.correo_estado === "error" && x.correo_detalle && <div style={{ color: "#b91c1c", fontSize: 10, maxWidth: 180, whiteSpace: "normal" }}>{x.correo_detalle}</div>}
                      </td>
                    </>);
                  })()}
                  <td style={{ padding: "6px 8px", color: "#6b7280", whiteSpace: "nowrap" }}>{f.guardado_por || "—"}<div style={{ fontSize: 10 }}>{fh(f.guardado_at)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}


export { NOSAL_DESDE, NOSAL_CASO, NOSAL_MOTIVO, NOSAL_COLOR, NOSAL_ETIQUETA, etiquetaNosal, NoSalidasSC, FotoLink, BUCKET_BITACORA };
