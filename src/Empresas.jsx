import { useState, useEffect } from "react";
import { sb } from "./shared";

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO EMPRESAS · Centro de administración de terceros
// La fuente de poder del concepto "empresa única" (terceros.id):
//   · Ficha 360: datos completos (incl. banco/CLABE), placas, personal,
//     documentos del archivador y pagos efectuados.
//   · Gestión de estado: pausar empresa, pausar pagos (p.ej. por contrato
//     sin firmar), reactivar — todo con motivo y bitácora (terceros_eventos).
//   · Bandeja de solicitudes de baja del Portal de Terceros
//     (solicitudes_terceros) para aprobar/rechazar desde aquí.
// Requiere: unificacion_fase1/2 + empresas_admin.sql (estado, solicitudes,
// eventos y vw_terceros_360 v2).
// ═══════════════════════════════════════════════════════════════════════════

const NAVY = "#1a3a6b";
const ORANGE = "#F47B20";

const ESTADO_EMPRESA = {
  activa:  { label: "ACTIVA",  bg: "#e8f5ec", fg: "#166534" },
  pausada: { label: "PAUSADA", bg: "#fff4e5", fg: "#b45309" },
  baja:    { label: "BAJA",    bg: "#fdecea", fg: "#c0392b" },
};

const fmtF = (x) => (x ? new Date(x).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

function Chip({ texto, bg, fg }) {
  return <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 12, background: bg, color: fg, whiteSpace: "nowrap" }}>{texto}</span>;
}

function Kpi({ n, label, color }) {
  return (
    <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "14px 18px", textAlign: "center", minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || NAVY }}>{n}</div>
      <div style={{ fontSize: 10.5, color: "#667085", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

// ─── Bitácora de eventos de la empresa (pausas, reactivaciones, bajas…) ───
async function registrarEvento(terceroId, tipo, detalle) {
  const { error } = await sb.from("terceros_eventos").insert({
    tercero_id: terceroId, tipo, detalle: detalle || null,
    actor: window.__PERFIL_EMAIL || "analista_brain",
  });
  if (error) console.warn("terceros_eventos:", error.message);
}

// ═══ DETALLE DE EMPRESA ═════════════════════════════════════════════════════
function DetalleEmpresa({ empresa, onVolver, onActualizada }) {
  const [tab, setTab] = useState("resumen");
  const [perfil, setPerfil] = useState(null);
  const [padron, setPadron] = useState(null);
  const [docs, setDocs] = useState(null);
  const [pagos, setPagos] = useState(null);
  const [solicitudes, setSolicitudes] = useState(null);
  const [eventos, setEventos] = useState(null);

  // Cargas perezosas por pestaña — cada una tolera tabla/columnas faltantes
  useEffect(() => { (async () => {
    if (tab === "resumen" && eventos === null) {
      const { data } = await sb.from("terceros_eventos").select("*").eq("tercero_id", empresa.tercero_id).order("created_at", { ascending: false }).limit(20);
      setEventos(data || []);
    }
    if (tab === "datos" && perfil === null) {
      const { data } = await sb.from("perfiles_empresa").select("*").eq("tercero_id", empresa.tercero_id).maybeSingle();
      setPerfil(data || {});
    }
    if (tab === "placas" && padron === null) {
      const { data } = await sb.from("flota_personal_terceros").select("*").eq("tercero_id", empresa.tercero_id).order("tipo").order("created_at", { ascending: false });
      setPadron(data || []);
    }
    if (tab === "docs" && docs === null) {
      const { data } = await sb.from("documentos_empresa").select("*").eq("tercero_id", empresa.tercero_id).order("created_at", { ascending: false }).limit(200);
      setDocs(data || []);
    }
    if (tab === "pagos" && pagos === null) {
      // Pagos efectuados: conciliaciones. La columna de empresa varía según el
      // esquema (mundo B agrupa por texto), así que se descubre dinámicamente.
      const { data: probe, error: e0 } = await sb.from("conciliaciones_terceros").select("*").limit(1);
      if (e0) { setPagos({ error: e0.message }); return; }
      if (!probe || probe.length === 0) { setPagos([]); return; }
      const cols = Object.keys(probe[0]);
      const colEmp = ["empresa", "empresa_transporte", "transportista", "nombre_empresa", "contratista", "nombre"].find((c) => cols.includes(c));
      let q = sb.from("conciliaciones_terceros").select("*").limit(30);
      if (cols.includes("semana")) q = q.order("semana", { ascending: false });
      else if (cols.includes("created_at")) q = q.order("created_at", { ascending: false });
      if (cols.includes("tercero_id")) q = q.eq("tercero_id", empresa.tercero_id);
      else if (colEmp) q = q.ilike(colEmp, empresa.nombre);
      else { setPagos({ error: "No hay columna de empresa reconocible en conciliaciones_terceros (columnas: " + cols.join(", ") + ")" }); return; }
      const { data, error } = await q;
      setPagos(error ? { error: error.message } : (data || []));
    }
    if (tab === "solicitudes" && solicitudes === null) {
      const { data } = await sb.from("solicitudes_terceros").select("*").eq("tercero_id", empresa.tercero_id).order("created_at", { ascending: false });
      setSolicitudes(data || []);
    }
  })(); }, [tab]);

  const verDoc = async (d) => {
    const { data, error } = await sb.storage.from(d.bucket || "archivador_empresas").createSignedUrl(d.storage_path, 300);
    if (error || !data?.signedUrl) { alert("No se pudo abrir el documento."); return; }
    window.open(data.signedUrl, "_blank");
  };

  // ── Acciones de estado ──
  const cambiarEstado = async (nuevoEstado, esPagos = false) => {
    const etiqueta = esPagos
      ? (nuevoEstado ? "PAUSAR LOS PAGOS" : "REACTIVAR LOS PAGOS")
      : (nuevoEstado === "pausada" ? "PAUSAR LA EMPRESA" : nuevoEstado === "baja" ? "DAR DE BAJA LA EMPRESA" : "REACTIVAR LA EMPRESA");
    const motivo = prompt(`${etiqueta} — ${empresa.nombre}\n\nMotivo (obligatorio, queda en la bitácora):`);
    if (motivo === null) return;
    if (!motivo.trim()) { alert("El motivo es obligatorio."); return; }
    const patch = esPagos
      ? { pagos_pausados: nuevoEstado, motivo_estado: motivo.trim(), estado_actualizado_at: new Date().toISOString(), estado_actualizado_por: window.__PERFIL_EMAIL || "analista_brain" }
      : { estado_operacional: nuevoEstado, motivo_estado: motivo.trim(), estado_actualizado_at: new Date().toISOString(), estado_actualizado_por: window.__PERFIL_EMAIL || "analista_brain" };
    const { error } = await sb.from("terceros").update(patch).eq("id", empresa.tercero_id);
    if (error) { alert("No se pudo actualizar (¿falta empresas_admin.sql?): " + error.message); return; }
    await registrarEvento(empresa.tercero_id, esPagos ? (nuevoEstado ? "pagos_pausados" : "pagos_reactivados") : "estado_" + nuevoEstado, motivo.trim());
    setEventos(null); setTab("resumen");
    onActualizada({ ...empresa, ...patch });
  };

  const resolverSolicitud = async (s, estado) => {
    const respuesta = prompt(`${estado === "aprobada" ? "APROBAR" : "RECHAZAR"} solicitud (${s.tipo} · ${s.referencia || "—"})\n\nRespuesta para la bitácora:`) ;
    if (respuesta === null) return;
    const { error } = await sb.from("solicitudes_terceros").update({
      estado, respuesta: respuesta.trim() || null,
      resuelto_por: window.__PERFIL_EMAIL || "analista_brain", resuelto_at: new Date().toISOString(),
    }).eq("id", s.id);
    if (error) { alert("No se pudo resolver: " + error.message); return; }
    // Si se aprueba una baja de vehículo/persona, el padrón se actualiza aquí mismo
    if (estado === "aprobada" && (s.tipo === "baja_vehiculo" || s.tipo === "baja_persona") && s.referencia) {
      await sb.from("flota_personal_terceros").update({ estado: "baja", actualizado_at: new Date().toISOString() })
        .eq("tercero_id", empresa.tercero_id)
        .or(s.tipo === "baja_vehiculo" ? `placa.eq.${s.referencia.toUpperCase().trim()}` : `nombre.ilike.%${s.referencia.trim()}%`);
      setPadron(null);
    }
    await registrarEvento(empresa.tercero_id, "solicitud_" + estado, `${s.tipo} · ${s.referencia || ""} — ${respuesta || ""}`);
    setSolicitudes(null); setEventos(null);
    const { data } = await sb.from("solicitudes_terceros").select("*").eq("tercero_id", empresa.tercero_id).order("created_at", { ascending: false });
    setSolicitudes(data || []);
  };

  const est = ESTADO_EMPRESA[empresa.estado_operacional || "activa"] || ESTADO_EMPRESA.activa;
  const TABS = [
    ["resumen", "📇 Resumen"], ["datos", "🏦 Datos & Cuenta"], ["placas", "🚚 Placas & Personal"],
    ["docs", "🗂 Documentos"], ["pagos", "💰 Pagos"], ["solicitudes", "📥 Solicitudes"],
  ];
  const lblEv = { estado_pausada: "⏸ Empresa pausada", estado_activa: "▶️ Empresa reactivada", estado_baja: "🛑 Empresa dada de baja", pagos_pausados: "💸⏸ Pagos pausados", pagos_reactivados: "💸▶️ Pagos reactivados", solicitud_aprobada: "✅ Solicitud aprobada", solicitud_rechazada: "❌ Solicitud rechazada" };

  return (
    <div>
      <button onClick={onVolver} style={{ background: "none", border: "none", color: NAVY, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, marginBottom: 12, fontFamily: "'Geist',sans-serif" }}>← Volver a Empresas</button>

      {/* Encabezado */}
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px", marginBottom: 12, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: NAVY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>
          {(empresa.nombre || "?").slice(0, 1)}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: NAVY }}>{empresa.nombre}</div>
          <div style={{ fontSize: 12, color: "#667085" }}>RFC {empresa.rfc || "—"} · {empresa.placas_semana_vigente ?? 0} placas semana vigente · {empresa.personal_activo ?? 0} personas</div>
        </div>
        <Chip texto={est.label} bg={est.bg} fg={est.fg} />
        {empresa.pagos_pausados && <Chip texto="PAGOS PAUSADOS" bg="#fdecea" fg="#c0392b" />}
        {!empresa.cuenta_clabe && <Chip texto="SIN CLABE" bg="#fff4e5" fg="#b45309" />}
      </div>

      {/* Pestañas */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontFamily: "'Geist',sans-serif",
              fontWeight: tab === id ? 700 : 500, background: tab === id ? NAVY : "#fff",
              color: tab === id ? "#fff" : "#555", border: tab === id ? "1.5px solid " + NAVY : "1px solid #e4e7ec" }}>
            {l}
          </button>
        ))}
      </div>

      {/* ── RESUMEN: acciones de estado + bitácora ── */}
      {tab === "resumen" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
          <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#667085", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Gestión de estado</div>
            {empresa.motivo_estado && (
              <div style={{ fontSize: 12, color: "#8a4a0f", background: "#fff8f0", border: "1px solid #fcd9b6", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                Último motivo: {empresa.motivo_estado} <span style={{ color: "#98a2b3" }}>({fmtF(empresa.estado_actualizado_at)} · {empresa.estado_actualizado_por || "—"})</span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(empresa.estado_operacional || "activa") === "activa" ? (
                <button onClick={() => cambiarEstado("pausada")} style={{ padding: "10px", borderRadius: 8, border: "1.5px solid #b45309", background: "#fff", color: "#b45309", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>⏸ Pausar empresa</button>
              ) : (
                <button onClick={() => cambiarEstado("activa")} style={{ padding: "10px", borderRadius: 8, border: "1.5px solid #166534", background: "#fff", color: "#166534", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>▶️ Reactivar empresa</button>
              )}
              {empresa.pagos_pausados ? (
                <button onClick={() => cambiarEstado(false, true)} style={{ padding: "10px", borderRadius: 8, border: "1.5px solid #166534", background: "#fff", color: "#166534", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>💸▶️ Reactivar pagos</button>
              ) : (
                <button onClick={() => cambiarEstado(true, true)} style={{ padding: "10px", borderRadius: 8, border: "1.5px solid #c0392b", background: "#fff", color: "#c0392b", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>💸⏸ Pausar pagos (p. ej. contrato sin firmar)</button>
              )}
              {(empresa.estado_operacional || "activa") !== "baja" && (
                <button onClick={() => cambiarEstado("baja")} style={{ padding: "10px", borderRadius: 8, border: "1px solid #e4e7ec", background: "#fff", color: "#c0392b", fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>🛑 Dar de baja la empresa</button>
              )}
            </div>
            <div style={{ fontSize: 10.5, color: "#98a2b3", marginTop: 10, lineHeight: 1.5 }}>
              Nota de arquitectura: estos estados quedan en <b>terceros</b> y en la bitácora. La conexión con el motor
              (excluir de la generación semanal / retener prefactura) es la siguiente fase — por ahora es registro y control visual.
            </div>
          </div>
          <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#667085", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Bitácora de la empresa</div>
            {eventos === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div>
              : eventos.length === 0 ? <div style={{ fontSize: 12, color: "#888" }}>Sin eventos registrados.</div>
              : eventos.map((e) => (
                <div key={e.id} style={{ fontSize: 12, color: "#475467", padding: "6px 0", borderBottom: "1px solid #f4f5f7" }}>
                  <b>{fmtF(e.created_at)}</b> · {lblEv[e.tipo] || e.tipo}{e.detalle ? ` — ${e.detalle}` : ""} <span style={{ color: "#98a2b3" }}>({e.actor || "—"})</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── DATOS & CUENTA ── */}
      {tab === "datos" && (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#667085", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Perfil de la empresa (lo carga la empresa en su portal)</div>
          {perfil === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "10px 18px" }}>
              {Object.entries({ ...{ nombre: empresa.nombre, rfc: empresa.rfc }, ...(perfil || {}) })
                .filter(([k]) => !["id", "tercero_id", "created_at", "updated_at"].includes(k))
                .map(([k, v]) => (
                  <div key={k} style={{ padding: "6px 0", borderBottom: "1px solid #f4f5f7" }}>
                    <div style={{ fontSize: 9.5, color: "#98a2b3", fontWeight: 700, textTransform: "uppercase" }}>{k.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: k === "cuenta_clabe" ? NAVY : "#333", wordBreak: "break-word" }}>
                      {v === null || v === "" ? <span style={{ color: "#c0392b" }}>— falta —</span> : String(v)}
                    </div>
                  </div>
                ))}
            </div>
          )}
          {perfil && Object.keys(perfil).length === 0 && (
            <div style={{ fontSize: 12, color: "#b45309", background: "#fff8f0", border: "1px solid #fcd9b6", borderRadius: 8, padding: "8px 12px", marginTop: 10 }}>
              ⚠️ Esta empresa aún no completa su Perfil de Empresa en el portal — sin CLABE no hay a dónde pagarle.
            </div>
          )}
        </div>
      )}

      {/* ── PLACAS & PERSONAL (padrón) ── */}
      {tab === "placas" && (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px" }}>
          {padron === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div>
            : padron.length === 0 ? <div style={{ fontSize: 12, color: "#888" }}>Sin registros en el padrón.</div>
            : padron.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f4f5f7", opacity: r.estado === "baja" ? 0.55 : 1 }}>
                <span style={{ fontSize: 16 }}>{r.tipo === "vehiculo" ? "🚚" : r.tipo === "ayudante" ? "🧰" : "🚗"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.tipo === "vehiculo" ? `${r.placa || "—"} · ${[r.marca, r.modelo, r.anio].filter(Boolean).join(" ")}` : r.nombre || "—"}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{r.service_center || "sin SC"} · {r.origen === "certificacion" ? "✅ Certificación" : r.origen === "seed_flota_semanal" ? "📦 Seed flota" : "➕ Alta directa"}</div>
                </div>
                <Chip texto={r.estado === "baja" ? "BAJA" : "ACTIVO"} bg={r.estado === "baja" ? "#fdecea" : "#e8f5ec"} fg={r.estado === "baja" ? "#c0392b" : "#166534"} />
              </div>
            ))}
        </div>
      )}

      {/* ── DOCUMENTOS (archivador) ── */}
      {tab === "docs" && (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px" }}>
          {docs === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div>
            : docs.length === 0 ? <div style={{ fontSize: 12, color: "#888" }}>Sin documentos en el archivador.</div>
            : docs.map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #f4f5f7" }}>
                <span>📎</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.nombre_archivo || d.storage_path}</div>
                  <div style={{ fontSize: 10.5, color: "#98a2b3" }}>{d.categoria || "—"}{d.confidencial ? " · 🔒 confidencial" : ""} · {fmtF(d.created_at)}{d.referencia ? " · " + d.referencia : ""}</div>
                </div>
                <button onClick={() => verDoc(d)} style={{ background: "#fff", border: "1px solid #dbe3ee", color: NAVY, borderRadius: 7, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>Ver</button>
              </div>
            ))}
        </div>
      )}

      {/* ── PAGOS (conciliaciones — lectura) ── */}
      {tab === "pagos" && (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#667085", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Conciliaciones (últimas 30 semanas)</div>
          {pagos === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div>
            : pagos.error ? <div style={{ fontSize: 12, color: "#c0392b" }}>No se pudieron leer las conciliaciones: {pagos.error}</div>
            : pagos.length === 0 ? <div style={{ fontSize: 12, color: "#888" }}>Sin conciliaciones registradas para esta empresa.</div>
            : (
              <div style={{ overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr>
                    {Object.keys(pagos[0]).filter((k) => !["id", "created_at", "updated_at", "detalle", "payload"].includes(k)).slice(0, 8).map((k) => (
                      <th key={k} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "2px solid " + NAVY, color: NAVY, fontSize: 10.5, textTransform: "uppercase" }}>{k.replace(/_/g, " ")}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {pagos.map((p, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        {Object.keys(pagos[0]).filter((k) => !["id", "created_at", "updated_at", "detalle", "payload"].includes(k)).slice(0, 8).map((k) => (
                          <td key={k} style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{p[k] === null ? "—" : typeof p[k] === "object" ? "…" : String(p[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          <div style={{ fontSize: 10.5, color: "#98a2b3", marginTop: 8 }}>Vista de lectura sobre <b>conciliaciones_terceros</b> (por nombre — la Fase 4 la migrará a uuid). La gestión de pagos sigue en Administración.</div>
        </div>
      )}

      {/* ── SOLICITUDES ── */}
      {tab === "solicitudes" && (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px" }}>
          {solicitudes === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div>
            : solicitudes.length === 0 ? <div style={{ fontSize: 12, color: "#888" }}>Sin solicitudes de esta empresa. Las solicitudes de baja que la empresa envíe desde su portal caerán aquí.</div>
            : solicitudes.map((s) => (
              <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid #f4f5f7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {s.tipo === "baja_vehiculo" ? "🚚 Baja de vehículo" : s.tipo === "baja_persona" ? "👤 Baja de persona" : s.tipo === "baja_empresa" ? "🏢 Baja de empresa" : "📄 " + (s.tipo || "solicitud")}
                      {s.referencia ? ` · ${s.referencia}` : ""}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#667085" }}>{fmtF(s.created_at)}{s.detalle ? " · " + s.detalle : ""}</div>
                    {s.respuesta && <div style={{ fontSize: 11.5, color: "#475467", marginTop: 2 }}>↳ {s.respuesta} <span style={{ color: "#98a2b3" }}>({s.resuelto_por})</span></div>}
                  </div>
                  {s.estado === "pendiente" ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => resolverSolicitud(s, "aprobada")} style={{ background: "#166534", color: "#fff", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>✓ Aprobar</button>
                      <button onClick={() => resolverSolicitud(s, "rechazada")} style={{ background: "#fff", color: "#c0392b", border: "1.5px solid #c0392b", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>✕ Rechazar</button>
                    </div>
                  ) : (
                    <Chip texto={s.estado === "aprobada" ? "APROBADA" : "RECHAZADA"} bg={s.estado === "aprobada" ? "#e8f5ec" : "#fdecea"} fg={s.estado === "aprobada" ? "#166534" : "#c0392b"} />
                  )}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ═══ MÓDULO PRINCIPAL ═══════════════════════════════════════════════════════
export default function ModuloEmpresas() {
  const [empresas, setEmpresas] = useState(null);
  const [pendientes, setPendientes] = useState(0);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todas");   // todas | activa | pausada | baja | pagos_pausados | sin_clabe
  const [selected, setSelected] = useState(null);

  const cargar = async () => {
    // La vista 360 v2 trae también estado_operacional / pagos_pausados / motivo
    let { data, error } = await sb.from("vw_terceros_360").select("*").order("nombre");
    if (error) { alert("No se pudo cargar vw_terceros_360 (¿falta unificacion_fase2.sql / empresas_admin.sql?): " + error.message); setEmpresas([]); return; }
    setEmpresas(data || []);
    const { count } = await sb.from("solicitudes_terceros").select("id", { count: "exact", head: true }).eq("estado", "pendiente");
    setPendientes(count || 0);
  };
  useEffect(() => { cargar(); }, []);

  const norm = (x) => (x || "").toString().toLowerCase();
  const lista = (empresas || []).filter((e) => {
    if (busca && !(norm(e.nombre).includes(norm(busca)) || norm(e.rfc).includes(norm(busca)))) return false;
    if (filtro === "todas") return true;
    if (filtro === "pagos_pausados") return !!e.pagos_pausados;
    if (filtro === "sin_clabe") return !e.cuenta_clabe;
    return (e.estado_operacional || "activa") === filtro;
  });

  if (selected) return (
    <div style={{ fontFamily: "'Geist',sans-serif", padding: "6px 2px" }}>
      <DetalleEmpresa empresa={selected} onVolver={() => { setSelected(null); cargar(); }}
        onActualizada={(e) => { setSelected(e); }} />
    </div>
  );

  const n = (f) => (empresas || []).filter(f).length;

  return (
    <div style={{ fontFamily: "'Geist',sans-serif", padding: "6px 2px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: NAVY }}>🏢 Empresas</div>
          <div style={{ fontSize: 12, color: "#667085" }}>Administración central de terceros: ficha 360, estado, pagos, documentos y solicitudes.</div>
        </div>
        <button onClick={cargar} style={{ marginLeft: "auto", background: "#fff", border: "1px solid #e4e7ec", color: NAVY, borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>🔄 Actualizar</button>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Kpi n={(empresas || []).length} label="Empresas" />
        <Kpi n={n((e) => (e.estado_operacional || "activa") === "activa")} label="Activas" color="#166534" />
        <Kpi n={n((e) => (e.estado_operacional || "") === "pausada")} label="Pausadas" color="#b45309" />
        <Kpi n={n((e) => !!e.pagos_pausados)} label="Pagos pausados" color="#c0392b" />
        <Kpi n={n((e) => !e.cuenta_clabe)} label="Sin CLABE" color={ORANGE} />
        <Kpi n={pendientes} label="Solicitudes pendientes" color={pendientes ? "#c0392b" : NAVY} />
      </div>

      {/* Buscador + filtros */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔍 Buscar por nombre o RFC…"
          style={{ flex: 1, minWidth: 240, border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontFamily: "'Geist',sans-serif" }} />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}
          style={{ border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, fontFamily: "'Geist',sans-serif" }}>
          <option value="todas">Todas</option>
          <option value="activa">Activas</option>
          <option value="pausada">Pausadas</option>
          <option value="baja">De baja</option>
          <option value="pagos_pausados">Con pagos pausados</option>
          <option value="sin_clabe">Sin CLABE</option>
        </select>
      </div>

      {/* Listado */}
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden" }}>
        {empresas === null ? <div style={{ padding: 20, fontSize: 12.5, color: "#888" }}>Cargando empresas…</div>
          : lista.length === 0 ? <div style={{ padding: 20, fontSize: 12.5, color: "#888" }}>Sin resultados.</div>
          : lista.map((e) => {
            const est = ESTADO_EMPRESA[e.estado_operacional || "activa"] || ESTADO_EMPRESA.activa;
            return (
              <div key={e.tercero_id} onClick={() => setSelected(e)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid #f4f5f7", cursor: "pointer" }}
                onMouseEnter={(ev) => ev.currentTarget.style.background = "#f8fafc"}
                onMouseLeave={(ev) => ev.currentTarget.style.background = "#fff"}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#eef2f7", color: NAVY, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {(e.nombre || "?").slice(0, 1)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1f2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.nombre}</div>
                  <div style={{ fontSize: 11, color: "#98a2b3" }}>RFC {e.rfc || "—"} · 🚚 {e.vehiculos_activos ?? 0} vehículos · 👤 {e.personal_activo ?? 0} personas · 📄 {e.certificaciones_en_curso ?? 0} cert. en curso</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>{e.placas_semana_vigente ?? 0}</div>
                  <div style={{ fontSize: 9.5, color: "#98a2b3", textTransform: "uppercase" }}>placas sem.</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                  <Chip texto={est.label} bg={est.bg} fg={est.fg} />
                  {e.pagos_pausados ? <Chip texto="PAGOS ⏸" bg="#fdecea" fg="#c0392b" /> : !e.cuenta_clabe ? <Chip texto="SIN CLABE" bg="#fff4e5" fg="#b45309" /> : null}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
