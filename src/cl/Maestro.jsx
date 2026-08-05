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

function Etiqueta({ texto, color, fondo }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 7px", borderRadius: 10, fontSize: 10.5,
      fontWeight: 700, color: color || NAVY, background: fondo || "#eef2f9", whiteSpace: "nowrap",
    }}>{texto}</span>
  );
}

// ── Módulo ─────────────────────────────────────────────────────────────────
function ModuloMaestroCL() {
  const [dias, setDias] = useState([]);
  const [fecha, setFecha] = useState("");
  const [tab, setTab] = useState("jornada");
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
  // ── zona nueva + override de viaje ──
  const ZONA_NUEVA0 = { nombre: "", cecos: "", segmentacion: "", lat: "", lon: "", radio: 5000, nota: "" };
  const [zonaNueva, setZonaNueva] = useState(null);        // null = formulario cerrado
  const [ovr, setOvr] = useState(null);                    // { id_viaje, segmentacion, motivo }
  const [ovrGuardando, setOvrGuardando] = useState(false);
  const [pagoFiltro, setPagoFiltro] = useState("todos");   // todos | pendientes | calculados

  const [resumen, setResumen] = useState(null);
  const [jornada, setJornada] = useState([]);
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
          // Preferir HOY (en horario de Chile) si ya tiene datos; si no, el día más
          // reciente. Antes abría siempre en el más reciente y confundía: estando a
          // 31 mostraba el 30 sin decir por qué.
          const hoyCL = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago",
            year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
          setFecha(fs.includes(hoyCL) ? hoyCL : fs[0]);
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
        const [res, jor, dev, tra, rec, cua, rr] = await Promise.all([
          apiSuave(`vw_maestro_resumen_dia?fecha=eq.${fecha}`, [], fallos),
          apiSuave(`vw_maestro_jornada?fecha=eq.${fecha}&order=cargados.desc.nullslast&limit=3000`, [], fallos),
          apiSuave(`vw_maestro_devoluciones?fecha=eq.${fecha}&order=cecos.asc&limit=8000`, [], fallos),
          apiSuave(`vw_traspasos_resumen?fecha_operativa=eq.${fecha}&order=paquetes.desc&limit=3000`, [], fallos),
          apiSuave(`vw_estado_recuadre?fecha_operativa=eq.${fecha}`, [], fallos),
          apiSuave(`vw_rutas_a_cuadrar?fecha=eq.${fecha}&select=id_ruta,cecos,conductor,status,cargados,entregados,pendientes,motivos&limit=500`, [], fallos),
          apiSuave(`vw_estado_recuadre_ruta?fecha_operativa=eq.${fecha}&limit=500`, [], fallos),
        ]);
        if (fallos.length) setError("Algunas consultas no respondieron: " + fallos.join(" | "));
        if (!vivo) return;
        setResumen(res[0] || null); setJornada(jor); setDevol(dev); setTrasp(tra);
        setRecuadre(rec[0] || null); setACuadrar(cua);
        setRecRuta(Object.fromEntries((rr || []).map(x => [String(x.id_ruta), x])));
        setLeidoAt(new Date());
      } catch (e) { if (vivo) setError(e.message); }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [fecha]);

  // Recarga los datos del día seleccionado (sin recargar la página).
  const recargar = async () => {
    if (!fecha) return;
    setRecargando(true);
    try {
      const fallos = [];
      const [res, jor, rec, cua, rr] = await Promise.all([
        apiSuave(`vw_maestro_resumen_dia?fecha=eq.${fecha}`, [], fallos),
        apiSuave(`vw_maestro_jornada?fecha=eq.${fecha}&order=cargados.desc.nullslast&limit=3000`, [], fallos),
        apiSuave(`vw_estado_recuadre?fecha_operativa=eq.${fecha}`, [], fallos),
        apiSuave(`vw_rutas_a_cuadrar?fecha=eq.${fecha}&select=id_ruta,cecos,conductor,status,cargados,entregados,pendientes,motivos&limit=500`, [], fallos),
        apiSuave(`vw_estado_recuadre_ruta?fecha_operativa=eq.${fecha}&limit=500`, [], fallos),
      ]);
      setError(fallos.length ? "Algunas consultas no respondieron: " + fallos.join(" | ") : "");
      setResumen(res[0] || null); setJornada(jor);
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

  // ── Vehículos BT: la tabla auxiliar de certificación ──
  const cargarVehiculos = async () => {
    setVehiculos(await apiSuave("tipo_vehiculo_bt?order=proyecto,patente&limit=500", []));
  };
  useEffect(() => { if (tab === "vehiculos") cargarVehiculos(); }, [tab]);

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
  const jornadaVista = jornada
    // Tolerante a NULL a propósito: una ruta sin clasificar se trata como última
    // milla en vez de desaparecer de la vista sin explicación.
    .filter(r => (!soloReparto || r.is_line_haul !== true))
    .filter(r => (tipoServicio === "todos" || r.tipo_servicio === tipoServicio))
    .filter(r => !cecos || r.cecos === cecos)
    .filter(r => coincide(r.id_viaje, r.patente, r.conductor, r.cecos, r.comuna_primera_parada, r.comuna_ultima_parada, r.ciclo));
  const devolVista = devol
    .filter(r => !cecos || r.cecos === cecos)
    .filter(r => coincide(r.id_viaje, r.folio_guia, r.patente, r.conductor, r.motivo, r.comuna, r.receptor));
  const traspVista = trasp
    .filter(r => !cecos || r.sc_origen === cecos || r.sc_destino === cecos)
    .filter(r => coincide(r.ruta_origen, r.ruta_destino, r.chofer_origen, r.chofer_destino, r.patente_origen, r.patente_destino));

  const listaCecos = [...new Set(jornada.map(r => r.cecos).filter(Boolean))].sort();
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

  const TABS = [
    { id: "jornada",    label: "Maestro Jornada", desc: "Una fila por viaje",        n: jornadaVista.length },
    { id: "devol",      label: "Devoluciones",    desc: "Detalle por folio",          n: devolVista.length },
    { id: "traspasos",  label: "Traspasos",       desc: "Origen → destino",           n: traspVista.length },
    { id: "nosalidas",  label: "No Salidas a Ruta", desc: "Carga manual",             n: null },
    { id: "cecos",      label: "CECOS",           desc: "Catálogo y clasificación",   n: cecosCat.length || null },
    { id: "zonas",      label: "Zonas de Pago",   desc: "Geografía y segmentación",   n: zonas.length || null },
    { id: "pago",       label: "Maestro Pago",    desc: "Modelo de tarificación",     n: pago.length || null },
    { id: "vehiculos",  label: "Vehículos BT",    desc: "Clasificación por patente",  n: vehiculos.length || null },
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
              Jornada consolidada desde MELI · reemplaza la carga manual del Excel
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}>
            <span style={{ fontSize: 11.5, color: "#8a94a6", fontWeight: 700 }}>DÍA OPERATIVO</span>
            <input className="mj-input" type="date" value={fecha}
                   min={dias.length ? dias[dias.length - 1] : undefined}
                   max={dias.length ? dias[0] : undefined}
                   onChange={e => e.target.value && setFecha(e.target.value)} />
            {dias.length > 0 && !dias.includes(fecha) && (
              <span style={{ fontSize: 11, color: "#a16207" }}>sin datos ese día</span>
            )}
            {resumen?.ultima_captura && (
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                última captura {resumen.ultima_captura_chile || horaChile(resumen.ultima_captura)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginTop: 8, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} className={`mj-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
              <div>{t.label}{t.n !== null && <span style={{ color: "#94a3b8", fontWeight: 600 }}> ({fmt(t.n)})</span>}</div>
              <div style={{ fontSize: 10, color: "#a8b2c1", fontWeight: 400, marginTop: 1 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mj-wrap" style={{ padding: "16px 24px 28px" }}>
        {error && (
          <div style={{ background: "#fff4f4", border: "1px solid #f2c9c9", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: "#b42318", fontSize: 13 }}>No se pudieron cargar los datos</div>
            <div style={{ fontSize: 12, color: "#7a2a22", marginTop: 3 }}>{error}</div>
          </div>
        )}

        {cargando && <div style={{ color: "#8a94a6", fontSize: 13, padding: "24px 0" }}>Cargando la jornada…</div>}

        {!cargando && !fecha && !error && (
          <div style={{ background: "#fff", border: "1px dashed #dfe4ec", borderRadius: 10, padding: 24, maxWidth: 620 }}>
            <div style={{ fontWeight: 700, color: NAVY, fontSize: 14 }}>Todavía no hay jornadas cargadas</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 6, lineHeight: 1.8 }}>
              Los datos aparecen aquí en cuanto corre el cierre de las 00:30, que consolida el día anterior.
            </div>
          </div>
        )}

        {!cargando && fecha && (
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

            {/* ── Maestro Jornada ── */}
            {tab === "jornada" && (
              <div className="mj-scroll">
                <table className="mj-tabla">
                  <thead>
                    <tr>
                      <th>ID Viaje</th><th>CECOS</th><th>Tipo de Ruta</th><th>Tercero</th><th>Patente</th><th>Conductor</th>
                      <th>Ayud.</th><th className="num">Paradas</th><th className="num">Cargados</th>
                      <th className="num">Entregados</th><th className="num">Devueltos</th><th className="num">Traspasos</th>
                      <th className="num">%</th>
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
                        <td><Etiqueta texto={r.cecos || "—"} /></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {/* Tipo de servicio que informa MELI, más las banderas que lo acompañan.
                              El tipo y el Line Haul son dimensiones independientes: hay rutas
                              last_mile que además son Line Haul. */}
                          {r.tipo === "melione"
                            ? <Etiqueta texto="MELI ONE" color="#5b21b6" fondo="#ede9fe" />
                            : r.tipo === "last_mile"
                              ? <span style={{ fontSize: 11.5, color: "#475569" }}>Última milla</span>
                              : <span style={{ color: "#cbd5e1" }}>—</span>}
                          {r.is_line_haul && <span style={{ marginLeft: 5 }} title="Line Haul: transferencia entre centros, no reparto a clientes"><Etiqueta texto="LH" color="#7a5b16" fondo="#fdf3d8" /></span>}
                          {r.entrega_y_retira && <span style={{ marginLeft: 5 }} title="Entrega y además pasa a retirar"><Etiqueta texto="E+R" color="#0e7490" fondo="#e0f2fe" /></span>}
                        </td>
                        <td style={{ color: "#475569" }}>{r.tercero || "—"}</td>
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
                      <tr><td colSpan={19} style={{ padding: 20, color: "#8a94a6", textAlign: "center" }}>
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
                    tarifario, ej. ML_RM_1) y marca si es <strong>operación Bigticket</strong> — solo esos entran al motor
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
                      placeholder={"Un código por línea. Opcional el nombre admin separado por coma:\nSRM1, ML_RM_1\nSBB2, ML_CAÑETE\nSPO1"}
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
                      <button className="mj-btn" onClick={() => setZonaNueva(zonaNueva ? null : { ...ZONA_NUEVA0 })}
                              style={{ background: NAVY, color: "#fff", borderColor: NAVY }}>
                        {zonaNueva ? "Cerrar" : "➕ Nueva zona"}
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
                          <th style={{ textAlign: "right" }}>Paq. 7d</th>
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
                                <td className="num">{fmt(z.paquetes_7d)}</td>
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
                        "PAGO": r.pago, "ESTADO PAGO": r.estado_pago })),
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
                              title="Sin resolver (falta zona: se corrige acá mismo con ✎) o sin tarifa (falta la fila en el tarifario)">
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
                                  <td>{r.servicio === "MELI ONE"
                                        ? <Etiqueta texto="MELI ONE" color="#5b21b6" fondo="#ede9fe" />
                                        : <span style={{ fontSize: 12 }}>{r.servicio}</span>}</td>
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
                                    {r.pago ? "$" + fmt(Math.round(r.pago)) : "—"}</td>
                                  <td>
                                    {r.estado_pago === "calculado"
                                      ? <Etiqueta texto="CALCULADO" color="#0d8043" fondo="#e7f6ec" />
                                      : r.estado_pago === "sin tarifa"
                                        ? <span title={`No existe la llave ${r.cecos || "?"} · ${r.servicio} · ${r.segmentacion_zonal || "?"} · ${r.tipo_vehiculo_bt} en el tarifario: hay que agregarla (autorizan Nicole o Esteban)`}>
                                            <Etiqueta texto="SIN TARIFA" color="#b45309" fondo="#fef3c7" /></span>
                                        : <span title="Falta la zona: corrígelo con el botón ✎ de esta fila, o crea la zona en la pestaña Zonas de Pago">
                                            <Etiqueta texto="SIN RESOLVER" color="#b42318" fondo="#fdecea" /></span>}
                                    {r.zona_manual && <span style={{ marginLeft: 4 }} title={r.motivo_manual || "Corrección manual"}>
                                        <Etiqueta texto="MANUAL" color="#5b21b6" fondo="#ede9fe" /></span>}
                                  </td>
                                  <td>
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
            {tab === "vehiculos" && (
              <Fragment>
                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                              padding: "13px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>Clasificación BT por patente</div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 3, maxWidth: 900 }}>
                    Define el tipo de vehículo para la llave de tarifa. <strong>Regla oficial: toda patente
                    que no esté acá paga como COMBUSTION</strong> — una eléctrica nueva sin registrar se paga
                    mal en silencio, así que las altas de flota deben pasar por esta tabla. La mantiene certificación.
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

                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, overflow: "hidden" }}>
                  <table className="mj-tabla">
                    <thead>
                      <tr><th>Patente</th><th>Tipo (proyecto)</th><th>Activa</th><th>Nota</th><th></th></tr>
                    </thead>
                    <tbody>
                      {vehiculos.map(v => {
                        const ed = vehEdit[v.patente];
                        return (
                          <tr key={v.patente}>
                            <td style={{ fontWeight: 700 }}>{v.patente}</td>
                            <td>
                              {ed ? (
                                <select className="mj-input" value={ed.proyecto}
                                  onChange={e => setVehEdit(x => ({ ...x, [v.patente]: { ...ed, proyecto: e.target.value } }))}
                                  style={{ fontSize: 12 }}>
                                  {TIPOS_VEH.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
                                </select>
                              ) : (v.proyecto === "ELECTRICA"
                                    ? <Etiqueta texto="ELECTRICA" color="#0d8043" fondo="#e7f6ec" />
                                    : <span style={{ fontSize: 12 }}>{v.proyecto}</span>)}
                            </td>
                            <td>{v.activo
                                  ? <Etiqueta texto="ACTIVA" color="#0d8043" fondo="#e7f6ec" />
                                  : <Etiqueta texto="INACTIVA" color="#8a94a6" fondo="#f1f5f9" />}</td>
                            <td style={{ fontSize: 11, color: "#94a3b8", maxWidth: 320 }}>{v.nota || ""}</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {ed ? (
                                <Fragment>
                                  <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11,
                                      background: NAVY, color: "#fff", borderColor: NAVY }}
                                    disabled={vehGuardando === v.patente}
                                    onClick={() => guardarVehiculo(v.patente, {
                                      proyecto: ed.proyecto, activo: ed.activo }, false)}>
                                    {vehGuardando === v.patente ? "…" : "Guardar"}
                                  </button>
                                  <button className="mj-btn" style={{ padding: "3px 8px", fontSize: 11, marginLeft: 4 }}
                                    onClick={() => setVehEdit(x => { const n = { ...x }; delete n[v.patente]; return n; })}>
                                    Cancelar
                                  </button>
                                  <label style={{ fontSize: 10.5, marginLeft: 8, color: "#64748b" }}>
                                    <input type="checkbox" checked={!!ed.activo}
                                      onChange={e => setVehEdit(x => ({ ...x, [v.patente]: { ...ed, activo: e.target.checked } }))} /> activa
                                  </label>
                                </Fragment>
                              ) : (
                                <button className="mj-btn" style={{ padding: "3px 10px", fontSize: 11 }}
                                  onClick={() => setVehEdit(x => ({ ...x, [v.patente]: { proyecto: v.proyecto, activo: v.activo } }))}>
                                  Editar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {vehiculos.length === 0 && (
                        <tr><td colSpan={5} style={{ textAlign: "center", color: "#94a3b8", padding: 18 }}>
                          Cargando… (requiere la migración 31)
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Fragment>
            )}

            {/* ── No Salidas a Ruta ── */}
            {tab === "nosalidas" && (
              <div style={{ background: "#fff", border: "1px dashed #dfe4ec", borderRadius: 10, padding: 22, maxWidth: 700 }}>
                <div style={{ fontWeight: 800, color: NAVY, fontSize: 14 }}>No Salidas a Ruta</div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 8, lineHeight: 1.9 }}>
                  MELI no informa las no salidas: un conductor o una patente que no salió simplemente no aparece
                  en el monitoreo. Este dato lo tienen los supervisores, así que sigue siendo carga manual —
                  con conductor o patente, el motivo y la fecha.
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 12, fontStyle: "italic" }}>
                  Pendiente: crear el mantenedor para registrarlas desde aquí.
                </div>
              </div>
            )}
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
  { titulo: "CECOS", campo: "cecos" },
  { titulo: "SERVICIO", campo: "tipo_servicio" },
  { titulo: "TERCERO", campo: "tercero" },
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
