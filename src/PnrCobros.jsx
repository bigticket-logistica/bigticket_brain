import { Fragment, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "./shared";

// ─── PNR — Cobro a terceros ─────────────────────────────────────────
// Lista los PNR cobrables de la semana y permite agregar cada uno a la
// conciliación del transportista como línea negativa, dejando registro
// de quién lo hizo. Son cobrables dos motivos:
//   BILLED          → MELI lo envió a facturación
//   WITHOUT_RECEIPT → el supervisor respondió pero no cargó comprobante
// El caso pertenece a la semana en que se volvió cobrable por primera
// vez, así que aparece en una sola semana y nunca se repite. El motivo
// y el derecho a cobro se leen del estado ACTUAL del caso en MELI: si
// después se anuló, la fila queda bloqueada.

const ANCLA_SEM = Date.UTC(2026, 5, 1); // lunes de la semana 24

function fechaUtc(iso) {
  const s = String(iso).slice(0, 10).split("-");
  return new Date(Date.UTC(Number(s[0]), Number(s[1]) - 1, Number(s[2])));
}

// Misma numeración que usa el inventario de flota en la pestaña Terceros:
// no es la semana ISO, es 24 + semanas transcurridas desde el 01/06/2026.
function semanaInventario(fechaIso) {
  if (!fechaIso) return null;
  const d = fechaUtc(fechaIso);
  if (isNaN(d.getTime())) return null;
  const off = (d.getUTCDay() + 6) % 7;
  const lunes = new Date(d.getTime() - off * 86400000);
  return 24 + Math.round((lunes.getTime() - ANCLA_SEM) / (7 * 86400000));
}

function rangoSemana(sem) {
  const inicio = new Date(ANCLA_SEM + (Number(sem) - 24) * 7 * 86400000);
  const fin = new Date(inicio.getTime() + 6 * 86400000);
  return { inicio, fin };
}

function etiquetaSemana(sem) {
  const M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const { inicio, fin } = rangoSemana(sem);
  const di = inicio.getUTCDate(), mi = M[inicio.getUTCMonth()];
  const df = fin.getUTCDate(), mf = M[fin.getUTCMonth()];
  return mi === mf ? `${di}–${df} ${mi}` : `${di} ${mi} – ${df} ${mf}`;
}

function normalizarPlaca(p) {
  if (!p) return null;
  const s = String(p).trim().toUpperCase().replace(/^SDD-/, "");
  return s || null;
}

// Mismo cálculo de totales que Conciliación Terceros: el IVA se aplica
// sobre el neto y los cobros se restan del bruto.
function recalcSC(filas, cobros) {
  const reales = (filas || []).filter(d => !d._saldo);
  const neto = Math.round((filas || []).reduce((s, d) => s + Number(d.monto || 0), 0) * 100) / 100;
  const neg = neto < 0;
  const iva = neg ? 0 : Math.round(neto * 0.16 * 100) / 100;
  const bruto = neg ? neto : Math.round(neto * 1.16 * 100) / 100;
  const c = Number(cobros || 0);
  const liquido = Math.round((bruto - c) * 100) / 100;
  return {
    neto, iva, bruto, cobros: c, liquido, negativo: neg,
    nViajes: reales.length, nNoPago: reales.filter(d => d.es_no_pago).length,
  };
}

const MOTIVOS = {
  BILLED: { label: "Enviado a facturación", corto: "facturación", color: "#1a3a6b", bg: "#e8eef7", concepto: "PNR facturado" },
  WITHOUT_RECEIPT: { label: "Sin comprobante cargado", corto: "sin comprobante", color: "#92400e", bg: "#fef3c7", concepto: "PNR sin comprobante" },
};
const SUB_COBRABLES = Object.keys(MOTIVOS);

function ChipMotivo({ sub, estadoActual }) {
  if (!sub) {
    return (
      <span style={{
        display: "inline-block", padding: "2px 7px", fontSize: 10, fontWeight: 700,
        borderRadius: 4, background: "#f1f3f6", color: "#64748b", whiteSpace: "nowrap",
      }} title={"Estado actual en MELI: " + (estadoActual || "—")}>
        Ya no cobrable
      </span>
    );
  }
  const m = MOTIVOS[sub] || { label: sub, color: "#334155", bg: "#eef2f7" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 7px", fontSize: 10, fontWeight: 700,
      borderRadius: 4, background: m.bg, color: m.color, whiteSpace: "nowrap",
    }}>
      {m.label}
    </span>
  );
}

const lineaId = (d) => d._id || `m|${String(d.fecha || "").slice(0, 10)}|${d.placa || ""}|${d.id_ruta || ""}|${d.service_center_id || ""}`;

const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fechaHora = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const soloFecha = (f) => {
  if (!f) return "—";
  const s = String(f).slice(0, 10).split("-");
  return `${s[2]}/${s[1]}/${s[0]}`;
};

const th = {
  padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#64748b",
  textAlign: "left", borderBottom: "1px solid #e4e7ec", whiteSpace: "nowrap",
};
const td = { padding: "8px 10px", fontSize: 12, color: "#1a1a1a", borderBottom: "1px solid #f1f3f6", verticalAlign: "top" };

function Kpi({ label, valor, sub }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 16px", minWidth: 150 }}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{valor}</div>
      {sub ? <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

function ChipResumen({ label, n }) {
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", marginRight: 4, marginBottom: 2,
      fontSize: 9, fontWeight: 600, borderRadius: 4, background: "#eef2f7", color: "#334155",
    }}>
      {label} {n}
    </span>
  );
}

// Detalle de avisos, con la misma lectura que el panel de Posventa:
// cada envío con su tipo, a quién fue y cuántas horas de SLA quedaban.
function DetalleAvisos({ lista }) {
  if (!lista || !lista.length) {
    return <div style={{ fontSize: 11, color: "#94a3b8" }}>Este caso no recibió avisos.</div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "2px 16px", fontSize: 11 }}>
      {lista.map((a, i) => (
        <Fragment key={i}>
          <span style={{ color: "#334155" }}>
            {a.tipo || "aviso"}{a.destino ? " · " + a.destino : ""}
          </span>
          <span style={{ color: "#64748b" }}>{fechaHora(a.creado_en)}</span>
          <span style={{ color: a.horas_restantes != null && a.horas_restantes <= 6 ? "#b45309" : "#94a3b8" }}>
            {a.horas_restantes != null ? a.horas_restantes + " h" : ""}
          </span>
          <span style={{ color: "#94a3b8" }}>{a.estado_entrega || ""}</span>
        </Fragment>
      ))}
    </div>
  );
}

export default function PnrCobrosMX({ usuario }) {
  const [semana, setSemana] = useState(() => semanaInventario(new Date().toISOString()));
  const [filas, setFilas] = useState([]);
  const [cobrados, setCobrados] = useState({});
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState(null);
  const [semanaCobro, setSemanaCobro] = useState(() => semanaInventario(new Date().toISOString()));
  const [seleccion, setSeleccion] = useState({});

  const quien = (usuario && (usuario.nombre || usuario.email)) || "Brain";

  useEffect(() => { cargar(semana); }, [semana]);

  const cargar = async (sem, conservarMsg) => {
    setLoading(true);
    if (!conservarMsg) setMsg(null);
    try {
      const { inicio, fin } = rangoSemana(sem);
      const desde = inicio.toISOString();
      const hasta = new Date(fin.getTime() + 86400000).toISOString();

      // 1) transiciones a facturación dentro de la semana
      const { data: hist, error: e1 } = await sb.from("pnr_historial_mx")
        .select("case_id, sub_a, creado_en").in("sub_a", SUB_COBRABLES)
        .lt("creado_en", hasta)
        .order("creado_en", { ascending: true });
      if (e1) throw e1;

      // Primera vez que cada caso se volvió cobrable. Esa fecha define su
      // semana, así que un caso aparece en una sola semana aunque después
      // cambie de sub-estado varias veces.
      const primeraVez = {};
      for (const h of hist || []) if (!primeraVez[h.case_id]) primeraVez[h.case_id] = h.creado_en;

      // se quedan solo los que se volvieron cobrables dentro de esta semana
      const cobrable = {};
      for (const cid in primeraVez) {
        if (primeraVez[cid] >= desde) cobrable[cid] = { ts: primeraVez[cid] };
      }
      const ids = Object.keys(cobrable).map(Number);
      if (!ids.length) { setFilas([]); setCobrados({}); setLoading(false); return; }

      // 2) datos del caso
      const { data: casos, error: e2 } = await sb.from("pnr_casos_mx")
        .select("case_id, shipment_id, monto, moneda, conductor, service_center, route_code, route_id, tercero_id, estado, sub_estado")
        .in("case_id", ids);
      if (e2) throw e2;

      // 2b) historial completo de avisos (el mismo que muestra Posventa)
      const avisosPorCaso = {};
      const { data: avs } = await sb.from("vw_pnr_avisos_historial")
        .select("case_id, tipo, destino, creado_en, horas_restantes, estado_entrega")
        .in("case_id", ids)
        .order("creado_en", { ascending: true });
      for (const a of avs || []) {
        (avisosPorCaso[a.case_id] = avisosPorCaso[a.case_id] || []).push(a);
      }

      // 2c) los que ya se agregaron a una conciliación
      const yaCobrados = {};
      const { data: cob } = await sb.from("cobros_pnr_mx")
        .select("pnr_id, empresa_nombre, service_center, semana, monto, asignado_por, enviado_a_cobro_en")
        .in("pnr_id", ids.map(String));
      for (const c of cob || []) yaCobrados[c.pnr_id] = c;

      // 3) placa y fecha de ruta desde la jornada
      const rutas = [...new Set((casos || []).map(c => c.route_id).filter(Boolean))];
      let jornada = {};
      if (rutas.length) {
        const { data: jor } = await sb.from("maestro_jornada_mx")
          .select("id_ruta, placa, fecha, driver_name, service_center_id").in("id_ruta", rutas);
        for (const j of jor || []) if (!jornada[j.id_ruta]) jornada[j.id_ruta] = j;
      }

      // 4) empresa por placa según la semana de la ruta (no la de facturación)
      const semanas = [...new Set(Object.values(jornada).map(j => semanaInventario(j.fecha)).filter(s => s != null))];
      const empSem = {};
      if (semanas.length) {
        const { data: fl } = await sb.from("flota_terceros_mx")
          .select("semana, placa, empresa_transporte").in("semana", semanas).limit(50000);
        const acc = {};
        for (const f of fl || []) {
          const e = String(f.empresa_transporte || "").trim(); if (!e) continue;
          const k = f.semana + "||" + normalizarPlaca(f.placa);
          if (!acc[k]) acc[k] = new Set();
          acc[k].add(e);
        }
        for (const k in acc) empSem[k] = [...acc[k]].join(" / ");
      }

      const out = (casos || []).map(c => {
        const j = jornada[c.route_id] || {};
        const semRuta = semanaInventario(j.fecha);
        const placa = j.placa || null;
        const empresa = (placa && semRuta != null)
          ? (empSem[semRuta + "||" + normalizarPlaca(placa)] || null) : null;
        const avisos = avisosPorCaso[c.case_id] || [];
        const porTipo = {};
        for (const a of avisos) {
          const t = a.tipo || "aviso";
          porTipo[t] = (porTipo[t] || 0) + 1;
        }
        const mot = cobrable[c.case_id] || {};
        return {
          ...c,
          sub_cobro: MOTIVOS[c.sub_estado] ? c.sub_estado : null,
          facturado_en: mot.ts,
          placa,
          fecha_ruta: j.fecha || null,
          semana_ruta: semRuta,
          empresa,
          avisos,
          resumen_avisos: Object.entries(porTipo),
          sin_avisos: avisos.length === 0,
        };
      }).sort((a, b) => String(b.facturado_en).localeCompare(String(a.facturado_en)));

      setFilas(out);
      setCobrados(yaCobrados);
      const sel = {};
      for (const f of out) if (!yaCobrados[String(f.case_id)]) sel[f.case_id] = true;
      setSeleccion(sel);
    } catch (e) {
      console.error("PNR cobros:", e);
      setMsg({ ok: false, txt: "No se pudo cargar la semana: " + (e.message || e) });
      setFilas([]);
    }
    setLoading(false);
  };

  // Arma la línea de prefactura y la fila de cobro de un PNR.
  const prepararCobro = (f) => {
    const mot = MOTIVOS[f.sub_cobro] || { label: f.sub_cobro || "PNR", concepto: "PNR" };
    const sc = f.service_center || "SIN SC";
    const monto = Math.abs(Number(f.monto || 0));
    const linea = {
      _id: `pnr|${f.case_id}`, origen: "pnr", es_manual: true,
      fecha: f.fecha_ruta ? String(f.fecha_ruta).slice(0, 10) : null,
      placa: f.placa || "—",
      id_ruta: f.route_id || "",   // el numérico, igual que el resto de la prefactura
      driver_name: "",             // lo arma etiquetar(), que ya sabe el SC final
      service_center_id: sc,
      tiene_auxiliar: false, cargado: null, entregado: null,
      monto: -monto, es_no_pago: false,
      pnr_case_id: f.case_id,
      pnr_shipment_id: f.shipment_id || null,
      pnr_motivo: mot.label,
      pnr_conductor: f.conductor || null,
      pnr_facturado_en: f.facturado_en || null,
      pnr_sc_original: sc,
      pnr_fecha_ruta: f.fecha_ruta || null,
      // Copia del historial de avisos al momento del cobro: es la prueba que
      // viaja impresa en la prefactura, así que no puede depender de Posventa.
      pnr_avisos: (f.avisos || []).map(a => ({
        t: a.tipo || "aviso", d: a.destino || null,
        f: a.creado_en, h: a.horas_restantes != null ? a.horas_restantes : null,
      })),
      agregado_por: quien,
      agregado_at: new Date().toISOString(),
    };
    return { mot, sc, monto, linea, caso: f };
  };

  // Texto que ve el transportista en el detalle de la prefactura: tiene que
  // explicarse solo, porque es la única referencia que va a tener al reclamar.
  const etiquetar = (linea, scFinal) => {
    const partes = [
      `COBRO PNR ${linea.pnr_case_id}`,
      linea.pnr_shipment_id ? `guía ${linea.pnr_shipment_id}` : null,
      linea.pnr_fecha_ruta ? `ruta del ${soloFecha(linea.pnr_fecha_ruta)}` : null,
    ];
    if (scFinal !== linea.pnr_sc_original) {
      partes.push(`corresponde a ${linea.pnr_sc_original}, cobrado acá por no haber operación esa semana en ${linea.pnr_sc_original}`);
    }
    return partes.filter(Boolean).join(" · ");
  };

  // Motivo por el que un PNR no se puede cobrar automáticamente.
  const bloqueo = (f) => {
    if (!f.empresa) return "sin empresa resuelta";
    if (String(f.empresa).includes(" / ")) return "la placa está en dos empresas esa semana";
    if (!Math.abs(Number(f.monto || 0))) return "sin monto";
    return null;
  };

  // SC donde se puede cobrar: el propio si la empresa trabajó ahí esa semana;
  // si no, el que más viajes tenga. Sin operación en ningún SC no hay de dónde
  // descontar. El cache evita repetir la consulta por cada caso de la empresa.
  const resolverSc = async (empresa, scPreferido, cache) => {
    const k = empresa;
    if (!cache[k]) {
      const { data, error } = await sb.rpc("get_conciliacion_terceros_detalle",
        { p_semana: semanaCobro, p_empresa: empresa, p_sc: null });
      if (error) throw error;
      const cuenta = {};
      for (const d of data || []) {
        const sc = d.service_center_id || "SIN SC";
        cuenta[sc] = (cuenta[sc] || 0) + 1;
      }
      cache[k] = cuenta;
    }
    const cuenta = cache[k];
    const scs = Object.keys(cuenta);
    if (!scs.length) return null;
    if (cuenta[scPreferido]) return scPreferido;
    return scs.sort((a, b) => cuenta[b] - cuenta[a])[0];
  };

  // Escribe en la conciliación de una empresa y SC todas las líneas de PNR que
  // le corresponden. Una sola escritura por grupo: si se hiciera una por caso,
  // dos cobros de la misma empresa se pisarían el detalle entre sí.
  const cargarEnConciliacion = async (empresa, sc, lineas) => {
    const { data: motor, error: eRpc } = await sb.rpc("get_conciliacion_terceros_detalle",
      { p_semana: semanaCobro, p_empresa: empresa, p_sc: sc });
    if (eRpc) throw eRpc;
    let actuales = (motor || []).map(d => ({ ...d, _id: lineaId(d), origen: d.origen || "motor" }));

    const { data: conc } = await sb.from("conciliaciones_terceros")
      .select("detalle, total_cobros, estado")
      .eq("empresa_nombre", empresa).eq("service_center", sc).eq("semana", semanaCobro).maybeSingle();
    if (conc && Array.isArray(conc.detalle) && conc.detalle.length) {
      actuales = conc.detalle.map(d => ({ ...d, _id: d._id || lineaId(d), origen: d.origen || "motor" }));
    }

    const yaEstan = new Set(actuales.map(lineaId));
    const nuevas = lineas.filter(l => !yaEstan.has(l._id));
    if (!nuevas.length) return 0;

    const filasSC = actuales.concat(nuevas);
    const { inicio } = rangoSemana(semanaCobro);
    const tot = recalcSC(filasSC, Number((conc && conc.total_cobros) || 0));
    const { error: eUp } = await sb.from("conciliaciones_terceros").upsert({
      empresa_nombre: empresa, service_center: sc, semana: semanaCobro,
      semana_inicio: inicio.toISOString().slice(0, 10), estado: "borrador",
      total_neto: tot.neto, iva_16: tot.iva, total_bruto: tot.bruto,
      total_cobros: tot.cobros, liquido_pago: tot.liquido,
      n_viajes: tot.nViajes, n_no_pago: tot.nNoPago,
      detalle: filasSC, tiene_ajustes: true,
      generado_at: new Date().toISOString(),
    }, { onConflict: "empresa_nombre,service_center,semana" });
    if (eUp) throw eUp;

    await sb.from("conciliacion_terceros_ajustes").insert(nuevas.map(l => ({
      empresa_nombre: empresa, service_center: sc, semana: semanaCobro,
      accion: "agregar", origen_linea: "pnr", linea: l,
      motivo: `Cobro de PNR ${l.pnr_case_id} · ${l.pnr_motivo} (guía ${l.pnr_shipment_id || "—"}) por ${money(Math.abs(l.monto))}`
        + (l.service_center_id !== l.pnr_sc_original ? ` — corresponde a ${l.pnr_sc_original}, sin operación esa semana` : ""),
      usuario: quien,
    })));
    return nuevas.length;
  };

  // Ejecuta un lote de cobros: resuelve el SC de cada uno, agrupa por empresa y
  // SC final, y hace una sola escritura por prefactura.
  const ejecutarCobros = async (lista) => {
    const cache = {};
    const grupos = {};
    const sinOperacion = [];
    for (const f of lista) {
      const prep = prepararCobro(f);
      let scFinal;
      try {
        scFinal = await resolverSc(f.empresa, prep.sc, cache);
      } catch (e) {
        console.error("resolver SC:", e); scFinal = null;
      }
      if (!scFinal) { sinOperacion.push(`${f.case_id} (${f.empresa})`); continue; }
      prep.linea.service_center_id = scFinal;
      prep.linea.driver_name = etiquetar(prep.linea, scFinal);
      const fila = {
        pnr_id: String(f.case_id),
        empresa_nombre: f.empresa,
        service_center: scFinal,
        semana: String(semanaCobro),
        fecha_ruta: f.fecha_ruta || String(f.facturado_en).slice(0, 10),
        facturado_en: String(f.facturado_en).slice(0, 10),
        driver_name: f.conductor || null,
        placa: f.placa || null,
        concepto: prep.mot.concepto + (scFinal !== prep.sc ? ` (corresponde a ${prep.sc})` : ""),
        monto: prep.monto,
        estado: "enviado",
        enviado_a_cobro_en: new Date().toISOString(),
        asignado_por: quien,
      };
      const k = f.empresa + "||" + scFinal;
      (grupos[k] = grupos[k] || { empresa: f.empresa, sc: scFinal, lineas: [], filas: [] });
      grupos[k].lineas.push(prep.linea);
      grupos[k].filas.push(fila);
    }

    let ok = 0, movidos = 0;
    const fallidos = [];
    for (const k of Object.keys(grupos)) {
      const g = grupos[k];
      let insertadas = [];
      try {
        const { error: eIns } = await sb.from("cobros_pnr_mx").insert(g.filas);
        if (eIns) throw eIns;
        insertadas = g.filas.map(x => x.pnr_id);
        const n = await cargarEnConciliacion(g.empresa, g.sc, g.lineas);
        ok += n;
        movidos += g.lineas.filter(l => l.service_center_id !== l.pnr_sc_original).length;
      } catch (e) {
        console.error("cobro PNR:", g.empresa, g.sc, e);
        if (insertadas.length) {
          try { await sb.from("cobros_pnr_mx").delete().in("pnr_id", insertadas); } catch (e2) { console.error(e2); }
        }
        fallidos.push(`${g.empresa} · ${g.sc}`);
      }
    }
    return { ok, movidos, fallidos, sinOperacion, nGrupos: Object.keys(grupos).length };
  };

  const agregar = async (f) => {
    const porQue = bloqueo(f);
    if (porQue) {
      setMsg({ ok: false, txt: `No se puede cobrar el PNR ${f.case_id}: ${porQue}.` });
      return;
    }
    const monto = Math.abs(Number(f.monto || 0));
    if (!window.confirm(
      `¿Agregar este cobro a la conciliación?\n\n${f.empresa} · ${f.service_center} · se cobra en la semana ${semanaCobro}\nPNR ${f.case_id} · guía ${f.shipment_id || "—"} · ruta ${f.route_id || "—"}\nMonto: -${money(monto)}\n\nSi la empresa no operó en ese SC esa semana, se cobra en otro y queda anotado en la línea.`
    )) return;
    setGuardando(f.case_id); setMsg(null);
    const r = await ejecutarCobros([f]);
    if (r.sinOperacion.length) {
      setMsg({ ok: false, txt: `${f.empresa} no tiene operación en la semana ${semanaCobro}, así que no hay prefactura donde descontar el PNR ${f.case_id}.` });
    } else if (r.fallidos.length) {
      setMsg({ ok: false, txt: `No se pudo agregar el cobro en ${r.fallidos.join(", ")}.` });
    } else if (!r.ok) {
      setMsg({ ok: false, txt: `Esa prefactura ya tenía la línea del PNR ${f.case_id}.` });
    } else {
      setMsg({ ok: true, txt: `PNR ${f.case_id} agregado por -${money(monto)}${r.movidos ? " (cobrado en otro SC por falta de operación)" : ""}. La prefactura volvió a borrador: generala y enviala.` });
    }
    setGuardando(null);
    await cargar(semana, true);
  };

  // Carga de una pasada los pendientes tildados.
  const agregarSeleccionados = async () => {
    const lista = pendientes.filter(f => seleccion[f.case_id] && !bloqueo(f));
    if (!lista.length) {
      setMsg({ ok: false, txt: "No hay casos tildados que se puedan cobrar." });
      return;
    }
    const totalMonto = lista.reduce((a, f) => a + Math.abs(Number(f.monto || 0)), 0);
    if (!window.confirm(
      `¿Agregar ${lista.length} cobros de PNR?\n\nTotal: -${money(totalMonto)}\nSe cobran en la semana ${semanaCobro}.\n\nLas prefacturas afectadas vuelven a borrador y hay que generarlas de nuevo.`
    )) return;
    setGuardando("todos"); setMsg(null);
    const r = await ejecutarCobros(lista);
    setMsg({
      ok: !r.fallidos.length && !r.sinOperacion.length,
      txt: `${r.ok} cobros agregados en ${r.nGrupos - r.fallidos.length} prefacturas.`
        + (r.movidos ? ` ${r.movidos} se cobraron en otro SC por falta de operación.` : "")
        + (r.sinOperacion.length ? ` Sin operación en la semana: ${r.sinOperacion.join(", ")}.` : "")
        + (r.fallidos.length ? ` Fallaron: ${r.fallidos.join(", ")}.` : " Generá y enviá las prefacturas afectadas."),
    });
    setGuardando(null);
    await cargar(semana, true);
  };

  // Deshace un cobro: saca la línea de la conciliación y libera el caso para
  // volver a cobrarlo. Usa la empresa, SC y semana con que se cobró, no las
  // que se ven ahora, porque el inventario de flota pudo haber cambiado.
  const quitar = async (f, ya) => {
    const sc = ya.service_center;
    const sem = Number(ya.semana);
    const { data: conc } = await sb.from("conciliaciones_terceros")
      .select("detalle, total_cobros, estado")
      .eq("empresa_nombre", ya.empresa_nombre).eq("service_center", sc).eq("semana", sem).maybeSingle();

    const enviada = conc && String(conc.estado || "").toLowerCase() === "enviada";
    if (!window.confirm(
      `¿Quitar este cobro?\n\nPNR ${f.case_id} · ${ya.empresa_nombre} · ${sc} · semana ${sem}\nMonto: -${money(ya.monto)}\n` +
      (enviada ? `\n⚠ Esta prefactura YA FUE ENVIADA al transportista. Va a volver a borrador y hay que generarla y enviarla de nuevo.\n` : "") +
      `\nEl caso vuelve a quedar pendiente y se puede cobrar otra vez.`
    )) return;

    setGuardando(f.case_id); setMsg(null);
    try {
      const idLinea = `pnr|${f.case_id}`;
      if (conc && Array.isArray(conc.detalle) && conc.detalle.length) {
        const quedan = conc.detalle.filter(d => lineaId(d) !== idLinea);
        if (quedan.length !== conc.detalle.length) {
          const { inicio } = rangoSemana(sem);
          const tot = recalcSC(quedan, Number(conc.total_cobros || 0));
          const { error: eUp } = await sb.from("conciliaciones_terceros").upsert({
            empresa_nombre: ya.empresa_nombre, service_center: sc, semana: sem,
            semana_inicio: inicio.toISOString().slice(0, 10), estado: "borrador",
            total_neto: tot.neto, iva_16: tot.iva, total_bruto: tot.bruto,
            total_cobros: tot.cobros, liquido_pago: tot.liquido,
            n_viajes: tot.nViajes, n_no_pago: tot.nNoPago,
            detalle: quedan, tiene_ajustes: true,
            generado_at: new Date().toISOString(),
          }, { onConflict: "empresa_nombre,service_center,semana" });
          if (eUp) throw eUp;

          await sb.from("conciliacion_terceros_ajustes").insert({
            empresa_nombre: ya.empresa_nombre, service_center: sc, semana: sem,
            accion: "eliminar", origen_linea: "pnr",
            linea: conc.detalle.find(d => lineaId(d) === idLinea) || null,
            motivo: `Cobro de PNR ${f.case_id} revertido desde la pestaña PNR`,
            usuario: quien,
          });
        }
      }

      const { error: eDel } = await sb.from("cobros_pnr_mx").delete().eq("pnr_id", String(f.case_id));
      if (eDel) throw eDel;

      setMsg({ ok: true, txt: `Cobro del PNR ${f.case_id} quitado de ${ya.empresa_nombre} · ${sc}. El caso vuelve a estar pendiente.` });
      await cargar(semana, true);
    } catch (e) {
      console.error("quitar cobro PNR:", e);
      setMsg({ ok: false, txt: "No se pudo quitar el cobro: " + (e.message || e) });
    }
    setGuardando(null);
  };

  const exportar = async () => {
    const enc = ["PNR", "Motivo del cobro", "Pasó a cobro", "Monto", "Chofer", "Placa", "SC",
      "ID ruta", "Ruta", "Fecha ruta", "Semana ruta", "Guía", "Empresa transportista",
      "Estado", "Cobrado por", "Cobrado el", "Semana cobro", "Avisos"];
    const datos = [enc];
    const avisos = [["PNR", "Tipo", "Destino", "Fecha", "Horas restantes", "Estado entrega"]];
    for (const f of visibles) {
      const ya = cobrados[String(f.case_id)];
      const m = MOTIVOS[f.sub_cobro] || {};
      datos.push([
        f.case_id, m.label || f.sub_cobro || "", fechaHora(f.facturado_en), Number(f.monto || 0),
        f.conductor || "", f.placa || "", f.service_center || "",
        f.route_id || "", f.route_code || "", f.fecha_ruta ? soloFecha(f.fecha_ruta) : "",
        f.semana_ruta != null ? f.semana_ruta : "", f.shipment_id || "", f.empresa || "",
        ya ? "Cobrado" : "Pendiente", ya ? ya.asignado_por : "",
        ya ? fechaHora(ya.enviado_a_cobro_en) : "", ya ? ya.semana : "",
        (f.avisos || []).length,
      ]);
      for (const a of f.avisos || []) {
        avisos.push([f.case_id, a.tipo || "", a.destino || "", fechaHora(a.creado_en),
          a.horas_restantes != null ? a.horas_restantes : "", a.estado_entrega || ""]);
      }
    }
    await descargarExcelMultihoja(
      [{ nombre: `PNR sem ${semana}`, datos }, { nombre: "Avisos", datos: avisos }],
      `PNR_cobros_sem${semana}.xlsx`
    );
  };

  const visibles = useMemo(() => {
    const q = busqueda.trim().toUpperCase();
    if (!q) return filas;
    return filas.filter(f => [f.case_id, f.conductor, f.placa, f.service_center, f.route_id, f.route_code, f.shipment_id, f.empresa]
      .some(v => String(v || "").toUpperCase().includes(q)));
  }, [filas, busqueda]);

  const pendientes = visibles.filter(f => !cobrados[String(f.case_id)] && f.sub_cobro);
  const yaNoCobrables = visibles.filter(f => !cobrados[String(f.case_id)] && !f.sub_cobro).length;
  const totalPend = pendientes.reduce((s, f) => s + Number(f.monto || 0), 0);
  const sinEmpresa = pendientes.filter(f => !f.empresa).length;
  const cobrables = pendientes.filter(f => !bloqueo(f));
  const nSeleccionados = cobrables.filter(f => seleccion[f.case_id]).length;
  const todosTildados = cobrables.length > 0 && nSeleccionados === cobrables.length;
  const nFacturados = pendientes.filter(f => f.sub_cobro === "BILLED").length;
  const nSinComprobante = pendientes.filter(f => f.sub_cobro === "WITHOUT_RECEIPT").length;

  return (
    <div style={{ padding: 24, fontFamily: "Geist, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>PNR — cobro a terceros</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            PNR que se volvieron cobrables en esta semana, por envío a facturación o por quedar sin comprobante cargado. Cada caso aparece en una sola semana. Agregar carga el cobro en la conciliación como línea negativa.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setSemana(s => s - 1)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer" }}>
          ←
        </button>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a3a6b", minWidth: 150, textAlign: "center" }}>
          Semana {semana}
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400 }}>{etiquetaSemana(semana)}</div>
        </div>
        <button onClick={() => setSemana(s => s + 1)}
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 6, cursor: "pointer" }}>
          →
        </button>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar caso, chofer, placa…"
          style={{ padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 6, width: 220 }} />
        <div style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 6 }}>
          Cobrar en semana
          <input type="number" value={semanaCobro}
            onChange={e => setSemanaCobro(Number(e.target.value) || semanaCobro)}
            style={{ width: 64, padding: "5px 6px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 6 }} />
        </div>
        <button onClick={exportar} disabled={loading || !visibles.length}
          style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, background: "#fff", color: "#1a3a6b", border: "1px solid #1a3a6b", borderRadius: 6, cursor: (loading || !visibles.length) ? "not-allowed" : "pointer", opacity: (loading || !visibles.length) ? 0.5 : 1 }}>
          Descargar Excel
        </button>
        <button onClick={agregarSeleccionados} disabled={!!guardando || loading || !nSeleccionados}
          title="Agrega los casos tildados que tengan empresa resuelta"
          style={{ padding: "7px 14px", fontSize: 11, fontWeight: 700, background: "#15803d", color: "#fff", border: "none", borderRadius: 6, cursor: (!!guardando || loading || !nSeleccionados) ? "not-allowed" : "pointer", opacity: (!!guardando || loading || !nSeleccionados) ? 0.5 : 1 }}>
          {guardando === "todos" ? "Agregando…" : `Agregar seleccionados (${nSeleccionados})`}
        </button>
        <button onClick={() => cargar(semana)} disabled={loading}
          style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 6, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Pendientes de cobro" valor={pendientes.length} sub={`${visibles.length} cobrables en la semana`} />
        <Kpi label="Enviados a facturación" valor={nFacturados} />
        <Kpi label="Sin comprobante cargado" valor={nSinComprobante} sub={nSinComprobante ? "el supervisor respondió sin foto" : "ninguno esta semana"} />
        <Kpi label="Monto por cobrar" valor={money(totalPend)} sub="suma del valor del paquete" />
        <Kpi label="Sin empresa" valor={sinEmpresa} sub={sinEmpresa ? "requieren revisar la placa" : "todos resueltos"} />
        {yaNoCobrables ? <Kpi label="Ya no cobrables" valor={yaNoCobrables} sub="cambiaron de estado en MELI" /> : null}
      </div>

      {msg ? (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: 6, fontSize: 12,
          background: msg.ok ? "#e8f5e9" : "#fdecea", color: msg.ok ? "#1b5e20" : "#7f1d1d",
        }}>{msg.txt}</div>
      ) : null}

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 28 }}>
                <input type="checkbox" checked={todosTildados}
                  onChange={e => {
                    const v = e.target.checked; const sel = { ...seleccion };
                    for (const f of cobrables) sel[f.case_id] = v;
                    setSeleccion(sel);
                  }} />
              </th>
              <th style={th}>PNR</th>
              <th style={th}>Motivo del cobro</th>
              <th style={th}>Pasó a cobro</th>
              <th style={{ ...th, textAlign: "right" }}>Monto</th>
              <th style={th}>Chofer</th>
              <th style={th}>Placa</th>
              <th style={th}>SC</th>
              <th style={th}>Ruta</th>
              <th style={th}>Empresa transportista</th>
              <th style={th}>Avisos</th>
              <th style={{ ...th, textAlign: "right" }}>Cobro</th>
            </tr>
          </thead>
          <tbody>
            {!loading && !visibles.length ? (
              <tr><td style={{ ...td, textAlign: "center", color: "#94a3b8", padding: 30 }} colSpan={12}>
                Sin PNR facturados en esta semana.
              </td></tr>
            ) : null}
            {visibles.map(f => {
              const ya = cobrados[String(f.case_id)];
              return (
                <Fragment key={f.case_id}>
                  <tr style={{ background: abierto === f.case_id ? "#f8fafc" : (ya ? "#fbfdfb" : "transparent") }}>
                    <td style={td}>
                      {!ya && !bloqueo(f) ? (
                        <input type="checkbox" checked={!!seleccion[f.case_id]}
                          onChange={e => setSeleccion(s2 => ({ ...s2, [f.case_id]: e.target.checked }))} />
                      ) : null}
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {f.case_id}
                      {f.sin_avisos ? (
                        <div style={{ fontSize: 9, color: "#b45309", fontWeight: 600 }}>nació facturado</div>
                      ) : null}
                    </td>
                    <td style={td}><ChipMotivo sub={f.sub_cobro} estadoActual={f.sub_estado} />
                      {!f.sub_cobro ? (
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{f.sub_estado || "—"}</div>
                      ) : null}</td>
                    <td style={td}>{fechaHora(f.facturado_en)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(f.monto)}</td>
                    <td style={td}>{f.conductor || "—"}</td>
                    <td style={td}>{f.placa || <span style={{ color: "#b45309" }}>sin placa</span>}</td>
                    <td style={td}>{f.service_center || "—"}</td>
                    <td style={td}>
                      {f.route_id || "—"}
                      <div style={{ fontSize: 9, color: "#94a3b8" }}>
                        {f.route_code || ""}
                      </div>
                      <div style={{ fontSize: 9, color: "#94a3b8" }}>
                        {soloFecha(f.fecha_ruta)}{f.semana_ruta != null ? ` · sem ${f.semana_ruta}` : ""}
                      </div>
                    </td>
                    <td style={td}>
                      {f.empresa
                        ? f.empresa
                        : <span style={{ color: "#b45309", fontWeight: 600 }}>por asignar</span>}
                    </td>
                    <td style={{ ...td, cursor: "pointer" }} onClick={() => setAbierto(abierto === f.case_id ? null : f.case_id)}>
                      {f.sin_avisos
                        ? <span style={{ fontSize: 10, color: "#94a3b8" }}>sin avisos</span>
                        : f.resumen_avisos.map(([tipo, n]) => <ChipResumen key={tipo} label={tipo} n={n} />)}
                      <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
                        {abierto === f.case_id ? "ocultar detalle" : "ver detalle"}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {ya ? (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#1b5e20" }}>cobrado</div>
                          <div style={{ fontSize: 9, color: "#94a3b8" }}>
                            {ya.asignado_por} · {fechaHora(ya.enviado_a_cobro_en)}
                          </div>
                          <div style={{ fontSize: 9, color: "#94a3b8" }}>sem {ya.semana}</div>
                          <button onClick={() => quitar(f, ya)} disabled={guardando === f.case_id}
                            title="Sacar la línea de la conciliación y liberar el caso"
                            style={{
                              marginTop: 4, padding: "3px 10px", fontSize: 10, fontWeight: 600,
                              borderRadius: 5, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c",
                              cursor: guardando === f.case_id ? "not-allowed" : "pointer",
                              opacity: guardando === f.case_id ? 0.5 : 1,
                            }}>
                            {guardando === f.case_id ? "Quitando…" : "Quitar"}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => agregar(f)} disabled={guardando === f.case_id || !f.empresa || !f.sub_cobro}
                          title={!f.sub_cobro ? "El caso ya no está en un estado cobrable" : (!f.empresa ? "Falta resolver la empresa transportista" : "Agregar como línea negativa a la conciliación")}
                          style={{
                            padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 6, border: "none",
                            background: (f.empresa && f.sub_cobro) ? "#1a3a6b" : "#e4e7ec", color: (f.empresa && f.sub_cobro) ? "#fff" : "#94a3b8",
                            cursor: (guardando === f.case_id || !f.empresa || !f.sub_cobro) ? "not-allowed" : "pointer",
                            opacity: guardando === f.case_id ? 0.5 : 1,
                          }}>
                          {guardando === f.case_id ? "Agregando…" : "Agregar"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {abierto === f.case_id ? (
                    <tr>
                      <td colSpan={12} style={{ padding: "10px 14px 14px 14px", background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
                          Historial de avisos
                        </div>
                        <DetalleAvisos lista={f.avisos} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
