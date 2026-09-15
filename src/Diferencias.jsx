// ═══════════════════════════════════════════════════════════════════════════
// Diferencias.jsx — Bandeja de reclamos que levantan los terceros desde su
// portal, sobre pagos y cobros.
//
// Cada caso tiene folio, líneas (rutas, cobros, o rutas que faltan), evidencia
// y una bitácora completa. El analista resuelve línea por línea: lo aceptado
// no reabre el pasado, viaja como ajuste a la prefactura vigente.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";

const ESTADOS = {
  abierta:     { l: "Abierta",     bg: "#fef3c7", fg: "#92400e" },
  en_revision: { l: "En revisión", bg: "#dbeafe", fg: "#1e40af" },
  aceptada:    { l: "Aceptada",    bg: "#dcfce7", fg: "#166534" },
  parcial:     { l: "Parcial",     bg: "#e0e7ff", fg: "#3730a3" },
  rechazada:   { l: "Rechazada",   bg: "#fee2e2", fg: "#991b1b" },
  vencida:     { l: "Vencida",     bg: "#f1f5f9", fg: "#64748b" },
};
const TIPO_LINEA = { ruta: "Ruta", cobro: "Cobro", faltante: "Ruta faltante" };

const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fechaHora = (s) => s ? new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const dias = (s) => s ? Math.floor((Date.now() - new Date(s).getTime()) / 86400000) : 0;

export default function Diferencias({ usuario }) {
  const [filtro, setFiltro] = useState("pendientes");
  const [casos, setCasos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sel, setSel] = useState(null);   // caso abierto (con líneas y eventos)
  const quien = (usuario && (usuario.email || usuario.nombre)) || "brain";

  const cargar = useCallback(async () => {
    setCargando(true);
    let q = sb.from("diferencias")
      .select("*, terceros(nombre), diferencias_lineas(id, tipo, estado, monto_ref)")
      .order("creada_at", { ascending: false });
    if (filtro === "pendientes") q = q.in("estado", ["abierta", "en_revision"]);
    else if (filtro !== "todas") q = q.eq("estado", filtro);
    const { data, error } = await q;
    if (error) console.error(error);
    setCasos(data || []);
    setCargando(false);
  }, [filtro]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async (caso) => {
    const [lin, ev, adj] = await Promise.all([
      sb.from("diferencias_lineas").select("*").eq("diferencia_id", caso.id),
      sb.from("diferencias_eventos").select("*").eq("diferencia_id", caso.id).order("created_at"),
      sb.from("diferencias_adjuntos").select("*").eq("diferencia_id", caso.id),
    ]);
    setSel({ ...caso, lineas: lin.data || [], eventos: ev.data || [], adjuntos: adj.data || [] });
  };

  const pendientes = casos.filter(c => ["abierta", "en_revision"].includes(c.estado)).length;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>Diferencias</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Reclamos de los terceros sobre pagos y cobros. Lo aceptado entra como ajuste en la prefactura vigente.
          </div>
        </div>
        {pendientes > 0 && (
          <span style={{ background: "#fef3c7", color: "#92400e", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 14 }}>
            {pendientes} sin resolver
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {[["pendientes", "Sin resolver"], ["aceptada", "Aceptadas"], ["parcial", "Parciales"],
          ["rechazada", "Rechazadas"], ["todas", "Todas"]].map(([id, l]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{
              padding: "6px 14px", borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1px solid " + (filtro === id ? "#1a3a6b" : "#e4e7ec"),
              background: filtro === id ? "#1a3a6b" : "#fff", color: filtro === id ? "#fff" : "#64748b",
            }}>{l}</button>
        ))}
        <button onClick={cargar} style={{ padding: "6px 14px", borderRadius: 16, fontSize: 12, border: "1px solid #e4e7ec", background: "#fff", color: "#64748b", cursor: "pointer" }}>
          ↻ Actualizar
        </button>
      </div>

      {cargando ? (
        <div style={{ color: "#94a3b8", fontSize: 13, padding: 40, textAlign: "center" }}>Cargando…</div>
      ) : casos.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          No hay diferencias {filtro === "pendientes" ? "sin resolver" : "en este filtro"}.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "70px 1.6fr 90px 1fr 110px 110px 100px", gap: 10, padding: "9px 14px", background: "#f8fafc", fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>
            <span>Folio</span><span>Empresa</span><span>SC</span><span>Líneas</span>
            <span style={{ textAlign: "right" }}>Reclamado</span><span>Estado</span><span>Antigüedad</span>
          </div>
          {casos.map(c => {
            const e = ESTADOS[c.estado] || ESTADOS.abierta;
            const d = dias(c.creada_at);
            const sinResolver = ["abierta", "en_revision"].includes(c.estado);
            return (
              <button key={c.id} onClick={() => abrir(c)}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "70px 1.6fr 90px 1fr 110px 110px 100px", gap: 10, padding: "11px 14px", borderTop: "1px solid #f1f5f9", background: "#fff", border: "none", borderLeft: "3px solid " + (sinResolver && d >= 3 ? "#dc2626" : "transparent"), textAlign: "left", fontSize: 12, alignItems: "center", cursor: "pointer" }}>
                <span style={{ fontWeight: 700, color: "#1a3a6b" }}>#{c.folio}</span>
                <span style={{ color: "#334155" }}>{c.terceros?.nombre || "—"}</span>
                <span style={{ color: "#64748b" }}>{c.service_center || "varios"}</span>
                <span style={{ color: "#64748b" }}>
                  {(c.diferencias_lineas || []).length} línea(s)
                  {" · "}
                  {[...new Set((c.diferencias_lineas || []).map(l => TIPO_LINEA[l.tipo]))].join(", ")}
                </span>
                <span style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(c.monto_reclamado)}</span>
                <span><span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: e.bg, color: e.fg }}>{e.l}</span></span>
                <span style={{ color: sinResolver && d >= 3 ? "#dc2626" : "#94a3b8", fontWeight: sinResolver && d >= 3 ? 700 : 400 }}>
                  {d === 0 ? "hoy" : `${d} día${d > 1 ? "s" : ""}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {sel && <DetalleCaso caso={sel} quien={quien} onCerrar={() => setSel(null)} onCambio={async () => { await cargar(); setSel(null); }} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function DetalleCaso({ caso, quien, onCerrar, onCambio }) {
  const [lineas, setLineas] = useState(caso.lineas);
  const [eventos, setEventos] = useState(caso.eventos);
  const [nota, setNota] = useState("");
  const [interna, setInterna] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  const pendientes = lineas.filter(l => l.estado === "pendiente").length;
  const reconocido = lineas.reduce((s, l) => s + Number(l.monto_reconocido || 0), 0);

  const evento = async (tipo, detalle, visible = true) =>
    sb.from("diferencias_eventos").insert({ diferencia_id: caso.id, tipo, detalle, actor: quien, visible_tercero: visible });

  const resolverLinea = async (l, estado) => {
    let monto = null, resolucion = "";
    if (estado === "aceptada") {
      const m = prompt(`Aceptar la línea (${TIPO_LINEA[l.tipo]} ${l.id_ruta || l.placa}).\n\nMonto a reconocer — entra como ajuste en la prefactura vigente:`, l.monto_ref || "");
      if (m === null) return;
      monto = Number(String(m).replace(/[^\d.\-]/g, ""));
      if (!isFinite(monto)) { alert("Monto inválido."); return; }
    }
    resolucion = prompt(`Respuesta para el tercero (la va a leer en su portal):`, "");
    if (resolucion === null) return;
    if (!resolucion.trim()) { alert("La respuesta es obligatoria: un 'rechazado' sin explicación mata el canal."); return; }

    setTrabajando(true);
    const { error } = await sb.from("diferencias_lineas")
      .update({ estado, monto_reconocido: monto, resolucion: resolucion.trim() }).eq("id", l.id);
    if (error) { alert("No se pudo guardar: " + error.message); setTrabajando(false); return; }
    await evento(estado === "aceptada" ? "linea_aceptada" : "linea_rechazada",
      `${TIPO_LINEA[l.tipo]} ${l.id_ruta || l.placa || ""}: ${resolucion.trim()}${monto ? ` · ${money(monto)}` : ""}`);
    const { data } = await sb.from("diferencias_lineas").select("*").eq("diferencia_id", caso.id);
    setLineas(data || []);
    const { data: ev } = await sb.from("diferencias_eventos").select("*").eq("diferencia_id", caso.id).order("created_at");
    setEventos(ev || []);
    setTrabajando(false);
  };

  const cerrarCaso = async () => {
    const acept = lineas.filter(l => l.estado === "aceptada").length;
    const rech = lineas.filter(l => l.estado === "rechazada").length;
    const estado = acept === 0 ? "rechazada" : rech === 0 ? "aceptada" : "parcial";
    const semana = prompt(`Cerrar la diferencia #${caso.folio} como ${estado.toUpperCase()}.\n\n${acept} aceptada(s) · ${rech} rechazada(s) · ${money(reconocido)} reconocido\n\n¿En qué semana de prefactura entra el ajuste? (vacío si no aplica)`, "");
    if (semana === null) return;
    setTrabajando(true);
    const { error } = await sb.from("diferencias").update({
      estado, monto_reconocido: reconocido, ajuste_semana: semana.trim() || null,
      resuelta_por: quien, resuelta_at: new Date().toISOString(),
    }).eq("id", caso.id);
    if (error) { alert("No se pudo cerrar: " + error.message); setTrabajando(false); return; }
    await evento("cerrada", `Cerrada como ${estado}${semana.trim() ? ` · ajuste en semana ${semana.trim()}` : ""} · ${money(reconocido)} reconocido`);
    setTrabajando(false);
    onCambio();
  };

  const agregarNota = async () => {
    if (!nota.trim()) return;
    await evento("comentario", nota.trim(), !interna);
    const { data: ev } = await sb.from("diferencias_eventos").select("*").eq("diferencia_id", caso.id).order("created_at");
    setEventos(ev || []); setNota("");
  };

  const verAdjunto = async (a) => {
    const { data } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(a.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else alert("No se pudo abrir el adjunto.");
  };

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(760px, 100%)", background: "#f8fafc", height: "100%", overflowY: "auto" }}>
        <div style={{ background: "#1a3a6b", color: "#fff", padding: "16px 20px", position: "sticky", top: 0, zIndex: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Diferencia #{caso.folio}</div>
              <div style={{ fontSize: 12.5, color: "#b8c6de", marginTop: 2 }}>
                {caso.terceros?.nombre} · {caso.service_center || "varios SC"} · abierta {fechaHora(caso.creada_at)}
              </div>
            </div>
            <button onClick={onCerrar} style={{ background: "#24457a", color: "#fff", border: "none", borderRadius: 6, width: 30, height: 30, fontSize: 16, cursor: "pointer" }}>×</button>
          </div>
        </div>

        <div style={{ padding: 18 }}>
          {/* Líneas */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            Qué reclama ({lineas.length})
          </div>
          {lineas.map(l => {
            const resuelta = l.estado !== "pendiente";
            return (
              <div key={l.id} style={{ background: "#fff", border: "1px solid " + (resuelta ? "#e4e7ec" : "#fcd34d"), borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 3, background: "#e2e8f0", color: "#475569" }}>
                      {TIPO_LINEA[l.tipo]}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#334155", marginLeft: 8 }}>{l.placa || "—"}</span>
                    <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>
                      {l.id_ruta ? `Ruta ${l.id_ruta}` : l.cobro_id ? `Cobro ${l.cobro_id}` : ""} · {l.fecha || "sin fecha"}
                    </span>
                  </div>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>
                    {l.monto_ref != null ? money(l.monto_ref) : "—"}
                  </span>
                </div>

                <div style={{ marginTop: 8, background: "#f8fafc", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, color: "#334155" }}>
                  {l.comentario}
                </div>

                {resuelta ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: l.estado === "aceptada" ? "#166534" : "#991b1b" }}>
                    <b>{l.estado === "aceptada" ? "Aceptada" : "Rechazada"}{l.monto_reconocido ? ` · ${money(l.monto_reconocido)}` : ""}:</b> {l.resolucion}
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                    <button onClick={() => resolverLinea(l, "aceptada")} disabled={trabajando}
                      style={{ border: "none", background: "#16a34a", color: "#fff", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                      Aceptar
                    </button>
                    <button onClick={() => resolverLinea(l, "rechazada")} disabled={trabajando}
                      style={{ border: "1px solid #fca5a5", background: "#fff", color: "#991b1b", fontSize: 11.5, fontWeight: 700, borderRadius: 4, padding: "6px 14px", cursor: "pointer" }}>
                      Rechazar
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Evidencia */}
          {caso.adjuntos.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", margin: "14px 0 8px" }}>Evidencia</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {caso.adjuntos.map(a => (
                  <button key={a.id} onClick={() => verAdjunto(a)}
                    style={{ border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, padding: "7px 12px", fontSize: 12, color: "#1a3a6b", cursor: "pointer" }}>
                    📎 {a.nombre || "adjunto"}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Cerrar */}
          {["abierta", "en_revision"].includes(caso.estado) && (
            <button onClick={cerrarCaso} disabled={pendientes > 0 || trabajando}
              style={{ width: "100%", marginTop: 14, padding: "11px", borderRadius: 6, border: "none", background: pendientes > 0 ? "#cbd5e1" : "#1a3a6b", color: "#fff", fontSize: 13, fontWeight: 700, cursor: pendientes > 0 ? "not-allowed" : "pointer" }}>
              {pendientes > 0 ? `Falta resolver ${pendientes} línea(s)` : `Cerrar la diferencia · ${money(reconocido)} reconocido`}
            </button>
          )}

          {/* Bitácora */}
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", margin: "18px 0 8px" }}>Bitácora del caso</div>
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
            {eventos.map(ev => (
              <div key={ev.id} style={{ padding: "9px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#334155" }}>
                    {ev.tipo.replace(/_/g, " ")}
                    {!ev.visible_tercero && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, background: "#e2e8f0", color: "#64748b", padding: "1px 6px", borderRadius: 3 }}>INTERNA</span>}
                  </span>
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>{fechaHora(ev.created_at)}</span>
                </div>
                {ev.detalle && <div style={{ color: "#64748b", marginTop: 3 }}>{ev.detalle}</div>}
                <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>{ev.actor}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "flex-start" }}>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              placeholder="Agregar una nota al caso…"
              style={{ flex: 1, border: "1px solid #e4e7ec", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, resize: "vertical" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button onClick={agregarNota} style={{ border: "none", background: "#1a3a6b", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 4, padding: "8px 14px", cursor: "pointer" }}>
                Agregar
              </button>
              <label style={{ fontSize: 10.5, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={interna} onChange={e => setInterna(e.target.checked)} /> interna
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
