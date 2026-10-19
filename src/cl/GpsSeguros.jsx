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

const NAVY = "#1a3a6b";
const VERDE_ = "#0d8043";
const ROJO_ = "#b42318";
const AMBAR_ = "#a16207";
const GRIS_ = "#8a94a6";

const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const fmt = (v) => n(v).toLocaleString("es-CL");
const fch = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("-") : "—");
const fchHora = (ts) => {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago",
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
  } catch (e) { return "—"; }
};
const usuarioActual = () => {
  try { return JSON.parse(localStorage.getItem("bt_usuario") || "null")?.nombre || "brain"; }
  catch (e) { return "brain"; }
};

// ── Banderas del semáforo: orden, rótulo y color ─────────────────────────────
const BANDERAS = [
  { id: "cortar_gps",        rotulo: "Cortar GPS",         color: ROJO_,  fondo: "#fdecec", que: "GPS activo (se paga) en un vehículo sin viaje ni movimiento hace más días que el umbral." },
  { id: "sacar_seguro",      rotulo: "Sacar del seguro",   color: ROJO_,  fondo: "#fdecec", que: "Seguro de carga vigente en un vehículo sin viaje ni movimiento hace más días que el umbral." },
  { id: "gps_mudo",          rotulo: "GPS mudo",           color: AMBAR_, fondo: "#fff6dc", que: "El vehículo sale a ruta pero su GPS no comunica hace más días que el umbral: se paga y no rastrea." },
  { id: "activa_sin_gps",    rotulo: "Activa sin GPS",     color: AMBAR_, fondo: "#fff6dc", que: "Vehículo ACTIVA de PLANTA sin dispositivo activo en Geotab." },
  { id: "activa_sin_seguro", rotulo: "Activa sin seguro",  color: AMBAR_, fondo: "#fff6dc", que: "Vehículo ACTIVA de PLANTA sin seguro de carga en la Nómina." },
  { id: "seguro_sin_senal",  rotulo: "Seguro sin señal",   color: GRIS_,  fondo: "#f1f5f9", que: "Tiene seguro pero no hay forma de saber si se usa: sin viajes MELI y sin GPS activo. Revisar a mano." },
  { id: "gps_fuera_nomina",  rotulo: "GPS fuera de nómina", color: GRIS_, fondo: "#f1f5f9", que: "Dispositivo activo en Geotab cuya patente no está en la Nómina de Flota." },
];

const TIPOS_ALERTA = {
  SIN_RUTA:     { rotulo: "Sin ruta",            color: ROJO_,  fondo: "#fdecec" },
  APOYO_EXCESO: { rotulo: "Apoyo con exceso",    color: AMBAR_, fondo: "#fff6dc" },
  CORTAR_GPS:   { rotulo: "Cortar GPS",          color: ROJO_,  fondo: "#fdecec" },
  SACAR_SEGURO: { rotulo: "Sacar del seguro",    color: ROJO_,  fondo: "#fdecec" },
  GPS_MUDO:     { rotulo: "GPS mudo",            color: AMBAR_, fondo: "#fff6dc" },
};

const COLS_SEMAFORO = [
  { titulo: "PATENTE", campo: "patente" }, { titulo: "ESTADO", campo: "estado" }, { titulo: "TIPO", campo: "tipo" },
  { titulo: "OPERACION", campo: "operacion" }, { titulo: "TERCERO", campo: "tercero" }, { titulo: "MARCA", campo: "marca" },
  { titulo: "MODELO", campo: "modelo" }, { titulo: "ULTIMO_VIAJE", campo: "ultimo_viaje" }, { titulo: "DIAS_SIN_VIAJE", campo: "dias_sin_viaje" },
  { titulo: "VIAJES_30D", campo: "viajes_30d" }, { titulo: "VIAJES_MES", campo: "viajes_mes" }, { titulo: "GPS_NOMINA", campo: "gps_nomina" },
  { titulo: "GPS_ACTIVO_GEOTAB", campo: "gps_activo" }, { titulo: "GPS_BASE", campo: "gps_base" }, { titulo: "GPS_ULTIMA_COMUNICACION", campo: "gps_ultima_comunicacion" },
  { titulo: "GPS_DIAS_SIN_REPORTAR", campo: "gps_dias_sin_reportar" }, { titulo: "SEGURO_CARGA", campo: "seg_carga" }, { titulo: "SEGURO_PROVEEDOR", campo: "seg_carga_proveedor" },
  { titulo: "SEGURO_POLIZA", campo: "seg_carga_poliza" }, { titulo: "SEGURO_VENCE", campo: "seg_carga_vence" }, { titulo: "DIAS_SIN_USO", campo: "dias_sin_uso" },
  { titulo: "CORTAR_GPS", campo: "cortar_gps" }, { titulo: "SACAR_SEGURO", campo: "sacar_seguro" }, { titulo: "GPS_MUDO", campo: "gps_mudo" },
  { titulo: "ACTIVA_SIN_GPS", campo: "activa_sin_gps" }, { titulo: "ACTIVA_SIN_SEGURO", campo: "activa_sin_seguro" }, { titulo: "SEGURO_SIN_SENAL", campo: "seguro_sin_senal" },
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

// ═══════════════════════════════════════════════════════════════════════════
function FlotaGps() {
  const [sub, setSub] = useState("semaforo");          // semaforo | alertas | nomina
  const [semaforo, setSemaforo] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [cerradas, setCerradas] = useState(null);       // null = no cargadas
  const [cargas, setCargas] = useState([]);
  const [config, setConfig] = useState([]);
  const [geotabFecha, setGeotabFecha] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  // filtros del semáforo
  const [bandera, setBandera] = useState("");
  const [busca, setBusca] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fOp, setFOp] = useState("");
  // alertas
  const [fTipoAlerta, setFTipoAlerta] = useState("");
  const [verCerradas, setVerCerradas] = useState(false);
  const [revisando, setRevisando] = useState(null);     // { id, nota }
  const [recalculando, setRecalculando] = useState(false);
  // configuración
  const [cfgEdit, setCfgEdit] = useState({});
  // importador
  const [archivo, setArchivo] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [importando, setImportando] = useState(false);

  const avisar = (t) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  const cargarTodo = async () => {
    setCargando(true); setError("");
    const fallos = [];
    const [sem, ale, car, cfg, geo] = await Promise.all([
      apiSuave("vw_flota_semaforo?order=patente&limit=3000", [], fallos),
      apiSuave("flota_alertas?estado=eq.abierta&order=abierta_el.desc,tipo,patente&limit=3000", [], fallos),
      apiSuave("flota_cl_cargas?order=id.desc&limit=30", [], fallos),
      apiSuave("flota_config?order=clave", [], fallos),
      apiSuave("geotab_lecturas?select=fecha&order=fecha.desc&limit=1", [], fallos),
    ]);
    setSemaforo(sem); setAlertas(ale); setCargas(car); setConfig(cfg);
    setGeotabFecha(geo[0]?.fecha || null);
    if (fallos.length) setError("Algunas consultas no respondieron: " + fallos.join(" | "));
    setCargando(false);
  };
  useEffect(() => { cargarTodo(); }, []);

  const cargarCerradas = async () => {
    setCerradas(await apiSuave("flota_alertas?estado=eq.cerrada&order=cerrada_el.desc&limit=500", []));
  };
  useEffect(() => { if (verCerradas && cerradas === null) cargarCerradas(); }, [verCerradas]);

  // ── Resúmenes ──
  const conteo = useMemo(() => {
    const c = {};
    for (const b of BANDERAS) c[b.id] = semaforo.filter(f => f[b.id]).length;
    for (const t of Object.keys(TIPOS_ALERTA)) c["A_" + t] = alertas.filter(a => a.tipo === t).length;
    return c;
  }, [semaforo, alertas]);
  const umbral = (clave) => config.find(c => c.clave === clave)?.valor;
  const ultimaCarga = cargas[0] || null;

  const listas = useMemo(() => ({
    estados: [...new Set(semaforo.map(f => f.estado).filter(Boolean))].sort(),
    tipos: [...new Set(semaforo.map(f => f.tipo).filter(Boolean))].sort(),
    ops: [...new Set(semaforo.map(f => f.operacion).filter(Boolean))].sort(),
  }), [semaforo]);

  const semaforoVista = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return semaforo.filter(f =>
      (!bandera || f[bandera]) &&
      (!fEstado || (fEstado === "(sin nómina)" ? !f.estado : f.estado === fEstado)) &&
      (!fTipo || f.tipo === fTipo) &&
      (!fOp || f.operacion === fOp) &&
      (!q || [f.patente, f.tercero, f.operacion, f.modelo, f.seg_carga_poliza, f.gps_dispositivo].some(v => String(v || "").toUpperCase().includes(q)))
    );
  }, [semaforo, bandera, busca, fEstado, fTipo, fOp]);

  const alertasVista = useMemo(() => {
    const base = verCerradas ? (cerradas || []) : alertas;
    const q = busca.trim().toUpperCase();
    return base.filter(a => (!fTipoAlerta || a.tipo === fTipoAlerta) && (!q || a.patente.includes(q)));
  }, [alertas, cerradas, verCerradas, fTipoAlerta, busca]);

  // ── Acciones ──
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
      const f = Array.isArray(r) ? r[0] : r;
      await cargarTodo(); setCerradas(null);
      avisar(`Alertas recalculadas: ${fmt(f?.abiertas)} nuevas, ${fmt(f?.cerradas)} cerradas`);
    } catch (e) { setError(e.message); }
    finally { setRecalculando(false); }
  };

  const guardarConfig = async (clave) => {
    const valor = Number(cfgEdit[clave]);
    if (!Number.isInteger(valor) || valor < 1) { setError("El umbral debe ser un número entero mayor que 0."); return; }
    try {
      await api(`flota_config?clave=eq.${clave}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ valor }) });
      setCfgEdit(e => { const n2 = { ...e }; delete n2[clave]; return n2; });
      await cargarTodo();
      avisar("Umbral actualizado · el semáforo ya lo usa; las alertas se recalculan en la próxima corrida o con el botón");
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
    } catch (e) { setError("La carga falló: " + e.message + " · Si quedó a medias, la carga anterior sigue vigente hasta completar una nueva."); }
    finally { setImportando(false); }
  };

  // ── Render ──
  const chipBandera = (id) => {
    const b = BANDERAS.find(x => x.id === id);
    return <Etiqueta key={id} texto={b.rotulo} color={b.color} fondo={b.fondo} />;
  };
  const gpsCelda = (f) => {
    if (f.gps_activo) return <Etiqueta texto={`ACTIVO · ${f.gps_base}`} color={VERDE_} fondo="#e7f6ec" />;
    if (f.gps_base) return <Etiqueta texto="DADO DE BAJA" color={GRIS_} fondo="#f1f5f9" />;
    return <span style={{ color: "#a8b2c1" }}>sin GPS</span>;
  };

  return (
    <Fragment>
      {/* Encabezado */}
      <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "13px 16px", marginBottom: 12,
                    display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 820 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>GPS y seguros · uso real de la flota</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3 }}>
            Cruza la <strong>Nómina de Flota</strong> (GPS y seguros declarados), el <strong>maestro</strong> (viajes MELI)
            y <strong>Geotab</strong> (dispositivos activos y su última comunicación). "Sin uso" = sin viaje en el maestro
            <strong> y</strong> sin movimiento del GPS; en Rosen, Falabella y bodegas, donde el maestro no ve nada, manda el GPS.
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
            Geotab al {fch(geotabFecha)} · Nómina: carga #{ultimaCarga?.id || "—"} del {fch(ultimaCarga?.cargado_at)}
            {ultimaCarga ? ` (${fmt(ultimaCarga.filas)} patentes, ${ultimaCarga.cargado_por || "—"})` : ""}
            {umbral("dias_sin_uso") ? ` · umbral de uso ${umbral("dias_sin_uso")} días` : ""}
          </div>
          {msg && <div style={{ fontSize: 12, color: VERDE_, marginTop: 6 }}>✓ {msg}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
          {["semaforo", "alertas", "nomina"].map(s => (
            <button key={s} className={`mj-chip ${sub === s ? "on" : ""}`} onClick={() => setSub(s)}>
              {s === "semaforo" ? `Semáforo (${fmt(semaforo.length)})` : s === "alertas" ? `Alertas (${fmt(alertas.length)})` : "Nómina y configuración"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background: "#fff4f4", border: "1px solid #f2c9c9", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "#7a2a22" }}>
          {error}
        </div>
      )}
      {cargando && <div style={{ color: GRIS_, fontSize: 13, padding: "12px 0" }}>Cargando la flota…</div>}

      {/* Tarjetas: cada una filtra el semáforo (o las alertas) */}
      {!cargando && (
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", marginBottom: 12 }}>
          {BANDERAS.map(b => (
            <button key={b.id} title={b.que}
              onClick={() => { setSub("semaforo"); setBandera(bandera === b.id && sub === "semaforo" ? "" : b.id); }}
              style={{ textAlign: "left", background: "#fff", border: `1px solid ${bandera === b.id && sub === "semaforo" ? b.color : "#e6e9ef"}`,
                       borderLeft: `4px solid ${b.color}`, borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a94a6", textTransform: "uppercase", letterSpacing: .3 }}>{b.rotulo}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: conteo[b.id] ? b.color : VERDE_ }}>{fmt(conteo[b.id])}</div>
            </button>
          ))}
          {["SIN_RUTA", "APOYO_EXCESO"].map(t => (
            <button key={t} title={t === "SIN_RUTA" ? `Vehículos ACTIVA de PLANTA sin salir a ruta hace ${umbral("dias_alerta_sin_ruta") || "N"} días o más (alerta abierta)`
                                                   : `Vehículos de APOYO con ${umbral("viajes_mes_apoyo") || "N"} o más viajes en el mes (alerta abierta)`}
              onClick={() => { setSub("alertas"); setVerCerradas(false); setFTipoAlerta(fTipoAlerta === t && sub === "alertas" ? "" : t); }}
              style={{ textAlign: "left", background: "#fff", border: `1px solid ${fTipoAlerta === t && sub === "alertas" ? TIPOS_ALERTA[t].color : "#e6e9ef"}`,
                       borderLeft: `4px solid ${TIPOS_ALERTA[t].color}`, borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8a94a6", textTransform: "uppercase", letterSpacing: .3 }}>
                {t === "SIN_RUTA" ? `Sin ruta ${umbral("dias_alerta_sin_ruta") || ""}d` : `Apoyo ≥${umbral("viajes_mes_apoyo") || ""} viajes`}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: conteo["A_" + t] ? TIPOS_ALERTA[t].color : VERDE_ }}>{fmt(conteo["A_" + t])}</div>
            </button>
          ))}
        </div>
      )}

      {/* ── Semáforo ── */}
      {!cargando && sub === "semaforo" && (
        <Fragment>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <input className="mj-input" style={{ minWidth: 230 }} value={busca} onChange={e => setBusca(e.target.value)}
                   placeholder="Buscar patente, tercero, modelo, póliza…" />
            <select className="mj-input" value={fEstado} onChange={e => setFEstado(e.target.value)}>
              <option value="">Todos los estados</option>
              {listas.estados.map(x => <option key={x} value={x}>{x}</option>)}
              <option value="(sin nómina)">(solo en Geotab)</option>
            </select>
            <select className="mj-input" value={fTipo} onChange={e => setFTipo(e.target.value)}>
              <option value="">Planta y apoyo</option>
              {listas.tipos.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <select className="mj-input" value={fOp} onChange={e => setFOp(e.target.value)}>
              <option value="">Todas las operaciones</option>
              {listas.ops.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            {bandera && (
              <button className="mj-chip on" onClick={() => setBandera("")}>✕ {BANDERAS.find(b => b.id === bandera)?.rotulo}</button>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: GRIS_ }}>{fmt(semaforoVista.length)} patentes</span>
            <button className="mj-btn" onClick={() => descargarCSV(`gps_seguros_${new Date().toISOString().slice(0, 10)}`, semaforoVista, COLS_SEMAFORO)}>
              Descargar CSV
            </button>
          </div>
          <div className="mj-scroll">
            <table className="mj-tabla">
              <thead>
                <tr>
                  <th>Patente</th><th>Estado</th><th>Tipo</th><th>Operación</th><th>Tercero</th><th>Vehículo</th>
                  <th>Últ. viaje</th><th className="num">Días sin viaje</th><th className="num">Viajes 30d</th><th className="num">Viajes mes</th>
                  <th>GPS Geotab</th><th>Últ. comunicación</th><th className="num">Días GPS</th>
                  <th>Seguro carga</th><th>Vence</th><th>Baja pedida</th><th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {semaforoVista.map(f => (
                  <tr key={f.patente}>
                    <td style={{ fontWeight: 700 }}>{f.patente}</td>
                    <td>{f.estado ? <Etiqueta texto={f.estado} color={f.estado === "ACTIVA" ? VERDE_ : f.estado === "INACTIVA" ? GRIS_ : AMBAR_}
                                               fondo={f.estado === "ACTIVA" ? "#e7f6ec" : f.estado === "INACTIVA" ? "#f1f5f9" : "#fff6dc"} />
                                  : <span style={{ color: "#a8b2c1" }}>fuera de nómina</span>}</td>
                    <td>{f.tipo || "—"}</td>
                    <td>{f.operacion || "—"}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={f.tercero || ""}>{f.tercero || "—"}</td>
                    <td style={{ color: "#64748b" }}>{[f.marca, f.modelo].filter(Boolean).join(" ") || "—"}</td>
                    <td>{fch(f.ultimo_viaje)}</td>
                    <td className="num" style={{ color: n(f.dias_sin_viaje) >= (umbral("dias_sin_uso") || 30) ? ROJO_ : undefined }}>
                      {f.dias_sin_viaje === null || f.dias_sin_viaje === undefined ? (f.operacion && f.operacion.startsWith("ML") ? "sin viajes" : "no aplica") : fmt(f.dias_sin_viaje)}
                    </td>
                    <td className="num">{f.viajes_30d === null || f.viajes_30d === undefined ? "—" : fmt(f.viajes_30d)}</td>
                    <td className="num">{f.viajes_mes === null || f.viajes_mes === undefined ? "—" : fmt(f.viajes_mes)}</td>
                    <td>{gpsCelda(f)}</td>
                    <td>{fchHora(f.gps_ultima_comunicacion)}</td>
                    <td className="num" style={{ color: n(f.gps_dias_sin_reportar) >= (umbral("dias_sin_uso") || 30) ? ROJO_ : undefined }}>
                      {f.gps_dias_sin_reportar === null || f.gps_dias_sin_reportar === undefined ? "—" : fmt(f.gps_dias_sin_reportar)}
                    </td>
                    <td>{f.seg_carga === "SI" ? `${f.seg_carga_proveedor || "SI"}${f.seg_carga_poliza ? " · " + f.seg_carga_poliza : ""}` : (f.seg_carga || "—")}</td>
                    <td style={{ color: f.seg_carga_vence && f.seg_carga_vence < new Date().toISOString().slice(0, 10) ? ROJO_ : undefined }}>{fch(f.seg_carga_vence)}</td>
                    <td>{fch(f.baja_solicitada_el)}</td>
                    <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {BANDERAS.filter(b => f[b.id]).map(b => chipBandera(b.id))}
                      {!BANDERAS.some(b => f[b.id]) && <span style={{ color: VERDE_, fontSize: 11 }}>✓ sin observaciones</span>}
                    </td>
                  </tr>
                ))}
                {semaforoVista.length === 0 && (
                  <tr><td colSpan={17} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>Sin patentes con esos filtros.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Fragment>
      )}

      {/* ── Alertas ── */}
      {!cargando && sub === "alertas" && (
        <Fragment>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <input className="mj-input" style={{ minWidth: 180 }} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar patente…" />
            <select className="mj-input" value={fTipoAlerta} onChange={e => setFTipoAlerta(e.target.value)}>
              <option value="">Todos los tipos</option>
              {Object.entries(TIPOS_ALERTA).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
            </select>
            <button className={`mj-chip ${verCerradas ? "on" : ""}`} onClick={() => setVerCerradas(v => !v)}>
              {verCerradas ? "✓ " : ""}Ver cerradas
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: GRIS_ }}>{fmt(alertasVista.length)} alertas · se recalculan todos los días a las 07:00</span>
            <button className="mj-btn" onClick={recalcular} disabled={recalculando}>{recalculando ? "Calculando…" : "Recalcular ahora"}</button>
          </div>
          <div className="mj-scroll">
            <table className="mj-tabla">
              <thead>
                <tr><th>Tipo</th><th>Patente</th><th>Detalle</th><th>Abierta</th>{verCerradas && <th>Cerrada</th>}<th>Revisión</th><th></th></tr>
              </thead>
              <tbody>
                {alertasVista.map(a => {
                  const t = TIPOS_ALERTA[a.tipo] || { rotulo: a.tipo, color: GRIS_, fondo: "#f1f5f9" };
                  const d = a.detalle || {};
                  return (
                    <tr key={a.id}>
                      <td><Etiqueta texto={t.rotulo} color={t.color} fondo={t.fondo} /></td>
                      <td style={{ fontWeight: 700 }}>{a.patente}</td>
                      <td style={{ color: "#64748b", whiteSpace: "normal", maxWidth: 420 }}>
                        {a.tipo === "SIN_RUTA" && `${fmt(d.dias_sin_uso)} días sin uso · último viaje ${fch(d.ultimo_viaje)} · ${d.operacion || ""}`}
                        {a.tipo === "APOYO_EXCESO" && `${fmt(d.viajes_mes)} viajes en el mes · ${d.operacion || ""}`}
                        {a.tipo === "CORTAR_GPS" && `${fmt(d.dias_sin_uso)} días sin uso · dispositivo en base ${d.gps_base || "—"}`}
                        {a.tipo === "SACAR_SEGURO" && `${fmt(d.dias_sin_uso)} días sin uso · ${d.proveedor || ""} ${d.poliza || ""}`}
                        {a.tipo === "GPS_MUDO" && `GPS sin comunicar hace ${fmt(d.gps_dias_sin_reportar)} días y ${fmt(d.viajes_30d)} viajes en 30 días`}
                      </td>
                      <td>{fch(a.abierta_el)}</td>
                      {verCerradas && <td>{fch(a.cerrada_el)}</td>}
                      <td style={{ whiteSpace: "normal", maxWidth: 260 }}>
                        {a.revisada_por ? <span style={{ fontSize: 11.5 }}><strong>{a.revisada_por}</strong>{a.nota ? ` · ${a.nota}` : ""}</span>
                                        : <span style={{ color: "#a8b2c1" }}>sin revisar</span>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {revisando?.id === a.id ? (
                          <Fragment>
                            <input className="mj-input" style={{ width: 220, fontSize: 11.5 }} value={revisando.nota}
                                   onChange={e => setRevisando({ ...revisando, nota: e.target.value })} placeholder="Nota (opcional)" />
                            <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11, marginLeft: 4, background: NAVY, color: "#fff" }} onClick={marcarRevisada}>Guardar</button>
                            <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }} onClick={() => setRevisando(null)}>Cancelar</button>
                          </Fragment>
                        ) : (
                          !verCerradas && <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                                             onClick={() => setRevisando({ id: a.id, nota: a.nota || "" })}>{a.revisada_por ? "Editar nota" : "Marcar revisada"}</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {alertasVista.length === 0 && (
                  <tr><td colSpan={verCerradas ? 7 : 6} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>
                    {verCerradas && cerradas === null ? "Cargando…" : "No hay alertas con esos filtros."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Fragment>
      )}

      {/* ── Nómina y configuración ── */}
      {!cargando && sub === "nomina" && (
        <Fragment>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", marginBottom: 12 }}>
            {/* Importador */}
            <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "13px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Cargar Nómina de Flota (Excel)</div>
              <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.7, marginBottom: 8 }}>
                Sube el mismo Excel de siempre (hoja <strong>Nomina</strong>). Cada carga queda registrada y pasa a ser la vigente;
                las anteriores se conservan para comparar. Si una patente viene repetida, se toma la fila vigente (no INACTIVA)
                y se completa lo que falte desde la otra.
              </div>
              <input type="file" accept=".xlsx,.xlsm,.xls" onChange={e => previsualizar(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
              {previa && (
                <div style={{ marginTop: 10, fontSize: 12, color: "#1f2937", lineHeight: 1.8 }}>
                  <div><strong>{fmt(previa.filas.length)}</strong> patentes en la hoja {previa.hoja}
                    {previa.repetidas.length ? ` · repetidas resueltas: ${previa.repetidas.join(", ")}` : ""}</div>
                  <div style={{ color: "#64748b" }}>
                    {fmt(previa.filas.filter(f => f.gps === "SI").length)} con GPS · {fmt(previa.filas.filter(f => f.seg_carga === "SI").length)} con seguro de carga ·
                    {" "}{fmt(previa.filas.filter(f => f.estado === "ACTIVA").length)} activas
                  </div>
                  {previa.columnasFaltantes.length > 0 && (
                    <div style={{ color: AMBAR_ }}>Columnas que no vienen en el archivo (quedan vacías): {previa.columnasFaltantes.join(", ")}</div>
                  )}
                  <button className="mj-btn" onClick={importar} disabled={importando}
                          style={{ marginTop: 6, background: NAVY, color: "#fff", borderColor: NAVY }}>
                    {importando ? "Cargando…" : `Cargar ${fmt(previa.filas.length)} patentes como carga nueva`}
                  </button>
                </div>
              )}
            </div>

            {/* Configuración */}
            <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "13px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Umbrales</div>
              <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}>Los usa el semáforo al instante y las alertas en su próxima corrida.</div>
              <table className="mj-tabla" style={{ fontSize: 12 }}>
                <tbody>
                  {config.map(c => (
                    <tr key={c.clave}>
                      <td style={{ whiteSpace: "normal", color: "#64748b" }}>{c.descripcion || c.clave}</td>
                      <td className="num" style={{ width: 90 }}>
                        {cfgEdit[c.clave] !== undefined
                          ? <input className="mj-input" type="number" min={1} style={{ width: 70 }} value={cfgEdit[c.clave]}
                                   onChange={e => setCfgEdit(x => ({ ...x, [c.clave]: e.target.value }))} />
                          : <strong>{c.valor}</strong>}
                      </td>
                      <td style={{ width: 140, whiteSpace: "nowrap" }}>
                        {cfgEdit[c.clave] !== undefined ? (
                          <Fragment>
                            <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11, background: NAVY, color: "#fff" }} onClick={() => guardarConfig(c.clave)}>Guardar</button>
                            <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }}
                                    onClick={() => setCfgEdit(x => { const n2 = { ...x }; delete n2[c.clave]; return n2; })}>Cancelar</button>
                          </Fragment>
                        ) : (
                          <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setCfgEdit(x => ({ ...x, [c.clave]: c.valor }))}>Editar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Historial de cargas */}
          <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", fontSize: 12, fontWeight: 800, color: NAVY, borderBottom: "1px solid #eef1f5" }}>Historial de cargas</div>
            <table className="mj-tabla">
              <thead><tr><th>#</th><th>Fecha</th><th>Por</th><th>Archivo</th><th className="num">Patentes</th><th>Repetidas</th><th>Observación</th></tr></thead>
              <tbody>
                {cargas.map(c => (
                  <tr key={c.id} style={{ fontWeight: c.id === ultimaCarga?.id ? 700 : 400 }}>
                    <td>{c.id}{c.id === ultimaCarga?.id ? " · vigente" : ""}</td>
                    <td>{fchHora(c.cargado_at)}</td>
                    <td>{c.cargado_por || "—"}</td>
                    <td style={{ color: "#64748b" }}>{c.archivo || "—"}</td>
                    <td className="num">{fmt(c.filas)}</td>
                    <td style={{ color: "#64748b" }}>{(c.duplicadas || []).join(", ") || "—"}</td>
                    <td style={{ color: "#64748b", whiteSpace: "normal", maxWidth: 360 }}>{c.observacion || ""}</td>
                  </tr>
                ))}
                {cargas.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>Todavía no hay cargas.</td></tr>}
              </tbody>
            </table>
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
