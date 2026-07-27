// ═══════════════════════════════════════════════════════════════════════════
// ANÁLISIS DE OPERACIONES · CHILE
// Dos mundos en un módulo:
//   • EN CURSO   → la jornada de hoy, con datos del monitor de 5 minutos
//   • CERRADO    → KPI, rankings, devoluciones y tiempos del día ya terminado
//
// Cada indicador trae su definición: se abre haciendo click en la tarjeta o en
// el botón "¿Qué significa cada dato?" de cada pestaña. La idea es que nadie
// tenga que preguntar de dónde sale un número.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, Fragment, useCallback } from "react";

const CL_URL = "https://hmowsazntdjtsvdfgutn.supabase.co";
const CL_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtb3dzYXpudGRqdHN2ZGZndXRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MTc4NzgsImV4cCI6MjEwMDQ5Mzg3OH0.xAJokU0eFhof--d8R4uCRBr2-CJLzC5re0w1IPRqQR8";

const NAVY = "#1a3a6b", ORANGE = "#F47B20";
const VERDE = "#0d8043", ROJO = "#b42318", AMBAR = "#a16207", GRIS = "#64748b";

// PostgREST manda numeric y bigint como texto: siempre convertir antes de operar.
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const fmt = (v) => n(v).toLocaleString("es-CL");
const pct1 = (v) => (v === null || v === undefined ? "—" : `${n(v).toFixed(1)}%`);
const dec = (v, d = 1) => (v === null || v === undefined ? "—" : n(v).toFixed(d));

async function api(path, opciones) {
  const r = await fetch(`${CL_URL}/rest/v1/${path}`, Object.assign({
    headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`, "Content-Type": "application/json" },
  }, opciones || {}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  if (opciones && opciones.method === "PATCH") return true;
  return r.json();
}

function descargarCSV(nombre, filas, columnas) {
  if (!filas.length) return;
  const esc = (v) => { const s = v === null || v === undefined ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cuerpo = [columnas.map(c => esc(c.t)).join(";"),
    ...filas.map(f => columnas.map(c => esc(c.v ? c.v(f) : f[c.k])).join(";"))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + cuerpo], { type: "text/csv;charset=utf-8;" }));
  a.download = `${nombre}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

// ── Piezas de interfaz ─────────────────────────────────────────────────────
function Tarjeta({ rotulo, valor, detalle, color, abierto, onClick, alerta }) {
  return (
    <button className="an-kpi" onClick={onClick} aria-expanded={!!abierto}
      style={{ background: abierto ? "#f7faff" : "#fff",
        border: `1px solid ${abierto ? (color || NAVY) : (alerta ? "#f2c9c9" : "#e6e9ef")}`,
        borderLeft: `4px solid ${color || NAVY}`, borderRadius: 10, padding: "12px 15px",
        minWidth: 138, flex: "1 1 138px", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10.5, color: "#8a94a6", fontWeight: 700, letterSpacing: .4, textTransform: "uppercase" }}>{rotulo}</span>
        <span style={{ fontSize: 9, color: abierto ? (color || NAVY) : "#c3cbd8" }}>{abierto ? "▲" : "▼"}</span>
      </div>
      <div style={{ fontSize: 23, fontWeight: 800, color: color || NAVY, lineHeight: 1.25, letterSpacing: -.5 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{detalle}</div>}
    </button>
  );
}

function Explicacion({ item, onCerrar }) {
  if (!item) return null;
  const d = item.desglose ? item.desglose() : null;
  return (
    <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderTop: `3px solid ${item.color || NAVY}`,
                  borderRadius: 10, padding: "14px 18px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: item.color || NAVY }}>{item.rotulo}</div>
        <button onClick={onCerrar} style={{ background: "none", border: "none", color: "#94a3b8",
          cursor: "pointer", fontSize: 18, lineHeight: 1, fontFamily: "inherit" }}>×</button>
      </div>
      <div style={{ fontSize: 13, color: "#334155", marginTop: 6, lineHeight: 1.8, maxWidth: 880 }}>{item.que}</div>
      {item.como && (
        <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 8, lineHeight: 1.8, maxWidth: 880,
                      background: "#f7f9fc", borderRadius: 8, padding: "8px 12px" }}>
          <strong style={{ color: "#475569" }}>Cómo se calcula: </strong>{item.como}
        </div>
      )}
      {item.ojo && (
        <div style={{ fontSize: 12.5, color: "#7a2a22", marginTop: 8, lineHeight: 1.8, maxWidth: 880,
                      background: "#fff7f6", border: "1px solid #f6dcd8", borderRadius: 8, padding: "8px 12px" }}>
          <strong>Ojo: </strong>{item.ojo}
        </div>
      )}
      {d && d.filas.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#8a94a6", fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: .4, marginBottom: 6 }}>{d.titulo}</div>
          <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid #eef1f5", borderRadius: 8 }}>
            <Tabla columnas={d.columnas} filas={d.filas} chico />
          </div>
        </div>
      )}
      {d && d.filas.length === 0 && (
        <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 10, fontStyle: "italic" }}>
          {d.vacio || "Sin filas para mostrar."}
        </div>
      )}
    </div>
  );
}

// Tabla genérica: cada columna declara si es numérica (alineación a la derecha)
function Tabla({ columnas, filas, chico, vacio }) {
  return (
    <table className="an-tabla" style={chico ? { fontSize: 11.5 } : undefined}>
      <thead><tr>{columnas.map((c, j) => (
        <th key={j} style={c.num ? { textAlign: "right" } : undefined}>{c.t}</th>
      ))}</tr></thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={i}>{f.map((v, j) => (
            <td key={j} className={columnas[j] && columnas[j].num ? "num" : ""}
                style={j === 0 ? { fontWeight: 600 } : undefined}>{v}</td>
          ))}</tr>
        ))}
        {!filas.length && (
          <tr><td colSpan={columnas.length} style={{ padding: 18, textAlign: "center", color: "#8a94a6" }}>
            {vacio || "Sin datos."}
          </td></tr>
        )}
      </tbody>
    </table>
  );
}

function Semaforo({ estado }) {
  const cfg = {
    rojo:     { c: ROJO,  t: "Crítica",  b: "#fdecec" },
    amarillo: { c: AMBAR, t: "Atención", b: "#fdf6e3" },
    gris:     { c: GRIS,  t: "Aviso",    b: "#eef2f9" },
    verde:    { c: VERDE, t: "Normal",   b: "#e7f6ec" },
  }[estado] || { c: GRIS, t: estado || "—", b: "#eef2f9" };
  return <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 11, fontSize: 10.5,
    fontWeight: 800, color: cfg.c, background: cfg.b, whiteSpace: "nowrap" }}>{cfg.t}</span>;
}

function Glosario({ titulo, items }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={() => setAbierto(a => !a)} className="an-link">
        {abierto ? "▲ Ocultar" : "▼"} ¿Qué significa cada dato?
      </button>
      {abierto && (
        <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "14px 18px", marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 10 }}>{titulo}</div>
          {items.map((it, i) => (
            <div key={i} style={{ marginBottom: 11, paddingBottom: 11,
              borderBottom: i < items.length - 1 ? "1px solid #f1f4f8" : "none" }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155" }}>{it.t}</div>
              <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.75, marginTop: 2 }}>{it.d}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Módulo ─────────────────────────────────────────────────────────────────
function ModuloAnalisisCL() {
  const [tab, setTab] = useState("curso");
  const [dias, setDias] = useState([]);
  const [fecha, setFecha] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [kpiAbierto, setKpiAbierto] = useState(null);
  const [autoRefresco, setAutoRefresco] = useState(true);

  // en curso
  const [rutas, setRutas] = useState([]);
  const [scCurso, setScCurso] = useState([]);
  const [refSc, setRefSc] = useState([]);
  // cerrado
  const [kpiDia, setKpiDia] = useState(null);
  const [kpiSc, setKpiSc] = useState([]);
  const [conductores, setConductores] = useState([]);
  const [motivos, setMotivos] = useState([]);
  const [tiempos, setTiempos] = useState([]);
  // ajustes
  const [config, setConfig] = useState([]);
  const [guardando, setGuardando] = useState("");

  const cargarCurso = useCallback(async () => {
    const [r, sc, ref] = await Promise.all([
      api("vw_analisis_semaforo?order=pendientes.desc&limit=1000"),
      api("vw_analisis_sc_curso"),
      api("vw_ritmo_referencia_sc?order=cecos"),
    ]);
    setRutas(r); setScCurso(sc); setRefSc(ref);
  }, []);

  const cargarCerrado = useCallback(async (f) => {
    const [d, sc, cond, mot, tie] = await Promise.all([
      api(`vw_kpi_dia?fecha=eq.${f}`),
      api(`vw_kpi_por_sc?fecha=eq.${f}&order=ranking_entrega`),
      api(`vw_kpi_conductores?fecha=eq.${f}&order=ranking_entregas&limit=500`),
      api(`vw_kpi_motivos_sc?fecha=eq.${f}&order=paquetes.desc&limit=300`),
      api(`vw_kpi_tiempos?fecha=eq.${f}&order=horas_ruta.desc.nullslast&limit=500`),
    ]);
    setKpiDia(d[0] || null); setKpiSc(sc); setConductores(cond); setMotivos(mot); setTiempos(tie);
  }, []);

  // arranque
  useEffect(() => {
    (async () => {
      try {
        const d = await api("vw_kpi_dia?select=fecha&order=fecha.desc&limit=60");
        const fs = d.map(x => x.fecha);
        setDias(fs);
        if (fs.length) setFecha(fs[0]);
        await cargarCurso();
        if (fs.length) await cargarCerrado(fs[0]);
        setConfig(await api("monitoreo_config?order=grupo,clave"));
      } catch (e) { setError(e.message); }
      finally { setCargando(false); }
    })();
  }, [cargarCurso, cargarCerrado]);

  // cambio de fecha
  useEffect(() => {
    if (!fecha) return;
    let vivo = true;
    (async () => { try { await cargarCerrado(fecha); } catch (e) { if (vivo) setError(e.message); } })();
    return () => { vivo = false; };
  }, [fecha, cargarCerrado]);

  // refresco automático del panel en vivo
  useEffect(() => {
    if (tab !== "curso" || !autoRefresco) return;
    const id = setInterval(() => { cargarCurso().catch(() => {}); }, 60000);
    return () => clearInterval(id);
  }, [tab, autoRefresco, cargarCurso]);

  async function guardarConfig(clave, valor) {
    setGuardando(clave);
    try {
      await api(`monitoreo_config?clave=eq.${clave}`, {
        method: "PATCH", headers: { apikey: CL_KEY, Authorization: `Bearer ${CL_KEY}`,
          "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ valor, actualizado_at: new Date().toISOString(), actualizado_por: "brain" }),
      });
      setConfig(await api("monitoreo_config?order=grupo,clave"));
      await cargarCurso();
    } catch (e) { setError(e.message); }
    finally { setGuardando(""); }
  }

  // ── Cálculos en curso ────────────────────────────────────────────────────
  const reparto = rutas;
  const conteo = { rojo: 0, amarillo: 0, gris: 0, verde: 0 };
  for (const r of reparto) conteo[r.semaforo] = (conteo[r.semaforo] || 0) + 1;
  const totCurso = reparto.reduce((a, r) => ({
    cargados: a.cargados + n(r.cargados), entregados: a.entregados + n(r.entregados),
    pendientes: a.pendientes + n(r.pendientes), noEnt: a.noEnt + n(r.no_entregados),
  }), { cargados: 0, entregados: 0, pendientes: 0, noEnt: 0 });
  const pctCurso = totCurso.cargados ? (100 * totCurso.entregados / totCurso.cargados) : null;
  const frescura = reparto.length ? Math.min(...reparto.map(r => n(r.hace_minutos))) : null;
  const horasCierre = reparto.length ? n(reparto[0].horas_hasta_cierre) : null;

  // ── Nivel de servicio (nomenclatura del Excel: ácido vs justificado) ─────
  const nsDe = (fila) => {
    const carg = n(fila.cargados), ent = n(fila.entregados), tras = n(fila.traspasos);
    const acido = carg > 0 ? (100 * ent / carg) : null;
    const base = carg - tras;
    const justificado = base > 0 ? (100 * ent / base) : null;
    return { acido, justificado };
  };
  const nsDia = kpiDia ? nsDe(kpiDia) : { acido: null, justificado: null };

  // ── Tarjetas del día en curso ────────────────────────────────────────────
  const KPIS_CURSO = [
    { id: "criticas", rotulo: "Críticas", color: ROJO, alerta: conteo.rojo > 0,
      valor: fmt(conteo.rojo), detalle: "no alcanzan a terminar",
      que: "Rutas que, al ritmo que llevan, no van a terminar de entregar antes del cierre de la jornada.",
      como: "Se divide lo que le queda por entregar entre el ritmo de la última hora. Si el resultado supera las horas que faltan hasta las 23:59 (menos el margen de seguridad), la ruta se marca crítica.",
      ojo: "Este criterio es nuestro, no de MELI. El 27 de julio detectó una ruta con 66 paquetes pendientes que MELI no había marcado, y era la de mayor carga sin entregar del día.",
      desglose: () => ({ titulo: "Rutas críticas", columnas: [
        { t: "Ruta" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Pendientes", num: true },
        { t: "Ritmo/h", num: true }, { t: "Proyección", num: true }],
        filas: reparto.filter(r => r.semaforo === "rojo").map(r => [r.id_ruta, r.cecos, r.conductor || "—",
          fmt(r.pendientes), dec(r.pkg_hora_reciente), `${dec(r.horas_para_terminar)} h`]),
        vacio: "Ninguna ruta en riesgo de no terminar." }) },
    { id: "atencion", rotulo: "Atención", color: AMBAR, valor: fmt(conteo.amarillo), detalle: "estancadas o lentas",
      que: "Rutas estancadas (varias capturas sin entregar), con ritmo bajo para su centro, o que MELI marca como demoradas.",
      como: "Se cruzan tres señales: capturas consecutivas sin mover el contador, ritmo por debajo del umbral configurado respecto al ritmo normal del CECOS, y la bandera de ruta demorada de MELI.",
      desglose: () => ({ titulo: "Rutas en atención", columnas: [
        { t: "Ruta" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Pendientes", num: true },
        { t: "Sin entregar", num: true }, { t: "Motivos" }],
        filas: reparto.filter(r => r.semaforo === "amarillo").map(r => [r.id_ruta, r.cecos, r.conductor || "—",
          fmt(r.pendientes), `${fmt(r.minutos_sin_entregar)} min`, (r.motivos || []).join(", ")]),
        vacio: "Sin rutas en atención." }) },
    { id: "avance", rotulo: "Avance", color: VERDE, valor: pctCurso === null ? "—" : pct1(pctCurso),
      detalle: `${fmt(totCurso.entregados)} de ${fmt(totCurso.cargados)}`,
      que: "Cuánto de la carga del día ya se entregó.",
      como: "Entregados dividido por cargados, sumando todas las rutas de reparto (el Line Haul queda fuera).",
      ojo: "El porcentaje temprano queda inflado porque MELI crea rutas durante el día: el 27 de julio los cargados pasaron de 5.860 a las 11:39 a 12.408 a las 18:00. Por eso conviene mirar el absoluto junto al porcentaje.",
      desglose: () => ({ titulo: "Avance por CECOS", columnas: [
        { t: "CECOS" }, { t: "Rutas", num: true }, { t: "Cargados", num: true },
        { t: "Entregados", num: true }, { t: "Pendientes", num: true }, { t: "Avance", num: true }],
        filas: scCurso.map(s => [s.cecos, fmt(s.rutas), fmt(s.cargados), fmt(s.entregados),
          fmt(s.pendientes), pct1(s.pct_avance)]) }) },
    { id: "pendientes", rotulo: "Por entregar", color: NAVY, valor: fmt(totCurso.pendientes),
      detalle: horasCierre !== null ? `quedan ${dec(horasCierre)} h` : null,
      que: "Paquetes que siguen en los vehículos, sin entregar ni devolver.",
      como: "Suma de los pendientes que informa MELI en la última captura de cada ruta.",
      desglose: () => ({ titulo: "Rutas con más carga pendiente", columnas: [
        { t: "Ruta" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Pendientes", num: true }, { t: "Estado" }],
        filas: reparto.slice(0, 20).map(r => [r.id_ruta, r.cecos, r.conductor || "—", fmt(r.pendientes), r.status]) }) },
    { id: "rutas", rotulo: "Rutas activas", color: GRIS,
      valor: fmt(reparto.filter(r => r.status === "active").length),
      detalle: `${fmt(reparto.length)} en total`,
      que: "Rutas que en este momento están en la calle repartiendo.",
      como: "Rutas de reparto cuyo estado en MELI es activo, según la última captura del monitor.",
      desglose: () => ({ titulo: "Rutas por estado", columnas: [{ t: "Estado" }, { t: "Rutas", num: true }],
        filas: Object.entries(reparto.reduce((a, r) => { const k = r.status || "—"; a[k] = (a[k] || 0) + 1; return a; }, {}))
          .sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, fmt(v)]) }) },
  ];

  // ── Tarjetas del día cerrado ─────────────────────────────────────────────
  const KPIS_CERRADO = kpiDia ? [
    { id: "ns", rotulo: "Nivel de servicio", color: VERDE, valor: pct1(nsDia.acido),
      detalle: `justificado ${pct1(nsDia.justificado)}`,
      que: "Qué porcentaje de la carga del día llegó a destino. Se muestran las dos lecturas que usa el maestro en Excel: la ácida y la justificada.",
      como: "Ácido = entregados ÷ cargados: castiga todo lo que no se entregó, sin excepciones. Justificado = entregados ÷ (cargados − traspasos): descuenta del denominador los paquetes que pasaron a otra ruta, porque esa ruta los entregó.",
      ojo: "La definición de justificado está inferida de las columnas NS del Excel. Si el criterio oficial de la operación es otro, hay que ajustarlo antes de usarlo para metas.",
      desglose: () => ({ titulo: "Nivel de servicio por CECOS", columnas: [
        { t: "CECOS" }, { t: "Cargados", num: true }, { t: "Entregados", num: true },
        { t: "Traspasos", num: true }, { t: "NS ácido", num: true }, { t: "NS justificado", num: true }],
        filas: kpiSc.map(s => { const ns = nsDe(s);
          return [s.cecos, fmt(s.cargados), fmt(s.entregados), fmt(s.traspasos), pct1(ns.acido), pct1(ns.justificado)]; }) }) },
    { id: "entregados", rotulo: "Entregados", color: NAVY, valor: fmt(kpiDia.entregados),
      detalle: `${fmt(kpiDia.viajes)} viajes · ${fmt(kpiDia.paradas)} paradas`,
      que: "Paquetes que llegaron a destino en el día.",
      como: "Se cuentan los paquetes que el detalle de cada ruta marcó como entregados, capturados en la pasada de cierre de las 00:30.",
      desglose: () => ({ titulo: "Entregas por CECOS", columnas: [
        { t: "CECOS" }, { t: "Viajes", num: true }, { t: "Entregados", num: true }, { t: "Paquetes/hora", num: true }],
        filas: kpiSc.map(s => [s.cecos, fmt(s.viajes), fmt(s.entregados), dec(s.pkg_hora)]) }) },
    { id: "devueltos", rotulo: "Devoluciones", color: ROJO, valor: fmt(kpiDia.devueltos),
      detalle: `${pct1(kpiDia.pct_devolucion)} de la carga`,
      que: "Paquetes que volvieron sin entregarse, cada uno con un motivo.",
      como: "Del total de no entregados se descuentan los traspasados a otra ruta y los que fallaron en un momento del día pero se entregaron más tarde. Es el número que coincide con el contador de Fallidos del portal de MELI.",
      desglose: () => ({ titulo: "Devoluciones por motivo", columnas: [
        { t: "Motivo" }, { t: "Paquetes", num: true }, { t: "Viajes", num: true }, { t: "% del día", num: true }],
        filas: Object.entries(motivos.reduce((a, m) => {
          a[m.motivo] = a[m.motivo] || { p: 0, v: 0 };
          a[m.motivo].p += n(m.paquetes); a[m.motivo].v += n(m.viajes_afectados); return a; }, {}))
          .sort((a, b) => b[1].p - a[1].p)
          .map(([mot, x]) => [mot, fmt(x.p), fmt(x.v),
            pct1(n(kpiDia.devueltos) ? 100 * x.p / n(kpiDia.devueltos) : 0)]) }) },
    { id: "traspasos", rotulo: "Traspasos", color: ORANGE, valor: fmt(kpiDia.traspasos),
      detalle: "pasaron a otra ruta",
      que: "Paquetes que salieron en una ruta y se entregaron a otra durante el día. En el Excel son los D_JUSTIFICADOS.",
      como: "Paquetes marcados como transferidos por MELI, con su ruta de destino identificada.",
      ojo: "Se concentran fuertemente en la Región Metropolitana: el 25 de julio SRM1 tuvo 399 traspasos (13% de su carga) y SVP3 ninguno. Si el ranking se hace por NS ácido, los centros que traspasan quedan penalizados por una práctica que puede ser operativamente correcta.",
      desglose: () => ({ titulo: "Traspasos por CECOS", columnas: [
        { t: "CECOS" }, { t: "Cargados", num: true }, { t: "Traspasos", num: true }, { t: "% de la carga", num: true }],
        filas: kpiSc.map(s => [s.cecos, fmt(s.cargados), fmt(s.traspasos),
          pct1(n(s.cargados) ? 100 * n(s.traspasos) / n(s.cargados) : 0)]) }) },
    { id: "sinentregas", rotulo: "Sin entregas", color: AMBAR, alerta: n(kpiDia.rutas_sin_entregas) > 0,
      valor: fmt(kpiDia.rutas_sin_entregas), detalle: "viajes que no entregaron",
      que: "Viajes que terminaron el día sin haber entregado ni un paquete.",
      como: "Rutas cerradas con cero entregas en el detalle.",
      ojo: "Es una APROXIMACIÓN a las no salidas a ruta, no el dato oficial. MELI no informa las no salidas: si un conductor o un vehículo no salió, la ruta simplemente no aparece. Ese registro lo llevan los supervisores a mano, así que conviene cruzarlo con la bitácora.",
      desglose: () => ({ titulo: "Viajes sin entregas", columnas: [
        { t: "CECOS" }, { t: "Viajes sin entregas", num: true }],
        filas: kpiSc.filter(s => n(s.rutas_sin_entregas) > 0).map(s => [s.cecos, fmt(s.rutas_sin_entregas)]),
        vacio: "Todos los viajes del día registraron al menos una entrega." }) },
    { id: "ritmo", rotulo: "Ritmo", color: GRIS, valor: `${dec(kpiDia.pkg_hora_promedio)}/h`,
      detalle: `jornada de ${dec(kpiDia.horas_promedio)} h`,
      que: "Cuántos paquetes por hora entrega una ruta en promedio.",
      como: "Entregados divididos por las horas de ruta, promediado entre todos los viajes.",
      ojo: "El ritmo depende mucho de la densidad de la zona: una ruta urbana entrega más por hora que una rural sin que eso hable del conductor. Compara dentro del mismo CECOS.",
      desglose: () => ({ titulo: "Ritmo y jornada por CECOS", columnas: [
        { t: "CECOS" }, { t: "Paquetes/hora", num: true }, { t: "Horas promedio", num: true },
        { t: "Inicio mediano" }, { t: "Última entrega" }],
        filas: kpiSc.map(s => [s.cecos, dec(s.pkg_hora), dec(s.horas_promedio),
          (s.inicio_mediano || "—").slice(0, 5), (s.ultima_entrega_mediana || "—").slice(0, 5)]) }) },
  ] : [];

  const KPIS = tab === "curso" ? KPIS_CURSO : KPIS_CERRADO;
  const TABS = [
    { id: "curso",       label: "En curso",     desc: "jornada de hoy" },
    { id: "kpi",         label: "KPI del día",  desc: "día cerrado" },
    { id: "ranking",     label: "Rankings",     desc: "CECOS y conductores" },
    { id: "devoluciones",label: "Devoluciones", desc: "motivos y causas" },
    { id: "tiempos",     label: "Tiempos",      desc: "en qué se va la jornada" },
    { id: "ajustes",     label: "Ajustes",      desc: "umbrales de alerta" },
  ];

  return (
    <div style={{ padding: 0, fontFamily: "'Geist', system-ui, -apple-system, sans-serif" }}>
      <style>{`
        .an-wrap{background:#f4f6f9;min-height:100%;}
        .an-tab{background:transparent;border:none;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;
                color:#64748b;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;font-family:inherit;}
        .an-tab.on{color:${NAVY};border-bottom-color:${NAVY};}
        .an-tab:hover{color:${NAVY};}
        .an-tabla{width:100%;border-collapse:collapse;font-size:12px;background:#fff;}
        .an-tabla thead th{position:sticky;top:0;z-index:2;background:${NAVY};color:#fff;font-size:10.5px;
                letter-spacing:.4px;text-transform:uppercase;padding:8px 9px;text-align:left;white-space:nowrap;font-weight:700;}
        .an-tabla tbody td{padding:7px 9px;border-bottom:1px solid #eef1f5;white-space:nowrap;}
        .an-tabla tbody tr:hover{background:#f7faff;}
        .an-tabla .num{text-align:right;font-variant-numeric:tabular-nums;}
        .an-scroll{max-height:calc(100vh - 420px);overflow:auto;border:1px solid #e6e9ef;border-radius:10px;background:#fff;}
        .an-input{border:1px solid #dfe4ec;border-radius:8px;padding:6px 10px;font-size:12.5px;font-family:inherit;background:#fff;color:#1f2937;}
        .an-input:focus{outline:2px solid ${NAVY}22;border-color:${NAVY};}
        .an-btn{border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:8px;padding:6px 12px;
                font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;}
        .an-btn:hover{background:${NAVY};color:#fff;}
        .an-link{background:none;border:none;color:${NAVY};font-size:12.5px;font-weight:700;cursor:pointer;
                 padding:0;font-family:inherit;text-decoration:underline;}
        .an-kpi{transition:box-shadow .15s,transform .15s;}
        .an-kpi:hover{box-shadow:0 6px 16px -8px rgba(16,32,64,.25);transform:translateY(-1px);}
        .an-chip{border:1px solid #dfe4ec;background:#fff;border-radius:20px;padding:4px 11px;font-size:12px;
                 cursor:pointer;font-family:inherit;color:#64748b;font-weight:600;}
        .an-chip.on{background:${NAVY};border-color:${NAVY};color:#fff;}
      `}</style>

      {/* Cabecera */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: -.3 }}>Análisis de Operaciones · Chile</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              {tab === "curso"
                ? `Jornada en curso · datos del monitor cada 5 minutos${frescura !== null ? ` · hace ${frescura} min` : ""}`
                : "Indicadores del día cerrado"}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}>
            {tab === "curso" ? (
              <Fragment>
                <button className={`an-chip ${autoRefresco ? "on" : ""}`} onClick={() => setAutoRefresco(a => !a)}>
                  {autoRefresco ? "Actualiza sola" : "Manual"}
                </button>
                <button className="an-btn" onClick={() => cargarCurso().catch(e => setError(e.message))}>Actualizar</button>
              </Fragment>
            ) : (
              <Fragment>
                <span style={{ fontSize: 11.5, color: "#8a94a6", fontWeight: 700 }}>DÍA</span>
                <select className="an-input" value={fecha} onChange={e => setFecha(e.target.value)}>
                  {dias.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </Fragment>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginTop: 8, flexWrap: "wrap" }}>
          {TABS.map(t => (
            <button key={t.id} className={`an-tab ${tab === t.id ? "on" : ""}`}
                    onClick={() => { setTab(t.id); setKpiAbierto(null); }}>
              <div>{t.label}</div>
              <div style={{ fontSize: 10, color: "#a8b2c1", fontWeight: 400, marginTop: 1 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="an-wrap" style={{ padding: "16px 24px 28px" }}>
        {error && (
          <div style={{ background: "#fff4f4", border: "1px solid #f2c9c9", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: ROJO, fontSize: 13 }}>No se pudieron cargar los datos</div>
            <div style={{ fontSize: 12, color: "#7a2a22", marginTop: 3 }}>{error}</div>
          </div>
        )}
        {cargando && <div style={{ color: "#8a94a6", fontSize: 13, padding: "24px 0" }}>Cargando…</div>}

        {!cargando && (
          <Fragment>
            {/* Tarjetas (en curso y KPI) */}
            {(tab === "curso" || tab === "kpi") && (
              <Fragment>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                  {KPIS.map(k => (
                    <Tarjeta key={k.id} {...k} abierto={kpiAbierto === k.id}
                             onClick={() => setKpiAbierto(kpiAbierto === k.id ? null : k.id)} />
                  ))}
                </div>
                <Explicacion item={KPIS.find(k => k.id === kpiAbierto)} onCerrar={() => setKpiAbierto(null)} />
              </Fragment>
            )}

            {/* ── EN CURSO ── */}
            {tab === "curso" && (
              <Fragment>
                {!reparto.length ? (
                  <div style={{ background: "#fff", border: "1px dashed #dfe4ec", borderRadius: 10, padding: 24, maxWidth: 680 }}>
                    <div style={{ fontWeight: 800, color: NAVY, fontSize: 14 }}>Todavía no hay capturas del monitor</div>
                    <div style={{ fontSize: 13, color: "#64748b", marginTop: 6, lineHeight: 1.8 }}>
                      El monitor toma una foto cada 5 minutos entre las 07:00 y las 23:59. Fuera de ese horario
                      no hay operación en Chile y la pantalla queda vacía. El ritmo y la proyección necesitan al
                      menos dos capturas para poder calcularse.
                    </div>
                  </div>
                ) : (
                  <Fragment>
                    <Glosario titulo="Los datos de la jornada en curso" items={[
                      { t: "Estado", d: "Crítica = no alcanza a terminar antes del cierre. Atención = estancada, con ritmo bajo o marcada como demorada por MELI. Aviso = solo banderas informativas de MELI. Normal = sin observaciones." },
                      { t: "Ritmo/h", d: "Paquetes entregados en la última hora, calculado comparando capturas del monitor. Reacciona rápido a los cambios." },
                      { t: "Normal CECOS", d: "Ritmo mediano histórico de ese centro en los últimos 30 días. Es la referencia justa: Arica arranca a las 16:36 y Limache a las 09:42, así que no se pueden comparar con la misma regla." },
                      { t: "Proyección", d: "Horas que le tomaría terminar lo pendiente al ritmo actual. Si supera las horas que faltan hasta el cierre, la ruta se marca crítica." },
                      { t: "1ª entrega", d: "Hora aproximada de la primera entrega, con precisión de ±5 minutos (el intervalo del monitor). La hora exacta llega a las 00:30 con el detalle de paquetes." },
                      { t: "Sin entregar", d: "Minutos transcurridos desde la última entrega registrada. Muchos minutos con carga pendiente es señal de estancamiento." },
                    ]} />
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        Ordenadas por urgencia: primero las críticas, después por carga pendiente.
                      </div>
                      <div style={{ flex: 1 }} />
                      <button className="an-btn" onClick={() => descargarCSV(`analisis_en_curso`, reparto, [
                        { t: "RUTA", k: "id_ruta" }, { t: "CECOS", k: "cecos" }, { t: "CONDUCTOR", k: "conductor" },
                        { t: "PATENTE", k: "patente" }, { t: "CARGADOS", k: "cargados" }, { t: "ENTREGADOS", k: "entregados" },
                        { t: "PENDIENTES", k: "pendientes" }, { t: "AVANCE", k: "pct_avance" },
                        { t: "RITMO_HORA", k: "pkg_hora_reciente" }, { t: "PROYECCION_HORAS", k: "horas_para_terminar" },
                        { t: "PRIMERA_ENTREGA", k: "hora_primera_entrega_aprox" }, { t: "MIN_SIN_ENTREGAR", k: "minutos_sin_entregar" },
                        { t: "ESTADO", k: "semaforo" }, { t: "MOTIVOS", v: r => (r.motivos || []).join(" / ") },
                      ])}>Descargar CSV</button>
                    </div>
                    <div className="an-scroll">
                      <Tabla columnas={[
                        { t: "Estado" }, { t: "Ruta" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Patente" },
                        { t: "Cargados", num: true }, { t: "Entregados", num: true }, { t: "Pendientes", num: true },
                        { t: "Avance", num: true }, { t: "Ritmo/h", num: true }, { t: "Normal CECOS", num: true },
                        { t: "Proyección", num: true }, { t: "1ª entrega" }, { t: "Sin entregar", num: true }, { t: "Observaciones" },
                      ]} filas={
                        [...reparto].sort((a, b) => {
                          const o = { rojo: 0, amarillo: 1, gris: 2, verde: 3 };
                          return (o[a.semaforo] - o[b.semaforo]) || (n(b.pendientes) - n(a.pendientes));
                        }).map(r => [
                          <Semaforo estado={r.semaforo} />, r.id_ruta, r.cecos, r.conductor || "—", r.patente || "—",
                          fmt(r.cargados), fmt(r.entregados), fmt(r.pendientes), pct1(r.pct_avance),
                          dec(r.pkg_hora_reciente), dec(r.ritmo_normal_cecos),
                          r.horas_para_terminar === null ? "—" : `${dec(r.horas_para_terminar)} h`,
                          r.hora_primera_entrega_aprox || "—",
                          r.minutos_sin_entregar === null ? "—" : `${fmt(r.minutos_sin_entregar)} min`,
                          (r.motivos || []).join(", ") || "—",
                        ])
                      } />
                    </div>

                    <div style={{ marginTop: 16, fontSize: 11, color: "#8a94a6", fontWeight: 700,
                                  textTransform: "uppercase", letterSpacing: .4, marginBottom: 6 }}>
                      Avance por CECOS
                    </div>
                    <div className="an-scroll" style={{ maxHeight: 320 }}>
                      <Tabla columnas={[
                        { t: "CECOS" }, { t: "Rutas", num: true }, { t: "Activas", num: true },
                        { t: "Cargados", num: true }, { t: "Entregados", num: true }, { t: "Pendientes", num: true },
                        { t: "Avance", num: true }, { t: "Ritmo/h", num: true }, { t: "Normal", num: true },
                        { t: "Críticas", num: true }, { t: "Estancadas", num: true }, { t: "1ª entrega" },
                      ]} filas={scCurso.map(s => [s.cecos, fmt(s.rutas), fmt(s.activas), fmt(s.cargados),
                        fmt(s.entregados), fmt(s.pendientes), pct1(s.pct_avance), dec(s.ritmo_promedio),
                        dec(s.ritmo_normal), fmt(s.en_riesgo), fmt(s.estancadas),
                        (s.primera_entrega_del_cecos || "—").slice(0, 5)])} />
                    </div>
                  </Fragment>
                )}
              </Fragment>
            )}

            {/* ── KPI DEL DÍA ── */}
            {tab === "kpi" && (
              <Fragment>
                <Glosario titulo="Los indicadores del día cerrado" items={[
                  { t: "NS ácido", d: "Entregados ÷ cargados. Castiga todo lo que no se entregó, sin excepciones. Es la lectura más exigente." },
                  { t: "NS justificado", d: "Entregados ÷ (cargados − traspasos). Descuenta los paquetes que pasaron a otra ruta, porque esa ruta los entregó. Definición inferida de las columnas NS del Excel: conviene validarla con la operación." },
                  { t: "Devoluciones", d: "Paquetes que volvieron sin entregarse. Excluye traspasos y los que fallaron pero se entregaron más tarde. Cuadra con el contador de Fallidos del portal de MELI." },
                  { t: "Traspasos", d: "Paquetes que se entregaron a otra ruta durante el día. En el Excel son los D_JUSTIFICADOS. Se concentran en la Región Metropolitana." },
                  { t: "Sin entregas", d: "Viajes que cerraron sin entregar nada. Aproximación a las no salidas a ruta; el registro oficial lo llevan los supervisores porque MELI no lo informa." },
                  { t: "Paquetes/hora", d: "Ritmo de entrega. Depende de la densidad de la zona, así que comparar centros distintos puede ser injusto." },
                ]} />
                <div className="an-scroll">
                  <Tabla columnas={[
                    { t: "CECOS" }, { t: "Viajes", num: true }, { t: "Cargados", num: true },
                    { t: "Entregados", num: true }, { t: "Devueltos", num: true }, { t: "Traspasos", num: true },
                    { t: "NS ácido", num: true }, { t: "NS justif.", num: true }, { t: "% devol.", num: true },
                    { t: "Sin entregas", num: true }, { t: "Pkg/hora", num: true }, { t: "Horas", num: true },
                    { t: "Inicio" }, { t: "Última entrega" }, { t: "Cierre p90" },
                  ]} filas={kpiSc.map(s => { const ns = nsDe(s); return [
                    s.cecos, fmt(s.viajes), fmt(s.cargados), fmt(s.entregados), fmt(s.devueltos), fmt(s.traspasos),
                    pct1(ns.acido), pct1(ns.justificado), pct1(s.pct_devolucion), fmt(s.rutas_sin_entregas),
                    dec(s.pkg_hora), dec(s.horas_promedio), (s.inicio_mediano || "—").slice(0, 5),
                    (s.ultima_entrega_mediana || "—").slice(0, 5), (s.cierre_p90 || "—").slice(0, 5)]; })} />
                </div>
              </Fragment>
            )}

            {/* ── RANKINGS ── */}
            {tab === "ranking" && (
              <Fragment>
                <Glosario titulo="Cómo leer los rankings" items={[
                  { t: "Ranking de CECOS", d: "Ordenado por nivel de servicio ácido. Incluye la hora mediana de inicio y de última entrega para que se pueda comparar centros con turnos distintos." },
                  { t: "Ranking de conductores", d: "Tres órdenes distintos: entregas totales, ritmo por hora y devoluciones. Cada uno cuenta algo diferente." },
                  { t: "Advertencia importante", d: "El volumen depende de la carga que se le asignó al conductor y el ritmo depende de la densidad de su zona. Un conductor rural nunca va a igualar el ritmo de uno urbano sin que eso diga nada de su desempeño. Comparar dentro del mismo CECOS." },
                  { t: "Traspasos y ranking", d: "Un centro que traspasa mucho baja su NS ácido aunque los paquetes se hayan entregado. Para rankear conviene mirar también el NS justificado." },
                ]} />
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1 }} />
                  <button className="an-btn" onClick={() => descargarCSV(`ranking_conductores_${fecha}`, conductores, [
                    { t: "FECHA", k: "fecha" }, { t: "CONDUCTOR", k: "conductor" }, { t: "CECOS", k: "cecos" },
                    { t: "PATENTE", k: "patente" }, { t: "VIAJES", k: "viajes" }, { t: "CARGADOS", k: "cargados" },
                    { t: "ENTREGADOS", k: "entregados" }, { t: "DEVUELTOS", k: "devueltos" },
                    { t: "TRASPASOS", k: "traspasos" }, { t: "PCT_ENTREGA", k: "pct_entrega" },
                    { t: "HORAS", k: "horas" }, { t: "PKG_HORA", k: "pkg_hora" },
                    { t: "RANK_ENTREGAS", k: "ranking_entregas" }, { t: "RANK_RITMO", k: "ranking_ritmo" },
                  ])}>Descargar CSV</button>
                </div>

                <div style={{ fontSize: 11, color: "#8a94a6", fontWeight: 700, textTransform: "uppercase",
                              letterSpacing: .4, marginBottom: 6 }}>Ranking de service centers</div>
                <div className="an-scroll" style={{ maxHeight: 300, marginBottom: 18 }}>
                  <Tabla columnas={[
                    { t: "#", num: true }, { t: "CECOS" }, { t: "NS ácido", num: true }, { t: "NS justif.", num: true },
                    { t: "Entregados", num: true }, { t: "Devueltos", num: true }, { t: "Pkg/hora", num: true },
                    { t: "Horas", num: true }, { t: "Inicio" }, { t: "Conductores", num: true },
                  ]} filas={kpiSc.map(s => { const ns = nsDe(s); return [
                    fmt(s.ranking_entrega), s.cecos, pct1(ns.acido), pct1(ns.justificado), fmt(s.entregados),
                    fmt(s.devueltos), dec(s.pkg_hora), dec(s.horas_promedio),
                    (s.inicio_mediano || "—").slice(0, 5), fmt(s.conductores)]; })} />
                </div>

                <div style={{ fontSize: 11, color: "#8a94a6", fontWeight: 700, textTransform: "uppercase",
                              letterSpacing: .4, marginBottom: 6 }}>
                  Mejor desempeño por ritmo (paquetes por hora)
                </div>
                <div className="an-scroll" style={{ maxHeight: 300, marginBottom: 18 }}>
                  <Tabla columnas={[
                    { t: "#", num: true }, { t: "Conductor" }, { t: "CECOS" }, { t: "Patente" },
                    { t: "Pkg/hora", num: true }, { t: "Entregados", num: true }, { t: "Horas", num: true },
                    { t: "Paradas", num: true }, { t: "Ayudante" },
                  ]} filas={[...conductores].sort((a, b) => n(b.pkg_hora) - n(a.pkg_hora)).slice(0, 15)
                    .map((c, i) => [i + 1, c.conductor, c.cecos, c.patente || "—", dec(c.pkg_hora),
                      fmt(c.entregados), dec(c.horas), fmt(c.paradas), c.con_ayudante ? "Sí" : "—"])} />
                </div>

                <div style={{ fontSize: 11, color: "#8a94a6", fontWeight: 700, textTransform: "uppercase",
                              letterSpacing: .4, marginBottom: 6 }}>Mayor volumen entregado</div>
                <div className="an-scroll" style={{ maxHeight: 300, marginBottom: 18 }}>
                  <Tabla columnas={[
                    { t: "#", num: true }, { t: "Conductor" }, { t: "CECOS" }, { t: "Entregados", num: true },
                    { t: "Cargados", num: true }, { t: "% entrega", num: true }, { t: "Pkg/hora", num: true },
                  ]} filas={conductores.slice(0, 15).map(c => [fmt(c.ranking_entregas), c.conductor, c.cecos,
                    fmt(c.entregados), fmt(c.cargados), pct1(c.pct_entrega), dec(c.pkg_hora)])} />
                </div>

                <div style={{ fontSize: 11, color: ROJO, fontWeight: 700, textTransform: "uppercase",
                              letterSpacing: .4, marginBottom: 6 }}>Más devoluciones</div>
                <div className="an-scroll" style={{ maxHeight: 300 }}>
                  <Tabla columnas={[
                    { t: "Conductor" }, { t: "CECOS" }, { t: "Devueltos", num: true }, { t: "Cargados", num: true },
                    { t: "% devol.", num: true }, { t: "Traspasos", num: true },
                  ]} filas={[...conductores].sort((a, b) => n(b.devueltos) - n(a.devueltos)).slice(0, 15)
                    .filter(c => n(c.devueltos) > 0)
                    .map(c => [c.conductor, c.cecos, fmt(c.devueltos), fmt(c.cargados),
                      pct1(n(c.cargados) ? 100 * n(c.devueltos) / n(c.cargados) : 0), fmt(c.traspasos)])}
                    vacio="Ningún conductor registró devoluciones este día." />
                </div>
              </Fragment>
            )}

            {/* ── DEVOLUCIONES ── */}
            {tab === "devoluciones" && (
              <Fragment>
                <Glosario titulo="Devoluciones por motivo" items={[
                  { t: "Qué se cuenta", d: "Paquetes que volvieron sin entregarse, con el motivo que registró el conductor en MELI. No incluye traspasos ni paquetes que fallaron y luego se entregaron." },
                  { t: "% del día", d: "Peso de esa combinación de centro y motivo sobre el total de devoluciones del día. Sirve para detectar concentraciones: un motivo que se dispara en un solo CECOS." },
                  { t: "Motivos en otros idiomas", d: "Algunos motivos llegan en portugués (\"O pacote foi recusado\", \"Faltam dados do endereço\"). Es cómo los devuelve MELI; conviene agrupar por el código técnico y no por el texto." },
                ]} />
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }} />
                  <button className="an-btn" onClick={() => descargarCSV(`devoluciones_motivos_${fecha}`, motivos, [
                    { t: "FECHA", k: "fecha" }, { t: "CECOS", k: "cecos" }, { t: "MOTIVO", k: "motivo" },
                    { t: "PAQUETES", k: "paquetes" }, { t: "VIAJES", k: "viajes_afectados" },
                    { t: "COMUNAS", k: "comunas" }, { t: "PCT_DEL_DIA", k: "pct_del_dia" },
                  ])}>Descargar CSV</button>
                </div>
                <div className="an-scroll">
                  <Tabla columnas={[
                    { t: "CECOS" }, { t: "Motivo" }, { t: "Paquetes", num: true },
                    { t: "Viajes", num: true }, { t: "Comunas", num: true }, { t: "% del día", num: true },
                  ]} filas={motivos.map(m => [m.cecos, m.motivo, fmt(m.paquetes), fmt(m.viajes_afectados),
                    fmt(m.comunas), pct1(m.pct_del_dia)])}
                    vacio="Sin devoluciones registradas para este día." />
                </div>
              </Fragment>
            )}

            {/* ── TIEMPOS ── */}
            {tab === "tiempos" && (
              <Fragment>
                <Glosario titulo="En qué se va la jornada" items={[
                  { t: "Hasta 1ª entrega", d: "Desde que la ruta arranca hasta que entrega el primer paquete. Es principalmente traslado a la zona, y puede ser legítimamente largo en destinos lejanos." },
                  { t: "Entregando", d: "Desde la primera hasta la última entrega. Es la ventana productiva de la ruta." },
                  { t: "Tras última entrega", d: "Desde la última entrega hasta que la ruta se cierra. Debería ser el regreso." },
                  { t: "Advertencia sobre el tramo final", d: "No está verificado si la hora de cierre que informa MELI es el regreso real del vehículo o un cierre administrativo. El 25 de julio, SVP3 mostró cerca de 5 horas entre la última entrega y el cierre, lo que sugiere que el tramo puede ser un artefacto del sistema. No usar para evaluar a nadie hasta confirmarlo." },
                ]} />
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }} />
                  <button className="an-btn" onClick={() => descargarCSV(`tiempos_${fecha}`, tiempos, [
                    { t: "FECHA", k: "fecha" }, { t: "CECOS", k: "cecos" }, { t: "ID_VIAJE", k: "id_viaje" },
                    { t: "CONDUCTOR", k: "conductor" }, { t: "INICIO", k: "hora_inicio_ruta" },
                    { t: "PRIMERA_ENTREGA", k: "hora_primera_parada" }, { t: "ULTIMA_ENTREGA", k: "hora_ultima_parada" },
                    { t: "CIERRE", k: "hora_fin_ruta" }, { t: "HORAS_RUTA", k: "horas_ruta" },
                    { t: "HASTA_1A_ENTREGA", k: "horas_hasta_primera_entrega" },
                    { t: "ENTREGANDO", k: "horas_entregando" },
                    { t: "TRAS_ULTIMA", k: "horas_tras_ultima_entrega" },
                    { t: "ENTREGADOS", k: "entregados" },
                  ])}>Descargar CSV</button>
                </div>
                <div className="an-scroll">
                  <Tabla columnas={[
                    { t: "Ruta" }, { t: "CECOS" }, { t: "Conductor" }, { t: "Inicio" }, { t: "1ª entrega" },
                    { t: "Últ. entrega" }, { t: "Cierre" }, { t: "Total", num: true },
                    { t: "Hasta 1ª", num: true }, { t: "Entregando", num: true }, { t: "Tras últ.", num: true },
                    { t: "Entregados", num: true },
                  ]} filas={tiempos.map(t => [t.id_viaje, t.cecos, t.conductor || "—",
                    (t.hora_inicio_ruta || "—").slice(0, 5), (t.hora_primera_parada || "—").slice(0, 5),
                    (t.hora_ultima_parada || "—").slice(0, 5), (t.hora_fin_ruta || "—").slice(0, 5),
                    `${dec(t.horas_ruta)} h`, `${dec(t.horas_hasta_primera_entrega, 2)} h`,
                    `${dec(t.horas_entregando, 2)} h`, `${dec(t.horas_tras_ultima_entrega, 2)} h`,
                    fmt(t.entregados)])}
                    vacio="Sin datos de tiempos. Requieren la pasada de cierre de las 00:30." />
                </div>
              </Fragment>
            )}

            {/* ── AJUSTES ── */}
            {tab === "ajustes" && (
              <Fragment>
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.8, maxWidth: 860, marginBottom: 14 }}>
                  Estos umbrales definen cuándo una ruta se marca como crítica o en atención. Se guardan en la base
                  de datos, así que un cambio acá afecta de inmediato lo que muestra la pestaña <strong>En curso</strong>,
                  sin tocar código. Las banderas de MELI se pueden encender o apagar por separado: hoy
                  <em> parada comercial</em> y <em>vehículo inactivo</em> vienen apagadas porque generaban ruido
                  (el 27 de julio, 19 de 22 alertas de MELI eran <em>parada comercial</em>, o sea un estado normal).
                </div>
                {["ritmo", "estancamiento", "cierre", "banderas_meli"].map(grupo => {
                  const items = config.filter(c => c.grupo === grupo);
                  if (!items.length) return null;
                  const titulos = { ritmo: "Ritmo de entrega", estancamiento: "Detección de estancamiento",
                                    cierre: "Cierre de la jornada", banderas_meli: "Banderas de MELI" };
                  return (
                    <div key={grupo} style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10,
                                              padding: "14px 18px", marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 10 }}>{titulos[grupo]}</div>
                      {items.map(c => (
                        <div key={c.clave} style={{ display: "flex", gap: 14, alignItems: "flex-start",
                          padding: "10px 0", borderTop: "1px solid #f1f4f8" }}>
                          <div style={{ flex: 1, minWidth: 260 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155" }}>{c.rotulo}</div>
                            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7, marginTop: 2 }}>{c.descripcion}</div>
                            <div style={{ fontSize: 10.5, color: "#a8b2c1", marginTop: 3, fontFamily: "monospace" }}>
                              {c.clave} · rango {c.minimo}–{c.maximo}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            {c.unidad === "si/no" ? (
                              <button className={`an-chip ${n(c.valor) === 1 ? "on" : ""}`}
                                      disabled={guardando === c.clave}
                                      onClick={() => guardarConfig(c.clave, n(c.valor) === 1 ? 0 : 1)}>
                                {n(c.valor) === 1 ? "Activada" : "Apagada"}
                              </button>
                            ) : (
                              <Fragment>
                                <input className="an-input" type="number" step="0.01"
                                       min={c.minimo ?? undefined} max={c.maximo ?? undefined}
                                       defaultValue={c.valor} style={{ width: 92, textAlign: "right" }}
                                       onBlur={e => {
                                         const v = Number(e.target.value);
                                         if (Number.isNaN(v) || v === n(c.valor)) return;
                                         if (c.minimo !== null && v < n(c.minimo)) { e.target.value = c.valor; return; }
                                         if (c.maximo !== null && v > n(c.maximo)) { e.target.value = c.valor; return; }
                                         guardarConfig(c.clave, v);
                                       }} />
                                <span style={{ fontSize: 11.5, color: "#94a3b8", minWidth: 52 }}>{c.unidad}</span>
                              </Fragment>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}

                <div style={{ background: "#fff", border: "1px solid #e6e9ef", borderRadius: 10, padding: "14px 18px" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, marginBottom: 4 }}>
                    Referencia de cada CECOS
                  </div>
                  <div style={{ fontSize: 12.5, color: "#64748b", lineHeight: 1.8, marginBottom: 10, maxWidth: 860 }}>
                    Esta tabla no se edita: se calcula sola con los últimos 30 días cerrados. Es la referencia
                    contra la que se juzga cada ruta en curso, y por eso los umbrales son justos entre centros con
                    turnos muy distintos. Un CECOS con menos de 10 rutas de referencia no genera alertas de ritmo,
                    para no juzgar con datos flacos.
                  </div>
                  <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid #eef1f5", borderRadius: 8 }}>
                    <Tabla chico columnas={[
                      { t: "CECOS" }, { t: "Rutas ref.", num: true }, { t: "Días", num: true },
                      { t: "Ritmo mediano", num: true }, { t: "p10 (lento)", num: true }, { t: "p90 (rápido)", num: true },
                      { t: "Horas prom.", num: true }, { t: "Inicio" }, { t: "1ª entrega" }, { t: "Últ. entrega" },
                    ]} filas={refSc.map(r => [r.cecos, fmt(r.rutas_referencia), fmt(r.dias),
                      dec(r.pkg_hora_mediano), dec(r.pkg_hora_p10), dec(r.pkg_hora_p90), dec(r.horas_promedio),
                      (r.inicio_mediano || "—").slice(0, 5), (r.primera_entrega_mediana || "—").slice(0, 5),
                      (r.ultima_entrega_mediana || "—").slice(0, 5)])} />
                  </div>
                </div>
              </Fragment>
            )}
          </Fragment>
        )}
      </div>
    </div>
  );
}

export default ModuloAnalisisCL;
