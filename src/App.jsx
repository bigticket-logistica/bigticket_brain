// ═══════════════════════════════════════════════════════════════════════════
// BITÁCORA DEL SUPERVISOR · BIGTICKET
// Archivo único con toda la app. Solo dependencias externas: React + Supabase.
// Para deployar cambios: copiar este archivo entero al GitHub y commit.
//
// Estructura interna:
//   §1  Design system (colores + CSS)
//   §2  Helpers (fecha/hora MX + formato)
//   §3  Hook useAuth
//   §4  Hook useBitacora
//   §5  Hook useConciliacionD1
//   §6  Componentes UI reusables (BotonSiNo, TimerLimite, ItemAcordeon, AutocompletePatentes)
//   §7  Los 5 ítems del formulario diario
//   §8  Componente FormularioSC (formulario de hoy)
//   §9  Componentes de Conciliaciones D-1 (panel indicadores + comparativo + patentes)
//   §10 Pantallas (Login, Landing con tabs)
//   §11 App root
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { sb } from "./supabase.js";
import { BIGGY_IMG } from "./biggy-img.js";

// ═══════════════════════════════════════════════════════════════════════════
// §1 DESIGN SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

const colors = {
  navy: "#1a3a6b", navyDark: "#13294d",
  orange: "#F47B20", orangeDark: "#d96a18",
  bg: "#f0f2f5", surface: "#ffffff",
  border: "#e4e7ec", borderStrong: "#d0d5dd",
  textPrimary: "#1a1a1a", textSecondary: "#475569", textMuted: "#94a3b8",
  green: "#16a34a", amber: "#d97706", red: "#dc2626", purple: "#7c3aed",
  redBg: "#fee2e2", redText: "#c0392b",
  greenBg: "#dcfce7", greenText: "#166534",
  amberBg: "#fef9f3", amberText: "#9a3412",
};

const css = `
  @import url('https://fonts.bunny.net/css?family=geist:400,500,600,700,800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Geist',sans-serif;background:${colors.bg};min-height:100vh;}
  .topbar{background:${colors.navy};padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
  .btn-gw{background:transparent;color:#fff;border:0.5px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:'Geist',sans-serif;}
  .field-row{margin-bottom:14px;}
  .field-label{font-size:12px;color:#555;margin-bottom:4px;display:block;font-weight:500;}
  input,select,textarea{width:100%;padding:9px 12px;border:0.5px solid ${colors.borderStrong};border-radius:8px;font-size:13px;background:#fff;color:${colors.textPrimary};font-family:'Geist',sans-serif;outline:none;}
  input:focus,select:focus,textarea:focus{border-color:${colors.navy};}
  textarea{resize:vertical;min-height:60px;}
  .btn-blue{background:${colors.navy};color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Geist',sans-serif;}
  .btn-blue:disabled{background:#ccc;cursor:not-allowed;}
  .pg{padding:20px;max-width:1400px;margin:0 auto;padding-bottom:40px;}
  .sec-title{font-size:20px;font-weight:700;color:${colors.textPrimary};margin-bottom:4px;}
  .sec-sub{font-size:13px;color:#666;margin-bottom:20px;}
  .card{background:${colors.surface};border:1px solid ${colors.border};border-radius:14px;padding:20px;margin-bottom:16px;}
  .login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:${colors.bg};padding:20px;}
  .login-card{background:${colors.surface};border-radius:16px;padding:40px 32px;width:100%;max-width:400px;border:0.5px solid ${colors.border};box-shadow:0 4px 16px rgba(0,0,0,0.04);}
  .sc-card{background:${colors.surface};border:1px solid ${colors.border};border-radius:14px;padding:24px;}
  .sc-badge{display:inline-block;background:${colors.navy};color:#fff;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;letter-spacing:0.5px;margin-right:8px;}
  .alert-error{background:${colors.redBg};border-radius:8px;padding:10px 14px;font-size:13px;color:${colors.redText};margin-bottom:14px;text-align:center;}
  .alert-info{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;font-size:13px;color:#1e40af;}
  .loading{text-align:center;padding:40px;color:${colors.textMuted};font-size:14px;}
  .tab-bar{display:flex;gap:4px;background:${colors.surface};border-radius:10px;padding:4px;border:1px solid ${colors.border};margin-bottom:20px;}
  .tab-btn{flex:1;padding:10px 16px;font-size:13px;font-weight:600;border:none;border-radius:8px;cursor:pointer;background:transparent;color:${colors.textSecondary};font-family:'Geist',sans-serif;transition:all 0.15s;}
  .tab-btn.active{background:${colors.navy};color:#fff;}
  .kpi-card{background:${colors.surface};border:1px solid ${colors.border};border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;}
  .kpi-label{font-size:10px;color:${colors.textMuted};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;}
  .kpi-value{font-size:24px;font-weight:700;color:${colors.navy};}
  .kpi-sub{font-size:11px;color:${colors.textMuted};}
  @keyframes pulseRed{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.15);opacity:0.6;}}
`;

// ═══════════════════════════════════════════════════════════════════════════
// §2 HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const TZ_MX = "America/Mexico_City";

function fechaHoyMX() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_MX, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function horaAhoraMX() {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ_MX, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

function nowEnMX() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_MX, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const obj = {};
  partes.forEach((p) => (obj[p.type] = p.value));
  return new Date(`${obj.year}-${obj.month}-${obj.day}T${obj.hour}:${obj.minute}:${obj.second}`);
}

function fechaAyerMX() {
  const hoy = nowEnMX();
  hoy.setDate(hoy.getDate() - 1);
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, "0");
  const d = String(hoy.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fechaFormatMX(yyyymmdd) {
  // "2026-05-27" → "27 de mayo de 2026"
  if (!yyyymmdd) return "";
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return `${d} de ${meses[m - 1]} de ${y}`;
}

function msRestantesHastaMedianocheMX() {
  const ahora = nowEnMX();
  const fin = new Date(ahora);
  fin.setHours(23, 59, 59, 999);
  return Math.max(0, fin.getTime() - ahora.getTime());
}

function formatearTiempoRestante(ms) {
  if (ms <= 0) return "00:00:00";
  const t = Math.floor(ms / 1000);
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
    .map((n) => String(n).padStart(2, "0")).join(":");
}

function nivelUrgencia(ms) {
  if (ms <= 0) return "vencido";
  if (ms < 2 * 3600 * 1000) return "urgente";
  if (ms < 4 * 3600 * 1000) return "atento";
  return "tranquilo";
}

function truncar(s, max = 30) {
  if (!s) return "";
  const str = String(s);
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(v) {
  return `${num(v).toFixed(1)}%`;
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 HOOK useAuth
// ═══════════════════════════════════════════════════════════════════════════

function useAuth() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  async function cargarPerfilParaUser(userId) {
    if (!userId) {
      if (mountedRef.current) setPerfil(null);
      return null;
    }
    try {
      const { data, error: err } = await sb
        .from("supervisores_bt").select("*")
        .eq("user_id", userId).eq("activo", true).maybeSingle();
      if (!mountedRef.current) return null;
      if (err) {
        console.error(err);
        setPerfil(null);
        setError("Error al cargar el perfil. Reintenta más tarde.");
        return null;
      }
      if (!data) {
        setPerfil(null);
        setError("Tu cuenta no tiene un perfil activo. Contactá al administrador.");
        return null;
      }
      setPerfil(data);
      setError(null);
      return data;
    } catch (e) {
      console.error(e);
      if (mountedRef.current) {
        setPerfil(null);
        setError("Error de red. Reintenta.");
      }
      return null;
    }
  }

  async function procesarSesion(sess) {
    if (!mountedRef.current) return;
    setSession(sess);
    if (sess?.user?.id) await cargarPerfilParaUser(sess.user.id);
    else setPerfil(null);
    if (mountedRef.current) setLoading(false);
  }

  useEffect(() => {
    mountedRef.current = true;
    sb.auth.getSession().then(({ data }) => procesarSesion(data.session));
    const { data: listener } = sb.auth.onAuthStateChange((_event, sess) => {
      if (mountedRef.current) setLoading(true);
      procesarSesion(sess);
    });
    return () => {
      mountedRef.current = false;
      listener?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email, password) {
    setError(null);
    const { data, error: err } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });
    if (err) {
      setError(mensajeErrorAuth(err.message));
      return { error: err };
    }
    return { data };
  }

  async function signOut() {
    setError(null);
    await sb.auth.signOut();
  }

  return { loading, session, perfil, signIn, signOut, error };
}

function mensajeErrorAuth(msg) {
  const m = String(msg || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "Email o contraseña incorrectos";
  if (m.includes("email not confirmed")) return "Email aún no confirmado";
  if (m.includes("too many requests")) return "Demasiados intentos. Esperá un minuto.";
  if (m.includes("network")) return "Error de red. Revisá tu conexión.";
  return msg || "Error al iniciar sesión";
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 HOOK useBitacora — gestiona la bitácora de UN SC para UNA fecha
// ═══════════════════════════════════════════════════════════════════════════

const TOTAL_ITEMS = 5;

function useBitacora(scId, perfil, fechaArg) {
  // fechaArg permite cargar tanto "hoy" como "ayer" (para conciliaciones)
  const fecha = fechaArg || fechaHoyMX();
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    if (!scId || !perfil) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await sb
        .from("bitacora_diaria_sc").select("*")
        .eq("service_center_id", scId).eq("fecha", fecha).maybeSingle();
      if (err) throw err;
      setRow(data || null);
    } catch (e) {
      console.error("Error cargando bitácora:", e);
      setError("No se pudo cargar la bitácora");
    } finally {
      setLoading(false);
    }
  }, [scId, fecha, perfil]);

  useEffect(() => { cargar(); }, [cargar]);

  const actualizar = useCallback(async (campos) => {
    if (!scId || !perfil) return { error: "Sin contexto" };
    setSaving(true);
    setError(null);
    try {
      const payload = {
        service_center_id: scId, fecha,
        supervisor_email: perfil.email,
        supervisor_nombre: perfil.nombre,
        ...campos,
      };
      const { data, error: err } = await sb
        .from("bitacora_diaria_sc")
        .upsert(payload, { onConflict: "service_center_id,fecha" })
        .select().single();
      if (err) throw err;
      setRow(data);
      return { data };
    } catch (e) {
      console.error("Error guardando bitácora:", e);
      setError("No se pudo guardar. Reintentá.");
      return { error: e };
    } finally {
      setSaving(false);
    }
  }, [scId, fecha, perfil]);

  const cerrar = useCallback(
    () => actualizar({ estado_dia: "cerrado_supervisor" }),
    [actualizar]
  );

  return { loading, row, saving, error, actualizar, cerrar, recargar: cargar, fecha };
}

function contarItemsContestados(row) {
  if (!row) return 0;
  let c = 0;
  if (row.declarado_ayudantes_si_no !== null) c++;
  if (row.declarado_ambulancias_si_no !== null) c++;
  if (row.declarado_cancelaciones_si_no !== null) c++;
  if (row.declarado_noshow_si_no !== null) c++;
  if (row.declarado_pnr_si_no !== null) c++;
  return c;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 HOOK useConciliacionD1 — carga los datos reales detectados de AYER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Devuelve { loading, error, datos } donde datos contiene:
 *   - jornada[]: filas de maestro_jornada_mx (1 por ruta)
 *   - helpers[]: filas de vw_control_helper_diario
 *   - pnrCasos[]: filas de pnr_casos
 *   - torre[]: filas de vw_torre_3_pilares
 *   - flotaSc[]: placas de flota_vehiculos_bt del SC (para detectar nuevas)
 *   - kpis: objeto calculado con los 7 indicadores
 */
function useConciliacionD1(scId) {
  const fecha = fechaAyerMX();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    if (!scId) return;
    let cancel = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [jornadaR, helpersR, pnrR, torreR, flotaR] = await Promise.all([
          sb.from("maestro_jornada_mx").select("*")
            .eq("service_center_id", scId).eq("fecha", fecha),
          sb.from("vw_control_helper_diario").select("*")
            .eq("sc", scId).eq("fecha", fecha),
          sb.from("pnr_casos").select("*")
            .eq("estacion_origen", scId)
            .gte("fecha_caso", `${fecha}T00:00:00`)
            .lt("fecha_caso", `${fecha}T23:59:59.999`),
          sb.from("vw_torre_3_pilares").select("*")
            .eq("sc", scId).eq("fecha", fecha),
          sb.from("flota_vehiculos_bt").select("placa, service_center_id, activo")
            .eq("service_center_id", scId).eq("activo", true),
        ]);

        if (cancel) return;

        const jornada = jornadaR.data || [];
        const helpers = helpersR.data || [];
        const pnrCasos = pnrR.data || [];
        const torre = torreR.data || [];
        const flotaSc = flotaR.data || [];

        // ── Cálculo de KPIs ───────────────────────────────────────────
        const kpis = calcularKpisD1({ jornada, helpers, pnrCasos, torre, flotaSc });

        setDatos({ jornada, helpers, pnrCasos, torre, flotaSc, kpis, fecha });
      } catch (e) {
        if (!cancel) {
          console.error("Error cargando conciliación D-1:", e);
          setError("No se pudieron cargar los datos del día anterior");
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();

    return () => { cancel = true; };
  }, [scId, fecha]);

  return { loading, error, datos, fecha };
}

function calcularKpisD1({ jornada, helpers, pnrCasos, torre, flotaSc }) {
  // 1) NS del día (promedio simple de ns_pct de cada ruta)
  const conNS = jornada.filter((r) => r.ns_pct !== null && r.ns_pct !== undefined);
  const nsPromedio = conNS.length > 0
    ? conNS.reduce((s, r) => s + num(r.ns_pct), 0) / conNS.length
    : 0;

  // 2) NS de puntos visitados = 100 - ns_no_visitado promedio
  const conNV = jornada.filter((r) => r.ns_no_visitado !== null && r.ns_no_visitado !== undefined);
  const noVisitadoProm = conNV.length > 0
    ? conNV.reduce((s, r) => s + num(r.ns_no_visitado), 0) / conNV.length
    : 0;
  const nsPuntosVisitados = 100 - noVisitadoProm;

  // 3) Rutas con helper (vw_control_helper_diario es chofer×helper, hay que distinct id_ruta)
  const rutasConHelperSet = new Set();
  const rutasProhibidasSet = new Set();
  helpers.forEach((h) => {
    if (h.helper_flag === true) {
      rutasConHelperSet.add(h.id_ruta);
      // Helper prohibido: foránea + small van (regla del usuario)
      const esForanea = String(h.zona || "").toLowerCase().includes("foran");
      const esSmall = String(h.vehiculo || "").toLowerCase().includes("small van");
      if (esForanea && esSmall) rutasProhibidasSet.add(h.id_ruta);
    }
  });

  // 4) PNR (total y abiertos)
  const pnrTotal = pnrCasos.length;
  const ESTADOS_ABIERTOS = new Set(["Esperando comprobante", "Comprobante cargado"]);
  const pnrAbiertos = pnrCasos.filter((p) => ESTADOS_ABIERTOS.has(p.estado)).length;

  // 5) No Show (de torre 3 pilares)
  const noShowRows = torre.filter((t) => t.bucket === "3_RF2_NO_SHOW");
  const noShowCount = noShowRows.length;
  const noShowPlacas = [...new Set(noShowRows.map((t) => t.vehicle_plate).filter(Boolean))];

  // 6) Cancelaciones MELI (post-asignación + tardía)
  const cancelRows = torre.filter((t) =>
    t.bucket === "4_CANCEL_MELI_TARDIA" || t.bucket === "5_CANCEL_MELI_POST_ASIGNACION"
  );
  const cancelCount = cancelRows.length;

  // 7) Patentes nuevas detectadas (operaron ayer y NO están en flota del SC)
  const placasFlota = new Set(flotaSc.map((f) => String(f.placa).trim().toUpperCase()));
  const placasOperaronAyer = new Set();
  helpers.forEach((h) => {
    if (h.placa) placasOperaronAyer.add(String(h.placa).trim().toUpperCase());
  });
  jornada.forEach((j) => {
    if (j.placa) placasOperaronAyer.add(String(j.placa).trim().toUpperCase());
  });
  const placasNuevas = [...placasOperaronAyer].filter((p) => !placasFlota.has(p));

  return {
    rutas: jornada.length,
    nsPromedio,
    nsPuntosVisitados,
    rutasConHelper: rutasConHelperSet.size,
    rutasProhibidas: rutasProhibidasSet.size,
    pnrTotal, pnrAbiertos,
    noShowCount, noShowPlacas,
    cancelCount,
    placasNuevas,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 COMPONENTES UI REUSABLES
// ═══════════════════════════════════════════════════════════════════════════

function BotonSiNo({ value, onChange, disabled = false }) {
  const base = {
    flex: 1, padding: "12px 16px", fontSize: 14, fontWeight: 600,
    border: "none", borderRadius: 10,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'Geist', sans-serif",
    transition: "all 0.15s", opacity: disabled ? 0.5 : 1,
  };
  const estilo = (act) => act
    ? { ...base, background: colors.navy, color: "#fff" }
    : { ...base, background: "#f1f5f9", color: colors.textSecondary };
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <button type="button" style={estilo(value === true)} onClick={() => !disabled && onChange(true)} disabled={disabled}>Sí</button>
      <button type="button" style={estilo(value === false)} onClick={() => !disabled && onChange(false)} disabled={disabled}>No</button>
    </div>
  );
}

function TimerLimite() {
  const [ms, setMs] = useState(msRestantesHastaMedianocheMX());
  useEffect(() => {
    const id = setInterval(() => setMs(msRestantesHastaMedianocheMX()), 1000);
    return () => clearInterval(id);
  }, []);
  const nivel = nivelUrgencia(ms);
  const cfg = {
    tranquilo: { color: colors.navy, bg: "#eff6ff", borde: "#bfdbfe", icono: "⏱", label: "Tiempo restante para cerrar la bitácora", parpadea: false },
    atento: { color: colors.orange, bg: "#fff7ed", borde: "#fed7aa", icono: "🔔", label: "Atención: tiempo limitado para cerrar", parpadea: false },
    urgente: { color: colors.red, bg: "#fef2f2", borde: "#fecaca", icono: "🔔", label: "URGENTE: menos de 2 horas para cerrar", parpadea: true },
    vencido: { color: colors.textMuted, bg: "#f1f5f9", borde: colors.border, icono: "🔒", label: "Día cerrado · ya no podés editar", parpadea: false },
  }[nivel];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: cfg.bg, border: `1px solid ${cfg.borde}`, borderRadius: 10, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22, display: "inline-block", animation: cfg.parpadea ? "pulseRed 1s infinite" : "none" }}>{cfg.icono}</span>
        <div>
          <div style={{ fontSize: 12, color: cfg.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{cfg.label}</div>
          {nivel !== "vencido" && <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>Hora límite: 23:59 hs (México)</div>}
        </div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: cfg.color, fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
        {formatearTiempoRestante(ms)}
      </div>
    </div>
  );
}

function ItemAcordeon({ numero, titulo, resumen, estado = "vacio", abierto, onToggle, bloqueado = false, children }) {
  const estCfg = {
    vacio: { label: "Sin contestar", color: colors.textMuted, bg: "transparent" },
    borrador: { label: "Borrador guardado", color: colors.orange, bg: "#fff7ed" },
    guardado: { label: "✓ Completado", color: colors.green, bg: colors.greenBg },
  }[estado];
  return (
    <div style={{ background: colors.surface, border: `1px solid ${abierto ? colors.navy : colors.border}`, borderRadius: 10, marginBottom: 10, overflow: "hidden", transition: "border-color 0.15s" }}>
      <button type="button" onClick={onToggle}
        style={{ width: "100%", padding: "12px 14px", background: abierto ? "#fafbfc" : "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, fontFamily: "'Geist', sans-serif", textAlign: "left" }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: estado === "guardado" ? colors.green : estado === "borrador" ? colors.orange : colors.navy, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{numero}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>{titulo}</div>
          {!abierto && resumen && <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{resumen}</div>}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, padding: "4px 8px", borderRadius: 5, background: estCfg.bg, color: estCfg.color, flexShrink: 0 }}>{estCfg.label}</span>
        <span style={{ fontSize: 14, color: colors.textMuted, transform: abierto ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", flexShrink: 0 }}>▾</span>
      </button>
      {abierto && (
        <div style={{ padding: "16px 14px", borderTop: `1px solid ${colors.border}`, opacity: bloqueado ? 0.6 : 1, pointerEvents: bloqueado ? "none" : "auto" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function AutocompletePatentes({ scId, selected = [], onChange, disabled = false }) {
  const [flota, setFlota] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from("flota_vehiculos_bt")
        .select("placa, service_center_id, tipo_vehiculo, empresa_transporte, flota_tipo, es_compartida_entre_scs, tripulacion, activo")
        .eq("activo", true).order("placa");
      if (cancel) return;
      if (error) { console.error(error); setFlota([]); }
      else setFlota(data || []);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    function clickOut(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", clickOut);
    return () => document.removeEventListener("mousedown", clickOut);
  }, []);

  const resultados = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) {
      const propias = flota.filter((f) => f.service_center_id === scId);
      const otras = flota.filter((f) => f.service_center_id !== scId);
      return [...propias, ...otras].slice(0, 30);
    }
    const matches = flota.filter((f) => {
      const placaM = f.placa.toUpperCase().includes(q);
      const choferM = f.tripulacion?.some?.((t) => (t.nombre || "").toUpperCase().includes(q));
      return placaM || choferM;
    });
    const propias = matches.filter((f) => f.service_center_id === scId);
    const otras = matches.filter((f) => f.service_center_id !== scId);
    return [...propias, ...otras].slice(0, 30);
  }, [flota, query, scId]);

  function agregar(placa) {
    if (selected.includes(placa)) return;
    onChange([...selected, placa]);
    setQuery(""); setOpen(false);
  }

  function quitar(placa) {
    onChange(selected.filter((p) => p !== placa));
  }

  function choferDe(f) {
    if (!Array.isArray(f.tripulacion) || f.tripulacion.length === 0) return "";
    const c = f.tripulacion.find((t) => t.cargo === "CHOFER") || f.tripulacion[0];
    return c?.nombre || "";
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <input type="text" value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? "Cargando flota..." : "Escribe placa o nombre del chofer..."}
        disabled={disabled || loading} />
      {open && !loading && resultados.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 8, marginTop: 4, maxHeight: 320, overflowY: "auto", zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
          {resultados.map((f) => {
            const ya = selected.includes(f.placa);
            const esMi = f.service_center_id === scId;
            return (
              <div key={`${f.placa}-${f.service_center_id}`} onClick={() => !ya && agregar(f.placa)}
                style={{ padding: "10px 12px", borderBottom: `1px solid ${colors.border}`, cursor: ya ? "default" : "pointer", opacity: ya ? 0.4 : 1, background: esMi ? "#fff" : "#fafbfc" }}
                onMouseEnter={(e) => { if (!ya) e.currentTarget.style.background = "#eff6ff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = esMi ? "#fff" : "#fafbfc"; }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: colors.textPrimary }}>{f.placa}</span>
                    <span style={{ marginLeft: 10, fontSize: 11, color: colors.textMuted }}>{f.tipo_vehiculo}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <span style={{ fontSize: 10, background: esMi ? colors.navy : "#e2e8f0", color: esMi ? "#fff" : colors.textSecondary, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>{f.service_center_id}</span>
                    {f.es_compartida_entre_scs && <span style={{ fontSize: 10, background: colors.amberBg, color: colors.amberText, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>COMPARTIDA</span>}
                    {f.flota_tipo === "BACK UP" && <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>BACKUP</span>}
                  </div>
                </div>
                {choferDe(f) && <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{choferDe(f)}</div>}
              </div>
            );
          })}
        </div>
      )}
      {open && !loading && resultados.length === 0 && query && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: `1px solid ${colors.border}`, borderRadius: 8, marginTop: 4, padding: 14, fontSize: 12, color: colors.textMuted, zIndex: 50 }}>
          No se encontraron placas para "{query}"
        </div>
      )}
      {selected.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {selected.map((p) => (
            <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", background: colors.navy, color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: "monospace", borderRadius: 6 }}>
              {p}
              {!disabled && (
                <button type="button" onClick={() => quitar(p)}
                  style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1, width: "auto" }}
                  aria-label={`Quitar ${p}`}>×</button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// §7 LOS 5 ÍTEMS DEL FORMULARIO DIARIO
// ═══════════════════════════════════════════════════════════════════════════

// ── Item 1: Ayudantes ──────────────────────────────────────────────────
function Item1Ayudantes({ row, onGuardar, saving, bloqueado, onCerrar }) {
  const [siNo, setSiNo] = useState(row?.declarado_ayudantes_si_no ?? null);
  const [cantidad, setCantidad] = useState(row?.declarado_ayudantes_cantidad ?? "");
  useEffect(() => {
    setSiNo(row?.declarado_ayudantes_si_no ?? null);
    setCantidad(row?.declarado_ayudantes_cantidad ?? "");
  }, [row?.declarado_ayudantes_si_no, row?.declarado_ayudantes_cantidad]);
  const puede = siNo === false || (siNo === true && Number(cantidad) > 0);
  async function guardar() {
    if (!puede) return;
    const r = await onGuardar({
      declarado_ayudantes_si_no: siNo,
      declarado_ayudantes_cantidad: siNo ? Number(cantidad) : null,
    });
    if (!r?.error) onCerrar?.();
  }
  return (
    <div>
      <div className="field-row">
        <span className="field-label">¿Tuviste ayudantes hoy?</span>
        <BotonSiNo value={siNo} onChange={setSiNo} disabled={bloqueado || saving} />
      </div>
      {siNo === true && (
        <div className="field-row">
          <span className="field-label">¿En cuántas rutas tuviste ayudante?</span>
          <input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 8" disabled={bloqueado || saving} style={{ maxWidth: 160 }} />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
        <button className="btn-blue" onClick={guardar} disabled={!puede || saving || bloqueado}>{saving ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </div>
  );
}
function resumenAyudantes(row) {
  if (!row || row.declarado_ayudantes_si_no === null) return null;
  if (row.declarado_ayudantes_si_no === false) return "No tuvo ayudantes";
  return `Sí — ${row.declarado_ayudantes_cantidad || 0} ruta(s)`;
}

// ── Item 2: Ambulancias ────────────────────────────────────────────────
function Item2Ambulancias({ row, onGuardar, saving, bloqueado, onCerrar }) {
  const [siNo, setSiNo] = useState(row?.declarado_ambulancias_si_no ?? null);
  const [cantidad, setCantidad] = useState(row?.declarado_ambulancias_cantidad ?? "");
  useEffect(() => {
    setSiNo(row?.declarado_ambulancias_si_no ?? null);
    setCantidad(row?.declarado_ambulancias_cantidad ?? "");
  }, [row?.declarado_ambulancias_si_no, row?.declarado_ambulancias_cantidad]);
  const puede = siNo === false || (siNo === true && Number(cantidad) > 0);
  async function guardar() {
    if (!puede) return;
    const r = await onGuardar({
      declarado_ambulancias_si_no: siNo,
      declarado_ambulancias_cantidad: siNo ? Number(cantidad) : null,
    });
    if (!r?.error) onCerrar?.();
  }
  return (
    <div>
      <div className="field-row">
        <span className="field-label">¿Tuviste ambulancias hoy?</span>
        <BotonSiNo value={siNo} onChange={setSiNo} disabled={bloqueado || saving} />
      </div>
      {siNo === true && (
        <div className="field-row">
          <span className="field-label">¿Cuántas ambulancias?</span>
          <input type="number" min="1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 2" disabled={bloqueado || saving} style={{ maxWidth: 160 }} />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
        <button className="btn-blue" onClick={guardar} disabled={!puede || saving || bloqueado}>{saving ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </div>
  );
}
function resumenAmbulancias(row) {
  if (!row || row.declarado_ambulancias_si_no === null) return null;
  if (row.declarado_ambulancias_si_no === false) return "No tuvo ambulancias";
  return `Sí — ${row.declarado_ambulancias_cantidad || 0} ambulancia(s)`;
}

// ── Item 3: Cancelaciones MELI ─────────────────────────────────────────
const BUCKET_FOTOS = "bitacora-cancelaciones-meli";

function Item3Cancelaciones({ row, scId, onGuardar, saving, bloqueado, onCerrar }) {
  const [siNo, setSiNo] = useState(row?.declarado_cancelaciones_si_no ?? null);
  const [fotos, setFotos] = useState(Array.isArray(row?.declarado_cancelaciones_fotos) ? row.declarado_cancelaciones_fotos : []);
  const [signedUrls, setSignedUrls] = useState({});
  const [subiendo, setSubiendo] = useState(false);
  const [errSubida, setErrSubida] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setSiNo(row?.declarado_cancelaciones_si_no ?? null);
    setFotos(Array.isArray(row?.declarado_cancelaciones_fotos) ? row.declarado_cancelaciones_fotos : []);
  }, [row?.declarado_cancelaciones_si_no, row?.declarado_cancelaciones_fotos]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const nuevas = {};
      for (const f of fotos) {
        if (!f?.path) continue;
        const { data, error } = await sb.storage.from(BUCKET_FOTOS).createSignedUrl(f.path, 3600);
        if (!cancel && data?.signedUrl && !error) nuevas[f.path] = data.signedUrl;
      }
      if (!cancel) setSignedUrls(nuevas);
    })();
    return () => { cancel = true; };
  }, [fotos]);

  async function handleFile(file) {
    if (!file) return;
    setErrSubida(null);
    setSubiendo(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Solo se permiten imágenes");
      if (file.size > 5 * 1024 * 1024) throw new Error("La foto excede 5 MB");
      const fecha = fechaHoyMX();
      const ts = Date.now().toString();
      const nombreLimpio = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${scId}/${fecha}/${ts}_${nombreLimpio}`;
      const { error: errUp } = await sb.storage.from(BUCKET_FOTOS).upload(path, file, { contentType: file.type, upsert: false });
      if (errUp) throw errUp;
      const nuevaFoto = { path, nombre: file.name, subido_at: new Date().toISOString(), size: file.size };
      const nuevasFotos = [...fotos, nuevaFoto];
      setFotos(nuevasFotos);
      await onGuardar({ declarado_cancelaciones_si_no: true, declarado_cancelaciones_fotos: nuevasFotos });
      setSiNo(true);
    } catch (e) {
      console.error(e);
      setErrSubida(e.message || "No se pudo subir");
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function quitarFoto(path) {
    if (!confirm("¿Quitar esta foto?")) return;
    await sb.storage.from(BUCKET_FOTOS).remove([path]);
    const nuevas = fotos.filter((f) => f.path !== path);
    setFotos(nuevas);
    await onGuardar({ declarado_cancelaciones_fotos: nuevas });
  }

  const puede = siNo === false || (siNo === true && fotos.length > 0);
  async function guardar() {
    if (!puede) return;
    if (siNo === false && fotos.length > 0) {
      const paths = fotos.map((f) => f.path);
      await sb.storage.from(BUCKET_FOTOS).remove(paths);
    }
    const r = await onGuardar({
      declarado_cancelaciones_si_no: siNo,
      declarado_cancelaciones_fotos: siNo ? fotos : [],
    });
    if (!r?.error) onCerrar?.();
  }

  return (
    <div>
      <div className="field-row">
        <span className="field-label">¿Tuviste cancelaciones por parte de MELI hoy?</span>
        <BotonSiNo value={siNo} onChange={setSiNo} disabled={bloqueado || saving || subiendo} />
      </div>
      {siNo === true && (
        <>
          <div className="field-row">
            <span className="field-label">Subí las fotos como prueba (capturas de WhatsApp de MELI, etc.)</span>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={bloqueado || subiendo}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#fff", border: `1.5px dashed ${colors.navy}`, borderRadius: 8, color: colors.navy, fontSize: 13, fontWeight: 600, cursor: subiendo ? "wait" : "pointer", width: "auto" }}>
              📎 {subiendo ? "Subiendo..." : "Agregar foto"}
            </button>
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
            {errSubida && <div style={{ marginTop: 8, fontSize: 12, color: colors.red }}>{errSubida}</div>}
          </div>
          {fotos.length > 0 && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {fotos.map((f) => (
                <div key={f.path} style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: "hidden", position: "relative", background: "#f8fafc" }}>
                  {signedUrls[f.path] ? (
                    <a href={signedUrls[f.path]} target="_blank" rel="noopener noreferrer">
                      <img src={signedUrls[f.path]} alt={f.nombre} style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
                    </a>
                  ) : (
                    <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: colors.textMuted }}>Cargando...</div>
                  )}
                  <div style={{ padding: "4px 8px", fontSize: 10, color: colors.textSecondary, borderTop: `1px solid ${colors.border}` }}>{truncar(f.nombre, 18)}</div>
                  {!bloqueado && (
                    <button type="button" onClick={() => quitarFoto(f.path)}
                      style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", background: "rgba(220,38,38,0.9)", color: "#fff", border: "none", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
                      aria-label="Quitar foto">×</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
        <button className="btn-blue" onClick={guardar} disabled={!puede || saving || bloqueado || subiendo}>{saving ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </div>
  );
}
function resumenCancelaciones(row) {
  if (!row || row.declarado_cancelaciones_si_no === null) return null;
  if (row.declarado_cancelaciones_si_no === false) return "Sin cancelaciones";
  const n = Array.isArray(row.declarado_cancelaciones_fotos) ? row.declarado_cancelaciones_fotos.length : 0;
  return `Sí — ${n} foto(s) subida(s)`;
}

// ── Item 4: No Show ────────────────────────────────────────────────────
function Item4NoShow({ row, scId, onGuardar, saving, bloqueado, onCerrar }) {
  const [siNo, setSiNo] = useState(row?.declarado_noshow_si_no ?? null);
  const [patentes, setPatentes] = useState(Array.isArray(row?.declarado_noshow_patentes) ? row.declarado_noshow_patentes : []);
  useEffect(() => {
    setSiNo(row?.declarado_noshow_si_no ?? null);
    setPatentes(Array.isArray(row?.declarado_noshow_patentes) ? row.declarado_noshow_patentes : []);
  }, [row?.declarado_noshow_si_no, row?.declarado_noshow_patentes]);
  const puede = siNo === false || (siNo === true && patentes.length > 0);
  async function guardar() {
    if (!puede) return;
    const r = await onGuardar({
      declarado_noshow_si_no: siNo,
      declarado_noshow_patentes: siNo ? patentes : [],
    });
    if (!r?.error) onCerrar?.();
  }
  return (
    <div>
      <div className="field-row">
        <span className="field-label">¿Tuviste patentes que no se presentaron hoy?</span>
        <BotonSiNo value={siNo} onChange={setSiNo} disabled={bloqueado || saving} />
      </div>
      {siNo === true && (
        <div className="field-row">
          <span className="field-label">Seleccioná las patentes que no se presentaron</span>
          <AutocompletePatentes scId={scId} selected={patentes} onChange={setPatentes} disabled={bloqueado || saving} />
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
        <button className="btn-blue" onClick={guardar} disabled={!puede || saving || bloqueado}>{saving ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </div>
  );
}
function resumenNoShow(row) {
  if (!row || row.declarado_noshow_si_no === null) return null;
  if (row.declarado_noshow_si_no === false) return "Sin no show";
  const arr = Array.isArray(row.declarado_noshow_patentes) ? row.declarado_noshow_patentes : [];
  return `Sí — ${arr.length} patente(s): ${arr.join(", ")}`;
}

// ── Item 5: PNR ────────────────────────────────────────────────────────
function Item5PNR({ row, onGuardar, saving, bloqueado, onCerrar }) {
  const [siNo, setSiNo] = useState(row?.declarado_pnr_si_no ?? null);
  const [total, setTotal] = useState(row?.declarado_pnr_cantidad_total ?? "");
  const [abiertos, setAbiertos] = useState(row?.declarado_pnr_casos_abiertos ?? "");
  useEffect(() => {
    setSiNo(row?.declarado_pnr_si_no ?? null);
    setTotal(row?.declarado_pnr_cantidad_total ?? "");
    setAbiertos(row?.declarado_pnr_casos_abiertos ?? "");
  }, [row?.declarado_pnr_si_no, row?.declarado_pnr_cantidad_total, row?.declarado_pnr_casos_abiertos]);
  const totalN = Number(total);
  const abiertosN = Number(abiertos);
  const errLogica = siNo === true && total !== "" && abiertos !== "" && abiertosN > totalN
    ? "Los casos abiertos no pueden ser más que el total" : null;
  const puede = siNo === false || (siNo === true && totalN > 0 && abiertos !== "" && abiertosN >= 0 && abiertosN <= totalN);
  async function guardar() {
    if (!puede) return;
    const r = await onGuardar({
      declarado_pnr_si_no: siNo,
      declarado_pnr_cantidad_total: siNo ? totalN : null,
      declarado_pnr_casos_abiertos: siNo ? abiertosN : null,
    });
    if (!r?.error) onCerrar?.();
  }
  return (
    <div>
      <div className="field-row">
        <span className="field-label">¿Tuviste PNR (Pedido No Resuelto) hoy?</span>
        <BotonSiNo value={siNo} onChange={setSiNo} disabled={bloqueado || saving} />
      </div>
      {siNo === true && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field-row" style={{ marginBottom: 0 }}>
              <span className="field-label">Cantidad total de PNR</span>
              <input type="number" min="0" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Ej: 5" disabled={bloqueado || saving} />
            </div>
            <div className="field-row" style={{ marginBottom: 0 }}>
              <span className="field-label">¿Cuántos quedan abiertos?</span>
              <input type="number" min="0" value={abiertos} onChange={(e) => setAbiertos(e.target.value)} placeholder="Ej: 2" disabled={bloqueado || saving} />
            </div>
          </div>
          {errLogica && <div style={{ marginTop: 10, fontSize: 12, color: colors.red }}>⚠ {errLogica}</div>}
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
        <button className="btn-blue" onClick={guardar} disabled={!puede || saving || bloqueado}>{saving ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </div>
  );
}
function resumenPNR(row) {
  if (!row || row.declarado_pnr_si_no === null) return null;
  if (row.declarado_pnr_si_no === false) return "Sin PNR";
  return `Sí — ${row.declarado_pnr_cantidad_total || 0} PNR (${row.declarado_pnr_casos_abiertos || 0} abierto(s))`;
}

// ═══════════════════════════════════════════════════════════════════════════
// §8 FormularioSC — formulario de HOY de un SC
// ═══════════════════════════════════════════════════════════════════════════

function FormularioSC({ scId, perfil, fechaHoy }) {
  const { loading, row, saving, error, actualizar, cerrar } = useBitacora(scId, perfil);
  const [abierto, setAbierto] = useState(null);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);

  if (loading) {
    return (
      <div className="sc-card">
        <div style={{ padding: 20, textAlign: "center", color: colors.textMuted }}>Cargando bitácora de {scId}...</div>
      </div>
    );
  }

  const completados = contarItemsContestados(row);
  const todosCompletados = completados === TOTAL_ITEMS;
  const yaConfirmado = row?.estado_dia === "cerrado_supervisor";
  const bloqueadoTotal = row?.estado_dia === "cerrado_auto";

  function estadoItem(campo) {
    if (row?.[campo] === null || row?.[campo] === undefined) return "vacio";
    return "guardado";
  }
  function toggle(itemId) { setAbierto(abierto === itemId ? null : itemId); }

  return (
    <div className="sc-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${colors.border}` }}>
        <div>
          <span className="sc-badge">{scId}</span>
          <span style={{ fontSize: 13, color: colors.textSecondary }}>Bitácora del {fechaHoy}</span>
        </div>
        <div style={{ fontSize: 12, color: colors.textSecondary, fontWeight: 600 }}>
          <span style={{ color: todosCompletados ? colors.green : colors.textSecondary, fontWeight: 700 }}>{completados}/{TOTAL_ITEMS}</span> ítems
        </div>
      </div>

      {yaConfirmado && (
        <div style={{ background: colors.greenBg, border: `1px solid ${colors.green}`, borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, color: colors.greenText, fontWeight: 600 }}>
          ✓ Bitácora cerrada por el supervisor · Podés seguir editando hasta las 23:59
        </div>
      )}
      {bloqueadoTotal && (
        <div style={{ background: "#f1f5f9", border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, color: colors.textSecondary, fontWeight: 600 }}>
          🔒 Bitácora cerrada automáticamente a las 23:59 · Ya no es editable
        </div>
      )}
      {!bloqueadoTotal && <TimerLimite />}
      {error && <div className="alert-error" style={{ marginBottom: 14 }}>{error}</div>}

      <ItemAcordeon numero={1} titulo="Ayudantes" resumen={resumenAyudantes(row)} estado={estadoItem("declarado_ayudantes_si_no")} abierto={abierto === 1} onToggle={() => toggle(1)} bloqueado={bloqueadoTotal}>
        <Item1Ayudantes row={row} onGuardar={actualizar} saving={saving} bloqueado={bloqueadoTotal} onCerrar={() => setAbierto(null)} />
      </ItemAcordeon>
      <ItemAcordeon numero={2} titulo="Ambulancias" resumen={resumenAmbulancias(row)} estado={estadoItem("declarado_ambulancias_si_no")} abierto={abierto === 2} onToggle={() => toggle(2)} bloqueado={bloqueadoTotal}>
        <Item2Ambulancias row={row} onGuardar={actualizar} saving={saving} bloqueado={bloqueadoTotal} onCerrar={() => setAbierto(null)} />
      </ItemAcordeon>
      <ItemAcordeon numero={3} titulo="Cancelaciones MELI" resumen={resumenCancelaciones(row)} estado={estadoItem("declarado_cancelaciones_si_no")} abierto={abierto === 3} onToggle={() => toggle(3)} bloqueado={bloqueadoTotal}>
        <Item3Cancelaciones row={row} scId={scId} onGuardar={actualizar} saving={saving} bloqueado={bloqueadoTotal} onCerrar={() => setAbierto(null)} />
      </ItemAcordeon>
      <ItemAcordeon numero={4} titulo="No Show" resumen={resumenNoShow(row)} estado={estadoItem("declarado_noshow_si_no")} abierto={abierto === 4} onToggle={() => toggle(4)} bloqueado={bloqueadoTotal}>
        <Item4NoShow row={row} scId={scId} onGuardar={actualizar} saving={saving} bloqueado={bloqueadoTotal} onCerrar={() => setAbierto(null)} />
      </ItemAcordeon>
      <ItemAcordeon numero={5} titulo="PNR (Pedido No Resuelto)" resumen={resumenPNR(row)} estado={estadoItem("declarado_pnr_si_no")} abierto={abierto === 5} onToggle={() => toggle(5)} bloqueado={bloqueadoTotal}>
        <Item5PNR row={row} onGuardar={actualizar} saving={saving} bloqueado={bloqueadoTotal} onCerrar={() => setAbierto(null)} />
      </ItemAcordeon>

      {!bloqueadoTotal && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `2px solid ${colors.border}` }}>
          {!todosCompletados ? (
            <div style={{ fontSize: 12, color: colors.textMuted, textAlign: "center", padding: 12, background: "#f8fafc", borderRadius: 8 }}>
              Completá los {TOTAL_ITEMS - completados} ítem(s) restante(s) para poder cerrar la bitácora
            </div>
          ) : !confirmandoCierre ? (
            <button onClick={() => setConfirmandoCierre(true)} disabled={saving}
              style={{ width: "100%", padding: "14px 18px", background: yaConfirmado ? colors.greenBg : colors.navy, color: yaConfirmado ? colors.greenText : "#fff", border: yaConfirmado ? `1px solid ${colors.green}` : "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
              {yaConfirmado ? "✓ Bitácora cerrada — Click para volver a confirmar" : "Cerrar bitácora del día"}
            </button>
          ) : (
            <div style={{ background: "#fff7ed", border: `1px solid ${colors.orange}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}>¿Confirmar cierre de la bitácora de hoy?</div>
              <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 12 }}>Vas a poder seguir editando hasta las 23:59 hs. A esa hora se cierra automáticamente.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={async () => { await cerrar(); setConfirmandoCierre(false); }} disabled={saving}
                  style={{ flex: 1, padding: "10px 14px", background: colors.navy, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
                  {saving ? "Cerrando..." : "Sí, cerrar bitácora"}
                </button>
                <button onClick={() => setConfirmandoCierre(false)} disabled={saving}
                  style={{ padding: "10px 14px", background: "#f1f5f9", color: colors.textSecondary, border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// §9 CONCILIACIONES D-1 — Pestaña del día anterior
// ═══════════════════════════════════════════════════════════════════════════

// ── Tarjeta de KPI grande ──────────────────────────────────────────────
function KpiCard({ label, value, sub, color, alerta }) {
  return (
    <div className="kpi-card" style={alerta ? { borderColor: colors.red, borderWidth: 1.5 } : null}>
      <div className="kpi-label" style={alerta ? { color: colors.red } : null}>{label}</div>
      <div className="kpi-value" style={{ color: color || colors.navy }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// ── Panel de Indicadores del Día Anterior ──────────────────────────────
function PanelIndicadores({ kpis, scId, fecha }) {
  const colorNS = kpis.nsPromedio >= 99.5 ? colors.green : kpis.nsPromedio >= 95 ? colors.amber : colors.red;
  const colorPNR = kpis.pnrAbiertos > 0 ? colors.amber : colors.green;
  const colorNoShow = kpis.noShowCount > 0 ? colors.red : colors.green;
  const colorCancel = kpis.cancelCount > 0 ? colors.amber : colors.green;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: colors.textPrimary, marginBottom: 12 }}>
        📊 Indicadores del {fechaFormatMX(fecha)} · {scId}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <KpiCard label="Rutas Operadas" value={kpis.rutas} sub={kpis.rutas === 0 ? "Sin datos" : null} />
        <KpiCard label="NS del día" value={pct(kpis.nsPromedio)} color={colorNS} />
        <KpiCard label="NS puntos visitados" value={pct(kpis.nsPuntosVisitados)} color={colorNS} />
        <KpiCard label="Rutas con Helper" value={kpis.rutasConHelper} sub="MELI marcó helper" />
        <KpiCard label="Helpers Prohibidos" value={kpis.rutasProhibidas} alerta={kpis.rutasProhibidas > 0} color={kpis.rutasProhibidas > 0 ? colors.red : colors.green} sub="Foránea + Small Van" />
        <KpiCard label="PNR (abiertos / total)" value={`${kpis.pnrAbiertos} / ${kpis.pnrTotal}`} color={colorPNR} />
        <KpiCard label="No Show" value={kpis.noShowCount} color={colorNoShow} sub={kpis.noShowPlacas.length > 0 ? `Placas: ${kpis.noShowPlacas.slice(0, 3).join(", ")}` : null} />
        <KpiCard label="Cancelaciones MELI" value={kpis.cancelCount} color={colorCancel} />
      </div>
    </div>
  );
}

// ── Tabla detallada de rutas (de maestro_jornada_mx) ──────────────────
function TablaRutas({ jornada }) {
  if (!jornada || jornada.length === 0) {
    return (
      <div className="alert-info" style={{ marginBottom: 20 }}>
        No hay rutas registradas en maestro_jornada_mx para esta fecha.
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 24, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", background: "#fafbfc", borderBottom: `1px solid ${colors.border}`, fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
        Detalle por ruta ({jornada.length} rutas)
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: `1px solid ${colors.border}` }}>
              <th style={thStyle()}>ID Ruta</th>
              <th style={thStyle()}>Chofer</th>
              <th style={thStyle()}>Placa</th>
              <th style={thStyle("center")}>Vehículo</th>
              <th style={thStyle("right")}>Km</th>
              <th style={thStyle("right")}>Desp.</th>
              <th style={thStyle("right")}>Entreg.</th>
              <th style={thStyle("right")}>NS %</th>
              <th style={thStyle("center")}>Helper</th>
              <th style={thStyle("center")}>Categ.</th>
            </tr>
          </thead>
          <tbody>
            {jornada.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={tdStyle()} >{r.id_ruta}</td>
                <td style={tdStyle()}>{r.driver_name}</td>
                <td style={{ ...tdStyle(), fontFamily: "monospace", fontWeight: 600 }}>{r.placa}</td>
                <td style={{ ...tdStyle("center"), fontSize: 11 }}>{r.tipologia || r.vehiculo_raw || "—"}</td>
                <td style={tdStyle("right")}>{num(r.km_recorridos).toFixed(1)}</td>
                <td style={tdStyle("right")}>{r.envios_despachados ?? "—"}</td>
                <td style={tdStyle("right")}>{r.envios_entregados ?? "—"}</td>
                <td style={{ ...tdStyle("right"), fontWeight: 700, color: num(r.ns_pct) >= 99.5 ? colors.green : num(r.ns_pct) >= 95 ? colors.amber : colors.red }}>
                  {pct(r.ns_pct)}
                </td>
                <td style={tdStyle("center")}>{r.tiene_auxiliar ? "✓" : "—"}</td>
                <td style={{ ...tdStyle("center"), fontSize: 11 }}>{r.ns_categoria || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function thStyle(align) {
  return {
    padding: "8px 10px",
    textAlign: align || "left",
    fontSize: 10,
    fontWeight: 700,
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    whiteSpace: "nowrap",
  };
}
function tdStyle(align) {
  return {
    padding: "8px 10px",
    textAlign: align || "left",
    fontSize: 12,
    color: colors.textPrimary,
    whiteSpace: "nowrap",
  };
}

// ── Bloque de comparativo de UN ítem ──────────────────────────────────
function ItemComparativo({
  numero, titulo,
  declarado, detectado, difiere,
  justificacion, onJustifChange,
  estado, // null | 'pendiente' | 'justificado'
  bloqueado,
}) {
  // colorBlock: verde si coincide, amber si difiere
  const bgColor = difiere ? "#fff7ed" : "#f8fafc";
  const bordeColor = difiere ? colors.orange : colors.border;

  return (
    <div style={{ background: colors.surface, border: `1px solid ${bordeColor}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: difiere ? colors.orange : colors.green, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{numero}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: colors.textPrimary }}>{titulo}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: difiere ? colors.amberBg : colors.greenBg, color: difiere ? colors.amberText : colors.greenText, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {difiere ? "Difiere" : "Coincide"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: difiere ? 12 : 0, padding: 12, background: bgColor, borderRadius: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: colors.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Lo que declaraste</div>
          <div style={{ fontSize: 14, color: colors.textPrimary, fontWeight: 500 }}>{declarado}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: colors.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Lo que detectó Bigticket</div>
          <div style={{ fontSize: 14, color: colors.textPrimary, fontWeight: 500 }}>{detectado}</div>
        </div>
      </div>

      {difiere && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 6 }}>
            Justificación de la diferencia <span style={{ color: colors.red }}>*</span>
          </div>
          <textarea
            value={justificacion || ""}
            onChange={(e) => onJustifChange(e.target.value)}
            placeholder="Explicá por qué hay diferencia entre lo declarado y lo detectado..."
            disabled={bloqueado}
            rows={3}
            style={{ width: "100%", fontFamily: "'Geist', sans-serif", fontSize: 13 }}
          />
          {estado === "justificado" && justificacion && (
            <div style={{ marginTop: 6, fontSize: 11, color: colors.green, fontWeight: 600 }}>
              ✓ Justificación guardada
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Form de Patentes Nuevas detectadas ─────────────────────────────────
function PatentesNuevasForm({ scId, placasNuevas, perfil, onDone, bloqueado }) {
  // Estado local: una entrada por placa: { placa, chofer, empresa, guardada }
  const [estado, setEstado] = useState(() =>
    placasNuevas.map((p) => ({ placa: p, chofer: "", empresa: "", guardando: false, guardada: false, error: null }))
  );

  useEffect(() => {
    setEstado(placasNuevas.map((p) => ({ placa: p, chofer: "", empresa: "", guardando: false, guardada: false, error: null })));
  }, [placasNuevas.join(",")]);

  function actualizar(idx, campo, valor) {
    setEstado((prev) => prev.map((e, i) => i === idx ? { ...e, [campo]: valor } : e));
  }

  async function guardarUna(idx) {
    const it = estado[idx];
    if (!it.chofer.trim() || !it.empresa.trim()) {
      actualizar(idx, "error", "Completá chofer y empresa");
      return;
    }
    actualizar(idx, "guardando", true);
    actualizar(idx, "error", null);
    try {
      // Calcular número de semana del año (ISO 8601)
      const ahora = new Date();
      const sem = obtenerSemanaISO(ahora);

      const tripulacion = [{ cargo: "CHOFER", nombre: it.chofer.trim(), curp: null }];

      const payload = {
        placa: it.placa,
        service_center_id: scId,
        numero_semana: sem,
        empresa_transporte: it.empresa.trim(),
        flota_tipo: "PLANTA",
        responsable_carga: perfil.nombre,
        fecha_carga: new Date().toISOString(),
        es_compartida_entre_scs: false,
        tripulacion,
        activo: true,
      };

      const { error: err } = await sb
        .from("flota_vehiculos_bt")
        .upsert(payload, { onConflict: "placa,service_center_id,numero_semana" });

      if (err) throw err;
      actualizar(idx, "guardada", true);
      onDone?.();
    } catch (e) {
      console.error("Error guardando placa nueva:", e);
      actualizar(idx, "error", e.message || "No se pudo guardar");
    } finally {
      actualizar(idx, "guardando", false);
    }
  }

  if (placasNuevas.length === 0) return null;

  return (
    <div style={{ background: colors.surface, border: `1.5px solid ${colors.red}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: colors.red, marginBottom: 4 }}>
        ⚠️ Patentes nuevas detectadas ({placasNuevas.length})
      </div>
      <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 14 }}>
        Las siguientes patentes operaron ayer en {scId} pero NO están en tu inventario de flota.
        Registrá los datos para incorporarlas automáticamente.
      </div>

      {estado.map((it, idx) => (
        <div key={it.placa} style={{ padding: 12, background: it.guardada ? colors.greenBg : "#fafbfc", border: `1px solid ${it.guardada ? colors.green : colors.border}`, borderRadius: 8, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, background: colors.navy, color: "#fff", padding: "4px 10px", borderRadius: 5 }}>{it.placa}</span>
            {it.guardada && <span style={{ fontSize: 11, fontWeight: 700, color: colors.green }}>✓ Agregada a la flota</span>}
          </div>
          {!it.guardada && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <span className="field-label">Chofer</span>
                  <input value={it.chofer} onChange={(e) => actualizar(idx, "chofer", e.target.value)} placeholder="Nombre completo del chofer" disabled={bloqueado || it.guardando} />
                </div>
                <div>
                  <span className="field-label">Empresa que presta servicio</span>
                  <input value={it.empresa} onChange={(e) => actualizar(idx, "empresa", e.target.value)} placeholder="Razón social del transportista" disabled={bloqueado || it.guardando} />
                </div>
              </div>
              {it.error && <div style={{ fontSize: 11, color: colors.red, marginBottom: 8 }}>⚠ {it.error}</div>}
              <button className="btn-blue" onClick={() => guardarUna(idx)} disabled={bloqueado || it.guardando || !it.chofer.trim() || !it.empresa.trim()}
                style={{ fontSize: 12, padding: "8px 14px" }}>
                {it.guardando ? "Guardando..." : "Registrar y agregar a la flota"}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function obtenerSemanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ── Componente principal de la pestaña Conciliaciones D-1 ─────────────
function ConciliacionesD1({ scId, perfil }) {
  const fechaAyer = fechaAyerMX();
  const { loading: loadingDatos, error: errorDatos, datos } = useConciliacionD1(scId);
  // Bitácora de AYER (declarado por el supervisor)
  const { loading: loadingBit, row: bitAyer, saving, actualizar } = useBitacora(scId, perfil, fechaAyer);

  // Estados locales de justificaciones (se sincronizan con la BD)
  const [justifAyudantes, setJustifAyudantes] = useState("");
  const [justifAmbulancias, setJustifAmbulancias] = useState("");
  const [justifCancelaciones, setJustifCancelaciones] = useState("");
  const [justifNoShow, setJustifNoShow] = useState("");
  const [justifPNR, setJustifPNR] = useState("");
  const [guardandoFinal, setGuardandoFinal] = useState(false);

  useEffect(() => {
    if (bitAyer) {
      setJustifAyudantes(bitAyer.ayudantes_justificacion || "");
      setJustifAmbulancias(bitAyer.ambulancias_justificacion || "");
      setJustifCancelaciones(bitAyer.cancelaciones_justificacion || "");
      setJustifNoShow(bitAyer.noshow_justificacion || "");
      setJustifPNR(bitAyer.pnr_justificacion || "");
    }
  }, [bitAyer]);

  if (loadingDatos || loadingBit) {
    return (
      <div className="card">
        <div className="loading">Cargando datos del día anterior...</div>
      </div>
    );
  }

  if (errorDatos) {
    return <div className="alert-error">{errorDatos}</div>;
  }

  const kpis = datos?.kpis || {};
  const bloqueadoEditar = msRestantesHastaMedianocheMX() <= 0;

  // Cálculo de diferencias
  // Para ayudantes: declarado vs cantidad detectada de helpers en vw_control_helper_diario
  const declAyudantesCount = bitAyer?.declarado_ayudantes_si_no === true
    ? num(bitAyer.declarado_ayudantes_cantidad) : (bitAyer?.declarado_ayudantes_si_no === false ? 0 : null);
  const detectadoHelpers = kpis.rutasConHelper || 0;
  const difAyudantes = declAyudantesCount !== null && declAyudantesCount !== detectadoHelpers;

  // Para ambulancias: NO hay fuente automática todavía, así que solo si declaró diferente de null lo mostramos informativo
  const declAmbulancias = bitAyer?.declarado_ambulancias_si_no === true
    ? num(bitAyer.declarado_ambulancias_cantidad) : (bitAyer?.declarado_ambulancias_si_no === false ? 0 : null);
  // Sin detección automática: difAmbulancias = false (no podemos decir que difiera)
  const difAmbulancias = false;

  // Cancelaciones: declarado si/no vs cancelCount
  const declCanc = bitAyer?.declarado_cancelaciones_si_no;
  const cancCount = kpis.cancelCount || 0;
  const difCancelaciones = declCanc !== null && (
    (declCanc === true && cancCount === 0) || (declCanc === false && cancCount > 0)
  );

  // No Show: comparar arrays
  const declNoShowArr = Array.isArray(bitAyer?.declarado_noshow_patentes) ? bitAyer.declarado_noshow_patentes.map(String).sort() : [];
  const realNoShowArr = (kpis.noShowPlacas || []).map(String).sort();
  const difNoShow = bitAyer?.declarado_noshow_si_no !== null && (
    declNoShowArr.length !== realNoShowArr.length ||
    declNoShowArr.some((p, i) => p !== realNoShowArr[i])
  );

  // PNR: declarado total vs real total
  const declPnrTotal = bitAyer?.declarado_pnr_si_no === true ? num(bitAyer.declarado_pnr_cantidad_total) : (bitAyer?.declarado_pnr_si_no === false ? 0 : null);
  const declPnrAbiertos = bitAyer?.declarado_pnr_si_no === true ? num(bitAyer.declarado_pnr_casos_abiertos) : (bitAyer?.declarado_pnr_si_no === false ? 0 : null);
  const difPNR = declPnrTotal !== null && (declPnrTotal !== kpis.pnrTotal || declPnrAbiertos !== kpis.pnrAbiertos);

  // Helper para texto de declarado/detectado
  const txtAyudantesDecl = declAyudantesCount === null ? "(no completaste el formulario)" : declAyudantesCount === 0 ? "No tuvo ayudantes" : `${declAyudantesCount} ruta(s) con helper`;
  const txtAyudantesDet = `${detectadoHelpers} ruta(s) con helper detectado`;
  const txtAmbulanciasDecl = declAmbulancias === null ? "(no completaste el formulario)" : declAmbulancias === 0 ? "No tuvo ambulancias" : `${declAmbulancias} ambulancia(s)`;
  const txtAmbulanciasDet = "Sin detección automática disponible";
  const txtCancDecl = declCanc === null ? "(no completaste el formulario)" : declCanc === true ? `Sí (con ${Array.isArray(bitAyer.declarado_cancelaciones_fotos) ? bitAyer.declarado_cancelaciones_fotos.length : 0} foto/s)` : "Sin cancelaciones";
  const txtCancDet = `${cancCount} cancelación(es) de MELI registrada(s)`;
  const txtNoShowDecl = bitAyer?.declarado_noshow_si_no === null ? "(no completaste el formulario)" : declNoShowArr.length === 0 ? "Sin no show" : `${declNoShowArr.length} placa(s): ${declNoShowArr.join(", ")}`;
  const txtNoShowDet = realNoShowArr.length === 0 ? "Sin no show detectados" : `${realNoShowArr.length} placa(s): ${realNoShowArr.join(", ")}`;
  const txtPnrDecl = declPnrTotal === null ? "(no completaste el formulario)" : declPnrTotal === 0 ? "Sin PNR" : `${declPnrTotal} PNR (${declPnrAbiertos} abierto/s)`;
  const txtPnrDet = `${kpis.pnrTotal} PNR (${kpis.pnrAbiertos} abierto/s)`;

  async function guardarTodasJustificaciones() {
    setGuardandoFinal(true);
    try {
      // Solo guardar las justificaciones que correspondan a items que DIFIEREN
      const campos = {};
      if (difAyudantes) {
        campos.ayudantes_justificacion = justifAyudantes;
        campos.ayudantes_estado_justif = justifAyudantes.trim() ? "justificado" : "pendiente";
      }
      if (difAmbulancias) {
        campos.ambulancias_justificacion = justifAmbulancias;
        campos.ambulancias_estado_justif = justifAmbulancias.trim() ? "justificado" : "pendiente";
      }
      if (difCancelaciones) {
        campos.cancelaciones_justificacion = justifCancelaciones;
        campos.cancelaciones_estado_justif = justifCancelaciones.trim() ? "justificado" : "pendiente";
      }
      if (difNoShow) {
        campos.noshow_justificacion = justifNoShow;
        campos.noshow_estado_justif = justifNoShow.trim() ? "justificado" : "pendiente";
      }
      if (difPNR) {
        campos.pnr_justificacion = justifPNR;
        campos.pnr_estado_justif = justifPNR.trim() ? "justificado" : "pendiente";
      }
      // Marcamos también los detectados para historial
      campos.detectado_ayudantes_cantidad = kpis.rutasConHelper;
      campos.detectado_cancelaciones_count = kpis.cancelCount;
      campos.detectado_noshow_patentes = realNoShowArr;
      campos.detectado_pnr_cantidad_total = kpis.pnrTotal;
      campos.detectado_pnr_casos_abiertos = kpis.pnrAbiertos;
      campos.comparativo_calculado_at = new Date().toISOString();
      campos.comparativo_calculado_por = perfil.nombre;
      await actualizar(campos);
    } catch (e) {
      console.error(e);
    } finally {
      setGuardandoFinal(false);
    }
  }

  const cantidadDiferencias = [difAyudantes, difAmbulancias, difCancelaciones, difNoShow, difPNR].filter(Boolean).length;

  return (
    <div>
      {/* Aviso si no completó la bitácora de ayer */}
      {!bitAyer && (
        <div style={{ background: colors.amberBg, border: `1px solid ${colors.amber}`, borderRadius: 10, padding: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.amberText, marginBottom: 4 }}>
            ⚠ No completaste la bitácora del día anterior
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary }}>
            Igual debés justificar las diferencias con los datos detectados por Bigticket.
          </div>
        </div>
      )}

      {/* Panel de indicadores reales */}
      <PanelIndicadores kpis={kpis} scId={scId} fecha={fechaAyer} />

      {/* Patentes nuevas (alerta reactiva) */}
      <PatentesNuevasForm
        scId={scId}
        placasNuevas={kpis.placasNuevas || []}
        perfil={perfil}
        bloqueado={bloqueadoEditar}
      />

      {/* Tabla detallada por ruta */}
      <TablaRutas jornada={datos?.jornada || []} />

      {/* Comparativos */}
      <div style={{ marginTop: 24, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.textPrimary, marginBottom: 4 }}>
          ⚖️ Comparativo: tu declaración vs detección Bigticket
        </div>
        <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 16 }}>
          {cantidadDiferencias === 0
            ? "✓ Todo coincide. No hay diferencias para justificar."
            : `Hay ${cantidadDiferencias} diferencia(s) que debés justificar.`}
        </div>
      </div>

      <ItemComparativo
        numero={1} titulo="Ayudantes"
        declarado={txtAyudantesDecl} detectado={txtAyudantesDet}
        difiere={difAyudantes}
        justificacion={justifAyudantes}
        onJustifChange={setJustifAyudantes}
        estado={bitAyer?.ayudantes_estado_justif}
        bloqueado={bloqueadoEditar}
      />

      <ItemComparativo
        numero={2} titulo="Ambulancias"
        declarado={txtAmbulanciasDecl} detectado={txtAmbulanciasDet}
        difiere={difAmbulancias}
        justificacion={justifAmbulancias}
        onJustifChange={setJustifAmbulancias}
        estado={bitAyer?.ambulancias_estado_justif}
        bloqueado={bloqueadoEditar}
      />

      <ItemComparativo
        numero={3} titulo="Cancelaciones MELI"
        declarado={txtCancDecl} detectado={txtCancDet}
        difiere={difCancelaciones}
        justificacion={justifCancelaciones}
        onJustifChange={setJustifCancelaciones}
        estado={bitAyer?.cancelaciones_estado_justif}
        bloqueado={bloqueadoEditar}
      />

      <ItemComparativo
        numero={4} titulo="No Show"
        declarado={txtNoShowDecl} detectado={txtNoShowDet}
        difiere={difNoShow}
        justificacion={justifNoShow}
        onJustifChange={setJustifNoShow}
        estado={bitAyer?.noshow_estado_justif}
        bloqueado={bloqueadoEditar}
      />

      <ItemComparativo
        numero={5} titulo="PNR"
        declarado={txtPnrDecl} detectado={txtPnrDet}
        difiere={difPNR}
        justificacion={justifPNR}
        onJustifChange={setJustifPNR}
        estado={bitAyer?.pnr_estado_justif}
        bloqueado={bloqueadoEditar}
      />

      {/* Botón final */}
      {cantidadDiferencias > 0 && !bloqueadoEditar && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `2px solid ${colors.border}` }}>
          <button onClick={guardarTodasJustificaciones} disabled={guardandoFinal || saving}
            style={{ width: "100%", padding: "14px 18px", background: colors.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
            {guardandoFinal ? "Guardando..." : "Guardar todas las justificaciones"}
          </button>
        </div>
      )}

      {bloqueadoEditar && (
        <div style={{ background: "#f1f5f9", border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, marginTop: 16, fontSize: 12, color: colors.textSecondary, fontWeight: 600, textAlign: "center" }}>
          🔒 Las justificaciones de ayer ya no son editables (pasó la medianoche)
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// §10 PANTALLAS — Login + Landing con tabs
// ═══════════════════════════════════════════════════════════════════════════

function Login({ onSignIn, error }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!email || !password) return;
    setSubmitting(true);
    await onSignIn(email, password);
    setSubmitting(false);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src={BIGGY_IMG} alt="Biggy" style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", marginBottom: 12 }} />
          <div style={{ fontSize: 26, fontWeight: 800 }}>
            <span style={{ color: colors.navy }}>Big</span>
            <span style={{ color: colors.orange }}>ticket</span>
          </div>
          <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>Bitácora del Supervisor</div>
        </div>
        {error && <div className="alert-error">{error}</div>}
        <div className="field-row">
          <span className="field-label">Correo electrónico</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
            placeholder="nombre.apellido@bigticket.mx" autoFocus disabled={submitting}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
        </div>
        <div className="field-row">
          <span className="field-label">Contraseña</span>
          <div style={{ position: "relative" }}>
            <input value={password} onChange={(e) => setPassword(e.target.value)}
              type={showPass ? "text" : "password"} placeholder="Tu contraseña"
              disabled={submitting} style={{ paddingRight: 40 }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
            <button type="button" onClick={() => setShowPass((v) => !v)} tabIndex={-1}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 16, padding: 0, width: "auto" }}>
              {showPass ? "🙈" : "👁"}
            </button>
          </div>
        </div>
        <button className="btn-blue" onClick={handleSubmit}
          disabled={submitting || !email || !password}
          style={{ width: "100%", marginTop: 8 }}>
          {submitting ? "Ingresando..." : "Ingresar"}
        </button>
        <div style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 20, paddingTop: 16, borderTop: "1px solid #f0f0f0" }}>
          ¿Olvidaste tu contraseña? Contactá al administrador.
        </div>
      </div>
    </div>
  );
}

function Landing({ perfil, onSignOut }) {
  const scs = Array.isArray(perfil?.scs_asignados) ? perfil.scs_asignados : [];
  const fechaHoy = fechaHoyMX();
  const horaHoy = horaAhoraMX();
  const fechaAyer = fechaAyerMX();

  // Tab activo: "hoy" o "conciliaciones"
  const [tab, setTab] = useState("hoy");

  return (
    <div>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={BIGGY_IMG} alt="Biggy" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: `1.5px solid ${colors.orange}` }} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            <span style={{ color: colors.orange }}>Big</span>
            <span style={{ color: "#fff" }}>ticket</span>
          </span>
          <span style={{ fontSize: 11, color: "#aac3e8", marginLeft: 8, paddingLeft: 12, borderLeft: "1px solid rgba(255,255,255,0.2)" }}>
            Bitácora del Supervisor · {scs.join(" · ")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 11, color: "#aac3e8" }}>🕐 {fechaHoy} {horaHoy} hs (MX)</span>
          <span style={{ fontSize: 12, color: "#aac3e8" }}>👤 {perfil?.nombre}</span>
          <button className="btn-gw" onClick={onSignOut}>Salir</button>
        </div>
      </div>

      <div className="pg">
        <div style={{ marginBottom: 20 }}>
          <div className="sec-title">Hola, {perfil?.nombre?.split(" ")[0]} 👋</div>
          <div className="sec-sub">
            {tab === "hoy"
              ? (scs.length === 1
                ? `Bitácora de ${scs[0]} para el día de hoy.`
                : `Tienes ${scs.length} bitácoras pendientes para hoy (una por cada SC asignado).`)
              : `Conciliá las diferencias del ${fechaFormatMX(fechaAyer)}.`}
          </div>
        </div>

        {/* Tabs */}
        <div className="tab-bar">
          <button className={`tab-btn ${tab === "hoy" ? "active" : ""}`} onClick={() => setTab("hoy")}>
            🗓 Hoy ({fechaHoy})
          </button>
          <button className={`tab-btn ${tab === "conciliaciones" ? "active" : ""}`} onClick={() => setTab("conciliaciones")}>
            ⚖️ Conciliaciones D-1
          </button>
        </div>

        {/* Contenido del tab */}
        {tab === "hoy" && (
          <div style={{
            display: "grid",
            gridTemplateColumns: scs.length === 1 ? "1fr" : "repeat(auto-fit, minmax(420px, 1fr))",
            gap: 16,
          }}>
            {scs.map((scId) => (
              <FormularioSC key={scId} scId={scId} perfil={perfil} fechaHoy={fechaHoy} />
            ))}
          </div>
        )}

        {tab === "conciliaciones" && (
          <div>
            {scs.length > 1 && (
              <div className="alert-info" style={{ marginBottom: 16 }}>
                Tienes {scs.length} SCs asignados. Las conciliaciones se muestran una debajo de la otra.
              </div>
            )}
            {scs.map((scId) => (
              <div key={scId} style={{ marginBottom: 32 }}>
                {scs.length > 1 && (
                  <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: `2px solid ${colors.navy}` }}>
                    <span className="sc-badge" style={{ fontSize: 13 }}>{scId}</span>
                  </div>
                )}
                <ConciliacionesD1 scId={scId} perfil={perfil} />
              </div>
            ))}
          </div>
        )}

        {scs.length === 0 && (
          <div className="alert-info" style={{ marginTop: 16 }}>
            Tu cuenta no tiene Service Centers asignados. Contactá al administrador.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// §11 APP ROOT
// ═══════════════════════════════════════════════════════════════════════════

export default function App() {
  const { loading, session, perfil, signIn, signOut, error } = useAuth();

  if (loading) {
    return (
      <>
        <style>{css}</style>
        <div className="login-wrap"><div className="loading">Cargando...</div></div>
      </>
    );
  }
  if (!session || !perfil) {
    return (
      <>
        <style>{css}</style>
        <Login onSignIn={signIn} error={error} />
      </>
    );
  }
  return (
    <>
      <style>{css}</style>
      <Landing perfil={perfil} onSignOut={signOut} />
    </>
  );
}
