// ═══════════════════════════════════════════════════════════════════════════
// Capacidad.jsx — una sola pantalla para Administración → Pagos → Capacidad y
// para Indicadores Operacionales MX → Capacidad (mismo componente, dos menús).
//
// La cadena completa por día y SC, con los dos mundos lado a lado:
//   Comprometido (planilla) → Acordado (MELI) → Solicitado → Confirmado → Asignado → Ejecutado
//   Brain = nuestros datos (pedidos, rostering, Torre, Bitácora)   · azul
//   MELI  = foto diaria del reporte de Capacidad de MELI (robot)    · naranja
// Fuentes:
//   · fn_capacidad(desde, hasta)            una fila por viaje (SDD completo + Spot aceptado)
//   · fn_meli_capacidad(desde, hasta)       gráfico total, gráfico por SC y detalle por ruta, según MELI
//   · fn_capacidad_prometida(desde, hasta)  compromisos con MELI y comprometido por SC × día
//   · fn_no_salidas_dia(sc, fecha)          respuesta del supervisor (solo con un día)
// ═══════════════════════════════════════════════════════════════════════════
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { descargarExcelMultihoja, fechaOperativaOffset, sb } from "./shared";
import { NoSalidasSC, etiquetaNosal } from "./NoSalidas";

const NOSAL_RUTAS_DESDE = "2026-11-04";   // primeras rutas con el ítem "No Salidas a Ruta" en la Bitácora
const AZUL = "#002E5D";
const NARANJA = "#FF6600";
const GRIS = "#64748b";
const BORDE = "#e4e7ec";
const POR_PAGINA = 10;
const BUCKET_EVIDENCIAS = "evidencias-meli";
const VEHICULOS = ["Large Van MLP", "Small Van MLP", "Large Van", "Small Van", "Car", "Moto"];

const CATEGORIA = {
  ejecutado: ["Ejecutado", "#047857", "#d1fae5"],
  pendiente: ["Pendiente", "#7c3aed", "#f3e8ff"],
  no_show_soft: ["No confirmada (soft)", "#b45309", "#fef3c7"],
  no_show_hard: ["No show (hard)", "#b91c1c", "#fee2e2"],
  cancelado_hard: ["Cancelación", "#b91c1c", "#fee2e2"],
  no_salio_otro: ["No salió · otros", "#475569", "#f1f5f9"],
  sin_responder: ["No salió · sin respuesta", "#9f1239", "#ffe4e6"],
  otro: ["Otro", "#475569", "#f1f5f9"],
};
const CONFIRMADO = { Aceptado: ["#047857", "#d1fae5"], "No confirmado": ["#b45309", "#fef3c7"], "Sin responder": ["#7c3aed", "#f3e8ff"] };
const VER = [
  ["todos", "Todos"], ["ejecutado", "Ejecutados"], ["no_ejecutado", "No ejecutados"], ["soft", "No confirmadas (soft)"],
  ["no_show_hard", "No show (hard)"], ["cancelado_hard", "Cancelación"], ["no_salio_otro", "No salió · otros"],
  ["sin_responder", "No salió · sin respuesta"], ["pendiente", "Pendientes"], ["difieren", "Difieren con MELI"],
];
const pasaVer = (f, v) => {
  if (v === "todos") return true;
  if (v === "no_ejecutado") return !f.ejecutado;
  if (v === "soft") return f.categoria === "no_show_soft";
  if (v === "difieren") return f.meli && f.meli.ejecutada !== null && f.meli.ejecutada !== !!f.ejecutado;
  return f.categoria === v;
};

const pct = (a, b) => (b ? Math.round((a * 100) / b) + "%" : "—");
const fCorta = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "");
const fHora = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const fLarga = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
// MELI entrega los paquetes como número o como objeto ({value, percentage} o {raw, total})
const num = (v) => { if (v == null) return null; if (typeof v === "number") return v; if (typeof v === "string") { const n = parseInt(v.replace(/[^0-9]/g, ""), 10); return Number.isNaN(n) ? null : n; } if (typeof v === "object") return num(v.raw ?? v.value ?? v.total ?? v.count ?? null); return null; };
const placaNorm = (p) => String(p || "").toUpperCase().replace(/^SDD-/, "").replace(/[^A-Z0-9]/g, "");

function Pill({ t, c, bg }) {
  return <span style={{ background: bg, color: c, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{t}</span>;
}
function Check({ v }) {
  return v ? <span style={{ color: "#047857", fontWeight: 800 }}>✓</span> : <span style={{ color: "#cbd5e1" }}>—</span>;
}
// Valor Brain con el de MELI debajo cuando difiere
function Dos({ brain, meli, pequeno }) {
  const dif = meli != null && brain != null && meli !== brain;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 1.15 }}>
      <span style={{ fontWeight: 700, color: "#334155", fontSize: pequeno ? 11.5 : 12 }}>{brain ?? "—"}</span>
      {meli != null && <span style={{ fontSize: 10, color: dif ? NARANJA : "#94a3b8", fontWeight: dif ? 700 : 400 }}>MELI {meli}</span>}
    </span>
  );
}
function Tarjeta({ titulo, total, filas }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: "12px 14px", minWidth: 250, maxWidth: 320 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontWeight: 700, color: AZUL, fontSize: 13 }}>
        <span>{titulo}</span><span style={{ fontSize: 18, whiteSpace: "nowrap" }}>{total}</span>
      </div>
      <div style={{ borderTop: `1px solid ${BORDE}`, margin: "8px 0 4px" }} />
      {filas.map(([t, v, ayuda]) => (
        <div key={t} title={ayuda || undefined} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: GRIS, padding: "3px 0", whiteSpace: "pre",
          cursor: ayuda ? "help" : "default", ...(v === "" ? { fontSize: 11, fontWeight: 600, color: AZUL, marginTop: 6 } : {}) }}>
          <span>{t}</span>
          <span style={{ fontWeight: 700, color: "#334155", whiteSpace: "nowrap", textAlign: "right", ...(ayuda && v !== "" && v !== 0 && v !== "0" ? { borderBottom: "1px dotted #94a3b8" } : {}) }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
function LinkEvidencia({ path, nombre }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!path) return;
    let vivo = true;
    sb.storage.from(BUCKET_EVIDENCIAS).createSignedUrl(path, 3600).then(({ data }) => { if (vivo && data?.signedUrl) setUrl(data.signedUrl); });
    return () => { vivo = false; };
  }, [path]);
  if (!path) return <span style={{ color: "#94a3b8" }}>—</span>;
  return url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: AZUL }}>📎 {nombre || "ver"}</a> : <span style={{ color: GRIS }}>…</span>;
}

// Totales Brain con las mismas reglas que se cuadraron contra MELI
function sumar(filas) {
  const t = { solicitado: filas.length, confirmado: 0, asignado: 0, ejecutado: 0, pendiente: 0,
    no_show_soft: 0, no_show_hard: 0, no_show_hard_sdd: 0, no_show_hard_spot: 0,
    cancelado_hard: 0, cancelado_sdd: 0, cancelado_spot: 0, no_salio_otro: 0, sin_responder: 0, no_salio_sdd: 0, no_salio_spot: 0, difieren: 0 };
  for (const f of filas) {
    const acept = f.confirmado === "Aceptado", sdd = f.modelo === "SDD";
    if (acept) t.confirmado++;
    if (acept && f.asignado) t.asignado++;
    if (acept && f.ejecutado) t.ejecutado++;
    if (acept && !f.ejecutado && f.categoria !== "pendiente") { if (sdd) t.no_salio_sdd++; else t.no_salio_spot++; }
    if (f.categoria === "no_show_hard") { t.no_show_hard++; if (sdd) t.no_show_hard_sdd++; else t.no_show_hard_spot++; }
    else if (f.categoria === "cancelado_hard") { t.cancelado_hard++; if (sdd) t.cancelado_sdd++; else t.cancelado_spot++; }
    else if (t[f.categoria] !== undefined && f.categoria !== "ejecutado") t[f.categoria]++;
    if (f.meli && f.meli.ejecutada !== null && f.meli.ejecutada !== !!f.ejecutado) t.difieren++;
  }
  return t;
}
// Totales MELI (SDD) contados desde su lista ruta por ruta (los ✓ del "Detalle por estado"):
// así el total siempre es la suma de los SC y es la misma base del recuadro de reclamo.
// El acordado no existe en la lista: sale del gráfico (total o del SC).
function sumarMeli(entradas, sc) {
  const t = { acordado: 0, solicitado: 0, confirmado: 0, asignado: 0, ejecutado: 0, soft: 0, hard: 0, n: 0 };
  for (const e of entradas) {
    const ch = sc ? (e.por_sc || []).find((x) => x.sc === sc)?.chart : e.chart;
    const filas = (e.detalle || []).filter((d) => !sc || d.service_center === sc);
    if (!ch && !filas.length) continue;
    t.n++;
    t.acordado += ch?.negotiated || 0;
    for (const d of filas) {
      const sol = d.requested === "✓", conf = d.confirmed === "✓", ros = d.rostered === "✓", eje = d.executed === "✓";
      if (sol) t.solicitado++; if (conf) t.confirmado++; if (ros) t.asignado++; if (eje) t.ejecutado++;
      if (sol && !conf) t.soft++;
      if (conf && ros && !eje) t.hard++;
    }
  }
  return t.n ? t : null;
}

// Pedidas por sobre lo prometido (SDD): contra el compromiso cargado o, si no hay, contra el acordado de MELI
function pedidasDeMas(m, compSdd) {
  if (!m) return 0;
  return Math.max(m.solicitado - (compSdd ?? m.acordado ?? m.solicitado), 0);
}

export default function Capacidad({ usuario }) {
  const ayer = fechaOperativaOffset(-1);
  const hoy = fechaOperativaOffset(0);
  const quien = (usuario && (usuario.nombre || usuario.email)) || "Brain";
  const [fechaSel, setFechaSel] = useState(ayer);
  const [hastaSel, setHastaSel] = useState(ayer);
  const [esRango, setEsRango] = useState(false);
  const [aplicado, setAplicado] = useState({ d1: ayer, d2: ayer });
  const [segundos, setSegundos] = useState(null);
  const [esperando, setEsperando] = useState(0);
  const ultimaPeticion = useRef(0);
  const [modelo, setModelo] = useState("");
  const [sc, setSc] = useState("");
  const [todas, setTodas] = useState([]);
  const [meli, setMeli] = useState([]);
  const [rutasMeli, setRutasMeli] = useState([]);   // route_execution de MELI: paquetes por ruta
  const [prom, setProm] = useState({ compromisos: [], cruce: [] });
  const [noSal, setNoSal] = useState([]);
  const [verBitacora, setVerBitacora] = useState(true);
  const [verCompromisos, setVerCompromisos] = useState(false);
  const [ver, setVer] = useState("todos");
  const [vistaMeli, setVistaMeli] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [excelBusy, setExcelBusy] = useState(false);
  // Formulario de compromisos
  const [form, setForm] = useState({ sc: "", vehiculo: "", vehiculoOtro: "", modelo: "SDD", cantidad: "", vigencia: hoy, nota: "" });
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);
  const inputArchivo = useRef(null);

  const { d1, d2 } = aplicado;
  const fechasValidas = /^\d{4}-\d{2}-\d{2}$/.test(fechaSel) && (!esRango || /^\d{4}-\d{2}-\d{2}$/.test(hastaSel));

  const cargar = useCallback(async () => {
    const id = ++ultimaPeticion.current;
    const t0 = Date.now();
    setLoading(true); setError(null); setEsperando(0);
    const reloj = setInterval(() => setEsperando(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const [r, m, p, ns, re] = await Promise.race([
        Promise.all([
          sb.rpc("fn_capacidad", { p_desde: d1, p_hasta: d2 }),
          sb.rpc("fn_meli_capacidad", { p_desde: d1, p_hasta: d2 }),
          sb.rpc("fn_capacidad_prometida", { p_desde: d1, p_hasta: d2 }),
          d1 === d2 ? sb.rpc("fn_no_salidas_dia", { p_sc: null, p_fecha: d1 }) : Promise.resolve({ data: [] }),
          sb.rpc("fn_meli_rutas_ejecutadas", { p_desde: d1, p_hasta: d2 }),
        ]),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Supabase no respondió en 40 segundos")), 40000)),
      ]);
      if (id !== ultimaPeticion.current) return;
      if (r.error) throw new Error(`${r.error.message || r.error}${r.error.code ? ` (código ${r.error.code})` : ""}`);
      if (!Array.isArray(r.data)) throw new Error("fn_capacidad no devolvió una lista");
      setTodas(r.data);
      setMeli(Array.isArray(m?.data) ? m.data : []);
      setProm(p?.data && typeof p.data === "object" ? { compromisos: p.data.compromisos || [], cruce: p.data.cruce || [] } : { compromisos: [], cruce: [] });
      setNoSal(Array.isArray(ns?.data) ? ns.data : []);
      setRutasMeli(Array.isArray(re?.data) ? re.data : []);
      setSegundos(((Date.now() - t0) / 1000).toFixed(1));
    } catch (e) {
      console.error("Capacidad", d1, d2, e);
      if (id === ultimaPeticion.current) setError(e.message || String(e));
    } finally {
      clearInterval(reloj);
      if (id === ultimaPeticion.current) setLoading(false);
    }
  }, [d1, d2]);
  useEffect(() => { cargar(); }, [cargar]);

  const aplicar = () => {
    if (!fechasValidas) return;
    const a = fechaSel, b = esRango ? hastaSel : fechaSel;
    const nuevo = { d1: a <= b ? a : b, d2: b >= a ? b : a };
    if (nuevo.d1 === aplicado.d1 && nuevo.d2 === aplicado.d2) cargar(); else setAplicado(nuevo);
  };

  // ── Cruce por ruta con el detalle de MELI (fecha + placa, o route_id) ──
  const meliPorRuta = useMemo(() => {
    const porPlaca = new Map(), porRuta = new Map(), todasPorPlaca = new Map();
    for (const e of meli) for (const d of (e.modelo === "SDD" ? e.detalle || [] : [])) {
      const fila = { ejecutada: d.executed === "✓", confirmada: d.confirmed === "✓", rosterizada: d.rostered === "✓", route_id: d.route_id || null, sc: d.service_center, driver_id: d.driver_id || null };
      if (d.route_id) porRuta.set(String(d.route_id), fila);
      const p = placaNorm(d.vehicle_plate);
      if (p) {
        const k = `${e.fecha}|${p}`;
        // con dos filas de la misma placa, para el cruce manda la del chofer rosterizado; se guardan todas
        if (!porPlaca.has(k)) porPlaca.set(k, fila);
        todasPorPlaca.set(k, [...(todasPorPlaca.get(k) || []), fila]);
      }
    }
    return { porPlaca, porRuta, todasPorPlaca };
  }, [meli]);
  const filasBase = useMemo(() => todas.map((f) => {
    if (f.modelo !== "SDD") return { ...f, meli: null };   // MELI solo cobra no show en SDD: Spot no se compara
    const k = f.placa ? `${f.fecha}|${placaNorm(f.placa)}` : null;
    const delChofer = k && f.driver_id ? (meliPorRuta.todasPorPlaca.get(k) || []).find((x) => String(x.driver_id) === String(f.driver_id)) : null;
    const m = delChofer || (f.id_ruta && meliPorRuta.porRuta.get(String(f.id_ruta))) || (k && meliPorRuta.porPlaca.get(k)) || null;
    return { ...f, meli: m ? { ...m } : (f.confirmado === "Aceptado" && meli.length ? { ejecutada: null, sinRegistro: true } : null) };
  }), [todas, meli, meliPorRuta]);

  const delModelo = useMemo(() => (modelo ? filasBase.filter((f) => f.modelo === modelo) : filasBase), [filasBase, modelo]);
  const filas = useMemo(() => (sc ? delModelo.filter((f) => f.sc === sc) : delModelo), [delModelo, sc]);
  const meliFiltrado = useMemo(() => meli.filter((e) => e.modelo === "SDD" && (!modelo || modelo === "SDD")), [meli, modelo]);
  const meliTot = useMemo(() => sumarMeli(meliFiltrado, sc || null), [meliFiltrado, sc]);
  const cruceFiltrado = useMemo(() => prom.cruce.filter((x) => (!modelo || x.modelo === modelo) && (!sc || x.sc === sc)), [prom, modelo, sc]);
  const comprometido = useMemo(() => cruceFiltrado.reduce((t, x) => t + (x.comprometido || 0), 0), [cruceFiltrado]);
  const hayCompromiso = useMemo(() => cruceFiltrado.some((x) => x.comprometido != null), [cruceFiltrado]);
  const compPor = (lista, m) => { const l = lista.filter((x) => x.modelo === m); return l.some((x) => x.comprometido != null) ? l.reduce((t, x) => t + (x.comprometido || 0), 0) : null; };
  const tot = useMemo(() => sumar(filas), [filas]);
  const listaSc = useMemo(() => [...new Set([...todas.map((f) => f.sc), ...meli.flatMap((e) => (e.por_sc || []).map((x) => x.sc))].filter(Boolean))].sort(), [todas, meli]);

  const porSc = useMemo(() => {
    const g = {};
    for (const f of delModelo) if (f.sc) (g[f.sc] = g[f.sc] || []).push(f);
    const scs = new Set([...Object.keys(g), ...meliFiltrado.flatMap((e) => (e.por_sc || []).map((x) => x.sc))]);
    return [...scs].map((k) => {
      const cr = prom.cruce.filter((x) => x.sc === k && (!modelo || x.modelo === modelo));
      const m = sumarMeli(meliFiltrado, k);
      const sddBrain = sumar((g[k] || []).filter((f) => f.modelo === "SDD"));
      return { sc: k, ...sumar(g[k] || []), sdd: sddBrain, meli: m, comprometido: cr.some((x) => x.comprometido != null) ? cr.reduce((t, x) => t + (x.comprometido || 0), 0) : null,
        de_mas: pedidasDeMas(m, compPor(cr, "SDD")) };
    });
  }, [delModelo, meliFiltrado, prom, modelo]);

  const totSdd = useMemo(() => sumar(filas.filter((f) => f.modelo === "SDD")), [filas]);
  const DIAS_CIERRE_MELI = 2;   // MELI corrige el reporte durante los días siguientes; desde D+2 lo tomamos como cerrado
  const cierreMeli = useMemo(() => {
    const sdd = meli.filter((e) => e.modelo === "SDD");
    if (!sdd.length) return null;
    const diaMX = (iso) => new Date(new Date(iso).getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
    const sumarD = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const abiertos = sdd.filter((e) => diaMX(e.capturado_at) < sumarD(e.fecha, DIAS_CIERRE_MELI)).map((e) => e.fecha).sort();
    const ultima = sdd.map((e) => e.capturado_at).sort().slice(-1)[0];
    return { cerrado: abiertos.length === 0, cierraEl: abiertos.length ? sumarD(abiertos[abiertos.length - 1], DIAS_CIERRE_MELI) : null, ultima };
  }, [meli]);
  const rutaMeli = useMemo(() => new Map(rutasMeli.map((r) => [String(r.route_id), r])), [rutasMeli]);
  const reclamos = useMemo(() => filas.filter((f) => f.modelo === "SDD" && f.ejecutado && f.meli && f.meli.ejecutada === false)
    .map((f) => {
      const otras = (meliPorRuta.todasPorPlaca.get(`${f.fecha}|${placaNorm(f.placa)}`) || []).filter((x) => x.ejecutada && String(x.route_id) !== String(f.meli.route_id));
      return { ...f, rutaMeli: f.id_ruta ? rutaMeli.get(String(f.id_ruta)) || null : null, otraEjecutada: otras[0] || null };
    }), [filas, rutaMeli, meliPorRuta]);
  const totSpot = useMemo(() => sumar(filas.filter((f) => f.modelo === "SPOT")), [filas]);
  // "SCY1 2 · SHP1 1": en qué SC está cada número (se ve al posicionarse)
  const porScTxt = (lista) => { const g = {}; for (const f of lista) g[f.sc] = (g[f.sc] || 0) + 1; const t = Object.entries(g).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(" · "); return t || "Ninguno"; };
  const meliScTxt = (campo) => {
    const g = {};
    for (const e of meliFiltrado) for (const d of e.detalle || []) {
      if (sc && d.service_center !== sc) continue;
      const sol = d.requested === "✓", conf = d.confirmed === "✓", ros = d.rostered === "✓", eje = d.executed === "✓";
      const cuenta = campo === "soft_no_show" ? sol && !conf : conf && ros && !eje;
      if (cuenta) g[d.service_center] = (g[d.service_center] || 0) + 1;
    }
    const t = Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "); return t || "Ninguno";
  };
  const noSalio = (f) => f.confirmado === "Aceptado" && !f.ejecutado && f.categoria !== "pendiente";
  const listas = useMemo(() => ({
    soft: filas.filter((f) => f.modelo === "SDD" && f.categoria === "no_show_soft"),
    hardSdd: filas.filter((f) => f.modelo === "SDD" && noSalio(f)),
    spot: filas.filter((f) => f.modelo === "SPOT" && noSalio(f)),
    noShow: filas.filter((f) => f.categoria === "no_show_hard"),
    cancel: filas.filter((f) => f.categoria === "cancelado_hard"),
    otros: filas.filter((f) => f.categoria === "no_salio_otro"),
    sinResp: filas.filter((f) => f.categoria === "sin_responder"),
    pend: filas.filter((f) => f.categoria === "pendiente"),
  }), [filas]);
  // Pedidas de más: suma por SC (cada SC contra su propio compromiso o acordado)
  const deMasTotal = useMemo(() => porSc.filter((x) => !sc || x.sc === sc).reduce((t, x) => t + (x.de_mas || 0), 0), [porSc, sc]);
  useEffect(() => { setPagina(1); }, [ver, buscar, filas, vistaMeli]);
  const filtradas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((f) => pasaVer(f, ver) && (!q || [f.sc, f.placa, f.chofer, f.driver_id, f.id_ruta, f.travel_id, f.request_id, f.vehiculo].some((x) => x && String(x).toLowerCase().includes(q))));
  }, [filas, ver, buscar]);
  // Vista MELI: la tabla "Detalle por estado" del portal (SDD), con la columna Torre al final
  const filasMeli = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    const brainPorPlaca = new Map();
    for (const f of filasBase) if (f.modelo === "SDD" && f.placa) {
      const k = `${f.fecha}|${placaNorm(f.placa)}`;
      brainPorPlaca.set(k, [...(brainPorPlaca.get(k) || []), f]);
    }
    const out = [];
    for (const e of meli) if (e.modelo === "SDD") for (const d of e.detalle || []) {
      if (sc && d.service_center !== sc) continue;
      const lista = d.vehicle_plate ? brainPorPlaca.get(`${e.fecha}|${placaNorm(d.vehicle_plate)}`) || [] : [];
      const b = lista.find((f) => String(f.driver_id) === String(d.driver_id)) || lista[0] || null;
      const torreSalio = lista.some((f) => f.ejecutado);
      const meliSalio = d.executed === "✓";
      const fila = { fecha: e.fecha, d, b, torreSalio, meliSalio, difiere: !!d.vehicle_plate && d.rostered === "✓" && torreSalio !== meliSalio };
      if (q && ![d.service_center, d.vehicle_plate, d.driver_id, d.route_id, b?.chofer].some((x) => x && String(x).toLowerCase().includes(q))) continue;
      if (ver === "difieren" && !fila.difiere) continue;
      out.push(fila);
    }
    return out.sort((a, b) => (b.difiere - a.difiere) || a.d.service_center.localeCompare(b.d.service_center));
  }, [meli, filasBase, sc, buscar, ver]);
  const totalVista = vistaMeli ? filasMeli.length : filtradas.length;
  const paginas = Math.max(1, Math.ceil(totalVista / POR_PAGINA));
  const visibles = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const visiblesMeli = filasMeli.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const vigentes = useMemo(() => prom.compromisos.filter((c) => c.activo && (!c.vigencia_hasta || c.vigencia_hasta >= hoy)), [prom, hoy]);
  const scsForm = useMemo(() => [...new Set(["SCY1", "SHP1", "SMX1", "SMX10", "SMX2", "SMX20", "SMX22", "SMX7", "SMX8", "SMX9", "SPY1", "SQR1", "STL1", "STX1", "SVH1", ...listaSc])].sort(), [listaSc]);

  async function guardarCompromiso() {
    setMsg(null);
    const vehiculo = form.vehiculo === "_otro" ? form.vehiculoOtro.trim() : form.vehiculo;
    const faltan = [];
    if (!form.sc) faltan.push("SC"); if (!vehiculo) faltan.push("vehículo");
    if (form.cantidad === "" || Number(form.cantidad) < 0) faltan.push("cantidad"); if (!form.vigencia) faltan.push("vigencia");
    if (faltan.length) { setMsg({ tipo: "error", texto: "Falta: " + faltan.join(", ") + "." }); return; }
    setGuardando(true);
    try {
      let path = null, nombre = null;
      if (archivo) {
        path = `compromisos/${form.sc}/${Date.now()}_${archivo.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
        const { error: eUp } = await sb.storage.from(BUCKET_EVIDENCIAS).upload(path, archivo, { contentType: archivo.type || "application/octet-stream", upsert: false });
        if (eUp) throw new Error("No se pudo subir el adjunto: " + eUp.message);
        nombre = archivo.name;
      }
      const { error: err } = await sb.rpc("fn_capacidad_prometida_guardar", {
        p_sc: form.sc, p_vehiculo: vehiculo, p_modelo: form.modelo, p_cantidad: Number(form.cantidad), p_vigencia_desde: form.vigencia,
        p_evidencia_path: path, p_evidencia_nombre: nombre, p_nota: form.nota, p_por: quien,
      });
      if (err) throw err;
      setMsg({ tipo: "ok", texto: `Guardado: ${form.sc} · ${vehiculo} · ${form.modelo} · ${form.cantidad} por día desde ${fCorta(form.vigencia)}.` });
      setForm((f) => ({ ...f, cantidad: "", nota: "" })); setArchivo(null); if (inputArchivo.current) inputArchivo.current.value = "";
      await cargar();
    } catch (e) { setMsg({ tipo: "error", texto: e.message || String(e) }); }
    finally { setGuardando(false); }
  }
  async function cerrarCompromiso(c) {
    const h = window.prompt(`¿Hasta qué fecha rige ${c.sc} · ${c.vehiculo} · ${c.modelo} (${c.cantidad} por día)? AAAA-MM-DD, o vacío para anularlo.`, hoy);
    if (h === null) return;
    const { error: err } = await sb.rpc("fn_capacidad_prometida_cerrar", { p_id: c.id, p_hasta: h.trim() || null, p_por: quien });
    if (err) { setMsg({ tipo: "error", texto: err.message }); return; }
    await cargar();
  }

  const descargarExcel = async () => {
    setExcelBusy(true);
    try {
      const det = [["FECHA", "SC", "MODELO", "REQUEST ID", "TRAVEL ID", "VEHICULO", "PLACA", "CHOFER", "DRIVER ID", "ID RUTA", "CONFIRMADO", "ASIGNADO", "EJECUTADO",
        "MELI EJECUTADA", "ESTADO TORRE", "RESULTADO", "RESPUESTA SUPERVISOR", "MOTIVO", "COMENTARIO", "RESPONDIDO POR", "RESPONDIDO EL", "PRUEBAS"]];
      for (const f of filtradas) det.push([f.fecha, f.sc, f.modelo, f.request_id ?? "", f.travel_id || "", f.vehiculo || "", f.placa || "", f.chofer || "", f.driver_id || "", f.id_ruta || "",
        f.confirmado || "", f.asignado ? "SI" : "NO", f.ejecutado ? "SI" : "NO", f.meli ? (f.meli.ejecutada === null ? "SIN REGISTRO" : f.meli.ejecutada ? "SI" : "NO") : "",
        f.estado_torre || "", (CATEGORIA[f.categoria] || [f.categoria])[0], f.resultado_supervisor || "", etiquetaNosal(f.etiqueta), f.comentario || "",
        f.respondido_por || "", f.respondido_at ? fHora(f.respondido_at) : "", f.pruebas || 0]);
      const res = [["SC", "COMPROMETIDO", "ACORDADO MELI", "SOLICITADO", "SOLICITADO MELI", "CONFIRMADO", "CONFIRMADO MELI", "ASIGNADO", "ASIGNADO MELI", "EJECUTADO", "EJECUTADO MELI",
        "% EJECUTADO / CONFIRMADO", "NO CONFIRMADAS (SOFT)", "SOFT MELI", "HARD NO SHOW", "HARD MELI", "CANCELACION", "OTROS", "SIN RESPUESTA", "DIFIEREN CON MELI"]];
      res[0].push("PEDIDAS DE MAS");
      for (const x of porSc) {
        if (sc && x.sc !== sc) continue;
        const m = x.meli || {};
        res.push([x.sc, x.comprometido ?? "", m.acordado ?? "", x.solicitado, m.solicitado ?? "", x.confirmado, m.confirmado ?? "", x.asignado, m.asignado ?? "", x.ejecutado, m.ejecutado ?? "",
          pct(x.ejecutado, x.confirmado), x.no_show_soft, m.soft ?? "", x.no_show_hard, m.hard ?? "", x.cancelado_hard, x.no_salio_otro, x.sin_responder, x.difieren, x.de_mas || 0]);
      }
      const comp = [["SC", "VEHICULO", "MODELO", "COMPROMETIDO POR DIA", "VIGENCIA DESDE", "VIGENCIA HASTA", "EVIDENCIA", "NOTA", "CARGO", "CARGADO EL"]];
      for (const c of prom.compromisos) comp.push([c.sc, c.vehiculo, c.modelo, c.cantidad, c.vigencia_desde, c.vigencia_hasta || "", c.evidencia_nombre || "", c.nota || "", c.cargado_por, fHora(c.cargado_at)]);
      const rec = [["FECHA", "SC", "PLACA", "CHOFER ROSTERIZADO", "DRIVER ID", "RUTA MELI SIN EJECUTAR", "RUTA QUE SALIO (TORRE)", "SALIDA REAL TORRE", "ESTADO TORRE", "EN LISTA DE RUTAS MELI", "PAQUETES TOTAL MELI", "PAQUETES ENTREGADOS MELI", "MISMA CAMIONETA: RUTA EJECUTADA EN MELI", "CHOFER DE ESA RUTA", "SUPERVISOR"]];
      for (const f of reclamos) rec.push([f.fecha, f.sc, f.placa || "", f.chofer || "", f.driver_id || "", f.meli?.route_id || "", f.id_ruta || "", f.salida_real ? fHora(f.salida_real) : "", f.estado_torre || "",
        f.rutaMeli ? "SI" : "NO", num(f.rutaMeli?.total_packages) ?? "", num(f.rutaMeli?.delivered_packages) ?? "", f.otraEjecutada?.route_id || "", f.otraEjecutada?.driver_id || "", f.resultado_supervisor || ""]);
      await descargarExcelMultihoja([{ nombre: "Reclamo", datos: rec }, { nombre: "Por SC", datos: res }, { nombre: "Detalle", datos: det }, { nombre: "Compromisos", datos: comp }],
        `capacidad_${d1 === d2 ? d1 : d1 + "_a_" + d2}${modelo ? "_" + modelo : ""}${sc ? "_" + sc : ""}`);
    } catch (e) { alert("No se pudo generar el Excel: " + (e.message || e)); }
    finally { setExcelBusy(false); }
  };

  const th = { padding: "8px 8px", fontSize: 10.5, color: GRIS, fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", background: "#f8fafc" };
  const thC = { ...th, textAlign: "center" };
  const td = { padding: "7px 8px", fontSize: 11.5, verticalAlign: "middle", borderTop: `1px solid ${BORDE}` };
  const tdC = { ...td, textAlign: "center" };
  const input = { border: `1px solid ${BORDE}`, borderRadius: 8, padding: "6px 8px", fontSize: 12, background: "#fff" };
  const caja = { background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14 };
  const boton = (activo) => ({ padding: "7px 14px", fontSize: 12.5, fontWeight: 600, border: "none", borderRadius: 8, cursor: "pointer", background: activo ? AZUL : "#f1f5f9", color: activo ? "#fff" : "#334155" });
  const valores = { comprometido: { brain: hayCompromiso ? comprometido : null, meli: null }, acordado: { brain: null, meli: meliTot?.acordado ?? null },
    solicitado: { brain: tot.solicitado, meli: meliTot?.solicitado ?? null }, confirmado: { brain: tot.confirmado, meli: meliTot?.confirmado ?? null },
    asignado: { brain: tot.asignado, meli: meliTot?.asignado ?? null }, ejecutado: { brain: tot.ejecutado, meli: meliTot?.ejecutado ?? null } };
  const maxBarra = Math.max(1, ...Object.values(valores).flatMap((v) => [v.brain || 0, v.meli || 0]));

  return (
    <div className="pg">
      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: GRIS }}>{esRango ? "Desde" : "Día"}<br /><input type="date" value={fechaSel} onChange={(e) => setFechaSel(e.target.value)} style={input} /></label>
        {esRango && <label style={{ fontSize: 11, color: GRIS }}>Hasta<br /><input type="date" value={hastaSel} onChange={(e) => setHastaSel(e.target.value)} style={input} /></label>}
        <label style={{ fontSize: 11, color: GRIS, display: "flex", alignItems: "center", gap: 4, paddingBottom: 7 }}>
          <input type="checkbox" checked={esRango} onChange={(e) => { setEsRango(e.target.checked); if (e.target.checked && hastaSel < fechaSel) setHastaSel(fechaSel); }} /> Rango
        </label>
        <button onClick={aplicar} disabled={!fechasValidas} style={{ ...input, background: AZUL, color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>Aplicar</button>
        <label style={{ fontSize: 11, color: GRIS }}>Modelo<br />
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} style={input}><option value="">Todos</option><option value="SDD">SDD</option><option value="SPOT">Spot</option></select></label>
        <label style={{ fontSize: 11, color: GRIS }}>Service Center<br />
          <select value={sc} onChange={(e) => setSc(e.target.value)} style={input}><option value="">Todos</option>{listaSc.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <button onClick={cargar} disabled={loading} style={{ ...input, cursor: "pointer" }}>↻ Actualizar</button>
        <button onClick={descargarExcel} disabled={excelBusy || loading} style={{ ...input, cursor: "pointer", fontWeight: 600 }}>{excelBusy ? "Generando…" : "⬇ Excel"}</button>
      </div>
      <div style={{ fontSize: 12, color: "#334155", marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span><b>{d1 === d2 ? fLarga(d1) : `${fLarga(d1)} al ${fLarga(d2)}`}</b>{modelo ? ` · ${modelo === "SDD" ? "SDD" : "Spot"}` : " · SDD y Spot"}{sc ? ` · ${sc}` : ""}
          {!loading && <span style={{ color: GRIS }}> · {todas.length} viajes · {segundos ? `${segundos} s` : ""}</span>}
          {(fechaSel !== d1 || (esRango ? hastaSel : fechaSel) !== d2) && <span style={{ color: "#b45309", fontWeight: 600 }}> · presiona Aplicar</span>}</span>
        {!meliTot && !loading && <span style={{ fontSize: 11, color: NARANJA }}>sin foto de MELI para esta fecha</span>}
      </div>
      {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}><b>No se pudo cargar {d1 === d2 ? d1 : `${d1} al ${d2}`}:</b> {error}</div>}
      {loading && <div style={{ color: GRIS, fontSize: 12, marginBottom: 12 }}>Consultando… {esperando} s</div>}

      {/* SDD: lo que MELI cobra · Spot: lo que operamos */}
      {(() => {
        const compSdd = compPor(cruceFiltrado, "SDD");
        const colsSdd = [
          ["Comprometido", compSdd, null],
          ["Acordado", null, meliTot?.acordado ?? null],
          ["Solicitado", totSdd.solicitado, meliTot?.solicitado ?? null],
          ["Confirmado", totSdd.confirmado, meliTot?.confirmado ?? null],
          ["Asignado", totSdd.asignado, meliTot?.asignado ?? null],
          ["Ejecutado", totSdd.ejecutado, meliTot?.ejecutado ?? null],
          ["Soft no show", totSdd.no_show_soft, meliTot?.soft ?? null],
          ["Hard no show", totSdd.no_salio_sdd || 0, meliTot?.hard ?? null],
        ];
        const colsSpot = [["Aceptadas", totSpot.confirmado], ["Con placa y chofer", totSpot.asignado], ["Salieron", totSpot.ejecutado], ["No salieron", totSpot.no_salio_spot || 0]];
        const cell = (v, color, grande = true) => <td style={{ padding: "8px 10px", textAlign: "center", fontSize: grande ? 15 : 13, fontWeight: 700, color: v == null ? "#cbd5e1" : color, borderTop: `1px solid ${BORDE}` }}>{v ?? "—"}</td>;
        const fila = (titulo, color) => <td style={{ padding: "8px 10px", fontWeight: 700, color, fontSize: 12, borderTop: `1px solid ${BORDE}`, whiteSpace: "nowrap" }}>{titulo}</td>;
        return (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ ...caja, flex: "1 1 680px", overflowX: "auto" }}>
              {modelo !== "SPOT" && (<>
                <div style={{ fontWeight: 700, color: AZUL, fontSize: 14, marginBottom: 8, display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span>SDD <span style={{ color: GRIS, fontWeight: 400, fontSize: 12 }}>· lo que MELI cobra</span></span>
                  {cierreMeli && <span title={`Última foto de MELI: ${fHora(cierreMeli.ultima)}`} style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, cursor: "help",
                    background: cierreMeli.cerrado ? "#d1fae5" : "#fef3c7", color: cierreMeli.cerrado ? "#047857" : "#b45309" }}>
                    MELI · {cierreMeli.cerrado ? "día cerrado" : `día abierto, cierra el ${fCorta(cierreMeli.cierraEl)}`}</span>}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={{ ...th, background: "none" }}></th>{colsSdd.map(([t]) => <th key={t} style={{ ...thC, background: "none", fontSize: 11 }}>{t}</th>)}</tr></thead>
                  <tbody>
                    <tr>{fila("Brain", AZUL)}{colsSdd.map(([t, b]) => <Fragment key={t}>{cell(b, AZUL)}</Fragment>)}</tr>
                    <tr>{fila("MELI", NARANJA)}{colsSdd.map(([t, b, m]) => <Fragment key={t}>{cell(m, NARANJA)}</Fragment>)}</tr>
                    <tr>{fila("Diferencia", GRIS)}{colsSdd.map(([t, b, m]) => { const d = b != null && m != null ? m - b : null; return <Fragment key={t}>{cell(d == null ? null : d === 0 ? "=" : (d > 0 ? "+" : "") + d, d ? "#b91c1c" : "#94a3b8")}</Fragment>; })}</tr>
                  </tbody>
                </table>
                {meliTot && (deMasTotal > 0 || totSdd.difieren > 0) && (
                  <div style={{ marginTop: 10, display: "flex", gap: 18, fontSize: 12, color: "#334155", flexWrap: "wrap" }}>
                    {deMasTotal > 0 && <span><b style={{ color: "#b91c1c" }}>{deMasTotal}</b> pedidas por MELI sobre lo prometido</span>}
                    {totSdd.difieren > 0 && <span><b style={{ color: "#b91c1c" }}>{totSdd.difieren}</b> rutas con resultado distinto · <a href="#" onClick={(e) => { e.preventDefault(); setVer("difieren"); }} style={{ color: AZUL }}>ver en el detalle</a></span>}
                  </div>
                )}
                {!meliTot && !loading && <div style={{ marginTop: 8, fontSize: 12, color: NARANJA }}>Sin foto de MELI para esta fecha</div>}
                {reclamos.length > 0 && (
                  <div style={{ marginTop: 14, border: `1px solid ${cierreMeli?.cerrado ? "#fecaca" : "#fde68a"}`, background: cierreMeli?.cerrado ? "#fff7f7" : "#fffbeb", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontWeight: 700, color: cierreMeli?.cerrado ? "#b91c1c" : "#b45309", fontSize: 13, marginBottom: 8 }}>
                      {cierreMeli?.cerrado ? "Para reclamar a MELI" : "A vigilar"} · {reclamos.length} {reclamos.length === 1 ? "ruta" : "rutas"}: MELI dice que no salió, la Torre dice que sí
                      {!cierreMeli?.cerrado && cierreMeli?.cierraEl && <span style={{ fontWeight: 400 }}> · MELI puede corregirlo hasta el {fCorta(cierreMeli.cierraEl)}</span>}
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
                      <thead><tr>{["Fecha", "SC", "Placa", "Chofer rosterizado", "Ruta MELI sin ejecutar", "Ruta que salió (Torre)", "Según MELI (lista de rutas)", "Misma camioneta en MELI", "Supervisor"].map((t) => <th key={t} style={{ ...th, fontSize: 10.5 }}>{t}</th>)}</tr></thead>
                      <tbody>
                        {reclamos.map((f, i) => (
                          <tr key={i}>
                            <td style={td}>{fCorta(f.fecha)}</td><td style={{ ...td, fontWeight: 700 }}>{f.sc}</td><td style={{ ...td, fontFamily: "monospace", fontWeight: 700 }}>{f.placa}</td>
                            <td style={td}>{f.chofer}<div style={{ fontSize: 10, color: GRIS }}>{f.driver_id}</div></td>
                            <td style={{ ...td, fontWeight: 700, color: "#b91c1c" }}>{f.meli?.route_id || "—"}</td>
                            <td style={td}><b>{f.id_ruta || "—"}</b><div style={{ fontSize: 10.5, color: GRIS }}>{f.salida_real ? `${fHora(f.salida_real)} · ${f.estado_torre}` : f.estado_torre}</div></td>
                            <td style={td}>{f.rutaMeli
                              ? <span style={{ color: "#047857", fontWeight: 700 }}>ruta en su lista · {num(f.rutaMeli.delivered_packages) ?? "?"} de {num(f.rutaMeli.total_packages) ?? "?"} paquetes entregados</span>
                              : <span style={{ color: GRIS }}>no está en su lista de rutas ejecutadas</span>}</td>
                            <td style={td}>{f.otraEjecutada
                              ? <span style={{ color: "#047857", fontWeight: 700 }}>ejecutó la ruta {f.otraEjecutada.route_id}<div style={{ fontWeight: 400, color: String(f.otraEjecutada.driver_id) !== String(f.driver_id) ? "#b45309" : GRIS, fontSize: 10.5 }}>chofer {f.otraEjecutada.driver_id}{String(f.otraEjecutada.driver_id) !== String(f.driver_id) ? " (distinto al rosterizado)" : ""}</div></span>
                              : <span style={{ color: GRIS }}>—</span>}</td>
                            <td style={td}>{f.respondido_at ? `${f.resultado_supervisor === "si_salio" ? "Sí salió" : f.resultado_supervisor}${f.ruta_declarada ? ` · ruta ${f.ruta_declarada}` : ""}` : <span style={{ color: GRIS }}>—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>)}
              {modelo !== "SDD" && (<>
                <div style={{ fontWeight: 700, color: AZUL, fontSize: 14, marginTop: modelo === "SPOT" ? 0 : 18, marginBottom: 8 }}>Spot <span style={{ color: GRIS, fontWeight: 400, fontSize: 12 }}>· lo que operamos</span></div>
                <table style={{ borderCollapse: "collapse" }}>
                  <thead><tr><th style={{ ...th, background: "none" }}></th>{colsSpot.map(([t]) => <th key={t} style={{ ...thC, background: "none", fontSize: 11, minWidth: 110 }}>{t}</th>)}</tr></thead>
                  <tbody><tr>{fila("Brain", AZUL)}{colsSpot.map(([t, b]) => <Fragment key={t}>{cell(b, AZUL)}</Fragment>)}</tr></tbody>
                </table>
              </>)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {modelo !== "SPOT" && <Tarjeta titulo="No show SDD" total={`${listas.soft.length + listas.hardSdd.length}${meliTot ? ` · MELI ${meliTot.soft + meliTot.hard}` : ""}`} filas={[
                ["Soft · no confirmadas", `${listas.soft.length}${meliTot ? `  ·  MELI ${meliTot.soft}` : ""}`, `Brain: ${porScTxt(listas.soft)}${meliTot ? `\nMELI: ${meliScTxt("soft_no_show")}` : ""}`],
                ["Hard · aceptadas que no salieron", `${listas.hardSdd.length}${meliTot ? `  ·  MELI ${meliTot.hard}` : ""}`, `Brain: ${porScTxt(listas.hardSdd)}${meliTot ? `\nMELI: ${meliScTxt("hard_no_show")}` : ""}`],
              ]} />}
              <Tarjeta titulo="Aceptadas que no salieron" total={listas.hardSdd.length + listas.spot.length} filas={[
                ["SDD", listas.hardSdd.length, porScTxt(listas.hardSdd)], ["Spot", listas.spot.length, porScTxt(listas.spot)],
                ["Respuesta del supervisor", "", ""],
                ["   No show", `${tot.no_show_hard || 0}${tot.no_show_hard ? ` (${tot.no_show_hard_sdd || 0} SDD · ${tot.no_show_hard_spot || 0} Spot)` : ""}`, porScTxt(listas.noShow)],
                ["   Cancelación", `${tot.cancelado_hard || 0}${tot.cancelado_hard ? ` (${tot.cancelado_sdd || 0} SDD · ${tot.cancelado_spot || 0} Spot)` : ""}`, porScTxt(listas.cancel)],
                ["   Otros", tot.no_salio_otro || 0, porScTxt(listas.otros)], ["   Sin respuesta", tot.sin_responder || 0, porScTxt(listas.sinResp)],
                ...((tot.pendiente || 0) > 0 ? [["   Pendientes de hoy", tot.pendiente, porScTxt(listas.pend)]] : []),
              ]} />
            </div>
          </div>
        );
      })()}

      {/* Compromisos con MELI */}
      <div style={{ ...caja, marginBottom: 14 }}>
        <button onClick={() => setVerCompromisos((v) => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: AZUL, fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <span>{verCompromisos ? "▼" : "▶"}</span> Compromisos con MELI
          <span style={{ fontSize: 11, fontWeight: 600, color: GRIS }}>{vigentes.length} vigentes · {vigentes.reduce((t, c) => t + c.cantidad, 0)} vehículos por día</span>
        </button>
        {verCompromisos && (<>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
            <label style={{ fontSize: 11, color: GRIS }}>Service Center<br /><select value={form.sc} onChange={(e) => setForm({ ...form, sc: e.target.value })} style={input}><option value="">Elige…</option>{scsForm.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label style={{ fontSize: 11, color: GRIS }}>Vehículo<br /><select value={form.vehiculo} onChange={(e) => setForm({ ...form, vehiculo: e.target.value })} style={input}><option value="">Elige…</option>{VEHICULOS.map((v) => <option key={v} value={v}>{v}</option>)}<option value="_otro">Otro</option></select></label>
            {form.vehiculo === "_otro" && <label style={{ fontSize: 11, color: GRIS }}>Cuál<br /><input value={form.vehiculoOtro} onChange={(e) => setForm({ ...form, vehiculoOtro: e.target.value })} style={input} /></label>}
            <label style={{ fontSize: 11, color: GRIS }}>Tipo<br /><span style={{ display: "flex", gap: 6 }}>{["SDD", "SPOT"].map((m) => <button key={m} type="button" style={boton(form.modelo === m)} onClick={() => setForm({ ...form, modelo: m })}>{m === "SPOT" ? "Spot" : m}</button>)}</span></label>
            <label style={{ fontSize: 11, color: GRIS }}>Vehículos por día<br /><input type="number" min="0" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} style={{ ...input, width: 90 }} /></label>
            <label style={{ fontSize: 11, color: GRIS }}>Desde<br /><input type="date" value={form.vigencia} onChange={(e) => setForm({ ...form, vigencia: e.target.value })} style={input} /></label>
            <label style={{ fontSize: 11, color: GRIS }}>Mail o minuta<br /><input ref={inputArchivo} type="file" accept=".pdf,.eml,.msg,image/*,.doc,.docx" onChange={(e) => setArchivo(e.target.files?.[0] || null)} style={{ fontSize: 12 }} /></label>
            <label style={{ fontSize: 11, color: GRIS, flex: "1 1 200px" }}>Nota<br /><input value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} style={{ ...input, width: "100%" }} /></label>
            <button type="button" onClick={guardarCompromiso} disabled={guardando} style={{ ...boton(true), background: NARANJA, padding: "9px 18px" }}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
          {msg && <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, fontSize: 12, background: msg.tipo === "ok" ? "#d1fae5" : "#fee2e2", color: msg.tipo === "ok" ? "#047857" : "#b91c1c" }}>{msg.texto}</div>}
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>SC</th><th style={th}>Vehículo</th><th style={th}>Tipo</th><th style={thC}>Por día</th><th style={th}>Vigencia</th><th style={th}>Mail o minuta</th><th style={th}>Cargó</th><th style={th}></th></tr></thead>
              <tbody>
                {vigentes.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{c.sc}</td><td style={td}>{c.vehiculo}</td><td style={td}>{c.modelo === "SPOT" ? "Spot" : c.modelo}</td>
                    <td style={{ ...tdC, fontWeight: 700 }}>{c.cantidad}</td>
                    <td style={td}>desde {fCorta(c.vigencia_desde)}{c.vigencia_hasta ? ` hasta ${fCorta(c.vigencia_hasta)}` : ""}</td>
                    <td style={td}><LinkEvidencia path={c.evidencia_path} nombre={c.evidencia_nombre} /></td>
                    <td style={{ ...td, color: GRIS }}>{c.cargado_por}<div style={{ fontSize: 10 }}>{fHora(c.cargado_at)}</div></td>
                    <td style={td}><button type="button" onClick={() => cerrarCompromiso(c)} style={{ ...boton(false), padding: "4px 10px", fontSize: 11 }}>Cerrar</button></td>
                  </tr>
                ))}
                {!vigentes.length && <tr><td colSpan={8} style={{ ...td, color: GRIS, textAlign: "center" }}>Sin compromisos cargados.</td></tr>}
              </tbody>
            </table>
          </div>
        </>)}
      </div>

      {/* Ranking por SC */}
      {!sc && porSc.length > 0 && (
        <div style={{ ...caja, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14, marginBottom: 8 }}>Por Service Center</div>
          <div style={{ maxHeight: 520, overflow: "auto", border: `1px solid ${BORDE}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead><tr>
              {[
                ["SC", "", "Service Center"],
                ["Comprometido", "c", "Vehículos SDD por día comprometidos con MELI (planilla de compromisos)"],
                ["Acordado", "c", "Vehículos SDD por día que MELI tiene registrados como acordados"],
                ["Solicitado", "c", "SDD pedidos por MELI + Spot aceptados"],
                ["Confirmado", "c", "Aceptados por BigTicket"],
                ["Asignado", "c", "Aceptados con placa y chofer en el rostering"],
                ["Ejecutado", "c", "Aceptados cuya ruta salió"],
                ["% Ejecutado", "c", "Ejecutado sobre confirmado"],
                ["No confirmadas SDD", "c", "SDD pedidos que no aceptamos: soft no show (MELI cobra 75%)"],
                ["No salió SDD", "c", "SDD aceptados con placa y chofer que no salieron: hard no show (MELI cobra 100%). Debajo, lo que cuenta MELI"],
                ["No salió Spot", "c", "Spot aceptados con placa y chofer que no salieron (MELI no cobra)"],
                ["No show", "c", "El supervisor respondió No Show en la Bitácora"],
                ["Cancelación", "c", "El supervisor respondió Cancelación en la Bitácora"],
                ["Otros", "c", "El supervisor respondió Otros"],
                ["Sin respuesta", "c", "No salió y el supervisor todavía no responde"],
                ["≠ MELI", "c", "Rutas SDD donde MELI y la Torre dicen distinto si salió o no"],
              ].map(([t, al, ayuda]) => <th key={t} title={ayuda} style={{ ...(al === "c" ? thC : th), color: t === "Acordado" ? NARANJA : GRIS, cursor: "help", position: "sticky", top: 0, zIndex: 2, background: "#f8fafc", borderBottom: `1px solid ${BORDE}` }}>{t}</th>)}
            </tr></thead>
            <tbody>
              {[...porSc].sort((a, b) => (b.no_salio_sdd + b.no_salio_spot + b.no_show_soft) - (a.no_salio_sdd + a.no_salio_spot + a.no_show_soft) || a.sc.localeCompare(b.sc)).map((x) => {
                const m = x.meli || {};
                const sobre = x.de_mas || 0;
                return (
                  <tr key={x.sc} onClick={() => setSc(x.sc)} style={{ cursor: "pointer" }}>
                    <td style={{ ...td, fontWeight: 700 }}>{x.sc}</td>
                    <td style={{ ...tdC, color: x.comprometido == null ? "#94a3b8" : "#334155", fontWeight: 700 }}>{x.comprometido ?? "—"}</td>
                    <td style={{ ...tdC, color: NARANJA, fontWeight: 700 }}>{m.acordado ?? "—"}{sobre > 0 && <div style={{ fontSize: 10, color: "#b91c1c" }}>+{sobre} pedidas de más</div>}</td>
                    <td style={tdC}><Dos brain={x.solicitado} meli={modelo === "SDD" ? m.solicitado : null} /></td>
                    <td style={tdC}><Dos brain={x.confirmado} meli={modelo === "SDD" ? m.confirmado : null} /></td>
                    <td style={tdC}><Dos brain={x.asignado} meli={modelo === "SDD" ? m.asignado : null} /></td>
                    <td style={tdC}><Dos brain={x.ejecutado} meli={modelo === "SDD" ? m.ejecutado : null} /></td>
                    <td style={{ ...tdC, fontWeight: 700, color: x.confirmado && x.ejecutado < x.confirmado ? "#b45309" : "#047857" }}>{pct(x.ejecutado, x.confirmado)}</td>
                    <td style={tdC}><Dos brain={x.no_show_soft} meli={m.soft} /></td>
                    <td style={tdC}><Dos brain={x.no_salio_sdd} meli={m.hard} /></td>
                    <td style={{ ...tdC, fontWeight: 700, color: x.no_salio_spot ? "#334155" : "#94a3b8" }}>{x.no_salio_spot || "—"}</td>
                    <td style={{ ...tdC, color: "#b91c1c", fontWeight: 700 }}>{x.no_show_hard || ""}</td>
                    <td style={{ ...tdC, color: "#b91c1c", fontWeight: 700 }}>{x.cancelado_hard || ""}</td>
                    <td style={tdC}>{x.no_salio_otro || ""}</td>
                    <td style={{ ...tdC, color: "#9f1239", fontWeight: 700 }}>{x.sin_responder || ""}</td>
                    <td style={{ ...tdC, color: "#b91c1c", fontWeight: 700 }}>{x.sdd?.difieren || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* No Salidas a Ruta · Bitácora */}
      {d1 === d2 && (
        <div style={{ ...caja, marginBottom: 14 }}>
          <button onClick={() => setVerBitacora((v) => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: AZUL, fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>
            <span>{verBitacora ? "▼" : "▶"}</span> No Salidas a Ruta · Bitácora
            <span style={{ fontSize: 11, fontWeight: 600, color: GRIS }}>{noSal.length} ruta{noSal.length === 1 ? "" : "s"} · {noSal.filter((x) => x.guardado_at).length} respondidas</span>
          </button>
          {verBitacora && (d1 < NOSAL_RUTAS_DESDE ? <div style={{ fontSize: 12, color: GRIS, marginTop: 8 }}>Sin ítem en la Bitácora para esta fecha.</div>
            : noSal.length === 0 ? <div style={{ fontSize: 12, color: GRIS, marginTop: 8 }}>Sin rutas sin salir.</div>
            : [...new Set(noSal.map((x) => x.sc))].sort().filter((s) => !sc || s === sc).map((s) => (
              <div key={s}><div style={{ fontWeight: 700, fontSize: 12.5, color: "#334155", marginTop: 12 }}>{s}</div><NoSalidasSC filas={noSal.filter((x) => x.sc === s)} fechaRuta={fCorta(d1)} /></div>
            )))}
        </div>
      )}

      {/* Detalle */}
      <div style={{ ...caja, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14 }}>Detalle {sc && <span style={{ color: GRIS, fontWeight: 400 }}>· {sc} <a href="#" onClick={(e) => { e.preventDefault(); setSc(""); }}>(ver todos)</a></span>}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ display: "flex", gap: 4 }}>
              <button type="button" onClick={() => setVistaMeli(false)} style={{ ...boton(!vistaMeli), padding: "6px 12px", fontSize: 12 }}>Vista Brain</button>
              <button type="button" onClick={() => setVistaMeli(true)} style={{ ...boton(vistaMeli), padding: "6px 12px", fontSize: 12, ...(vistaMeli ? { background: NARANJA } : {}) }}>Vista MELI</button>
            </span>
            <input placeholder="Placa, chofer, ruta, viaje, solicitud…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...input, width: 220 }} />
            <select value={ver} onChange={(e) => setVer(e.target.value)} style={input}>{VER.map(([k, t]) => <option key={k} value={k}>{t} ({filas.filter((f) => pasaVer(f, k)).length})</option>)}</select>
          </div>
        </div>
        {vistaMeli ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["Service Center", "Vehículo", "Transportista", "ID de Ruta", "Última actualización"].map((t) => <th key={t} style={th}>{t}</th>)}
              {["Solicitado", "Confirmado", "Asignado", "Ejecutado"].map((t) => <th key={t} style={{ ...thC, color: NARANJA }}>{t}</th>)}
              <th style={{ ...thC, color: AZUL }}>Torre</th>
            </tr></thead>
            <tbody>
              {visiblesMeli.map(({ fecha, d, b, torreSalio, meliSalio, difiere }, i) => (
                <tr key={`${d.route_id}-${d.vehicle_plate}-${i}`} style={{ background: difiere ? "#fff1f2" : "#fff" }}>
                  <td style={{ ...td, fontWeight: 700 }}>{d.service_center}<div style={{ fontSize: 10, color: GRIS, fontWeight: 400 }}>{fCorta(fecha)}</div></td>
                  <td style={td}>{d.vehicle}<br /><b>{d.vehicle_plate || ""}</b></td>
                  <td style={td}>{b && String(b.driver_id) === String(d.driver_id) ? b.chofer : ""}<br /><b>{d.driver_id || ""}</b></td>
                  <td style={{ ...td, fontWeight: 700 }}>{d.route_id || ""}</td>
                  <td style={{ ...td, color: GRIS }}>{d.last_update}</td>
                  {[d.requested, d.confirmed, d.rostered, d.executed].map((v, k) => <td key={k} style={{ ...tdC, fontWeight: 800, color: "#334155" }}>{v === "✓" ? "✓" : ""}</td>)}
                  <td style={{ ...tdC, fontSize: 11 }}>{!d.vehicle_plate ? "" : torreSalio
                    ? <span style={{ color: difiere ? "#b91c1c" : "#047857", fontWeight: 700 }}>salió{b?.id_ruta ? ` · ${b.id_ruta}` : ""}</span>
                    : <span style={{ color: difiere ? "#b91c1c" : "#b45309", fontWeight: 700 }}>no salió</span>}</td>
                </tr>
              ))}
              {!loading && visiblesMeli.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: GRIS }}>{meli.length ? "Sin filas para este filtro." : "Sin foto de MELI para esta fecha."}</td></tr>}
            </tbody>
          </table>
        ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Fecha</th><th style={th}>SC</th><th style={th}>Vehículo</th><th style={th}>Transportista</th><th style={th}>ID de Ruta</th>
            <th style={thC}>Confirmado</th><th style={thC}>Asignado</th><th style={thC}>Ejecutado</th><th style={{ ...thC, color: NARANJA }}>MELI</th><th style={th}>Resultado</th>
          </tr></thead>
          <tbody>
            {visibles.map((f, i) => {
              const conf = CONFIRMADO[f.confirmado] || ["#475569", "#f1f5f9"];
              const cat = CATEGORIA[f.categoria] || CATEGORIA.otro;
              const m = f.meli;
              const dif = m && m.ejecutada !== null && m.ejecutada !== !!f.ejecutado;
              return (
                <tr key={`${f.request_id}-${f.travel_id}-${i}`} style={{ background: dif ? "#fff7ed" : "#fff" }}>
                  <td style={{ ...td, color: GRIS }}>{fCorta(f.fecha)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{f.sc}</td>
                  <td style={td}>{f.vehiculo || "—"} <span style={{ color: GRIS }}>{f.modelo}</span><br /><b>{f.placa || ""}</b></td>
                  <td style={td}>{f.chofer || ""}<br /><b>{f.driver_id || ""}</b></td>
                  <td style={td}><b>{f.id_ruta || ""}</b><div style={{ fontSize: 10.5, color: GRIS, whiteSpace: "nowrap" }}>{f.travel_id && <>Viaje {f.travel_id}</>}{f.travel_id && f.request_id != null && " · "}{f.request_id != null && <>Solicitud {f.request_id}</>}</div></td>
                  <td style={tdC}>{f.confirmado ? <Pill t={f.confirmado} c={conf[0]} bg={conf[1]} /> : "—"}</td>
                  <td style={tdC}><Check v={f.asignado} /></td>
                  <td style={tdC}><Check v={f.ejecutado} />{f.salida_real && <div style={{ fontSize: 10, color: GRIS }}>{new Date(f.salida_real).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false })}</div>}</td>
                  <td style={{ ...tdC, fontSize: 11 }}>{!m ? <span style={{ color: "#cbd5e1" }}>{f.modelo === "SPOT" ? "" : "—"}</span> : m.ejecutada === null ? <span style={{ color: "#94a3b8" }}>sin registro</span>
                    : m.ejecutada ? <span style={{ color: dif ? "#b91c1c" : "#047857", fontWeight: 700 }}>ejecutada ✓</span> : <span style={{ color: dif ? "#b91c1c" : "#b45309", fontWeight: 700 }}>no ejecutada</span>}</td>
                  <td style={td}>
                    <Pill t={cat[0]} c={cat[1]} bg={cat[2]} />
                    {f.respondido_at && <div style={{ fontSize: 10.5, color: GRIS, marginTop: 3 }}>
                      {f.resultado_supervisor === "si_salio" ? "Sí salió" : f.resultado_supervisor === "no_show" ? "No Show" : f.resultado_supervisor === "cancelacion" ? "Cancelación" : f.resultado_supervisor === "otros" ? "Otros" : f.resultado_supervisor}
                      {f.etiqueta ? ` · ${etiquetaNosal(f.etiqueta)}` : ""}{" · "}{f.respondido_por || "supervisor"} · {fHora(f.respondido_at)}{f.pruebas ? ` · ${f.pruebas} prueba${f.pruebas > 1 ? "s" : ""}` : ""}
                      {f.comentario && <div style={{ color: "#334155", whiteSpace: "pre-wrap" }}>{f.comentario}</div>}
                    </div>}
                    {!f.respondido_at && f.categoria === "sin_responder" && <div style={{ fontSize: 10.5, color: "#9f1239", marginTop: 3 }}>Sin respuesta en la Bitácora</div>}
                  </td>
                </tr>
              );
            })}
            {!loading && visibles.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: GRIS }}>Sin viajes para este filtro.</td></tr>}
          </tbody>
        </table>
        )}
        {paginas > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12 }}>
            <button disabled={pagina === 1} onClick={() => setPagina(pagina - 1)} style={{ ...input, cursor: "pointer" }}>‹ Anterior</button>
            <span style={{ color: GRIS }}>Página {pagina} de {paginas} · {totalVista} {vistaMeli ? "filas MELI" : "viajes"}</span>
            <button disabled={pagina === paginas} onClick={() => setPagina(pagina + 1)} style={{ ...input, cursor: "pointer" }}>Siguiente ›</button>
          </div>
        )}
      </div>
    </div>
  );
}
