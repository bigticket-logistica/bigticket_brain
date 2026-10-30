// ═══════════════════════════════════════════════════════════════════════════
// MAESTRO DE OPERACIONES · CHILE
// Replica las pestañas del Excel de los supervisores (maestro_de_viajes.xlsm)
// con datos calculados desde MELI, en el proyecto Supabase de Chile.
//
// Pestañas:
//   • Maestro Jornada  → una fila por viaje (IngresoMaestro + MAESTRO_JORNADA)
//   • Devoluciones     → detalle por folio con su motivo (IngresosDevoluciones)
//   • Traspasos        → origen → destino (los D_JUSTIFICADOS del Excel)
//   • No Salidas       → todavía manual: MELI no lo entrega
//
// Habla con la API REST del proyecto de Chile por fetch, sin dependencias extra.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, Fragment } from "react";
import MapaZonas from "./MapaZonas";   // editor de mapa · requiere: npm install leaflet
import MaestroCanon from "./MaestroCanon";   // maestro de Canon desde DispatchTrack (migraciones 80-81)

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

// PostgREST devuelve bigint y numeric como texto: hay que convertir antes de sumar.
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const fmt = (v) => n(v).toLocaleString("es-CL");
// Los timestamptz llegan en UTC. Mostrarlos en crudo daba horas imposibles
// (00:10 cuando en Chile eran las 20:10). Cuando la vista ya trae la hora
// convertida se usa esa; este helper cubre el resto.
const horaChile = (ts) => {
  if (!ts) return "—";
  try {
    return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago",
      hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
  } catch (e) { return "—"; }
};
const NAVY = "#1a3a6b";
const ORANGE = "#F47B20";
const AMBAR_ = "#a16207";
const GRIS_ = "#8a94a6";
const VERDE_ = "#0d8043";
const ROJO_ = "#b42318";

// Acepta opciones para poder escribir, no solo leer. La versión anterior recibía
// solo `path` e ignoraba el segundo argumento, así que el botón de recuadre hacía
// un GET en vez del POST: no insertaba nada y tampoco fallaba. Silencio total.
async function api(path, opciones) {
  const o = opciones || {};
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    method: o.method || "GET",
    headers: Object.assign({
      apikey: CL_KEY,
      Authorization: `Bearer ${CL_KEY}`,
      "Content-Type": "application/json",
    }, o.headers || {}),
    body: o.body,
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 250)}`);
  // Las escrituras con Prefer: return=minimal responden sin cuerpo: r.json() reventaría.
  const texto = await r.text();
  if (!texto || !texto.trim()) return true;
  try { return JSON.parse(texto); } catch (e) { return true; }
}

// Variante tolerante: si una consulta falla (por ejemplo, timeout en una vista
// pesada), devuelve el valor por defecto en vez de tumbar todo el bloque. Antes
// los módulos pedían trece consultas en paralelo y una sola caída dejaba la
// pantalla en blanco aunque las otras doce hubieran respondido.
async function apiSuave(path, porDefecto, fallos) {
  try { return await api(path); }
  catch (e) {
    if (fallos) fallos.push(String(path).split("?")[0] + ": " + e.message);
    return porDefecto;
  }
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
  // BOM para que Excel en español respete los acentos
  const blob = new Blob(["\uFEFF" + cuerpo], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Tarjeta de indicador ───────────────────────────────────────────────────
function Kpi({ rotulo, valor, detalle, color, alerta, abierto, onClick }) {
  return (
    <button className="mj-kpi" onClick={onClick} aria-expanded={!!abierto}
      style={{
        background: abierto ? "#f7faff" : "#fff",
        border: `1px solid ${abierto ? (color || NAVY) : (alerta ? "#f2c9c9" : "#e6e9ef")}`,
        borderLeft: `4px solid ${color || NAVY}`, borderRadius: 10,
        padding: "12px 16px", minWidth: 132, flex: "1 1 132px",
        textAlign: "left", cursor: "pointer", fontFamily: "inherit",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10.5, color: "#8a94a6", fontWeight: 700, letterSpacing: .4, textTransform: "uppercase" }}>{rotulo}</span>
        <span style={{ fontSize: 9, color: abierto ? (color || NAVY) : "#c3cbd8" }}>{abierto ? "▲" : "▼"}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || NAVY, lineHeight: 1.25, letterSpacing: -.5 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{detalle}</div>}
    </button>
  );
}

// Agrupa filas por un campo y suma lo que devuelva valorFn.
function agrupar(filas, campo, valorFn) {
  const m = {};
  for (const r of filas) { const k = r[campo] || "—"; m[k] = (m[k] || 0) + valorFn(r); }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// Panel que explica una tarjeta y muestra su desglose.
function PanelKpi({ kpi, onCerrar }) {
  if (!kpi) return null;
  const desglose = kpi.desglose ? kpi.desglose() : null;
  return (
    <div style={{
      background: "#fff", border: `1px solid #e6e9ef`, borderTop: `3px solid ${kpi.color || NAVY}`,
      borderRadius: 10, padding: "14px 18px", marginBottom: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: kpi.color || NAVY }}>{kpi.rotulo}</div>
        <button onClick={onCerrar} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 18, lineHeight: 1, fontFamily: "inherit" }}>×</button>
      </div>
      <div style={{ fontSize: 13, color: "#334155", marginTop: 6, lineHeight: 1.8, maxWidth: 860 }}>{kpi.que}</div>
      {kpi.como && (
        <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 8, lineHeight: 1.8, maxWidth: 860,
                      background: "#f7f9fc", borderRadius: 8, padding: "8px 12px" }}>
          <strong style={{ color: "#475569" }}>Cómo se calcula: </strong>{kpi.como}
        </div>
      )}
      {kpi.render && <div style={{ marginTop: 12 }}>{kpi.render()}</div>}
      {desglose && desglose.filas.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#8a94a6", fontWeight: 700, textTransform: "uppercase", letterSpacing: .4, marginBottom: 6 }}>
            {desglose.titulo}
          </div>
          <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid #eef1f5", borderRadius: 8 }}>
            <table className="mj-tabla" style={{ fontSize: 11.5 }}>
              <thead><tr>
                {desglose.columnas.map((c, j) => (
                  <th key={j} style={c.num ? { textAlign: "right" } : undefined}>{c.t}</th>
                ))}
              </tr></thead>
              <tbody>
                {desglose.filas.map((f, i) => (
                  <tr key={i}>{f.map((v, j) => (
                    <td key={j}
                        className={desglose.columnas[j] && desglose.columnas[j].num ? "num" : ""}
                        style={j === 0 ? { fontWeight: 600 } : undefined}>{v}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {desglose && desglose.filas.length === 0 && (
        <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 10, fontStyle: "italic" }}>{desglose.vacio || "Sin filas para mostrar."}</div>
      )}
    </div>
  );
}

// Patente normalizada: mayúsculas, solo letras y números (igual que la base).
const normPatente = (p) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Tipo de ruta: cómo se muestra cada código del catálogo de servicios.
const ETIQUETA_TIPO = {
  "UM": { t: "Última milla · Meli 1", c: "#1a3a6b", f: "#e8edf5" },
  "MELI ONE": { t: "Meli One", c: "#5b21b6", f: "#ede9fe" },
  "SPOT": { t: "Spot", c: "#9a3412", f: "#ffedd5" },
  "AMBULANCIA": { t: "Ambulancia", c: "#b42318", f: "#fdecea" },
  "RECOLECTA": { t: "Recolecta", c: "#0e7490", f: "#e0f2fe" },
  "SAME DAY": { t: "Same Day", c: "#0d8043", f: "#e7f6ec" },
  "TRONCAL": { t: "Troncal", c: "#7a5b16", f: "#fdf3d8" },
  "SORTEO": { t: "Sorteo", c: "#475569", f: "#eef2f9" },
};
const etiquetaTipo = (cod) => ETIQUETA_TIPO[cod] || { t: cod, c: "#475569", f: "#eef2f9" };

// Certronic por patente, con la misma regla que PNR: la fila ACTIVA si existe; si no, la primera.
const indiceCertronic = (filas) => {
  const m = {};
  for (const x of filas || []) {
    const k = normPatente(x.patente);
    if (!k) continue;
    if (!m[k] || (m[k].estado !== "ACTIVA" && x.estado === "ACTIVA")) m[k] = x;
  }
  return m;
};

function Etiqueta({ texto, color, fondo }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 10.5,
      fontWeight: 700, color: color || NAVY, background: fondo || "#eef2f9", whiteSpace: "nowrap",
    }}>{texto}</span>
  );
}

// ── Módulo ─────────────────────────────────────────────────────────────────
function ModuloMaestroCL({ usuario } = {}) {
  const [dias, setDias] = useState([]);
  const [fecha, setFecha] = useState("");
  const [tab, setTab] = useState("jornada");
  const [cliente, setCliente] = useState("meli");          // MELI o CANON
  const [soloReparto, setSoloReparto] = useState(true);
  const [tipoServicio, setTipoServicio] = useState("todos");   // todos | Última milla | MELI ONE
  const [cecos, setCecos] = useState("");
  const [busca, setBusca] = useState("");
  const [kpiAbierto, setKpiAbierto] = useState(null);
  const [recuadre, setRecuadre] = useState(null);
  const [aCuadrar, setACuadrar] = useState([]);
  const [pidiendo, setPidiendo] = useState(false);
  const [recRuta, setRecRuta] = useState({});      // id_ruta -> última solicitud de esa ruta
  const [pidiendoRuta, setPidiendoRuta] = useState(null);
  const [leidoAt, setLeidoAt] = useState(null);      // hora de la última lectura
  const [recargando, setRecargando] = useState(false);
  // ── Mantenedor de CECOS ──
  const [cecosCat, setCecosCat] = useState([]);        // vw_cecos_detectados
  const [cecosEdit, setCecosEdit] = useState({});      // codigo -> fila en edición
  const [cecosMasivo, setCecosMasivo] = useState("");
  const [cecosGuardando, setCecosGuardando] = useState(null);
  const [cecosMsg, setCecosMsg] = useState("");
  // ── Mantenedor de Zonas de Pago ──
  const [zonas, setZonas] = useState([]);
  const [segmentaciones, setSegmentaciones] = useState([]);
  const [zonaEdit, setZonaEdit] = useState({});       // id -> fila en edición
  const [zonaGuardando, setZonaGuardando] = useState(null);
  const [zonaFiltro, setZonaFiltro] = useState("todas");   // todas | pendientes
  // ── Maestro de Pago (modelo hoja 1) y Vehículos BT ──
  const [pago, setPago] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [vehEdit, setVehEdit] = useState({});
  const [vehMasivo, setVehMasivo] = useState("");
  const [vehGuardando, setVehGuardando] = useState(null);
  const [vehMsg, setVehMsg] = useState("");
  const [vehNueva, setVehNueva] = useState({ patente: "", proyecto: "COMBUSTION LARGE VAN" });
  const [vehBuscar, setVehBuscar] = useState("");
  // operación y supervisor por patente (migración 65)
  const [vehOps, setVehOps] = useState({});              // patente → fila de vw_vehiculos_bt
  const [supervisores, setSupervisores] = useState([]);
  const [cecosNombres, setCecosNombres] = useState([]);
  const [supPanel, setSupPanel] = useState(false);
  const [supNuevo, setSupNuevo] = useState({ nombre: "", correo: "", telefono: "" });
  const [supGuardando, setSupGuardando] = useState(null);
  const [vehSup, setVehSup] = useState({});              // patente → supervisor, para el Maestro Jornada
  const [supCeco, setSupCeco] = useState({});            // CECO → supervisor(es) de la bitácora (migración 78)
  const [supBit, setSupBit] = useState([]);              // supervisores de la bitácora (supervisores_bt)
  const [tipoRuta, setTipoRuta] = useState({});          // id_ruta → tipo de ruta (vw_tipo_ruta_dia, migración 67)
  const [servActivos, setServActivos] = useState([]);    // catálogo de servicios activos, para confirmar el tipo
  const [tipoEdit, setTipoEdit] = useState(null);        // viaje con el selector de tipo abierto
  const [tipoGuardando, setTipoGuardando] = useState(null);
  const [certPat, setCertPat] = useState({});
  // ── No salidas a ruta (migración 69) ──
  const [nsFilas, setNsFilas] = useState([]);
  const [nsMotivos, setNsMotivos] = useState([]);
  const [nsSupervisores, setNsSupervisores] = useState([]);
  const [nsFiltro, setNsFiltro] = useState({ supervisor: "", estado: "", busca: "" });
  const [nsEdit, setNsEdit] = useState({});             // patente → { motivo, comentario }
  const [nsGuardando, setNsGuardando] = useState(null);
  const [nsMsg, setNsMsg] = useState("");
  const [nsCargando, setNsCargando] = useState(false);
  const [motPanel, setMotPanel] = useState(false);
  const [motNuevo, setMotNuevo] = useState({ codigo: "", descripcion: "", genera_multa: false, pide_comentario: false });            // patente → empresa según Certronic (vw_cert_vehiculo_vigente)
  // ── Tarifario ──
  const [tarifas, setTarifas] = useState([]);
  const [tarifaEdit, setTarifaEdit] = useState({});        // id -> fila en edición
  const [tarifaGuardando, setTarifaGuardando] = useState(null);
  const [tarifaMsg, setTarifaMsg] = useState("");
  const [tarifaServicio, setTarifaServicio] = useState("todos");
  const [tarifaFiltros, setTarifaFiltros] = useState({});   // filtro por columna del tarifario
  const [tarifaNueva, setTarifaNueva] = useState(null);     // null = formulario cerrado
  const [serviciosCat, setServiciosCat] = useState([]);     // catálogo servicios_tarifa (migración 63)
  const [servPanel, setServPanel] = useState(false);
  const [servNuevo, setServNuevo] = useState({ codigo: "", descripcion: "" });
  const [servGuardando, setServGuardando] = useState(null);
  const [bonoNs, setBonoNs] = useState([]);              // tramos de bono/castigo por NS (migración 74)
  const [bonoPanel, setBonoPanel] = useState(false);
  const BONO_NUEVO0 = { ns_desde: "", ns_hasta: "", factor: "", servicio: "", cecos_admin: "", vigente_desde: "2026-11-01", vigente_hasta: "", nota: "" };
  const [bonoNuevo, setBonoNuevo] = useState(BONO_NUEVO0);
  const [bonoGuardando, setBonoGuardando] = useState(null);
  const [adminCat, setAdminCat] = useState([]);             // nombres de cecos_admin para el alta
  // ── zona nueva + override de viaje ──
  const ZONA_NUEVA0 = { nombre: "", cecos: "", segmentacion: "", lat: "", lon: "", radio: 5000, nota: "" };
  const [zonaNueva, setZonaNueva] = useState(null);        // null = formulario cerrado
  const [mapaAbierto, setMapaAbierto] = useState(false);
  // ── Revisión de zonas: el motor propone, el supervisor confirma, el analista decide ──
  const [rev, setRev] = useState([]);
  const [aprendido, setAprendido] = useState([]);       // reglas aprendidas (migración 76)
  const [apPanel, setApPanel] = useState(false);
  const [revFiltro, setRevFiltro] = useState({ estado: "pendientes", origen: "", cecos: "", busca: "" });
  const [revSel, setRevSel] = useState({});          // id_ruta → segmentación elegida
  const [revEditando, setRevEditando] = useState(null);
  const [revGuardando, setRevGuardando] = useState(null);
  const [revMsg, setRevMsg] = useState("");
  const [revRuta, setRevRuta] = useState(null);      // viaje abierto en el mapa
  const [ovr, setOvr] = useState(null);                    // { id_viaje, segmentacion, motivo }
  const [ovrGuardando, setOvrGuardando] = useState(false);
  const [pagoFiltro, setPagoFiltro] = useState("todos");   // todos | pendientes | calculados

  const [resumen, setResumen] = useState(null);
  const [jornada, setJornada] = useState([]);
  // CECOS real, segmentación y alerta de cada viaje, desde el motor de zonas (ruta_zona_dia)
  const [zonaRuta, setZonaRuta] = useState({});
  const [devol, setDevol] = useState([]);
  const [trasp, setTrasp] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Días disponibles; se abre en el más reciente.
  useEffect(() => {
    (async () => {
      try {
        const r = await api("vw_dias_disponibles?select=fecha&order=fecha.desc&limit=60");
        const fs = r.map(x => x.fecha);
        setDias(fs);
        if (fs.length) {
          // Abre en AYER (horario de Chile): el maestro es de jornadas cerradas, y
          // el día en curso además responde lento porque sus estadísticas todavía
          // no reflejan los datos que el monitor está escribiendo. El seguimiento
          // minuto a minuto se hace en el monitor, no acá.
          // Si ayer no tiene datos (feriado, domingo), cae al día más reciente.
          const hoyCL = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago",
            year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
          const d = new Date(hoyCL + "T12:00:00Z");
          d.setUTCDate(d.getUTCDate() - 1);
          const ayerCL = d.toISOString().slice(0, 10);
          setFecha(fs.includes(ayerCL) ? ayerCL : fs[0]);
        }
        else { setCargando(false); }
      } catch (e) { setError(e.message); setCargando(false); }
    })();
  }, []);

  // Datos del día elegido.
  useEffect(() => {
    if (!fecha) return;
    let vivo = true;
    setCargando(true); setError("");
    (async () => {
      try {
        const fallos = [];
        const [res, jor, dev, tra, rec, cua, rr, zr, vs, ct, tr, sa] = await Promise.all([
          apiSuave(`vw_maestro_resumen_dia?fecha=eq.${fecha}`, [], fallos),
          apiSuave(`vw_maestro_jornada?fecha=eq.${fecha}&order=cargados.desc.nullslast&limit=3000`, [], fallos),
          apiSuave(`vw_maestro_devoluciones?fecha=eq.${fecha}&order=cecos.asc&limit=8000`, [], fallos),
          apiSuave(`vw_traspasos_resumen?fecha_operativa=eq.${fecha}&order=paquetes.desc&limit=3000`, [], fallos),
          apiSuave(`vw_estado_recuadre?fecha_operativa=eq.${fecha}`, [], fallos),
          apiSuave(`vw_rutas_a_cuadrar?fecha=eq.${fecha}&select=id_ruta,cecos,conductor,status,cargados,entregados,pendientes,motivos&limit=500`, [], fallos),
          apiSuave(`vw_estado_recuadre_ruta?fecha_operativa=eq.${fecha}&limit=500`, [], fallos),
          apiSuave(`ruta_zona_dia?fecha=eq.${fecha}&select=id_ruta,cecos_admin,segmentacion,zona_principal,origen_zona,alerta,cecos_fuente&limit=3000`, [], fallos),
          apiSuave("vw_vehiculos_bt?select=patente,supervisor,cecos_operacion&limit=3000", [], fallos),
          apiSuave("vw_cert_vehiculo_vigente?select=patente,tercero,rut_tercero,estado&limit=5000", [], fallos),
          apiSuave(`vw_tipo_ruta_dia?fecha=eq.${fecha}&select=id_ruta,tipo_sugerido,tipo_confirmado,tipo_ruta,estado_tipo,no_planificada,nombre_ruta,line_haul,con_ambulancia,confirmado_por,rol,nota&limit=3000`, [], fallos),
          apiSuave("servicios_tarifa?activo=eq.true&select=codigo,descripcion&order=orden,codigo", [], fallos),
        ]);
        if (fallos.length) setError("Algunas consultas no respondieron: " + fallos.join(" | "));
        if (!vivo) return;
        setResumen(res[0] || null); setJornada(jor); setDevol(dev); setTrasp(tra);
        setZonaRuta(Object.fromEntries((zr || []).map(x => [String(x.id_ruta), x])));
        setVehSup(Object.fromEntries((vs || []).map(x => [normPatente(x.patente), x])));
        setCertPat(indiceCertronic(ct));
        setTipoRuta(Object.fromEntries((tr || []).map(x => [String(x.id_ruta), x])));
        setServActivos(sa || []);
        setRecuadre(rec[0] || null); setACuadrar(cua);
        setRecRuta(Object.fromEntries((rr || []).map(x => [String(x.id_ruta), x])));
        setLeidoAt(new Date());
      } catch (e) { if (vivo) setError(e.message); }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [fecha]);

  useEffect(() => { setCecos(""); }, [tab]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Recarga los datos del día seleccionado (sin recargar la página).
  const recargar = async () => {
    if (!fecha) return;
    setRecargando(true);
    try {
      const fallos = [];
      const [res, jor, rec, cua, rr, zr, vs, ct, tr] = await Promise.all([
        apiSuave(`vw_maestro_resumen_dia?fecha=eq.${fecha}`, [], fallos),
        apiSuave(`vw_maestro_jornada?fecha=eq.${fecha}&order=cargados.desc.nullslast&limit=3000`, [], fallos),
        apiSuave(`vw_estado_recuadre?fecha_operativa=eq.${fecha}`, [], fallos),
        apiSuave(`vw_rutas_a_cuadrar?fecha=eq.${fecha}&select=id_ruta,cecos,conductor,status,cargados,entregados,pendientes,motivos&limit=500`, [], fallos),
        apiSuave(`vw_estado_recuadre_ruta?fecha_operativa=eq.${fecha}&limit=500`, [], fallos),
        apiSuave(`ruta_zona_dia?fecha=eq.${fecha}&select=id_ruta,cecos_admin,segmentacion,zona_principal,origen_zona,alerta,cecos_fuente&limit=3000`, [], fallos),
        apiSuave("vw_vehiculos_bt?select=patente,supervisor,cecos_operacion&limit=3000", [], fallos),
        apiSuave("vw_cert_vehiculo_vigente?select=patente,tercero,rut_tercero,estado&limit=5000", [], fallos),
        apiSuave(`vw_tipo_ruta_dia?fecha=eq.${fecha}&select=id_ruta,tipo_sugerido,tipo_confirmado,tipo_ruta,estado_tipo,no_planificada,nombre_ruta,line_haul,con_ambulancia,confirmado_por,rol,nota&limit=3000`, [], fallos),
      ]);
      setError(fallos.length ? "Algunas consultas no respondieron: " + fallos.join(" | ") : "");
      setResumen(res[0] || null); setJornada(jor);
      setZonaRuta(Object.fromEntries((zr || []).map(x => [String(x.id_ruta), x])));
      setVehSup(Object.fromEntries((vs || []).map(x => [normPatente(x.patente), x])));
      setCertPat(indiceCertronic(ct));
      setTipoRuta(Object.fromEntries((tr || []).map(x => [String(x.id_ruta), x])));
      setRecuadre(rec[0] || null); setACuadrar(cua);
      setRecRuta(Object.fromEntries((rr || []).map(x => [String(x.id_ruta), x])));
      setLeidoAt(new Date());
    } catch (e) { setError(e.message); }
    finally { setRecargando(false); }
  };

  // Deja la solicitud en la cola; el monitor la ejecuta en su siguiente ciclo.
  const pedirRecuadre = async () => {
    if (!fecha) return;
    setPidiendo(true);
    try {
      await api("solicitudes_proceso", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ tipo: "cuadrar_dia", fecha_operativa: fecha, solicitado_por: "brain" }),
      });
      // El monitor tarda hasta 5 min; se recarga ya para que aparezca "esperando".
      await recargar();
    } catch (e) { setError(e.message); }
    finally { setPidiendo(false); }
  };

  // Recuadre de UNA ruta: la que el analista está mirando en la tarjeta.
  const pedirRecuadreRuta = async (idRuta) => {
    if (!fecha || !idRuta) return;
    setPidiendoRuta(String(idRuta));
    try {
      await api("solicitudes_proceso", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ tipo: "cuadrar_dia", fecha_operativa: fecha,
                               id_ruta: Number(idRuta), solicitado_por: "brain" }),
      });
      await recargar();
    } catch (e) { setError(e.message); }
    finally { setPidiendoRuta(null); }
  };

  // Botón de una celda: pide el recuadre de esa ruta y muestra su estado.
  const BotonRuta = ({ idRuta }) => {
    const st = recRuta[String(idRuta)];
    const enCurso = st && ["pendiente", "en_proceso"].includes(st.estado);
    const listo = st && ["listo", "sin_trabajo"].includes(st.estado);
    if (pidiendoRuta === String(idRuta)) {
      return <span style={{ fontSize: 10.5, color: AMBAR_ }}>enviando…</span>;
    }
    if (enCurso) {
      return <span style={{ fontSize: 10.5, color: AMBAR_ }} title={`Pedido a las ${st.solicitado_chile}`}>
        ⏳ en cola
      </span>;
    }
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => pedirRecuadreRuta(idRuta)}
          style={{ border: `1px solid ${NAVY}`, background: "#fff", color: NAVY, borderRadius: 7,
                   padding: "2px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer",
                   fontFamily: "inherit", whiteSpace: "nowrap" }}>
          Cuadrar
        </button>
        {listo && (
          <span style={{ fontSize: 10, color: VERDE_ }} title={st.detalle || ""}>
            ✓ {st.terminado_chile}
          </span>
        )}
      </span>
    );
  };

  // ── Mantenedor de CECOS: catálogo + detectados ──
  const cargarCecos = async () => {
    try {
      const d = await api("vw_cecos_completo?order=rutas_historicas.desc&limit=200");
      setCecosCat(d);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { if (tab === "cecos") cargarCecos(); }, [tab]);

  // ── Zonas de Pago: listado + segmentaciones para el selector ──
  const cargarZonas = async () => {
    const fallos = [];
    const [z, seg] = await Promise.all([
      apiSuave("vw_zonas_mantenedor?order=codigo_meli,nombre&limit=500", [], fallos),
      apiSuave("segmentaciones?order=nombre&activo=eq.true", [], fallos),
    ]);
    setZonas(z); setSegmentaciones(seg);
    if (fallos.length) setError("No se pudieron cargar: " + fallos.join(" | "));
  };
  useEffect(() => { if (tab === "zonas") cargarZonas(); }, [tab]);

  // ── Maestro de Pago: el modelo de operaciones, una fila por viaje ──
  const cargarPago = async () => {
    const fallos = [];
    const d = await apiSuave(
      `vw_pago_viaje?fecha=eq.${fecha}&ruta_vacia=eq.false&order=cecos.asc.nullslast,id_viaje&limit=3000`,
      [], fallos);
    setPago(d);
    if (fallos.length) setError("No se pudieron cargar: " + fallos.join(" | "));
  };
  useEffect(() => { if (tab === "pago") cargarPago(); }, [tab, fecha]);

  // ── No salidas a ruta: la flota propia sin ruta del día, con su motivo ──
  // El supervisor lo registrará desde su bitácora (flota_sin_ruta con su id); aquí el
  // analista ve a todos los supervisores y puede registrar o corregir.
  const cargarNoSalidas = async () => {
    if (!fecha) return;
    setNsCargando(true);
    const fallos = [];
    try {
      const [filas, mot, sup] = await Promise.all([
        api("rpc/flota_sin_ruta", { method: "POST", body: JSON.stringify({ p_fecha: fecha }) })
          .catch(e => { fallos.push("flota_sin_ruta: " + e.message); return []; }),
        apiSuave("motivos_no_salida?order=orden,codigo", [], fallos),
        apiSuave("supervisores_cl?order=nombre", [], fallos),
      ]);
      setNsFilas(Array.isArray(filas) ? filas : []);
      setNsMotivos(mot || []); setNsSupervisores(sup || []);
      if (fallos.length) setError("No salidas: " + fallos.join(" | "));
    } finally { setNsCargando(false); }
  };
  useEffect(() => { if (tab === "nosalidas") cargarNoSalidas(); }, [tab, fecha]);   // eslint-disable-line react-hooks/exhaustive-deps

  const registrarNoSalida = async (f, motivo, comentario) => {
    if (!motivo) { setError("Elige el motivo de la no salida."); return; }
    setNsGuardando(f.patente);
    try {
      await api("rpc/registrar_no_salida", { method: "POST", body: JSON.stringify({
        p_fecha: fecha, p_patente: f.patente, p_motivo: motivo, p_usuario: analista,
        p_rol: "analista", p_comentario: comentario || null }) });
      setNsEdit(e => { const n = { ...e }; delete n[f.patente]; return n; });
      setNsMsg(`${f.patente}: ${motivo}`); setTimeout(() => setNsMsg(""), 3000);
      await cargarNoSalidas();
    } catch (e) { setError(e.message); }
    finally { setNsGuardando(null); }
  };
  const quitarNoSalida = async (f) => {
    if (!window.confirm(`¿Quitar el registro de no salida de ${f.patente} (${f.motivo}) del ${fecha}?`)) return;
    setNsGuardando(f.patente);
    try {
      await api(`no_salidas?fecha=eq.${fecha}&patente=eq.${encodeURIComponent(f.patente)}`, {
        method: "DELETE", headers: { Prefer: "return=minimal" } });
      await cargarNoSalidas();
    } catch (e) { setError(e.message); }
    finally { setNsGuardando(null); }
  };
  const agregarMotivo = async () => {
    const codigo = motNuevo.codigo.trim().toUpperCase().replace(/\s+/g, " ");
    if (codigo.length < 2) { setError("El motivo debe tener al menos 2 letras."); return; }
    if (nsMotivos.some(m => m.codigo === codigo)) { setError(`El motivo ${codigo} ya existe.`); return; }
    try {
      await api("motivos_no_salida", { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ codigo, descripcion: motNuevo.descripcion.trim() || null,
          genera_multa: !!motNuevo.genera_multa, pide_comentario: !!motNuevo.pide_comentario,
          orden: Math.max(0, ...nsMotivos.map(m => m.orden || 0)) + 10 }) });
      setMotNuevo({ codigo: "", descripcion: "", genera_multa: false, pide_comentario: false });
      await cargarNoSalidas();
    } catch (e) { setError(e.message); }
  };
  const actualizarMotivo = async (codigo, campos) => {
    try {
      await api(`motivos_no_salida?codigo=eq.${encodeURIComponent(codigo)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(campos) });
      await cargarNoSalidas();
    } catch (e) { setError(e.message); }
  };

  // ── Desde el Maestro Pago: crear la tarifa que falta, ya rellenada ──
  const crearTarifaDesdePago = (r) => {
    setTarifaNueva({ ...TARIFA_NUEVA0, cecos_admin: r.cecos || "", segmentacion: r.segmentacion_zonal || "",
                     servicio: r.servicio || "", tipo_vehiculo: r.tipo_vehiculo_bt || "", vigente_desde: r.fecha || "" });
    setTab("tarifario");
    setTarifaMsg(`Tarifa que falta para el viaje ${r.id_viaje}: completa el tipo de pago y el valor, y presiona Crear tarifa.`);
  };
  const confirmarTipoDesdePago = async (r, tipo) => {
    await confirmarTipo({ id_viaje: r.id_viaje, fecha: r.fecha }, tipo);
    await cargarPago();
  };

  // ── Tipo de ruta: el analista confirma o corrige (la bitácora lo hará el supervisor) ──
  const confirmarTipo = async (r, tipo) => {
    if (!tipo) return;
    setTipoGuardando(r.id_viaje);
    try {
      await api("rpc/confirmar_tipo_ruta", { method: "POST", body: JSON.stringify({
        p_fecha: r.fecha, p_id_ruta: Number(r.id_viaje), p_tipo: tipo, p_usuario: analista, p_rol: "analista" }) });
      setTipoRuta(m => ({ ...m, [String(r.id_viaje)]: { ...(m[String(r.id_viaje)] || {}),
        tipo_confirmado: tipo, tipo_ruta: tipo, estado_tipo: "confirmado", confirmado_por: analista, rol: "analista" } }));
      setTipoEdit(null);
    } catch (e) { setError(e.message); }
    finally { setTipoGuardando(null); }
  };

  // ── Revisión de zonas ──
  // Lista los viajes que el motor resolvió fuera de la regla normal (alerta) o que ya
  // pasaron por revisión. La decisión del analista se guarda como corrección de zona
  // (viaje_zona_override): es la que paga.
  const analista = (usuario && (usuario.nombre || usuario.email)) || "brain";
  const cargarRevision = async () => {
    if (!fecha) return;
    const fallos = [];
    const [d, ap] = await Promise.all([
      apiSuave(`vw_revision_zonas?fecha=eq.${fecha}&order=codigo_meli.asc.nullslast,id_ruta&limit=3000`, [], fallos),
      apiSuave("aprendizaje_zona?order=activo.desc,decisiones.desc,comuna", [], fallos),
    ]);
    setRev(d);
    setAprendido(ap || []);
    if (fallos.length) setError("No se pudieron cargar: " + fallos.join(" | "));
  };
  useEffect(() => {
    if (tab === "revision") { cargarRevision(); if (!zonas.length || !segmentaciones.length) cargarZonas(); }
  }, [tab, fecha]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Activar o desactivar una regla aprendida. Desactivada a mano queda bloqueada:
  // nuevas decisiones no la reactivan hasta que el analista la vuelva a activar.
  const cambiarAprendido = async (a, activo) => {
    try {
      await api(`aprendizaje_zona?comuna=eq.${encodeURIComponent(a.comuna)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ activo, bloqueado: !activo,
          nota: activo ? null : `Desactivada por ${analista}`,
          actualizado_at: new Date().toISOString(), actualizado_por: analista }) });
      await cargarRevision();
      setRevMsg(activo ? `Regla de ${a.comuna} activada` : `Regla de ${a.comuna} desactivada: el motor volverá a pedir revisión`);
    } catch (e) { setError(e.message); }
  };

  const decidirZona = async (r, seg) => {
    if (!seg) { setRevMsg("Elige una segmentación antes de confirmar."); return; }
    setRevGuardando(r.id_ruta); setRevMsg("");
    try {
      await api("rpc/decidir_zona", { method: "POST", body: JSON.stringify({
        p_fecha: r.fecha, p_id_ruta: r.id_ruta, p_segmentacion: seg, p_analista: analista,
        p_nota: seg === r.propuesta_motor ? "Confirma la propuesta del motor"
              : seg === r.supervisor_segmentacion ? "Confirma la propuesta del supervisor"
              : "Decisión del analista" }) });
      setRevMsg(`Viaje ${r.id_ruta} → ${seg}`);
      setRevEditando(null);
      await cargarRevision();
    } catch (e) { setError(e.message); }
    finally { setRevGuardando(null); }
  };

  const aprobarCoincidencias = async (cuantas) => {
    if (!window.confirm(`Se aprobarán ${cuantas} viajes donde el supervisor confirmó la zona que propuso el motor. ¿Continuar?`)) return;
    setRevGuardando("__bloque__"); setRevMsg("");
    try {
      const res = await api("rpc/aprobar_coincidencias", { method: "POST",
        body: JSON.stringify({ p_fecha: fecha, p_analista: analista }) });
      setRevMsg(typeof res === "string" ? res : "Coincidencias aprobadas");
      await cargarRevision();
    } catch (e) { setError(e.message); }
    finally { setRevGuardando(null); }
  };

  const verRutaEnMapa = async (r) => {
    try {
      const pts = await api("rpc/puntos_ruta", { method: "POST",
        body: JSON.stringify({ p_fecha: r.fecha, p_id_ruta: r.id_ruta }) });
      if (!Array.isArray(pts) || !pts.length) { setRevMsg(`El viaje ${r.id_ruta} no tiene entregas con coordenadas.`); return; }
      if (!zonas.length) await cargarZonas();
      setRevRuta({ titulo: `Viaje ${r.id_ruta}${r.codigo_meli ? " · " + r.codigo_meli : ""}`, puntos: pts });
    } catch (e) { setError(e.message); }
  };

  // ── Supervisor a cargo de cada CECO, según la bitácora (no depende de la fecha) ──
  const cargarSupCeco = async () => {
    const [sc, sb] = await Promise.all([
      apiSuave("vw_supervisor_ceco?select=ceco,supervisor,cantidad", []),
      apiSuave("supervisores_bt?select=email,nombre,scs_asignados,activo,es_prueba&order=nombre", []),
    ]);
    setSupCeco(Object.fromEntries((sc || []).map(x => [x.ceco, x.supervisor])));
    setSupBit(sb || []);
  };
  useEffect(() => { cargarSupCeco(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const actualizarSupBit = async (email, campos) => {
    try {
      await api(`supervisores_bt?email=eq.${encodeURIComponent(email)}`, { method: "PATCH",
        headers: { Prefer: "return=minimal" }, body: JSON.stringify(campos) });
      await cargarSupCeco();
    } catch (e) { setError(e.message); }
  };

  // ── Vehículos BT: la tabla auxiliar de certificación ──
  const cargarVehiculos = async () => {
    const [tv, vo, sp, ca] = await Promise.all([
      apiSuave("tipo_vehiculo_bt?order=proyecto,patente&limit=500", []),
      apiSuave("vw_vehiculos_bt?limit=3000", []),
      apiSuave("supervisores_cl?order=nombre", []),
      apiSuave("cecos_admin?select=nombre&order=nombre", []),
    ]);
    setVehiculos(tv);
    setVehOps(Object.fromEntries((vo || []).filter(x => x.cecos_operacion || x.supervisor_id || x.marca || x.estado_pipefy)
                                           .map(x => [x.patente, x])));
    setSupervisores(sp || []);
    setCecosNombres([...new Set((ca || []).map(x => x.nombre))]);
  };
  useEffect(() => { if (tab === "vehiculos") cargarVehiculos(); }, [tab]);

  // ── Tarifario: el catálogo de tarifas que alimenta vw_pago_viaje ──
  const SERVICIOS_TARIFA = ["UM", "MELI ONE", "RECOLECTA", "SPOT", "SORTEO", "TRONCAL"];
  const TIPOS_PAGO = ["GUIAS", "ARRIENDO", "PISO"];
  const VEHICULOS_TARIFA = ["COMBUSTION", "BIG VAN", "COMBUSTION LARGE VAN", "ELECTRICA"];
  const TARIFA_NUEVA0 = { cecos_admin: "", segmentacion: "", servicio: "UM", tipo_pago: "GUIAS",
    detalle: "", tipo_vehiculo: "COMBUSTION", tarifa_oficial: "", tarifa_contingencia: "",
    cobrar_oficial: "", cobrar_contingencia: "", vigente_desde: "", nota: "",
    entregas_base: "", tarifa_adicional: "" };   // solo PISO: el piso cubre N entregas, cada extra se paga aparte

  const cargarTarifario = async () => {
    const fallos = [];
    const [t, seg, adm, sv, bn] = await Promise.all([
      apiSuave("tarifas?order=servicio,cecos_admin.nullsfirst,segmentacion,tipo_vehiculo,detalle&limit=500", [], fallos),
      apiSuave("segmentaciones?order=nombre&activo=eq.true", [], fallos),
      apiSuave("cecos_admin?select=nombre&order=nombre", [], fallos),
      apiSuave("servicios_tarifa?order=orden,codigo", [], fallos),
      apiSuave("bono_ns_tramos?order=activo.desc,servicio.nullsfirst,cecos_admin.nullsfirst,ns_desde.desc", [], fallos),
    ]);
    setTarifas(t);
    setServiciosCat(sv);
    setBonoNs(bn || []);
    if (seg.length) setSegmentaciones(seg);
    setAdminCat([...new Set(adm.map(a => a.nombre))]);
    if (fallos.length) setError("No se pudieron cargar: " + fallos.join(" | "));
  };
  useEffect(() => { if (tab === "tarifario") cargarTarifario(); }, [tab]);

  // Traduce los rechazos de la base (reglas de la tabla tarifas) a algo que se entienda
  const errorTarifa = (e) => {
    const m = String((e && e.message) || e || "");
    if (m.includes("tarifas_piso_chk"))
      return "Tarifa PISO: faltan las entregas que cubre el piso o el $ por entrega adicional (0 si es monto fijo).";
    if (m.includes("tarifas_servicio_chk")) return "El servicio elegido no es válido para la tabla de tarifas.";
    if (m.includes("tarifas_tipo_chk")) return "El tipo de pago elegido no es válido (GUIAS, ARRIENDO o PISO).";
    if (m.includes("23505") || m.toLowerCase().includes("duplicate key"))
      return "Ya existe otra tarifa con la misma llave (servicio, CECOS, segmentación, tipo, detalle y vehículo) " +
             "en esa vigencia. Revisa la otra fila o ajusta las fechas.";
    return m;
  };

  const guardarTarifa = async (id, campos) => {
    setTarifaGuardando(id);
    try {
      await api(`tarifas?id=eq.${id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ...campos, actualizado_at: new Date().toISOString(),
                               actualizado_por: "brain" }),
      });
      setTarifaEdit(e => { const x = { ...e }; delete x[id]; return x; });
      await cargarTarifario();
      setTarifaMsg("Tarifa guardada"); setTimeout(() => setTarifaMsg(""), 3000);
    } catch (e) { setError(errorTarifa(e)); }
    finally { setTarifaGuardando(null); }
  };

  // La subvención por combustible (R2 del cuestionario) se activa o desactiva
  // COMPLETA: cuando MELI la quite, es un solo click y rige de inmediato.
  const contingenciaGlobal = async (activar) => {
    const cuantas = tarifas.filter(t => t.activa && t.contingencia_activa !== activar).length;
    if (!cuantas) { setTarifaMsg("Nada que cambiar"); setTimeout(() => setTarifaMsg(""), 3000); return; }
    if (!window.confirm(
      `${activar ? "ACTIVAR" : "DESACTIVAR"} la tarifa de contingencia (subvención combustible) en ${cuantas} tarifa(s).\n\n` +
      `El cambio rige DE INMEDIATO sobre cualquier día que se consulte: el pago ${activar ? "sube" : "baja"} al valor ${activar ? "con" : "sin"} subvención.\n\n¿Continuar?`)) return;
    setTarifaGuardando("__global__");
    try {
      await api(`tarifas?activa=eq.true`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ contingencia_activa: activar,
          // firma propia: el check verde marca solo las ediciones fila por fila
          actualizado_at: new Date().toISOString(), actualizado_por: "brain_global" }),
      });
      await cargarTarifario();
      setTarifaMsg(`Contingencia ${activar ? "activada" : "desactivada"} en todas`);
      setTimeout(() => setTarifaMsg(""), 4000);
    } catch (e) { setError(e.message); }
    finally { setTarifaGuardando(null); }
  };

  // ── Bono / castigo por nivel de servicio (bono_ns_tramos) ──
  const numOVacio = (v) => (v === "" || v === null || v === undefined) ? null : Number(String(v).replace(",", "."));
  const validarTramo = (b) => {
    const d = numOVacio(b.ns_desde), h = numOVacio(b.ns_hasta), f = numOVacio(b.factor);
    if (d === null || Number.isNaN(d) || d < 0 || d > 100) return "El % NS desde debe estar entre 0 y 100.";
    if (h !== null && (Number.isNaN(h) || h <= d || h > 100)) return "El % NS hasta debe ser mayor que el desde y no pasar de 100 (vacío = sin tope).";
    if (f === null || Number.isNaN(f) || f <= 0 || f > 2) return "El factor debe estar entre 0 y 2 (1,05 = bono de 5%; 0,95 = castigo de 5%).";
    if (!b.vigente_desde) return "Indica desde cuándo rige el tramo.";
    if (b.vigente_hasta && b.vigente_hasta < b.vigente_desde) return "La vigencia hasta no puede ser anterior a la vigencia desde.";
    return null;
  };
  const filaTramo = (b) => ({ ns_desde: numOVacio(b.ns_desde), ns_hasta: numOVacio(b.ns_hasta), factor: numOVacio(b.factor),
    servicio: b.servicio || null, cecos_admin: b.cecos_admin || null, vigente_desde: b.vigente_desde,
    vigente_hasta: b.vigente_hasta || null, nota: (b.nota || "").trim() || null });
  const agregarTramo = async () => {
    const e = validarTramo(bonoNuevo); if (e) { setError(e); return; }
    setBonoGuardando("__nuevo__");
    try {
      await api("bono_ns_tramos", { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ...filaTramo(bonoNuevo), actualizado_por: analista }) });
      setBonoNuevo(BONO_NUEVO0);
      await cargarTarifario();
      setTarifaMsg("Tramo de bono NS agregado"); setTimeout(() => setTarifaMsg(""), 3000);
    } catch (e) { setError(e.message); }
    finally { setBonoGuardando(null); }
  };
  const actualizarTramo = async (b, campos) => {
    const nuevo = { ...b, ...campos };
    const e = validarTramo({ ...nuevo, ns_hasta: nuevo.ns_hasta ?? "", vigente_hasta: nuevo.vigente_hasta || "" });
    if (e && !("activo" in campos)) { setError(e); return; }
    setBonoGuardando(b.id);
    try {
      await api(`bono_ns_tramos?id=eq.${b.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ...campos, actualizado_at: new Date().toISOString(), actualizado_por: analista }) });
      await cargarTarifario();
    } catch (e) { setError(e.message); }
    finally { setBonoGuardando(null); }
  };

  // ── Catálogo de tipos de servicio ──
  // Opciones para elegir: los activos del catálogo; si el catálogo aún no existe
  // (migración 63 sin correr), la lista de siempre.
  const serviciosOpc = serviciosCat.length
    ? serviciosCat.filter(x => x.activo).map(x => x.codigo)
    : SERVICIOS_TARIFA;
  const normCodigoServ = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, " ");
  const errorServicio = (e) => {
    const m = String((e && e.message) || e || "");
    if (m.includes("23505") || m.toLowerCase().includes("duplicate key")) return "Ese tipo de servicio ya existe.";
    if (m.includes("servicios_tarifa_codigo_chk")) return "El código debe tener entre 2 y 30 caracteres.";
    return m;
  };
  const agregarServicio = async () => {
    const codigo = normCodigoServ(servNuevo.codigo);
    if (codigo.length < 2 || codigo.length > 30) { setError("El código del servicio debe tener entre 2 y 30 caracteres."); return; }
    if (serviciosCat.some(x => x.codigo === codigo)) { setError(`El servicio ${codigo} ya existe.`); return; }
    setServGuardando("__nuevo__");
    try {
      await api("servicios_tarifa", { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ codigo, descripcion: servNuevo.descripcion.trim() || null,
          orden: Math.max(0, ...serviciosCat.map(x => x.orden || 0)) + 10, creado_por: analista }) });
      setServNuevo({ codigo: "", descripcion: "" });
      await cargarTarifario();
      setTarifaMsg(`Servicio ${codigo} agregado`); setTimeout(() => setTarifaMsg(""), 3000);
    } catch (e) { setError(errorServicio(e)); }
    finally { setServGuardando(null); }
  };
  const actualizarServicio = async (codigo, campos) => {
    setServGuardando(codigo);
    try {
      await api(`servicios_tarifa?codigo=eq.${encodeURIComponent(codigo)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(campos) });
      await cargarTarifario();
    } catch (e) { setError(errorServicio(e)); }
    finally { setServGuardando(null); }
  };

  const crearTarifa = async () => {
    const t = tarifaNueva;
    if (!t.servicio || !t.tipo_pago || !t.tipo_vehiculo || t.tarifa_oficial === "") {
      setError("Tarifa nueva: faltan servicio, tipo de pago, vehículo o el monto oficial."); return;
    }
    // la base exige ambos datos en PISO (regla tarifas_piso_chk): se avisa antes de enviar
    const esPiso = t.tipo_pago === "PISO";
    if (esPiso && (t.entregas_base === "" || t.tarifa_adicional === "")) {
      setError("Tarifa PISO: indica cuántas entregas cubre el piso y el $ por cada entrega adicional " +
               "(si es un monto fijo, pon 0 en ambos)."); return;
    }
    setTarifaGuardando("__nueva__");
    try {
      await api("tarifas", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          cecos_admin: t.cecos_admin || null,
          segmentacion: t.segmentacion || null,
          servicio: t.servicio, tipo_pago: t.tipo_pago,
          detalle: t.detalle || null, tipo_vehiculo: t.tipo_vehiculo,
          tarifa_oficial: Number(t.tarifa_oficial),
          tarifa_contingencia: t.tarifa_contingencia === "" ? Number(t.tarifa_oficial) : Number(t.tarifa_contingencia),
          cobrar_oficial: t.cobrar_oficial === "" ? null : Number(t.cobrar_oficial),
          cobrar_contingencia: t.cobrar_contingencia === "" ? null : Number(t.cobrar_contingencia),
          entregas_base: esPiso ? Math.round(Number(t.entregas_base)) : null,
          tarifa_adicional: esPiso ? Number(t.tarifa_adicional) : null,
          vigente_desde: t.vigente_desde || undefined,
          nota: t.nota || "Creada desde el Brain.",
          actualizado_por: "brain",
        }),
      });
      setTarifaNueva(null);
      await cargarTarifario();
      setTarifaMsg("Tarifa creada"); setTimeout(() => setTarifaMsg(""), 3000);
    } catch (e) { setError(errorTarifa(e)); }
    finally { setTarifaGuardando(null); }
  };

  const guardarVehiculo = async (patente, campos, esNuevo) => {
    setVehGuardando(patente);
    try {
      if (esNuevo) {
        await api("tipo_vehiculo_bt", { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ patente, ...campos, actualizado_por: "brain" }) });
      } else {
        await api(`tipo_vehiculo_bt?patente=eq.${encodeURIComponent(patente)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ...campos, actualizado_at: new Date().toISOString(),
                                 actualizado_por: "brain" }) });
      }
      setVehEdit(e => { const n = { ...e }; delete n[patente]; return n; });
      await cargarVehiculos();
      setVehMsg(`${patente} guardada`); setTimeout(() => setVehMsg(""), 3000);
    } catch (e) { setError(e.message); }
    finally { setVehGuardando(null); }
  };

  // ── Agregar una patente ──
  const agregarVehiculo = async () => {
    const pat = vehNueva.patente.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z0-9]{5,8}$/.test(pat)) { setError("Patente inválida: usa entre 5 y 8 letras o números, sin guiones (ej. SLXZ99)."); return; }
    if (vehiculos.some(v => v.patente === pat)) { setError(`La patente ${pat} ya está en la lista: edítala ahí.`); return; }
    await guardarVehiculo(pat, { proyecto: vehNueva.proyecto, activo: true, nota: "Agregada desde el Brain." }, true);
    setVehNueva(x => ({ ...x, patente: "" }));
  };

  // ── Eliminar una patente ──
  // Pide el resultado del borrado: si la base devuelve una lista vacía, no se
  // borró nada (falta el permiso de la migración 52) y se avisa en vez de
  // mostrar un falso "eliminada".
  const eliminarVehiculo = async (v) => {
    if (!window.confirm(
      `¿Eliminar la patente ${v.patente} (${v.proyecto}) de Vehículos BT?\n\n` +
      `Si alguna vez hace un viaje con nosotros, se pagará como COMBUSTION (regla oficial).\n` +
      `El borrado queda registrado y se puede deshacer volviendo a agregarla.`)) return;
    setVehGuardando(v.patente);
    try {
      const r = await api(`tipo_vehiculo_bt?patente=eq.${encodeURIComponent(v.patente)}`, {
        method: "DELETE", headers: { Prefer: "return=representation" } });
      if (Array.isArray(r) && r.length === 0)
        throw new Error(`No se eliminó ${v.patente}: la base no lo permitió (falta correr la migración 52).`);
      await cargarVehiculos();
      setVehMsg(`${v.patente} eliminada`); setTimeout(() => setVehMsg(""), 3000);
    } catch (e) { setError(e.message); }
    finally { setVehGuardando(null); }
  };

  const crearZona = async () => {
    const z = zonaNueva;
    if (!z.nombre || !z.cecos || !z.segmentacion || !z.lat || !z.lon) {
      setError("Zona nueva: completa nombre, código, segmentación y coordenadas."); return;
    }
    setZonaGuardando("__nueva__");
    try {
      await api("rpc/crear_zona_pago", { method: "POST", body: JSON.stringify({
        p_nombre: z.nombre, p_cecos: z.cecos, p_segmentacion: z.segmentacion,
        p_lat: Number(z.lat), p_lon: Number(z.lon), p_radio_m: Number(z.radio) || 5000,
        p_nota: z.nota || null }) });
      setZonaNueva(null);
      await cargarZonas();
    } catch (e) { setError(e.message); }
    finally { setZonaGuardando(null); }
  };

  const moverZona = async (id, lat, lon, radio) => {
    await api("rpc/mover_zona_pago", { method: "POST", body: JSON.stringify({
      p_id: id, p_lat: Number(lat), p_lon: Number(lon), p_radio_m: radio ? Number(radio) : null }) });
  };

  const guardarOverride = async () => {
    if (!ovr.id_viaje || !ovr.segmentacion || !ovr.motivo || ovr.motivo.trim().length < 5) {
      setError("La corrección necesita: ID de viaje, segmentación y un motivo (mínimo 5 caracteres)."); return;
    }
    setOvrGuardando(true);
    try {
      await api("viaje_zona_override?on_conflict=fecha,id_ruta", {
        method: "POST",
        headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
        body: JSON.stringify({ fecha, id_ruta: Number(ovr.id_viaje),
          segmentacion: ovr.segmentacion, motivo: ovr.motivo.trim(), creado_por: "brain" }),
      });
      setOvr(null);
      await cargarPago();
    } catch (e) { setError(e.message); }
    finally { setOvrGuardando(false); }
  };

  // ── Operación y supervisor de una patente (vehiculo_operacion) ──
  const guardarFilaVehiculo = async (patente, tarifa, op, ed) => {
    setVehGuardando(patente);
    try {
      // clasificación de tarifa: alta si no existía, cambio si existía
      if (ed.proyecto && !tarifa) {
        await api("tipo_vehiculo_bt", { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ patente, proyecto: ed.proyecto, activo: true,
                                 nota: "Clasificada desde el Brain.", actualizado_por: "brain" }) });
      } else if (tarifa && ed.proyecto && (ed.proyecto !== tarifa.proyecto || !!ed.activo !== !!tarifa.activo)) {
        await api(`tipo_vehiculo_bt?patente=eq.${encodeURIComponent(patente)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ proyecto: ed.proyecto, activo: !!ed.activo,
                                 actualizado_at: new Date().toISOString(), actualizado_por: "brain" }) });
      }
      // operación y supervisor
      const cec = ed.cecos_operacion || null;
      const sid = ed.supervisor_id ? Number(ed.supervisor_id) : null;
      if (cec !== (op?.cecos_operacion || null) || sid !== (op?.supervisor_id || null)) {
        await api("vehiculo_operacion?on_conflict=patente", { method: "POST",
          headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
          body: JSON.stringify({ patente, cecos_operacion: cec, supervisor_id: sid,
                                 actualizado_at: new Date().toISOString(), actualizado_por: analista }) });
      }
      setVehEdit(e => { const n = { ...e }; delete n[patente]; return n; });
      await cargarVehiculos();
      setVehMsg(`${patente} guardada`); setTimeout(() => setVehMsg(""), 3000);
    } catch (e) { setError(e.message); }
    finally { setVehGuardando(null); }
  };

  // ── Subir el informe de Pipefy "Vehículos Bigticket" (.xlsx) ──
  // Se lee en el navegador (exceljs se carga solo en este momento) y se envía a
  // cargar_vehiculos_pipefy, la misma función de la carga inicial (migración 65).
  const subirPipefy = async (archivo) => {
    if (!archivo) return;
    setVehGuardando("__pipefy__"); setVehMsg("");
    try {
      const ExcelJS = (await import("exceljs")).default;
      const libro = new ExcelJS.Workbook();
      await libro.xlsx.load(await archivo.arrayBuffer());
      const hoja = libro.worksheets[0];
      if (!hoja) throw new Error("El archivo no tiene hojas.");
      const enc = [];
      hoja.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { enc[i] = String(c.text || "").trim(); });
      if (!enc.includes("Patente") || !enc.includes("Centro de Costo") || !enc.includes("Supervisor Encargado"))
        throw new Error("No parece el informe de Pipefy: faltan las columnas Patente, Centro de Costo o Supervisor Encargado.");
      const filas = [];
      hoja.eachRow((fila, n) => {
        if (n === 1) return;
        const o = {};
        fila.eachCell({ includeEmpty: true }, (c, i) => { if (enc[i]) o[enc[i]] = String(c.text ?? "").trim() || null; });
        if (o["Patente"]) filas.push(o);
      });
      if (!filas.length) throw new Error("El informe no trae filas con patente.");
      if (!window.confirm(`Se cargarán ${filas.length} filas del informe de Pipefy.\n\n` +
            `La operación y el supervisor de cada patente se reemplazan por los del informe ` +
            `(la clasificación de tarifa no se toca). Los supervisores que no existan se crean.\n\n¿Continuar?`)) return;
      const r = await api("rpc/cargar_vehiculos_pipefy", { method: "POST",
        body: JSON.stringify({ filas, p_usuario: analista }) });
      await cargarVehiculos();
      const desc = (r && r.descartadas) || [];
      setVehMsg(`Pipefy: ${r.vehiculos_nuevos} patentes nuevas, ${r.vehiculos_actualizados} actualizadas, ` +
                `${r.supervisores_nuevos} supervisores nuevos` +
                (desc.length ? ` · omitidas ${desc.length} filas sin patente válida (${desc.join(", ")})` : ""));
    } catch (e) { setError("Carga de Pipefy: " + e.message); }
    finally { setVehGuardando(null); }
  };

  // ── Mantenedor de supervisores ──
  const errorSup = (e) => {
    const m = String((e && e.message) || e || "");
    if (m.includes("supervisores_cl_nombre_uq") || m.includes("23505")) return "Ya existe un supervisor con ese nombre.";
    if (m.includes("supervisores_cl_nombre_chk")) return "El nombre del supervisor debe tener al menos 3 letras.";
    return m;
  };
  const agregarSupervisor = async () => {
    const nombre = supNuevo.nombre.trim().replace(/\s+/g, " ");
    if (nombre.length < 3) { setError("El nombre del supervisor debe tener al menos 3 letras."); return; }
    if (supervisores.some(x => x.nombre.trim().toUpperCase() === nombre.toUpperCase())) {
      setError(`Ya existe el supervisor ${nombre}.`); return; }
    setSupGuardando("__nuevo__");
    try {
      await api("supervisores_cl", { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ nombre, correo: supNuevo.correo.trim() || null,
                               telefono: supNuevo.telefono.trim() || null, actualizado_por: analista }) });
      setSupNuevo({ nombre: "", correo: "", telefono: "" });
      await cargarVehiculos();
      setVehMsg(`Supervisor ${nombre} agregado`); setTimeout(() => setVehMsg(""), 3000);
    } catch (e) { setError(errorSup(e)); }
    finally { setSupGuardando(null); }
  };
  const actualizarSupervisor = async (id, campos) => {
    setSupGuardando(id);
    try {
      await api(`supervisores_cl?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ...campos, actualizado_at: new Date().toISOString(), actualizado_por: analista }) });
      await cargarVehiculos();
    } catch (e) { setError(errorSup(e)); }
    finally { setSupGuardando(null); }
  };

  // Carga masiva de vehículos: "PATENTE, TIPO" por línea.
  const TIPOS_VEH = ["ELECTRICA", "BIG VAN", "COMBUSTION LARGE VAN", "COMBUSTION"];
  const cargarVehMasivo = async () => {
    const filas = vehMasivo.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const [pat, tipo] = l.split(/[,;\t]/).map(x => (x || "").trim().toUpperCase());
      return { patente: pat, proyecto: tipo };
    }).filter(fl => /^[A-Z0-9]{5,8}$/.test(fl.patente) && TIPOS_VEH.includes(fl.proyecto));
    if (!filas.length) { setError("Formato: PATENTE, TIPO (ELECTRICA / BIG VAN / COMBUSTION LARGE VAN)"); return; }
    setVehGuardando("__masivo__");
    try {
      await api("tipo_vehiculo_bt?on_conflict=patente", {
        method: "POST",
        headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
        body: JSON.stringify(filas.map(fl => ({ ...fl, actualizado_por: "brain",
          nota: "Carga masiva desde el Brain." }))),
      });
      setVehMasivo(""); await cargarVehiculos();
      setVehMsg(`${filas.length} patentes cargadas`); setTimeout(() => setVehMsg(""), 4000);
    } catch (e) { setError(e.message); }
    finally { setVehGuardando(null); }
  };

  const guardarZona = async (id, campos) => {
    setZonaGuardando(id);
    try {
      await api(`zonas_pago?id=eq.${id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ ...campos, actualizado_at: new Date().toISOString(),
                               actualizado_por: "brain" }),
      });
      setZonaEdit(e => { const n = { ...e }; delete n[id]; return n; });
      await cargarZonas();
    } catch (e) { setError(e.message); }
    finally { setZonaGuardando(null); }
  };

  const guardarCeco = async (codigo, campos, esNuevo) => {
    setCecosGuardando(codigo);
    try {
      if (esNuevo) {
        await api("cecos", { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ codigo, fuente: "manual", ...campos,
                                 actualizado_por: "brain", actualizado_at: new Date().toISOString() }) });
      } else {
        await api(`cecos?codigo=eq.${encodeURIComponent(codigo)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ...campos, actualizado_por: "brain",
                                 actualizado_at: new Date().toISOString() }) });
      }
      setCecosEdit(e => { const n = { ...e }; delete n[codigo]; return n; });
      await cargarCecos();
      setCecosMsg(`${codigo} guardado`);
      setTimeout(() => setCecosMsg(""), 3000);
    } catch (e) { setError(e.message); }
    finally { setCecosGuardando(null); }
  };

  // Carga masiva: un código por línea, opcionalmente "CODIGO, NOMBRE_ADMIN".
  const cargarCecosMasivo = async () => {
    const lineas = cecosMasivo.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lineas.length) return;
    const filas = lineas.map(l => {
      const [cod, adm] = l.split(/[,;\t]/).map(x => (x || "").trim());
      return { codigo: cod.toUpperCase(), nombre_admin: adm ? adm.toUpperCase() : null,
               fuente: "masivo", actualizado_por: "brain" };
    }).filter(f => /^[A-Z0-9_]{2,12}$/.test(f.codigo));
    if (!filas.length) { setError("Ningún código válido en la carga (formato: CODIGO o CODIGO, ML_NOMBRE)"); return; }
    setCecosGuardando("__masivo__");
    try {
      // 1) los códigos MELI al catálogo
      await api("cecos?on_conflict=codigo", {
        method: "POST",
        headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
        body: JSON.stringify(filas.map(({ codigo, fuente, actualizado_por }) =>
          ({ codigo, fuente, actualizado_por }))),
      });
      // 2) los pares "CODIGO, ML_NOMBRE" además crean el cecos administrativo
      //    (relación N a 1: varios admin pueden colgar del mismo código)
      const admin = filas.filter(fl => fl.nombre_admin)
        .map(fl => ({ nombre: fl.nombre_admin, codigo_meli: fl.codigo, actualizado_por: "brain" }));
      if (admin.length) {
        await api("cecos_admin?on_conflict=nombre,codigo_meli", {
          method: "POST",
          headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
          body: JSON.stringify(admin),
        });
      }
      setCecosMasivo("");
      await cargarCecos();
      setCecosMsg(`${filas.length} CECOS cargados`);
      setTimeout(() => setCecosMsg(""), 4000);
    } catch (e) { setError(e.message); }
    finally { setCecosGuardando(null); }
  };

  // Contenido de la tarjeta "Por revisar": el recuadre y las cinco categorías.
  const Seccion = ({ titulo, nota, columnas, filas, vacio }) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, color: "#8a94a6", fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: .4, marginBottom: 4 }}>{titulo}</div>
      {nota && <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginBottom: 6, maxWidth: 880 }}>{nota}</div>}
      {filas.length === 0
        ? <div style={{ fontSize: 12.5, color: "#94a3b8", fontStyle: "italic" }}>{vacio}</div>
        : <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid #eef1f5", borderRadius: 8 }}>
            <table className="mj-tabla" style={{ fontSize: 11.5 }}>
              <thead><tr>{columnas.map((c, j) => (
                <th key={j} style={c.num ? { textAlign: "right" } : undefined}>{c.t}</th>))}</tr></thead>
              <tbody>{filas.map((f, i) => (
                <tr key={i}>{f.map((v, j) => (
                  <td key={j} className={columnas[j] && columnas[j].num ? "num" : ""}
                      style={j === 0 ? { fontWeight: 600 } : undefined}>{v}</td>))}</tr>))}</tbody>
            </table>
          </div>}
    </div>
  );

  const PanelRevisar = () => (
    <Fragment>
      {/* recuadre del día completo */}
      <div style={{ background: aCuadrar.length ? "#fdf6e3" : "#e7f6ec",
                    border: `1px solid ${aCuadrar.length ? "#f3e2b8" : "#c9e6d4"}`,
                    borderRadius: 9, padding: "11px 14px", display: "flex",
                    alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: aCuadrar.length ? AMBAR_ : VERDE_ }}>
            {aCuadrar.length
              ? `${fmt(aCuadrar.length)} ${aCuadrar.length === 1 ? "viaje se puede" : "viajes se pueden"} recuadrar · ${fecha}`
              : `La jornada del ${fecha} está cuadrada`}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 2 }}>
            {aCuadrar.length
              ? "Vuelve a consultarlos en MELI para que el contador y el detalle salgan de la misma lectura. Lo ejecuta el monitor en su siguiente pasada: hasta 5 minutos. También puedes recuadrar de a uno con el botón de cada fila."
              : "No hay viajes cerrados con inconsistencias."}
          </div>
          {recuadre && (
            <div style={{ fontSize: 12, marginTop: 6, color:
                recuadre.estado === "error" ? ROJO_ :
                ["listo","sin_trabajo"].includes(recuadre.estado) ? VERDE_ :
                recuadre.estado === "cancelada" ? GRIS_ : AMBAR_ }}>
              {recuadre.estado === "pendiente"   && `⏳ Pedido a las ${recuadre.solicitado_chile} · esperando al monitor (hace ${fmt(recuadre.hace_minutos)} min)`}
              {recuadre.estado === "en_proceso"  && `🔧 Consultando MELI · ${fmt(recuadre.rutas_procesadas)} de ${fmt(recuadre.rutas_objetivo)}`}
              {recuadre.estado === "listo"       && `✅ Recuadrado a las ${recuadre.terminado_chile} · ${recuadre.detalle}`}
              {recuadre.estado === "sin_trabajo" && `✅ Revisado a las ${recuadre.terminado_chile} · no había nada que cuadrar`}
              {recuadre.estado === "error"       && `❌ Falló · ${recuadre.detalle}`}
              {recuadre.estado === "cancelada"   && `⊘ Pedido anterior cancelado`}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 172 }}>
          <button className="mj-btn" onClick={pedirRecuadre}
                  disabled={pidiendo || aCuadrar.length === 0 ||
                            (recuadre && ["pendiente","en_proceso"].includes(recuadre.estado))}
                  style={{ background: (aCuadrar.length && !pidiendo &&
                             !(recuadre && ["pendiente","en_proceso"].includes(recuadre.estado))) ? NAVY : "#fff",
                           color: (aCuadrar.length && !pidiendo &&
                             !(recuadre && ["pendiente","en_proceso"].includes(recuadre.estado))) ? "#fff" : "#b6bfcc",
                           borderColor: aCuadrar.length ? NAVY : "#dfe4ec",
                           cursor: aCuadrar.length ? "pointer" : "not-allowed", padding: "7px 12px" }}>
            {pidiendo ? "Enviando…"
              : (recuadre && ["pendiente","en_proceso"].includes(recuadre.estado)) ? "Ya está en curso"
              : aCuadrar.length === 0 ? "Nada que cuadrar"
              : `Recuadrar ${fmt(aCuadrar.length)}`}
          </button>
          <button className="mj-btn" onClick={recargar} disabled={recargando} style={{ padding: "5px 12px" }}>
            {recargando ? "Leyendo…" : "Recargar datos"}
          </button>
          {leidoAt && <div style={{ fontSize: 10, color: "#a8b2c1" }}>leído {horaChile(leidoAt.toISOString())}</div>}
        </div>
      </div>

      <Seccion titulo={`Paquetes sin resolver · ${fmt(n(tot.pendientes))} en ${fmt(jornadaVista.filter(r => n(r.pendientes) > 0).length)} viajes`}
        nota="Salieron a la calle y no hay registro de entrega ni de devolución. Si después de recuadrar el número no baja, el dato ya es correcto: son paquetes que de verdad nunca se resolvieron."
        columnas={[{ t: "ID Viaje" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Cargados", num: true },
                   { t: "Entregados", num: true }, { t: "Devueltos", num: true }, { t: "Pendientes", num: true }, { t: "" }]}
        filas={jornadaVista.filter(r => n(r.pendientes) > 0)
          .sort((a, b) => n(b.pendientes) - n(a.pendientes))
          .map(r => [r.id_viaje, r.cecos, r.conductor || "—", fmt(r.cargados), fmt(r.entregados),
                     fmt(r.devueltos), fmt(r.pendientes), <BotonRuta idRuta={r.id_viaje} />])}
        vacio="Ningún viaje quedó con paquetes sin resolver." />

      <Seccion titulo={`Conteos que no calzan · ${fmt(nDescuadrados)} viajes`}
        nota="El contador de MELI difiere de los paquetes del detalle. Si la diferencia es POSITIVA (el detalle tiene más), recuadrar lo sincroniza. Si es NEGATIVA, revisar: puede haber envíos de varias piezas contados distinto."
        columnas={[{ t: "ID Viaje" }, { t: "CECOS" }, { t: "MELI dice", num: true },
                   { t: "Detalle tiene", num: true }, { t: "Diferencia", num: true }, { t: "" }]}
        filas={jornadaVista.filter(r => r.detalle_descuadrado && !r.ruta_vacia)
          .sort((a, b) => Math.abs(n(b.entregados_detalle) - n(b.entregados_meli)) -
                          Math.abs(n(a.entregados_detalle) - n(a.entregados_meli)))
          .map(r => [r.id_viaje, r.cecos, fmt(r.entregados_meli), fmt(r.entregados_detalle),
                     (n(r.entregados_detalle) - n(r.entregados_meli) > 0 ? "+" : "") +
                       fmt(n(r.entregados_detalle) - n(r.entregados_meli)),
                     <BotonRuta idRuta={r.id_viaje} />])}
        vacio="Todos los conteos calzan." />

      <Seccion titulo={`Sin detalle bajado · ${fmt(nSinDetalle)} viajes`}
        nota="El detalle se baja al cerrar cada ruta y en la pasada de las 00:30. Durante el día en curso es normal verlos."
        columnas={[{ t: "ID Viaje" }, { t: "CECOS" }, { t: "Cargados", num: true }, { t: "Estado" }, { t: "" }]}
        filas={jornadaVista.filter(r => r.sin_detalle && !r.ruta_vacia)
          .map(r => [r.id_viaje, r.cecos, fmt(r.cargados), r.status || "—",
                     r.status === "close" ? <BotonRuta idRuta={r.id_viaje} />
                       : <span style={{ fontSize: 10.5, color: "#a8b2c1" }}>aún en ruta</span>])}
        vacio="Todos los viajes tienen su detalle." />

      <Seccion titulo={`Viajes abiertos · ${fmt(nAbiertas)}`}
        nota="El conductor todavía no los cerró en MELI. No se arreglan recuadrando: hay que pedirle que cierre. Mientras sigan abiertos, su cierre no se guarda y pueden aparecer descuadrados."
        columnas={[{ t: "ID Viaje" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Estado" },
                   { t: "Cargados", num: true }, { t: "Entregados", num: true }, { t: "Pendientes", num: true }]}
        filas={jornadaVista.filter(r => r.status !== "close" && !r.ruta_vacia)
          .sort((a, b) => n(b.pendientes) - n(a.pendientes))
          .map(r => [r.id_viaje, r.cecos, r.conductor || "—", r.status,
                     fmt(r.cargados), fmt(r.entregados), fmt(r.pendientes)])}
        vacio="Todos los viajes del día quedaron cerrados." />

      <Seccion titulo={`Viajes vacíos · ${fmt(nVacias)}`}
        nota="MELI los creó y cerró sin asignarles carga. No son operación ni no salidas a ruta: es ruido del sistema. No se pueden recuadrar porque no hay detalle que bajar."
        columnas={[{ t: "ID Viaje" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Cargados", num: true }, { t: "Estado" }]}
        filas={jornada.filter(r => r.ruta_vacia)
          .map(r => [r.id_viaje, r.cecos, r.conductor || "—", fmt(r.cargados), r.status || "—"])}
        vacio="MELI no creó viajes vacíos este día." />
    </Fragment>
  );

  // Mientras el recuadre está en curso, refrescar solo para ver el avance.
  useEffect(() => {
    const diaEnCurso = recuadre && ["pendiente", "en_proceso"].includes(recuadre.estado);
    const rutaEnCurso = Object.values(recRuta).some(x => ["pendiente", "en_proceso"].includes(x.estado));
    if (!diaEnCurso && !rutaEnCurso) return;
    const id = setInterval(() => { recargar().catch(() => {}); }, 30000);
    return () => clearInterval(id);
  }, [recuadre, recRuta, fecha]);

  // Filtros en cliente
  const texto = busca.trim().toLowerCase();
  const coincide = (...campos) => !texto || campos.some(c => String(c ?? "").toLowerCase().includes(texto));
  // Cada viaje con su CECOS real, segmentación y alerta del motor de zonas.
  // centro_meli guarda el código del centro de MELI (SRM1, SIL1…) que antes se mostraba como CECOS.
  const jornadaZ = jornada.map(r => {
    const z = zonaRuta[String(r.id_viaje)];
    return { ...r, centro_meli: r.cecos, cecos_real: z?.cecos_admin || null,
             segmentacion: z?.segmentacion || null, zona_pago: z?.zona_principal || null,
             alerta_zona: z?.alerta || null, origen_zona: z?.origen_zona || null,
             cecos_fuente: z?.cecos_fuente || null,
             // por patente (Vehículos BT); si no, el supervisor a cargo del CECO (bitácora)
             supervisor: vehSup[normPatente(r.patente)]?.supervisor || (z?.cecos_admin && supCeco[z.cecos_admin]) || null,
             supervisor_fuente: vehSup[normPatente(r.patente)]?.supervisor ? "patente"
                              : (z?.cecos_admin && supCeco[z.cecos_admin]) ? "ceco" : null,
             empresa: certPat[normPatente(r.patente)]?.tercero || null,
             empresa_rut: certPat[normPatente(r.patente)]?.rut_tercero || null,
             empresa_estado: certPat[normPatente(r.patente)]?.estado || null,
             ...(() => {
               const t = tipoRuta[String(r.id_viaje)];
               // sin dato del día (ruta que no pasó por las fotos): lo que informa MELI en el maestro
               const base = r.tipo === "melione" ? "MELI ONE" : r.tipo === "last_mile" ? "UM" : null;
               return { tipo_ruta: t ? t.tipo_ruta : base, estado_tipo: t ? t.estado_tipo : (base ? "detectado" : null),
                        tipo_sugerido: t ? t.tipo_sugerido : base, tipo_por: t?.confirmado_por || null,
                        tipo_rol: t?.rol || null, nombre_ruta: t?.nombre_ruta || null,
                        no_planificada: !!t?.no_planificada, con_ambulancia: !!t?.con_ambulancia };
             })(),
             servicio_txt: r.tipo === "melione" ? "MELI ONE" : r.tipo === "last_mile" ? "ULTIMA MILLA" : (r.tipo_servicio || "") };
  });
  const jornadaVista = jornadaZ
    // Tolerante a NULL a propósito: una ruta sin clasificar se trata como última
    // milla en vez de desaparecer de la vista sin explicación.
    .filter(r => (!soloReparto || r.is_line_haul !== true))
    .filter(r => (tipoServicio === "todos" || r.tipo_servicio === tipoServicio))
    .filter(r => !cecos || (r.cecos_real || r.centro_meli) === cecos)
    .filter(r => coincide(r.id_viaje, r.patente, r.conductor, r.cecos_real, r.centro_meli, r.segmentacion, r.supervisor, r.empresa,
                          r.tipo_ruta ? etiquetaTipo(r.tipo_ruta).t : (r.estado_tipo === "por_confirmar" ? "no planificada" : ""),
                          r.comuna_primera_parada, r.comuna_ultima_parada, r.ciclo));
  const devolVista = devol
    .filter(r => !cecos || r.cecos === cecos)
    .filter(r => coincide(r.id_viaje, r.folio_guia, r.patente, r.conductor, r.motivo, r.comuna, r.receptor));
  const traspVista = trasp
    .filter(r => !cecos || r.sc_origen === cecos || r.sc_destino === cecos)
    .filter(r => coincide(r.ruta_origen, r.ruta_destino, r.chofer_origen, r.chofer_destino, r.patente_origen, r.patente_destino));

  // En Jornada se filtra por CECOS real; en Devoluciones y Traspasos, por centro de MELI.
  const listaCecos = tab === "jornada"
    ? [...new Set(jornadaZ.map(r => r.cecos_real || r.centro_meli).filter(Boolean))].sort()
    : [...new Set(jornada.map(r => r.cecos).filter(Boolean))].sort();
  const nLineHaul = jornada.filter(r => r.is_line_haul === true).length;
  // MELI distingue last_mile de melione (MELI ONE) en el campo tipo.
  const tiposServicio = [...new Set(jornada.map(r => r.tipo_servicio).filter(Boolean))].sort();
  const nMeliOne = jornada.filter(r => r.tipo === "melione").length;
  const nSinClasificar = jornada.filter(r => r.is_line_haul === null || r.is_line_haul === undefined).length;
  // Rutas que el chofer todavía no cerró. Durante el día debe ir bajando a 0.
  // Las que quedan abiertas al cierre son la causa más común del descuadre.
  const nAbiertas = jornadaVista.filter(r => r.status !== "close" && !r.ruta_vacia).length;
  const nVacias   = jornada.filter(r => r.ruta_vacia === true).length;

  // Totales de lo que se está viendo (respetan los filtros)
  const tot = jornadaVista.reduce((a, r) => ({
    cargados: a.cargados + n(r.cargados), entregados: a.entregados + n(r.entregados),
    devueltos: a.devueltos + n(r.devueltos), dj: a.dj + n(r.d_justificados),
    paradas: a.paradas + n(r.paradas), pendientes: a.pendientes + n(r.pendientes),
  }), { cargados: 0, entregados: 0, devueltos: 0, dj: 0, paradas: 0, pendientes: 0 });
  const pct = tot.cargados ? (100 * tot.entregados / tot.cargados).toFixed(1) : null;
  // Dos cosas distintas, antes mezcladas en un solo contador:
  // Se excluyen las rutas vacías: nunca van a tener detalle porque nunca tuvieron
  // paquetes, así que aparecerían en "Falta detalle" para siempre sin que se pueda
  // hacer nada. Van en su propio contador.
  const nSinDetalle   = jornadaVista.filter(r => r.sin_detalle === true && !r.ruta_vacia).length;
  const nDescuadrados = jornadaVista.filter(r => r.detalle_descuadrado === true && !r.ruta_vacia).length;

  const motivos = Object.entries(devolVista.reduce((a, r) => {
    const k = r.motivo || "(sin motivo)"; a[k] = (a[k] || 0) + 1; return a;
  }, {})).sort((a, b) => b[1] - a[1]);

  // ── Tarjetas: valor + explicación + desglose ─────────────────────────────
  const porCecos = (titulo, valorFn, rotuloCol) => () => ({
    titulo, columnas: [{ t: "CECOS" }, { t: rotuloCol, num: true }],
    filas: agrupar(jornadaVista, "cecos", valorFn).map(([k, v]) => [k, fmt(v)]),
  });

  const KPIS = [
    {
      id: "viajes", rotulo: "Viajes", color: NAVY,
      valor: fmt(jornadaVista.length),
      detalle: (tipoServicio !== "todos" ? tipoServicio : (soloReparto ? "última milla" : `incluye ${fmt(nLineHaul)} line haul`))
        + (nMeliOne && tipoServicio === "todos" ? ` · ${fmt(nMeliOne)} MELI ONE` : ""),
      que: "Cada ruta que MELI generó para el día. Un viaje equivale a una fila del maestro: un vehículo con su conductor haciendo un recorrido.",
      como: soloReparto
        ? `Se cuentan solo las rutas de última milla, las que reparten a clientes. Quedan fuera ${fmt(nLineHaul)} de Line Haul, que son transferencias entre centros; para verlas, activa "Incluir Line Haul".`
        : `Se cuentan todas las rutas: ${fmt(jornadaVista.length - nLineHaul)} de última milla más ${fmt(nLineHaul)} de Line Haul (transferencias entre centros, que no reparten a clientes).`,
      desglose: porCecos("Viajes por CECOS", () => 1, "Viajes"),
    },
    {
      id: "cargados", rotulo: "Cargados", color: NAVY,
      valor: fmt(tot.cargados), detalle: `${fmt(tot.paradas)} paradas`,
      que: "Paquetes que salieron a la calle en estos viajes. Es el volumen con el que arrancó la jornada.",
      como: "Es el total de paquetes que MELI asigna a cada ruta (su propio contador). En el Excel corresponde a la columna CARGADOS.",
      desglose: porCecos("Paquetes cargados por CECOS", r => n(r.cargados), "Cargados"),
    },
    {
      id: "entregados", rotulo: "Entregados", color: "#0d8043",
      valor: fmt(tot.entregados), detalle: pct ? `${pct}% de lo cargado` : null,
      que: "Paquetes que llegaron a su destino y quedaron con entrega confirmada.",
      como: "Se cuentan los paquetes que el detalle de cada ruta marcó como entregados. Cuando el detalle todavía no ha corrido (día en curso), se usa el contador de MELI, que va más atrasado.",
      desglose: porCecos("Paquetes entregados por CECOS", r => n(r.entregados), "Entregados"),
    },
    {
      id: "devueltos", rotulo: "Devueltos", color: "#b42318",
      valor: fmt(tot.devueltos), detalle: "paquetes que no se entregaron",
      que: "Devoluciones reales: paquetes que volvieron sin entregarse, con un motivo (negocio cerrado, nadie en el domicilio, zona inaccesible…).",
      como: "Del total de paquetes no entregados se descuentan dos grupos que no son devoluciones: los que se traspasaron a otra ruta, y los que fallaron en un momento del día pero se entregaron más tarde. Este es el número que coincide con el contador de Fallidos del portal de MELI.",
      desglose: () => ({
        titulo: "Devoluciones por motivo",
        columnas: [{ t: "Motivo" }, { t: "Paquetes", num: true }],
        filas: motivos.map(([m, c]) => [m, fmt(c)]),
        vacio: "Sin devoluciones en este día. El detalle de cada folio está en la pestaña Devoluciones.",
      }),
    },
    {
      id: "traspasos", rotulo: "Traspasos", color: ORANGE,
      valor: fmt(tot.dj), detalle: "paquetes que pasaron a otra ruta",
      que: "Paquetes que salieron en una ruta y se pasaron a otra durante el día. No son devoluciones: la ruta que los recibió normalmente los entrega. En el Excel se registran como D_JUSTIFICADOS.",
      como: "Son los paquetes marcados como transferidos, y de cada uno se conoce la ruta de destino. La pestaña Traspasos muestra la traza completa: ruta, conductor y patente de origen y de destino.",
      desglose: () => ({
        titulo: "Rutas que más traspasaron",
        columnas: [{ t: "Ruta origen" }, { t: "Conductor" }, { t: "Paquetes", num: true }],
        filas: [...traspVista]
          .sort((a, b) => n(b.paquetes) - n(a.paquetes)).slice(0, 15)
          .map(t => [t.ruta_origen, t.chofer_origen || "—", fmt(t.paquetes)]),
        vacio: "Sin traspasos registrados en este día.",
      }),
    },
    {
      id: "revisar",
      rotulo: "Por revisar",
      color: (aCuadrar.length || nAbiertas) ? AMBAR_ : VERDE_,
      alerta: aCuadrar.length > 0,
      valor: fmt(aCuadrar.length),
      detalle: aCuadrar.length
        ? `${fmt(n(tot.pendientes))} paq. sin resolver · ${fmt(nDescuadrados)} descuadrados`
        : "la jornada está cuadrada",
      que: "Reúne todo lo que amerita revisión de la jornada: viajes con paquetes sin resolver, con conteos que no calzan, sin detalle bajado, todavía abiertos, y los que MELI creó vacíos. Desde aquí también se puede volver a consultarlos en MELI.",
      como: "El número grande son los VIAJES que se pueden recuadrar (cerrados con alguna inconsistencia). Los abiertos y los vacíos se listan aparte porque no se arreglan recuadrando.",
      render: () => <PanelRevisar />,
    },
];

  const ORIGEN_ZONA = {
    punto_lejano: "Punto más lejano", otro_centro: "Zona de otro centro",
    punto_alternativo: "Punto alternativo", comuna_historica: "Comuna histórica",
    sin_zona: "Sin zona", analista: "Analista", aprendido: "Aprendido del analista", meli: "Lo informa MELI",
  };
  const ESTADO_REV = {
    pendiente:           { t: "Pendiente",           c: AMBAR_, f: "#fdf6e3" },
    supervisor_coincide: { t: "Supervisor coincide", c: VERDE_, f: "#e8f5ee" },
    supervisor_discrepa: { t: "Supervisor discrepa", c: ROJO_,  f: "#fdecea" },
    decidido:            { t: "Decidido",            c: NAVY,   f: "#eaf0f8" },
  };
  const normRev = (x) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const revVista = rev.filter(r => {
    const f = revFiltro;
    if (f.estado === "pendientes" && r.estado_revision === "decidido") return false;
    if (f.estado && f.estado !== "pendientes" && r.estado_revision !== f.estado) return false;
    if (f.origen && r.origen_motor !== f.origen) return false;
    if (f.cecos && r.codigo_meli !== f.cecos) return false;
    if (f.busca && !normRev(`${r.id_ruta} ${r.conductor || ""} ${r.comuna_punto_lejano || ""}`)
                      .includes(normRev(f.busca))) return false;
    return true;
  });
  const revCuenta = (e) => rev.filter(r => r.estado_revision === e).length;
  const revPendientes = rev.filter(r => r.estado_revision !== "decidido").length;

  // Cliente del maestro: MELI (todas las pestañas de siempre) o CANON (DispatchTrack)
  const CLIENTES = [
    { id: "meli",  label: "MELI",  sub: "Jornada consolidada desde MELI · reemplaza la carga manual del Excel · Solo operación MELI (ML_* · SRM1–SRM4)" },
    { id: "canon", label: "CANON", sub: "Canon · DispatchTrack · una línea por guía · reemplaza el maestro manual de los supervisores (C_RM · C_VIÑA)" },
  ];
  const elegirCliente = (c) => { setCliente(c); setTab(c === "canon" ? "canon" : "jornada"); };

  const TABS = [
    { id: "jornada",    label: "Maestro Jornada", desc: "Una fila por viaje",        n: jornadaVista.length },
    { id: "devol",      label: "Devoluciones",    desc: "Detalle por folio",          n: devolVista.length },
    { id: "traspasos",  label: "Traspasos",       desc: "Origen → destino",           n: traspVista.length },
    { id: "nosalidas",  label: "No Salidas a Ruta", desc: "Flota propia sin ruta",     n: nsFilas.filter(x => !x.motivo && !x.salio).length || null },
    { id: "cecos",      label: "CECOS",           desc: "Catálogo y clasificación",   n: cecosCat.length || null },
    { id: "zonas",      label: "Zonas de Pago",   desc: "Geografía y segmentación",   n: zonas.length || null },
    { id: "pago",       label: "Maestro Pago",    desc: "Modelo de tarificación",     n: pago.length || null },
    { id: "revision",   label: "Revisión zonas",  desc: "Alertas del motor de zonas", n: revPendientes || null },
    { id: "vehiculos",  label: "Vehículos BT",    desc: "Clasificación por patente",  n: vehiculos.length || null },
    { id: "tarifario",  label: "Tarifario",       desc: "Tarifas por pagar y cobrar", n: tarifas.length || null },
  ];

  return (
    <div style={{ padding: 0, fontFamily: "'Geist', system-ui, -apple-system, sans-serif" }}>
      <style>{`
        .mj-wrap{background:#f4f6f9;min-height:100%;}
        .mj-tab{background:transparent;border:none;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;
                color:#64748b;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;font-family:inherit;}
        .mj-tab.on{color:${NAVY};border-bottom-color:${NAVY};}
        .mj-tab:hover{color:${NAVY};}
        .mj-tabla{width:100%;border-collapse:collapse;font-size:12px;background:#fff;}
        .mj-tabla thead th{position:sticky;top:0;z-index:2;background:${NAVY};color:#fff;font-size:10.5px;
                letter-spacing:.4px;text-transform:uppercase;padding:8px 9px;text-align:left;white-space:nowrap;font-weight:700;}
        .mj-tabla tbody td{padding:7px 9px;border-bottom:1px solid #eef1f5;white-space:nowrap;}
        .mj-tabla tbody tr:hover{background:#f7faff;}
        .mj-tabla .num{text-align:right;font-variant-numeric:tabular-nums;}
        .mj-scroll{max-height:calc(100vh - 380px);overflow:auto;border:1px solid #e6e9ef;border-radius:10px;background:#fff;}
        .mj-input{border:1px solid #dfe4ec;border-radius:8px;padding:6px 10px;font-size:12.5px;font-family:inherit;color:#1f2937;background:#fff;}
        .mj-input:focus{outline:2px solid ${NAVY}22;border-color:${NAVY};}
        .mj-btn{border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:8px;padding:6px 12px;
                font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;}
        .mj-btn:hover{background:${NAVY};color:#fff;}
        .mj-chip{border:1px solid #dfe4ec;background:#fff;border-radius:20px;padding:4px 11px;font-size:12px;
                 cursor:pointer;font-family:inherit;color:#64748b;font-weight:600;}
        .mj-chip.on{background:${NAVY};border-color:${NAVY};color:#fff;}
        .mj-kpis{display:grid;gap:10px;grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:14px;}
        @media (max-width:1180px){.mj-kpis{grid-template-columns:repeat(3,minmax(0,1fr));}}
        @media (max-width:680px){.mj-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}}
        .mj-kpi{transition:box-shadow .15s,transform .15s;}
        .mj-kpi:hover{box-shadow:0 6px 16px -8px rgba(16,32,64,.25);transform:translateY(-1px);}
        .mj-kpi:focus-visible{outline:2px solid ${NAVY};outline-offset:2px;}
      `}</style>

      {/* Cabecera */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: -.3 }}>Maestro de Operaciones · Chile</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              {CLIENTES.find(c => c.id === cliente).sub}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              {CLIENTES.map(c => (
                <button key={c.id} onClick={() => elegirCliente(c.id)}
                        style={{ border: `1px solid ${cliente === c.id ? NAVY : "#d8dee8"}`, background: cliente === c.id ? NAVY : "#fff",
                                 color: cliente === c.id ? "#fff" : NAVY, borderRadius: 8, padding: "6px 18px", fontSize: 12.5,
                                 fontWeight: 800, letterSpacing: .5, cursor: "pointer" }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}>
            <span style={{ fontSize: 11.5, color: "#8a94a6", fontWeight: 700 }}>DÍA OPERATIVO</span>
            <input className="mj-input" type="date" value={fecha}
                   min={cliente === "meli" && dias.length ? dias[dias.length - 1] : undefined}
                   max={cliente === "meli" && dias.length ? dias[0] : undefined}
                   onChange={e => e.target.value && setFecha(e.target.value)} />
            {cliente === "meli" && dias.length > 0 && !dias.includes(fecha) && (
              <span style={{ fontSize: 11, color: "#a16207" }}>sin datos ese día</span>
            )}
            {cliente === "meli" && resumen?.ultima_captura && (
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                última captura {resumen.ultima_captura_chile || horaChile(resumen.ultima_captura)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginTop: 8, flexWrap: "wrap" }}>
          {cliente === "meli" && TABS.map(t => (
            <button key={t.id} className={`mj-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
              <div>{t.label}{t.n !== null && <span style={{ color: "#94a3b8", fontWeight: 600 }}> ({fmt(t.n)})</span>}</div>
              <div style={{ fontSize: 10, color: "#a8b2c1", fontWeight: 400, marginTop: 1 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mj-wrap" style={{ padding: "16px 24px 28px" }}>
        {/* CANON: su propio maestro, sin esperar ni mostrar nada de MELI */}
        {cliente === "canon" && fecha && <MaestroCanon fecha={fecha} api={api} apiSuave={apiSuave} descargarCSV={descargarCSV} />}

        {cliente === "meli" && error && (
          <div style={{ background: "#fff4f4", border: "1px solid #f2c9c9", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: "#b42318", fontSize: 13 }}>No se pudieron cargar los datos</div>
            <div style={{ fontSize: 12, color: "#7a2a22", marginTop: 3 }}>{error}</div>
          </div>
        )}

        {cliente === "meli" && cargando && <div style={{ color: "#8a94a6", fontSize: 13, padding: "24px 0" }}>Cargando la jornada…</div>}

        {cliente === "meli" && !cargando && !fecha && !error && (
          <div style={{ background: "#fff", border: "1px dashed #dfe4ec", borderRadius: 10, padding: 24, maxWidth: 620 }}>
            <div style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>Todavía no hay jornadas cargadas</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 6, lineHeight: 1.8 }}>
              Los datos aparecen aquí en cuanto corre el cierre de las 00:30, que consolida el día anterior.
            </div>
          </div>
        )}

        {cliente === "meli" && !cargando && fecha && (
          <Fragment>
            {/* Indicadores y filtros de MELI: no aplican a Canon */}
            {cliente === "meli" && (
              <Fragment>
            {/* Indicadores · una sola fila; cada tarjeta se abre y se explica */}
            <div className="mj-kpis">
              {KPIS.map(k => (
                <Kpi key={k.id} rotulo={k.rotulo} valor={k.valor} detalle={k.detalle} color={k.color} alerta={k.alerta}
                     abierto={kpiAbierto === k.id}
                     onClick={() => setKpiAbierto(kpiAbierto === k.id ? null : k.id)} />
              ))}
            </div>
            <PanelKpi kpi={KPIS.find(k => k.id === kpiAbierto)} onCerrar={() => setKpiAbierto(null)} />

            {/* Filtros */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <input className="mj-input" style={{ minWidth: 250 }} value={busca} onChange={e => setBusca(e.target.value)}
                     placeholder="Buscar viaje, patente, conductor, comuna…" />
              <select className="mj-input" value={cecos} onChange={e => setCecos(e.target.value)}>
                <option value="">Todos los CECOS</option>
                {listaCecos.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {tiposServicio.length > 1 && (
                <select className="mj-input" value={tipoServicio} onChange={e => setTipoServicio(e.target.value)}
                        title="MELI distingue el reparto de última milla de las rutas MELI ONE">
                  <option value="todos">Todos los servicios{nMeliOne ? ` · ${fmt(nMeliOne)} MELI ONE` : ""}</option>
                  {tiposServicio.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
              <button className={`mj-chip ${!soloReparto ? "on" : ""}`} onClick={() => setSoloReparto(v => !v)}
                title="Las rutas de Line Haul son transferencias entre centros, no reparto a clientes. Por defecto quedan fuera.">
                {!soloReparto ? "✓ " : ""}Incluir Line Haul{nLineHaul ? ` (${fmt(nLineHaul)})` : ""}
              </button>
              <div style={{ flex: 1 }} />
              {tab === "jornada" && (
                <button className="mj-btn" onClick={() => descargarCSV(`maestro_jornada_${fecha}`, jornadaVista, COLS_JORNADA)}>
                  Descargar CSV
                </button>
              )}
              {tab === "devol" && (
                <button className="mj-btn" onClick={() => descargarCSV(`devoluciones_${fecha}`, devolVista, COLS_DEVOL)}>
                  Descargar CSV
                </button>
              )}
              {tab === "traspasos" && (
                <button className="mj-btn" onClick={() => descargarCSV(`traspasos_${fecha}`, traspVista, COLS_TRASP)}>
                  Descargar CSV
                </button>
              )}
            </div>
              </Fragment>
            )}

            {/* ── Maestro Jornada ── */}
            {tab === "jornada" && (
              <div className="mj-scroll">
                <table className="mj-tabla">
                  <thead>
                    <tr>
                      <th>ID Viaje</th><th title="Bodega de origen en MELI (lo que antes se mostraba como CECOS)">Bodega</th>
                      <th>CECO real</th><th>Supervisor</th><th>Tipo de ruta</th><th>Empresa (Certronic)</th><th>Patente</th><th>Conductor</th>
                      <th>Ayud.</th><th className="num">Paradas</th><th className="num">Cargados</th>
                      <th className="num">Entregados</th><th className="num">Devueltos</th><th className="num">Traspasos</th>
                      <th className="num" title="NS ácido: entregados / cargados. Los justificados del maestro manual no se consideran.">% NS</th>
                      <th>Seg. zonal</th>
                      <th>Hora 1ª</th><th>1ª Parada</th>
                      <th>Hora últ.</th><th>Última Parada</th>
                      <th className="num">Hrs ruta</th><th>Ciclo</th><th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jornadaVista.map(r => (
                      <tr key={`${r.id_viaje}-${r.fecha}`}>
                        <td style={{ fontWeight: 700, color: NAVY }}>
                          {r.id_viaje}
                        </td>
                        <td><Etiqueta texto={r.centro_meli || "—"} color="#64748b" fondo="#f1f5f9" /></td>
                        <td style={{ whiteSpace: "nowrap" }}
                            title={r.cecos_fuente === "meli_destino" ? "CECOS informado por MELI (destino de la ruta)"
                                 : r.cecos_fuente === "meli_centro" ? "CECOS informado por MELI (centro de una sola operación)"
                                 : r.cecos_fuente === "analista" ? "CECOS definido por el analista"
                                 : r.cecos_fuente === "mapa" ? "CECOS deducido del mapa de zonas" : ""}>
                          {r.cecos_real
                            ? <Etiqueta texto={r.cecos_real} />
                            : <Etiqueta texto="sin CECOS" color={AMBAR_} fondo="#fdf6e3" />}
                        </td>
                        <td style={{ fontSize: 11.5, maxWidth: 170 }}>
                          {/* El supervisor se asigna por patente solo a la flota propia: el aviso aparece
                              cuando Certronic dice que el vehículo es de Bigticket y falta en Vehículos BT. */}
                          {r.patente && /bigticket/i.test(r.empresa || "") && r.supervisor_fuente !== "patente"
                            ? <span style={{ color: AMBAR_, whiteSpace: "nowrap" }}
                                    title={`La patente ${r.patente} es de Bigticket y no tiene supervisor: asígnalo en Vehículos BT`}>⚠ Asignar en Vehículos BT</span>
                            : r.supervisor
                              ? <span style={{ color: "#334155" }}
                                      title={r.supervisor_fuente === "ceco" ? `Supervisor a cargo de ${r.cecos_real} (asignado en la bitácora)` : "Supervisor de la patente (Vehículos BT)"}>{r.supervisor}</span>
                              : r.cecos_real
                                ? <span style={{ color: AMBAR_, whiteSpace: "nowrap" }}
                                        title={`Nadie tiene asignado ${r.cecos_real}: asígnalo en Vehículos BT → Supervisores`}>⚠ CECO sin supervisor</span>
                                : <span style={{ color: "#cbd5e1" }}>—</span>}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {/* Tipo de ruta (migración 67): el sistema lo sugiere, una persona lo confirma.
                              Las rutas sin nombre en MELI son "no planificadas": Spot o Ambulancia. */}
                          {tipoEdit === r.id_viaje || (r.estado_tipo === "por_confirmar" && !r.tipo_ruta) ? (
                            <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
                              {r.estado_tipo === "por_confirmar" && (
                                <span style={{ fontSize: 11, color: AMBAR_, fontWeight: 700 }}
                                      title="La ruta viene sin nombre en MELI (no planificada) y sin marca de ambulancia: probablemente Spot. Confírmalo.">
                                  «Ruta no planificada» → SPOT/Ambulancia</span>
                              )}
                              <span style={{ display: "inline-flex", gap: 4 }}>
                                <select className="mj-input" value="" disabled={tipoGuardando === r.id_viaje}
                                        style={{ fontSize: 11, padding: "2px 4px" }}
                                        onChange={e => confirmarTipo(r, e.target.value)}>
                                  <option value="">{tipoGuardando === r.id_viaje ? "Guardando…" : "— confirmar tipo —"}</option>
                                  {(r.estado_tipo === "por_confirmar"
                                      ? [...servActivos.filter(x => ["SPOT", "AMBULANCIA"].includes(x.codigo)),
                                         ...servActivos.filter(x => !["SPOT", "AMBULANCIA"].includes(x.codigo))]
                                      : servActivos).map(x =>
                                    <option key={x.codigo} value={x.codigo}>{etiquetaTipo(x.codigo).t}</option>)}
                                </select>
                                {tipoEdit === r.id_viaje && (
                                  <button className="mj-btn" style={{ padding: "1px 6px", fontSize: 11 }}
                                          onClick={() => setTipoEdit(null)}>✕</button>
                                )}
                              </span>
                            </span>
                          ) : r.tipo_ruta ? (
                            <span title={r.estado_tipo === "confirmado"
                                           ? `Confirmado por ${r.tipo_por || "—"} (${r.tipo_rol || "—"})`
                                             + (r.tipo_sugerido && r.tipo_sugerido !== r.tipo_ruta ? ` · el sistema sugería ${etiquetaTipo(r.tipo_sugerido).t}` : "")
                                           : r.tipo_ruta === "AMBULANCIA" && r.no_planificada
                                             ? "Detectado por MELI: ruta no planificada marcada como ambulancia («Ambulancia entre paradas»)"
                                             : `Detectado por el sistema${r.nombre_ruta ? ` (ruta ${r.nombre_ruta})` : ""}`}>
                              <Etiqueta texto={etiquetaTipo(r.tipo_ruta).t} color={etiquetaTipo(r.tipo_ruta).c} fondo={etiquetaTipo(r.tipo_ruta).f} />
                              {r.estado_tipo === "confirmado" && <span style={{ color: "#0d8043", fontWeight: 800, marginLeft: 3 }}>✓</span>}
                            </span>
                          ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                          {tipoEdit !== r.id_viaje && r.tipo_ruta && (
                            <button className="mj-btn" title="Corregir el tipo de ruta"
                                    style={{ padding: "0 5px", fontSize: 10.5, marginLeft: 4, border: "none", background: "transparent", color: "#94a3b8" }}
                                    onClick={() => setTipoEdit(r.id_viaje)}>✎</button>
                          )}
                          {r.con_ambulancia && <span style={{ marginLeft: 5 }} title="Ruta planificada que recibió apoyo de una ambulancia"><Etiqueta texto="+AMB" color="#b42318" fondo="#fdecea" /></span>}
                          {r.is_line_haul && <span style={{ marginLeft: 5 }} title="Line Haul: marca de MELI sobre la ruta"><Etiqueta texto="LH" color="#7a5b16" fondo="#fdf3d8" /></span>}
                          {r.entrega_y_retira && <span style={{ marginLeft: 5 }} title="Entrega y además pasa a retirar"><Etiqueta texto="E+R" color="#0e7490" fondo="#e0f2fe" /></span>}
                        </td>
                        <td style={{ fontSize: 11, minWidth: 190, maxWidth: 210 }}
                            title={[r.empresa, r.empresa_rut && `RUT ${r.empresa_rut}`,
                                    r.empresa_estado && `Certronic: ${r.empresa_estado}`,
                                    r.tercero && `Tercero según MELI: ${r.tercero}`].filter(Boolean).join(" · ")}>
                          {/* nombres largos: hasta 2 líneas y "…"; completo al pasar el mouse */}
                          {r.empresa
                            ? <div style={{ color: "#334155", width: 200, whiteSpace: "normal", lineHeight: 1.25,
                                            overflow: "hidden", display: "-webkit-box",
                                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical", wordBreak: "break-word" }}>
                                {r.empresa}</div>
                            : r.patente
                              ? <Etiqueta texto="SIN REGISTRO" color={AMBAR_} fondo="#fdf6e3" />
                              : <span style={{ color: "#cbd5e1" }}>—</span>}
                          {r.empresa && r.empresa_estado && r.empresa_estado !== "ACTIVA" && (
                            <div style={{ marginTop: 2 }}>
                              <Etiqueta texto={r.empresa_estado} color="#b42318" fondo="#fdecea" />
                            </div>
                          )}
                        </td>
                        <td style={{ fontWeight: 600 }}>{r.patente || "—"}</td>
                        <td style={{ color: "#334155", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}>{r.conductor || "—"}</td>
                        <td>{r.con_ayudante ? <Etiqueta texto="Sí" color="#0d8043" fondo="#e7f6ec" /> : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                        <td className="num">{fmt(r.paradas)}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmt(r.cargados)}</td>
                        <td className="num" style={{ color: "#0d8043", fontWeight: 700 }}>{fmt(r.entregados)}</td>
                        <td className="num" style={{ color: n(r.devueltos) ? "#b42318" : "#cbd5e1", fontWeight: n(r.devueltos) ? 700 : 400 }}>{fmt(r.devueltos)}</td>
                        <td className="num" style={{ color: n(r.d_justificados) ? ORANGE : "#cbd5e1", fontWeight: n(r.d_justificados) ? 700 : 400 }}>{fmt(r.d_justificados)}</td>
                        <td className="num" style={{ fontWeight: 700, color: n(r.pct_entrega) >= 98 ? "#0d8043" : n(r.pct_entrega) >= 90 ? "#7a5b16" : "#b42318" }}>
                          {r.pct_entrega === null ? "—" : `${r.pct_entrega}%`}
                        </td>
                        <td style={{ whiteSpace: "nowrap", fontSize: 12 }}
                            title={r.zona_pago ? `Zona: ${r.zona_pago}` : ""}>
                          {r.segmentacion
                            ? <span style={{ fontWeight: 600, color: "#334155" }}>{r.segmentacion}</span>
                            : <span style={{ color: "#cbd5e1" }}>—</span>}
                          {r.alerta_zona && (
                            <span style={{ marginLeft: 5, color: r.alerta_zona === "sin_zona" ? "#b42318" : AMBAR_ }}
                                  title="El motor de zonas marcó este viaje para revisión (pestaña Revisión zonas)">⚠</span>
                          )}
                        </td>
                        <td style={{ fontWeight: 700, color: r.hora_primera_parada ? NAVY : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                          {r.hora_primera_parada || "—"}
                        </td>
                        <td style={{ color: "#475569" }}>
                          {r.comuna_primera_parada || "—"}{r.primera_parada ? <span style={{ color: "#a8b2c1" }}> · #{r.primera_parada}</span> : null}
                        </td>
                        <td style={{ fontWeight: 700, color: r.hora_ultima_parada ? NAVY : "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                          {r.hora_ultima_parada || "—"}
                        </td>
                        <td style={{ color: "#475569" }}>
                          {r.comuna_ultima_parada || "—"}{r.ultima_parada ? <span style={{ color: "#a8b2c1" }}> · #{r.ultima_parada}</span> : null}
                        </td>
                        <td className="num" style={{ color: "#64748b" }}>{r.horas_en_ruta ?? "—"}</td>
                        <td>{r.ciclo || "—"}</td>
                        <td><Etiqueta texto={r.status || "—"} color={r.status === "finished" ? "#0d8043" : "#475569"} fondo={r.status === "finished" ? "#e7f6ec" : "#eef2f9"} /></td>
                      </tr>
                    ))}
                    {!jornadaVista.length && (
                      <tr><td colSpan={23} style={{ padding: 20, color: "#8a94a6", textAlign: "center" }}>
                        Ningún viaje coincide con los filtros. Prueba limpiando la búsqueda o el CECOS.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Devoluciones ── */}
            {tab === "devol" && (
              <Fragment>
                {motivos.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    {motivos.map(([m, c]) => (
                      <div key={m} style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 20, padding: "5px 12px", fontSize: 12 }}>
                        <span style={{ color: "#475569" }}>{m}</span>
                        <span style={{ fontWeight: 800, color: "#b42318", marginLeft: 7 }}>{fmt(c)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mj-scroll">
                  <table className="mj-tabla">
                    <thead>
                      <tr>
                        <th>ID Viaje</th><th>CECOS</th><th>Folio Guía</th><th>Patente</th><th>Conductor</th>
                        <th>Motivo</th><th>Receptor</th><th>Comuna</th><th className="num">Parada</th><th>Hora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devolVista.map(r => (
                        <tr key={`${r.id_viaje}-${r.folio_guia}`}>
                          <td style={{ fontWeight: 700, color: NAVY }}>{r.id_viaje}</td>
                          <td><Etiqueta texto={r.cecos || "—"} /></td>
                          <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.folio_guia}</td>
                          <td style={{ fontWeight: 600 }}>{r.patente || "—"}</td>
                          <td style={{ color: "#334155", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{r.conductor || "—"}</td>
                          <td><Etiqueta texto={r.motivo || "—"} color="#b42318" fondo="#fdecec" /></td>
                          <td style={{ color: "#475569", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>{r.receptor || "—"}</td>
                          <td style={{ color: "#475569" }}>{r.comuna || "—"}</td>
                          <td className="num">{r.parada ?? "—"}</td>
                          <td style={{ color: "#94a3b8" }}>{r.hora_chile || horaChile(r.ocurrido_at)}</td>
                        </tr>
                      ))}
                      {!devolVista.length && (
                        <tr><td colSpan={10} style={{ padding: 20, color: "#8a94a6", textAlign: "center" }}>
                          Sin devoluciones para este día y estos filtros.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Fragment>
            )}

            {/* ── Traspasos ── */}
            {tab === "traspasos" && (
              <Fragment>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8, lineHeight: 1.7, maxWidth: 780 }}>
                  Paquetes que pasaron de una ruta a otra. No son devoluciones: en el Excel corresponden a los
                  <strong> D_JUSTIFICADOS</strong>. Si origen y destino tienen CECOS distintos, la fila se marca en naranja.
                </div>
                <div className="mj-scroll">
                  <table className="mj-tabla">
                    <thead>
                      <tr>
                        <th>Ruta Origen</th><th>CECOS</th><th>Conductor Origen</th><th>Patente</th>
                        <th></th>
                        <th>Ruta Destino</th><th>CECOS</th><th>Conductor Destino</th><th>Patente</th>
                        <th className="num">Paquetes</th><th className="num">Entregados luego</th><th className="num">Sin entregar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traspVista.map((r, i) => (
                        <tr key={`${r.ruta_origen}-${r.ruta_destino}-${i}`}
                            style={r.entre_service_centers ? { background: "#fff9f2" } : undefined}>
                          <td style={{ fontWeight: 700, color: NAVY }}>{r.ruta_origen}</td>
                          <td><Etiqueta texto={r.sc_origen || "—"} /></td>
                          <td style={{ color: "#334155", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>{r.chofer_origen || "—"}</td>
                          <td style={{ fontWeight: 600 }}>{r.patente_origen || "—"}</td>
                          <td style={{ color: ORANGE, fontWeight: 800 }}>→</td>
                          <td style={{ fontWeight: 700, color: NAVY }}>{r.ruta_destino}</td>
                          <td><Etiqueta texto={r.sc_destino || "—"}
                                        color={r.entre_service_centers ? "#7a5b16" : NAVY}
                                        fondo={r.entre_service_centers ? "#fdf3d8" : "#eef2f9"} /></td>
                          <td style={{ color: "#334155", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}>{r.chofer_destino || "—"}</td>
                          <td style={{ fontWeight: 600 }}>{r.patente_destino || "—"}</td>
                          <td className="num" style={{ fontWeight: 800, color: ORANGE }}>{fmt(r.paquetes)}</td>
                          <td className="num" style={{ color: "#0d8043" }}>{fmt(r.entregados_luego)}</td>
                          <td className="num" style={{ color: n(r.sin_entregar) ? "#b42318" : "#cbd5e1" }}>{fmt(r.sin_entregar)}</td>
                        </tr>
                      ))}
                      {!traspVista.length && (
                        <tr><td colSpan={12} style={{ padding: 20, color: "#8a94a6", textAlign: "center" }}>
                          Sin traspasos registrados para este día.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Fragment>
            )}

            {/* ── Mantenedor de CECOS ── */}
            {tab === "cecos" && (
              <Fragment>
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Catálogo de CECOS</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3, maxWidth: 900 }}>
                    Los códigos llegan solos desde el portal de MELI: cada CECOS que el maestro ve queda
                    registrado acá, pendiente de clasificar. Completa el <strong>nombre administrativo</strong> (el del
                    tarifario, ej. ML_RM_SRM1) y marca si es <strong>operación Bigticket</strong> — solo esos entran al motor
                    de pago. La columna Carriers ayuda a decidir: si solo aparecen terceros ajenos, no es tuyo.
                  </div>
                  {cecosMsg && <div style={{ fontSize: 12, color: VERDE_, marginTop: 6 }}>✓ {cecosMsg}</div>}
                </div>

                {/* carga masiva */}
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 300 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Carga masiva</div>
                    <textarea className="mj-input" rows={3} value={cecosMasivo}
                      onChange={e => setCecosMasivo(e.target.value)}
                      placeholder={"Un código por línea. Opcional el nombre admin separado por coma:\nSRM1, ML_RM_SRM1\nSBB2, ML_CAÑETE\nSPO1"}
                      style={{ width: "100%", fontFamily: "inherit", fontSize: 12, resize: "vertical" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 6 }}>
                    <button className="mj-btn" onClick={cargarCecosMasivo}
                            disabled={cecosGuardando === "__masivo__" || !cecosMasivo.trim()}
                            style={{ background: NAVY, color: "#fff", borderColor: NAVY, padding: "8px 14px" }}>
                      {cecosGuardando === "__masivo__" ? "Cargando…" : "Cargar códigos"}
                    </button>
                    <div style={{ fontSize: 10.5, color: "#a8b2c1", maxWidth: 180 }}>
                      Los que ya existen se actualizan, no se duplican.
                    </div>
                  </div>
                </div>

                {/* tabla del catálogo */}
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table className="mj-tabla">
                      <thead>
                        <tr>
                          <th>Código</th><th>CECOS admin (tarifario)</th><th>¿Bigticket?</th>
                          <th style={{ textAlign: "right" }}>Rutas</th><th style={{ textAlign: "right" }}>Días</th>
                          <th style={{ textAlign: "right" }}>Patentes</th><th>Carriers</th>
                          <th>Visto</th><th>Nota</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cecosCat.map(c => {
                          const ed = cecosEdit[c.codigo];
                          const pendiente = c.es_bigticket === null || c.es_bigticket === undefined;
                          return (
                            <tr key={c.codigo} style={pendiente ? { background: "#fffdf4" } : undefined}>
                              <td style={{ fontWeight: 700 }}>
                                {c.codigo}
                                {c.sin_registrar && <span style={{ marginLeft: 6 }}><Etiqueta texto="NUEVO" color="#b45309" fondo="#fef3c7" /></span>}
                              </td>
                              <td style={{ maxWidth: 260 }}>
                                {/* Un código puede alojar VARIOS cecos del tarifario (SRM1 = RM_1 +
                                    San Antonio + Cordillera). El cecos de pago de cada viaje se
                                    resuelve por la zona donde entregó, no por este código. */}
                                {c.nombres_admin
                                  ? <span style={{ fontSize: 12 }}>{c.nombres_admin}
                                      {c.consolidado && <span style={{ marginLeft: 6 }}
                                        title="Varios cecos del tarifario viven en este código: el de pago se resuelve por zona de entrega">
                                        <Etiqueta texto={`${c.cecos_admin} EN 1`} color="#5b21b6" fondo="#ede9fe" /></span>}
                                    </span>
                                  : <span style={{ color: "#cbd5e1" }}>— sin asignar</span>}
                              </td>
                              <td>
                                {ed ? (
                                  <select className="mj-input" value={ed.es_bigticket === null ? "" : String(ed.es_bigticket)}
                                    onChange={e => setCecosEdit(x => ({ ...x, [c.codigo]: { ...ed,
                                      es_bigticket: e.target.value === "" ? null : e.target.value === "true" } }))}
                                    style={{ fontSize: 12 }}>
                                    <option value="">pendiente</option>
                                    <option value="true">Sí, Bigticket</option>
                                    <option value="false">No, ajeno</option>
                                  </select>
                                ) : (
                                  c.es_bigticket === true ? <Etiqueta texto="BIGTICKET" color="#0d8043" fondo="#e7f6ec" />
                                  : c.es_bigticket === false ? <Etiqueta texto="AJENO" color="#64748b" fondo="#f1f5f9" />
                                  : <Etiqueta texto="PENDIENTE" color="#b45309" fondo="#fef3c7" />
                                )}
                              </td>
                              <td className="num">{fmt(c.rutas_historicas)}</td>
                              <td className="num">{fmt(c.dias_operados)}</td>
                              <td className="num">{fmt(c.patentes)}</td>
                              <td style={{ maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden",
                                           textOverflow: "ellipsis", fontSize: 11 }}
                                  title={c.lista_carriers || ""}>{c.lista_carriers || "—"}</td>
                              <td style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                                {String(c.visto_desde).slice(5)} → {String(c.visto_hasta).slice(5)}
                              </td>
                              <td>
                                {ed ? (
                                  <input className="mj-input" value={ed.nota ?? ""}
                                    onChange={e => setCecosEdit(x => ({ ...x, [c.codigo]: { ...ed, nota: e.target.value } }))}
                                    style={{ width: 150, fontSize: 12 }} />
                                ) : <span style={{ fontSize: 11, color: "#94a3b8" }}>{c.nota || ""}</span>}
                              </td>
                              <td style={{ whiteSpace: "nowrap" }}>
                                {ed ? (
                                  <Fragment>
                                    <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11,
                                        background: NAVY, color: "#fff", borderColor: NAVY }}
                                      disabled={cecosGuardando === c.codigo}
                                      onClick={() => guardarCeco(c.codigo, {
                                        es_bigticket: ed.es_bigticket,
                                        nota: ed.nota || null,
                                      }, c.sin_registrar)}>
                                      {cecosGuardando === c.codigo ? "…" : "Guardar"}
                                    </button>
                                    <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }}
                                      onClick={() => setCecosEdit(x => { const n = { ...x }; delete n[c.codigo]; return n; })}>
                                      Cancelar
                                    </button>
                                  </Fragment>
                                ) : (
                                  <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                                    onClick={() => setCecosEdit(x => ({ ...x, [c.codigo]: {
                                      es_bigticket: c.es_bigticket ?? null, nota: c.nota } }))}>
                                    Editar
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {cecosCat.length === 0 && (
                          <tr><td colSpan={10} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>
                            Cargando el catálogo…
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Fragment>
            )}

            {/* ── Mantenedor de Zonas de Pago ── */}
            {tab === "zonas" && (
              <Fragment>
                {mapaAbierto && (
                  <MapaZonas zonas={zonas} segmentaciones={segmentaciones} api={api}
                             onCerrar={() => setMapaAbierto(false)}
                             onCreada={cargarZonas} />
                )}
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                                gap: 12, flexWrap: "wrap" }}>
                    <div style={{ maxWidth: 860 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Zonas de pago</div>
                      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3 }}>
                        Cada zona geográfica (calculada desde las entregas reales) debe apuntar a una
                        <strong> segmentación del tarifario</strong> — de ahí hereda su CECOS admin y, con el
                        tarifario cargado, su tarifa. Las zonas <strong>sin segmentación no pueden pagar</strong>:
                        son la lista de trabajo. El radio se ajusta en metros y "Ver mapa" abre el centro
                        de la zona para revisarla.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select className="mj-input" value={zonaFiltro} onChange={e => setZonaFiltro(e.target.value)}>
                        <option value="todas">Todas ({fmt(zonas.length)})</option>
                        <option value="pendientes">
                          Sin segmentación ({fmt(zonas.filter(z => !z.segmentacion).length)})
                        </option>
                      </select>
                      <button className="mj-btn" onClick={() => setMapaAbierto(true)}
                              style={{ background: NAVY, color: "#fff", borderColor: NAVY }}>
                        🗺 Abrir mapa
                      </button>
                      <button className="mj-btn" onClick={() => setZonaNueva(zonaNueva ? null : { ...ZONA_NUEVA0 })}>
                        {zonaNueva ? "Cerrar" : "➕ Por coordenadas"}
                      </button>
                    </div>
                  </div>
                </div>

                {zonaNueva && (
                  <div style={{ background: "#fdf6e3", border: "1px solid #f3e2b8", borderRadius: 10,
                                padding: "13px 16px", marginBottom: 12 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: NAVY, marginBottom: 8 }}>
                      Nueva zona de pago
                      <span style={{ fontWeight: 400, color: "#64748b", marginLeft: 8, fontSize: 11.5 }}>
                        La coordenada se copia desde Google Maps: click derecho en el punto → copiar. El caso
                        típico: Cahuil, que tiene tarifa propia pero MELI nunca la informa como comuna.
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Nombre<br/>
                        <input className="mj-input" value={zonaNueva.nombre} placeholder="Cahuil"
                          onChange={e => setZonaNueva(z => ({ ...z, nombre: e.target.value }))} style={{ width: 120 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Código MELI<br/>
                        <input className="mj-input" value={zonaNueva.cecos} placeholder="SLT1"
                          onChange={e => setZonaNueva(z => ({ ...z, cecos: e.target.value.toUpperCase() }))} style={{ width: 76 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Segmentación<br/>
                        <select className="mj-input" value={zonaNueva.segmentacion}
                          onChange={e => setZonaNueva(z => ({ ...z, segmentacion: e.target.value }))} style={{ minWidth: 130 }}>
                          <option value="">— elegir —</option>
                          {segmentaciones.map(sg => <option key={sg.nombre} value={sg.nombre}>{sg.nombre}</option>)}
                        </select></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Latitud<br/>
                        <input className="mj-input" value={zonaNueva.lat} placeholder="-34.4794"
                          onChange={e => setZonaNueva(z => ({ ...z, lat: e.target.value }))} style={{ width: 92 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Longitud<br/>
                        <input className="mj-input" value={zonaNueva.lon} placeholder="-72.0311"
                          onChange={e => setZonaNueva(z => ({ ...z, lon: e.target.value }))} style={{ width: 92 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Radio m<br/>
                        <input className="mj-input" type="number" value={zonaNueva.radio} min={100} max={60000} step={100}
                          onChange={e => setZonaNueva(z => ({ ...z, radio: e.target.value }))} style={{ width: 84 }} /></label>
                      <button className="mj-btn" onClick={crearZona} disabled={zonaGuardando === "__nueva__"}
                              style={{ background: NAVY, color: "#fff", borderColor: NAVY, padding: "7px 14px" }}>
                        {zonaGuardando === "__nueva__" ? "Creando…" : "Crear zona"}
                      </button>
                      {zonaNueva.lat && zonaNueva.lon && (
                        <a href={`https://www.google.com/maps?q=${zonaNueva.lat},${zonaNueva.lon}&z=13`}
                           target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: NAVY, fontWeight: 700 }}>
                          Verificar en el mapa ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table className="mj-tabla">
                      <thead>
                        <tr>
                          <th>Zona</th><th>Código MELI</th><th>Segmentación (tarifario)</th>
                          <th>CECOS admin</th><th style={{ textAlign: "right" }}>Radio m</th>
                          <th style={{ textAlign: "right" }}>Paq. ayer</th>
                          <th>Revisada</th><th>Activa</th><th>Mapa</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {zonas
                          .filter(z => zonaFiltro === "todas" || !z.segmentacion)
                          .map(z => {
                            const ed = zonaEdit[z.id];
                            const pendiente = !z.segmentacion;
                            return (
                              <tr key={z.id} style={pendiente ? { background: "#fffdf4" } : undefined}>
                                <td style={{ fontWeight: 600 }}>{z.nombre}</td>
                                <td><Etiqueta texto={z.codigo_meli || "—"} /></td>
                                <td>
                                  {ed ? (
                                    <select className="mj-input" value={ed.segmentacion ?? ""}
                                      onChange={e => setZonaEdit(x => ({ ...x, [z.id]: { ...ed,
                                        segmentacion: e.target.value || null } }))}
                                      style={{ fontSize: 12, minWidth: 150 }}>
                                      <option value="">— sin asignar —</option>
                                      {segmentaciones.map(sg =>
                                        <option key={sg.nombre} value={sg.nombre}>{sg.nombre}</option>)}
                                    </select>
                                  ) : (z.segmentacion
                                        ? <span style={{ fontSize: 12, fontWeight: 600 }}>{z.segmentacion}</span>
                                        : <Etiqueta texto="SIN ASIGNAR" color="#b45309" fondo="#fef3c7" />)}
                                </td>
                                <td style={{ fontSize: 12 }}>
                                  {z.cecos_admin
                                    || (z.segmentacion === "RM"
                                        ? <span style={{ color: "#64748b" }} title="RM es compartida: el CECOS admin lo decide el código MELI del viaje">por código</span>
                                        : <span style={{ color: "#cbd5e1" }}>—</span>)}
                                </td>
                                <td className="num">
                                  {ed ? (
                                    <input className="mj-input" type="number" value={ed.radio_m ?? ""}
                                      min={100} max={60000} step={100}
                                      onChange={e => setZonaEdit(x => ({ ...x, [z.id]: { ...ed,
                                        radio_m: e.target.value === "" ? null : Number(e.target.value) } }))}
                                      style={{ width: 84, fontSize: 12, textAlign: "right" }} />
                                  ) : fmt(z.radio_m)}
                                </td>
                                <td className="num">{fmt(z.paquetes_ayer)}</td>
                                <td>{z.revisada
                                      ? <Etiqueta texto="SÍ" color="#0d8043" fondo="#e7f6ec" />
                                      : <Etiqueta texto="NO" color="#8a94a6" fondo="#f1f5f9" />}</td>
                                <td>{z.activa
                                      ? <Etiqueta texto="ACTIVA" color="#0d8043" fondo="#e7f6ec" />
                                      : <Etiqueta texto="INACTIVA" color="#8a94a6" fondo="#f1f5f9" />}</td>
                                <td>
                                  {z.lat != null && (
                                    <a href={`https://www.google.com/maps?q=${z.lat},${z.lon}&z=13`}
                                       target="_blank" rel="noreferrer"
                                       style={{ fontSize: 11.5, color: NAVY, fontWeight: 700 }}>
                                      Ver mapa ↗
                                    </a>
                                  )}
                                </td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  {ed ? (
                                    <Fragment>
                                      <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11,
                                          background: NAVY, color: "#fff", borderColor: NAVY }}
                                        disabled={zonaGuardando === z.id}
                                        onClick={async () => {
                                          // si movió el centro, primero la función RPC (geography)
                                          if ((ed.lat && Number(ed.lat) !== z.lat) || (ed.lon && Number(ed.lon) !== z.lon)) {
                                            try { await moverZona(z.id, ed.lat ?? z.lat, ed.lon ?? z.lon, ed.radio_m); }
                                            catch (e) { setError(e.message); return; }
                                          }
                                          guardarZona(z.id, {
                                            segmentacion: ed.segmentacion,
                                            radio_m: ed.radio_m,
                                            revisada: ed.revisada,
                                            activa: ed.activa,
                                          });
                                        }}>
                                        {zonaGuardando === z.id ? "…" : "Guardar"}
                                      </button>
                                      <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }}
                                        onClick={() => setZonaEdit(x => { const n = { ...x }; delete n[z.id]; return n; })}>
                                        Cancelar
                                      </button>
                                      <label style={{ fontSize: 10.5, marginLeft: 8, color: "#64748b" }}>
                                        <input type="checkbox" checked={!!ed.revisada}
                                          onChange={e => setZonaEdit(x => ({ ...x, [z.id]: { ...ed, revisada: e.target.checked } }))} /> revisada
                                      </label>
                                      <label style={{ fontSize: 10.5, marginLeft: 6, color: "#64748b" }}>
                                        <input type="checkbox" checked={!!ed.activa}
                                          onChange={e => setZonaEdit(x => ({ ...x, [z.id]: { ...ed, activa: e.target.checked } }))} /> activa
                                      </label>
                                      <input className="mj-input" value={ed.lat ?? z.lat ?? ""} placeholder="lat"
                                        title="Mover el centro: latitud"
                                        onChange={e => setZonaEdit(x => ({ ...x, [z.id]: { ...ed, lat: e.target.value } }))}
                                        style={{ width: 76, fontSize: 11, marginLeft: 8 }} />
                                      <input className="mj-input" value={ed.lon ?? z.lon ?? ""} placeholder="lon"
                                        title="Mover el centro: longitud"
                                        onChange={e => setZonaEdit(x => ({ ...x, [z.id]: { ...ed, lon: e.target.value } }))}
                                        style={{ width: 76, fontSize: 11, marginLeft: 4 }} />
                                    </Fragment>
                                  ) : (
                                    <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                                      onClick={() => setZonaEdit(x => ({ ...x, [z.id]: {
                                        segmentacion: z.segmentacion, radio_m: z.radio_m,
                                        revisada: z.revisada, activa: z.activa } }))}>
                                      Editar
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        {zonas.length === 0 && (
                          <tr><td colSpan={10} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>
                            Cargando zonas… (requiere las migraciones 26, 27 y 30)
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Fragment>
            )}

            {/* ── Maestro de Pago (el modelo de operaciones) ── */}
            {tab === "pago" && (
              <Fragment>
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12, display: "flex",
                              justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ maxWidth: 840 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Maestro de pago · modelo de tarificación</div>
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3 }}>
                      Las columnas del modelo de operaciones, una fila por viaje. El CECOS y la segmentación
                      se resuelven por la <strong>zona donde entregó</strong>; cuando falta algo, la columna
                      Estado dice qué (crear la zona o asignarle segmentación). SPOT y SORTING serán ingreso
                      manual. Los KM son los <strong>planificados</strong> por MELI.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="mj-btn" onClick={() => setOvr(ovr ? null : { id_viaje: "", segmentacion: "", motivo: "" })}>
                      {ovr ? "Cerrar corrección" : "✎ Corregir zona de un viaje"}
                    </button>
                    <button className="mj-btn" onClick={() => descargarCSV(
                      pago.map(r => ({ SERVICIO: r.servicio, CECOS: r.cecos, FECHA: r.fecha,
                        "ID VIAJE": r.id_viaje, PATENTE: r.patente, TERCERO: r.tercero,
                        CARGADOS: r.cargados, ENTREGADOS: r.entregados,
                        "SEGMENTACION ZONAL": r.segmentacion_zonal,
                        "TIPO VEHICULO LOGIST": r.tipo_vehiculo_logist,
                        "TIPO VEHICULO BT": r.tipo_vehiculo_bt,
                        "KM PLANIFICADOS": r.km_planificados,
                        "NIVEL DE SERVICIO": r.nivel_servicio,
                        "TIPO PAGO": r.tipo_pago, "TARIFA": r.tarifa_aplicada,
                        "PAGO": r.pago, "ESTADO PAGO": r.estado_pago,
                        "SERVICIO MELI": r.servicio_meli || "", "ALERTA": r.alerta_pago || "",
                        "NS %": r.ns_pct ?? "", "FACTOR NS": r.factor_ns ?? "" })),
                      `maestro_pago_${fecha}.csv`)}>
                      Descargar CSV
                    </button>
                  </div>
                </div>

                {ovr && (
                  <div style={{ background: "#fdf6e3", border: "1px solid #f3e2b8", borderRadius: 10,
                                padding: "12px 16px", marginBottom: 12, display: "flex", gap: 8,
                                flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div style={{ width: "100%", fontSize: 11.5, color: "#64748b", marginBottom: 2 }}>
                      La corrección prima sobre la regla automática del punto más lejano, para el viaje y
                      la fecha seleccionada ({fecha}). Queda registrada con motivo y usuario, como los
                      ajustes manuales del Excel.
                    </div>
                    <label style={{ fontSize: 10.5, color: "#64748b" }}>ID Viaje<br/>
                      <input className="mj-input" value={ovr.id_viaje} placeholder="62795849"
                        onChange={e => setOvr(o => ({ ...o, id_viaje: e.target.value.replace(/\D/g, "") }))}
                        style={{ width: 100 }} /></label>
                    <label style={{ fontSize: 10.5, color: "#64748b" }}>Segmentación<br/>
                      <select className="mj-input" value={ovr.segmentacion}
                        onChange={e => setOvr(o => ({ ...o, segmentacion: e.target.value }))} style={{ minWidth: 130 }}>
                        <option value="">— elegir —</option>
                        {segmentaciones.map(sg => <option key={sg.nombre} value={sg.nombre}>{sg.nombre}</option>)}
                      </select></label>
                    <label style={{ fontSize: 10.5, color: "#64748b", flex: 1, minWidth: 220 }}>Motivo (obligatorio)<br/>
                      <input className="mj-input" value={ovr.motivo} placeholder="Entregas rurales fuera del radio de la zona"
                        onChange={e => setOvr(o => ({ ...o, motivo: e.target.value }))} style={{ width: "100%" }} /></label>
                    <button className="mj-btn" onClick={guardarOverride} disabled={ovrGuardando}
                            style={{ background: NAVY, color: "#fff", borderColor: NAVY, padding: "7px 14px" }}>
                      {ovrGuardando ? "Guardando…" : "Guardar corrección"}
                    </button>
                  </div>
                )}

                {(() => {
                  const reparto = pago.filter(r => !r.is_line_haul);
                  const calculados = reparto.filter(r => r.estado_pago === "calculado");
                  const pendientes = reparto.filter(r => r.estado_pago !== "calculado");
                  const totalDia = calculados.reduce((a, r) => a + n(r.pago), 0);
                  const filtrado = pagoFiltro === "pendientes" ? pendientes
                                 : pagoFiltro === "calculados" ? calculados : reparto;
                  const chip = (activo) => ({ cursor: "pointer", padding: "3px 10px", borderRadius: 14,
                    fontSize: 11.5, fontWeight: 700, border: "1px solid " + (activo ? NAVY : "#dfe4ec"),
                    background: activo ? NAVY : "#fff", color: activo ? "#fff" : "#64748b" });
                  return (
                    <Fragment>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: "#0d8043" }}>
                          {totalDia.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 })}
                        </span>
                        <span style={{ fontSize: 11.5, color: "#8a94a6" }}>pago proyectado del día (sin bono NS, pendiente de confirmar)</span>
                        <span style={{ flex: 1 }} />
                        <span style={chip(pagoFiltro === "todos")} onClick={() => setPagoFiltro("todos")}>
                          Todos ({fmt(reparto.length)})</span>
                        <span style={chip(pagoFiltro === "calculados")} onClick={() => setPagoFiltro("calculados")}>
                          Calculados ({fmt(calculados.length)})</span>
                        <span style={chip(pagoFiltro === "pendientes")} onClick={() => setPagoFiltro("pendientes")}
                              title="No se pagan hasta resolverlos: sin resolver (falta zona: ✎), sin tarifa (➕ Crear tarifa) o tipo por confirmar (elegir el tipo).">
                          ⚠ Pendientes ({fmt(pendientes.length)})</span>
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
                          <table className="mj-tabla">
                            <thead>
                              <tr>
                                <th>Servicio</th><th>CECOS</th><th>ID Viaje</th><th>Patente</th><th>Tercero</th>
                                <th style={{ textAlign: "right" }}>Cargados</th>
                                <th style={{ textAlign: "right" }}>Entregados</th>
                                <th>Segmentación</th><th>Veh. BT</th>
                                <th style={{ textAlign: "right" }}>NS</th>
                                <th>Tipo pago</th>
                                <th style={{ textAlign: "right" }}>Tarifa</th>
                                <th style={{ textAlign: "right" }}>Pago</th>
                                <th>Estado</th><th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {filtrado.map(r => (
                                <tr key={r.id_viaje} style={r.estado_resolucion !== "resuelto" ? { background: "#fffdf4" } : undefined}>
                                  <td title={r.servicio_meli && r.servicio !== r.servicio_meli ? `MELI lo informa como ${etiquetaTipo(r.servicio_meli).t}` : ""}>
                                    {r.servicio
                                      ? <Etiqueta texto={etiquetaTipo(r.servicio).t} color={etiquetaTipo(r.servicio).c} fondo={etiquetaTipo(r.servicio).f} />
                                      : <span style={{ fontSize: 11, color: AMBAR_, fontWeight: 700 }}>por confirmar</span>}</td>
                                  <td style={{ fontSize: 12, fontWeight: 600 }}>{r.cecos || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                                  <td style={{ fontWeight: 600 }}>{r.id_viaje}</td>
                                  <td>{r.patente || "—"}</td>
                                  <td style={{ maxWidth: 170, whiteSpace: "nowrap", overflow: "hidden",
                                               textOverflow: "ellipsis", fontSize: 12 }} title={r.tercero || ""}>{r.tercero || "—"}</td>
                                  <td className="num">{fmt(r.cargados)}</td>
                                  <td className="num" style={{ color: "#0d8043", fontWeight: 700 }}>{fmt(r.entregados)}</td>
                                  <td style={{ fontSize: 12 }}>{r.segmentacion_zonal || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                                  <td style={{ fontSize: 11.5 }}>
                                    {r.tipo_vehiculo_bt === "ELECTRICA"
                                      ? <Etiqueta texto="ELECTRICA" color="#0d8043" fondo="#e7f6ec" />
                                      : r.tipo_vehiculo_bt}
                                  </td>
                                  <td className="num">{r.nivel_servicio != null
                                    ? <span style={{ fontWeight: 700, color: r.nivel_servicio >= 0.99 ? "#0d8043" : r.nivel_servicio >= 0.975 ? "#b45309" : ROJO_ }}>
                                        {(r.nivel_servicio * 100).toFixed(1)}%</span> : "—"}</td>
                                  <td style={{ fontSize: 11.5, color: "#64748b" }}>{r.tipo_pago || "—"}</td>
                                  <td className="num" style={{ fontSize: 11.5 }}>
                                    {r.tarifa_aplicada != null ? "$" + fmt(Math.round(r.tarifa_aplicada)) : "—"}</td>
                                  <td className="num" style={{ fontWeight: 800, color: r.pago ? "#0d8043" : "#cbd5e1" }}>
                                    {r.pago ? "$" + fmt(Math.round(r.pago)) : "—"}
                                    {r.factor_ns != null && Number(r.factor_ns) !== 1 && (
                                      <div style={{ fontSize: 10.5, fontWeight: 700, color: Number(r.factor_ns) > 1 ? "#0d8043" : "#b42318" }}
                                           title={`Bono NS: NS ${r.ns_pct ?? "—"}% → factor ${r.factor_ns}`}>
                                        × {String(r.factor_ns).replace(".", ",")} · NS {r.ns_pct ?? "—"}%</div>
                                    )}</td>
                                  <td>
                                    {r.estado_pago === "calculado"
                                      ? <Etiqueta texto="CALCULADO" color="#0d8043" fondo="#e7f6ec" />
                                      : r.estado_pago === "sin tarifa"
                                        ? <span title={r.alerta_pago || `No existe la llave ${r.cecos || "?"} · ${r.servicio} · ${r.segmentacion_zonal || "?"} · ${r.tipo_vehiculo_bt} en el tarifario: hay que agregarla`}>
                                            <Etiqueta texto="SIN TARIFA" color="#b45309" fondo="#fef3c7" /></span>
                                      : r.estado_pago === "tipo por confirmar"
                                        ? <span title={r.alerta_pago || "Ruta no planificada: confirma si fue Spot o Ambulancia."}>
                                            <Etiqueta texto="POR CONFIRMAR TIPO" color={AMBAR_} fondo="#fdf6e3" /></span>
                                        : <span title="Falta la zona: corrígelo con el botón ✎ de esta fila, o crea la zona en la pestaña Zonas de Pago">
                                            <Etiqueta texto="SIN RESOLVER" color="#b42318" fondo="#fdecea" /></span>}
                                    {r.zona_manual && <span style={{ marginLeft: 4 }} title={r.motivo_manual || "Corrección manual"}>
                                        <Etiqueta texto="MANUAL" color="#5b21b6" fondo="#ede9fe" /></span>}
                                  </td>
                                  <td style={{ whiteSpace: "nowrap" }}>
                                    {r.estado_pago === "sin tarifa" && r.servicio && (
                                      <button className="mj-btn" style={{ padding: "2px 8px", fontSize: 11 }}
                                        title={(r.alerta_pago || "") + " Abre el Tarifario con esta llave ya rellenada."}
                                        onClick={() => crearTarifaDesdePago(r)}>➕ Crear tarifa</button>
                                    )}
                                    {r.estado_pago === "tipo por confirmar" && (
                                      <select className="mj-input" value="" disabled={tipoGuardando === r.id_viaje}
                                              style={{ fontSize: 11, padding: "2px 4px" }}
                                              onChange={e => confirmarTipoDesdePago(r, e.target.value)}>
                                        <option value="">{tipoGuardando === r.id_viaje ? "Guardando…" : "— confirmar tipo —"}</option>
                                        {[...servActivos.filter(x => ["SPOT", "AMBULANCIA"].includes(x.codigo)),
                                          ...servActivos.filter(x => !["SPOT", "AMBULANCIA"].includes(x.codigo))].map(x =>
                                          <option key={x.codigo} value={x.codigo}>{etiquetaTipo(x.codigo).t}</option>)}
                                      </select>
                                    )}
                                    {r.estado_pago === "sin resolver" && (
                                      <button className="mj-btn" style={{ padding: "2px 8px", fontSize: 11 }}
                                        title="Corregir la zona de este viaje"
                                        onClick={() => setOvr({ id_viaje: String(r.id_viaje), segmentacion: "", motivo: "" })}>
                                        ✎
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {filtrado.length === 0 && (
                                <tr><td colSpan={15} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>
                                  Sin viajes para esta fecha (requiere las migraciones 26 a 36).
                                </td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Fragment>
                  );
                })()}
              </Fragment>
            )}

            {/* ── Vehículos BT (tabla auxiliar de certificación) ── */}
            {tab === "revision" && (
              <Fragment>
                {revRuta && (
                  <MapaZonas zonas={zonas} segmentaciones={segmentaciones} api={api} ruta={revRuta}
                             onCerrar={() => setRevRuta(null)} onCreada={cargarZonas} />
                )}
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Revisión de zonas · {fecha}</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3, maxWidth: 940 }}>
                    Viajes donde el motor asignó la zona <strong>fuera de la regla normal</strong> (punto más lejano
                    en una zona de su centro). La columna Supervisor muestra lo que confirmó en la bitácora.
                    <strong> Tu decisión es la que paga</strong>: se guarda como corrección de zona del viaje, y
                    enseña al motor: cuando decides <strong>2 veces lo mismo para una comuna, sin contradecirte</strong>,
                    el motor lo aprende y deja de preguntar por esa comuna. Abre el mapa para ver la ruta y su punto más lejano.
                  </div>
                  <button className="mj-btn" style={{ marginTop: 8 }} onClick={() => setApPanel(v => !v)}>
                    {apPanel ? "Cerrar lo aprendido" : `🧠 Aprendido (${aprendido.filter(a => a.activo).length})`}
                  </button>
                  {apPanel && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 8, maxWidth: 940 }}>
                        Solo se aplica cuando el motor iba a pedir revisión: nunca cambia un viaje cuyo punto más lejano
                        cae en una zona de su centro. Si decides distinto para una comuna, su regla se apaga sola.
                        Si la desactivas a mano, no se reactiva hasta que la vuelvas a activar.
                      </div>
                      {!aprendido.length ? (
                        <div style={{ fontSize: 12, color: "#94a3b8" }}>Todavía no hay reglas: se crean al decidir viajes.</div>
                      ) : (
                        <table className="mj-tabla">
                          <thead><tr><th>Comuna del punto más lejano</th><th>Segmentación aprendida</th>
                            <th className="num">Decisiones</th><th>Nota</th><th>Estado</th></tr></thead>
                          <tbody>
                            {aprendido.map(a => (
                              <tr key={a.comuna} style={!a.activo ? { opacity: 0.55 } : {}}>
                                <td style={{ fontWeight: 700 }}>{a.comuna}</td>
                                <td><Etiqueta texto={a.segmentacion} /></td>
                                <td className="num">{fmt(a.decisiones)}</td>
                                <td style={{ fontSize: 11.5, color: "#64748b" }}>{a.nota || ""}</td>
                                <td><label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                                  <input type="checkbox" checked={!!a.activo} onChange={e => cambiarAprendido(a, e.target.checked)} />
                                  {" "}{a.activo ? "activa" : a.bloqueado ? "desactivada" : "apagada"}
                                </label></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                  {revMsg && <div style={{ fontSize: 12, color: VERDE_, marginTop: 6 }}>✓ {revMsg}</div>}
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  {Object.entries(ESTADO_REV).map(([k, v]) => (
                    <div key={k} onClick={() => setRevFiltro(f => ({ ...f, estado: f.estado === k ? "pendientes" : k }))}
                         style={{ background: revFiltro.estado === k ? v.f : "#fff", cursor: "pointer",
                                  border: `1px solid ${revFiltro.estado === k ? v.c : "#e6e9ef"}`,
                                  borderRadius: 10, padding: "9px 14px", minWidth: 150 }}>
                      <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 700, textTransform: "uppercase",
                                    letterSpacing: .4 }}>{v.t}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: v.c }}>{fmt(revCuenta(k))}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "11px 16px", marginBottom: 12, display: "flex", gap: 10,
                              alignItems: "center", flexWrap: "wrap" }}>
                  <select className="mj-input" value={revFiltro.estado}
                          onChange={e => setRevFiltro(f => ({ ...f, estado: e.target.value }))}>
                    <option value="pendientes">Por decidir</option>
                    <option value="">Todos</option>
                    {Object.entries(ESTADO_REV).map(([k, v]) => <option key={k} value={k}>{v.t}</option>)}
                  </select>
                  <select className="mj-input" value={revFiltro.origen}
                          onChange={e => setRevFiltro(f => ({ ...f, origen: e.target.value }))}>
                    <option value="">Todas las alertas</option>
                    {["otro_centro", "punto_alternativo", "comuna_historica", "sin_zona"].map(k =>
                      <option key={k} value={k}>{ORIGEN_ZONA[k]}</option>)}
                  </select>
                  <select className="mj-input" value={revFiltro.cecos}
                          onChange={e => setRevFiltro(f => ({ ...f, cecos: e.target.value }))}>
                    <option value="">Todos los centros</option>
                    {[...new Set(rev.map(r => r.codigo_meli).filter(Boolean))].sort().map(c =>
                      <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input className="mj-input" placeholder="Buscar viaje, conductor o comuna"
                         value={revFiltro.busca} style={{ minWidth: 220 }}
                         onChange={e => setRevFiltro(f => ({ ...f, busca: e.target.value }))} />
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    Mostrando {fmt(revVista.length)} de {fmt(rev.length)}
                  </span>
                  <span style={{ flex: 1 }} />
                  {revCuenta("supervisor_coincide") > 0 && (
                    <button className="mj-btn" disabled={revGuardando === "__bloque__"}
                            onClick={() => aprobarCoincidencias(revCuenta("supervisor_coincide"))}
                            style={{ background: VERDE_, color: "#fff", borderColor: VERDE_ }}>
                      {revGuardando === "__bloque__" ? "Aprobando…"
                        : `✓ Aprobar coincidencias (${revCuenta("supervisor_coincide")})`}
                    </button>
                  )}
                  <button className="mj-btn" onClick={cargarRevision}>↻ Actualizar</button>
                </div>

                <div className="mj-scroll">
                  <table className="mj-tabla">
                    <thead><tr>
                      <th>Viaje</th><th>Centro</th><th>Conductor</th><th>Comuna punto lejano</th>
                      <th className="num">Km</th><th>Propuesta del motor</th><th>Supervisor</th>
                      <th>Estado</th><th>Decisión</th><th></th>
                    </tr></thead>
                    <tbody>
                      {revVista.map(r => {
                        const est = ESTADO_REV[r.estado_revision] || ESTADO_REV.pendiente;
                        const editando = r.estado_revision !== "decidido" || revEditando === r.id_ruta;
                        const elegida = revSel[r.id_ruta] ??
                          (r.analista_segmentacion || r.supervisor_segmentacion || r.propuesta_motor || "");
                        return (
                          <tr key={r.id_ruta}>
                            <td style={{ fontWeight: 700 }}>{r.id_ruta}</td>
                            <td>{r.codigo_meli || "—"}</td>
                            <td style={{ maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis" }}
                                title={r.conductor || ""}>{r.conductor || "—"}</td>
                            <td>{r.comuna_punto_lejano || "—"}</td>
                            <td className="num">{r.km_punto_lejano ?? "—"}</td>
                            <td>
                              <strong>{r.propuesta_motor || "—"}</strong>
                              {r.origen_motor && r.origen_motor !== "punto_lejano" && (
                                <span style={{ marginLeft: 6 }}>
                                  <Etiqueta texto={ORIGEN_ZONA[r.origen_motor] || r.origen_motor}
                                            color={r.origen_motor === "sin_zona" ? ROJO_ : AMBAR_}
                                            fondo={r.origen_motor === "sin_zona" ? "#fdecea" : "#fdf6e3"} />
                                </span>
                              )}
                            </td>
                            <td title={r.supervisor_comentario || ""}>
                              {r.supervisor_segmentacion
                                ? <span><strong>{r.supervisor_segmentacion}</strong>
                                    <span style={{ color: "#8a94a6", marginLeft: 5 }}>
                                      {r.supervisor_nombre || ""}{r.supervisor_comentario ? " 💬" : ""}</span></span>
                                : <span style={{ color: "#a8b2c1" }}>sin respuesta</span>}
                            </td>
                            <td><Etiqueta texto={est.t} color={est.c} fondo={est.f} /></td>
                            <td>
                              {editando ? (
                                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                  <select className="mj-input" value={elegida} style={{ padding: "4px 6px", minWidth: 150 }}
                                          onChange={e => setRevSel(s => ({ ...s, [r.id_ruta]: e.target.value }))}>
                                    <option value="">— elegir —</option>
                                    {segmentaciones.map(sg => <option key={sg.nombre} value={sg.nombre}>{sg.nombre}</option>)}
                                  </select>
                                  <button className="mj-btn" disabled={revGuardando === r.id_ruta || !elegida}
                                          onClick={() => decidirZona(r, elegida)}
                                          style={{ background: NAVY, color: "#fff", borderColor: NAVY, padding: "4px 10px" }}>
                                    {revGuardando === r.id_ruta ? "…" : "Confirmar"}
                                  </button>
                                  {revEditando === r.id_ruta && (
                                    <button className="mj-btn" style={{ padding: "4px 8px" }}
                                            onClick={() => setRevEditando(null)}>✕</button>
                                  )}
                                </span>
                              ) : (
                                <span>
                                  <strong style={{ color: VERDE_ }}>✓ {r.analista_segmentacion}</strong>
                                  <span style={{ color: "#8a94a6", marginLeft: 5 }}>{r.analista_nombre || ""}</span>
                                  <button className="mj-btn" style={{ padding: "2px 8px", marginLeft: 8 }}
                                          onClick={() => setRevEditando(r.id_ruta)}>Cambiar</button>
                                </span>
                              )}
                            </td>
                            <td>
                              <button className="mj-btn" style={{ padding: "4px 10px" }}
                                      onClick={() => verRutaEnMapa(r)}>🗺 Mapa</button>
                            </td>
                          </tr>
                        );
                      })}
                      {!revVista.length && (
                        <tr><td colSpan={10} style={{ textAlign: "center", color: "#8a94a6", padding: 28 }}>
                          {rev.length ? "Ningún viaje con estos filtros."
                                      : "No hay viajes con alerta de zona este día."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Fragment>
            )}

            {tab === "vehiculos" && (
              <Fragment>
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Vehículos BT · clasificación, operación y supervisor</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3, maxWidth: 900 }}>
                    Define el tipo de vehículo para la llave de tarifa. <strong>Regla oficial: toda patente
                    que no esté acá paga como COMBUSTION</strong> — una eléctrica nueva sin registrar se paga
                    mal en silencio, así que las altas de flota deben pasar por esta tabla. La mantiene certificación.
                    Cada patente además tiene su <strong>operación (CECOS) y su supervisor</strong>, que se ven en el
                    Maestro Jornada: se cargan subiendo el informe de Pipefy "Vehículos Bigticket" o editando la fila.
                  </div>
                  {vehMsg && <div style={{ fontSize: 12, color: VERDE_, marginTop: 6 }}>✓ {vehMsg}</div>}
                </div>

                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 300 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Carga masiva</div>
                    <textarea className="mj-input" rows={3} value={vehMasivo}
                      onChange={e => setVehMasivo(e.target.value)}
                      placeholder={"PATENTE, TIPO — una por línea:\nSLXZ99, ELECTRICA\nTCJV80, BIG VAN"}
                      style={{ width: "100%", fontFamily: "inherit", fontSize: 12, resize: "vertical" }} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 6 }}>
                    <button className="mj-btn" onClick={cargarVehMasivo}
                            disabled={vehGuardando === "__masivo__" || !vehMasivo.trim()}
                            style={{ background: NAVY, color: "#fff", borderColor: NAVY, padding: "8px 14px" }}>
                      {vehGuardando === "__masivo__" ? "Cargando…" : "Cargar patentes"}
                    </button>
                    <div style={{ fontSize: 10.5, color: "#a8b2c1", maxWidth: 200 }}>
                      Tipos: ELECTRICA · BIG VAN · COMBUSTION LARGE VAN
                    </div>
                  </div>
                </div>

                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "11px 16px", marginBottom: 12, display: "flex", gap: 10,
                              alignItems: "flex-end", flexWrap: "wrap" }}>
                  <label style={{ fontSize: 10.5, color: "#64748b" }}>Patente<br/>
                    <input className="mj-input" value={vehNueva.patente} placeholder="SLXZ99"
                           onChange={e => setVehNueva(x => ({ ...x, patente: e.target.value }))}
                           onKeyDown={e => { if (e.key === "Enter") agregarVehiculo(); }}
                           style={{ width: 110, textTransform: "uppercase" }} /></label>
                  <label style={{ fontSize: 10.5, color: "#64748b" }}>Tipo<br/>
                    <select className="mj-input" value={vehNueva.proyecto}
                            onChange={e => setVehNueva(x => ({ ...x, proyecto: e.target.value }))}>
                      {TIPOS_VEH.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
                    </select></label>
                  <button className="mj-btn" onClick={agregarVehiculo}
                          disabled={!vehNueva.patente.trim() || !!vehGuardando}
                          style={{ background: NAVY, color: "#fff", borderColor: NAVY, padding: "7px 14px" }}>
                    ➕ Agregar patente
                  </button>
                  <label className="mj-btn" style={{ padding: "7px 14px", cursor: "pointer",
                         opacity: vehGuardando === "__pipefy__" ? 0.6 : 1 }}
                         title='Informe de Pipefy "Vehículos Bigticket" tal cual se descarga (.xlsx)'>
                    {vehGuardando === "__pipefy__" ? "Leyendo informe…" : "⬆ Subir informe Pipefy (.xlsx)"}
                    <input type="file" accept=".xlsx" style={{ display: "none" }}
                           disabled={vehGuardando === "__pipefy__"}
                           onChange={e => { const a = e.target.files && e.target.files[0]; e.target.value = ""; subirPipefy(a); }} />
                  </label>
                  <button className="mj-btn" onClick={() => setSupPanel(v => !v)} style={{ padding: "7px 14px" }}>
                    {supPanel ? "Cerrar supervisores" : `👤 Supervisores (${supervisores.filter(x => x.activo).length})`}
                  </button>
                  <span style={{ flex: 1 }} />
                  <label style={{ fontSize: 10.5, color: "#64748b" }}>Buscar<br/>
                    <input className="mj-input" value={vehBuscar} placeholder="patente, tipo, operación, supervisor…"
                           onChange={e => setVehBuscar(e.target.value)} style={{ width: 180 }} /></label>
                </div>

                {supPanel && (
                  <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                                padding: "12px 16px", marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Supervisores</div>
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, margin: "3px 0 10px" }}>
                      Cambiar un nombre se refleja en todos sus vehículos y en el Maestro. Un supervisor que deja
                      la operación se desactiva (no se borra): sus vehículos conservan el historial.
                    </div>
                    {!supervisores.length ? (
                      <div style={{ fontSize: 12, color: AMBAR_ }}>Todavía no hay supervisores (falta la migración 65 o la carga de Pipefy).</div>
                    ) : (
                      <table className="mj-tabla" style={{ marginBottom: 10 }}>
                        <thead><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th>
                          <th className="num">Vehículos</th><th>Estado</th></tr></thead>
                        <tbody>
                          {supervisores.map(sp => (
                            <tr key={sp.id} style={!sp.activo ? { opacity: 0.55 } : {}}>
                              <td><input className="mj-input" defaultValue={sp.nombre} style={{ fontSize: 12, minWidth: 230 }}
                                     onBlur={e => { const v = e.target.value.trim().replace(/\s+/g, " ");
                                       if (v && v !== sp.nombre) actualizarSupervisor(sp.id, { nombre: v }); }} /></td>
                              <td><input className="mj-input" defaultValue={sp.correo || ""} placeholder="correo"
                                     style={{ fontSize: 12, minWidth: 200 }}
                                     onBlur={e => { const v = e.target.value.trim();
                                       if (v !== (sp.correo || "")) actualizarSupervisor(sp.id, { correo: v || null }); }} /></td>
                              <td><input className="mj-input" defaultValue={sp.telefono || ""} placeholder="teléfono"
                                     style={{ fontSize: 12, width: 130 }}
                                     onBlur={e => { const v = e.target.value.trim();
                                       if (v !== (sp.telefono || "")) actualizarSupervisor(sp.id, { telefono: v || null }); }} /></td>
                              <td className="num">{fmt(Object.values(vehOps).filter(x => x.supervisor_id === sp.id).length)}</td>
                              <td>
                                <label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                                  <input type="checkbox" checked={!!sp.activo} disabled={supGuardando === sp.id}
                                         onChange={e => actualizarSupervisor(sp.id, { activo: e.target.checked })} />
                                  {" "}{sp.activo ? "activo" : "inactivo"}
                                </label>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Nombre<br/>
                        <input className="mj-input" value={supNuevo.nombre} placeholder="NOMBRE APELLIDO APELLIDO"
                               onChange={e => setSupNuevo(x => ({ ...x, nombre: e.target.value }))} style={{ width: 240 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Correo<br/>
                        <input className="mj-input" value={supNuevo.correo} placeholder="nombre@bigticket.cl"
                               onChange={e => setSupNuevo(x => ({ ...x, correo: e.target.value }))} style={{ width: 210 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Teléfono<br/>
                        <input className="mj-input" value={supNuevo.telefono} placeholder="+56 9…"
                               onChange={e => setSupNuevo(x => ({ ...x, telefono: e.target.value }))} style={{ width: 130 }} /></label>
                      <button className="mj-btn" onClick={agregarSupervisor}
                              disabled={supGuardando === "__nuevo__" || !supNuevo.nombre.trim()}
                              style={{ background: NAVY, color: "#fff", borderColor: NAVY }}>
                        {supGuardando === "__nuevo__" ? "Agregando…" : "➕ Agregar supervisor"}
                      </button>
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginTop: 18 }}>Supervisores por CECO (bitácora)</div>
                    <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, margin: "3px 0 10px", maxWidth: 940 }}>
                      Un viaje sin supervisor por patente toma al supervisor a cargo de su CECO. Son los CECOS que cada
                      supervisor tiene en la bitácora: <strong>cambiarlos aquí también cambia lo que ve en la bitácora</strong>.
                      Los usuarios de prueba siguen en la bitácora, pero no aparecen en el Maestro.
                    </div>
                    {(() => {
                      const norm = (c) => String(c || "").toUpperCase().replace(/[_ ]/g, "");
                      const cubiertos = new Set(supBit.filter(b => b.activo && !b.es_prueba).flatMap(b => (Array.isArray(b.scs_asignados) ? b.scs_asignados : []).map(norm)));
                      const sinSup = cecosNombres.filter(c => /^ML_/.test(c) && !cubiertos.has(norm(c)));
                      return sinSup.length > 0 && (
                        <div style={{ fontSize: 12, color: AMBAR_, marginBottom: 8 }}>
                          ⚠ CECOS sin supervisor: <strong>{sinSup.join(", ")}</strong>
                        </div>
                      );
                    })()}
                    {!supBit.length ? (
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>No se pudo leer la lista de la bitácora (falta la migración 78).</div>
                    ) : (
                      <table className="mj-tabla">
                        <thead><tr><th>Supervisor</th><th>Correo</th><th>CECOS a cargo (separados por coma)</th><th>Prueba</th></tr></thead>
                        <tbody>
                          {supBit.filter(b => b.activo).map(b => (
                            <tr key={b.email} style={b.es_prueba ? { opacity: 0.55 } : {}}>
                              <td style={{ fontWeight: 600 }}>{b.nombre}</td>
                              <td style={{ fontSize: 11.5, color: "#64748b" }}>{b.email}</td>
                              <td><input className="mj-input" defaultValue={(Array.isArray(b.scs_asignados) ? b.scs_asignados : []).join(", ")} style={{ fontSize: 12, minWidth: 280 }}
                                     onBlur={e => {
                                       const lista = e.target.value.split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
                                       if (lista.join(",") !== (Array.isArray(b.scs_asignados) ? b.scs_asignados : []).join(",")) actualizarSupBit(b.email, { scs_asignados: lista });
                                     }} /></td>
                              <td><label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                                <input type="checkbox" checked={!!b.es_prueba} onChange={e => actualizarSupBit(b.email, { es_prueba: e.target.checked })} />
                                {" "}{b.es_prueba ? "de prueba" : "oficial"}
                              </label></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {(() => {
                  // Una fila por patente: las que tienen clasificación de tarifa y las que vienen de Pipefy
                  const tarifaDe = Object.fromEntries(vehiculos.map(v => [v.patente, v]));
                  const pats = [...new Set([...vehiculos.map(v => v.patente), ...Object.keys(vehOps)])];
                  const qv = vehBuscar.trim().toUpperCase();
                  const filasVeh = pats.map(p => ({ patente: p, tarifa: tarifaDe[p] || null, op: vehOps[p] || null }))
                    .filter(f => !qv || `${f.patente} ${f.tarifa?.proyecto || ""} ${f.op?.cecos_operacion || ""} ${f.op?.supervisor || ""} ${f.op?.marca || ""} ${f.op?.modelo || ""}`.toUpperCase().includes(qv))
                    .sort((a, b) => (a.op?.cecos_operacion || "~").localeCompare(b.op?.cecos_operacion || "~") || a.patente.localeCompare(b.patente));
                  const cecosOpc = (ed) => [...new Set([...cecosNombres, ...Object.values(vehOps).map(x => x.cecos_operacion), ed.cecos_operacion].filter(Boolean))].sort();
                  return (
                    <Fragment>
                      <div style={{ fontSize: 12, color: "#64748b", margin: "0 2px 6px" }}>
                        Mostrando <strong>{fmt(filasVeh.length)}</strong> de {fmt(pats.length)} patentes
                        {" · "}{fmt(pats.filter(p => vehOps[p]?.supervisor).length)} con supervisor
                        {" · "}{fmt(pats.filter(p => !tarifaDe[p]).length)} sin clasificación de tarifa
                      </div>
                      <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "auto" }}>
                  <table className="mj-tabla">
                    <thead>
                      <tr><th>Patente</th><th>Tipo (tarifa)</th><th>Operación</th><th>Supervisor</th>
                          <th>Vehículo</th><th>Activa</th><th>Nota</th><th></th></tr>
                    </thead>
                    <tbody>
                      {filasVeh.map(({ patente, tarifa: v, op }) => {
                        const ed = vehEdit[patente];
                        const sel = { fontSize: 12, padding: "3px 4px", maxWidth: 210 };
                        const setE = (campo, valor) => setVehEdit(x => ({ ...x, [patente]: { ...x[patente], [campo]: valor } }));
                        return (
                          <tr key={patente} style={op && op.activo_operacion === false ? { opacity: 0.6 } : {}}>
                            <td style={{ fontWeight: 700 }}>{patente}</td>
                            <td>
                              {ed ? (
                                <select className="mj-input" value={ed.proyecto} style={sel}
                                        onChange={e => setE("proyecto", e.target.value)}>
                                  {!v && <option value="">— sin clasificar —</option>}
                                  {TIPOS_VEH.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
                                </select>
                              ) : v ? (v.proyecto === "ELECTRICA"
                                    ? <Etiqueta texto="ELECTRICA" color="#0d8043" fondo="#e7f6ec" />
                                    : <span style={{ fontSize: 12 }}>{v.proyecto}</span>)
                                : <span style={{ fontSize: 11, color: AMBAR_ }} title="Sin clasificación de tarifa: paga como COMBUSTION">sin clasificar</span>}
                            </td>
                            <td>
                              {ed ? (
                                <select className="mj-input" value={ed.cecos_operacion} style={sel}
                                        onChange={e => setE("cecos_operacion", e.target.value)}>
                                  <option value="">— sin operación —</option>
                                  {cecosOpc(ed).map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              ) : op?.cecos_operacion
                                ? <Etiqueta texto={op.cecos_operacion} />
                                : <span style={{ color: "#cbd5e1" }}>—</span>}
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {ed ? (
                                <select className="mj-input" value={ed.supervisor_id} style={sel}
                                        onChange={e => setE("supervisor_id", e.target.value)}>
                                  <option value="">— sin supervisor —</option>
                                  {supervisores.filter(sp => sp.activo || String(sp.id) === String(ed.supervisor_id)).map(sp =>
                                    <option key={sp.id} value={sp.id}>{sp.nombre}</option>)}
                                </select>
                              ) : (op?.supervisor || <span style={{ color: "#cbd5e1" }}>—</span>)}
                            </td>
                            <td style={{ fontSize: 11, color: "#64748b" }}>
                              {op && (op.tipo || op.marca)
                                ? <span title={`${op.energia || ""} · ${op.region || ""}${op.tiene_gps === false ? " · sin GPS" : ""}`}>
                                    {[op.tipo, op.marca, op.modelo, op.anio].filter(Boolean).join(" · ")}</span>
                                : <span style={{ color: "#cbd5e1" }}>—</span>}
                            </td>
                            <td>
                              {ed && v ? (
                                <label style={{ fontSize: 10.5, color: "#64748b" }}>
                                  <input type="checkbox" checked={!!ed.activo} onChange={e => setE("activo", e.target.checked)} /> activa
                                </label>
                              ) : v ? (v.activo
                                  ? <Etiqueta texto="ACTIVA" color="#0d8043" fondo="#e7f6ec" />
                                  : <Etiqueta texto="INACTIVA" color="#8a94a6" fondo="#f1f5f9" />)
                                : op?.estado_pipefy
                                  ? <span style={{ fontSize: 11, color: "#94a3b8" }}>Pipefy: {op.estado_pipefy}</span> : null}
                            </td>
                            <td style={{ fontSize: 11, color: "#94a3b8", maxWidth: 260 }}>{v?.nota || ""}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {ed ? (
                                <Fragment>
                                  <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11,
                                      background: NAVY, color: "#fff", borderColor: NAVY }}
                                    disabled={vehGuardando === patente}
                                    onClick={() => guardarFilaVehiculo(patente, v, op, ed)}>
                                    {vehGuardando === patente ? "…" : "Guardar"}
                                  </button>
                                  <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }}
                                    onClick={() => setVehEdit(x => { const n = { ...x }; delete n[patente]; return n; })}>
                                    Cancelar
                                  </button>
                                </Fragment>
                              ) : (
                                <Fragment>
                                  <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                                    onClick={() => setVehEdit(x => ({ ...x, [patente]: {
                                      proyecto: v?.proyecto || "", activo: v ? v.activo : true,
                                      cecos_operacion: op?.cecos_operacion || "",
                                      supervisor_id: op?.supervisor_id ? String(op.supervisor_id) : "" } }))}>
                                    Editar
                                  </button>
                                  {v && (
                                    <button className="mj-btn" title="Quitar la clasificación de tarifa de esta patente"
                                      style={{ padding: "3px 9px", fontSize: 11, marginLeft: 4,
                                               color: "#b42318", borderColor: "#f3c9c4" }}
                                      disabled={vehGuardando === patente}
                                      onClick={() => eliminarVehiculo(v)}>
                                      {vehGuardando === patente ? "…" : "Eliminar"}
                                    </button>
                                  )}
                                </Fragment>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {pats.length === 0 && (
                        <tr><td colSpan={8} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>
                          Cargando… (requiere las migraciones 31 y 65)
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                      </div>
                    </Fragment>
                  );
                })()}
              </Fragment>
            )}

            {/* ── Tarifario ── */}
            {tab === "tarifario" && (() => {
              const $m = (v) => v == null ? "—" :
                "$" + Number(v).toLocaleString("es-CL", { maximumFractionDigits: 2 });
              // ── Filtros por columna ──
              const editada = (t) => t.actualizado_por === "brain";   // editada o creada fila por fila en el Brain
              // ── edición completa de una fila ──
              const aTexto = (v) => v == null ? "" : String(v);
              const tarifaAEdicion = (t) => ({
                servicio: t.servicio, cecos_admin: aTexto(t.cecos_admin), segmentacion: aTexto(t.segmentacion),
                tipo_pago: t.tipo_pago, detalle: aTexto(t.detalle), tipo_vehiculo: t.tipo_vehiculo,
                tarifa_oficial: aTexto(t.tarifa_oficial), tarifa_contingencia: aTexto(t.tarifa_contingencia),
                contingencia_activa: !!t.contingencia_activa,
                cobrar_oficial: aTexto(t.cobrar_oficial), cobrar_contingencia: aTexto(t.cobrar_contingencia),
                entregas_base: aTexto(t.entregas_base), tarifa_adicional: aTexto(t.tarifa_adicional),
                vigente_desde: t.vigente_desde, vigente_hasta: t.vigente_hasta, activa: !!t.activa });
              const normLlave = (v) => (v === "" || v == null) ? null : String(v).trim();
              const guardarEdicion = (t, ed) => {
                const num = (v) => (v === "" || v == null) ? null : Number(v);
                const esPiso = ed.tipo_pago === "PISO";
                if (ed.tarifa_oficial === "" || ed.tarifa_oficial == null) { setError("Falta el monto oficial."); return; }
                if (esPiso && (ed.entregas_base === "" || ed.tarifa_adicional === "")) {
                  setError("Tarifa PISO: indica cuántas entregas cubre el piso y el $ por cada entrega adicional " +
                           "(si es un monto fijo, pon 0 en ambos)."); return;
                }
                const datos = {
                  servicio: ed.servicio, cecos_admin: normLlave(ed.cecos_admin), segmentacion: normLlave(ed.segmentacion),
                  tipo_pago: ed.tipo_pago, detalle: normLlave(ed.detalle), tipo_vehiculo: ed.tipo_vehiculo,
                  tarifa_oficial: Number(ed.tarifa_oficial), tarifa_contingencia: num(ed.tarifa_contingencia),
                  contingencia_activa: !!ed.contingencia_activa,
                  cobrar_oficial: num(ed.cobrar_oficial), cobrar_contingencia: num(ed.cobrar_contingencia),
                  entregas_base: esPiso ? Math.round(Number(ed.entregas_base)) : null,
                  tarifa_adicional: esPiso ? Number(ed.tarifa_adicional) : null,
                  vigente_desde: ed.vigente_desde || t.vigente_desde, vigente_hasta: ed.vigente_hasta || null,
                  activa: !!ed.activa };
                const NOMBRES = { servicio: "servicio", cecos_admin: "CECOS", segmentacion: "segmentación",
                                  tipo_pago: "tipo de pago", detalle: "detalle", tipo_vehiculo: "vehículo" };
                const cambia = Object.keys(NOMBRES).filter(k => normLlave(datos[k]) !== normLlave(t[k]));
                if (cambia.length && !window.confirm(
                  `Vas a cambiar ${cambia.map(k => NOMBRES[k]).join(", ")} de esta tarifa.\n\n` +
                  `El cambio rige para TODOS los días de su vigencia (${vigDe(t)}): el pago de esos días se ` +
                  `recalcula con la nueva llave.\n\nSi lo que buscas es un cambio desde una fecha en adelante, ` +
                  `cancela, cierra la vigencia de esta fila y crea una tarifa nueva.\n\n¿Continuar?`)) return;
                guardarTarifa(t.id, datos);
              };
              const setEd = (id, campo, valor) =>
                setTarifaEdit(x => ({ ...x, [id]: { ...x[id], [campo]: valor } }));
              const selE = { fontSize: 11, padding: "3px 4px", maxWidth: 140 };
              const pagaDe = (t) => t.contingencia_activa ? "CONTINGENCIA" : "OFICIAL";
              const cobrarDe = (t) => t.contingencia_activa ? t.cobrar_contingencia : t.cobrar_oficial;
              const vigDe = (t) => `${t.vigente_desde || "—"} → ${t.vigente_hasta || "∞"}`;
              const tipoDe = (t) => `${t.tipo_pago}${t.detalle ? " · " + t.detalle : ""}`;
              const norm = (x) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
              const contiene = (valor, q) => !q || norm(valor).includes(norm(q));
              const montoTxt = (v) => v == null ? "" : `${v} ${Number(v).toLocaleString("es-CL")}`;
              const F = tarifaFiltros;
              const setF = (k, v) => setTarifaFiltros(x => ({ ...x, [k]: v }));
              const visibles = tarifas.filter(t =>
                (tarifaServicio === "todos" || t.servicio === tarifaServicio)
                && (!F.cecos || (F.cecos === "__todos__" ? !t.cecos_admin : t.cecos_admin === F.cecos))
                && contiene(t.segmentacion, F.segmentacion)
                && (!F.tipo || t.tipo_pago === F.tipo)
                && (!F.vehiculo || t.tipo_vehiculo === F.vehiculo)
                && contiene(montoTxt(t.tarifa_oficial), F.oficial)
                && contiene(montoTxt(t.tarifa_contingencia), F.contingencia)
                && (!F.paga || pagaDe(t) === F.paga)
                && contiene(montoTxt(cobrarDe(t)), F.cobrar)
                && contiene(vigDe(t), F.vigencia)
                && (!F.estado || (F.estado === "ACTIVA") === !!t.activa)
                && (!F.edicion || (F.edicion === "editadas") === editada(t)));
              const opciones = (fn) => [...new Set(tarifas.map(fn).filter(Boolean))].sort();
              const hayFiltros = tarifaServicio !== "todos" || Object.values(F).some(Boolean);
              const nEditadas = tarifas.filter(editada).length;
              const fil = { width: "100%", minWidth: 70, fontSize: 11, padding: "3px 5px",
                            borderRadius: 5, border: "1px solid #cbd5e1", background: "#fff",
                            color: "#1e293b", fontWeight: 500 };
              const conContingencia = tarifas.filter(t => t.activa && t.contingencia_activa).length;
              const inp = { fontSize: 11.5, width: 92, textAlign: "right" };
              return (
                <Fragment>
                  <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                                padding: "13px 16px", marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ maxWidth: 760 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Tarifario por pagar y cobrar</div>
                        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3 }}>
                          La llave es <strong>CECOS admin + segmentación + servicio + vehículo</strong>. Cada fila
                          trae tarifa <strong>oficial</strong> y de <strong>contingencia</strong> (oficial + subvención
                          por combustible): paga la que tenga el interruptor. Los cambios rigen <strong>de
                          inmediato</strong> sobre cualquier día dentro de la vigencia — para un cambio de precio
                          a futuro, cierra la vigencia de la fila vieja y crea una nueva desde esa fecha.
                        </div>
                        {tarifaMsg && <div style={{ fontSize: 12, color: "#0d8043", marginTop: 5 }}>✓ {tarifaMsg}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <select className="mj-input" value={tarifaServicio}
                                onChange={e => setTarifaServicio(e.target.value)}>
                          <option value="todos">Todos los servicios ({fmt(tarifas.length)})</option>
                          {[...new Set([...serviciosCat.map(x => x.codigo), ...SERVICIOS_TARIFA, ...tarifas.map(t => t.servicio)])].map(sv => {
                            const c = tarifas.filter(t => t.servicio === sv).length;
                            return c ? <option key={sv} value={sv}>{sv} ({c})</option> : null;
                          })}
                        </select>
                        <button className="mj-btn" onClick={() => setTarifaNueva(tarifaNueva ? null : { ...TARIFA_NUEVA0 })}
                                style={{ background: NAVY, color: "#fff", borderColor: NAVY }}>
                          {tarifaNueva ? "Cerrar" : "➕ Nueva tarifa"}
                        </button>
                        <button className="mj-btn" onClick={() => setServPanel(v => !v)}>
                          {servPanel ? "Cerrar servicios" : "⚙ Tipos de servicio"}
                        </button>
                        <button className="mj-btn" onClick={() => setBonoPanel(v => !v)}>
                          {bonoPanel ? "Cerrar bono NS" : `⚖ Bono NS (${bonoNs.filter(b => b.activo).length})`}
                        </button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10,
                                  paddingTop: 10, borderTop: "1px dashed #eef1f5", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700,
                                     color: conContingencia ? "#b45309" : "#64748b" }}>
                        Subvención combustible (contingencia): {conContingencia
                          ? `ACTIVA en ${fmt(conContingencia)} tarifas` : "desactivada"}
                      </span>
                      <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                              disabled={tarifaGuardando === "__global__"}
                              onClick={() => contingenciaGlobal(true)}>Activar en todas</button>
                      <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                              disabled={tarifaGuardando === "__global__"}
                              onClick={() => contingenciaGlobal(false)}>Desactivar en todas</button>
                      <span style={{ fontSize: 10.5, color: "#a8b2c1" }}>
                        pide confirmación · rige de inmediato en el pago calculado
                      </span>
                    </div>
                  </div>

                  {bonoPanel && (
                    <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                                  padding: "12px 16px", marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Bono / castigo por nivel de servicio</div>
                      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, margin: "3px 0 10px", maxWidth: 940 }}>
                        El factor multiplica el pago del viaje cuando su NS ácido (entregados ÷ cargados; en colectas,
                        recolectados ÷ estimados) cae en el rango: <strong>desde ≤ NS &lt; hasta</strong> (hasta vacío = sin tope).
                        1,05 = bono de 5%; 0,95 = castigo de 5%. Si calzan varios tramos, gana el más específico
                        (con servicio, luego con CECOS). <strong>Sin tramos activos, el factor es 1,00</strong> y el pago no cambia.
                      </div>
                      {bonoNs.length > 0 && (
                        <table className="mj-tabla" style={{ marginBottom: 10 }}>
                          <thead><tr><th className="num">% NS desde</th><th className="num">% NS hasta</th><th className="num">Factor</th>
                            <th>Servicio</th><th>CECOS</th><th>Vigente desde</th><th>Hasta</th><th>Nota</th><th>Estado</th></tr></thead>
                          <tbody>
                            {bonoNs.map(b => (
                              <tr key={b.id} style={!b.activo ? { opacity: 0.55 } : {}}>
                                <td className="num"><input className="mj-input" defaultValue={b.ns_desde ?? ""} style={{ width: 64, textAlign: "right", fontSize: 12 }}
                                  onBlur={e => { const v = numOVacio(e.target.value); if (v !== Number(b.ns_desde)) actualizarTramo(b, { ns_desde: v }); }} /></td>
                                <td className="num"><input className="mj-input" defaultValue={b.ns_hasta ?? ""} placeholder="sin tope" style={{ width: 70, textAlign: "right", fontSize: 12 }}
                                  onBlur={e => { const v = numOVacio(e.target.value); if (v !== (b.ns_hasta === null ? null : Number(b.ns_hasta))) actualizarTramo(b, { ns_hasta: v }); }} /></td>
                                <td className="num"><input className="mj-input" defaultValue={b.factor ?? ""} style={{ width: 64, textAlign: "right", fontSize: 12, fontWeight: 700,
                                    color: Number(b.factor) > 1 ? "#0d8043" : Number(b.factor) < 1 ? "#b42318" : undefined }}
                                  onBlur={e => { const v = numOVacio(e.target.value); if (v !== Number(b.factor)) actualizarTramo(b, { factor: v }); }} /></td>
                                <td><select className="mj-input" value={b.servicio || ""} style={{ fontSize: 12 }}
                                  onChange={e => actualizarTramo(b, { servicio: e.target.value || null })}>
                                  <option value="">Todos</option>
                                  {serviciosOpc.map(sv => <option key={sv} value={sv}>{etiquetaTipo(sv).t}</option>)}
                                </select></td>
                                <td><select className="mj-input" value={b.cecos_admin || ""} style={{ fontSize: 12 }}
                                  onChange={e => actualizarTramo(b, { cecos_admin: e.target.value || null })}>
                                  <option value="">Todos</option>
                                  {[...new Set([...adminCat, b.cecos_admin].filter(Boolean))].map(c => <option key={c} value={c}>{c}</option>)}
                                </select></td>
                                <td><input className="mj-input" type="date" defaultValue={b.vigente_desde || ""} style={{ fontSize: 12 }}
                                  onBlur={e => { if (e.target.value && e.target.value !== b.vigente_desde) actualizarTramo(b, { vigente_desde: e.target.value }); }} /></td>
                                <td><input className="mj-input" type="date" defaultValue={b.vigente_hasta || ""} style={{ fontSize: 12 }}
                                  onBlur={e => { const v = e.target.value || null; if (v !== (b.vigente_hasta || null)) actualizarTramo(b, { vigente_hasta: v }); }} /></td>
                                <td><input className="mj-input" defaultValue={b.nota || ""} style={{ fontSize: 12, width: 160 }}
                                  onBlur={e => { const v = e.target.value.trim() || null; if (v !== (b.nota || null)) actualizarTramo(b, { nota: v }); }} /></td>
                                <td><label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                                  <input type="checkbox" checked={!!b.activo} disabled={bonoGuardando === b.id}
                                         onChange={e => actualizarTramo(b, { activo: e.target.checked })} /> {b.activo ? "activo" : "inactivo"}
                                </label></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                        {[["ns_desde", "% NS desde", "98", 70], ["ns_hasta", "% NS hasta", "sin tope", 70], ["factor", "Factor", "1,05", 64]].map(([k, t, ph, w]) => (
                          <label key={k} style={{ fontSize: 10.5, color: "#64748b" }}>{t}<br/>
                            <input className="mj-input" value={bonoNuevo[k]} placeholder={ph} style={{ width: w }}
                                   onChange={e => setBonoNuevo(x => ({ ...x, [k]: e.target.value }))} /></label>
                        ))}
                        <label style={{ fontSize: 10.5, color: "#64748b" }}>Servicio<br/>
                          <select className="mj-input" value={bonoNuevo.servicio} onChange={e => setBonoNuevo(x => ({ ...x, servicio: e.target.value }))}>
                            <option value="">Todos</option>
                            {serviciosOpc.map(sv => <option key={sv} value={sv}>{etiquetaTipo(sv).t}</option>)}
                          </select></label>
                        <label style={{ fontSize: 10.5, color: "#64748b" }}>CECOS<br/>
                          <select className="mj-input" value={bonoNuevo.cecos_admin} onChange={e => setBonoNuevo(x => ({ ...x, cecos_admin: e.target.value }))}>
                            <option value="">Todos</option>
                            {adminCat.map(c => <option key={c} value={c}>{c}</option>)}
                          </select></label>
                        <label style={{ fontSize: 10.5, color: "#64748b" }}>Vigente desde<br/>
                          <input className="mj-input" type="date" value={bonoNuevo.vigente_desde}
                                 onChange={e => setBonoNuevo(x => ({ ...x, vigente_desde: e.target.value }))} /></label>
                        <label style={{ fontSize: 10.5, color: "#64748b" }}>Hasta<br/>
                          <input className="mj-input" type="date" value={bonoNuevo.vigente_hasta}
                                 onChange={e => setBonoNuevo(x => ({ ...x, vigente_hasta: e.target.value }))} /></label>
                        <label style={{ fontSize: 10.5, color: "#64748b" }}>Nota<br/>
                          <input className="mj-input" value={bonoNuevo.nota} placeholder="acuerdo, correo…" style={{ width: 160 }}
                                 onChange={e => setBonoNuevo(x => ({ ...x, nota: e.target.value }))} /></label>
                        <button className="mj-btn" onClick={agregarTramo}
                                disabled={bonoGuardando === "__nuevo__" || bonoNuevo.ns_desde === "" || bonoNuevo.factor === ""}
                                style={{ background: NAVY, color: "#fff", borderColor: NAVY }}>
                          {bonoGuardando === "__nuevo__" ? "Agregando…" : "➕ Agregar tramo"}
                        </button>
                      </div>
                    </div>
                  )}

                  {servPanel && (
                    <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                                  padding: "12px 16px", marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Tipos de servicio</div>
                      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, margin: "3px 0 10px" }}>
                        Los servicios que puede tener una tarifa. Un servicio con tarifas no se borra: se
                        desactiva, y deja de ofrecerse al crear tarifas nuevas (las existentes no cambian).
                      </div>
                      {!serviciosCat.length ? (
                        <div style={{ fontSize: 12, color: AMBAR_ }}>
                          El catálogo todavía no existe en la base (falta correr la migración 63).
                        </div>
                      ) : (
                        <table className="mj-tabla" style={{ marginBottom: 10 }}>
                          <thead><tr><th>Código</th><th>Descripción</th><th className="num">Orden</th>
                            <th className="num">Tarifas</th><th>Estado</th></tr></thead>
                          <tbody>
                            {serviciosCat.map(sv => (
                              <tr key={sv.codigo} style={!sv.activo ? { opacity: 0.55 } : {}}>
                                <td style={{ fontWeight: 700 }}>{sv.codigo}</td>
                                <td>
                                  <input className="mj-input" defaultValue={sv.descripcion || ""}
                                         style={{ fontSize: 12, minWidth: 240 }} placeholder="descripción"
                                         onBlur={e => { if (e.target.value.trim() !== (sv.descripcion || ""))
                                           actualizarServicio(sv.codigo, { descripcion: e.target.value.trim() || null }); }} />
                                </td>
                                <td className="num">
                                  <input className="mj-input" type="number" step="10" defaultValue={sv.orden}
                                         style={{ fontSize: 12, width: 64, textAlign: "right" }}
                                         onBlur={e => { const o = Math.round(Number(e.target.value));
                                           if (Number.isFinite(o) && o !== sv.orden) actualizarServicio(sv.codigo, { orden: o }); }} />
                                </td>
                                <td className="num">{fmt(tarifas.filter(t => t.servicio === sv.codigo).length)}</td>
                                <td>
                                  <label style={{ fontSize: 11.5, color: "#64748b", whiteSpace: "nowrap" }}>
                                    <input type="checkbox" checked={!!sv.activo} disabled={servGuardando === sv.codigo}
                                           onChange={e => actualizarServicio(sv.codigo, { activo: e.target.checked })} />
                                    {" "}{sv.activo ? "activo" : "inactivo"}
                                  </label>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {serviciosCat.length > 0 && (
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <label style={{ fontSize: 10.5, color: "#64748b" }}>Código nuevo<br/>
                            <input className="mj-input" value={servNuevo.codigo} placeholder="SAME DAY"
                                   onChange={e => setServNuevo(x => ({ ...x, codigo: e.target.value.toUpperCase() }))}
                                   style={{ width: 140 }} /></label>
                          <label style={{ fontSize: 10.5, color: "#64748b" }}>Descripción<br/>
                            <input className="mj-input" value={servNuevo.descripcion} placeholder="Entrega el mismo día"
                                   onChange={e => setServNuevo(x => ({ ...x, descripcion: e.target.value }))}
                                   style={{ width: 260 }} /></label>
                          <button className="mj-btn" onClick={agregarServicio}
                                  disabled={servGuardando === "__nuevo__" || !servNuevo.codigo.trim()}
                                  style={{ background: NAVY, color: "#fff", borderColor: NAVY }}>
                            {servGuardando === "__nuevo__" ? "Agregando…" : "➕ Agregar servicio"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {tarifaNueva && (
                    <div style={{ background: "#fdf6e3", border: "1px solid #f3e2b8", borderRadius: 10,
                                  padding: "12px 16px", marginBottom: 12, display: "flex", gap: 8,
                                  flexWrap: "wrap", alignItems: "flex-end" }}>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>CECOS admin<br/>
                        <select className="mj-input" value={tarifaNueva.cecos_admin}
                                onChange={e => setTarifaNueva(t => ({ ...t, cecos_admin: e.target.value }))}
                                style={{ minWidth: 140 }}>
                          <option value="">— todos (SPOT/SORTEO) —</option>
                          {adminCat.map(a => <option key={a} value={a}>{a}</option>)}
                        </select></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Segmentación<br/>
                        <select className="mj-input" value={tarifaNueva.segmentacion}
                                onChange={e => setTarifaNueva(t => ({ ...t, segmentacion: e.target.value }))}
                                style={{ minWidth: 130 }}>
                          <option value="">— sin (TRONCAL/SPOT) —</option>
                          {segmentaciones.map(sg => <option key={sg.nombre} value={sg.nombre}>{sg.nombre}</option>)}
                        </select></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Servicio<br/>
                        <select className="mj-input" value={tarifaNueva.servicio}
                                onChange={e => setTarifaNueva(t => ({ ...t, servicio: e.target.value }))}>
                          {serviciosOpc.map(sv => <option key={sv} value={sv}>{sv}</option>)}
                        </select></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Tipo pago<br/>
                        <select className="mj-input" value={tarifaNueva.tipo_pago}
                                onChange={e => setTarifaNueva(t => ({ ...t, tipo_pago: e.target.value }))}>
                          {TIPOS_PAGO.map(tp => <option key={tp} value={tp}>{tp}</option>)}
                        </select></label>
                      {tarifaNueva.tipo_pago === "PISO" && (
                        <Fragment>
                          <label style={{ fontSize: 10.5, color: "#b45309", fontWeight: 700 }}>Entregas base *<br/>
                            <input className="mj-input" type="number" step="1" min="0" value={tarifaNueva.entregas_base}
                                   placeholder="75" title="Entregas que cubre el piso (0 si es monto fijo)"
                                   onChange={e => setTarifaNueva(t => ({ ...t, entregas_base: e.target.value }))}
                                   style={{ ...inp, borderColor: "#f59e0b" }} /></label>
                          <label style={{ fontSize: 10.5, color: "#b45309", fontWeight: 700 }}>$ Adicional *<br/>
                            <input className="mj-input" type="number" step="0.01" min="0" value={tarifaNueva.tarifa_adicional}
                                   placeholder="por entrega extra" title="$ por cada entrega sobre el piso (0 si es monto fijo)"
                                   onChange={e => setTarifaNueva(t => ({ ...t, tarifa_adicional: e.target.value }))}
                                   style={{ ...inp, borderColor: "#f59e0b" }} /></label>
                        </Fragment>
                      )}
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Vehículo<br/>
                        <select className="mj-input" value={tarifaNueva.tipo_vehiculo}
                                onChange={e => setTarifaNueva(t => ({ ...t, tipo_vehiculo: e.target.value }))}>
                          {VEHICULOS_TARIFA.map(v => <option key={v} value={v}>{v}</option>)}
                        </select></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Detalle (TRONCAL)<br/>
                        <input className="mj-input" value={tarifaNueva.detalle} placeholder="14 POS."
                               onChange={e => setTarifaNueva(t => ({ ...t, detalle: e.target.value }))}
                               style={{ width: 86 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>$ Oficial<br/>
                        <input className="mj-input" type="number" step="0.01" value={tarifaNueva.tarifa_oficial}
                               onChange={e => setTarifaNueva(t => ({ ...t, tarifa_oficial: e.target.value }))}
                               style={inp} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>$ Contingencia<br/>
                        <input className="mj-input" type="number" step="0.01" value={tarifaNueva.tarifa_contingencia}
                               placeholder="= oficial"
                               onChange={e => setTarifaNueva(t => ({ ...t, tarifa_contingencia: e.target.value }))}
                               style={inp} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Cobrar of.<br/>
                        <input className="mj-input" type="number" step="0.01" value={tarifaNueva.cobrar_oficial}
                               onChange={e => setTarifaNueva(t => ({ ...t, cobrar_oficial: e.target.value }))}
                               style={inp} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Cobrar cont.<br/>
                        <input className="mj-input" type="number" step="0.01" value={tarifaNueva.cobrar_contingencia}
                               onChange={e => setTarifaNueva(t => ({ ...t, cobrar_contingencia: e.target.value }))}
                               style={inp} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Vigente desde<br/>
                        <input className="mj-input" type="date" value={tarifaNueva.vigente_desde}
                               onChange={e => setTarifaNueva(t => ({ ...t, vigente_desde: e.target.value }))} /></label>
                      <button className="mj-btn" onClick={crearTarifa}
                              disabled={tarifaGuardando === "__nueva__"}
                              style={{ background: NAVY, color: "#fff", borderColor: NAVY, padding: "7px 14px" }}>
                        {tarifaGuardando === "__nueva__" ? "Creando…" : "Crear tarifa"}
                      </button>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "0 2px 6px",
                                fontSize: 12, color: "#64748b" }}>
                    <span>Mostrando <strong>{fmt(visibles.length)}</strong> de {fmt(tarifas.length)} tarifas
                      {nEditadas ? <> · <span style={{ color: "#0d8043", fontWeight: 700 }}>✓ {nEditadas} editada{nEditadas === 1 ? "" : "s"}</span></> : null}</span>
                    {hayFiltros && (
                      <button className="mj-btn" style={{ padding: "2px 10px", fontSize: 11 }}
                              onClick={() => { setTarifaFiltros({}); setTarifaServicio("todos"); }}>
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ overflowX: "auto" }}>
                      <table className="mj-tabla">
                        <thead>
                          <tr>
                            <th>Servicio</th><th>CECOS admin</th><th>Segmentación</th>
                            <th>Tipo</th><th>Vehículo</th>
                            <th style={{ textAlign: "right" }}>$ Oficial</th>
                            <th style={{ textAlign: "right" }}>$ Contingencia</th>
                            <th>Paga</th>
                            <th style={{ textAlign: "right" }}>Cobrar</th>
                            <th>Vigencia</th><th>Estado</th><th></th>
                          </tr>
                          <tr>
                            <th><select style={fil} value={tarifaServicio} onChange={e => setTarifaServicio(e.target.value)}>
                              <option value="todos">todos</option>
                              {opciones(t => t.servicio).map(v => <option key={v} value={v}>{v}</option>)}
                            </select></th>
                            <th><select style={fil} value={F.cecos || ""} onChange={e => setF("cecos", e.target.value)}>
                              <option value="">todos</option>
                              <option value="__todos__">(aplica a todos)</option>
                              {opciones(t => t.cecos_admin).map(v => <option key={v} value={v}>{v}</option>)}
                            </select></th>
                            <th><input style={fil} placeholder="buscar…" value={F.segmentacion || ""}
                                   onChange={e => setF("segmentacion", e.target.value)} /></th>
                            <th><select style={fil} value={F.tipo || ""} onChange={e => setF("tipo", e.target.value)}>
                              <option value="">todos</option>
                              {opciones(t => t.tipo_pago).map(v => <option key={v} value={v}>{v}</option>)}
                            </select></th>
                            <th><select style={fil} value={F.vehiculo || ""} onChange={e => setF("vehiculo", e.target.value)}>
                              <option value="">todos</option>
                              {opciones(t => t.tipo_vehiculo).map(v => <option key={v} value={v}>{v}</option>)}
                            </select></th>
                            <th><input style={fil} placeholder="monto…" value={F.oficial || ""}
                                   onChange={e => setF("oficial", e.target.value)} /></th>
                            <th><input style={fil} placeholder="monto…" value={F.contingencia || ""}
                                   onChange={e => setF("contingencia", e.target.value)} /></th>
                            <th><select style={fil} value={F.paga || ""} onChange={e => setF("paga", e.target.value)}>
                              <option value="">todas</option>
                              <option value="CONTINGENCIA">CONTINGENCIA</option>
                              <option value="OFICIAL">OFICIAL</option>
                            </select></th>
                            <th><input style={fil} placeholder="monto…" value={F.cobrar || ""}
                                   onChange={e => setF("cobrar", e.target.value)} /></th>
                            <th><input style={fil} placeholder="ej. 2026-08" value={F.vigencia || ""}
                                   onChange={e => setF("vigencia", e.target.value)} /></th>
                            <th><select style={fil} value={F.estado || ""} onChange={e => setF("estado", e.target.value)}>
                              <option value="">todas</option>
                              <option value="ACTIVA">ACTIVA</option>
                              <option value="INACTIVA">INACTIVA</option>
                            </select></th>
                            <th><select style={fil} value={F.edicion || ""} onChange={e => setF("edicion", e.target.value)}
                                    title="Editadas = modificadas o creadas fila por fila desde el Brain">
                              <option value="">todas</option>
                              <option value="editadas">✓ editadas ({nEditadas})</option>
                              <option value="sin_editar">sin editar</option>
                            </select></th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibles.map(t => {
                            const ed = tarifaEdit[t.id];
                            return (
                              <tr key={t.id} style={{ ...(!t.activa ? { opacity: 0.5 } : {}),
                                                      ...(editada(t) ? { background: "#ecfdf3" } : {}) }}>
                                <td>{ed ? (
                                      <select className="mj-input" style={selE} value={ed.servicio}
                                              onChange={e => setEd(t.id, "servicio", e.target.value)}>
                                        {[...new Set([...serviciosOpc, ed.servicio].filter(Boolean))].map(v =>
                                          <option key={v} value={v}>{v}</option>)}
                                      </select>
                                    ) : t.servicio === "MELI ONE"
                                      ? <Etiqueta texto="MELI ONE" color="#5b21b6" fondo="#ede9fe" />
                                      : <span style={{ fontSize: 12, fontWeight: 600 }}>{t.servicio}</span>}</td>
                                <td style={{ fontSize: 12 }}>{ed ? (
                                      <select className="mj-input" style={selE} value={ed.cecos_admin}
                                              onChange={e => setEd(t.id, "cecos_admin", e.target.value)}>
                                        <option value="">— todos —</option>
                                        {[...new Set([...adminCat, ed.cecos_admin].filter(Boolean))].map(a =>
                                          <option key={a} value={a}>{a}</option>)}
                                      </select>
                                    ) : (t.cecos_admin || <span style={{ color: "#94a3b8" }}>todos</span>)}</td>
                                <td style={{ fontSize: 12 }}>{ed ? (
                                      <select className="mj-input" style={selE} value={ed.segmentacion}
                                              onChange={e => setEd(t.id, "segmentacion", e.target.value)}>
                                        <option value="">— sin —</option>
                                        {[...new Set([...segmentaciones.map(sg => sg.nombre), ed.segmentacion].filter(Boolean))].map(sg =>
                                          <option key={sg} value={sg}>{sg}</option>)}
                                      </select>
                                    ) : (t.segmentacion || "—")}</td>
                                <td style={{ fontSize: 11.5 }}>{ed ? (
                                      <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
                                        <select className="mj-input" style={selE} value={ed.tipo_pago}
                                                onChange={e => setEd(t.id, "tipo_pago", e.target.value)}>
                                          {TIPOS_PAGO.map(v => <option key={v} value={v}>{v}</option>)}
                                        </select>
                                        <input className="mj-input" style={{ ...selE, width: 110 }} value={ed.detalle}
                                               placeholder="detalle (ej. 14 POS.)"
                                               onChange={e => setEd(t.id, "detalle", e.target.value)} />
                                        {ed.tipo_pago === "PISO" && (
                                          <Fragment>
                                            <input className="mj-input" type="number" step="1" min="0"
                                                   style={{ ...selE, width: 110, borderColor: "#f59e0b" }}
                                                   value={ed.entregas_base} placeholder="entregas base *"
                                                   title="Entregas que cubre el piso (0 si es monto fijo)"
                                                   onChange={e => setEd(t.id, "entregas_base", e.target.value)} />
                                            <input className="mj-input" type="number" step="0.01" min="0"
                                                   style={{ ...selE, width: 110, borderColor: "#f59e0b" }}
                                                   value={ed.tarifa_adicional} placeholder="$ adicional *"
                                                   title="$ por cada entrega sobre el piso (0 si es monto fijo)"
                                                   onChange={e => setEd(t.id, "tarifa_adicional", e.target.value)} />
                                          </Fragment>
                                        )}
                                      </span>
                                    ) : (
                                      <Fragment>
                                        {t.tipo_pago}{t.detalle ? ` · ${t.detalle}` : ""}
                                        {t.tipo_pago === "PISO" &&
                                          <span style={{ color: "#94a3b8" }} title={`cubre ${t.entregas_base} entregas · adicional ${$m(t.tarifa_adicional)}`}> ⓘ</span>}
                                      </Fragment>
                                    )}</td>
                                <td style={{ fontSize: 11.5 }}>{ed ? (
                                      <select className="mj-input" style={selE} value={ed.tipo_vehiculo}
                                              onChange={e => setEd(t.id, "tipo_vehiculo", e.target.value)}>
                                        {[...new Set([...VEHICULOS_TARIFA, ed.tipo_vehiculo].filter(Boolean))].map(v =>
                                          <option key={v} value={v}>{v}</option>)}
                                      </select>
                                    ) : t.tipo_vehiculo === "ELECTRICA"
                                      ? <Etiqueta texto="ELECTRICA" color="#0d8043" fondo="#e7f6ec" /> : t.tipo_vehiculo}</td>
                                <td className="num">
                                  {ed ? <input className="mj-input" type="number" step="0.01"
                                          value={ed.tarifa_oficial}
                                          onChange={e => setEd(t.id, "tarifa_oficial", e.target.value)}
                                          style={inp} />
                                      : $m(t.tarifa_oficial)}</td>
                                <td className="num">
                                  {ed ? <input className="mj-input" type="number" step="0.01"
                                          value={ed.tarifa_contingencia ?? ""}
                                          onChange={e => setEd(t.id, "tarifa_contingencia", e.target.value)}
                                          style={inp} />
                                      : $m(t.tarifa_contingencia)}</td>
                                <td>
                                  {ed ? (
                                    <label style={{ fontSize: 10.5, color: "#64748b", whiteSpace: "nowrap" }}>
                                      <input type="checkbox" checked={!!ed.contingencia_activa}
                                        onChange={e => setTarifaEdit(x => ({ ...x, [t.id]: { ...ed, contingencia_activa: e.target.checked } }))} /> conting.
                                    </label>
                                  ) : (t.contingencia_activa
                                        ? <Etiqueta texto="CONTINGENCIA" color="#b45309" fondo="#fef3c7" />
                                        : <Etiqueta texto="OFICIAL" color="#1a3a6b" fondo="#e8edf5" />)}
                                </td>
                                <td className="num" style={{ fontSize: 11.5, color: "#64748b" }}
                                    title={`oficial ${$m(t.cobrar_oficial)} · contingencia ${$m(t.cobrar_contingencia)}`}>
                                  {ed ? (
                                    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
                                      <input className="mj-input" type="number" step="0.01" value={ed.cobrar_oficial}
                                             placeholder="cobrar oficial" title="Cobrar (oficial)"
                                             onChange={e => setEd(t.id, "cobrar_oficial", e.target.value)} style={inp} />
                                      <input className="mj-input" type="number" step="0.01" value={ed.cobrar_contingencia}
                                             placeholder="cobrar conting." title="Cobrar (contingencia)"
                                             onChange={e => setEd(t.id, "cobrar_contingencia", e.target.value)} style={inp} />
                                    </span>
                                  ) : $m(t.contingencia_activa ? t.cobrar_contingencia : t.cobrar_oficial)}
                                </td>
                                <td style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                                  {ed ? (
                                    <Fragment>
                                      <input className="mj-input" type="date" value={ed.vigente_desde || ""}
                                        onChange={e => setTarifaEdit(x => ({ ...x, [t.id]: { ...ed, vigente_desde: e.target.value } }))}
                                        style={{ fontSize: 10.5, width: 118 }} />
                                      <input className="mj-input" type="date" value={ed.vigente_hasta || ""}
                                        title="vigente hasta (vacío = sin tope)"
                                        onChange={e => setTarifaEdit(x => ({ ...x, [t.id]: { ...ed, vigente_hasta: e.target.value } }))}
                                        style={{ fontSize: 10.5, width: 118, marginLeft: 3 }} />
                                    </Fragment>
                                  ) : `${t.vigente_desde || "—"} → ${t.vigente_hasta || "∞"}`}
                                </td>
                                <td>{ed ? (
                                      <label style={{ fontSize: 10.5, color: "#64748b" }}>
                                        <input type="checkbox" checked={!!ed.activa}
                                          onChange={e => setTarifaEdit(x => ({ ...x, [t.id]: { ...ed, activa: e.target.checked } }))} /> activa
                                      </label>
                                    ) : (t.activa
                                          ? <Etiqueta texto="ACTIVA" color="#0d8043" fondo="#e7f6ec" />
                                          : <Etiqueta texto="INACTIVA" color="#8a94a6" fondo="#f1f5f9" />)}</td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  {ed ? (
                                    <Fragment>
                                      <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11,
                                          background: NAVY, color: "#fff", borderColor: NAVY }}
                                        disabled={tarifaGuardando === t.id}
                                        onClick={() => guardarEdicion(t, ed)}>
                                        {tarifaGuardando === t.id ? "…" : "Guardar"}
                                      </button>
                                      <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }}
                                        onClick={() => setTarifaEdit(x => { const n2 = { ...x }; delete n2[t.id]; return n2; })}>
                                        Cancelar
                                      </button>
                                    </Fragment>
                                  ) : (
                                    <Fragment>
                                    {editada(t) && (
                                      <span title={`Editada en el Brain el ${t.actualizado_at
                                              ? new Date(t.actualizado_at).toLocaleString("es-CL") : "—"}`}
                                            style={{ fontSize: 10.5, fontWeight: 800, color: "#0d8043",
                                                     background: "#d1fadf", borderRadius: 10, padding: "2px 7px",
                                                     marginRight: 5, whiteSpace: "nowrap" }}>✓ editada</span>
                                    )}
                                    <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                                      onClick={() => setTarifaEdit(x => ({ ...x, [t.id]: tarifaAEdicion(t) }))}>
                                      Editar
                                    </button>
                                    </Fragment>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {visibles.length === 0 && (
                            <tr><td colSpan={12} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>
                              {tarifas.length ? "Ninguna tarifa calza con estos filtros."
                                              : "Sin tarifas cargadas (requiere las migraciones 32 y 37)."}
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Fragment>
              );
            })()}

            {/* ── No Salidas a Ruta (migración 69) ── */}
            {tab === "nosalidas" && (() => {
              const hoyCl = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
              const F = nsFiltro;
              const vista = nsFilas.filter(x =>
                (!F.supervisor || String(x.supervisor_id) === F.supervisor) &&
                (!F.estado || (F.estado === "pendiente" ? !x.motivo : F.estado === "multa" ? x.genera_multa : !!x.motivo)) &&
                (!F.busca || `${x.patente} ${x.cecos_operacion || ""} ${x.empresa || ""}`.toUpperCase().includes(F.busca.trim().toUpperCase())));
              const nPend = nsFilas.filter(x => !x.motivo && !x.salio).length;
              const nReg = nsFilas.filter(x => x.motivo).length;
              const nMulta = nsFilas.filter(x => x.genera_multa).length;
              const motActivos = nsMotivos.filter(m => m.activo);
              return (
              <Fragment>
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "13px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>No salidas a ruta · flota propia · {fecha}</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3, maxWidth: 960 }}>
                    Vehículos BigTicket (operación MELI, activos en Vehículos BT) que <strong>no tuvieron ninguna ruta</strong> este
                    día. La flota opera tercerizada: el motivo define la consecuencia — <strong>FALTA TERCERO sostiene la multa</strong> a
                    la empresa; el resto queda como registro operativo. El supervisor lo registrará desde su bitácora para sus
                    patentes; aquí se ve a todos y el analista puede registrar o corregir.
                    {fecha === hoyCl && <span style={{ color: AMBAR_ }}> · <strong>Día en curso:</strong> la lista es provisoria, un vehículo puede salir más tarde.</span>}
                  </div>
                  {nsMsg && <div style={{ fontSize: 12, color: VERDE_, marginTop: 6 }}>✓ {nsMsg}</div>}
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  {[["Sin ruta", nsFilas.filter(x => !x.salio).length, NAVY, ""],
                    ["Pendientes de motivo", nPend, AMBAR_, "pendiente"],
                    ["Registradas", nReg, VERDE_, "registrada"],
                    ["Con multa", nMulta, ROJO_, "multa"]].map(([t, v, c, k]) => (
                    <div key={t} onClick={() => setNsFiltro(x => ({ ...x, estado: x.estado === k ? "" : k }))}
                         style={{ background: F.estado === k && k ? "#f8fafc" : "#fff", cursor: k ? "pointer" : "default",
                                  border: `1px solid ${F.estado === k && k ? c : "#e6e9ef"}`, borderRadius: 10, padding: "9px 14px", minWidth: 150 }}>
                      <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: .4 }}>{t}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{fmt(v)}</div>
                    </div>
                  ))}
                </div>

                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "11px 16px",
                              marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <select className="mj-input" value={F.supervisor} onChange={e => setNsFiltro(x => ({ ...x, supervisor: e.target.value }))}>
                    <option value="">Todos los supervisores</option>
                    {nsSupervisores.filter(sp => sp.activo).map(sp => <option key={sp.id} value={String(sp.id)}>{sp.nombre}</option>)}
                  </select>
                  <input className="mj-input" placeholder="Buscar patente, operación o empresa" value={F.busca}
                         onChange={e => setNsFiltro(x => ({ ...x, busca: e.target.value }))} style={{ minWidth: 240 }} />
                  <span style={{ fontSize: 12, color: "#64748b" }}>Mostrando {fmt(vista.length)} de {fmt(nsFilas.length)}</span>
                  <span style={{ flex: 1 }} />
                  <button className="mj-btn" onClick={() => setMotPanel(v => !v)}>{motPanel ? "Cerrar motivos" : `⚙ Motivos (${motActivos.length})`}</button>
                  <button className="mj-btn" onClick={cargarNoSalidas}>{nsCargando ? "Cargando…" : "↻ Actualizar"}</button>
                </div>

                {motPanel && (
                  <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Motivos de no salida</div>
                    <div style={{ fontSize: 12, color: "#64748b", margin: "3px 0 10px" }}>
                      Los motivos no se borran: se desactivan (los registros antiguos conservan el suyo).
                    </div>
                    <table className="mj-tabla" style={{ marginBottom: 10 }}>
                      <thead><tr><th>Motivo</th><th>Descripción</th><th>Genera multa</th><th>Pide comentario</th><th>Estado</th></tr></thead>
                      <tbody>
                        {nsMotivos.map(m => (
                          <tr key={m.codigo} style={!m.activo ? { opacity: 0.55 } : {}}>
                            <td style={{ fontWeight: 700 }}>{m.codigo}</td>
                            <td><input className="mj-input" defaultValue={m.descripcion || ""} style={{ fontSize: 12, minWidth: 280 }}
                                       onBlur={e => { const v = e.target.value.trim(); if (v !== (m.descripcion || "")) actualizarMotivo(m.codigo, { descripcion: v || null }); }} /></td>
                            <td><input type="checkbox" checked={!!m.genera_multa} onChange={e => actualizarMotivo(m.codigo, { genera_multa: e.target.checked })} /></td>
                            <td><input type="checkbox" checked={!!m.pide_comentario} title="El supervisor o el analista deben escribir qué pasó"
                                       onChange={e => actualizarMotivo(m.codigo, { pide_comentario: e.target.checked })} /></td>
                            <td><label style={{ fontSize: 11.5, color: "#64748b" }}>
                              <input type="checkbox" checked={!!m.activo} onChange={e => actualizarMotivo(m.codigo, { activo: e.target.checked })} /> {m.activo ? "activo" : "inactivo"}
                            </label></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Motivo nuevo<br/>
                        <input className="mj-input" value={motNuevo.codigo} placeholder="SIN CONDUCTOR"
                               onChange={e => setMotNuevo(x => ({ ...x, codigo: e.target.value.toUpperCase() }))} style={{ width: 170 }} /></label>
                      <label style={{ fontSize: 10.5, color: "#64748b" }}>Descripción<br/>
                        <input className="mj-input" value={motNuevo.descripcion}
                               onChange={e => setMotNuevo(x => ({ ...x, descripcion: e.target.value }))} style={{ width: 260 }} /></label>
                      <label style={{ fontSize: 11.5, color: "#64748b", paddingBottom: 6 }}>
                        <input type="checkbox" checked={motNuevo.genera_multa}
                               onChange={e => setMotNuevo(x => ({ ...x, genera_multa: e.target.checked }))} /> genera multa</label>
                      <label style={{ fontSize: 11.5, color: "#64748b", paddingBottom: 6 }}>
                        <input type="checkbox" checked={motNuevo.pide_comentario}
                               onChange={e => setMotNuevo(x => ({ ...x, pide_comentario: e.target.checked }))} /> pide comentario</label>
                      <button className="mj-btn" onClick={agregarMotivo} disabled={!motNuevo.codigo.trim()}
                              style={{ background: NAVY, color: "#fff", borderColor: NAVY }}>➕ Agregar motivo</button>
                    </div>
                  </div>
                )}

                <div className="mj-scroll">
                  <table className="mj-tabla">
                    <thead><tr>
                      <th>Patente</th><th>Operación</th><th>Supervisor</th><th>Empresa (Certronic)</th><th>Motivo</th><th></th>
                    </tr></thead>
                    <tbody>
                      {vista.map(x => {
                        const ed = nsEdit[x.patente];
                        const editando = !x.motivo || ed;
                        return (
                          <tr key={x.patente}>
                            <td style={{ fontWeight: 700 }}>{x.patente}
                              {x.salio && <div style={{ fontSize: 10.5, color: AMBAR_ }} title="Tiene registro de no salida, pero aparece en una ruta de este día: revisar">⚠ salió después</div>}
                            </td>
                            <td>{x.cecos_operacion ? <Etiqueta texto={x.cecos_operacion} /> : "—"}</td>
                            <td style={{ fontSize: 12 }}>{x.supervisor || <span style={{ color: AMBAR_ }}>⚠ sin supervisor</span>}</td>
                            <td style={{ fontSize: 12 }}>{x.empresa || <Etiqueta texto="SIN REGISTRO" color={AMBAR_} fondo="#fdf6e3" />}
                              {x.estado_certronic && x.estado_certronic !== "ACTIVA" && <span style={{ marginLeft: 5 }}><Etiqueta texto={x.estado_certronic} color="#b42318" fondo="#fdecea" /></span>}
                            </td>
                            <td>
                              {editando ? (
                                <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                  <select className="mj-input" style={{ fontSize: 12, padding: "3px 4px" }}
                                          value={(ed && ed.motivo) || ""}
                                          onChange={e => setNsEdit(m => ({ ...m, [x.patente]: { ...(m[x.patente] || {}), motivo: e.target.value } }))}>
                                    <option value="">— motivo —</option>
                                    {motActivos.map(m => <option key={m.codigo} value={m.codigo}>{m.codigo}{m.genera_multa ? " · con multa" : ""}</option>)}
                                  </select>
                                  <input className="mj-input" style={{ fontSize: 12, width: 180 }}
                                         placeholder={motActivos.find(m => m.codigo === (ed && ed.motivo))?.pide_comentario ? "comentario (obligatorio)" : "comentario (opcional)"}
                                         value={(ed && ed.comentario) || ""}
                                         onChange={e => setNsEdit(m => ({ ...m, [x.patente]: { ...(m[x.patente] || {}), comentario: e.target.value } }))} />
                                </span>
                              ) : (
                                <span title={`${x.comentario ? x.comentario + " · " : ""}registrado por ${x.registrado_por} (${x.rol})`}>
                                  <Etiqueta texto={x.motivo} color={x.genera_multa ? "#b42318" : NAVY} fondo={x.genera_multa ? "#fdecea" : "#eaf0f8"} />
                                  {x.genera_multa && <span style={{ marginLeft: 5, fontSize: 11, color: "#b42318", fontWeight: 700 }}>multa</span>}
                                  <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8" }}>{x.registrado_por}</span>
                                </span>
                              )}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {editando ? (
                                <Fragment>
                                  <button className="mj-btn" disabled={nsGuardando === x.patente || !(ed && ed.motivo)}
                                          style={{ padding: "3px 10px", fontSize: 11, background: NAVY, color: "#fff", borderColor: NAVY }}
                                          onClick={() => registrarNoSalida(x, ed && ed.motivo, ed && ed.comentario)}>
                                    {nsGuardando === x.patente ? "…" : "Registrar"}</button>
                                  {x.motivo && <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }}
                                          onClick={() => setNsEdit(m => { const n = { ...m }; delete n[x.patente]; return n; })}>Cancelar</button>}
                                </Fragment>
                              ) : (
                                <Fragment>
                                  <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                                          onClick={() => setNsEdit(m => ({ ...m, [x.patente]: { motivo: x.motivo, comentario: x.comentario || "" } }))}>Cambiar</button>
                                  <button className="mj-btn" style={{ padding: "3px 9px", fontSize: 11, marginLeft: 4, color: "#b42318", borderColor: "#f3c9c4" }}
                                          disabled={nsGuardando === x.patente} onClick={() => quitarNoSalida(x)}>Quitar</button>
                                </Fragment>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!vista.length && (
                        <tr><td colSpan={6} style={{ textAlign: "center", color: "#8a94a6", padding: 24 }}>
                          {nsCargando ? "Cargando…" : nsFilas.length ? "Ningún vehículo con estos filtros."
                            : "Toda la flota propia tuvo ruta este día (o falta la migración 69)."}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Fragment>
              );
            })()}
          </Fragment>
        )}
      </div>
    </div>
  );
}

// ── Columnas para los CSV (mismos nombres que el Excel de los supervisores) ─
const COLS_JORNADA = [
  { titulo: "FECHA", campo: "fecha" },
  { titulo: "ID_VIAJE", campo: "id_viaje" },
  { titulo: "CECOS", valor: r => r.cecos_real || "" },
  { titulo: "BODEGA", campo: "centro_meli" },
  { titulo: "SUPERVISOR", valor: r => r.supervisor || "" },
  { titulo: "TIPO_RUTA", valor: r => r.tipo_ruta ? etiquetaTipo(r.tipo_ruta).t : (r.estado_tipo === "por_confirmar" ? "NO PLANIFICADA (por confirmar)" : "") },
  { titulo: "TIPO_RUTA_ESTADO", valor: r => r.estado_tipo || "" },
  { titulo: "CON_AMBULANCIA", valor: r => r.con_ambulancia ? "SI" : "" },
  { titulo: "SERVICIO_MELI", valor: r => r.servicio_txt || "" },
  { titulo: "SEGMENTACION", valor: r => r.segmentacion || "" },
  { titulo: "EMPRESA", valor: r => r.empresa || (r.patente ? "SIN REGISTRO" : "") },
  { titulo: "RUT_EMPRESA", valor: r => r.empresa_rut || "" },
  { titulo: "ESTADO_CERTRONIC", valor: r => r.empresa_estado || "" },
  { titulo: "TERCERO_MELI", campo: "tercero" },
  { titulo: "PATENTE", campo: "patente" },
  { titulo: "CONDUCTOR", campo: "conductor" },
  { titulo: "CON_AYUDANTE", valor: r => (r.con_ayudante ? "SI" : "NO") },
  { titulo: "PARADAS", campo: "paradas" },
  { titulo: "CARGADOS", campo: "cargados" },
  { titulo: "ENTREGADOS", campo: "entregados" },
  { titulo: "DEVUELTOS", campo: "devueltos" },
  { titulo: "D_JUSTIFICADOS", campo: "d_justificados" },
  { titulo: "PENDIENTES", campo: "pendientes" },
  { titulo: "PCT_ENTREGA", campo: "pct_entrega" },
  { titulo: "1_PARADA", campo: "hora_primera_parada" },
  { titulo: "COMUNA_1_PARADA", campo: "comuna_primera_parada" },
  { titulo: "ULTIMA_PARADA", campo: "hora_ultima_parada" },
  { titulo: "COMUNA_ULTIMA_PARADA", campo: "comuna_ultima_parada" },
  { titulo: "HORAS_EN_RUTA", campo: "horas_en_ruta" },
  { titulo: "NRO_1_PARADA", campo: "primera_parada" },
  { titulo: "NRO_ULTIMA_PARADA", campo: "ultima_parada" },
  { titulo: "PEONETA_1", valor: () => "" },
  { titulo: "PEONETA_2", valor: () => "" },
  { titulo: "COMUNAS", campo: "comunas" },
  { titulo: "CICLO", campo: "ciclo" },
  { titulo: "ESTADO", campo: "status" },
  { titulo: "LINE_HAUL", valor: r => (r.is_line_haul ? "SI" : "NO") },
];
const COLS_DEVOL = [
  { titulo: "FECHA", campo: "fecha" },
  { titulo: "ID_VIAJE", campo: "id_viaje" },
  { titulo: "CECOS", campo: "cecos" },
  { titulo: "FOLIO_GUIAS", campo: "folio_guia" },
  { titulo: "PATENTE", campo: "patente" },
  { titulo: "CONDUCTOR", campo: "conductor" },
  { titulo: "MOTIVO", campo: "motivo" },
  { titulo: "MOTIVO_CODIGO", campo: "motivo_codigo" },
  { titulo: "RECEPTOR", campo: "receptor" },
  { titulo: "COMUNA", campo: "comuna" },
  { titulo: "REGION", campo: "region" },
  { titulo: "PARADA", campo: "parada" },
  { titulo: "HORA_CHILE", campo: "hora_chile" },
];
const COLS_TRASP = [
  { titulo: "FECHA", campo: "fecha_operativa" },
  { titulo: "RUTA_ORIGEN", campo: "ruta_origen" },
  { titulo: "CECOS_ORIGEN", campo: "sc_origen" },
  { titulo: "CONDUCTOR_ORIGEN", campo: "chofer_origen" },
  { titulo: "PATENTE_ORIGEN", campo: "patente_origen" },
  { titulo: "RUTA_DESTINO", campo: "ruta_destino" },
  { titulo: "CECOS_DESTINO", campo: "sc_destino" },
  { titulo: "CONDUCTOR_DESTINO", campo: "chofer_destino" },
  { titulo: "PATENTE_DESTINO", campo: "patente_destino" },
  { titulo: "PAQUETES", campo: "paquetes" },
  { titulo: "ENTREGADOS_LUEGO", campo: "entregados_luego" },
  { titulo: "SIN_ENTREGAR", campo: "sin_entregar" },
  { titulo: "ENTRE_SERVICE_CENTERS", valor: r => (r.entre_service_centers ? "SI" : "NO") },
];

export default ModuloMaestroCL;
