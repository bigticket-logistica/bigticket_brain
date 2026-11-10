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

function NoSalidasSC({ filas = [], fechaRuta, noAplica = false, abiertoInicial = false }) {
  if (noAplica) return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb", fontSize: 12, color: "#9ca3af" }}>
      🚫 No Salidas a Ruta: este ítem existe desde la bitácora del {NOSAL_DESDE}. Para días anteriores ve Cancelaciones y No Show en el formulario.
    </div>
  );
  // Contraída por defecto: se ve el resumen (rutas y sin responder) y se abre con el botón
  const [abierto, setAbierto] = useState(abiertoInicial);
  const resp = filas.filter((f) => f.guardado_at).length;
  const pend = filas.length - resp;
  const fh = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <button onClick={() => setAbierto((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, fontWeight: 700, color: "#374151" }}>
        <span>{abierto ? "▼" : "▶"}</span>
        🚫 3 · No Salidas a Ruta del {fechaRuta}
        <span style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af" }}>(se responden en esta bitácora)</span>
        {pend > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#dc2626", borderRadius: 4, padding: "1px 6px" }}>{pend} sin responder</span>}
        {filas.length > 0 && pend === 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#166534", background: "#dcfce7", borderRadius: 4, padding: "1px 6px" }}>todas respondidas</span>}
      </button>
      {abierto && (filas.length === 0 ? (
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>Ese día no hubo rutas sin salir en este SC.</div>
      ) : (
        <div style={{ marginTop: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead><tr style={{ background: "#f8fafc", color: "#64748b", textAlign: "left" }}>
              {["Placa / chofer", "Caso", "Qué pasó", "Tipo", "Vehículo", "Empresa", "Motivo / comentario", "Pruebas", "Respondió"].map((h) => (
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
