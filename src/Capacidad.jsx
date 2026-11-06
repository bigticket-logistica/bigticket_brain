// ═══════════════════════════════════════════════════════════════════════════
// Capacidad.jsx — Administración → Pagos → Capacidad.
//
// Réplica del reporte "Resumen de ejecución de rutas" de MELI con datos propios:
//   · fn_capacidad(desde, hasta) → una fila por pedido del rango (máx. 31 días), en
//     una sola llamada. Lee solo el rango pedido, nunca el histórico completo.
//   El embudo, las tarjetas y el ranking se suman aquí, y el modelo y el SC se
//   filtran en pantalla sin volver a consultar.
// Fuentes: mx_pedidos_estado (pedidos de MELI) × vw_torre_control_dia (Torre)
//          × bitacora_no_salidas_mx (respuesta del supervisor).
// Reglas (cuadradas contra MELI el 3-nov SDD):
//   Universo    = SDD completo + Spot aceptado (Spot no aceptado no cuenta)
//   Aceptados   = rostering del día cruzado con las rutas que salieron (misma lógica de la Torre)
//   Confirmado  = aceptados · Asignado = aceptados con chofer y placa
//   Ejecutado   = aceptados que salieron
//   Soft no show = SDD no aceptado (Solicitado − Confirmado)
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { descargarExcelMultihoja, fechaOperativaOffset, sb } from "./shared";
import { NoSalidasSC } from "./NoSalidas";

// Primeras rutas con el ítem "No Salidas a Ruta" en la Bitácora: las del 4-nov-2026 (se responden el 5).
const NOSAL_RUTAS_DESDE = "2026-11-04";

const AZUL = "#002E5D";
const GRIS = "#64748b";
const BORDE = "#e4e7ec";
const POR_PAGINA = 10;

const BARRAS = [
  ["solicitado", "Solicitado", "#93c5fd"],
  ["confirmado", "Confirmado", "#3b82f6"],
  ["asignado", "Asignado", "#1d4ed8"],
  ["ejecutado", "Ejecutado", "#059669"],
];

const CATEGORIA = {
  ejecutado: ["Ejecutado", "#047857", "#d1fae5"],
  pendiente: ["Pendiente", "#7c3aed", "#f3e8ff"],
  no_show_soft: ["No confirmada (soft no show)", "#b45309", "#fef3c7"],
  no_show_hard: ["No show (hard)", "#b91c1c", "#fee2e2"],
  cancelado_hard: ["Cancelación", "#b91c1c", "#fee2e2"],
  sin_responder: ["No salió · sin respuesta del supervisor", "#9f1239", "#ffe4e6"],
  otro: ["Otro", "#475569", "#f1f5f9"],
};

const CONFIRMADO = {
  Aceptado: ["#047857", "#d1fae5"],
  "No confirmado": ["#b45309", "#fef3c7"],
  "Sin responder": ["#7c3aed", "#f3e8ff"],
};

const VER = [
  ["todos", "Todos"],
  ["ejecutado", "Ejecutados"],
  ["no_ejecutado", "No ejecutados"],
  ["soft", "No confirmadas (soft no show)"],
  ["no_show_hard", "No show (hard)"],
  ["cancelado_hard", "Cancelación"],
  ["sin_responder", "No salió · sin respuesta del supervisor"],
  ["pendiente", "Pendientes"],
];

const pasaVer = (f, v) => {
  if (v === "todos") return true;
  if (v === "no_ejecutado") return !f.ejecutado;
  if (v === "soft") return f.categoria === "no_show_soft";
  return f.categoria === v;
};

const pct = (a, b) => (b ? Math.round((a * 100) / b) + "%" : "—");
const fCorta = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "");
const fHora = (v) => (v ? new Date(v).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const fLarga = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");

function Pill({ t, c, bg }) {
  return <span style={{ background: bg, color: c, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{t}</span>;
}

function Check({ v }) {
  return v ? <span style={{ color: "#047857", fontWeight: 800 }}>✓</span> : <span style={{ color: "#cbd5e1" }}>—</span>;
}

function Tarjeta({ titulo, total, sub, filas }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: "12px 14px", minWidth: 230, maxWidth: 300 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, fontWeight: 700, color: AZUL, fontSize: 13 }}>
        <span>{titulo}</span><span style={{ fontSize: 18, whiteSpace: "nowrap" }}>{total}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: GRIS, marginTop: 2 }}>{sub}</div>}
      {filas.length > 0 && <div style={{ borderTop: `1px solid ${BORDE}`, margin: "8px 0 4px" }} />}
      {filas.map(([t, v, ayuda]) => (
        <div key={t} title={ayuda} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: GRIS, padding: "3px 0",
          whiteSpace: "pre", ...(v === "" ? { fontSize: 11, fontWeight: 600, color: AZUL, marginTop: 6 } : {}) }}>
          <span>{t}</span><span style={{ fontWeight: 700, color: "#334155", whiteSpace: "nowrap" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// Totales con las mismas reglas que se cuadraron contra MELI.
function sumar(filas) {
  const t = { solicitado: filas.length, confirmado: 0, asignado: 0, ejecutado: 0, pendiente: 0,
    no_show_soft: 0, no_show_hard: 0, no_show_hard_sdd: 0, no_show_hard_spot: 0,
    cancelado_hard: 0, cancelado_sdd: 0, cancelado_spot: 0, sin_responder: 0, no_salio_sdd: 0, no_salio_spot: 0 };
  for (const f of filas) {
    const acept = f.confirmado === "Aceptado";
    const sdd = f.modelo === "SDD";
    if (acept) t.confirmado++;
    if (acept && f.asignado) t.asignado++;
    if (acept && f.ejecutado) t.ejecutado++;
    // Aceptada que no salió, según la Torre (sin esperar al supervisor)
    if (acept && !f.ejecutado && f.categoria !== "pendiente") { if (sdd) t.no_salio_sdd++; else t.no_salio_spot++; }
    if (f.categoria === "no_show_hard") { t.no_show_hard++; if (sdd) t.no_show_hard_sdd++; else t.no_show_hard_spot++; }
    else if (f.categoria === "cancelado_hard") { t.cancelado_hard++; if (sdd) t.cancelado_sdd++; else t.cancelado_spot++; }
    else if (t[f.categoria] !== undefined && f.categoria !== "ejecutado") t[f.categoria]++;
  }
  return t;
}

export default function Capacidad() {
  const ayer = fechaOperativaOffset(-1);
  // Lo que el usuario elige en los calendarios…
  const [fechaSel, setFechaSel] = useState(ayer);
  const [hastaSel, setHastaSel] = useState(ayer);
  const [esRango, setEsRango] = useState(false);
  // …y lo que realmente se consultó (solo cambia con Aplicar).
  const [aplicado, setAplicado] = useState({ d1: ayer, d2: ayer });
  const [segundos, setSegundos] = useState(null);
  const [esperando, setEsperando] = useState(0); // segundos que lleva la carga actual
  const ultimaPeticion = useRef(0);
  const [modelo, setModelo] = useState("");
  const [sc, setSc] = useState("");
  const [todas, setTodas] = useState([]);
  const [noSal, setNoSal] = useState([]);       // No Salidas a Ruta del día (fn_no_salidas_dia), solo cuando se consulta un día
  const [verBitacora, setVerBitacora] = useState(true);
  const [ver, setVer] = useState("todos");
  const [buscar, setBuscar] = useState("");
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const { d1, d2 } = aplicado;
  const fechasValidas = /^\d{4}-\d{2}-\d{2}$/.test(fechaSel) && (!esRango || /^\d{4}-\d{2}-\d{2}$/.test(hastaSel));
  const cargar = useCallback(async () => {
    // Si llegan dos respuestas, solo vale la de la última petición.
    const id = ++ultimaPeticion.current;
    const t0 = Date.now();
    setLoading(true); setError(null); setEsperando(0);
    const reloj = setInterval(() => setEsperando(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      // Una sola llamada por rango de fechas; modelo y SC se filtran en pantalla.
      // Tope de 40 s: si Supabase no responde, se muestra el error en vez de quedar "Cargando…".
      // Para un solo día se trae además el ítem "No Salidas a Ruta" de la Bitácora
      // (la misma tabla que ven el analista y el jefe en Consolidaciones Bitácora).
      const [r, ns] = await Promise.race([
        Promise.all([
          sb.rpc("fn_capacidad", { p_desde: d1, p_hasta: d2 }),
          d1 === d2 ? sb.rpc("fn_no_salidas_dia", { p_sc: null, p_fecha: d1 }) : Promise.resolve({ data: [] }),
        ]),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Supabase no respondió en 40 segundos")), 40000)),
      ]);
      if (id !== ultimaPeticion.current) return;
      if (r.error) throw new Error(`${r.error.message || r.error}${r.error.code ? ` (código ${r.error.code})` : ""}${r.error.hint ? ` · ${r.error.hint}` : ""}`);
      if (!Array.isArray(r.data)) throw new Error("Supabase respondió, pero no con una lista de viajes: " + JSON.stringify(r.data).slice(0, 200));
      setTodas(r.data);
      setNoSal(Array.isArray(ns?.data) ? ns.data : []);
      setSegundos(((Date.now() - t0) / 1000).toFixed(1));
    } catch (e) {
      console.error("Capacidad · fn_capacidad", d1, d2, e);
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
    // Si se aplica la misma fecha, igual vuelve a consultar.
    if (nuevo.d1 === aplicado.d1 && nuevo.d2 === aplicado.d2) cargar(); else setAplicado(nuevo);
  };


  const delModelo = useMemo(() => (modelo ? todas.filter((f) => f.modelo === modelo) : todas), [todas, modelo]);
  const filas = useMemo(() => (sc ? delModelo.filter((f) => f.sc === sc) : delModelo), [delModelo, sc]);
  const porSc = useMemo(() => {
    const g = {};
    for (const f of delModelo) if (f.sc) (g[f.sc] = g[f.sc] || []).push(f);
    return Object.entries(g).map(([k, v]) => ({ sc: k, ...sumar(v) }));
  }, [delModelo]);
  const listaSc = useMemo(() => [...new Set(todas.map((f) => f.sc).filter(Boolean))].sort(), [todas]);
  const tot = useMemo(() => sumar(filas), [filas]);
  // Al cambiar filtros o datos, vuelve a la primera página (va después de declarar filas).
  useEffect(() => { setPagina(1); }, [ver, buscar, filas]);
  const maxBarra = Math.max(1, ...BARRAS.map(([k]) => tot[k] || 0));

  const filtradas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((f) => pasaVer(f, ver) && (!q || [f.sc, f.placa, f.chofer, f.driver_id, f.id_ruta, f.travel_id, f.request_id, f.vehiculo]
      .some((x) => x && String(x).toLowerCase().includes(q))));
  }, [filas, ver, buscar]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const visibles = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const descargarExcel = async () => {
    setExcelBusy(true);
    try {
      const det = [["FECHA", "SC", "MODELO", "REQUEST ID", "TRAVEL ID", "VEHICULO", "PLACA", "CHOFER", "DRIVER ID", "ID RUTA",
        "CONFIRMADO", "ASIGNADO", "EJECUTADO", "ESTADO TORRE", "RESULTADO", "RESPUESTA SUPERVISOR", "RESPONDIDO POR", "RESPONDIDO EL", "PRUEBAS"]];
      for (const f of filtradas) det.push([f.fecha, f.sc, f.modelo, f.request_id ?? "", f.travel_id || "", f.vehiculo || "", f.placa || "",
        f.chofer || "", f.driver_id || "", f.id_ruta || "", f.confirmado || "", f.asignado ? "SI" : "NO", f.ejecutado ? "SI" : "NO",
        f.estado_torre || "", (CATEGORIA[f.categoria] || [f.categoria])[0], f.resultado_supervisor || "",
        f.respondido_por || "", f.respondido_at ? fHora(f.respondido_at) : "", f.pruebas || 0]);
      const res = [["SC", "SOLICITADO", "CONFIRMADO", "ASIGNADO", "EJECUTADO", "% EJECUTADO / CONFIRMADO", "SOFT NO SHOW",
"HARD NO SHOW SDD", "HARD NO SHOW SPOT", "CANCELACION SDD", "CANCELACION SPOT", "NO SALIO SIN CLASIFICAR", "PENDIENTE"]];
      for (const x of porSc) {
        if (sc && x.sc !== sc) continue;
        res.push([x.sc, x.solicitado, x.confirmado, x.asignado, x.ejecutado, pct(x.ejecutado, x.confirmado), x.no_show_soft,
          x.no_show_hard_sdd, x.no_show_hard_spot, x.cancelado_sdd, x.cancelado_spot, x.sin_responder, x.pendiente]);
      }
      await descargarExcelMultihoja([{ nombre: "Por SC", datos: res }, { nombre: "Detalle", datos: det }],
        `capacidad_${d1 === d2 ? d1 : d1 + "_a_" + d2}${modelo ? "_" + modelo : ""}${sc ? "_" + sc : ""}`);
    } catch (e) {
      alert("No se pudo generar el Excel: " + (e.message || e));
    } finally {
      setExcelBusy(false);
    }
  };

  const th = { padding: "8px 8px", fontSize: 10.5, color: GRIS, fontWeight: 600, textAlign: "left", whiteSpace: "nowrap", background: "#f8fafc" };
  const thC = { ...th, textAlign: "center" };
  const td = { padding: "7px 8px", fontSize: 11.5, verticalAlign: "middle", borderTop: `1px solid ${BORDE}` };
  const tdC = { ...td, textAlign: "center" };
  const input = { border: `1px solid ${BORDE}`, borderRadius: 8, padding: "6px 8px", fontSize: 12 };
  const caja = { background: "#fff", border: `1px solid ${BORDE}`, borderRadius: 10, padding: 14 };

  return (
    <div className="pg">
      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: GRIS }}>{esRango ? "Desde" : "Día"}<br />
          <input type="date" value={fechaSel} onChange={(e) => setFechaSel(e.target.value)} style={input} /></label>
        {esRango && <label style={{ fontSize: 11, color: GRIS }}>Hasta<br />
          <input type="date" value={hastaSel} onChange={(e) => setHastaSel(e.target.value)} style={input} /></label>}
        <label style={{ fontSize: 11, color: GRIS, display: "flex", alignItems: "center", gap: 4, paddingBottom: 7 }}>
          <input type="checkbox" checked={esRango} onChange={(e) => { setEsRango(e.target.checked); if (e.target.checked && hastaSel < fechaSel) setHastaSel(fechaSel); }} /> Rango
        </label>
        <button onClick={aplicar} disabled={!fechasValidas}
          style={{ ...input, background: AZUL, color: "#fff", border: "none", cursor: "pointer", fontWeight: 600 }}>Aplicar</button>
        <label style={{ fontSize: 11, color: GRIS }}>Modelo de contratación<br />
          <select value={modelo} onChange={(e) => setModelo(e.target.value)} style={input}>
            <option value="">Todos</option><option value="SDD">SDD</option><option value="SPOT">Spot</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: GRIS }}>Service Center<br />
          <select value={sc} onChange={(e) => setSc(e.target.value)} style={input}>
            <option value="">Todos</option>
            {listaSc.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button onClick={cargar} disabled={loading} style={{ ...input, background: "#fff", cursor: "pointer" }}>↻ Actualizar</button>
        <button onClick={descargarExcel} disabled={excelBusy || loading}
          style={{ ...input, background: "#fff", cursor: "pointer", fontWeight: 600 }}>
          {excelBusy ? "Generando…" : "⬇ Descargar Excel"}
        </button>
      </div>
      {/* Qué está mostrando la pantalla: evita confundir lo elegido con lo cargado */}
      <div style={{ fontSize: 12, color: "#334155", marginBottom: 12 }}>
        Mostrando <b>{d1 === d2 ? fLarga(d1) : `${fLarga(d1)} al ${fLarga(d2)}`}</b>
        {modelo ? ` · ${modelo === "SDD" ? "SDD" : "Spot"}` : " · SDD y Spot"}{sc ? ` · ${sc}` : ""}
        {!loading && <span style={{ color: GRIS }}> · {todas.length} viajes{segundos ? ` · cargado en ${segundos} s` : ""}</span>}
        {(fechaSel !== d1 || (esRango ? hastaSel : fechaSel) !== d2) && <span style={{ color: "#b45309", fontWeight: 600 }}> · cambiaste la fecha: presiona Aplicar</span>}
      </div>

      {error && <div style={{ background: "#fee2e2", color: "#b91c1c", padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
        <b>No se pudo cargar {d1 === d2 ? d1 : `${d1} al ${d2}`}:</b> {error}
      </div>}
      {loading && <div style={{ color: GRIS, fontSize: 12, marginBottom: 12 }}>Consultando fn_capacidad({d1}, {d2})… {esperando} s</div>}

      {/* Embudo + tarjetas */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ ...caja, flex: "1 1 520px" }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14, marginBottom: 10 }}>Resumen de ejecución de rutas</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", height: 180, borderBottom: `1px solid ${BORDE}` }}>
            {BARRAS.map(([k, t, color]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", width: 70 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 4 }}>{tot[k] || 0}</div>
                <div style={{ width: 28, height: `${((tot[k] || 0) / maxBarra) * 150}px`, background: color, borderRadius: "4px 4px 0 0", minHeight: 2 }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 6 }}>
            {BARRAS.map(([k, t]) => (
              <div key={k} style={{ width: 70, textAlign: "center", fontSize: 11, color: GRIS }}>
                {t}<br /><b style={{ color: "#334155", fontSize: 12 }}>{tot[k] || 0}</b>
                {k !== "solicitado" && <div style={{ fontSize: 10 }}>{pct(tot[k] || 0, tot.solicitado || 0)}</div>}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Tarjeta titulo="No show SDD" total={(tot.no_show_soft || 0) + (tot.no_salio_sdd || 0)} filas={[
            ["Soft · no confirmadas", tot.no_show_soft || 0, "Pedidos SDD que MELI solicitó y no aceptamos"],
            ["Hard · aceptadas que no salieron", tot.no_salio_sdd || 0, "SDD con placa y chofer cuya ruta no salió"],
          ]} />
          <Tarjeta titulo="Aceptadas que no salieron" total={`${(tot.no_salio_sdd || 0) + (tot.no_salio_spot || 0)} de ${tot.confirmado || 0}`} filas={[
            ["SDD", tot.no_salio_sdd || 0, "SDD aceptada que no se hizo: MELI la cobra como hard no show"],
            ["Spot", tot.no_salio_spot || 0, "Spot aceptada que no se hizo"],
            ["Respuesta del supervisor (Bitácora)", "", ""],
            ["   No show", `${tot.no_show_hard || 0}${tot.no_show_hard ? ` (${tot.no_show_hard_sdd || 0} SDD · ${tot.no_show_hard_spot || 0} Spot)` : ""}`, "El supervisor marcó No Show"],
            ["   Cancelación", `${tot.cancelado_hard || 0}${tot.cancelado_hard ? ` (${tot.cancelado_sdd || 0} SDD · ${tot.cancelado_spot || 0} Spot)` : ""}`, "El supervisor marcó Cancelación"],
            ["   Sin respuesta", tot.sin_responder || 0, "Esperan la respuesta en la Bitácora (ítem No Salidas a Ruta, viajes desde el 4-nov-2026)"],
            ...((tot.pendiente || 0) > 0 ? [["Pendientes de hoy (todavía pueden salir)", tot.pendiente, ""]] : []),
          ]} />
        </div>
      </div>

      {/* Ranking por SC */}
      {!sc && porSc.length > 0 && (
        <div style={{ ...caja, marginBottom: 14, overflowX: "auto" }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14, marginBottom: 8 }}>Ranking por Service Center</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>SC</th><th style={thC}>Solicitado</th><th style={thC}>Confirmado</th><th style={thC}>Asignado</th>
              <th style={thC}>Ejecutado</th><th style={thC}>% Ejecutado</th><th style={thC}>No confirmadas</th><th style={thC}>No show</th>
              <th style={thC}>Cancelación</th><th style={thC}>Sin respuesta</th>
            </tr></thead>
            <tbody>
              {[...porSc].sort((a, b) => (b.no_show_hard + b.no_show_soft + b.cancelado_hard + b.sin_responder)
                - (a.no_show_hard + a.no_show_soft + a.cancelado_hard + a.sin_responder) || a.sc.localeCompare(b.sc)).map((x) => (
                <tr key={x.sc} onClick={() => setSc(x.sc)} style={{ cursor: "pointer" }} title="Ver solo este SC">
                  <td style={{ ...td, fontWeight: 700 }}>{x.sc}</td>
                  <td style={tdC}>{x.solicitado}</td><td style={tdC}>{x.confirmado}</td><td style={tdC}>{x.asignado}</td>
                  <td style={tdC}>{x.ejecutado}</td>
                  <td style={{ ...tdC, fontWeight: 700, color: x.confirmado && x.ejecutado < x.confirmado ? "#b45309" : "#047857" }}>{pct(x.ejecutado, x.confirmado)}</td>
                  <td style={tdC}>{x.no_show_soft || ""}</td>
                  <td style={{ ...tdC, color: "#b91c1c", fontWeight: 700 }}>{x.no_show_hard || ""}</td>
                  <td style={{ ...tdC, color: "#b91c1c", fontWeight: 700 }}>{x.cancelado_hard || ""}</td>
                  <td style={{ ...tdC, color: "#9f1239", fontWeight: 700 }}>{x.sin_responder || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No Salidas a Ruta: lo que respondió cada supervisor en la Bitácora (misma tabla que Consolidaciones Bitácora) */}
      {d1 === d2 && (
        <div style={{ ...caja, marginBottom: 14 }}>
          <button onClick={() => setVerBitacora((v) => !v)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: AZUL, fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>
            <span>{verBitacora ? "▼" : "▶"}</span> No Salidas a Ruta · respuesta del supervisor en la Bitácora
            <span style={{ fontSize: 11, fontWeight: 600, color: GRIS }}>
              {noSal.length} ruta{noSal.length === 1 ? "" : "s"} · {noSal.filter((x) => x.guardado_at).length} respondidas
            </span>
          </button>
          {verBitacora && (d1 < NOSAL_RUTAS_DESDE ? (
            <div style={{ fontSize: 12, color: GRIS, marginTop: 8 }}>Este ítem existe en la Bitácora para viajes desde el 4-nov-2026.</div>
          ) : noSal.length === 0 ? (
            <div style={{ fontSize: 12, color: GRIS, marginTop: 8 }}>Ese día no hubo rutas sin salir.</div>
          ) : (
            [...new Set(noSal.map((x) => x.sc))].sort().filter((s) => !sc || s === sc).map((s) => (
              <div key={s}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: "#334155", marginTop: 12 }}>{s}</div>
                <NoSalidasSC filas={noSal.filter((x) => x.sc === s)} fechaRuta={fCorta(d1)} />
              </div>
            ))
          ))}
        </div>
      )}

      {/* Detalle por estado */}
      <div style={{ ...caja, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: AZUL, fontSize: 14 }}>Detalle por estado {sc && <span style={{ color: GRIS, fontWeight: 400 }}>· {sc} <a href="#" onClick={(e) => { e.preventDefault(); setSc(""); }}>(ver todos)</a></span>}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Filtrar: placa, chofer, ruta, viaje, solicitud…" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...input, width: 200 }} />
            <select value={ver} onChange={(e) => setVer(e.target.value)} style={input}>
              {VER.map(([k, t]) => <option key={k} value={k}>Ver servicios: {t} ({filas.filter((f) => pasaVer(f, k)).length})</option>)}
            </select>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Fecha</th><th style={th}>Service Center</th><th style={th}>Vehículo</th><th style={th}>Transportista</th>
            <th style={th}>ID de Ruta</th><th style={thC}>Confirmado</th><th style={thC}>Asignado</th><th style={thC}>Ejecutado</th><th style={th}>Resultado</th>
          </tr></thead>
          <tbody>
            {visibles.map((f, i) => {
              const conf = CONFIRMADO[f.confirmado] || ["#475569", "#f1f5f9"];
              const cat = CATEGORIA[f.categoria] || CATEGORIA.otro;
              return (
                <tr key={`${f.request_id}-${f.travel_id}-${i}`}>
                  <td style={{ ...td, color: GRIS }}>{fCorta(f.fecha)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{f.sc}</td>
                  <td style={td}>{f.vehiculo || "—"} <span style={{ color: GRIS }}>{f.modelo}</span><br /><b>{f.placa || ""}</b></td>
                  <td style={td}>{f.chofer || ""}<br /><b>{f.driver_id || ""}</b></td>
                  <td style={td}>
                    <b>{f.id_ruta || ""}</b>
                    <div style={{ fontSize: 10.5, color: GRIS, whiteSpace: "nowrap" }}>
                      {f.travel_id && <>Viaje {f.travel_id}</>}{f.travel_id && f.request_id != null && " · "}{f.request_id != null && <>Solicitud {f.request_id}</>}
                    </div>
                  </td>
                  <td style={tdC}>{f.confirmado ? <Pill t={f.confirmado} c={conf[0]} bg={conf[1]} /> : "—"}</td>
                  <td style={tdC}><Check v={f.asignado} /></td>
                  <td style={tdC}><Check v={f.ejecutado} /></td>
                  <td style={td}>
                    <Pill t={cat[0]} c={cat[1]} bg={cat[2]} />
                    {f.respondido_at && <div style={{ fontSize: 10.5, color: GRIS, marginTop: 3 }}>
                      {f.resultado_supervisor === "si_salio" ? "Sí salió" : f.resultado_supervisor === "no_show" ? "No Show" : f.resultado_supervisor === "cancelacion" ? "Cancelación" : f.resultado_supervisor}
                      {" · "}{f.respondido_por || "supervisor"} · {fHora(f.respondido_at)}{f.pruebas ? ` · ${f.pruebas} prueba${f.pruebas > 1 ? "s" : ""}` : ""}
                    </div>}
                    {!f.respondido_at && f.categoria === "sin_responder" && <div style={{ fontSize: 10.5, color: "#9f1239", marginTop: 3 }}>Sin respuesta en la Bitácora</div>}
                  </td>
                </tr>
              );
            })}
            {!loading && visibles.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: GRIS }}>Sin servicios para este filtro.</td></tr>}
          </tbody>
        </table>
        {paginas > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12 }}>
            <button disabled={pagina === 1} onClick={() => setPagina(pagina - 1)} style={{ ...input, cursor: "pointer" }}>‹ Anterior</button>
            <span style={{ color: GRIS }}>Página {pagina} de {paginas} · {filtradas.length} servicios</span>
            <button disabled={pagina === paginas} onClick={() => setPagina(pagina + 1)} style={{ ...input, cursor: "pointer" }}>Siguiente ›</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: GRIS, marginTop: 10 }}>
        Fuente: fn_capacidad (solo el rango pedido, máx. 31 días) · SDD completo + Spot aceptado · meli_rostering_planificado × rutas_monitoreo_mx (misma lógica de la Torre) + mx_pedidos_estado (SDD no confirmados)
        + bitacora_no_salidas_mx (respuesta del supervisor). Acordado y Escaneado no se muestran todavía.
      </div>
    </div>
  );
}
