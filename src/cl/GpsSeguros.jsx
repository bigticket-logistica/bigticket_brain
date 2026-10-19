// ═══════════════════════════════════════════════════════════════════════════
// GPS Y SEGUROS · CHILE  (módulo propio del Brain, al lado de Maestro Operaciones)
// Levantamiento de uso de GPS (Geotab) y seguros de la flota.
//
// Fuentes en bigticket-cl:
//   • vw_flota_semaforo  → una fila por patente: Nómina + maestro + Geotab + banderas
//   • flota_alertas      → alertas abiertas/cerradas (las genera fn_flota_generar_alertas,
//                          programada a diario con pg_cron)
//   • vw_flota_cl        → última carga de la Nómina de Flota
//   • flota_cl_cargas    → historial de cargas del Excel
//   • flota_config       → umbrales (días sin uso, días de alerta, viajes de apoyo)
//   • geotab_lecturas    → inventario diario de dispositivos (lo llena el sync de Geotab)
//
// Habla con la API REST del proyecto de Chile por fetch, igual que el Maestro.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, Fragment } from "react";
import { cargarSheetJS } from "../shared";

const NAVY = "#1a3a6b";
const VERDE_ = "#0d8043";
const ROJO_ = "#b42318";
const AMBAR_ = "#a16207";
const AZUL_ = "#2563eb";
const GRIS_ = "#8a94a6";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

async function api(path, opciones) {
  const o = opciones || {};
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: Object.assign({ apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" }, o.headers || {}),
    body: o.body,
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 250)}`);
  const texto = await r.text();
  if (!texto || !texto.trim()) return true;
  try { return JSON.parse(texto); } catch (e) { return true; }
}
// Tolerante: si una consulta falla devuelve el valor por defecto y anota el fallo.
async function apiSuave(path, porDefecto, fallos) {
  try { return await api(path); }
  catch (e) { if (fallos) fallos.push(String(path).split("?")[0] + ": " + e.message); return porDefecto; }
}

function descargarCSV(nombre, filas, columnas) {
  if (!filas.length) return;
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cuerpo = [
    columnas.map(c => esc(c.titulo)).join(";"),
    ...filas.map(f => columnas.map(c => esc(c.valor ? c.valor(f) : f[c.campo])).join(";")),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF" + cuerpo], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Etiqueta({ texto, color, fondo }) {
  return (
    <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 10.5,
                   fontWeight: 700, color: color || NAVY, background: fondo || "#eef2f9", whiteSpace: "nowrap" }}>{texto}</span>
  );
}


const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const fmt = (v) => n(v).toLocaleString("es-CL");
const clp = (v) => "$" + Math.round(n(v)).toLocaleString("es-CL");
const fch = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("-") : "—");
const fchHora = (ts) => {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago",
      day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
  } catch (e) { return "—"; }
};
const hoyChile = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const restarDias = (iso, d) => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - d); return t.toISOString().slice(0, 10); };
const usuarioActual = () => {
  try { return JSON.parse(localStorage.getItem("bt_usuario") || "null")?.nombre || "brain"; }
  catch (e) { return "brain"; }
};
const diasUso = (f) => (f.dias_sin_uso === null || f.dias_sin_uso === undefined || n(f.dias_sin_uso) >= 9999 ? null : n(f.dias_sin_uso));

// ── Bandejas de trabajo ─────────────────────────────────────────────────────
// Cada vehículo cae en la primera bandeja que le corresponde (no se repite).
const BANDEJAS = [
  { id: "cortar",    titulo: "Cortar",               color: ROJO_,  fondo: "#fdecec",
    que: "GPS y/o seguro que se pagan en vehículos sin ruta ni movimiento de GPS por sobre el umbral.",
    entra: f => f.cortar_gps || f.sacar_seguro },
  { id: "revisar",   titulo: "Revisar instalación",  color: AMBAR_, fondo: "#fff6dc",
    que: "El vehículo trabaja pero su GPS no comunica: está desconectado o dañado. No se corta, se revisa.",
    entra: f => f.gps_mudo },
  { id: "cobertura", titulo: "Completar cobertura",  color: AZUL_,  fondo: "#eaf1ff",
    que: "Vehículos de planta activos sin GPS o sin seguro de carga, o con la póliza vencida.",
    entra: f => f.activa_sin_gps || f.activa_sin_seguro || f.seguro_vencido },
  { id: "nomina",    titulo: "Corregir Nómina",      color: GRIS_,  fondo: "#f1f5f9",
    que: "Lo que dice el Excel no coincide con lo que se ve en el maestro y Geotab, o no hay ninguna señal para saberlo.",
    entra: f => !!f.nomina_desactualizada || f.seguro_sin_senal || f.gps_fuera_nomina },
];
const bandejaDe = (f) => BANDEJAS.find(b => b.entra(f))?.id || null;

const motivos = (f, u) => {
  const m = [];
  if (f.cortar_gps) m.push(`GPS activo (${f.gps_base}) sin uso hace ${diasUso(f)} días · umbral ${u.dias_corte_gps}`);
  if (f.sacar_seguro) m.push(`Seguro ${f.seg_carga_proveedor || ""} ${f.seg_carga_poliza || ""} sin uso hace ${diasUso(f)} días · umbral ${u.dias_corte_seguro}`);
  if (f.gps_mudo) m.push(`GPS sin comunicar hace ${fmt(f.gps_dias_sin_reportar)} días, pero hizo ${fmt(f.viajes_30d)} viajes en 30 días`);
  if (f.activa_sin_gps) m.push("Planta activa sin GPS activo en Geotab");
  if (f.activa_sin_seguro) m.push("Planta activa sin seguro de carga");
  if (f.seguro_vencido) m.push(`Seguro de carga vencido el ${fch(f.seg_carga_vence)}`);
  if (f.nomina_desactualizada) m.push(f.nomina_desactualizada);
  if (f.seguro_sin_senal) m.push("Tiene seguro pero no hay viajes MELI ni GPS activo para saber si se usa");
  if (f.gps_fuera_nomina) m.push(`GPS activo en Geotab (${f.gps_base}) y la patente no está en la Nómina`);
  return m;
};

const TIPOS_ALERTA = {
  SIN_RUTA:     { rotulo: "Sin ruta",         color: ROJO_,  fondo: "#fdecec" },
  APOYO_EXCESO: { rotulo: "Apoyo con exceso", color: AMBAR_, fondo: "#fff6dc" },
  CORTAR_GPS:   { rotulo: "Cortar GPS",       color: ROJO_,  fondo: "#fdecec" },
  SACAR_SEGURO: { rotulo: "Sacar del seguro", color: ROJO_,  fondo: "#fdecec" },
  GPS_MUDO:     { rotulo: "GPS mudo",         color: AMBAR_, fondo: "#fff6dc" },
};
const TIPOS_SOLICITUD = {
  BAJA_GPS:    "Baja de GPS",
  BAJA_SEGURO: "Baja del seguro",
  REVISAR_GPS: "Revisar GPS",
};
const ROTULO_UMBRAL = {
  dias_corte_gps:       { titulo: "Cortar GPS",          unidad: "días sin uso" },
  dias_corte_seguro:    { titulo: "Sacar del seguro",    unidad: "días sin uso" },
  dias_alerta_sin_ruta: { titulo: "Alerta sin ruta",     unidad: "días (planta activa)" },
  viajes_mes_apoyo:     { titulo: "Alerta apoyo",        unidad: "viajes en el mes" },
  costo_gps_mensual:    { titulo: "Costo GPS",           unidad: "CLP al mes" },
  costo_seguro_mensual: { titulo: "Costo seguro",        unidad: "CLP al mes" },
};

const COLS_DETALLE = [
  { titulo: "PATENTE", campo: "patente" }, { titulo: "ESTADO", campo: "estado" }, { titulo: "TIPO", campo: "tipo" },
  { titulo: "OPERACION", campo: "operacion" }, { titulo: "TERCERO", campo: "tercero" }, { titulo: "MARCA", campo: "marca" },
  { titulo: "MODELO", campo: "modelo" }, { titulo: "ULTIMO_VIAJE", campo: "ultimo_viaje" }, { titulo: "DIAS_SIN_VIAJE", campo: "dias_sin_viaje" },
  { titulo: "VIAJES_30D", campo: "viajes_30d" }, { titulo: "VIAJES_MES", campo: "viajes_mes" }, { titulo: "GPS_NOMINA", campo: "gps_nomina" },
  { titulo: "GPS_ACTIVO_GEOTAB", campo: "gps_activo" }, { titulo: "GPS_BASE", campo: "gps_base" }, { titulo: "GPS_ULTIMA_COMUNICACION", campo: "gps_ultima_comunicacion" },
  { titulo: "GPS_DIAS_SIN_REPORTAR", campo: "gps_dias_sin_reportar" }, { titulo: "SEGURO_CARGA", campo: "seg_carga" }, { titulo: "SEGURO_PROVEEDOR", campo: "seg_carga_proveedor" },
  { titulo: "SEGURO_POLIZA", campo: "seg_carga_poliza" }, { titulo: "SEGURO_VENCE", campo: "seg_carga_vence" },
  { titulo: "DIAS_SIN_USO", valor: f => diasUso(f) ?? "sin señal" }, { titulo: "BANDEJA", valor: f => BANDEJAS.find(b => b.id === bandejaDe(f))?.titulo || "" },
  { titulo: "MOTIVO_NOMINA", campo: "nomina_desactualizada" }, { titulo: "FUGA_MENSUAL", campo: "fuga_mensual" }, { titulo: "FUGA_ACUMULADA", campo: "fuga_acumulada" },
];

// ── Lectura del Excel "Nómina Flota Vehículos" (hoja Nomina) ──────────────
// Mismo criterio que la primera carga: fechas de serie → fecha, "-"/"#VALUE!"/vacío → null,
// patentes repetidas → se queda la fila vigente (la no INACTIVA) y se completa lo que falte.
const COLUMNAS_EXCEL = {
  "PATENTE": "patente", "SERVICIO": "servicio", "OPERACION": "operacion", "ESTADO": "estado", "TIPO": "tipo",
  "PROYECTO": "proyecto", "TIPO VEHICULO": "tipo_vehiculo", "TIPO DE ENERGIA": "tipo_energia", "DUENO VEHICULO": "dueno",
  "NOMBRE TERCERO": "tercero", "RUT TERCERO": "rut_tercero", "MARCA": "marca", "MODELO": "modelo", "ANO": "anio",
  "CHASIS O VIN": "vin", "MOTOR": "motor", "TIENE GPS": "gps", "ESTADO GPS": "gps_estado", "PROVEEDOR GPS": "gps_proveedor",
  "FECHA DE INSTALACION GPS": "gps_instalado_el", "ID DISPOSITIVO GPS": "gps_dispositivo", "TIENE SEGURO CARGA": "seg_carga",
  "ESTADO SEGURO": "seg_carga_estado", "PROVEEDOR SEGURO CARGA": "seg_carga_proveedor", "FECHA INCLUSION SEGURO CARGA": "seg_carga_desde",
  "POLIZA SEGURO CARGA": "seg_carga_poliza", "FECHA VENCIMIENTO SEGURO CARGA": "seg_carga_vence", "TIENE SEGURO VEHICULO": "seg_veh",
  "PROVEEDOR SEGURO VEHICULO": "seg_veh_proveedor", "FECHA INCLUSION SEGURO VEHICULO": "seg_veh_desde", "POLIZA SEGURO VEHICULOS": "seg_veh_poliza",
  "FECHA VENCIMIENTO SEGURO VEHICULO": "seg_veh_vence", "CERTIFICACION CERTRONIC BT": "cert_certronic_bt",
  "CERTIFICACION CERTRONIC MELI": "cert_certronic_meli", "CERTIFICACION ROSEN": "cert_rosen", "CERTIFICACION FALABELLA": "cert_falabella",
  "FECHA SOLICITUD BAJA": "baja_solicitada_el", "OBSERVACIONES": "observaciones",
};
const CAMPOS_FECHA = new Set(["gps_instalado_el", "seg_carga_desde", "seg_carga_vence", "seg_veh_desde", "seg_veh_vence", "baja_solicitada_el"]);
const normCab = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const esVacio = (v) => v === null || v === undefined || ["", "-", "NAT", "NAN", "#N/A", "#VALUE!"].includes(String(v).trim().toUpperCase());
const texto = (v) => { if (esVacio(v)) return null; const s = String(v).trim(); return s.length < 40 ? s.toUpperCase() : s; };
const fechaExcel = (v) => {
  if (esVacio(v)) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const num = Number(v);
  if (!isNaN(num) && num > 30000 && num < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(num) * 86400000).toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  const d = String(v).match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (d) return `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
  return null;
};
const anioExcel = (v) => { const k = parseInt(v, 10); return k >= 1950 && k <= 2030 ? k : null; };

async function leerNomina(archivo) {
  const XLSX = await cargarSheetJS();
  const buf = await archivo.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const nombreHoja = wb.SheetNames.find(h => normCab(h) === "NOMINA") || wb.SheetNames[0];
  const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, raw: true, defval: null });
  const iCab = matriz.findIndex(f => (f || []).some(c => normCab(c) === "PATENTE"));
  if (iCab < 0) throw new Error(`No encontré la fila de encabezados (con PATENTE) en la hoja ${nombreHoja}.`);
  const cab = matriz[iCab].map(normCab);
  const idx = {};
  cab.forEach((c, i) => { const campo = COLUMNAS_EXCEL[c]; if (campo && idx[campo] === undefined) idx[campo] = i; });
  if (idx.patente === undefined) throw new Error("La hoja no tiene columna PATENTE.");
  const faltan = Object.values(COLUMNAS_EXCEL).filter(c => idx[c] === undefined);

  const porPatente = new Map(); const repetidas = new Set();
  for (const fila of matriz.slice(iCab + 1)) {
    if (!fila) continue;
    const patente = texto(fila[idx.patente]); if (!patente) continue;
    const o = { patente: patente.replace(/[-\s]/g, "") };
    for (const [campo, i] of Object.entries(idx)) {
      if (campo === "patente") continue;
      const v = fila[i];
      o[campo] = CAMPOS_FECHA.has(campo) ? fechaExcel(v)
        : campo === "anio" ? anioExcel(v)
        : campo === "observaciones" ? (esVacio(v) ? null : String(v).trim())
        : texto(v);
    }
    const previa = porPatente.get(o.patente);
    if (!previa) { porPatente.set(o.patente, o); continue; }
    repetidas.add(o.patente);
    const [vigente, otra] = (previa.estado === "INACTIVA" && o.estado !== "INACTIVA") ? [o, previa] : [previa, o];
    for (const k of Object.keys(otra)) if (vigente[k] === null || vigente[k] === undefined) vigente[k] = otra[k];
    porPatente.set(o.patente, vigente);
  }
  return { filas: [...porPatente.values()], repetidas: [...repetidas], hoja: nombreHoja, columnasFaltantes: faltan };
}


// ── Tira de actividad de 30 días ────────────────────────────────────────────
function TiraActividad({ patente }) {
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const hoy = hoyChile(); const desde = restarDias(hoy, 29);
      const [viajes, gps] = await Promise.all([
        apiSuave(`maestro_dia?patente=eq.${patente}&fecha=gte.${desde}&cargados=gt.0&select=fecha`, []),
        apiSuave(`geotab_lecturas?patente=eq.${patente}&fecha=gte.${desde}&select=fecha,reporto`, []),
      ]);
      if (!vivo) return;
      const dias = [];
      for (let i = 29; i >= 0; i--) dias.push(restarDias(hoy, i));
      const conViaje = new Set(viajes.map(v => v.fecha));
      const gpsPorDia = {}; for (const g of gps) gpsPorDia[g.fecha] = gpsPorDia[g.fecha] || g.reporto;
      setDatos(dias.map(d => ({ d, viaje: conViaje.has(d), gps: gpsPorDia[d], sinDatoGps: !(d in gpsPorDia) })));
    })();
    return () => { vivo = false; };
  }, [patente]);
  if (!datos) return <div style={{ fontSize: 11, color: GRIS_ }}>Cargando actividad…</div>;
  const color = (x) => x.viaje ? VERDE_ : x.gps ? AZUL_ : x.sinDatoGps ? "#e2e8f0" : "#94a3b8";
  return (
    <div>
      <div style={{ display: "flex", gap: 2 }}>
        {datos.map(x => (
          <div key={x.d} title={`${fch(x.d)} · ${x.viaje ? "hizo ruta MELI" : x.gps ? "el GPS se movió" : x.sinDatoGps ? "sin dato de GPS ese día" : "sin ruta y GPS quieto"}`}
               style={{ width: 13, height: 18, borderRadius: 3, background: color(x) }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: 10.5, color: GRIS_, marginTop: 4, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: VERDE_, borderRadius: 2, marginRight: 4 }} />ruta MELI</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: AZUL_, borderRadius: 2, marginRight: 4 }} />GPS se movió</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#94a3b8", borderRadius: 2, marginRight: 4 }} />quieto</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#e2e8f0", borderRadius: 2, marginRight: 4 }} />sin dato GPS (el registro diario parte el 18-10-2026)</span>
        <span>· últimos 30 días, de izquierda a derecha</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
function FlotaGps() {
  const [vista, setVista] = useState("bandejas");      // bandejas | alertas | solicitudes | detalle | config
  const [bandeja, setBandeja] = useState("cortar");
  const [semaforo, setSemaforo] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [cerradas, setCerradas] = useState(null);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargas, setCargas] = useState([]);
  const [config, setConfig] = useState([]);
  const [historialCfg, setHistorialCfg] = useState([]);
  const [geotabFecha, setGeotabFecha] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busca, setBusca] = useState("");
  const [fOp, setFOp] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [abierta, setAbierta] = useState(null);         // patente expandida
  const [pidiendo, setPidiendo] = useState(null);       // { patente, tipo, motivo }
  const [fTipoAlerta, setFTipoAlerta] = useState("");
  const [verCerradas, setVerCerradas] = useState(false);
  const [revisando, setRevisando] = useState(null);
  const [verSolCerradas, setVerSolCerradas] = useState(false);
  const [anulando, setAnulando] = useState(null);       // { id, nota }
  const [recalculando, setRecalculando] = useState(false);
  const [cfgEdit, setCfgEdit] = useState({});
  const [archivo, setArchivo] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [importando, setImportando] = useState(false);

  const avisar = (t) => { setMsg(t); setTimeout(() => setMsg(""), 4500); };

  const cargarTodo = async () => {
    setCargando(true); setError("");
    const fallos = [];
    const [sem, ale, sol, car, cfg, hcf, geo] = await Promise.all([
      apiSuave("vw_flota_semaforo?order=patente&limit=3000", [], fallos),
      apiSuave("flota_alertas?estado=eq.abierta&order=abierta_el.desc,tipo,patente&limit=3000", [], fallos),
      apiSuave("flota_solicitudes?order=pedida_el.desc&limit=1000", [], fallos),
      apiSuave("flota_cl_cargas?order=id.desc&limit=30", [], fallos),
      apiSuave("flota_config?order=clave", [], fallos),
      apiSuave("flota_config_historial?order=cambiado_el.desc&limit=50", [], fallos),
      apiSuave("geotab_lecturas?select=fecha&order=fecha.desc&limit=1", [], fallos),
    ]);
    setSemaforo(sem); setAlertas(ale); setSolicitudes(sol); setCargas(car); setConfig(cfg); setHistorialCfg(hcf);
    setGeotabFecha(geo[0]?.fecha || null);
    if (fallos.length) setError("Algunas consultas no respondieron: " + fallos.join(" | "));
    setCargando(false);
  };
  useEffect(() => { cargarTodo(); }, []);
  useEffect(() => {
    if (verCerradas && cerradas === null)
      apiSuave("flota_alertas?estado=eq.cerrada&order=cerrada_el.desc&limit=500", []).then(setCerradas);
  }, [verCerradas]);

  const u = useMemo(() => Object.fromEntries(config.map(c => [c.clave, c.valor])), [config]);
  const pendientes = useMemo(() => {
    const m = {}; for (const s of solicitudes) if (s.estado === "pendiente") (m[s.patente] = m[s.patente] || []).push(s);
    return m;
  }, [solicitudes]);

  const resumen = useMemo(() => ({
    gpsActivos: semaforo.filter(f => f.gps_activo).length,
    seguros: semaforo.filter(f => f.seg_carga === "SI").length,
    fugaMes: semaforo.reduce((a, f) => a + n(f.fuga_mensual), 0),
    fugaAcum: semaforo.reduce((a, f) => a + n(f.fuga_acumulada), 0),
    porBandeja: Object.fromEntries(BANDEJAS.map(b => [b.id, semaforo.filter(f => bandejaDe(f) === b.id).length])),
    solPend: solicitudes.filter(s => s.estado === "pendiente").length,
  }), [semaforo, solicitudes]);
  const sinCostos = !n(u.costo_gps_mensual) && !n(u.costo_seguro_mensual);

  const listas = useMemo(() => ({
    ops: [...new Set(semaforo.map(f => f.operacion).filter(Boolean))].sort(),
    tipos: [...new Set(semaforo.map(f => f.tipo).filter(Boolean))].sort(),
  }), [semaforo]);
  const filtrar = (f) => {
    const q = busca.trim().toUpperCase();
    return (!fOp || f.operacion === fOp) && (!fTipo || f.tipo === fTipo) &&
      (!q || [f.patente, f.tercero, f.operacion, f.modelo, f.seg_carga_poliza].some(v => String(v || "").toUpperCase().includes(q)));
  };
  const enBandeja = useMemo(() => semaforo
    .filter(f => bandejaDe(f) === bandeja && filtrar(f))
    .sort((a, b) => n(b.fuga_acumulada) - n(a.fuga_acumulada) || (diasUso(b) ?? -1) - (diasUso(a) ?? -1)),
    [semaforo, bandeja, busca, fOp, fTipo]);
  const detalle = useMemo(() => semaforo.filter(filtrar), [semaforo, busca, fOp, fTipo]);

  // ── Acciones ──
  const pedir = async () => {
    if (!pidiendo) return;
    const f = semaforo.find(x => x.patente === pidiendo.patente);
    try {
      await api("flota_solicitudes", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
        patente: pidiendo.patente, tipo: pidiendo.tipo, motivo: pidiendo.motivo || null,
        dias_sin_uso: f ? diasUso(f) : null, pedida_por: usuarioActual() }) });
      setPidiendo(null);
      setSolicitudes(await apiSuave("flota_solicitudes?order=pedida_el.desc&limit=1000", []));
      avisar(`Solicitud registrada: ${TIPOS_SOLICITUD[pidiendo.tipo]} de ${pidiendo.patente}`);
    } catch (e) {
      setError(String(e.message).includes("409") ? "Ya hay una solicitud pendiente de ese tipo para esa patente." : e.message);
    }
  };
  const cerrarSolicitud = async (id, estado, nota) => {
    try {
      await api(`flota_solicitudes?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
        estado, cerrada_el: new Date().toISOString(), cerrada_por: usuarioActual(), nota_cierre: nota || null }) });
      setAnulando(null);
      setSolicitudes(await apiSuave("flota_solicitudes?order=pedida_el.desc&limit=1000", []));
      avisar(estado === "cumplida" ? "Solicitud marcada como cumplida" : "Solicitud anulada");
    } catch (e) { setError(e.message); }
  };
  const marcarRevisada = async () => {
    if (!revisando) return;
    try {
      await api(`flota_alertas?id=eq.${revisando.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ revisada_por: usuarioActual(), nota: revisando.nota || null }) });
      setRevisando(null);
      setAlertas(await apiSuave("flota_alertas?estado=eq.abierta&order=abierta_el.desc,tipo,patente&limit=3000", []));
      avisar("Alerta marcada como revisada");
    } catch (e) { setError(e.message); }
  };
  const recalcular = async () => {
    setRecalculando(true); setError("");
    try {
      const r = await api("rpc/fn_flota_generar_alertas", { method: "POST", body: "{}" });
      const c = await api("rpc/fn_flota_cerrar_solicitudes", { method: "POST", body: "{}" });
      const f = Array.isArray(r) ? r[0] : r;
      await cargarTodo(); setCerradas(null);
      avisar(`Recalculado: ${fmt(f?.abiertas)} alertas nuevas, ${fmt(f?.cerradas)} cerradas, ${fmt(c)} solicitudes cumplidas`);
    } catch (e) { setError(e.message); }
    finally { setRecalculando(false); }
  };
  const guardarConfig = async (clave) => {
    const valor = Number(cfgEdit[clave]);
    if (!Number.isInteger(valor) || valor < 0) { setError("El valor debe ser un número entero, sin puntos ni decimales."); return; }
    try {
      await api(`flota_config?clave=eq.${clave}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ valor, actualizado_por: usuarioActual() }) });
      setCfgEdit(e => { const x = { ...e }; delete x[clave]; return x; });
      await cargarTodo();
      avisar("Umbral guardado y registrado en el historial. Las bandejas ya lo usan; las alertas se actualizan con «Recalcular» o mañana a las 07:00.");
    } catch (e) { setError(e.message); }
  };
  const previsualizar = async (f) => {
    setArchivo(f); setPrevia(null); setError("");
    if (!f) return;
    try { setPrevia(await leerNomina(f)); }
    catch (e) { setError("No se pudo leer el Excel: " + e.message); }
  };
  const importar = async () => {
    if (!previa || !previa.filas.length) return;
    setImportando(true); setError("");
    try {
      const carga = await api("flota_cl_cargas", { method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ cargado_por: usuarioActual(), archivo: archivo?.name || null, filas: previa.filas.length,
          duplicadas: previa.repetidas, observacion: `Carga desde el Brain · hoja ${previa.hoja}` }) });
      const cargaId = (Array.isArray(carga) ? carga[0] : carga)?.id;
      if (!cargaId) throw new Error("No se pudo registrar la carga.");
      for (let i = 0; i < previa.filas.length; i += 200) {
        const lote = previa.filas.slice(i, i + 200).map(r => ({ ...r, carga_id: cargaId }));
        await api("flota_cl", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(lote) });
      }
      setArchivo(null); setPrevia(null);
      await cargarTodo();
      avisar(`Nómina cargada: ${fmt(previa.filas.length)} patentes (carga #${cargaId})`);
    } catch (e) { setError("La carga falló: " + e.message); }
    finally { setImportando(false); }
  };

  // ── Piezas de UI ──
  const Kpi = ({ titulo, valor, sub, color, onClick }) => (
    <div onClick={onClick} style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "11px 14px",
                                    cursor: onClick ? "pointer" : "default", borderLeft: `4px solid ${color || NAVY}` }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: GRIS_, textTransform: "uppercase", letterSpacing: .3 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || NAVY, marginTop: 2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: GRIS_, marginTop: 1 }}>{sub}</div>}
    </div>
  );
  const filtros = (conTotal) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <input className="mj-input" style={{ minWidth: 220 }} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar patente, tercero, modelo…" />
      <select className="mj-input" value={fOp} onChange={e => setFOp(e.target.value)}>
        <option value="">Todas las operaciones</option>
        {listas.ops.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
      <select className="mj-input" value={fTipo} onChange={e => setFTipo(e.target.value)}>
        <option value="">Planta y apoyo</option>
        {listas.tipos.map(x => <option key={x} value={x}>{x}</option>)}
      </select>
      <div style={{ flex: 1 }} />
      {conTotal}
    </div>
  );
  const botonesSolicitud = (f) => {
    const p = (pendientes[f.patente] || []).map(s => s.tipo);
    const b = [];
    if (f.cortar_gps && !p.includes("BAJA_GPS")) b.push(["BAJA_GPS", "Pedir baja GPS"]);
    if (f.sacar_seguro && !p.includes("BAJA_SEGURO")) b.push(["BAJA_SEGURO", "Pedir baja del seguro"]);
    if (f.gps_mudo && !p.includes("REVISAR_GPS")) b.push(["REVISAR_GPS", "Pedir revisión del GPS"]);
    return b;
  };

  const VISTAS = [
    ["bandejas", "Bandejas de trabajo"],
    ["alertas", `Alertas (${fmt(alertas.length)})`],
    ["solicitudes", `Solicitudes (${fmt(resumen.solPend)})`],
    ["detalle", "Detalle completo"],
    ["config", "Umbrales y Nómina"],
  ];

  return (
    <Fragment>
      {/* Resumen */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: GRIS_ }}>
          Geotab al {fch(geotabFecha)} · Nómina carga #{cargas[0]?.id || "—"} del {fch(cargas[0]?.cargado_at)}
          {" "}· sin uso = sin ruta MELI <strong>y</strong> sin movimiento de GPS
        </div>
        <button className="mj-btn" onClick={recalcular} disabled={recalculando}>{recalculando ? "Recalculando…" : "Recalcular ahora"}</button>
      </div>
      {msg && <div style={{ background: "#e7f6ec", border: "1px solid #b7e1c4", borderRadius: 10, padding: "8px 14px", marginBottom: 10, fontSize: 12, color: VERDE_ }}>✓ {msg}</div>}
      {error && <div style={{ background: "#fff4f4", border: "1px solid #f2c9c9", borderRadius: 10, padding: "8px 14px", marginBottom: 10, fontSize: 12, color: "#7a2a22" }}>
        {error} <span style={{ cursor: "pointer", marginLeft: 8, fontWeight: 700 }} onClick={() => setError("")}>✕</span></div>}
      {cargando && <div style={{ color: GRIS_, fontSize: 13, padding: "12px 0" }}>Cargando la flota…</div>}

      {!cargando && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", marginBottom: 14 }}>
          <Kpi titulo="GPS activos en Geotab" valor={fmt(resumen.gpsActivos)} sub="se pagan todos los meses" />
          <Kpi titulo="Seguros de carga" valor={fmt(resumen.seguros)} sub="según la Nómina vigente" />
          <Kpi titulo="Se paga sin uso" color={ROJO_} valor={sinCostos ? fmt(resumen.porBandeja.cortar) + " veh." : clp(resumen.fugaMes) + "/mes"}
               sub={sinCostos ? "define los costos en Umbrales para verlo en pesos" : `${clp(resumen.fugaAcum)} acumulado desde que dejaron de usarse`}
               onClick={sinCostos ? () => setVista("config") : () => { setVista("bandejas"); setBandeja("cortar"); }} />
          <Kpi titulo="Alertas abiertas" color={AMBAR_} valor={fmt(alertas.length)} sub={`sin ruta ≥ ${u.dias_alerta_sin_ruta ?? "—"} días · apoyo ≥ ${u.viajes_mes_apoyo ?? "—"} viajes`} onClick={() => setVista("alertas")} />
          <Kpi titulo="Solicitudes pendientes" color={AZUL_} valor={fmt(resumen.solPend)} sub="bajas y revisiones pedidas" onClick={() => setVista("solicitudes")} />
        </div>
      )}

      {!cargando && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", borderBottom: "1px solid #e6e9ef", paddingBottom: 10 }}>
          {VISTAS.map(([id, t]) => <button key={id} className={`mj-chip ${vista === id ? "on" : ""}`} onClick={() => setVista(id)}>{t}</button>)}
        </div>
      )}

      {/* ── Bandejas ── */}
      {!cargando && vista === "bandejas" && (
        <Fragment>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 12 }}>
            {BANDEJAS.map(b => (
              <button key={b.id} onClick={() => { setBandeja(b.id); setAbierta(null); }}
                style={{ textAlign: "left", fontFamily: "inherit", cursor: "pointer", borderRadius: 10, padding: "10px 14px",
                         background: bandeja === b.id ? b.fondo : "#fff", border: `1px solid ${bandeja === b.id ? b.color : "#e6e9ef"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: b.color }}>{b.titulo}</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: resumen.porBandeja[b.id] ? b.color : VERDE_ }}>{fmt(resumen.porBandeja[b.id])}</span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, lineHeight: 1.5 }}>{b.que}</div>
              </button>
            ))}
          </div>
          {filtros(<span style={{ fontSize: 12, color: GRIS_ }}>{fmt(enBandeja.length)} vehículos</span>)}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {enBandeja.map(f => {
              const b = BANDEJAS.find(x => x.id === bandeja);
              const pend = pendientes[f.patente] || [];
              const du = diasUso(f);
              return (
                <div key={f.patente} style={{ background: "#fff", border: "1px solid #e6e9ef", borderLeft: `4px solid ${b.color}`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap", cursor: "pointer" }}
                       onClick={() => setAbierta(abierta === f.patente ? null : f.patente)}>
                    <div style={{ minWidth: 150 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>{f.patente}</div>
                      <div style={{ fontSize: 11, color: GRIS_ }}>{[f.estado || "fuera de Nómina", f.tipo].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div style={{ minWidth: 200, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#1f2937" }}>{f.operacion || "—"}</div>
                      <div style={{ fontSize: 11, color: GRIS_, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }} title={f.tercero || ""}>
                        {f.tercero || "—"}{f.marca ? ` · ${f.marca} ${f.modelo || ""}` : ""}
                      </div>
                    </div>
                    <div style={{ minWidth: 110, textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: du === null ? GRIS_ : du >= 30 ? ROJO_ : "#1f2937" }}>{du === null ? "—" : `${fmt(du)} d`}</div>
                      <div style={{ fontSize: 10.5, color: GRIS_ }}>{du === null ? "sin señal de uso" : "sin uso"}</div>
                    </div>
                    <div style={{ minWidth: 120, textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: n(f.fuga_mensual) ? ROJO_ : GRIS_ }}>{n(f.fuga_mensual) ? clp(f.fuga_mensual) : "—"}</div>
                      <div style={{ fontSize: 10.5, color: GRIS_ }}>{n(f.fuga_mensual) ? "al mes sin uso" : "se paga: " + ([f.gps_activo ? "GPS" : null, f.seg_carga === "SI" ? "seguro" : null].filter(Boolean).join(" + ") || "nada")}</div>
                    </div>
                    <div style={{ fontSize: 16, color: GRIS_ }}>{abierta === f.patente ? "▾" : "▸"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                    {motivos(f, u).map((m, i) => <span key={i} style={{ fontSize: 11.5, color: "#334155", background: "#f4f6f9", borderRadius: 6, padding: "2px 8px" }}>{m}</span>)}
                    {pend.map(s => <Etiqueta key={s.id} texto={`${TIPOS_SOLICITUD[s.tipo]} pedida ${fch(s.pedida_el)} · ${s.pedida_por || ""}`} color={AZUL_} fondo="#eaf1ff" />)}
                  </div>
                  {abierta === f.patente && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #e6e9ef", display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
                      <TiraActividad patente={f.patente} />
                      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", fontSize: 11.5, color: "#334155" }}>
                        <div><strong>Último viaje MELI:</strong> {fch(f.ultimo_viaje)} · {fmt(f.viajes_30d)} viajes en 30 días · {fmt(f.viajes_mes)} este mes</div>
                        <div><strong>GPS:</strong> {f.gps_activo ? `activo en ${f.gps_base}` : f.gps_base ? "dado de baja en Geotab" : "sin dispositivo"} · última comunicación {fchHora(f.gps_ultima_comunicacion)}</div>
                        <div><strong>Seguro de carga:</strong> {f.seg_carga === "SI" ? `${f.seg_carga_proveedor || ""} ${f.seg_carga_poliza || ""} · vence ${fch(f.seg_carga_vence)}` : (f.seg_carga || "no informado")}</div>
                        <div><strong>Nómina:</strong> GPS {f.gps_nomina || "—"} {f.gps_dispositivo ? `(${f.gps_dispositivo})` : ""} · baja pedida {fch(f.baja_solicitada_el)}</div>
                      </div>
                      {botonesSolicitud(f).length > 0 && (
                        pidiendo?.patente === f.patente ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>{TIPOS_SOLICITUD[pidiendo.tipo]}:</span>
                            <input className="mj-input" style={{ minWidth: 300 }} value={pidiendo.motivo} onChange={e => setPidiendo({ ...pidiendo, motivo: e.target.value })} placeholder="Motivo o comentario (opcional)" />
                            <button className="mj-btn" style={{ background: NAVY, color: "#fff" }} onClick={pedir}>Registrar solicitud</button>
                            <button className="mj-btn" onClick={() => setPidiendo(null)}>Cancelar</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {botonesSolicitud(f).map(([tipo, t]) => (
                              <button key={tipo} className="mj-btn" onClick={() => setPidiendo({ patente: f.patente, tipo, motivo: motivos(f, u)[0] || "" })}>{t}</button>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {enBandeja.length === 0 && <div style={{ textAlign: "center", color: "#94a3b8", padding: 24, background: "#fff", borderRadius: 10, border: "1px solid #e6e9ef" }}>Nada en esta bandeja con esos filtros.</div>}
          </div>
        </Fragment>
      )}

      {/* ── Alertas ── */}
      {!cargando && vista === "alertas" && (() => {
        const base = verCerradas ? (cerradas || []) : alertas;
        const q = busca.trim().toUpperCase();
        const lista = base.filter(a => (!fTipoAlerta || a.tipo === fTipoAlerta) && (!q || a.patente.includes(q)));
        return (
          <Fragment>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <input className="mj-input" style={{ minWidth: 180 }} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar patente…" />
              {Object.entries(TIPOS_ALERTA).map(([k, v]) => {
                const c = alertas.filter(a => a.tipo === k).length;
                return <button key={k} className={`mj-chip ${fTipoAlerta === k ? "on" : ""}`} onClick={() => setFTipoAlerta(fTipoAlerta === k ? "" : k)}>{v.rotulo} ({fmt(c)})</button>;
              })}
              <div style={{ flex: 1 }} />
              <button className={`mj-chip ${verCerradas ? "on" : ""}`} onClick={() => setVerCerradas(v => !v)}>{verCerradas ? "✓ " : ""}Ver cerradas</button>
            </div>
            <div className="mj-scroll">
              <table className="mj-tabla">
                <thead><tr><th>Tipo</th><th>Patente</th><th>Detalle</th><th>Abierta</th>{verCerradas && <th>Cerrada</th>}<th>Revisión</th><th></th></tr></thead>
                <tbody>
                  {lista.map(a => {
                    const t = TIPOS_ALERTA[a.tipo] || { rotulo: a.tipo, color: GRIS_, fondo: "#f1f5f9" };
                    const d = a.detalle || {};
                    return (
                      <tr key={a.id}>
                        <td><Etiqueta texto={t.rotulo} color={t.color} fondo={t.fondo} /></td>
                        <td style={{ fontWeight: 700 }}>{a.patente}</td>
                        <td style={{ color: "#64748b", whiteSpace: "normal", maxWidth: 420 }}>
                          {a.tipo === "SIN_RUTA" && `${fmt(d.dias_sin_uso)} días sin uso · último viaje ${fch(d.ultimo_viaje)} · ${d.operacion || ""}`}
                          {a.tipo === "APOYO_EXCESO" && `${fmt(d.viajes_mes)} viajes en el mes · ${d.operacion || ""}`}
                          {a.tipo === "CORTAR_GPS" && `${fmt(d.dias_sin_uso)} días sin uso · dispositivo en ${d.gps_base || "—"}`}
                          {a.tipo === "SACAR_SEGURO" && `${fmt(d.dias_sin_uso)} días sin uso · ${d.proveedor || ""} ${d.poliza || ""}`}
                          {a.tipo === "GPS_MUDO" && `GPS sin comunicar hace ${fmt(d.gps_dias_sin_reportar)} días · ${fmt(d.viajes_30d)} viajes en 30 días`}
                        </td>
                        <td>{fch(a.abierta_el)}</td>
                        {verCerradas && <td>{fch(a.cerrada_el)}</td>}
                        <td style={{ whiteSpace: "normal", maxWidth: 260 }}>
                          {a.revisada_por ? <span style={{ fontSize: 11.5 }}><strong>{a.revisada_por}</strong>{a.nota ? ` · ${a.nota}` : ""}</span> : <span style={{ color: "#a8b2c1" }}>sin revisar</span>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {revisando?.id === a.id ? (
                            <Fragment>
                              <input className="mj-input" style={{ width: 220, fontSize: 11.5 }} value={revisando.nota} onChange={e => setRevisando({ ...revisando, nota: e.target.value })} placeholder="Nota (opcional)" />
                              <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11, marginLeft: 4, background: NAVY, color: "#fff" }} onClick={marcarRevisada}>Guardar</button>
                              <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }} onClick={() => setRevisando(null)}>Cancelar</button>
                            </Fragment>
                          ) : (!verCerradas && <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setRevisando({ id: a.id, nota: a.nota || "" })}>{a.revisada_por ? "Editar nota" : "Marcar revisada"}</button>)}
                        </td>
                      </tr>
                    );
                  })}
                  {lista.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>{verCerradas && cerradas === null ? "Cargando…" : "No hay alertas con esos filtros."}</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: GRIS_, marginTop: 8 }}>Las alertas se abren una vez por patente y tipo, y se cierran solas cuando la condición desaparece. Se recalculan todos los días a las 07:00.</div>
          </Fragment>
        );
      })()}

      {/* ── Solicitudes ── */}
      {!cargando && vista === "solicitudes" && (() => {
        const lista = solicitudes.filter(s => (verSolCerradas ? s.estado !== "pendiente" : s.estado === "pendiente") &&
          (!busca.trim() || s.patente.includes(busca.trim().toUpperCase())));
        return (
          <Fragment>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <input className="mj-input" style={{ minWidth: 180 }} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar patente…" />
              <button className={`mj-chip ${!verSolCerradas ? "on" : ""}`} onClick={() => setVerSolCerradas(false)}>Pendientes</button>
              <button className={`mj-chip ${verSolCerradas ? "on" : ""}`} onClick={() => setVerSolCerradas(true)}>Cumplidas y anuladas</button>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: GRIS_ }}>Se marcan cumplidas solas cuando Geotab o la Nómina lo confirman (todos los días 07:05)</span>
            </div>
            <div className="mj-scroll">
              <table className="mj-tabla">
                <thead><tr><th>Patente</th><th>Solicitud</th><th>Motivo</th><th className="num">Días sin uso</th><th>Pedida</th><th>Por</th><th>Estado</th><th>Cierre</th><th></th></tr></thead>
                <tbody>
                  {lista.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 700 }}>{s.patente}</td>
                      <td>{TIPOS_SOLICITUD[s.tipo] || s.tipo}</td>
                      <td style={{ whiteSpace: "normal", maxWidth: 320, color: "#64748b" }}>{s.motivo || "—"}</td>
                      <td className="num">{s.dias_sin_uso ?? "—"}</td>
                      <td>{fchHora(s.pedida_el)}</td>
                      <td>{s.pedida_por || "—"}</td>
                      <td><Etiqueta texto={s.estado.toUpperCase()} color={s.estado === "cumplida" ? VERDE_ : s.estado === "anulada" ? GRIS_ : AZUL_}
                                    fondo={s.estado === "cumplida" ? "#e7f6ec" : s.estado === "anulada" ? "#f1f5f9" : "#eaf1ff"} /></td>
                      <td style={{ whiteSpace: "normal", maxWidth: 260, fontSize: 11.5, color: "#64748b" }}>
                        {s.cerrada_el ? `${fchHora(s.cerrada_el)} · ${s.cerrada_por || ""}${s.nota_cierre ? " · " + s.nota_cierre : ""}` : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {s.estado === "pendiente" && (anulando?.id === s.id ? (
                          <Fragment>
                            <input className="mj-input" style={{ width: 200, fontSize: 11.5 }} value={anulando.nota} onChange={e => setAnulando({ ...anulando, nota: e.target.value })} placeholder="Motivo" />
                            <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11, marginLeft: 4 }} onClick={() => cerrarSolicitud(s.id, anulando.estado, anulando.nota)}>Confirmar</button>
                            <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }} onClick={() => setAnulando(null)}>Cancelar</button>
                          </Fragment>
                        ) : (
                          <Fragment>
                            <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setAnulando({ id: s.id, estado: "cumplida", nota: "" })}>Cumplida</button>
                            <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11, marginLeft: 4 }} onClick={() => setAnulando({ id: s.id, estado: "anulada", nota: "" })}>Anular</button>
                          </Fragment>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {lista.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>No hay solicitudes {verSolCerradas ? "cerradas" : "pendientes"}.</td></tr>}
                </tbody>
              </table>
            </div>
          </Fragment>
        );
      })()}

      {/* ── Detalle completo ── */}
      {!cargando && vista === "detalle" && (
        <Fragment>
          {filtros(<Fragment>
            <span style={{ fontSize: 12, color: GRIS_ }}>{fmt(detalle.length)} patentes</span>
            <button className="mj-btn" onClick={() => descargarCSV(`gps_seguros_${hoyChile()}`, detalle, COLS_DETALLE)}>Descargar CSV</button>
          </Fragment>)}
          <div className="mj-scroll">
            <table className="mj-tabla">
              <thead><tr>
                <th>Patente</th><th>Estado</th><th>Tipo</th><th>Operación</th><th>Tercero</th>
                <th>Últ. viaje</th><th className="num">Viajes 30d</th><th>GPS</th><th>Últ. comunicación</th>
                <th>Seguro</th><th>Vence</th><th className="num">Días sin uso</th><th>Bandeja</th>
              </tr></thead>
              <tbody>
                {detalle.map(f => {
                  const b = BANDEJAS.find(x => x.id === bandejaDe(f));
                  return (
                    <tr key={f.patente}>
                      <td style={{ fontWeight: 700 }}>{f.patente}</td>
                      <td>{f.estado || <span style={{ color: "#a8b2c1" }}>fuera de Nómina</span>}</td>
                      <td>{f.tipo || "—"}</td>
                      <td>{f.operacion || "—"}</td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={f.tercero || ""}>{f.tercero || "—"}</td>
                      <td>{fch(f.ultimo_viaje)}</td>
                      <td className="num">{f.viajes_30d ?? "—"}</td>
                      <td>{f.gps_activo ? `activo · ${f.gps_base}` : f.gps_base ? "de baja" : "—"}</td>
                      <td>{fchHora(f.gps_ultima_comunicacion)}</td>
                      <td>{f.seg_carga === "SI" ? (f.seg_carga_proveedor || "SI") : (f.seg_carga || "—")}</td>
                      <td style={{ color: f.seguro_vencido ? ROJO_ : undefined }}>{fch(f.seg_carga_vence)}</td>
                      <td className="num">{diasUso(f) ?? "sin señal"}</td>
                      <td>{b ? <Etiqueta texto={b.titulo} color={b.color} fondo={b.fondo} /> : <span style={{ color: VERDE_, fontSize: 11 }}>✓ en orden</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Fragment>
      )}

      {/* ── Umbrales y Nómina ── */}
      {!cargando && vista === "config" && (
        <Fragment>
          <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "13px 16px", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Umbrales</div>
            <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 10px" }}>
              Cada cambio queda registrado con quién lo hizo y cuándo. Las bandejas lo aplican al instante; las alertas, con «Recalcular ahora» o en la corrida de las 07:00.
            </div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
              {config.map(c => {
                const r = ROTULO_UMBRAL[c.clave] || { titulo: c.clave, unidad: "" };
                const editando = cfgEdit[c.clave] !== undefined;
                return (
                  <div key={c.clave} style={{ border: "1px solid #e6e9ef", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: NAVY }}>{r.titulo}</div>
                    <div style={{ fontSize: 11, color: GRIS_, minHeight: 30, lineHeight: 1.4 }}>{c.descripcion}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      {editando
                        ? <input className="mj-input" type="number" min={0} style={{ width: 110 }} value={cfgEdit[c.clave]} onChange={e => setCfgEdit(x => ({ ...x, [c.clave]: e.target.value }))} />
                        : <span style={{ fontSize: 20, fontWeight: 800, color: "#1f2937" }}>{c.clave.startsWith("costo") ? clp(c.valor) : fmt(c.valor)}</span>}
                      <span style={{ fontSize: 11, color: GRIS_ }}>{r.unidad}</span>
                      <div style={{ flex: 1 }} />
                      {editando ? (
                        <Fragment>
                          <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11, background: NAVY, color: "#fff" }} onClick={() => guardarConfig(c.clave)}>Guardar</button>
                          <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => setCfgEdit(x => { const y = { ...x }; delete y[c.clave]; return y; })}>✕</button>
                        </Fragment>
                      ) : <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setCfgEdit(x => ({ ...x, [c.clave]: c.valor }))}>Cambiar</button>}
                    </div>
                    <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 5 }}>
                      {c.actualizado_por ? `Último cambio: ${c.actualizado_por} · ${fchHora(c.actualizado_el)}` : "Valor inicial"}
                    </div>
                  </div>
                );
              })}
            </div>
            {historialCfg.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Historial de cambios</div>
                <table className="mj-tabla" style={{ border: "1px solid #eef1f5" }}>
                  <thead><tr><th>Fecha</th><th>Umbral</th><th className="num">Antes</th><th className="num">Después</th><th>Cambiado por</th></tr></thead>
                  <tbody>
                    {historialCfg.map(h => (
                      <tr key={h.id}>
                        <td>{fchHora(h.cambiado_el)}</td>
                        <td>{ROTULO_UMBRAL[h.clave]?.titulo || h.clave}</td>
                        <td className="num">{fmt(h.valor_anterior)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmt(h.valor_nuevo)}</td>
                        <td>{h.cambiado_por || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "13px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Cargar Nómina de Flota (Excel)</div>
              <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.7, marginBottom: 8 }}>
                Sube el Excel de siempre (hoja <strong>Nomina</strong>). Cada carga queda registrada y pasa a ser la vigente; las anteriores se conservan.
              </div>
              <input type="file" accept=".xlsx,.xlsm,.xls" onChange={e => previsualizar(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
              {previa && (
                <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.8 }}>
                  <div><strong>{fmt(previa.filas.length)}</strong> patentes en la hoja {previa.hoja}{previa.repetidas.length ? ` · repetidas resueltas: ${previa.repetidas.join(", ")}` : ""}</div>
                  <div style={{ color: "#64748b" }}>{fmt(previa.filas.filter(f => f.gps === "SI").length)} con GPS · {fmt(previa.filas.filter(f => f.seg_carga === "SI").length)} con seguro · {fmt(previa.filas.filter(f => f.estado === "ACTIVA").length)} activas</div>
                  {previa.columnasFaltantes.length > 0 && <div style={{ color: AMBAR_ }}>Columnas que no vienen (quedan vacías): {previa.columnasFaltantes.join(", ")}</div>}
                  <button className="mj-btn" onClick={importar} disabled={importando} style={{ marginTop: 6, background: NAVY, color: "#fff" }}>
                    {importando ? "Cargando…" : `Cargar ${fmt(previa.filas.length)} patentes`}
                  </button>
                </div>
              )}
            </div>
            <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800, color: NAVY, borderBottom: "1px solid #eef1f5" }}>Historial de cargas</div>
              <table className="mj-tabla">
                <thead><tr><th>#</th><th>Fecha</th><th>Por</th><th className="num">Patentes</th></tr></thead>
                <tbody>
                  {cargas.map((c, i) => (
                    <tr key={c.id} style={{ fontWeight: i === 0 ? 700 : 400 }}>
                      <td>{c.id}{i === 0 ? " · vigente" : ""}</td><td>{fchHora(c.cargado_at)}</td><td>{c.cargado_por || "—"}</td><td className="num">{fmt(c.filas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Fragment>
      )}
    </Fragment>
  );
}

// ── Módulo: cabecera + estilos (los mismos del Maestro) + contenido ─────────
export default function ModuloGpsSegurosCL() {
  return (
    <div style={{ padding: 0, fontFamily: "'Geist', system-ui, -apple-system, sans-serif" }}>
      <style>{`
        .mj-wrap{background:#f4f6f9;min-height:100%;}
        .mj-tabla{width:100%;border-collapse:collapse;font-size:12px;background:#fff;}
        .mj-tabla thead th{position:sticky;top:0;z-index:2;background:${NAVY};color:#fff;font-size:10.5px;
                letter-spacing:.4px;text-transform:uppercase;padding:8px 9px;text-align:left;white-space:nowrap;font-weight:700;}
        .mj-tabla tbody td{padding:7px 9px;border-bottom:1px solid #eef1f5;white-space:nowrap;}
        .mj-tabla tbody tr:hover{background:#f7faff;}
        .mj-tabla .num{text-align:right;font-variant-numeric:tabular-nums;}
        .mj-scroll{max-height:calc(100vh - 330px);overflow:auto;border:1px solid #e6e9ef;border-radius:10px;background:#fff;}
        .mj-input{border:1px solid #dfe4ec;border-radius:8px;padding:6px 10px;font-size:12.5px;font-family:inherit;color:#1f2937;background:#fff;}
        .mj-input:focus{outline:2px solid ${NAVY}22;border-color:${NAVY};}
        .mj-btn{border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:8px;padding:6px 12px;
                font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;}
        .mj-btn:hover{background:${NAVY};color:#fff;}
        .mj-btn:disabled{opacity:.55;cursor:default;}
        .mj-chip{border:1px solid #dfe4ec;background:#fff;border-radius:20px;padding:4px 11px;font-size:12px;
                 cursor:pointer;font-family:inherit;color:#64748b;font-weight:600;}
        .mj-chip.on{background:${NAVY};border-color:${NAVY};color:#fff;}
      `}</style>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: -.3 }}>GPS y Seguros · Chile</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          Levantamiento de uso real de la flota: Nómina, maestro de viajes y Geotab
        </div>
      </div>
      <div className="mj-wrap" style={{ padding: "16px 24px 28px" }}>
        <FlotaGps />
      </div>
    </div>
  );
}
