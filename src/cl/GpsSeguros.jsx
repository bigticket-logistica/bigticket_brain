// ═══════════════════════════════════════════════════════════════════════════
// GPS Y SEGUROS · CHILE  (módulo propio del Brain, al lado de Maestro Operaciones)
// Levantamiento de uso de GPS (Geotab) y seguros de la flota.
//
// Fuentes en bigticket-cl:
//   • vw_flota_semaforo  → una fila por patente: Maestro de Certificación + viajes + Geotab + banderas
//   • flota_alertas      → alertas abiertas/cerradas (las genera fn_flota_generar_alertas,
//                          programada a diario con pg_cron)
//   • vw_flota_padron    → padrón vigente del Maestro (cert_vehiculos, cert_gps_seguros, cert_esporadicos, cert_empresas)
//   • flota_cl_cargas    → historial de cargas del Excel
//   • flota_config       → umbrales (días sin uso, días de alerta, viajes de apoyo)
//   • geotab_lecturas    → inventario diario de dispositivos (lo llena el sync de Geotab)
//
// Habla con la API REST del proyecto de Chile por fetch, igual que el Maestro.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, Fragment } from "react";
import { cargarSheetJS, sb } from "../shared";

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

// Descarga en Excel (.xlsx) lo que se ve en pantalla. columnas: [{ titulo, campo } | { titulo, valor: fila => ... }]
async function descargarExcel(nombre, filas, columnas, hoja = "Datos") {
  if (!filas.length) { alert("No hay filas para descargar con los filtros actuales."); return; }
  try {
    const XLSX = await cargarSheetJS();
    const fmtCelda = (v) => v === true ? "SI" : v === false ? "NO" : v === null || v === undefined ? "" :
      (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v.split("-").reverse().join("-") : v;
    const datos = [columnas.map(c => c.titulo), ...filas.map(f => columnas.map(c => fmtCelda(c.valor ? c.valor(f) : f[c.campo])))];
    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws["!cols"] = columnas.map((c, i) => ({ wch: Math.min(60, Math.max(10, ...datos.slice(0, 300).map(r => String(r[i] ?? "").length + 2))) }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: datos.length - 1, c: columnas.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, hoja.slice(0, 31));
    XLSX.writeFile(wb, `${nombre}.xlsx`);
  } catch (e) { alert("No se pudo generar el Excel: " + (e.message || e)); }
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
  { id: "critica",   titulo: "Trabajan sin GPS o sin seguro", color: "#991b1b", fondo: "#fee2e2",
    que: "Hicieron ruta en los últimos 30 días y les falta GPS activo o seguro de carga vigente. Exigible a toda la planta y al apoyo, temporada y esporádico desde 9 viajes en el mes.",
    entra: f => f.cobertura_critica },
  { id: "cortar",    titulo: "Se pagan y no se usan",  color: ROJO_,  fondo: "#fdecec",
    que: "GPS o seguro que se siguen pagando en vehículos sin ruta y sin movimiento de GPS hace 30 días o más. Corresponde pedir la baja.",
    entra: f => f.cortar_gps || f.sacar_seguro },
  { id: "revisar",   titulo: "GPS mudo",  color: AMBAR_, fondo: "#fff6dc",
    que: "El vehículo trabaja, pero su GPS no transmite hace 30 días o más: está desconectado o dañado. No se corta, se revisa.",
    entra: f => f.gps_mudo },
  { id: "cobertura", titulo: "Planta detenida sin GPS o seguro",  color: AZUL_,  fondo: "#eaf1ff",
    que: "Planta ACTIVA sin GPS o sin seguro (o con póliza vencida) que no hizo ruta en los últimos 30 días: revisar si sigue vigente o completar antes de que vuelva a salir.",
    entra: f => f.estado === "ACTIVA" && f.tipo === "PLANTA" && !f.trabajando && (f.activa_sin_gps || f.activa_sin_seguro || f.seguro_vencido) },
  { id: "nomina",    titulo: "Datos a corregir en el Maestro", color: GRIS_,  fondo: "#f1f5f9",
    que: "Lo que dice el Maestro de Certificación no coincide con los viajes y Geotab, falta el registro de GPS y seguro, o no hay señal para saberlo.",
    entra: f => !!f.nomina_desactualizada || f.sin_hoja_gps || f.seguro_sin_senal || f.gps_fuera_nomina },
];
const bandejaDe = (f) => BANDEJAS.find(b => b.entra(f))?.id || null;
const SUB_CRITICA = [
  { id: "nada",        rotulo: "Sin GPS y sin seguro",            entra: f => f.falta_gps && f.seg_carga !== "SI" },
  { id: "gps_vencida", rotulo: "Sin GPS y póliza vencida",        entra: f => f.falta_gps && f.seg_carga === "SI" && f.seguro_vencido },
  { id: "gps",         rotulo: "Solo sin GPS (seguro vigente)",    entra: f => f.falta_gps && !f.falta_seguro },
  { id: "seguro",      rotulo: "Solo sin seguro (GPS activo)",     entra: f => !f.falta_gps && f.seg_carga !== "SI" },
  { id: "vencida",     rotulo: "Solo póliza vencida (GPS activo): confirmar renovación", entra: f => !f.falta_gps && f.seg_carga === "SI" && f.seguro_vencido },
];
const subCritica = (f) => SUB_CRITICA.find(x => x.entra(f))?.id || null;
const SUB_NOMINA = [
  { id: "sin_hoja",   rotulo: "Activos sin fila en GPS y Seguros", entra: f => f.sin_hoja_gps },
  { id: "inactiva",   rotulo: "Figuran inactivos y hacen ruta",   entra: f => /hace ruta/.test(f.nomina_desactualizada || "") },
  { id: "empresa",    rotulo: "Vehículo activo de empresa inactiva", entra: f => /empresa INACTIVA/.test(f.nomina_desactualizada || "") },
  { id: "gps_si",     rotulo: "Maestro dice GPS SÍ, Geotab no lo tiene activo", entra: f => /GPS SÍ/.test(f.nomina_desactualizada || "") },
  { id: "gps_no",     rotulo: "Maestro dice GPS NO, Geotab lo tiene activo",    entra: f => /GPS NO/.test(f.nomina_desactualizada || "") || f.gps_fuera_nomina },
  { id: "sin_senal",  rotulo: "Sin ninguna señal de uso",          entra: f => true },
];
const subNomina = (f) => SUB_NOMINA.find(x => x.entra(f))?.id;
// Bandeja aparte: patentes que hacen ruta MELI y no están en el Maestro (fuente: vw_flota_ruta_fuera_nomina
// en bigticket-cl + vw_certronic_vehiculo_ultimo en el proyecto principal).
const BANDEJA_REGISTRO = { id: "registro", titulo: "Trabajan sin estar registrados", color: "#7c3aed", fondo: "#f3edff",
  que: "Hicieron ruta MELI en los últimos 30 días y no están en el Maestro de Certificación (ni en Vehiculos ni en Esporadicos). Se cruza con Certronic." };
const ESTADO_CERTRONIC = {
  vigente:  { rotulo: "En Certronic", color: VERDE_, fondo: "#e7f6ec", que: "Certificada hoy: solo falta en el Maestro" },
  salio:    { rotulo: "Salió de Certronic", color: AMBAR_, fondo: "#fff6dc", que: "Estuvo certificada y ya no aparece, pero sigue haciendo ruta" },
  nunca:    { rotulo: "Nunca en Certronic", color: ROJO_, fondo: "#fdecec", que: "Opera sin certificación registrada" },
};
const estadoCertronic = (c) => !c ? "nunca" : c.vigente ? "vigente" : "salio";

const motivos = (f, u) => {
  const m = [];
  if (f.cobertura_critica) {
    const falta = [f.falta_gps ? "GPS activo" : null, f.falta_seguro ? (f.seguro_vencido ? `seguro vigente (póliza vencida el ${fch(f.seg_carga_vence)})` : "seguro de carga") : null].filter(Boolean).join(" y ");
    m.push(`Hizo ${fmt(f.viajes_30d)} viajes en 30 días y le falta ${falta}`);
    if (f.tipo !== "PLANTA") m.push(`${f.tipo} con ${fmt(f.viajes_mes)} viajes este mes (desde ${u.viajes_mes_apoyo} debe estar cubierto)`);
    if (f.estado && f.estado !== "ACTIVA") m.push(`Figura ${f.estado} en el Maestro y está trabajando`);
  }
  if (f.cortar_gps) m.push(`GPS activo (${f.gps_base}) sin uso hace ${diasUso(f)} días · umbral ${u.dias_corte_gps}`);
  if (f.sacar_seguro) m.push(`Seguro ${f.seg_carga_proveedor || ""} ${f.seg_carga_poliza || ""} sin uso hace ${diasUso(f)} días · umbral ${u.dias_corte_seguro}`);
  if (f.gps_mudo) m.push(`GPS sin comunicar hace ${fmt(f.gps_dias_sin_reportar)} días, pero hizo ${fmt(f.viajes_30d)} viajes en 30 días`);
  if (!f.cobertura_critica) {
    if (f.activa_sin_gps) m.push("Planta activa sin GPS activo en Geotab");
    if (f.activa_sin_seguro) m.push("Planta activa sin seguro de carga");
    if (f.seguro_vencido) m.push(`Seguro de carga vencido el ${fch(f.seg_carga_vence)}`);
  }
  if (f.nomina_desactualizada && !(f.cobertura_critica && /hace ruta/.test(f.nomina_desactualizada))) m.push(f.nomina_desactualizada);
  if (f.seguro_sin_senal) m.push("Tiene seguro pero no hay viajes MELI ni GPS activo para saber si se usa");
  if (f.sin_hoja_gps) m.push("Está ACTIVA en Vehiculos pero no tiene fila en la hoja GPS y Seguros");
  if (f.gps_fuera_nomina) m.push(`GPS activo en Geotab (${f.gps_base}) y la patente no está en el Maestro`);
  return m;
};

const TIPOS_ALERTA = {
  SIN_RUTA:     { rotulo: "Sin ruta",         color: ROJO_,  fondo: "#fdecec" },
  APOYO_EXCESO: { rotulo: "Apoyo con exceso", color: AMBAR_, fondo: "#fff6dc" },
  CORTAR_GPS:   { rotulo: "Cortar GPS",       color: ROJO_,  fondo: "#fdecec" },
  SACAR_SEGURO: { rotulo: "Sacar del seguro", color: ROJO_,  fondo: "#fdecec" },
  GPS_MUDO:     { rotulo: "GPS mudo",         color: AMBAR_, fondo: "#fff6dc" },
  COBERTURA_CRITICA: { rotulo: "Trabaja sin cobertura", color: "#991b1b", fondo: "#fee2e2" },
};
const textoAlerta = (a) => {
  const d = a.detalle || {};
  switch (a.tipo) {
    case "SIN_RUTA": return `${fmt(d.dias_sin_uso)} días sin uso · último viaje ${fch(d.ultimo_viaje)} · ${d.operacion || ""}`;
    case "APOYO_EXCESO": return `${fmt(d.viajes_mes)} viajes en el mes · ${d.operacion || ""}`;
    case "CORTAR_GPS": return `${fmt(d.dias_sin_uso)} días sin uso · dispositivo en ${d.gps_base || "—"}`;
    case "SACAR_SEGURO": return `${fmt(d.dias_sin_uso)} días sin uso · ${d.proveedor || ""} ${d.poliza || ""}`;
    case "GPS_MUDO": return `GPS sin comunicar hace ${fmt(d.gps_dias_sin_reportar)} días · ${fmt(d.viajes_30d)} viajes en 30 días`;
    case "COBERTURA_CRITICA": return `${d.tipo || ""} ${d.estado && d.estado !== "ACTIVA" ? "(" + d.estado + ") " : ""}· ${fmt(d.viajes_30d)} viajes en 30 días · falta ${[d.falta_gps ? "GPS" : null, d.falta_seguro ? (d.seguro_vencido ? "seguro (vencido)" : "seguro") : null].filter(Boolean).join(" y ")} · ${d.operacion || ""}`;
    default: return "";
  }
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

const COLS_BANDEJA = (u) => [
  { titulo: "Patente", campo: "patente" }, { titulo: "Estado", campo: "estado" }, { titulo: "Tipo", campo: "tipo" },
  { titulo: "Operación", campo: "operacion" }, { titulo: "Tercero", campo: "tercero" },
  { titulo: "Marca / modelo", valor: f => [f.marca, f.modelo].filter(Boolean).join(" ") },
  { titulo: "Viajes 30 días", campo: "viajes_30d" }, { titulo: "Viajes en el mes", campo: "viajes_mes" },
  { titulo: "Último viaje", campo: "ultimo_viaje" }, { titulo: "Días sin uso", valor: f => diasUso(f) ?? "sin señal" },
  { titulo: "Falta GPS", campo: "falta_gps" }, { titulo: "Falta seguro", campo: "falta_seguro" },
  { titulo: "GPS activo en Geotab", campo: "gps_activo" }, { titulo: "Base Geotab", campo: "gps_base" },
  { titulo: "ID dispositivo", campo: "gps_dispositivo" }, { titulo: "Última comunicación GPS", valor: f => fchHora(f.gps_ultima_comunicacion) },
  { titulo: "Seguro de carga", campo: "seg_carga" }, { titulo: "Proveedor seguro", campo: "seg_carga_proveedor" },
  { titulo: "Póliza", campo: "seg_carga_poliza" }, { titulo: "Vence seguro", campo: "seg_carga_vence" }, { titulo: "Fuente seguro carga", valor: f => f.seg_carga_fuente === "EXCEL" ? "Excel (*)" : f.seg_carga_fuente || "" },
  { titulo: "Seguro de vehículo", campo: "seg_veh" }, { titulo: "Póliza vehículo", campo: "seg_veh_poliza" }, { titulo: "Vence seguro vehículo", campo: "seg_veh_vence" },
  { titulo: "Fuente seguro vehículo", valor: f => f.seg_veh_fuente === "EXCEL" ? "Excel (*)" : f.seg_veh_fuente || "" },
  { titulo: "Motivo", valor: f => motivos(f, u).join(" | ") },
];
const COLS_DETALLE = [
  { titulo: "PATENTE", campo: "patente" }, { titulo: "ESTADO", campo: "estado" }, { titulo: "TIPO", campo: "tipo" },
  { titulo: "OPERACION", campo: "operacion" }, { titulo: "TERCERO", campo: "tercero" }, { titulo: "MARCA", campo: "marca" },
  { titulo: "MODELO", campo: "modelo" }, { titulo: "ULTIMO_VIAJE", campo: "ultimo_viaje" }, { titulo: "DIAS_SIN_VIAJE", campo: "dias_sin_viaje" },
  { titulo: "VIAJES_30D", campo: "viajes_30d" }, { titulo: "VIAJES_MES", campo: "viajes_mes" }, { titulo: "GPS_NOMINA", campo: "gps_nomina" },
  { titulo: "GPS_ACTIVO_GEOTAB", campo: "gps_activo" }, { titulo: "GPS_BASE", campo: "gps_base" }, { titulo: "GPS_ULTIMA_COMUNICACION", campo: "gps_ultima_comunicacion" },
  { titulo: "GPS_DIAS_SIN_REPORTAR", campo: "gps_dias_sin_reportar" }, { titulo: "SEGURO_CARGA", campo: "seg_carga" }, { titulo: "SEGURO_PROVEEDOR", campo: "seg_carga_proveedor" }, { titulo: "SEGURO_CARGA_FUENTE", campo: "seg_carga_fuente" },
  { titulo: "SEGURO_VEHICULO", campo: "seg_veh" }, { titulo: "SEGURO_VEHICULO_POLIZA", campo: "seg_veh_poliza" }, { titulo: "SEGURO_VEHICULO_VENCE", campo: "seg_veh_vence" }, { titulo: "SEGURO_VEHICULO_FUENTE", campo: "seg_veh_fuente" },
  { titulo: "SEGURO_POLIZA", campo: "seg_carga_poliza" }, { titulo: "SEGURO_VENCE", campo: "seg_carga_vence" },
  { titulo: "DIAS_SIN_USO", valor: f => diasUso(f) ?? "sin señal" }, { titulo: "BANDEJA", valor: f => BANDEJAS.find(b => b.id === bandejaDe(f))?.titulo || "" },
  { titulo: "MOTIVO_MAESTRO", campo: "nomina_desactualizada" },
  { titulo: "TRABAJA_SIN_COBERTURA", campo: "cobertura_critica" }, { titulo: "FALTA_GPS", campo: "falta_gps" }, { titulo: "FALTA_SEGURO", campo: "falta_seguro" }, { titulo: "SIN_FILA_GPS_SEGUROS", campo: "sin_hoja_gps" }, { titulo: "FUGA_MENSUAL", campo: "fuga_mensual" }, { titulo: "FUGA_ACUMULADA", campo: "fuga_acumulada" },
];

// ── Lectura del Excel "Maestro de Certificación" ──────────────────────────
// Formato definitivo acordado con Certificación. Se cargan 4 hojas con TODAS sus filas (la historia de
// cada patente o empresa se conserva; las vistas eligen la fila vigente). Reglas de limpieza:
//   · patente sin guiones/espacios · RUT sin puntos (0 → vacío) · tabulaciones y espacios de más fuera
//   · estado: IANACTIVA/INCTIVA → INACTIVA, PROCESO BAJA → PROCESO DE BAJA, SIN RUTAS → ACTIVA (el Brain
//     calcula el uso solo); el valor original queda en estado_original
//   · servicio "-" → UM · ¿Tiene GPS? solo SI/NO (vacío = no informado) · ID GPS "NO" → vacío
//   · proveedor de seguro con un número (fecha corrida) → vacío · fechas de serie Excel → fecha
const normCab = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[¿?]/g, "")
  .replace(/[\t\u00a0]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const esVacio = (v) => v === null || v === undefined ||
  ["", "-", "NAT", "NAN", "N/A", "#N/A", "#VALUE!"].includes(String(v).replace(/\u00a0/g, "").trim().toUpperCase());
const limpio = (v, mayus = true) => {
  if (esVacio(v)) return null;
  const t = String(v).replace(/[\t\u00a0]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return mayus ? t.toUpperCase() : t;
};
const patenteX = (v) => esVacio(v) ? null : String(v).toUpperCase().replace(/[-\s\u00a0]/g, "");
const rutX = (v) => { if (esVacio(v)) return null; const r = String(v).toUpperCase().replace(/[.\s\u00a0]/g, ""); return ["0", "0.0"].includes(r) ? null : r; };
const fechaX = (v) => {
  if (esVacio(v)) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const n = Number(v);
  if (!isNaN(n)) return (n > 30000 && n < 80000) ? new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10) : null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  const d = String(v).match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : null;
};
const numX = (v) => { if (esVacio(v)) return null; const n = Number(v); return isNaN(n) ? null : Math.round(n * 10000) / 10000; };
const anioX = (v) => { const k = parseInt(v, 10); return k >= 1950 && k <= 2030 ? k : null; };
const siNo = (v) => { const t = limpio(v); return t === "SI" || t === "NO" ? t : null; };
const estadoX = (v) => {
  const t = limpio(v);
  if (t === "IANACTIVA" || t === "INCTIVA") return "INACTIVA";
  if (t === "PROCESO BAJA") return "PROCESO DE BAJA";
  if (t === "SIN RUTAS") return "ACTIVA";
  return t;
};

// Hoja → tabla, con la columna que identifica la fila de encabezados y el mapeo columna → campo.
const HOJAS_MAESTRO = [
  { hoja: "VEHICULOS", tabla: "cert_vehiculos", clave: "PATENTE", obligatoria: "patente", cols: {
      "PATENTE": ["patente", patenteX], "NOMBRE TERCERO": ["tercero", limpio], "RUT TERCERO": ["rut_tercero", rutX],
      "SERVICIO": ["servicio", v => String(v ?? "").trim() === "-" ? "UM" : limpio(v)], "CECO": ["ceco", limpio],
      "ESTADO": ["estado", estadoX], "TIPO": ["tipo", limpio], "PROYECTO": ["proyecto", limpio], "DUENO VEHICULO": ["dueno", limpio],
      "FECHA ALTA": ["fecha_alta", fechaX], "FECHA BAJA": ["fecha_baja", fechaX], "TIPO VEHICULO": ["tipo_vehiculo", limpio],
      "TIPO DE ENERGIA": ["tipo_energia", limpio], "MARCA": ["marca", limpio], "MODELO": ["modelo", limpio], "ANO": ["anio", anioX],
      "CHASIS O VIN": ["vin", limpio], "MOTOR": ["motor", limpio], "REVISION TECNICA": ["doc_rev_tecnica", limpio],
      "PADRON O INSCRIPCION": ["doc_padron", limpio], "GASES": ["doc_gases", limpio], "SOAP": ["doc_soap", limpio],
      "PERMISO DE CIRCULACION": ["doc_permiso", limpio], "CERTIFICACION": ["certificacion", numX],
      "OBSERVACION": ["observacion", v => limpio(v, false)] },
    extra: (raw, o) => { o.estado_original = limpio(raw["ESTADO"]); } },
  { hoja: "GPS Y SEGUROS", tabla: "cert_gps_seguros", clave: "PATENTE", obligatoria: "patente", cols: {
      "PATENTE": ["patente", patenteX], "TERCERO": ["tercero", limpio], "CERTIFICACION": ["certificacion", limpio],
      "ESTADO": ["estado", estadoX], "TIENE GPS": ["gps", siNo], "ESTADO GPS": ["gps_estado", limpio],
      "PROVEEDOR GPS": ["gps_proveedor", limpio], "FECHA DE INSTALACION GPS": ["gps_instalado_el", fechaX],
      "ID DISPOSITIVO GPS": ["gps_dispositivo", v => { const t = limpio(v); return t === "NO" ? null : t; }],
      "FECHA DESINTALACION GPS": ["gps_desinstalado_el", fechaX], "TIENE SEGURO CARGA": ["seg_carga", siNo],
      "ESTADO SEGURO": ["seg_carga_estado", limpio],
      "PROVEEDOR SEGURO CARGA": ["seg_carga_proveedor", v => { const t = limpio(v); return t && /^\d{5}(\.0)?$/.test(t) ? null : t; }],
      "FECHA INCLUSION SEGURO CARGA": ["seg_carga_desde", fechaX], "POLIZA SEGURO CARGA": ["seg_carga_poliza", limpio],
      "FECHA VENCIMIENTO SEGURO CARGA": ["seg_carga_vence", fechaX], "TIENE SEGURO VEHICULO": ["seg_veh", siNo],
      "PROVEEDOR SEGURO VEHICULO": ["seg_veh_proveedor", limpio], "FECHA INCLUSION SEGURO VEHICULO": ["seg_veh_desde", fechaX],
      "POLIZA SEGURO VEHICULOS": ["seg_veh_poliza", limpio], "FECHA VENCIMIENTO SEGURO VEHICULO": ["seg_veh_vence", fechaX],
      "FECHA DE ALTA": ["fecha_alta", fechaX], "FECHA DE BAJA CERTRONIC": ["fecha_baja_certronic", fechaX] } },
  { hoja: "ESPORADICOS", tabla: "cert_esporadicos", clave: "PATENTE", obligatoria: null, cols: {
      "NOMBRE EMPRESA": ["empresa", limpio], "RUT": ["rut_empresa", rutX], "OPERACION": ["operacion", limpio],
      "CERTIFICACION EMPRESA": ["certificacion_empresa", limpio], "ESTADO": ["estado", estadoX], "PERIODO CYBER": ["periodo", fechaX],
      "FECHA DE ALTA": ["fecha_alta", fechaX], "FECHA DE CERTIFICACION": ["fecha_certificacion", fechaX],
      "ENTRADA": ["entrada", fechaX], "SALIDA": ["salida", fechaX], "CHOFER": ["chofer", limpio], "RUT CHOFER": ["rut_chofer", rutX],
      "PATENTE": ["patente", patenteX], "CERTIFICACION": ["certificacion", numX] } },
  { hoja: "MAESTRO EMPRESA", tabla: "cert_empresas", clave: "RUT", obligatoria: null, cols: {
      "RUT": ["rut", rutX], "EMPRESA": ["empresa", limpio], "CECO": ["ceco", limpio], "CORREO": ["correo", v => limpio(v, false)],
      "TIPO": ["tipo", limpio], "ESTADO": ["estado", estadoX], "TIPO CERTIFICACION": ["tipo_certificacion", limpio],
      "ALTA CERTRONIC": ["alta_certronic", fechaX], "INICIO OPERACION": ["inicio_operacion", fechaX],
      "SOLICITUD DE BAJA": ["solicitud_baja", fechaX], "BAJA CERTRONIC": ["baja_certronic", fechaX],
      "CERTIFICACION": ["certificacion", numX] },
    descartar: (o) => !o.rut && !o.empresa },
];

async function leerMaestro(archivo) {
  const XLSX = await cargarSheetJS();
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: "array" });
  const avisos = []; const resultado = [];
  for (const def of HOJAS_MAESTRO) {
    const nombre = wb.SheetNames.find(h => normCab(h) === def.hoja);
    if (!nombre) throw new Error(`Falta la hoja "${def.hoja}". El Excel debe mantener el formato del Maestro de Certificación.`);
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
    const iCab = matriz.findIndex(f => (f || []).some(c => normCab(c) === def.clave));
    if (iCab < 0) throw new Error(`En la hoja "${nombre}" no encontré la fila de títulos (columna ${def.clave}).`);
    const cab = matriz[iCab].map(normCab);
    const idx = {}; cab.forEach((c, i) => { if (def.cols[c] && idx[c] === undefined) idx[c] = i; });
    const faltan = Object.keys(def.cols).filter(c => idx[c] === undefined);
    if (faltan.length) avisos.push(`${nombre}: faltan las columnas ${faltan.join(", ")} (quedan vacías)`);
    const filas = [];
    matriz.slice(iCab + 1).forEach((fila, k) => {
      if (!fila || fila.every(x => esVacio(x))) return;
      const raw = {}; Object.entries(idx).forEach(([c, i]) => { raw[c] = fila[i]; });
      const o = { fila: iCab + 2 + k };
      for (const [c, [campo, fn]] of Object.entries(def.cols)) o[campo] = idx[c] === undefined ? null : fn(raw[c]);
      if (def.extra) def.extra(raw, o);
      if (def.obligatoria && !o[def.obligatoria]) return;
      if (def.descartar && def.descartar(o)) return;
      filas.push(o);
    });
    resultado.push({ hoja: nombre, tabla: def.tabla, filas });
  }
  const veh = resultado.find(r => r.tabla === "cert_vehiculos").filas;
  const patentes = new Set(veh.map(f => f.patente));
  return {
    hojas: resultado, avisos,
    resumen: {
      patentes: patentes.size,
      activas: new Set(veh.filter(f => f.estado === "ACTIVA").map(f => f.patente)).size,
      conHistoria: veh.length - patentes.size,
    },
  };
}

// ── PDF de una póliza guardado en Storage (bucket privado bci-polizas): enlace firmado por 1 hora ──
async function abrirPdf(ruta) {
  const ventana = window.open("", "_blank");   // se abre antes para que el navegador no la bloquee
  try {
    const r = await fetch(`${CL_URL}/storage/v1/object/sign/bci-polizas/${encodeURIComponent(ruta)}`, {
      method: "POST", headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const j = await r.json();
    if (!r.ok || !j.signedURL) throw new Error(j.message || `HTTP ${r.status}`);
    ventana.location.href = `${CL_URL}/storage/v1${j.signedURL}`;
  } catch (e) { ventana.close(); alert("No se pudo abrir el PDF: " + e.message); }
}

// ── Ficha de una póliza BCI (datos extraídos del portal de BCI Seguros) ──────
function FichaPoliza({ poliza, extraccion, enFlota, pdf, onClose }) {
  const [p, setP] = useState(null); const [items, setItems] = useState([]); const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const q = `extraccion_id=eq.${extraccion.id}&poliza=eq.${encodeURIComponent(poliza)}`;
        const [pp, it] = await Promise.all([api(`bci_polizas?${q}&select=*`), api(`bci_items?${q}&order=item`)]);
        setP(pp[0] || null); setItems(it || []);
      } catch (e) { setErr(e.message); }
    })();
  }, [poliza]);
  const det = p?.detalle || {};
  const cob = det.listaCoberturas || [], pagos = det.listaPago || [], sin = det.listaSiniestros || [];
  const caja = { background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "10px 14px", marginBottom: 10 };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px", overflow: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#f4f6f9", borderRadius: 12, width: "min(1000px, 100%)", padding: 16, boxShadow: "0 20px 50px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>Póliza {poliza}</div>
            <div style={{ fontSize: 12, color: GRIS_ }}>{p?.ramo || ""}{p?.convenio ? ` · ${p.convenio}` : ""} · datos de BCI Seguros extraídos el {fchHora(extraccion.extraido_at)}</div>
          </div>
          <button className="mj-btn" onClick={onClose}>Cerrar</button>
        </div>
        {err && <div style={{ color: ROJO_, fontSize: 12 }}>{err}</div>}
        {!p && !err && <div style={{ color: GRIS_, fontSize: 13 }}>Cargando póliza…</div>}
        {p && (
          <Fragment>
            <div style={{ ...caja, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", fontSize: 12.5 }}>
              <div><div style={{ color: GRIS_, fontSize: 11 }}>Vigencia</div><strong>{fch(p.vigencia_desde)} → {fch(p.vigencia_hasta)}</strong></div>
              <div><div style={{ color: GRIS_, fontSize: 11 }}>Vehículos cubiertos</div><strong>{fmt(items.length)}</strong>{p.items && p.items !== items.length ? <span style={{ color: GRIS_ }}> (BCI informa {fmt(p.items)} ítems)</span> : null}</div>
              <div><div style={{ color: GRIS_, fontSize: 11 }}>Prima neta / bruta</div><strong>{p.prima_neta} / {p.prima_bruta} {p.moneda}</strong></div>
              <div><div style={{ color: GRIS_, fontSize: 11 }}>Monto asegurado</div><strong>{fmt(p.monto_asegurado)} {p.moneda}</strong></div>
              <div><div style={{ color: GRIS_, fontSize: 11 }}>Corredor</div><strong>{p.corredor || "—"}</strong>{p.comision != null ? ` · ${p.comision}%` : ""}</div>
              <div><div style={{ color: GRIS_, fontSize: 11 }}>Documento</div>
                {pdf ? <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => abrirPdf(pdf.ruta)}>Ver PDF de la póliza</button>
                     : <a href="https://portalclientes.bciseguros.cl/login" target="_blank" rel="noreferrer">PDF no disponible · ver en el portal BCI</a>}
                {pdf && <div style={{ fontSize: 10.5, color: GRIS_, marginTop: 2 }}>guardado el {fchHora(pdf.subido_at)}</div>}</div>
            </div>
            <div style={caja}>
              <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Vehículos cubiertos</div>
              <div className="mj-scroll" style={{ maxHeight: 320 }}>
                <table className="mj-tabla">
                  <thead><tr><th className="num">Ítem</th><th>Patente</th><th>Marca</th><th>Modelo</th><th className="num">Año</th><th>Motor</th><th>Chasis</th><th>En la flota (Maestro)</th></tr></thead>
                  <tbody>
                    {items.map(i => {
                      const f = enFlota[i.patente];
                      return (
                        <tr key={i.item}>
                          <td className="num">{i.item}</td><td style={{ fontWeight: 700 }}>{i.patente}</td><td>{i.marca || "—"}</td><td>{i.modelo || "—"}</td>
                          <td className="num">{i.anio || "—"}</td><td>{i.motor || "—"}</td><td>{i.chasis || "—"}</td>
                          <td>{f ? <span>{f.tipo || "—"} · <span style={{ color: f.estado === "ACTIVA" ? VERDE_ : ROJO_ }}>{f.estado || "—"}</span> · {fmt(f.viajes_30d)} viajes 30d</span>
                                 : <Etiqueta texto="No está en el Maestro" color={ROJO_} fondo="#fdecec" />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
              <div style={caja}>
                <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Coberturas {det.cantToRegCobertura ? <span style={{ fontSize: 11, color: GRIS_, fontWeight: 400 }}>(muestra de {cob.length}; BCI informa {det.cantToRegCobertura} registros)</span> : null}</div>
                <table className="mj-tabla"><thead><tr><th>Ítem</th><th>Cobertura</th><th className="num">Monto</th><th className="num">Prima</th></tr></thead>
                  <tbody>{cob.map((c, k) => <tr key={k}><td>{c.numeroItem}</td><td>{c.descripcionCobertura}</td><td className="num">{c.montoAsegurado}</td><td className="num">{c.primaNeta}</td></tr>)}</tbody></table>
              </div>
              <div style={caja}>
                <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 6 }}>Cuotas</div>
                <table className="mj-tabla"><thead><tr><th>N°</th><th>Vence</th><th className="num">Monto</th><th>Estado</th></tr></thead>
                  <tbody>{pagos.map((c, k) => <tr key={k}><td>{c.nCuota}</td><td>{c.fechaVencimiento}</td><td className="num">{c.montoCuota} {c.moneda}</td>
                    <td style={{ color: c.estado === "PAGADA" ? VERDE_ : AMBAR_ }}>{c.estado}</td></tr>)}</tbody></table>
                <div style={{ fontSize: 12, marginTop: 8 }}><strong>Siniestros:</strong> {sin.length ? `${sin.length} registrados` : "ninguno registrado"}</div>
              </div>
            </div>
          </Fragment>
        )}
      </div>
    </div>
  );
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
  const [bandeja, setBandeja] = useState("critica");
  const [semaforo, setSemaforo] = useState([]);
  const [fueraNomina, setFueraNomina] = useState([]);
  const [certronic, setCertronic] = useState({});       // patente -> última foto en Certronic
  const [fCertronic, setFCertronic] = useState("");
  const [fSc, setFSc] = useState("");
  const [alertas, setAlertas] = useState([]);
  const [cerradas, setCerradas] = useState(null);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargas, setCargas] = useState([]);
  const [config, setConfig] = useState([]);
  const [historialCfg, setHistorialCfg] = useState([]);
  const [geotabFecha, setGeotabFecha] = useState(null);
  const [bciExt, setBciExt] = useState(null);         // última extracción exitosa del portal BCI
  const [bciPolizas, setBciPolizas] = useState([]);
  const [bciPdfs, setBciPdfs] = useState({});          // poliza -> { ruta, bytes, subido_at }
  const [ficha, setFicha] = useState(null);           // póliza BCI abierta en la ficha
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busca, setBusca] = useState("");
  const [fOp, setFOp] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fDetalle, setFDetalle] = useState("");
  const [fSub, setFSub] = useState("");             // subcategoría dentro de la bandeja crítica o de datos a corregir     // "" | "gps" | "seguro" (lo fijan las tarjetas del resumen)
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
    const [sem, ale, sol, car, cfg, hcf, geo, fn] = await Promise.all([
      apiSuave("vw_flota_semaforo?order=patente&limit=3000", [], fallos),
      apiSuave("flota_alertas?estado=eq.abierta&order=abierta_el.desc,tipo,patente&limit=3000", [], fallos),
      apiSuave("flota_solicitudes?order=pedida_el.desc&limit=1000", [], fallos),
      apiSuave("flota_cl_cargas?order=id.desc&limit=30", [], fallos),
      apiSuave("flota_config?order=clave", [], fallos),
      apiSuave("flota_config_historial?order=cambiado_el.desc&limit=50", [], fallos),
      apiSuave("geotab_lecturas?select=fecha&order=fecha.desc&limit=1", [], fallos),
      apiSuave("vw_flota_ruta_fuera_nomina?order=viajes_30d.desc&limit=1000", [], fallos),
    ]);
    setFueraNomina(fn);
    // Certronic vive en el proyecto principal: se consulta solo por las patentes que hacen falta.
    if (fn.length) {
      try {
        const { data, error } = await sb.from("vw_certronic_vehiculo_ultimo")
          .select("patente,contratista,tipo_certificacion,ultima_foto,vigente")
          .in("patente", fn.map(x => x.patente));
        if (error) throw error;
        setCertronic(Object.fromEntries((data || []).map(c => [c.patente, c])));
      } catch (e) { fallos.push("Certronic: " + (e.message || e)); }
    }
    setSemaforo(sem); setAlertas(ale); setSolicitudes(sol); setCargas(car); setConfig(cfg); setHistorialCfg(hcf);
    setGeotabFecha(geo[0]?.fecha || null);
    const ext = (await apiSuave("bci_extracciones?ok=eq.true&order=id.desc&limit=1", [], fallos))[0] || null;
    setBciExt(ext);
    setBciPdfs(Object.fromEntries((await apiSuave("bci_pdfs?select=poliza,ruta,bytes,subido_at", [], fallos)).map(x => [x.poliza, x])));
    if (ext) setBciPolizas(await apiSuave(`bci_polizas?extraccion_id=eq.${ext.id}&select=poliza,ramo,convenio,vigencia_desde,vigencia_hasta,items,prima_neta,moneda&order=ramo,poliza`, [], fallos));
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
    porBandeja: { ...Object.fromEntries(BANDEJAS.map(b => [b.id, semaforo.filter(f => bandejaDe(f) === b.id).length])),
                  registro: fueraNomina.length },
    solPend: solicitudes.filter(s => s.estado === "pendiente").length,
  }), [semaforo, solicitudes, fueraNomina]);
  const sinCostos = !n(u.costo_gps_mensual) && !n(u.costo_seguro_mensual);
  const cargaVigente = cargas.find(c => c.origen === "maestro") || null;

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
    .filter(f => bandejaDe(f) === bandeja && filtrar(f) &&
      (!fSub || (bandeja === "critica" ? subCritica(f) === fSub : bandeja === "nomina" ? subNomina(f) === fSub : true)))
    .sort((a, b) => n(b.fuga_acumulada) - n(a.fuga_acumulada) || (diasUso(b) ?? -1) - (diasUso(a) ?? -1)),
    [semaforo, bandeja, busca, fOp, fTipo, fSub]);
  const detalle = useMemo(() => semaforo.filter(f => filtrar(f) &&
    (!fDetalle || (fDetalle === "gps" ? f.gps_activo : f.seg_carga === "SI"))), [semaforo, busca, fOp, fTipo, fDetalle]);
  // Navegación desde las tarjetas: limpia los filtros para que la lista coincida con el número de la tarjeta.
  const irA = ({ vista: vv, bandeja: bb, detalle: dd = "", sub = "" }) => {
    setFSub(sub);
    setBusca(""); setFOp(""); setFTipo(""); setFSc(""); setFCertronic(""); setFTipoAlerta("");
    setVerCerradas(false); setVerSolCerradas(false); setAbierta(null); setFDetalle(dd);
    if (bb) setBandeja(bb);
    setVista(vv);
  };
  const scsRegistro = useMemo(() => {
    const m = {};
    for (const r of fueraNomina) for (const sc of String(r.cecos || "—").split(",").map(x => x.trim())) m[sc] = (m[sc] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [fueraNomina]);
  const enRegistro = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return fueraNomina.filter(r =>
      (!fSc || String(r.cecos || "").split(",").map(x => x.trim()).includes(fSc)) &&
      (!fCertronic || estadoCertronic(certronic[r.patente]) === fCertronic) &&
      (!q || r.patente.includes(q) || String(certronic[r.patente]?.contratista || "").toUpperCase().includes(q)));
  }, [fueraNomina, certronic, busca, fSc, fCertronic]);
  const porEstadoCertronic = useMemo(() => {
    const m = { vigente: 0, salio: 0, nunca: 0 };
    for (const r of fueraNomina) m[estadoCertronic(certronic[r.patente])]++;
    return m;
  }, [fueraNomina, certronic]);
  const COLS_REGISTRO = [
    { titulo: "PATENTE", campo: "patente" }, { titulo: "SC", campo: "cecos" }, { titulo: "VIAJES_30D", campo: "viajes_30d" },
    { titulo: "VIAJES_MES", campo: "viajes_mes" }, { titulo: "ULTIMO_VIAJE", campo: "ultimo_viaje" },
    { titulo: "GPS_ACTIVO", valor: r => r.gps_activo ? "SI" : "NO" }, { titulo: "GPS_BASE", campo: "gps_base" },
    { titulo: "CERTRONIC", valor: r => ESTADO_CERTRONIC[estadoCertronic(certronic[r.patente])].rotulo },
    { titulo: "CONTRATISTA", valor: r => certronic[r.patente]?.contratista || "" },
    { titulo: "TIPO_CERTIFICACION", valor: r => certronic[r.patente]?.tipo_certificacion || "" },
    { titulo: "ULTIMA_FOTO_CERTRONIC", valor: r => certronic[r.patente]?.ultima_foto || "" },
  ];

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
    try { setPrevia(await leerMaestro(f)); }
    catch (e) { setError("No se pudo leer el Excel: " + e.message); }
  };
  // La carga se registra como "maestro_pendiente" y solo pasa a "maestro" cuando entraron todas las hojas:
  // así, si algo falla a medio camino, el Brain sigue mostrando la carga anterior completa.
  const importar = async () => {
    if (!previa) return;
    setImportando(true); setError("");
    try {
      const hojas = Object.fromEntries(previa.hojas.map(h => [h.hoja, h.filas.length]));
      const carga = await api("flota_cl_cargas", { method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ cargado_por: usuarioActual(), archivo: archivo?.name || null, filas: previa.resumen.patentes,
          origen: "maestro_pendiente", hojas, observacion: "Carga del Maestro de Certificación desde el Brain" }) });
      const cargaId = (Array.isArray(carga) ? carga[0] : carga)?.id;
      if (!cargaId) throw new Error("No se pudo registrar la carga.");
      for (const h of previa.hojas) {
        for (let i = 0; i < h.filas.length; i += 250) {
          const lote = h.filas.slice(i, i + 250).map(r => ({ ...r, carga_id: cargaId }));
          await api(h.tabla, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(lote) });
        }
      }
      await api(`flota_cl_cargas?id=eq.${cargaId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ origen: "maestro" }) });
      setArchivo(null); setPrevia(null);
      await cargarTodo();
      avisar(`Maestro cargado: ${fmt(previa.resumen.patentes)} patentes (carga #${cargaId}). El semáforo y las bandejas ya usan estos datos.`);
    } catch (e) { setError("La carga falló y no se aplicó (sigue vigente la anterior): " + e.message); }
    finally { setImportando(false); }
  };

  // ── Seguro de carga / vehículo: BCI con enlace a su ficha; otros proveedores con * (solo Excel) ──
  const seguroCelda = (f, tipo) => {
    const tiene = tipo === "carga" ? f.seg_carga : f.seg_veh;
    const fuente = tipo === "carga" ? f.seg_carga_fuente : f.seg_veh_fuente;
    const pol = tipo === "carga" ? f.seg_carga_poliza : f.seg_veh_poliza;
    const vence = tipo === "carga" ? f.seg_carga_vence : f.seg_veh_vence;
    const prov = tipo === "carga" ? f.seg_carga_proveedor : f.seg_veh_proveedor;
    if (fuente === "BCI" && tiene === "SI")
      return <span>BCI · <a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); setFicha(pol); }} style={{ color: "#1F4E9E", fontWeight: 700 }}>{pol}</a> · vence {fch(vence)}</span>;
    if (fuente === "BCI") return <span style={{ color: ROJO_ }}>Sin seguro (no está en BCI)</span>;
    if (tiene) return <span title="Dato del Maestro de Certificación (Excel), no verificado con la aseguradora">{tiene === "SI" ? `${prov || "SI"}${pol ? " · " + pol : ""}${vence ? " · vence " + fch(vence) : ""}` : tiene} <strong style={{ color: AMBAR_ }}>*</strong></span>;
    return <span style={{ color: "#a8b2c1" }}>no informado</span>;
  };
  const enFlota = useMemo(() => Object.fromEntries(semaforo.map(f => [f.patente, f])), [semaforo]);

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
    ["bandejas", "Listas de trabajo"],
    ["alertas", `Alertas (${fmt(alertas.length)})`],
    ["solicitudes", `Solicitudes (${fmt(resumen.solPend)})`],
    ["detalle", "Detalle completo"],
    ["config", "Umbrales y carga del Maestro"],
  ];

  return (
    <Fragment>
      {/* Resumen */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: GRIS_ }}>
          Geotab al {fch(geotabFecha)} · BCI al {bciExt ? fchHora(bciExt.extraido_at) : "—"} · Maestro de Certificación: carga #{cargaVigente?.id || "—"} del {fch(cargaVigente?.cargado_at)}
          {" "}· <strong style={{ color: AMBAR_ }}>*</strong> = seguro informado solo en el Excel (no verificado con la aseguradora)
          {" "}· sin uso = sin ruta MELI <strong>y</strong> sin movimiento de GPS
        </div>
        <button className="mj-btn" onClick={recalcular} disabled={recalculando}>{recalculando ? "Recalculando…" : "Recalcular ahora"}</button>
      </div>
      {msg && <div style={{ background: "#e7f6ec", border: "1px solid #b7e1c4", borderRadius: 10, padding: "8px 14px", marginBottom: 10, fontSize: 12, color: VERDE_ }}>✓ {msg}</div>}
      {error && <div style={{ background: "#fff4f4", border: "1px solid #f2c9c9", borderRadius: 10, padding: "8px 14px", marginBottom: 10, fontSize: 12, color: "#7a2a22" }}>
        {error} <span style={{ cursor: "pointer", marginLeft: 8, fontWeight: 700 }} onClick={() => setError("")}>✕</span></div>}
      {cargando && <div style={{ color: GRIS_, fontSize: 13, padding: "12px 0" }}>Cargando la flota…</div>}

      {!cargando && (
        (() => {
          const cuenta = (fn) => semaforo.filter(fn).length;
          const crit = (id) => cuenta(f => f.cobertura_critica && subCritica(f) === id);
          const Fila = ({ num, texto, sub, color, onClick }) => (
            <div onClick={onClick} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 4px", cursor: "pointer", borderBottom: "1px solid #f1f4f8" }}
                 onMouseEnter={e => e.currentTarget.style.background = "#f7faff"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ fontSize: 20, fontWeight: 800, color, minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num}</span>
              <span style={{ fontSize: 12.5, color: "#1f2937", lineHeight: 1.35 }}>{texto}{sub && <span style={{ display: "block", fontSize: 11, color: GRIS_ }}>{sub}</span>}</span>
              <span style={{ marginLeft: "auto", color: GRIS_, fontSize: 13 }}>›</span>
            </div>
          );
          const Col = ({ titulo, color, children }) => (
            <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderTop: `4px solid ${color}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: .4, textTransform: "uppercase", marginBottom: 4 }}>{titulo}</div>
              {children}
            </div>
          );
          return (
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", marginBottom: 14 }}>
              <Col titulo="Urgente · riesgo" color="#991b1b">
                <div onClick={() => irA({ vista: "bandejas", bandeja: "critica" })}
                     style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 4px 8px", cursor: "pointer", borderBottom: "2px solid #fecaca", background: "#fff5f5", borderRadius: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: "#991b1b", minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(resumen.porBandeja.critica)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1f2937", lineHeight: 1.35 }}>trabajan sin la cobertura exigida
                    <span style={{ display: "block", fontSize: 11, fontWeight: 400, color: GRIS_ }}>hicieron ruta en 30 días y les falta GPS o seguro · se dividen así:</span></span>
                  <span style={{ marginLeft: "auto", color: GRIS_, fontSize: 13 }}>›</span>
                </div>
                <div style={{ paddingLeft: 18, borderLeft: "2px solid #fee2e2", marginLeft: 26 }}>
                  <Fila num={fmt(crit("nada"))} color="#991b1b" texto="sin GPS y sin seguro" onClick={() => irA({ vista: "bandejas", bandeja: "critica", sub: "nada" })} />
                  <Fila num={fmt(crit("gps_vencida"))} color="#991b1b" texto="sin GPS y con la póliza vencida" onClick={() => irA({ vista: "bandejas", bandeja: "critica", sub: "gps_vencida" })} />
                  <Fila num={fmt(crit("gps"))} color="#991b1b" texto="sin GPS (tienen seguro)" onClick={() => irA({ vista: "bandejas", bandeja: "critica", sub: "gps" })} />
                  <Fila num={fmt(crit("seguro"))} color="#991b1b" texto="sin seguro (tienen GPS)" onClick={() => irA({ vista: "bandejas", bandeja: "critica", sub: "seguro" })} />
                  <Fila num={fmt(crit("vencida"))} color={AMBAR_} texto="con la póliza vencida (tienen GPS)" sub="confirmar con Certificación si se renovó" onClick={() => irA({ vista: "bandejas", bandeja: "critica", sub: "vencida" })} />
                </div>
                <div style={{ marginTop: 8, paddingTop: 4, borderTop: "1px dashed #e6e9ef" }}>
                  <Fila num={fmt(fueraNomina.length)} color="#7c3aed" texto="además, trabajan sin estar registrados en el Maestro"
                        sub={`no se suman arriba porque no están en el Maestro · ${fmt(porEstadoCertronic.nunca)} nunca estuvieron en Certronic`}
                        onClick={() => irA({ vista: "bandejas", bandeja: "registro" })} />
                </div>
              </Col>
              <Col titulo="Ahorro y revisión" color={AMBAR_}>
                <Fila num={fmt(resumen.porBandeja.cortar)} color={ROJO_} texto="se pagan y no se usan (GPS o seguro)"
                      sub={sinCostos ? "pedir la baja · carga los costos en Umbrales para verlo en pesos" : `${clp(resumen.fugaMes)} al mes · ${clp(resumen.fugaAcum)} acumulado`}
                      onClick={() => irA({ vista: "bandejas", bandeja: "cortar" })} />
                <Fila num={fmt(resumen.porBandeja.revisar)} color={AMBAR_} texto="trabajan pero el GPS no transmite" sub="revisar la instalación" onClick={() => irA({ vista: "bandejas", bandeja: "revisar" })} />
                <Fila num={fmt(resumen.porBandeja.cobertura)} color={AZUL_} texto="de planta detenidos sin GPS o seguro" sub="no hicieron ruta en 30 días" onClick={() => irA({ vista: "bandejas", bandeja: "cobertura" })} />
                <Fila num={fmt(resumen.solPend)} color={AZUL_} texto="solicitudes de baja o revisión pendientes" onClick={() => irA({ vista: "solicitudes" })} />
              </Col>
              <Col titulo="Datos y seguimiento" color={GRIS_}>
                <Fila num={fmt(resumen.porBandeja.nomina)} color={GRIS_} texto="datos a corregir en el Maestro de Certificación" onClick={() => irA({ vista: "bandejas", bandeja: "nomina" })} />
                <Fila num={fmt(alertas.length)} color={NAVY} texto="alertas abiertas" sub="se abren y cierran solas cada día a las 07:00" onClick={() => irA({ vista: "alertas" })} />
                <Fila num={fmt(resumen.gpsActivos)} color={NAVY} texto="GPS activos en Geotab (se pagan)" onClick={() => irA({ vista: "detalle", detalle: "gps" })} />
                <Fila num={fmt(resumen.seguros)} color={NAVY} texto="vehículos con seguro de carga en el Maestro" onClick={() => irA({ vista: "detalle", detalle: "seguro" })} />
              </Col>
            </div>
          );
        })()
      )}

      {!cargando && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", borderBottom: "1px solid #e6e9ef", paddingBottom: 10 }}>
          {VISTAS.map(([id, t]) => <button key={id} className={`mj-chip ${vista === id ? "on" : ""}`} onClick={() => { if (id === "detalle") setFDetalle(""); setVista(id); }}>{t}</button>)}
        </div>
      )}

      {/* ── Bandejas ── */}
      {!cargando && vista === "bandejas" && (
        <Fragment>
          {(() => {
            const b = [...BANDEJAS, BANDEJA_REGISTRO].find(x => x.id === bandeja);
            const subs = bandeja === "critica" ? SUB_CRITICA : bandeja === "nomina" ? SUB_NOMINA : null;
            const subDe = bandeja === "critica" ? subCritica : subNomina;
            const base = semaforo.filter(f => bandejaDe(f) === bandeja);
            return (
              <Fragment>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {[...BANDEJAS, BANDEJA_REGISTRO].map(x => (
                    <button key={x.id} onClick={() => irA({ vista: "bandejas", bandeja: x.id })}
                      style={{ fontFamily: "inherit", cursor: "pointer", borderRadius: 20, padding: "5px 12px", fontSize: 12, fontWeight: 700,
                               border: `1px solid ${bandeja === x.id ? x.color : "#dfe4ec"}`, background: bandeja === x.id ? x.fondo : "#fff", color: bandeja === x.id ? x.color : "#475569" }}>
                      {x.titulo} <span style={{ marginLeft: 4 }}>{fmt(resumen.porBandeja[x.id])}</span>
                    </button>
                  ))}
                </div>
                <div style={{ background: b.fondo, border: `1px solid ${b.color}33`, borderRadius: 10, padding: "9px 14px", marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: b.color }}>{b.titulo} · {fmt(resumen.porBandeja[b.id])}</div>
                  <div style={{ fontSize: 12, color: "#334155", marginTop: 2 }}>{b.que}</div>
                  {subs && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      <button className={`mj-chip ${!fSub ? "on" : ""}`} onClick={() => setFSub("")}>Todos ({fmt(base.length)})</button>
                      {subs.map(x => {
                        const c = base.filter(f => subDe(f) === x.id).length;
                        return c ? <button key={x.id} className={`mj-chip ${fSub === x.id ? "on" : ""}`} onClick={() => setFSub(fSub === x.id ? "" : x.id)}>{x.rotulo} ({fmt(c)})</button> : null;
                      })}
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })()}
          {bandeja === "registro" ? (
            <Fragment>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                <input className="mj-input" style={{ minWidth: 220 }} value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar patente o contratista…" />
                {Object.entries(ESTADO_CERTRONIC).map(([k, v]) => (
                  <button key={k} title={v.que} className={`mj-chip ${fCertronic === k ? "on" : ""}`} onClick={() => setFCertronic(fCertronic === k ? "" : k)}>
                    {v.rotulo} ({fmt(porEstadoCertronic[k])})
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: GRIS_ }}>{fmt(enRegistro.length)} vehículos</span>
                <button className="mj-btn" onClick={() => descargarExcel(`opera_sin_registro_${hoyChile()}`, enRegistro, COLS_REGISTRO, "Opera sin registro")}>Descargar Excel</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontSize: 11.5, color: GRIS_, alignSelf: "center" }}>Por SC:</span>
                {scsRegistro.map(([sc, c]) => (
                  <button key={sc} className={`mj-chip ${fSc === sc ? "on" : ""}`} onClick={() => setFSc(fSc === sc ? "" : sc)}>{sc} ({c})</button>
                ))}
              </div>
              <div className="mj-scroll">
                <table className="mj-tabla">
                  <thead><tr><th>Patente</th><th>SC</th><th className="num">Viajes 30d</th><th className="num">Viajes mes</th><th>Último viaje</th><th>GPS</th><th>Certronic</th><th>Contratista</th><th>Tipo</th><th>Última foto</th></tr></thead>
                  <tbody>
                    {enRegistro.map(r => {
                      const c = certronic[r.patente]; const e = ESTADO_CERTRONIC[estadoCertronic(c)];
                      return (
                        <tr key={r.patente}>
                          <td style={{ fontWeight: 700 }}>{r.patente}</td>
                          <td>{r.cecos || "—"}</td>
                          <td className="num" style={{ fontWeight: n(r.viajes_30d) >= 8 ? 700 : 400 }}>{fmt(r.viajes_30d)}</td>
                          <td className="num">{fmt(r.viajes_mes)}</td>
                          <td>{fch(r.ultimo_viaje)}</td>
                          <td>{r.gps_activo ? `activo · ${r.gps_base}` : r.gps_base ? "de baja" : "—"}</td>
                          <td><Etiqueta texto={e.rotulo} color={e.color} fondo={e.fondo} /></td>
                          <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={c?.contratista || ""}>{c?.contratista || "—"}</td>
                          <td>{c?.tipo_certificacion || "—"}</td>
                          <td>{c ? fch(c.ultima_foto) : "—"}</td>
                        </tr>
                      );
                    })}
                    {enRegistro.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>Nada con esos filtros.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: GRIS_, marginTop: 8 }}>
                "Nunca en Certronic" se refiere a lo que trae el scraper de Certronic; confirma dos o tres casos con Certificación antes de tomarlo como regla.
              </div>
            </Fragment>
          ) : (
          <Fragment>
          {filtros(<Fragment>
            <span style={{ fontSize: 12, color: GRIS_ }}>{fmt(enBandeja.length)} vehículos</span>
            <button className="mj-btn" onClick={() => {
              const b = BANDEJAS.find(x => x.id === bandeja);
              descargarExcel(`${b.titulo.toLowerCase().replace(/\s+/g, "_")}_${hoyChile()}`, enBandeja.map(f => ({ ...f, _pend: (pendientes[f.patente] || []).map(x => TIPOS_SOLICITUD[x.tipo]).join(", ") })),
                [...COLS_BANDEJA(u), { titulo: "Solicitud pendiente", campo: "_pend" }], b.titulo);
            }}>Descargar Excel</button>
          </Fragment>)}
          {(() => {
            const usoCols = bandeja === "cortar" || bandeja === "revisar";
            return (
            <div className="mj-scroll">
              <table className="mj-tabla">
                <thead><tr>
                  <th>Patente</th><th>Tipo · estado</th><th>Operación</th><th>Tercero</th>
                  {usoCols ? <Fragment><th className="num">Días sin ruta ni GPS</th><th className="num">Días GPS sin transmitir</th></Fragment>
                           : <Fragment><th className="num">Viajes 30 días</th><th>Último viaje</th></Fragment>}
                  <th>Qué pasa</th><th>Se paga</th><th></th>
                </tr></thead>
                <tbody>
                  {enBandeja.map(f => {
                    const pend = pendientes[f.patente] || [];
                    const du = diasUso(f);
                    const chips = [
                      f.falta_gps && f.cobertura_critica ? ["Falta GPS", "#991b1b", "#fee2e2"] : null,
                      f.cobertura_critica && f.seg_carga !== "SI" ? ["Falta seguro", "#991b1b", "#fee2e2"] : null,
                      f.seguro_vencido ? ["Póliza vencida", AMBAR_, "#fff6dc"] : null,
                      f.cortar_gps ? ["Cortar GPS", ROJO_, "#fdecec"] : null,
                      f.sacar_seguro ? ["Sacar del seguro", ROJO_, "#fdecec"] : null,
                      f.gps_mudo ? ["GPS mudo", AMBAR_, "#fff6dc"] : null,
                      bandeja === "cobertura" && f.activa_sin_gps ? ["Sin GPS", AZUL_, "#eaf1ff"] : null,
                      bandeja === "cobertura" && f.activa_sin_seguro ? ["Sin seguro", AZUL_, "#eaf1ff"] : null,
                      bandeja === "nomina" ? [SUB_NOMINA.find(x => x.id === subNomina(f))?.rotulo, GRIS_, "#f1f5f9"] : null,
                    ].filter(Boolean);
                    return (
                      <Fragment key={f.patente}>
                        <tr style={{ cursor: "pointer", background: abierta === f.patente ? "#f7faff" : undefined }} onClick={() => setAbierta(abierta === f.patente ? null : f.patente)}>
                          <td style={{ fontWeight: 800, color: NAVY }}>{f.patente}</td>
                          <td>{f.tipo || "—"}<span style={{ color: f.estado === "ACTIVA" ? GRIS_ : ROJO_ }}>{" · "}{f.estado || "fuera del Maestro"}</span></td>
                          <td>{f.operacion || "—"}</td>
                          <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={f.tercero || ""}>{f.tercero || "—"}</td>
                          {usoCols ? <Fragment>
                              <td className="num" style={{ fontWeight: 700, color: du !== null && du >= 30 ? ROJO_ : undefined }}>{du === null ? "—" : fmt(du)}</td>
                              <td className="num">{f.gps_dias_sin_reportar ?? "—"}</td>
                            </Fragment> : <Fragment>
                              <td className="num" style={{ fontWeight: 700 }}>{fmt(f.viajes_30d)}</td>
                              <td>{f.ultimo_viaje ? `${fch(f.ultimo_viaje)} (hace ${fmt(f.dias_sin_viaje)} d)` : "sin viajes"}</td>
                            </Fragment>}
                          <td><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {chips.map(([t, c, fo], i) => <Etiqueta key={i} texto={t} color={c} fondo={fo} />)}
                            {pend.map(x => <Etiqueta key={x.id} texto={`${TIPOS_SOLICITUD[x.tipo]} pedida`} color={AZUL_} fondo="#eaf1ff" />)}
                          </div></td>
                          <td style={{ color: "#475569" }}>{n(f.fuga_mensual) ? clp(f.fuga_mensual) + "/mes" : ([f.gps_activo ? "GPS" : null, f.seg_carga === "SI" ? "seguro" : null].filter(Boolean).join(" + ") || "nada")}</td>
                          <td style={{ color: GRIS_ }}>{abierta === f.patente ? "▾" : "▸"}</td>
                        </tr>
                        {abierta === f.patente && (
                          <tr><td colSpan={9} style={{ whiteSpace: "normal", background: "#fbfcfe" }}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 8px" }}>
                              {motivos(f, u).map((m, i) => <span key={i} style={{ fontSize: 11.5, color: "#334155", background: "#eef2f7", borderRadius: 6, padding: "2px 8px" }}>{m}</span>)}
                            </div>
                  {abierta === f.patente && (
                    <div style={{ padding: "6px 4px 10px", display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
                      <TiraActividad patente={f.patente} />
                      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", fontSize: 11.5, color: "#334155" }}>
                        <div><strong>Último viaje MELI:</strong> {fch(f.ultimo_viaje)} · {fmt(f.viajes_30d)} viajes en 30 días · {fmt(f.viajes_mes)} este mes</div>
                        <div><strong>GPS:</strong> {f.gps_activo ? `activo en ${f.gps_base}` : f.gps_base ? "dado de baja en Geotab" : "sin dispositivo"} · última comunicación {fchHora(f.gps_ultima_comunicacion)}</div>
                        <div><strong>Seguro de carga:</strong> {seguroCelda(f, "carga")}</div>
                        <div><strong>Seguro de vehículo:</strong> {seguroCelda(f, "vehiculo")}</div>
                        <div><strong>Maestro:</strong> GPS {f.gps_nomina || "no informado"} {f.gps_dispositivo ? `(${f.gps_dispositivo})` : ""} · baja pedida {fch(f.baja_solicitada_el)}</div>
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
                          </td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {enBandeja.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "#94a3b8", padding: 24 }}>Nada en esta lista con esos filtros.</td></tr>}
                </tbody>
              </table>
            </div>
            );
          })()}
          </Fragment>
          )}
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
              <button className="mj-btn" onClick={() => descargarExcel(`alertas_${fTipoAlerta ? fTipoAlerta.toLowerCase() + "_" : ""}${verCerradas ? "cerradas_" : ""}${hoyChile()}`, lista, [
                { titulo: "Tipo", valor: a => TIPOS_ALERTA[a.tipo]?.rotulo || a.tipo }, { titulo: "Patente", campo: "patente" },
                { titulo: "Detalle", valor: a => textoAlerta(a) }, { titulo: "Abierta", campo: "abierta_el" }, { titulo: "Cerrada", campo: "cerrada_el" },
                { titulo: "Estado", campo: "estado" }, { titulo: "Revisada por", campo: "revisada_por" }, { titulo: "Nota", campo: "nota" },
              ], "Alertas")}>Descargar Excel</button>
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
                          {textoAlerta(a)}
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
              <span style={{ fontSize: 11.5, color: GRIS_ }}>Se marcan cumplidas solas cuando Geotab o el Maestro lo confirman (todos los días 07:05)</span>
              <button className="mj-btn" onClick={() => descargarExcel(`solicitudes_${verSolCerradas ? "cerradas" : "pendientes"}_${hoyChile()}`, lista, [
                { titulo: "Patente", campo: "patente" }, { titulo: "Solicitud", valor: x => TIPOS_SOLICITUD[x.tipo] || x.tipo }, { titulo: "Motivo", campo: "motivo" },
                { titulo: "Días sin uso", campo: "dias_sin_uso" }, { titulo: "Pedida", valor: x => fchHora(x.pedida_el) }, { titulo: "Pedida por", campo: "pedida_por" },
                { titulo: "Estado", campo: "estado" }, { titulo: "Cerrada", valor: x => fchHora(x.cerrada_el) }, { titulo: "Cerrada por", campo: "cerrada_por" },
                { titulo: "Nota de cierre", campo: "nota_cierre" },
              ], "Solicitudes")}>Descargar Excel</button>
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
            {[["gps", "Solo GPS activo en Geotab"], ["seguro", "Solo con seguro de carga"]].map(([k, t]) => (
              <button key={k} className={`mj-chip ${fDetalle === k ? "on" : ""}`} onClick={() => setFDetalle(fDetalle === k ? "" : k)}>{fDetalle === k ? "✓ " : ""}{t}</button>
            ))}
            <span style={{ fontSize: 12, color: GRIS_ }}>{fmt(detalle.length)} patentes</span>
            <button className="mj-btn" onClick={() => descargarExcel(`gps_seguros_detalle_${hoyChile()}`, detalle, COLS_DETALLE, "Detalle")}>Descargar Excel</button>
          </Fragment>)}
          <div className="mj-scroll">
            <table className="mj-tabla">
              <thead><tr>
                <th>Patente</th><th>Estado</th><th>Tipo</th><th>Operación</th><th>Tercero</th>
                <th>Últ. viaje</th><th className="num">Viajes 30d</th><th>GPS</th><th>Últ. comunicación</th>
                <th>Seguro de carga</th><th>Seguro de vehículo</th><th className="num">Días sin uso</th><th>Bandeja</th>
              </tr></thead>
              <tbody>
                {detalle.map(f => {
                  const b = BANDEJAS.find(x => x.id === bandejaDe(f));
                  return (
                    <tr key={f.patente}>
                      <td style={{ fontWeight: 700 }}>{f.patente}</td>
                      <td>{f.estado || <span style={{ color: "#a8b2c1" }}>fuera del Maestro</span>}</td>
                      <td>{f.tipo || "—"}</td>
                      <td>{f.operacion || "—"}</td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={f.tercero || ""}>{f.tercero || "—"}</td>
                      <td>{fch(f.ultimo_viaje)}</td>
                      <td className="num">{f.viajes_30d ?? "—"}</td>
                      <td>{f.gps_activo ? `activo · ${f.gps_base}` : f.gps_base ? "de baja" : "—"}</td>
                      <td>{fchHora(f.gps_ultima_comunicacion)}</td>
                      <td>{seguroCelda(f, "carga")}</td>
                      <td>{seguroCelda(f, "vehiculo")}</td>
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

      {ficha && bciExt && <FichaPoliza poliza={ficha} extraccion={bciExt} enFlota={enFlota} pdf={bciPdfs[ficha]} onClose={() => setFicha(null)} />}

      {/* ── Umbrales y Nómina ── */}
      {!cargando && vista === "config" && (
        <Fragment>
          <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "13px 16px", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Seguros BCI (fuente oficial)</div>
            <div style={{ fontSize: 11.5, color: "#64748b", margin: "3px 0 10px" }}>
              Se extraen del portal de BCI Seguros dos veces por semana. Una patente tiene seguro BCI solo si está en una de estas pólizas;
              lo que diga el Excel para BCI se reemplaza por esto. Otros proveedores se toman del Excel y se marcan con *.
              {bciExt ? ` Última extracción: ${fchHora(bciExt.extraido_at)} (${bciExt.origen}, ${fmt(bciExt.polizas)} pólizas, ${fmt(bciExt.items)} vehículos).` : " Todavía no hay extracciones."}
            </div>
            <table className="mj-tabla">
              <thead><tr><th>Póliza</th><th>Ramo</th><th>Convenio</th><th>Vigencia</th><th className="num">Ítems</th><th className="num">Prima neta</th><th></th><th></th></tr></thead>
              <tbody>
                {bciPolizas.map(x => (
                  <tr key={x.poliza}>
                    <td style={{ fontWeight: 700 }}>{x.poliza}</td><td>{x.ramo}</td><td>{x.convenio || "—"}</td>
                    <td>{fch(x.vigencia_desde)} → {fch(x.vigencia_hasta)}</td><td className="num">{fmt(x.items)}</td><td className="num">{x.prima_neta} {x.moneda}</td>
                    <td><button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => setFicha(x.poliza)}>Ver ficha</button></td>
                    <td>{bciPdfs[x.poliza] ? <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => abrirPdf(bciPdfs[x.poliza].ruta)}>PDF</button>
                                           : <span style={{ fontSize: 11, color: "#a8b2c1" }}>sin PDF</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Cargar Maestro de Certificación (Excel)</div>
              <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.7, marginBottom: 8 }}>
                Sube el Maestro con su formato de siempre. Se cargan las hojas <strong>Vehiculos</strong>, <strong>GPS y Seguros</strong>,
                <strong> Esporadicos</strong> y <strong>Maestro Empresa</strong> con todas sus filas (la historia de cada patente se conserva).
                La carga nueva pasa a ser la vigente solo si entran todas las hojas.
              </div>
              <input type="file" accept=".xlsx,.xlsm,.xls" onChange={e => previsualizar(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
              {previa && (
                <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.8 }}>
                  <div><strong>{fmt(previa.resumen.patentes)}</strong> patentes en Vehiculos · {fmt(previa.resumen.activas)} activas
                    {previa.resumen.conHistoria ? ` · ${fmt(previa.resumen.conHistoria)} filas de historia (patentes con más de una fila)` : ""}</div>
                  <div style={{ color: "#64748b" }}>{previa.hojas.map(h => `${h.hoja}: ${fmt(h.filas.length)} filas`).join(" · ")}</div>
                  {previa.avisos.map((a, i) => <div key={i} style={{ color: AMBAR_ }}>{a}</div>)}
                  <button className="mj-btn" onClick={importar} disabled={importando} style={{ marginTop: 6, background: NAVY, color: "#fff" }}>
                    {importando ? "Cargando…" : "Cargar el Maestro"}
                  </button>
                </div>
              )}
            </div>
            <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 800, color: NAVY, borderBottom: "1px solid #eef1f5" }}>Historial de cargas</div>
              <table className="mj-tabla">
                <thead><tr><th>#</th><th>Fecha</th><th>Por</th><th>Archivo</th><th className="num">Patentes</th><th>Hojas</th></tr></thead>
                <tbody>
                  {cargas.map(c => (
                    <tr key={c.id} style={{ fontWeight: c.id === cargaVigente?.id ? 700 : 400, color: c.origen === "maestro_pendiente" ? GRIS_ : undefined }}>
                      <td>{c.id}{c.id === cargaVigente?.id ? " · vigente" : c.origen === "nomina" ? " · Nómina antigua" : c.origen === "maestro_pendiente" ? " · incompleta" : ""}</td>
                      <td>{fchHora(c.cargado_at)}</td><td>{c.cargado_por || "—"}</td>
                      <td style={{ color: "#64748b" }}>{c.archivo || "—"}</td><td className="num">{fmt(c.filas)}</td>
                      <td style={{ color: "#64748b", whiteSpace: "normal" }}>{c.hojas ? Object.entries(c.hojas).map(([k, n]) => `${k} ${n}`).join(" · ") : "—"}</td>
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
          Levantamiento de uso real de la flota: Maestro de Certificación, maestro de viajes y Geotab
        </div>
      </div>
      <div className="mj-wrap" style={{ padding: "16px 24px 28px" }}>
        <FlotaGps />
      </div>
    </div>
  );
}
