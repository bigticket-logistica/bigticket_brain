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

async function api(path) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, {
    headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}` },
  });
  if (!r.ok) throw new Error(`La consulta falló (HTTP ${r.status}). ${(await r.text()).slice(0, 200)}`);
  return r.json();
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
  const [cecos, setCecos] = useState("");
  const [busca, setBusca] = useState("");
  const [kpiAbierto, setKpiAbierto] = useState(null);

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
        const r = await api("vw_maestro_resumen_dia?select=fecha&order=fecha.desc&limit=60");
        const fs = r.map(x => x.fecha);
        setDias(fs);
        if (fs.length) setFecha(fs[0]);
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
        const [res, jor, dev, tra] = await Promise.all([
          api(`vw_maestro_resumen_dia?fecha=eq.${fecha}`),
          api(`vw_maestro_jornada?fecha=eq.${fecha}&order=cargados.desc.nullslast&limit=3000`),
          api(`vw_maestro_devoluciones?fecha=eq.${fecha}&order=cecos.asc&limit=8000`),
          api(`vw_traspasos_resumen?fecha_operativa=eq.${fecha}&order=paquetes.desc&limit=3000`),
        ]);
        if (!vivo) return;
        setResumen(res[0] || null); setJornada(jor); setDevol(dev); setTrasp(tra);
      } catch (e) { if (vivo) setError(e.message); }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [fecha]);

  // Filtros en cliente
  const texto = busca.trim().toLowerCase();
  const coincide = (...campos) => !texto || campos.some(c => String(c ?? "").toLowerCase().includes(texto));
  const jornadaVista = jornada
    // Tolerante a NULL a propósito: una ruta sin clasificar se trata como última
    // milla en vez de desaparecer de la vista sin explicación.
    .filter(r => (!soloReparto || r.is_line_haul !== true))
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
  const nSinClasificar = jornada.filter(r => r.is_line_haul === null || r.is_line_haul === undefined).length;

  // Totales de lo que se está viendo (respetan los filtros)
  const tot = jornadaVista.reduce((a, r) => ({
    cargados: a.cargados + n(r.cargados), entregados: a.entregados + n(r.entregados),
    devueltos: a.devueltos + n(r.devueltos), dj: a.dj + n(r.d_justificados),
    paradas: a.paradas + n(r.paradas), pendientes: a.pendientes + n(r.pendientes),
  }), { cargados: 0, entregados: 0, devueltos: 0, dj: 0, paradas: 0, pendientes: 0 });
  const pct = tot.cargados ? (100 * tot.entregados / tot.cargados).toFixed(1) : null;
  // Dos cosas distintas, antes mezcladas en un solo contador:
  const nSinDetalle   = jornadaVista.filter(r => r.sin_detalle === true).length;
  const nDescuadrados = jornadaVista.filter(r => r.detalle_descuadrado === true).length;

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
      detalle: soloReparto
        ? `última milla${nSinClasificar ? ` · ${fmt(nSinClasificar)} sin clasificar` : ""}`
        : `incluye ${fmt(nLineHaul)} line haul`,
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
      valor: fmt(tot.devueltos), detalle: "no se entregaron",
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
      valor: fmt(tot.dj), detalle: "pasaron a otra ruta",
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
      id: "pendientes", rotulo: "Pendientes", color: "#8a94a6",
      valor: fmt(tot.pendientes), detalle: "sin resolver al cierre",
      que: "Paquetes que al final del día no quedaron ni entregados ni devueltos: nunca se resolvieron. Lo normal es que sean muy pocos.",
      como: "Cargados menos entregados menos devueltos, ruta por ruta. Los traspasados no se restan, porque ya vienen contados en los entregados de la ruta que los recibió.",
      desglose: () => ({
        titulo: "Viajes con paquetes sin resolver",
        columnas: [{ t: "ID Viaje" }, { t: "CECOS" }, { t: "Cargados", num: true },
                   { t: "Entregados", num: true }, { t: "Devueltos", num: true }, { t: "Pendientes", num: true }],
        filas: jornadaVista.filter(r => n(r.pendientes) > 0)
          .sort((a, b) => n(b.pendientes) - n(a.pendientes)).slice(0, 20)
          .map(r => [r.id_viaje, r.cecos, fmt(r.cargados), fmt(r.entregados), fmt(r.devueltos), fmt(r.pendientes)]),
        vacio: "Ningún viaje quedó con paquetes sin resolver. El día cerró completo.",
      }),
    },
    ...(nSinDetalle > 0 ? [{
      id: "sin_detalle", rotulo: "Falta detalle", color: "#7a5b16", alerta: true,
      valor: fmt(nSinDetalle), detalle: "aún sin procesar",
      que: "Viajes a los que todavía no se les ha bajado el detalle de paquetes. Mientras eso pase, sus paradas, comunas y devoluciones aparecen en cero.",
      como: "El detalle de cada ruta se baja en la pasada de cierre, a las 00:30 de la noche siguiente. Es normal ver este número durante el día en curso; debería quedar en cero al día siguiente.",
      desglose: () => ({
        titulo: "Viajes sin detalle",
        columnas: [{ t: "ID Viaje" }, { t: "CECOS" }, { t: "Cargados", num: true }, { t: "Estado" }],
        filas: jornadaVista.filter(r => r.sin_detalle).slice(0, 20)
          .map(r => [r.id_viaje, r.cecos, fmt(r.cargados), r.status || "—"]),
        vacio: "Todos los viajes tienen su detalle.",
      }),
    }] : []),
    ...(nDescuadrados > 0 ? [{
      id: "descuadrados", rotulo: "Descuadrados", color: "#b42318", alerta: true,
      valor: fmt(nDescuadrados), detalle: "conteos que no calzan",
      que: "Viajes donde el número de entregas que informa MELI no coincide con los paquetes que efectivamente se bajaron en el detalle. Vale revisarlos.",
      como: "Se comparan las dos fuentes: el contador de la ruta en MELI y la cantidad de paquetes entregados en el detalle. La causa más común es que se capturaron en momentos distintos: el contador quedó en una foto temprana y el detalle se bajó después, ya con más entregas hechas.",
      desglose: () => ({
        titulo: "Viajes con conteos distintos",
        columnas: [{ t: "ID Viaje" }, { t: "CECOS" }, { t: "MELI dice", num: true },
                   { t: "Detalle tiene", num: true }, { t: "Diferencia", num: true }],
        filas: jornadaVista.filter(r => r.detalle_descuadrado)
          .sort((a, b) => Math.abs(n(b.entregados_detalle) - n(b.entregados_meli)) - Math.abs(n(a.entregados_detalle) - n(a.entregados_meli)))
          .slice(0, 20)
          .map(r => [r.id_viaje, r.cecos, fmt(r.entregados_meli), fmt(r.entregados_detalle),
                     (n(r.entregados_detalle) - n(r.entregados_meli) > 0 ? "+" : "") + fmt(n(r.entregados_detalle) - n(r.entregados_meli))]),
        vacio: "Todos los conteos calzan.",
      }),
    }] : []),
  ];

  const TABS = [
    { id: "jornada",    label: "Maestro Jornada", desc: "Una fila por viaje",        n: jornadaVista.length },
    { id: "devol",      label: "Devoluciones",    desc: "Detalle por folio",          n: devolVista.length },
    { id: "traspasos",  label: "Traspasos",       desc: "Origen → destino",           n: traspVista.length },
    { id: "nosalidas",  label: "No Salidas a Ruta", desc: "Carga manual",             n: null },
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
            {/* Indicadores · cada tarjeta se abre y explica de dónde sale su número */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
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
                      <th>ID Viaje</th><th>CECOS</th><th>Tercero</th><th>Patente</th><th>Conductor</th>
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
                          {r.id_viaje}{r.is_line_haul && <span style={{ marginLeft: 5 }}><Etiqueta texto="LH" color="#7a5b16" fondo="#fdf3d8" /></span>}
                        </td>
                        <td><Etiqueta texto={r.cecos || "—"} /></td>
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
