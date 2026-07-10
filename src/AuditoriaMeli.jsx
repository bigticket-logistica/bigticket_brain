import { useState, useEffect } from "react";
import { sb, fechaHoyOperativa } from "./shared";

// ─── Etiquetas legibles para cada categoría de acción crítica ──────────
const CATEGORIAS = {
  aceptacion_ruta:      { label: "Aceptación de ruta",       icon: "✅", color: "#166534" },
  rechazo_ruta:         { label: "Rechazo de ruta",          icon: "⛔", color: "#c0392b" },
  alta_padron:          { label: "Alta en padrón",           icon: "➕", color: "#1a3a6b" },
  modificacion_vehiculo:{ label: "Modificación de vehículo", icon: "🚚", color: "#F47B20" },
  baja_conductor:       { label: "Baja de conductor",        icon: "🗑️", color: "#7c3aed" },
};

const catInfo = (c) => CATEGORIAS[c] || { label: c || "—", icon: "•", color: "#666" };

// ─── Formateo de fecha/hora en zona México ─────────────────────────────
function fmtFechaHora(iso) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: "America/Mexico_City",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

// ─── "Qué modificó": resumen legible según la categoría ────────────────
function describirCambio(a) {
  const ps = a.payload_shape || {};
  if (a.categoria === "modificacion_vehiculo") {
    const partes = [];
    if (ps.brand)  partes.push(ps.brand);
    if (ps.model)  partes.push(ps.model);
    if (ps.year)   partes.push(ps.year);
    if (ps.vehicleType != null) partes.push(`tipo ${ps.vehicleType}`);
    const desc = partes.filter(Boolean).join(" · ");
    return desc || (a.vehicle_id ? `Vehículo ${a.vehicle_id}` : "Vehículo");
  }
  if (a.categoria === "rechazo_ruta") {
    const n = Array.isArray(a.request_ids) ? a.request_ids.length : 0;
    const motivo = a.reason ? ` · ${a.reason}` : "";
    return `${n} ruta${n === 1 ? "" : "s"}${motivo}`;
  }
  if (a.categoria === "aceptacion_ruta") {
    const n = Array.isArray(a.request_ids) ? a.request_ids.length : 0;
    return `${n} ruta${n === 1 ? "" : "s"}`;
  }
  if (a.categoria === "alta_padron") {
    return a.correo || "Nuevo operador";
  }
  if (a.categoria === "baja_conductor") {
    return a.driver_id ? `Conductor ${a.driver_id}` : "Conductor";
  }
  return "—";
}

// ─── Badge de plataforma ───────────────────────────────────────────────
function BadgePlataforma({ p }) {
  const map = {
    android_app:      { label: "App",    bg: "#e8f5ec", color: "#166534" },
    chrome_desktop:   { label: "Chrome", bg: "#eef2f7", color: "#1a3a6b" },
    chrome_extension: { label: "Chrome", bg: "#eef2f7", color: "#1a3a6b" },
  };
  const s = map[p] || { label: p || "—", bg: "#f3f4f6", color: "#666" };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "2px 9px", fontSize: 10, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

// ─── Estado de una sesión web según antigüedad del último refresco ──────
function estadoSesion(minutos) {
  if (minutos == null) return { label: "—", icon: "•", color: "#666", bg: "#f3f4f6" };
  if (minutos <= 60)   return { label: "Activo ahora", icon: "🟢", color: "#166534", bg: "#e8f5ec" };
  if (minutos <= 360)  return { label: "Reciente",     icon: "🟢", color: "#166534", bg: "#e8f5ec" };
  if (minutos <= 720)  return { label: ">6h sin login", icon: "🟡", color: "#b45309", bg: "#fef3c7" };
  return { label: "Expirado", icon: "🔴", color: "#c0392b", bg: "#fbeaea" };
}

// ─── Antigüedad legible ("hace 17 min", "hace 2 h") ────────────────────
function haceCuanto(minutos) {
  if (minutos == null) return "—";
  if (minutos < 1)   return "hace <1 min";
  if (minutos < 60)  return `hace ${Math.round(minutos)} min`;
  const horas = minutos / 60;
  if (horas < 24)    return `hace ${horas.toFixed(1)} h`;
  return `hace ${Math.round(horas / 24)} d`;
}

// ═══════════════════════════════════════════════════════════════════════
//  MÓDULO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════
function ModuloAuditoriaMeli() {
  const [vista, setVista] = useState("listado");   // "listado" | "ranking"
  const [fecha, setFecha] = useState(fechaHoyOperativa());
  const [acciones, setAcciones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [filtroCat, setFiltroCat] = useState("todas");

  // Carga: acciones de un día operativo (00:00 a 23:59:59 hora México)
  useEffect(() => {
    let cancelado = false;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        // El día operativo va de las 00:00 a las 23:59:59.999 de México (UTC-6)
        const desde = `${fecha}T00:00:00-06:00`;
        const hasta = `${fecha}T23:59:59.999-06:00`;
        const { data, error: err } = await sb
          .from("meli_acciones_criticas")
          .select("*")
          .gte("ocurrido_at", desde)
          .lte("ocurrido_at", hasta)
          .order("ocurrido_at", { ascending: false });
        if (err) throw err;
        if (!cancelado) setAcciones(data || []);
      } catch (e) {
        if (!cancelado) setError(e.message || String(e));
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [fecha]);

  // Filtro por categoría (solo afecta el listado)
  const accionesFiltradas = acciones.filter(a =>
    filtroCat === "todas" ? true : a.categoria === filtroCat
  );

  // KPIs del día
  const kpis = {
    total: acciones.length,
    ...Object.keys(CATEGORIAS).reduce((acc, k) => {
      acc[k] = acciones.filter(a => a.categoria === k).length;
      return acc;
    }, {}),
  };

  const esHoy = fecha === fechaHoyOperativa();

  return (
    <div className="pg">
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Auditoría MELI 🇲🇽</div>
          <div className="sec-sub">Acciones críticas de supervisores en el portal de MercadoLibre</div>
        </div>
        <div style={{ display: "flex", background: "#fff", borderRadius: 8, border: "0.5px solid #e4e7ec", overflow: "hidden" }}>
          {[["listado", "Listado"], ["ranking", "Ranking"]].map(([v, l]) => (
            <button key={v} onClick={() => setVista(v)}
              style={{ padding: "7px 16px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "'Geist',sans-serif",
                background: vista === v ? "#1a3a6b" : "#fff", color: vista === v ? "#fff" : "#666", fontWeight: vista === v ? 600 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── Selector de fecha ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "6px 12px" }}>
          <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>📅 Fecha</span>
          <input type="date" value={fecha} max={fechaHoyOperativa()}
            onChange={(e) => setFecha(e.target.value)}
            style={{ border: "none", background: "transparent", fontSize: 13, fontFamily: "'Geist',sans-serif", color: "#1a1a1a", cursor: "pointer" }} />
          {esHoy && <span style={{ background: "#F47B20", color: "#fff", borderRadius: 20, padding: "2px 9px", fontSize: 10, fontWeight: 700 }}>HOY</span>}
        </div>
        {!esHoy && (
          <button onClick={() => setFecha(fechaHoyOperativa())}
            style={{ background: "#f4f5f7", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer", color: "#666", fontFamily: "'Geist',sans-serif" }}>
            Volver a hoy
          </button>
        )}
      </div>

      {/* ── KPIs por categoría ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 18 }}>
        {[["Total", kpis.total, "#1a3a6b"],
          ...Object.entries(CATEGORIAS).map(([k, info]) => [info.label, kpis[k], info.color])
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* ── Estados de carga / error ── */}
      {error && (
        <div style={{ background: "#fbeaea", border: "1px solid #f0c4c4", borderRadius: 8, padding: "12px 16px", color: "#c0392b", fontSize: 13, marginBottom: 14 }}>
          Error cargando datos: {error}
        </div>
      )}
      {cargando && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#888", fontSize: 13 }}>Cargando…</div>
      )}

      {/* ── Vistas (BLOQUE SUPERIOR: acciones críticas) ── */}
      {!cargando && !error && vista === "listado" && (
        <VistaListado
          acciones={accionesFiltradas}
          filtroCat={filtroCat}
          setFiltroCat={setFiltroCat}
        />
      )}
      {!cargando && !error && vista === "ranking" && (
        <VistaRanking acciones={acciones} fecha={fecha} />
      )}

      {/* ── BLOQUE INFERIOR: conexiones vía web (extensión) ── */}
      <BloqueSesionesWeb />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  BLOQUE INFERIOR · SESIONES WEB (EXTENSIÓN "Don B")
//  Lee sesiones_meli: quién tiene sesión activa por extensión y hace cuánto
//  refrescó sus cookies. Es ESTADO DE CONEXIÓN, no acciones.
// ═══════════════════════════════════════════════════════════════════════
function BloqueSesionesWeb() {
  const [sesiones, setSesiones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [refrescadoEn, setRefrescadoEn] = useState(null);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    try {
      // Solo filas por-usuario (id "lm_user_<ldap>"), no la sesion_activa agregada
      const { data, error: err } = await sb
        .from("sesiones_meli")
        .select("id, usuario_id, cantidad_cookies, actualizado_at")
        .like("id", "lm_user_%")
        .order("actualizado_at", { ascending: false });
      if (err) throw err;
      setSesiones(data || []);
      setRefrescadoEn(new Date());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
  };

  // Carga inicial + autorefresco cada 60 s (el estado de conexión cambia solo)
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 60000);
    return () => clearInterval(t);
  }, []);

  // Minutos desde el último refresco de cookies de cada sesión
  const ahora = Date.now();
  const filas = sesiones.map(s => {
    const min = s.actualizado_at
      ? (ahora - new Date(s.actualizado_at).getTime()) / 60000
      : null;
    return { ...s, minutos: min };
  });

  const activos = filas.filter(f => f.minutos != null && f.minutos <= 60).length;

  return (
    <div style={{ marginTop: 28 }}>
      {/* Encabezado del bloque */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>
            🌐 Conexiones vía web (extensión)
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            Supervisores con sesión de MELI activa a través de la extensión — usuario y último refresco de cookies
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "#e8f5ec", color: "#166534", borderRadius: 20, padding: "3px 11px", fontSize: 11, fontWeight: 700 }}>
            {activos} activo{activos === 1 ? "" : "s"} ahora
          </span>
          <button onClick={cargar} disabled={cargando}
            style={{ background: "#f4f5f7", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: cargando ? "default" : "pointer", color: "#666", fontFamily: "'Geist',sans-serif" }}>
            {cargando ? "Actualizando…" : "↻ Actualizar"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fbeaea", border: "1px solid #f0c4c4", borderRadius: 8, padding: "12px 16px", color: "#c0392b", fontSize: 13, marginBottom: 14 }}>
          Error cargando sesiones: {error}
        </div>
      )}

      {!error && filas.length === 0 && !cargando ? (
        <div style={{ textAlign: "center", padding: "34px 0", color: "#aaa", fontSize: 13, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12 }}>
          Ninguna sesión web registrada todavía.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "#1a3a6b", color: "#fff", textAlign: "left" }}>
                <th style={thStyle}>Usuario</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Cookies</th>
                <th style={thStyle}>Último login (MX)</th>
                <th style={thStyle}>Antigüedad</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Estado</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Origen</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => {
                const est = estadoSesion(f.minutos);
                return (
                  <tr key={f.id || f.usuario_id || i} style={{ borderTop: "0.5px solid #eef0f3" }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: "#1a1a1a" }}>{f.usuario_id || "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center", color: "#444" }}>{f.cantidad_cookies ?? "—"}</td>
                    <td style={{ ...tdStyle, color: "#666", whiteSpace: "nowrap" }}>{fmtFechaHora(f.actualizado_at)}</td>
                    <td style={{ ...tdStyle, color: "#666" }}>{haceCuanto(f.minutos)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span style={{ background: est.bg, color: est.color, borderRadius: 20, padding: "2px 9px", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {est.icon} {est.label}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}><BadgePlataforma p="chrome_extension" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {refrescadoEn && (
        <div style={{ fontSize: 11, color: "#aaa", marginTop: 8, textAlign: "right" }}>
          Actualizado {fmtFechaHora(refrescadoEn.toISOString())} · se refresca solo cada minuto
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  VISTA 1 · LISTADO
// ═══════════════════════════════════════════════════════════════════════
function VistaListado({ acciones, filtroCat, setFiltroCat }) {
  return (
    <>
      {/* Filtro por tipo de cambio */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)}
          style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 12, fontFamily: "'Geist',sans-serif", color: "#333" }}>
          <option value="todas">Todos los tipos de cambio</option>
          {Object.entries(CATEGORIAS).map(([k, info]) => (
            <option key={k} value={k}>{info.icon} {info.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "#888" }}>{acciones.length} acción{acciones.length === 1 ? "" : "es"}</span>
      </div>

      {acciones.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#aaa", fontSize: 13 }}>
          Sin acciones registradas para esta fecha.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "#1a3a6b", color: "#fff", textAlign: "left" }}>
                <th style={thStyle}>Quién</th>
                <th style={thStyle}>Tipo de cambio</th>
                <th style={thStyle}>Qué modificó</th>
                <th style={thStyle}>Fecha y hora</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Origen</th>
              </tr>
            </thead>
            <tbody>
              {acciones.map((a, i) => {
                const info = catInfo(a.categoria);
                return (
                  <tr key={a.id || i} style={{ borderTop: "0.5px solid #eef0f3" }}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: "#1a1a1a" }}>
                        {a.supervisor_email || a.ldap || "—"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: info.color, fontWeight: 600 }}>{info.icon} {info.label}</span>
                    </td>
                    <td style={{ ...tdStyle, color: "#444" }}>{describirCambio(a)}</td>
                    <td style={{ ...tdStyle, color: "#666", whiteSpace: "nowrap" }}>{fmtFechaHora(a.ocurrido_at)}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}><BadgePlataforma p={a.plataforma} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  VISTA 2 · RANKING
// ═══════════════════════════════════════════════════════════════════════
function VistaRanking({ acciones }) {
  // Agrupar por supervisor (email o ldap)
  const porSupervisor = {};
  acciones.forEach(a => {
    const k = a.supervisor_email || a.ldap || "desconocido";
    if (!porSupervisor[k]) porSupervisor[k] = { total: 0, cats: {} };
    porSupervisor[k].total += 1;
    porSupervisor[k].cats[a.categoria] = (porSupervisor[k].cats[a.categoria] || 0) + 1;
  });
  const ranking = Object.entries(porSupervisor)
    .map(([nombre, d]) => ({ nombre, ...d }))
    .sort((a, b) => b.total - a.total);

  const top3 = ranking.slice(0, 3);
  const maxTotal = ranking.length ? ranking[0].total : 0;
  const medallas = ["🥇", "🥈", "🥉"];

  // Distribución por categoría
  const porCategoria = Object.keys(CATEGORIAS).map(k => ({
    key: k, ...catInfo(k),
    total: acciones.filter(a => a.categoria === k).length,
  })).sort((a, b) => b.total - a.total);

  return (
    <>
      {/* Top 3 */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 12 }}>
          🏆 Top 3 — quién efectúa más modificaciones
        </div>
        {top3.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#aaa", fontSize: 13 }}>Sin datos para esta fecha.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {top3.map((s, i) => (
              <div key={s.nombre} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 10, right: 14, fontSize: 28 }}>{medallas[i]}</div>
                <div style={{ fontSize: 12, color: "#888", fontWeight: 600, marginBottom: 4 }}>#{i + 1}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a", marginBottom: 8, paddingRight: 36, wordBreak: "break-word" }}>{s.nombre}</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: "#F47B20" }}>{s.total}</div>
                <div style={{ fontSize: 11, color: "#888" }}>acciones</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ranking completo */}
      {ranking.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 12 }}>
            Todos los supervisores
          </div>
          <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "#1a3a6b", color: "#fff", textAlign: "left" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Supervisor</th>
                  <th style={{ ...thStyle, width: "45%" }}>Total de acciones</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((s, i) => (
                  <tr key={s.nombre} style={{ borderTop: "0.5px solid #eef0f3" }}>
                    <td style={{ ...tdStyle, color: "#888", fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: "#1a1a1a", wordBreak: "break-word" }}>{s.nombre}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, background: "#eef2f7", borderRadius: 6, height: 10, overflow: "hidden", maxWidth: 240 }}>
                          <div style={{ width: `${maxTotal ? (s.total / maxTotal) * 100 : 0}%`, background: "#F47B20", height: "100%" }} />
                        </div>
                        <span style={{ fontWeight: 700, color: "#1a1a1a", minWidth: 24 }}>{s.total}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Distribución por tipo de cambio */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 12 }}>
          Distribución por tipo de cambio
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          {porCategoria.map(c => (
            <div key={c.key} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "14px" }}>
              <div style={{ fontSize: 12, color: c.color, fontWeight: 600, marginBottom: 6 }}>{c.icon} {c.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#1a1a1a" }}>{c.total}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Estilos de tabla reutilizables ────────────────────────────────────
const thStyle = { padding: "10px 14px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 };
const tdStyle = { padding: "10px 14px", verticalAlign: "middle" };

export default ModuloAuditoriaMeli;
