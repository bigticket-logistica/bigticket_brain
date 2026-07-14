import { useState, useEffect, Fragment } from "react";
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

// ─── Traducción de motivos de rechazo (reason) a español legible ───────
// MELI los envía como códigos técnicos. Traducimos los conocidos y dejamos
// el código crudo como fallback para no perder información en los nuevos.
const MOTIVOS = {
  vehicle_unavailable: "Vehículo no disponible",
  driver_unavailable:  "Conductor no disponible",
  no_driver:           "Sin conductor asignado",
  no_vehicle:          "Sin vehículo asignado",
  capacity_exceeded:   "Capacidad excedida",
  out_of_zone:         "Fuera de zona",
  schedule_conflict:   "Conflicto de horario",
  operational_issue:   "Problema operativo",
  other:               "Otro motivo",
};
const motivoLegible = (r) => (r ? (MOTIVOS[r] || r) : null);

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
    const motivoRaw = a.reason || (a.payload_shape && a.payload_shape.reason);
    const motivo = motivoRaw ? ` · ${motivoLegible(motivoRaw)}` : "";
    return `${n || (a.payload_shape && a.payload_shape.request_count) || 0} ruta${n === 1 ? "" : "s"}${motivo}`;
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
// Orígenes reales de una acción crítica hoy: la app Android (marca
// 'android_app') o la extensión Chrome (que NO setea plataforma → llega
// null). Por eso null/desconocido se interpreta como "Web". Si algún día
// se agrega un tercer origen, deberá setear su propio 'plataforma'.
function BadgePlataforma({ p }) {
  const map = {
    android_app:      { label: "App",    bg: "#e8f5ec", color: "#166534" },
    chrome_desktop:   { label: "Web",    bg: "#eef2f7", color: "#1a3a6b" },
    chrome_extension: { label: "Web",    bg: "#eef2f7", color: "#1a3a6b" },
  };
  // null / vacío / valor no mapeado → Web (extensión Chrome)
  const s = map[p] || { label: "Web", bg: "#eef2f7", color: "#1a3a6b" };
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 20, padding: "2px 9px", fontSize: 10, fontWeight: 700 }}>
      {s.label}
    </span>
  );
}

// ─── Interpretar el http_status: ¿la acción tuvo éxito o falló? ────────
// Es lo más valioso del detalle: distingue "hizo el cambio y funcionó" de
// "lo intentó y MELI lo rechazó". Puede venir como http_status a nivel raíz
// o dentro de payload_shape según cómo lo guardó cada origen.
function statusInfo(a) {
  const ps = a.payload_shape || {};
  const code = a.http_status ?? a.status_code ?? ps.http_status ?? ps.status_code ?? null;
  if (code == null) return { code: null, label: "Sin estado registrado", color: "#666", bg: "#f3f4f6" };
  const n = Number(code);
  if (n >= 200 && n < 300) return { code: n, label: `Éxito (${n})`, color: "#166534", bg: "#e8f5ec" };
  if (n >= 400 && n < 500) return { code: n, label: `Rechazado por MELI (${n})`, color: "#c0392b", bg: "#fbeaea" };
  if (n >= 500)            return { code: n, label: `Error del servidor (${n})`, color: "#b45309", bg: "#fef3c7" };
  return { code: n, label: `Código ${n}`, color: "#666", bg: "#f3f4f6" };
}

// ─── Fila auxiliar del detalle: etiqueta + valor ───────────────────────
function LineaDetalle({ etiqueta, children }) {
  if (children == null || children === "" ) return null;
  return (
    <div style={{ display: "flex", gap: 10, padding: "3px 0", fontSize: 12 }}>
      <span style={{ minWidth: 130, color: "#888", fontWeight: 600 }}>{etiqueta}</span>
      <span style={{ color: "#333", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

// ─── Detalle expandible de una acción crítica ──────────────────────────
// No muestra "antes/después" (la captura guarda el request enviado, no el
// estado previo). Muestra lo que SÍ existe: qué se envió, a qué endpoint,
// y sobre todo si tuvo éxito (http_status).
function DetalleAccion({ a }) {
  const ps = a.payload_shape || {};
  const st = statusInfo(a);

  // Campos específicos según la categoría
  const filasCategoria = [];
  if (a.categoria === "modificacion_vehiculo") {
    if (a.vehicle_id) filasCategoria.push(["ID de vehículo", String(a.vehicle_id)]);
    const mmv = [ps.brand, ps.model, ps.year, ps.version].filter(Boolean).join(" · ");
    if (mmv) filasCategoria.push(["Vehículo", mmv]);
    if (ps.vehicleType != null) filasCategoria.push(["Tipo de vehículo", String(ps.vehicleType)]);
    if (ps.vehicleDescription) filasCategoria.push(["Descripción", ps.vehicleDescription]);
    if (Array.isArray(ps.campos) && ps.campos.length)
      filasCategoria.push(["Campos enviados", ps.campos.join(", ")]);
  } else if (a.categoria === "aceptacion_ruta" || a.categoria === "rechazo_ruta") {
    const ids = Array.isArray(a.request_ids) ? a.request_ids
              : Array.isArray(ps.request_ids) ? ps.request_ids : [];
    if (ids.length) filasCategoria.push(["Rutas", ids.join(", ")]);
    filasCategoria.push(["Cantidad de rutas", String(ids.length || ps.request_count || 0)]);
    const motivo = motivoLegible(a.reason || ps.reason);
    if (motivo) filasCategoria.push(["Motivo", motivo]);
    if (ps.step_type) filasCategoria.push(["Etapa", ps.step_type]);
  } else if (a.categoria === "alta_padron") {
    if (a.correo || ps.correo) filasCategoria.push(["Correo del operador", a.correo || ps.correo]);
  } else if (a.categoria === "baja_conductor") {
    if (a.driver_id) filasCategoria.push(["ID de conductor", String(a.driver_id)]);
  }

  return (
    <div style={{ background: "#fafbfc", padding: "14px 18px", borderTop: "0.5px solid #eef0f3" }}>
      {/* Estado de la acción — lo más importante */}
      <div style={{ marginBottom: 10 }}>
        <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
          {st.code != null && (st.code >= 200 && st.code < 300 ? "✅ " : st.code >= 400 ? "⛔ " : "⚠️ ")}
          {st.label}
        </span>
      </div>

      {/* Detalle específico de la categoría */}
      <div style={{ marginBottom: 8 }}>
        {filasCategoria.length === 0 ? (
          <div style={{ fontSize: 12, color: "#aaa" }}>Sin detalle adicional registrado para esta acción.</div>
        ) : (
          filasCategoria.map(([et, val]) => <LineaDetalle key={et} etiqueta={et}>{val}</LineaDetalle>)
        )}
      </div>

      {/* Metadatos técnicos */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "0.5px dashed #e4e7ec" }}>
        <LineaDetalle etiqueta="Método">{a.metodo || "—"}</LineaDetalle>
        <LineaDetalle etiqueta="Endpoint">
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#555" }}>{a.endpoint || "—"}</span>
        </LineaDetalle>
        <LineaDetalle etiqueta="Origen">{a.plataforma === "android_app" ? "App Android" : "Web (extensión)"}</LineaDetalle>
        <LineaDetalle etiqueta="Registrado">{fmtFechaHora(a.ocurrido_at)} (hora MX)</LineaDetalle>
      </div>
    </div>
  );
}

// ─── ¿Las cookies de esta fila contienen una sesión MELI viva? ─────────
// Señal determinística: la cookie 'session_id' solo existe mientras la
// sesión está autenticada. Al cerrar sesión desaparece (aunque lm_user_id
// sobreviva un rato). No dependemos de la CANTIDAD de cookies (poco fiable:
// vivo=32 vs cerrado=30), sino de la PRESENCIA de session_id.
function tieneSesionViva(cookiesRaw) {
  if (!cookiesRaw) return false;
  let texto;
  if (typeof cookiesRaw === "string") {
    texto = cookiesRaw;
  } else {
    try { texto = JSON.stringify(cookiesRaw); } catch { return false; }
  }
  // Coincide con {"name":"session_id" tolerando espacios tras los dos puntos
  return /"name"\s*:\s*"session_id"/.test(texto);
}

// ─── Estado de una sesión web: primero validez, luego frescura ─────────
// Regla:
//   - Sin session_id            → Sesión cerrada (rojo), sin importar la hora.
//   - Con session_id + reciente → Activo / Reciente (verde).
//   - Con session_id + viejo    → expirada por tiempo (amarillo/rojo).
function estadoSesion(minutos, viva) {
  if (!viva) return { label: "Sesión cerrada", icon: "🔴", color: "#c0392b", bg: "#fbeaea", activo: false };
  if (minutos == null) return { label: "—", icon: "•", color: "#666", bg: "#f3f4f6", activo: false };
  if (minutos <= 60)   return { label: "Activo ahora", icon: "🟢", color: "#166534", bg: "#e8f5ec", activo: true };
  if (minutos <= 360)  return { label: "Reciente",     icon: "🟢", color: "#166534", bg: "#e8f5ec", activo: true };
  if (minutos <= 720)  return { label: ">6h sin refresco", icon: "🟡", color: "#b45309", bg: "#fef3c7", activo: false };
  return { label: "Expirado", icon: "🔴", color: "#c0392b", bg: "#fbeaea", activo: false };
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

      {/* ── BLOQUE INFERIOR 1: conexiones vía web (extensión) ── */}
      <BloqueSesionesWeb />

      {/* ── BLOQUE INFERIOR 2: conexiones vía app (celular) ── */}
      <BloqueConexionesApp />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  BLOQUE · CONEXIONES VÍA APP (celular Android)
//  Lee conexiones_app: heartbeat que la app reporta al abrirse / volver.
//  Una fila por supervisor. "Activo" = latido reciente. No hay session_id
//  aquí (la app no maneja cookies); el estado es solo por frescura de tiempo.
// ═══════════════════════════════════════════════════════════════════════
function BloqueConexionesApp() {
  const [conexiones, setConexiones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [consultadoEn, setConsultadoEn] = useState(null);

  const cargar = async () => {
    setCargando(true);
    setError(null);
    try {
      const { data, error: err } = await sb
        .from("conexiones_app")
        .select("ldap, plataforma, ultimo_latido_at")
        .order("ultimo_latido_at", { ascending: false });
      if (err) throw err;
      setConexiones(data || []);
      setConsultadoEn(new Date());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 60000);
    return () => clearInterval(t);
  }, []);

  const ahora = Date.now();
  const filas = conexiones.map(c => {
    const min = c.ultimo_latido_at
      ? (ahora - new Date(c.ultimo_latido_at).getTime()) / 60000
      : null;
    // Sin cookies/session_id en la app: estado solo por tiempo. Marcamos
    // 'viva=true' para reutilizar estadoSesion con su lógica de frescura.
    return { ...c, minutos: min, estado: estadoSesion(min, true) };
  });

  const activos = filas.filter(f => f.estado.activo).length;

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>
            📱 Conexiones vía app (celular)
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            Supervisores que han abierto la app — se reporta al abrir y al volver a ella
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "#e8f5ec", color: "#166534", borderRadius: 20, padding: "3px 11px", fontSize: 11, fontWeight: 700 }}>
            {activos} activo{activos === 1 ? "" : "s"}
          </span>
          <button onClick={cargar} disabled={cargando}
            style={{ background: "#f4f5f7", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: cargando ? "default" : "pointer", color: "#666", fontFamily: "'Geist',sans-serif" }}>
            {cargando ? "Actualizando…" : "↻ Actualizar"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "#fbeaea", border: "1px solid #f0c4c4", borderRadius: 8, padding: "12px 16px", color: "#c0392b", fontSize: 13, marginBottom: 14 }}>
          Error cargando conexiones de app: {error}
        </div>
      )}

      {!error && filas.length === 0 && !cargando ? (
        <div style={{ textAlign: "center", padding: "34px 0", color: "#aaa", fontSize: 13, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12 }}>
          Ninguna conexión de app registrada todavía.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: "#1a3a6b", color: "#fff", textAlign: "left" }}>
                <th style={thStyle}>Usuario</th>
                <th style={thStyle}>Último uso (MX)</th>
                <th style={thStyle}>Antigüedad</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Estado</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Origen</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={f.ldap || i} style={{ borderTop: "0.5px solid #eef0f3" }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: "#1a1a1a" }}>{f.ldap || "—"}</td>
                  <td style={{ ...tdStyle, color: "#666", whiteSpace: "nowrap" }}>{fmtFechaHora(f.ultimo_latido_at)}</td>
                  <td style={{ ...tdStyle, color: "#666" }}>{haceCuanto(f.minutos)}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <span style={{ background: f.estado.bg, color: f.estado.color, borderRadius: 20, padding: "2px 9px", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {f.estado.icon} {f.estado.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}><BadgePlataforma p="android_app" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#aaa", marginTop: 8, textAlign: "right" }}>
        {consultadoEn && `Consultado ${fmtFechaHora(consultadoEn.toISOString())} (MX) · se refresca solo cada minuto`}
      </div>
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
      // Traemos también 'cookies' para verificar session_id (sesión viva).
      const { data, error: err } = await sb
        .from("sesiones_meli")
        .select("id, usuario_id, cantidad_cookies, actualizado_at, cookies")
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

  // Enriquecer cada fila con minutos, validez de sesión y estado
  const ahora = Date.now();
  const filas = sesiones.map(s => {
    const min = s.actualizado_at
      ? (ahora - new Date(s.actualizado_at).getTime()) / 60000
      : null;
    const viva = tieneSesionViva(s.cookies);
    return { ...s, minutos: min, viva, estado: estadoSesion(min, viva) };
  });

  const activos = filas.filter(f => f.estado.activo).length;
  const cerrados = filas.filter(f => !f.viva).length;

  return (
    <div style={{ marginTop: 28 }}>
      {/* Encabezado del bloque */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>
            🌐 Conexiones vía web (extensión)
          </div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
            Estado de sesión MELI de cada supervisor con la extensión — "Activo" solo si la sesión sigue autenticada
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "#e8f5ec", color: "#166534", borderRadius: 20, padding: "3px 11px", fontSize: 11, fontWeight: 700 }}>
            {activos} activo{activos === 1 ? "" : "s"}
          </span>
          {cerrados > 0 && (
            <span style={{ background: "#fbeaea", color: "#c0392b", borderRadius: 20, padding: "3px 11px", fontSize: 11, fontWeight: 700 }}>
              {cerrados} cerrada{cerrados === 1 ? "" : "s"}
            </span>
          )}
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
                <th style={thStyle}>Último refresco (MX)</th>
                <th style={thStyle}>Antigüedad</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Estado</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Origen</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={f.id || f.usuario_id || i} style={{ borderTop: "0.5px solid #eef0f3" }}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: "#1a1a1a" }}>{f.usuario_id || "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "center", color: "#444" }}>{f.cantidad_cookies ?? "—"}</td>
                  <td style={{ ...tdStyle, color: "#666", whiteSpace: "nowrap" }}>{fmtFechaHora(f.actualizado_at)}</td>
                  <td style={{ ...tdStyle, color: "#666" }}>{haceCuanto(f.minutos)}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <span style={{ background: f.estado.bg, color: f.estado.color, borderRadius: 20, padding: "2px 9px", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {f.estado.icon} {f.estado.label}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}><BadgePlataforma p="chrome_extension" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#aaa", marginTop: 8, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <span>El estado "Activo" requiere que la cookie de sesión siga presente, no solo que el refresco sea reciente.</span>
        {refrescadoEn && (
          <span>Consultado {fmtFechaHora(refrescadoEn.toISOString())} (MX) · se refresca solo cada minuto</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  VISTA 1 · LISTADO (con detalle expandible por fila)
// ═══════════════════════════════════════════════════════════════════════
function VistaListado({ acciones, filtroCat, setFiltroCat }) {
  const [abierta, setAbierta] = useState(null); // id de la fila expandida

  const toggle = (id) => setAbierta(prev => (prev === id ? null : id));

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
        <span style={{ fontSize: 11, color: "#aaa" }}>· clic en una fila para ver el detalle</span>
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
                <th style={{ ...thStyle, width: 34 }}></th>
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
                const id = a.id || i;
                const estaAbierta = abierta === id;
                return (
                  <Fragment key={id}>
                    <tr
                      onClick={() => toggle(id)}
                      style={{ borderTop: "0.5px solid #eef0f3", cursor: "pointer", background: estaAbierta ? "#f4f7fb" : "transparent" }}>
                      <td style={{ ...tdStyle, textAlign: "center", color: "#999", userSelect: "none" }}>
                        <span style={{ display: "inline-block", transition: "transform .15s", transform: estaAbierta ? "rotate(90deg)" : "rotate(0deg)" }}>▸</span>
                      </td>
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
                    {estaAbierta && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0 }}>
                          <DetalleAccion a={a} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
