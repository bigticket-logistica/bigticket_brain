import { useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, fechaHoyOperativa, sb } from "./shared";

// ═══════════════════════════════════════════════════════════════════
//  RECHAZOS MELI · historial de rutas no aceptadas (no show soft) por mes, día y SC
//  Fuente: mx_pedidos_estado (proceso pedidos-watch cada 5 min + carga histórica desde 01-08-2026)
// ═══════════════════════════════════════════════════════════════════
const RM_INICIO = "2026-08";
// Tarifa base por ruta (rango 0–100 km) según el detalle de prefactura de MELI, por SC y vehículo.
// Multas MELI (validado con la prefactura 202609Q2 = $187.897,50): SDD soft 75% de la tarifa, SDD hard 100%; Spot sin multa.
const RM_TARIFA = {
  "SCY1|Large Van MLP SDD": 2500, "SCY1|Large Van MLP": 2510, "SCY1|Small Van MLP": 2260,
  "SHP1|Large Van MLP SDD": 2500, "SHP1|Small Van MLP SDD": 2250, "SHP1|Large Van MLP": 2510, "SHP1|Small Van MLP": 2260,
  "SMX1|Large Van MLP": 2510,
  "SMX7|Small Van MLP SDD": 2320,
  "SMX8|Large Van MLP SDD": 2500, "SMX8|Large Van MLP": 2510, "SMX8|Small Van MLP": 2260,
  "SMX10|Large Van MLP SDD": 2500, "SMX10|Small Van MLP": 2260, "SMX10|Car MLP": 1585,
  "SMXRV1|Small Van MLP": 2260,
  "SPY1|Large Van MLP": 2650, "SPY1|Small Van MLP": 2400, "SPY1|Car MLP": 1705,
  "SQR1|Large Van MLP SDD": 2570, "SQR1|Small Van MLP SDD": 2320, "SQR1|Large Van MLP": 2580, "SQR1|Small Van MLP": 2330,
  "STL1|Large Van MLP SDD": 2500, "STL1|Small Van MLP SDD": 2250, "STL1|Large Van MLP": 2510, "STL1|Small Van MLP": 2260,
  "STX1|Small Van MLP SDD": 2320, "STX1|Large Van MLP": 2780,
  "SVH1|Large Van MLP SDD": 2640, "SVH1|Small Van MLP SDD": 2390, "SVH1|Large Van MLP": 2650, "SVH1|Small Van MLP": 2400,
};
const RM_TARIFA_DEF = { "Large Van MLP SDD": 2500, "Small Van MLP SDD": 2320, "Large Van MLP": 2510, "Small Van MLP": 2260, "Car MLP": 1585 };
const rmTarifa = p => RM_TARIFA[`${p.facility_id}|${p.vehiculo}`] ?? RM_TARIFA_DEF[p.vehiculo] ?? (p.es_sdd ? 2500 : 2260);
const RM_PCT_SOFT = 0.75, RM_PCT_HARD = 1.0;
// Lo que MELI cobró de verdad por no show, por quincena (de la prefactura), para comparar
const RM_MULTA_REAL = { "202609Q1": 239837.5, "202609Q2": 187897.5 };
const rmPesos = v => "$" + Math.round(v || 0).toLocaleString("es-MX");
const RM_MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const RM_DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const RM_NAVY = "#1a3a6b", RM_ORANGE = "#F47B20", RM_MUTED = "#5b6474", RM_BORDER = "#e4e7ec";

function rmBase() { return { total: 0, cancel: 0, acept: 0, rech: 0, venc: 0, pend: 0, na_sdd: 0, na_spot: 0, ef_sdd: 0, ef_spot: 0, hard_sdd: 0, hard_spot: 0, ss_sdd: 0, ss_spot: 0 }; }
function rmSumar(b, p) {
  b.total++;
  if (p.status === "canceled") { b.cancel++; return; }
  if (p.es_sdd) b.ef_sdd++; else b.ef_spot++;
  if (p.status === "accepted") {
    b.acept++;
    if (p.fecha_ruta < fechaHoyOperativa()) {
      if (p.rosterizado === false) { p.es_sdd ? b.hard_sdd++ : b.hard_spot++; }
      else if (p.rosterizado === true && p.travel_status_final === "created" && p.salio_meli !== true) { p.es_sdd ? b.ss_sdd++ : b.ss_spot++; }
    }
  }
  else if (p.status === "rejected") { b.rech++; p.es_sdd ? b.na_sdd++ : b.na_spot++; }
  else if (p.status === "expired") { b.venc++; p.es_sdd ? b.na_sdd++ : b.na_spot++; }
  else if (p.status === "pending") b.pend++;
}
const rmEfect = b => b.total - b.cancel;
const rmNoAcept = b => b.rech + b.venc;
const rmAR = b => (rmEfect(b) - b.pend) > 0 ? b.acept / (rmEfect(b) - b.pend) : null;
const rmPct = v => v == null ? "—" : (v * 100).toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const rmN = v => Number(v || 0).toLocaleString("es-MX");

// ─── Fuente única de rutas no aceptadas y no hechas (la usan Rechazos MELI y el Vendor Score) ───
export const RM_EXCLUIR = ["SMXRV1"];
export async function rmCargarDatos(desde, hasta) {
    const todas = [];
    for (let pag = 0; ; pag += 1000) {
      const { data, error: e } = await sb.from("mx_pedidos_estado").select("request_id, travel_id, facility_id, fecha_ruta, status, es_sdd, vehiculo, tipo, eta, creado_meli, rosterizado, placa, chofer, travel_status_final, ultima_captura")
        .gte("fecha_ruta", desde).lte("fecha_ruta", hasta).order("request_id").range(pag, pag + 999);
      if (e) throw e;
      todas.push(...(data || []).filter(x => !RM_EXCLUIR.includes(x.facility_id)));
      if (!data || data.length < 1000) break;
    }
    const { data: rev } = await sb.from("mx_hard_revision").select("*").gte("fecha_ruta", desde).lte("fecha_ruta", hasta);
    // Cruce con MELI: rutas ejecutadas (informe de rutas) y hard oficial por SC y día (confirmadas − ejecutadas)
    const { data: ejec } = await sb.from("vs_rutas_ejecutadas").select("fecha, svc, route_id, placa, placa_norm, chofer, chofer_norm").gte("fecha", desde).lte("fecha", hasta).limit(20000);
    const { data: fotos } = await sb.from("vs_foto_svc").select("fecha, svc, capturado_el, conf_sdd, ejec_sdd, conf_spot, ejec_spot").gte("fecha", desde).lte("fecha", hasta).limit(20000);
    const conDatos = new Set((ejec || []).map(r => r.fecha));
    const porPlaca = new Map(), porChofer = new Map();
    for (const r of ejec || []) {
      if (r.placa_norm) porPlaca.set(`${r.fecha}|${r.svc}|${r.placa_norm}`, r);
      if (r.chofer_norm) porChofer.set(`${r.fecha}|${r.svc}|${r.chofer_norm}`, r);
    }
    const ultimaFoto = {};
    for (const f of fotos || []) { const k = f.fecha + "|" + f.svc; if (!ultimaFoto[k] || f.capturado_el > ultimaFoto[k].capturado_el) ultimaFoto[k] = f; }
    const normPlaca = x => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^SDD/, "");
    const normNombre = x => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    for (const p of todas) {
      if (p.status !== "accepted" || p.rosterizado !== true) continue;
      const k = `${p.fecha_ruta}|${p.facility_id}`;
      const m = porPlaca.get(`${k}|${normPlaca(p.placa)}`) || porChofer.get(`${k}|${normNombre(p.chofer)}`);
      p.salio_meli = conDatos.has(p.fecha_ruta) ? !!m : null;
      p.ruta_meli = m ? m.route_id : null;
      const f = ultimaFoto[k];
      p.hard_meli_sc = f ? (p.es_sdd ? (f.conf_sdd || 0) - (f.ejec_sdd || 0) : (f.conf_spot || 0) - (f.ejec_spot || 0)) : null;
    }
    // Candidatas a no show del Brain por SC, día y modelo: sin placa ni chofer + asignadas sin salir sin ruta en MELI
    const hoyOp = fechaHoyOperativa();
    const esCandidata = p => p.status === "accepted" && p.fecha_ruta < hoyOp &&
      (p.rosterizado === false || (p.rosterizado === true && p.travel_status_final === "created" && p.salio_meli !== true));
    const nGrupo = {};
    for (const p of todas) if (esCandidata(p)) { const g = `${p.fecha_ruta}|${p.facility_id}|${p.es_sdd}`; nGrupo[g] = (nGrupo[g] || 0) + 1; }
    for (const p of todas) {
      if (!esCandidata(p)) continue;
      const g = `${p.fecha_ruta}|${p.facility_id}|${p.es_sdd}`;
      if (p.hard_meli_sc == null) {
        const f = ultimaFoto[`${p.fecha_ruta}|${p.facility_id}`];
        p.hard_meli_sc = f ? (p.es_sdd ? (f.conf_sdd || 0) - (f.ejec_sdd || 0) : (f.conf_spot || 0) - (f.ejec_spot || 0)) : null;
      }
      const n = nGrupo[g], m = p.hard_meli_sc;
      p.cmp_meli = m == null ? { txt: "Sin dato de MELI", color: RM_MUTED }
        : n === m ? { txt: `Coincide con MELI ✅ (${m} de ${n})`, color: "#15803d" }
        : n > m ? { txt: `MELI reconoce ${m} de ${n} · sobran ${n - m}: cancelación o cambio de MELI`, color: "#b45309" }
        : { txt: `MELI cuenta ${m}; el Brain tiene ${n}`, color: RM_MUTED };
    }
    return { filas: todas, revisiones: Object.fromEntries((rev || []).map(r => [String(r.request_id), r])) };
}

// Cada ruta perdida con su multa e ingreso: soft = rechazada o vencida; hard = aceptada que no salió (días cerrados),
// sin las marcadas por el analista como cancelada o salió, y sin pasar del no show oficial de MELI por SC, día y modelo
export function rmPerdidas(filas, revisiones, hoyOp = fechaHoyOperativa()) {
  const items = [];
  const sumar = (p, tipo) => {
    const t = rmTarifa(p);
    items.push({ p, tipo, multa: p.es_sdd ? t * (tipo === "soft" ? RM_PCT_SOFT : RM_PCT_HARD) : 0, ingreso: t });
  };
  for (const p of filas) if (p.status === "rejected" || p.status === "expired") sumar(p, "soft");
  const grupos = {};
  for (const p of filas) {
    if (p.status !== "accepted" || p.fecha_ruta >= hoyOp) continue;
    const cand = p.rosterizado === false || (p.rosterizado === true && p.travel_status_final === "created" && p.salio_meli !== true);
    if (!cand) continue;
    const rv = revisiones[String(p.request_id)]?.resultado;
    if (rv === "cancelada_meli" || rv === "salio") continue;
    const g = `${p.fecha_ruta}|${p.facility_id}|${p.es_sdd}`;
    (grupos[g] = grupos[g] || []).push(p);
  }
  for (const lista of Object.values(grupos)) {
    const m = lista[0].hard_meli_sc;
    const tope = m == null ? lista.length : Math.min(lista.length, Math.max(0, m));
    lista.sort((a, b) => (revisiones[String(b.request_id)]?.resultado === "no_show") - (revisiones[String(a.request_id)]?.resultado === "no_show"));
    lista.slice(0, tope).forEach(p => sumar(p, "hard"));
  }
  return items;
}

// Resumen para el Vendor Score: misma fuente y mismas reglas que Rechazos MELI
export async function rmResumenPerdidas(desde, hasta) {
  const { filas, revisiones } = await rmCargarDatos(desde, hasta);
  const d = { softSdd: 0, softSpot: 0, hardSdd: 0, hardSpot: 0, multaAR: 0, multaER: 0, ingresoAR: 0, ingresoER: 0 };
  for (const x of rmPerdidas(filas, revisiones)) {
    if (x.tipo === "soft") { x.p.es_sdd ? d.softSdd++ : d.softSpot++; d.multaAR += x.multa; d.ingresoAR += x.ingreso; }
    else { x.p.es_sdd ? d.hardSdd++ : d.hardSpot++; d.multaER += x.multa; d.ingresoER += x.ingreso; }
  }
  return d;
}

function RechazosMeliMX({ usuario }) {
  const hoy = fechaHoyOperativa();
  const mesActual = hoy.slice(0, 7);
  const [mes, setMes] = useState(mesActual);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [diaSel, setDiaSel] = useState(null);
  const [detalle, setDetalle] = useState(null); // tarjeta abierta
  const [revisiones, setRevisiones] = useState({}); // request_id → revisión del analista

  const meses = useMemo(() => {
    const out = []; let [y, m] = RM_INICIO.split("-").map(Number);
    const [yf, mf] = mesActual.split("-").map(Number);
    while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }, [mesActual]);
  const finMes = (() => { const [y, m] = mes.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
  const hastaVista = mes === mesActual ? hoy : finMes;

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true); setError(null); setDiaSel(null); setDetalle(null);
      try {
        const { filas: todas, revisiones: revMap } = await rmCargarDatos(mes + "-01", hastaVista);
        if (vivo) { setFilas(todas); setRevisiones(revMap); }
      } catch (e) { if (vivo) setError(e.message || String(e)); }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [mes, hastaVista]);

  const { total, dias, svcs } = useMemo(() => {
    const t = rmBase(), porDia = {}, porSvc = {};
    for (const p of filas) {
      rmSumar(t, p);
      rmSumar(porDia[p.fecha_ruta] = porDia[p.fecha_ruta] || rmBase(), p);
      if (!diaSel || p.fecha_ruta === diaSel) rmSumar(porSvc[p.facility_id] = porSvc[p.facility_id] || rmBase(), p);
    }
    const listaDias = [];
    for (let d = mes + "-01"; d <= hastaVista; ) {
      listaDias.push({ fecha: d, ...(porDia[d] || rmBase()) });
      const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); d = x.toISOString().slice(0, 10);
    }
    const totNA = Object.values(porSvc).reduce((a, b) => a + rmNoAcept(b), 0);
    const listaSvc = Object.entries(porSvc).map(([svc, b]) => ({ svc, ...b, na: rmNoAcept(b), share: totNA ? rmNoAcept(b) / totNA : 0 }))
      .sort((a, b) => b.na - a.na || rmEfect(b) - rmEfect(a));
    return { total: t, dias: listaDias, svcs: listaSvc };
  }, [filas, diaSel, mes, hastaVista]);

  const maxNA = Math.max(1, ...dias.map(d => rmNoAcept(d)));

  // ─── Lo que perdimos: multas MELI + ingreso que dejamos de ganar, acumulado día a día ───
  const costos = useMemo(() => {
    const hoyOp = fechaHoyOperativa();
    const porDia = {}, porSvc = {}, porQ = {};
    const dia = f => (porDia[f] = porDia[f] || { multa: 0, ingreso: 0, n: 0 });
    const svc = c => (porSvc[c] = porSvc[c] || { svc: c, soft: 0, hard: 0, multa: 0, ingreso: 0 });
    const q = f => { const k = `${f.slice(0, 4)}${f.slice(5, 7)}Q${Number(f.slice(8, 10)) <= 15 ? 1 : 2}`; return (porQ[k] = porQ[k] || { q: k, soft: 0, hard: 0, multa: 0, ingreso: 0 }); };
    const sumar = (x) => {
      for (const b of [dia(x.p.fecha_ruta), svc(x.p.facility_id), q(x.p.fecha_ruta)]) { b.multa += x.multa; b.ingreso += x.ingreso; b[x.tipo] = (b[x.tipo] || 0) + 1; b.n = (b.n || 0) + 1; }
    };
    for (const x of rmPerdidas(filas, revisiones, hoyOp)) sumar(x);
    // Serie acumulada del mes
    let acM = 0, acI = 0;
    const serie = dias.map(d => { const x = porDia[d.fecha] || { multa: 0, ingreso: 0, n: 0 }; acM += x.multa; acI += x.ingreso; return { fecha: d.fecha, multa: x.multa, ingreso: x.ingreso, n: x.n, acMulta: acM, acIngreso: acI }; });
    const total = { multa: acM, ingreso: acI, rutas: serie.reduce((a, x) => a + x.n, 0) };
    const ultimo = [...serie].reverse().find(x => x.fecha < hoyOp && x.n > 0) || null;
    const diasMes = Number(finMes.slice(8, 10)), diasTransc = dias.filter(d => d.fecha < hoyOp).length || 1;
    const proy = mes === mesActual ? { multa: (acM / diasTransc) * diasMes, ingreso: (acI / diasTransc) * diasMes } : null;
    return { total, serie, ultimo, proy, svcs: Object.values(porSvc).sort((a, b) => (b.multa + b.ingreso) - (a.multa + a.ingreso)), quincenas: Object.values(porQ).sort((a, b) => a.q.localeCompare(b.q)) };
  }, [filas, revisiones, dias, mes, mesActual, finMes]);
  const card = { background: "#fff", border: `1px solid ${RM_BORDER}`, borderRadius: 12, padding: "18px 22px" };
  const etiquetaMes = m => `${RM_MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const idx = meses.indexOf(mes);

  const descargar = async () => {
    const diario = [["Fecha", "Día", "Efectivas", "Aceptadas", "Rechazadas", "Vencidas sin responder", "No aceptadas SDD", "No aceptadas Spot", "No aceptadas total", "Canceladas MELI", "AR", "Hard SDD", "Hard Spot"]];
    for (const d of dias) diario.push([d.fecha, RM_DIAS[new Date(d.fecha + "T12:00:00Z").getUTCDay()], rmEfect(d), d.acept, d.rech, d.venc, d.na_sdd, d.na_spot, rmNoAcept(d), d.cancel, rmAR(d) == null ? "" : Number((rmAR(d) * 100).toFixed(1)), d.hard_sdd, d.hard_spot]);
    const ranking = [["#", "SC", "Efectivas", "Aceptadas", "No aceptadas SDD", "No aceptadas Spot", "No aceptadas total", "AR", "% del total", "Hard SDD", "Hard Spot"]];
    svcs.forEach((s, i) => ranking.push([i + 1, s.svc, rmEfect(s), s.acept, s.na_sdd, s.na_spot, s.na, rmAR(s) == null ? "" : Number((rmAR(s) * 100).toFixed(1)), Number((s.share * 100).toFixed(1)), s.hard_sdd, s.hard_spot]));
    const detalle = [["Fecha ruta", "SC", "Modelo", "Estado", "Vehículo", "Tipo", "Request ID"]];
    for (const p of filas.filter(x => x.status === "rejected" || x.status === "expired").sort((a, b) => a.fecha_ruta.localeCompare(b.fecha_ruta) || a.facility_id.localeCompare(b.facility_id)))
      detalle.push([p.fecha_ruta, p.facility_id, p.es_sdd ? "SDD" : "Spot", p.status === "expired" ? "Vencido sin responder" : "Rechazado", p.vehiculo, p.tipo, p.request_id]);
    await descargarExcelMultihoja([{ nombre: "Diario", datos: diario }, { nombre: "Ranking SC", datos: ranking }, { nombre: "Detalle no aceptadas", datos: detalle }], `rechazos_meli_${mes}`);
  };

  const Kpi = ({ titulo, valor, sub, color, id }) => (
    <div onClick={() => setDetalle(detalle === id ? null : id)} title="Ver el detalle"
      style={{ ...card, padding: "14px 16px", borderTop: `4px solid ${color}`, cursor: "pointer",
               outline: detalle === id ? `2px solid ${color}` : "none", outlineOffset: -2 }}>
      <div style={{ fontSize: 12, color: RM_MUTED }}>{titulo}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: RM_MUTED }}>{sub}</div>}
      <div style={{ fontSize: 11, color: color, marginTop: 4, fontWeight: 600 }}>{detalle === id ? "Ocultar detalle ▲" : "Ver detalle ▼"}</div>
    </div>
  );
  const ListaTop = ({ titulo, campo, color }) => {
    const l = svcs.filter(s => s[campo] > 0).sort((a, b) => b[campo] - a[campo]);
    const max = Math.max(1, ...l.map(s => s[campo]));
    return (
      <div style={{ ...card, flex: "1 1 280px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
        {l.length === 0 && <div style={{ fontSize: 13, color: RM_MUTED }}>Sin rutas no aceptadas.</div>}
        {l.map((s, i) => (
          <div key={s.svc} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span><span style={{ color: RM_MUTED }}>#{i + 1}</span> <b>{s.svc}</b></span><b>{s[campo]}</b></div>
            <div style={{ height: 6, background: "#f1f2f4", borderRadius: 3 }}><div style={{ width: `${(s[campo] / max) * 100}%`, height: 6, background: color, borderRadius: 3 }} /></div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: 24, background: "#f0f2f5", minHeight: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: RM_NAVY }}>Rechazos de rutas MELI</div>
          <div style={{ fontSize: 13, color: RM_MUTED, marginTop: 4, maxWidth: 820, lineHeight: 1.5 }}>
            Rutas que MELI ofreció y Big Ticket no aceptó: rechazadas o vencidas sin responder (no show soft). Fuente: Pedidos de vehículos de MELI, actualizado cada 5 minutos.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button disabled={idx <= 0} onClick={() => setMes(meses[idx - 1])} style={{ border: `1px solid ${RM_BORDER}`, background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: idx <= 0 ? "default" : "pointer", opacity: idx <= 0 ? 0.4 : 1 }}>‹</button>
          <select value={mes} onChange={e => setMes(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${RM_BORDER}`, fontSize: 13, fontWeight: 600 }}>
            {meses.map(m => <option key={m} value={m}>{etiquetaMes(m)}{m === mesActual ? " · en curso" : ""}</option>)}
          </select>
          <button disabled={idx >= meses.length - 1} onClick={() => setMes(meses[idx + 1])} style={{ border: `1px solid ${RM_BORDER}`, background: "#fff", borderRadius: 8, padding: "6px 12px", cursor: idx >= meses.length - 1 ? "default" : "pointer", opacity: idx >= meses.length - 1 ? 0.4 : 1 }}>›</button>
          <button onClick={descargar} disabled={cargando || !filas.length} style={{ border: "none", background: RM_NAVY, color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Descargar Excel</button>
        </div>
      </div>

      {error && <div style={{ ...card, color: "#b42318" }}>No se pudieron leer los pedidos: {error}</div>}
      {cargando && <div style={{ ...card, color: RM_MUTED }}>Cargando {etiquetaMes(mes)}…</div>}

      {!cargando && !error && (
        <>
          {/* ═══ LO QUE PERDIMOS ═══ */}
          <div style={{ background: "#7f1d1d", color: "#fff", borderRadius: 14, padding: "24px 28px", boxShadow: "0 6px 20px rgba(127,29,29,.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 14, letterSpacing: 1, textTransform: "uppercase", opacity: 0.85, fontWeight: 700 }}>Lo que perdimos en {etiquetaMes(mes)} por no aceptar o no hacer rutas</div>
                <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{rmPesos(costos.total.multa + costos.total.ingreso)}</div>
                <div style={{ fontSize: 15, opacity: 0.9, marginTop: 4 }}>
                  {rmN(costos.total.rutas)} rutas que no hicimos = {rmN(costos.svcs.reduce((x, v) => x + (v.soft || 0), 0))} que no aceptamos (rechazadas o vencidas) + {rmN(costos.svcs.reduce((x, v) => x + (v.hard || 0), 0))} que aceptamos y no salieron · MXN sin IVA
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(200px, 1fr))", gap: 12, flex: "1 1 440px", maxWidth: 620 }}>
                <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>Multas que nos cobra MELI</div>
                  <div style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{rmPesos(costos.total.multa)}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>SDD: 75% de la tarifa por no aceptar, 100% por no hacer</div>
                </div>
                <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>Lo que pudimos ganar haciendo esas rutas</div>
                  <div style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{rmPesos(costos.total.ingreso)}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>Tarifa de cada ruta no aceptada o no hecha (SDD y Spot)</div>
                </div>
                {costos.ultimo && (
                  <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 13, opacity: 0.85 }}>Pérdida del último día cerrado ({costos.ultimo.fecha.slice(8, 10)}/{costos.ultimo.fecha.slice(5, 7)})</div>
                    <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>−{rmPesos(costos.ultimo.multa + costos.ultimo.ingreso)}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{costos.ultimo.n} rutas que no hicimos: {rmPesos(costos.ultimo.multa)} en multas + {rmPesos(costos.ultimo.ingreso)} que dejamos de ganar</div>
                  </div>
                )}
                {costos.proy && (
                  <div style={{ background: "rgba(255,255,255,.12)", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 13, opacity: 0.85 }}>Pérdida al cierre del mes si seguimos así</div>
                    <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>−{rmPesos(costos.proy.multa + costos.proy.ingreso)}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{rmPesos(costos.proy.multa)} en multas + {rmPesos(costos.proy.ingreso)} que dejaríamos de ganar</div>
                  </div>
                )}
              </div>
            </div>

            {/* Acumulado día a día */}
            {(() => {
              const max = Math.max(1, ...costos.serie.map(x => x.acMulta + x.acIngreso));
              return (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>Así se fue sumando la pérdida, día a día</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110 }}>
                    {costos.serie.map(x => {
                      const tot = x.acMulta + x.acIngreso;
                      return (
                        <div key={x.fecha} title={`${x.fecha.slice(8, 10)}/${x.fecha.slice(5, 7)}: pérdida acumulada −${rmPesos(tot)} (ese día −${rmPesos(x.multa + x.ingreso)}, ${x.n} rutas)`}
                          style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", minWidth: 6 }}>
                          <div style={{ height: `${(x.acIngreso / max) * 100}%`, background: "rgba(255,255,255,.35)", borderRadius: "3px 3px 0 0" }} />
                          <div style={{ height: `${(x.acMulta / max) * 100}%`, background: "#fca5a5" }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.75, marginTop: 4 }}>
                    <span>{costos.serie[0]?.fecha.slice(8, 10)}/{costos.serie[0]?.fecha.slice(5, 7)}</span>
                    <span>Rosado: multas · Blanco: ingreso perdido</span>
                    <span>{costos.serie.at(-1)?.fecha.slice(8, 10)}/{costos.serie.at(-1)?.fecha.slice(5, 7)}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ ...card, flex: "2 1 560px", minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Dónde duele más · {etiquetaMes(mes)}</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 620 }}>
                  <thead>
                    <tr style={{ color: RM_MUTED, fontSize: 12, textAlign: "left" }}>
                      {["SC", "No aceptadas", "No hechas", "Multas MELI", "Ingreso perdido", "Pérdida total"].map(h => <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${RM_BORDER}`, fontWeight: 600 }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {costos.svcs.map(x => (
                      <tr key={x.svc} style={{ borderBottom: "1px solid #f0f1f3" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 700 }}>{x.svc}</td>
                        <td style={{ padding: "6px 8px" }}>{x.soft || 0}</td>
                        <td style={{ padding: "6px 8px" }}>{x.hard || 0}</td>
                        <td style={{ padding: "6px 8px", color: "#b42318", fontWeight: 600 }}>{rmPesos(x.multa)}</td>
                        <td style={{ padding: "6px 8px" }}>{rmPesos(x.ingreso)}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 800, color: "#7f1d1d" }}>{rmPesos(x.multa + x.ingreso)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ ...card, flex: "1 1 340px" }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Multas por quincena (como factura MELI)</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: RM_MUTED, fontSize: 12, textAlign: "left" }}>
                    {["Quincena", "Brain", "MELI cobró"].map(h => <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${RM_BORDER}`, fontWeight: 600 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {costos.quincenas.map(x => (
                    <tr key={x.q} style={{ borderBottom: "1px solid #f0f1f3" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 700 }}>{x.q}</td>
                      <td style={{ padding: "6px 8px", color: "#b42318", fontWeight: 700 }}>{rmPesos(x.multa)}</td>
                      <td style={{ padding: "6px 8px" }}>{RM_MULTA_REAL[x.q] != null ? rmPesos(RM_MULTA_REAL[x.q]) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 12, color: RM_MUTED, marginTop: 8, lineHeight: 1.5 }}>
                Multas SDD: 75% de la tarifa base por cada ruta no aceptada y 100% por cada ruta aceptada que no se hizo. Spot no tiene multa, pero sí ingreso perdido. "MELI cobró" sale de la prefactura; si el Brain se aleja mucho, revisar las rutas sin revisión del analista.
              </div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}><div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(150px, 1fr))", gap: 12, minWidth: 1100 }}>
            <Kpi id="efectivas" titulo="Efectivas" valor={rmN(rmEfect(total))} sub={`ofrecidas ${rmN(total.total)} − canceladas MELI ${rmN(total.cancel)}`} color={RM_NAVY} />
            <Kpi id="aceptadas" titulo="Aceptadas" valor={rmN(total.acept)} sub={`AR ${rmPct(rmAR(total))}`} color="#166534" />
            <Kpi id="soft" titulo="No aceptadas (soft)" valor={rmN(rmNoAcept(total))} sub={`SDD ${rmN(total.na_sdd)} · Spot ${rmN(total.na_spot)}`} color={RM_ORANGE} />
            <Kpi id="rechazadas" titulo="Rechazadas" valor={rmN(total.rech)} sub="respondidas con rechazo" color="#9a3c06" />
            <Kpi id="vencidas" titulo="Vencidas sin responder" valor={rmN(total.venc)} sub="nadie respondió en 30 min" color="#991b1b" />
            <Kpi id="hard" titulo="Hard: sin placa ni chofer" valor={rmN(total.hard_sdd + total.hard_spot)} sub={`SDD ${rmN(total.hard_sdd)} · Spot ${rmN(total.hard_spot)} · nunca se asignó`} color="#7f1d1d" />
            <Kpi id="sin_salir" titulo="Asignada sin salir (investigar)" valor={rmN(total.ss_sdd + total.ss_spot)}
              sub={`SDD ${rmN(total.ss_sdd)} · Spot ${rmN(total.ss_spot)} · ${filas.filter(p => p.status === "accepted" && p.rosterizado === true && p.travel_status_final === "created" && p.fecha_ruta < fechaHoyOperativa()).filter(p => p.salio_meli === true).length} salieron con otra ruta (no cuentan) · ${filas.filter(p => p.status === "accepted" && p.rosterizado === true && p.travel_status_final === "created" && p.salio_meli !== true && p.fecha_ruta < fechaHoyOperativa() && !revisiones[String(p.request_id)]).length} sin revisar`} color="#6b21a8" />
          </div></div>

          {detalle && (() => {
            const hoyOp = fechaHoyOperativa();
            const FILTROS = {
              efectivas: { t: "Efectivas", f: p => p.status !== "canceled" },
              aceptadas: { t: "Aceptadas", f: p => p.status === "accepted" },
              soft: { t: "No aceptadas (soft)", f: p => p.status === "rejected" || p.status === "expired" },
              rechazadas: { t: "Rechazadas", f: p => p.status === "rejected" },
              vencidas: { t: "Vencidas sin responder", f: p => p.status === "expired" },
              hard: { t: "Hard: sin placa ni chofer", f: p => p.status === "accepted" && p.rosterizado === false && p.fecha_ruta < hoyOp },
              sin_salir: { t: "Asignada sin salir (investigar)", f: p => p.status === "accepted" && p.rosterizado === true && p.travel_status_final === "created" && p.fecha_ruta < hoyOp },
            };
            const def = FILTROS[detalle];
            const lista = filas.filter(def.f).filter(p => !diaSel || p.fecha_ruta === diaSel)
              .sort((a, b) => b.fecha_ruta.localeCompare(a.fecha_ruta) || a.facility_id.localeCompare(b.facility_id));
            const hora = iso => iso ? new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" }) : "—";
            const ESTADO = { accepted: "Aceptada", rejected: "Rechazada", expired: "Vencida sin responder", canceled: "Cancelada MELI", pending: "Por responder" };
            const conRevision = detalle === "hard" || detalle === "sin_salir";
            const RESULTADOS = { no_show: "No show confirmado", cancelada_meli: "Cancelada por MELI", salio: "Sí salió (error de dato)", otro: "Otro" };
            const guardarRevision = async (p, resultado) => {
              const fila = { request_id: p.request_id, fecha_ruta: p.fecha_ruta, resultado: resultado || null,
                             revisado_por: usuario?.email || usuario?.nombre || null, revisado_at: new Date().toISOString() };
              const { error: e } = await sb.from("mx_hard_revision").upsert(fila, { onConflict: "request_id" });
              if (e) { alert("No se pudo guardar la revisión: " + e.message); return; }
              setRevisiones(r => ({ ...r, [String(p.request_id)]: fila }));
            };
            const bajar = () => descargarExcelMultihoja([{ nombre: def.t.slice(0, 30), datos: [["Fecha ruta", "SC", "Modelo", "Estado", "Vehículo", "Tipo", "Llegada (MX)", "Travel", "Placa", "Chofer", "Estado del viaje", "Según MELI", "Comparación con MELI", "Revisión", "Revisado por", "Request ID"],
              ...lista.map(p => { const rv = revisiones[String(p.request_id)]; return [p.fecha_ruta, p.facility_id, p.es_sdd ? "SDD" : "Spot", ESTADO[p.status] || p.status, p.vehiculo, p.tipo === "urgent" ? "Urgente" : "Regular", hora(p.eta), p.travel_id, p.placa || "", p.chofer || "", p.travel_status_final || "", p.salio_meli === true ? `Salió con la ruta ${p.ruta_meli}` : p.salio_meli === false ? "Sin ruta en MELI" : "", p.cmp_meli ? p.cmp_meli.txt : "", rv ? (RESULTADOS[rv.resultado] || "") : "", rv?.revisado_por || "", p.request_id]; })] }],
              `${detalle}_${diaSel || mes}`);
            return (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{def.t} · {diaSel ? `${diaSel.slice(8, 10)}/${diaSel.slice(5, 7)}` : etiquetaMes(mes)} · {lista.length} rutas</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={bajar} disabled={!lista.length} style={{ border: `1px solid ${RM_NAVY}`, background: "#fff", color: RM_NAVY, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Descargar Excel</button>
                    <button onClick={() => setDetalle(null)} style={{ border: `1px solid ${RM_BORDER}`, background: "#fff", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Cerrar</button>
                  </div>
                </div>
                <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: conRevision ? 1100 : 820 }}>
                    <thead>
                      <tr style={{ color: RM_MUTED, fontSize: 12, textAlign: "left", position: "sticky", top: 0, background: "#fff" }}>
                        {["Fecha", "SC", "Modelo", "Estado", "Vehículo", "Tipo", "Llegada", "Travel", "Placa", "Chofer", ...(conRevision ? ["Estado del viaje", ...(detalle === "sin_salir" ? ["Según MELI"] : []), "Comparación con MELI (SC, día y modelo)", "Revisión del analista"] : [])].map(h => (
                          <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${RM_BORDER}`, fontWeight: 600, background: "#fff" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map(p => (
                        <tr key={p.request_id} style={{ borderBottom: "1px solid #f0f1f3" }}>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{p.fecha_ruta.slice(8, 10)}/{p.fecha_ruta.slice(5, 7)}</td>
                          <td style={{ padding: "6px 8px", fontWeight: 700 }}>{p.facility_id}</td>
                          <td style={{ padding: "6px 8px", color: p.es_sdd ? RM_NAVY : RM_ORANGE, fontWeight: 600 }}>{p.es_sdd ? "SDD" : "Spot"}</td>
                          <td style={{ padding: "6px 8px" }}>{ESTADO[p.status] || p.status}</td>
                          <td style={{ padding: "6px 8px" }}>{p.vehiculo}</td>
                          <td style={{ padding: "6px 8px", color: p.tipo === "urgent" ? "#991b1b" : RM_MUTED }}>{p.tipo === "urgent" ? "Urgente" : "Regular"}</td>
                          <td style={{ padding: "6px 8px" }}>{hora(p.eta)}</td>
                          <td style={{ padding: "6px 8px", fontVariantNumeric: "tabular-nums" }}>{p.travel_id}</td>
                          <td style={{ padding: "6px 8px" }}>{p.placa || "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{p.chofer || "—"}</td>
                          {conRevision && <td style={{ padding: "6px 8px", color: RM_MUTED }}>{p.travel_status_final || "sin dato"}</td>}
                          {detalle === "sin_salir" && (
                            <td style={{ padding: "6px 8px", fontWeight: 600, color: p.salio_meli === true ? "#15803d" : p.salio_meli === false ? "#b42318" : RM_MUTED }}>
                              {p.salio_meli === true ? `Salió con la ruta ${p.ruta_meli}` : p.salio_meli === false ? "Sin ruta en MELI: no salió" : "Sin informe de rutas"}
                            </td>
                          )}
                          {conRevision && <td style={{ padding: "6px 8px", fontWeight: 600, color: p.cmp_meli?.color || RM_MUTED }}>{p.cmp_meli ? p.cmp_meli.txt : (p.salio_meli === true ? "No cuenta: salió con otra ruta" : "—")}</td>}
                          {conRevision && (
                            <td style={{ padding: "6px 8px" }}>
                              <select value={revisiones[String(p.request_id)]?.resultado || ""} onChange={e => guardarRevision(p, e.target.value)}
                                style={{ padding: "4px 6px", borderRadius: 6, border: `1px solid ${revisiones[String(p.request_id)]?.resultado ? "#15803d" : "#f59e0b"}`, fontSize: 12, background: "#fff" }}>
                                <option value="">Sin revisar</option>
                                {Object.entries(RESULTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                              {revisiones[String(p.request_id)]?.revisado_por && <div style={{ fontSize: 10, color: RM_MUTED, marginTop: 2 }}>{revisiones[String(p.request_id)].revisado_por}</div>}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {lista.length === 0 && <div style={{ fontSize: 13, color: RM_MUTED, marginTop: 8 }}>Sin rutas en esta categoría.</div>}
                {detalle === "sin_salir" && <div style={{ fontSize: 12, color: RM_MUTED, marginTop: 8, lineHeight: 1.5 }}>Rutas aceptadas que tuvieron placa y chofer pero el viaje quedó en "created". "Según MELI" cruza la placa y el chofer con el informe oficial de rutas de ese día y SC: si aparecen, el vehículo salió con otra ruta y no cuenta como no show. "Comparación con MELI" junta, para ese SC, día y modelo, las rutas del Brain que no salieron (sin placa ni chofer + asignadas sin salir) y las compara con los no show que reconoce MELI. Si coincide, todas son no show. Si sobran, MELI solo reconoce esa cantidad: las demás son cancelaciones o cambios de MELI, y el analista revisa cuáles.</div>}
              </div>
            );
          })()}

          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ ...card, flex: "1 1 560px", minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Día a día · {etiquetaMes(mes)}</div>
                <div style={{ fontSize: 12, color: RM_MUTED }}>Haz clic en un día para ver su ranking por SC</div>
              </div>
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
                  <thead>
                    <tr style={{ color: RM_MUTED, fontSize: 12, textAlign: "left" }}>
                      {["Fecha", "Efectivas", "Aceptadas", "SDD", "Spot", "No aceptadas", "", "AR", "Hard"].map((h, i) => (
                        <th key={i} style={{ padding: "6px 8px", borderBottom: `1px solid ${RM_BORDER}`, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dias.map(d => {
                      const na = rmNoAcept(d), sel = diaSel === d.fecha;
                      return (
                        <tr key={d.fecha} onClick={() => setDiaSel(sel ? null : d.fecha)} style={{ borderBottom: "1px solid #f0f1f3", cursor: "pointer", background: sel ? "#eef3fb" : "transparent" }}>
                          <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}><b>{d.fecha.slice(8, 10)}/{d.fecha.slice(5, 7)}</b> <span style={{ color: RM_MUTED }}>{RM_DIAS[new Date(d.fecha + "T12:00:00Z").getUTCDay()]}</span></td>
                          <td style={{ padding: "6px 8px" }}>{rmEfect(d) || "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{d.acept || "—"}</td>
                          <td style={{ padding: "6px 8px", color: d.na_sdd ? RM_NAVY : RM_MUTED, fontWeight: d.na_sdd ? 700 : 400 }}>{d.na_sdd}</td>
                          <td style={{ padding: "6px 8px", color: d.na_spot ? RM_ORANGE : RM_MUTED, fontWeight: d.na_spot ? 700 : 400 }}>{d.na_spot}</td>
                          <td style={{ padding: "6px 8px", fontWeight: 700 }}>{na}</td>
                          <td style={{ padding: "6px 8px", width: 160 }}>
                            <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", background: "#f1f2f4" }}>
                              <div style={{ width: `${(d.na_sdd / maxNA) * 100}%`, background: RM_NAVY }} />
                              <div style={{ width: `${(d.na_spot / maxNA) * 100}%`, background: RM_ORANGE }} />
                            </div>
                          </td>
                          <td style={{ padding: "6px 8px" }}>{rmPct(rmAR(d))}</td>
                          <td style={{ padding: "6px 8px", color: (d.hard_sdd + d.hard_spot) ? "#7f1d1d" : RM_MUTED, fontWeight: (d.hard_sdd + d.hard_spot) ? 700 : 400 }}>{d.hard_sdd + d.hard_spot}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 12, color: RM_MUTED, marginTop: 8 }}>SDD y Spot = rutas no aceptadas de cada modelo. Barra: azul SDD, naranjo Spot.</div>
            </div>

            <div style={{ ...card, flex: "1 1 520px", minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Ranking por SC · {diaSel ? `${diaSel.slice(8, 10)}/${diaSel.slice(5, 7)}` : etiquetaMes(mes)}</div>
                {diaSel && <button onClick={() => setDiaSel(null)} style={{ border: "none", background: "transparent", color: RM_NAVY, fontWeight: 600, cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>Ver el mes completo</button>}
              </div>
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
                  <thead>
                    <tr style={{ color: RM_MUTED, fontSize: 12, textAlign: "left" }}>
                      {["#", "SC", "Efectivas", "SDD", "Spot", "Total", "AR", "% del total", "Hard SDD", "Hard Spot"].map(h => (
                        <th key={h} style={{ padding: "6px 8px", borderBottom: `1px solid ${RM_BORDER}`, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {svcs.map((s, i) => (
                      <tr key={s.svc} style={{ borderBottom: "1px solid #f0f1f3" }}>
                        <td style={{ padding: "6px 8px", color: RM_MUTED }}>{i + 1}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 700 }}>{s.svc}</td>
                        <td style={{ padding: "6px 8px" }}>{rmEfect(s)}</td>
                        <td style={{ padding: "6px 8px", color: s.na_sdd ? RM_NAVY : RM_MUTED, fontWeight: s.na_sdd ? 700 : 400 }}>{s.na_sdd}</td>
                        <td style={{ padding: "6px 8px", color: s.na_spot ? RM_ORANGE : RM_MUTED, fontWeight: s.na_spot ? 700 : 400 }}>{s.na_spot}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 700 }}>{s.na}</td>
                        <td style={{ padding: "6px 8px", color: rmAR(s) != null && rmAR(s) < 0.9 ? "#9a3c06" : "#1a1a1a" }}>{rmPct(rmAR(s))}</td>
                        <td style={{ padding: "6px 8px" }}>{rmPct(s.share)}</td>
                        <td style={{ padding: "6px 8px", color: s.hard_sdd ? "#7f1d1d" : RM_MUTED, fontWeight: s.hard_sdd ? 700 : 400 }}>{s.hard_sdd}</td>
                        <td style={{ padding: "6px 8px", color: s.hard_spot ? "#7f1d1d" : RM_MUTED, fontWeight: s.hard_spot ? 700 : 400 }}>{s.hard_spot}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 12, color: RM_MUTED, marginTop: 8, lineHeight: 1.5 }}>
                AR = aceptadas ÷ efectivas (ofrecidas menos canceladas por MELI y menos las que siguen por responder). Las vencidas sin responder MELI las cuenta como rechazo. Hard = aceptadas de días ya cerrados que nunca tuvieron placa y chofer asignados.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <ListaTop titulo={`Ranking SDD (flota fija) · ${diaSel ? diaSel.slice(8, 10) + "/" + diaSel.slice(5, 7) : etiquetaMes(mes)}`} campo="na_sdd" color={RM_NAVY} />
            <ListaTop titulo={`Ranking Spot (flota variable) · ${diaSel ? diaSel.slice(8, 10) + "/" + diaSel.slice(5, 7) : etiquetaMes(mes)}`} campo="na_spot" color={RM_ORANGE} />
          </div>
        </>
      )}
    </div>
  );
}

export default RechazosMeliMX;
