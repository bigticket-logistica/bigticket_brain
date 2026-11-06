import { useCallback, useEffect, useMemo, useState } from "react";
import { fechaHoyOperativa, sb } from "./shared";

// ═══════════════════════════════════════════════════════════════════
//  MALLA DE TURNOS MX
//  Grupo fijo (sale 6 días, descanso rotativo) + reserva para los picos, por SC.
//  Se calcula sola cada vez que se abre, con los datos que el Brain ya guarda:
//   · Demanda: pedidos de MELI de las últimas 12 semanas (mx_pedidos_estado)
//   · Flota: vehículos que trabajaron las últimas 2 semanas (vs_rutas_ejecutadas)
//   · Empresa, tipo y estado: inventario de flota de Terceros (inventario_flota)
//   · Supervisor: supervisores_bt
// ═══════════════════════════════════════════════════════════════════

const NAVY = "#002E5D", MUTED = "#5b6474", BORDER = "#e4e7ec";
const DIAS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];
const ANCLA = "2026-11-02"; // lunes desde el que se cuenta la rotación de descansos
// SC que comparten vehículos: se planifican como un solo grupo
const GRUPOS_JUNTOS = [["SMX10", "SMX20", "SMX22", "SMXRV1"], ["SMX2", "SMX9"]];
// SC de Chile que se cuelan en los pedidos: los de la lista y cualquiera que empiece con "E"
const LISTA_CHILE = ["SIL1", "SLT1", "SBB1", "SRM1", "SRM2", "SRM3", "SRM4", "SAR1", "SLS1", "SVP3"];
const EXCLUIR = { includes: sc => !sc || LISTA_CHILE.includes(sc) || String(sc).startsWith("E") };
// Ajustado con la prueba de octubre 2026: 8 semanas, las recientes pesan más (vida media de 1 semana)
// y cada SC se cuenta desde su primer día con pedidos. Error del pronóstico: 43% → 30%.
const SEMANAS_DEMANDA = 8, VIDA_MEDIA = 1, DIAS_FLOTA = 14, MIN_RUTAS_SEMANA = 7;

const sumarDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lunesDe = iso => { const d = new Date(iso + "T12:00:00Z"); const w = (d.getUTCDay() + 6) % 7; return sumarDias(iso, -w); };
const diaSemana = iso => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;
const fechaCorta = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const normPlaca = p => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^SDD/, "");
const grupoDe = sc => { const g = GRUPOS_JUNTOS.find(x => x.includes(sc)); return g ? g.join(" · ") : sc; };
const percentilPond = (vals, pesos, p) => { if (!vals.length) return 0; const o = vals.map((v, i) => [v, pesos[i]]).sort((a, b) => a[0] - b[0]); const tot = o.reduce((a, x) => a + x[1], 0); let acc = 0; for (const [v, w] of o) { acc += w; if (acc / tot >= p) return v; } return o[o.length - 1][0]; };

async function traerTodo(tabla, cols, filtro) {
  const out = [];
  for (let pag = 0; ; pag += 1000) {
    let q = sb.from(tabla).select(cols).range(pag, pag + 999);
    q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Arma la malla de un grupo para la semana que empieza en "lunes"
function armarMalla(g, lunes) {
  const { base, pico } = g;
  const N = Math.max(Math.ceil(base.reduce((a, b) => a + b, 0) / 6), Math.max(...base), 0);
  // Descansos: uno por vehículo fijo, en los días con más holgura (menos demanda)
  const descansos = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    let mejor = 0;
    for (let d = 1; d < 7; d++) if ((N - base[d]) - descansos[d] > (N - base[mejor]) - descansos[mejor]) mejor = d;
    descansos[mejor]++;
  }
  const slots = DIAS.flatMap((_, d) => Array(descansos[d]).fill(d));
  const semana = Math.round((new Date(lunes + "T12:00:00Z") - new Date(ANCLA + "T12:00:00Z")) / (7 * 864e5));
  const vehiculos = g.vehiculos;
  const fijos = vehiculos.slice(0, N);
  const reserva = vehiculos.slice(N);
  const filas = [
    ...fijos.map(v => ({ ...v, rol: "Fijo" })),
    ...Array(Math.max(0, N - fijos.length)).fill(0).map((_, i) => ({ placa: "VACANTE", empresa: "Falta un vehículo para el grupo fijo", rol: "Fijo", vacante: true, k: `vf${i}` })),
    ...reserva.map(v => ({ ...v, rol: "Reserva" })),
  ];
  // Días del grupo fijo: T o D según la rotación
  let fi = 0;
  for (const f of filas) {
    f.dias7 = Array(7).fill("—");
    if (f.rol === "Fijo") {
      const d = N ? slots[(((fi + semana) % N) + N) % N] : -1;
      f.dias7 = f.dias7.map((_, i) => (i === d ? "D" : "T"));
      fi++;
    }
  }
  const trabajan = DIAS.map((_, d) => filas.filter(f => f.rol === "Fijo" && f.dias7[d] === "T").length);
  const necesidad = DIAS.map((_, d) => Math.max(0, pico[d] - trabajan[d]));
  // Reserva: se llama por turnos a los vehículos de reserva que hacen falta cada día
  const res = filas.filter(f => f.rol === "Reserva");
  let ptr = res.length ? ((semana * necesidad.reduce((a, b) => a + b, 0)) % res.length + res.length) % res.length : 0;
  const faltaReserva = [0, 0, 0, 0, 0, 0, 0];
  const usos = res.map(() => 0); // nadie de la reserva sale más de 6 días en la semana
  for (let d = 0; d < 7; d++) {
    let k = necesidad[d], vistos = 0;
    while (k > 0 && vistos < res.length) {
      const i = ptr % res.length; ptr++; vistos++;
      if (usos[i] < 6) { res[i].dias7[d] = "R"; usos[i]++; k--; }
    }
    faltaReserva[d] = k;
  }
  const llamados = DIAS.map((_, d) => res.filter(f => f.dias7[d] === "R").length);
  return { N, descansos, filas, trabajan, llamados, necesidad, faltaReserva, vacFijos: Math.max(0, N - fijos.length), reservaMax: Math.max(...necesidad, 0) };
}


// Demanda, flota y supervisor por grupo de SC, para una ventana de fechas
function construirGrupos(datos, desdeDem, hastaDem, desdeFlota, hastaFlota) {
  const { ped, rutas, inv, sup } = datos;
  // Demanda por SC y fecha
  const porFecha = {}, inicioSc = {};
  for (const p of ped) {
    if (!p.facility_id || EXCLUIR.includes(p.facility_id) || p.status === "pending" || p.fecha_ruta < desdeDem || p.fecha_ruta > hastaDem) continue;
    const k = `${p.facility_id}|${p.fecha_ruta}`;
    const x = (porFecha[k] = porFecha[k] || { reg: 0, urg: 0 });
    if (p.tipo === "urgent") x.urg++; else x.reg++;
    if (!inicioSc[p.facility_id] || p.fecha_ruta < inicioSc[p.facility_id]) inicioSc[p.facility_id] = p.fecha_ruta;
  }
  const ref = sumarDias(hastaDem, 1);
  const nombresG = [...new Set(Object.keys(inicioSc).map(grupoDe))];
  const diasPlaca = {};
  for (const r of rutas) {
    if (!r.placa_norm || EXCLUIR.includes(r.svc) || r.fecha < desdeFlota || r.fecha > hastaFlota) continue;
    const k = `${r.placa_norm}|${r.svc}`;
    (diasPlaca[k] = diasPlaca[k] || new Set()).add(r.fecha);
  }
  const porPlaca = {};
  for (const [k, set] of Object.entries(diasPlaca)) {
    const [p, sc] = k.split("|");
    const x = (porPlaca[p] = porPlaca[p] || { placa: p, total: 0, mejorSc: sc, mejorN: 0 });
    x.total += set.size;
    if (set.size > x.mejorN) { x.mejorN = set.size; x.mejorSc = sc; }
  }
  const invMap = {};
  for (const v of inv) invMap[normPlaca(v.placa)] = v;
  const supMap = {};
  for (const s of sup) for (const sc of (Array.isArray(s.scs_asignados) ? s.scs_asignados : [])) (supMap[sc] = supMap[sc] || []).push(s.nombre);
  return nombresG.map(nombre => {
    const scs = nombre.split(" · ");
    // Cada SC desde su primer día con pedidos; las semanas recientes pesan más (vida media VIDA_MEDIA)
    const B = Array(7).fill(0), P = Array(7).fill(0), U = Array(7).fill(0);
    for (const sc of scs) {
      if (!inicioSc[sc]) continue;
      for (let d = 0; d < 7; d++) {
        const reg = [], urg = [], w = [];
        for (let f = inicioSc[sc]; f <= hastaDem; f = sumarDias(f, 1)) {
          if (diaSemana(f) !== d) continue;
          const x = porFecha[`${sc}|${f}`] || { reg: 0, urg: 0 };
          const edad = (new Date(ref + "T12:00:00Z") - new Date(f + "T12:00:00Z")) / (7 * 864e5);
          reg.push(x.reg); urg.push(x.urg); w.push(Math.pow(0.5, edad / VIDA_MEDIA));
        }
        if (!reg.length) continue;
        const tw = w.reduce((a, b) => a + b, 0);
        B[d] += reg.reduce((a, v, i) => a + v * w[i], 0) / tw;
        U[d] += urg.reduce((a, v, i) => a + v * w[i], 0) / tw;
        P[d] += percentilPond(reg, w, 0.8);
      }
    }
    // Pronóstico ingenuo: las rutas regulares del mismo día de la semana más reciente
    const I = Array(7).fill(0);
    for (const sc of scs) for (let f = sumarDias(hastaDem, -6); f <= hastaDem; f = sumarDias(f, 1)) I[diaSemana(f)] += (porFecha[`${sc}|${f}`] || { reg: 0 }).reg;
    const baseModelo = B.map(v => Math.floor(v + 1e-9)), baseModeloExacta = B, baseIngenuo = I;
    const picoReg = P.map(v => Math.ceil(v - 1e-9)), pico = P.map((v, d) => Math.ceil(v + U[d] - 1e-9));
    const base = baseModelo;
    const vehiculos = Object.values(porPlaca).filter(v => grupoDe(v.mejorSc) === nombre)
      .map(v => { const i = invMap[v.placa] || {}; return { placa: v.placa, dias: v.total, empresa: i.empresa || "No está en el inventario", tipo: i.tipo || "—", estado: i.status ? i.status : (i.placa ? "ACTIVO" : "—"), k: v.placa }; })
      .sort((a, b) => b.dias - a.dias);
    const supervisores = [...new Set(scs.flatMap(sc => supMap[sc] || []))];
    return { nombre, scs, base, pico, picoReg, baseModelo, baseModeloExacta, baseIngenuo, vehiculos, supervisor: supervisores.join(" · ") || "—" };
  }).filter(g => g.base.reduce((a, b) => a + b, 0) >= MIN_RUTAS_SEMANA)
    .sort((a, b) => b.base.reduce((x, y) => x + y, 0) - a.base.reduce((x, y) => x + y, 0));
}

// ¿Qué pronóstico le acierta más a cada SC? Se compara en las últimas 4 semanas completas, cada una
// pronosticada solo con lo anterior. La malla usa el que ganó en cada SC (así aprende con evidencia).
// Alarmas: error de más del 35% o pico regular cumplido menos del 70% de los días en las últimas 2 semanas.
const ERROR_MAX = 0.35, PICO_MIN = 0.7, VENTAJA_MIN = 0.03;
function evaluarPronosticos(datos, hoy) {
  const regReal = {};
  for (const p of datos.ped) {
    if (!p.facility_id || EXCLUIR.includes(p.facility_id) || p.status === "pending" || p.tipo === "urgent") continue;
    const k = `${grupoDe(p.facility_id)}|${p.fecha_ruta}`; regReal[k] = (regReal[k] || 0) + 1;
  }
  const lunesHoy = lunesDe(hoy), acc = {};
  for (let w = 4; w >= 1; w--) {
    const lunes = sumarDias(lunesHoy, -7 * w);
    const gs = construirGrupos(datos, sumarDias(lunes, -7 * SEMANAS_DEMANDA), sumarDias(lunes, -1), sumarDias(lunes, -DIAS_FLOTA), sumarDias(lunes, -1));
    for (const g of gs) {
      const a = (acc[g.nombre] = acc[g.nombre] || { real: 0, eM: 0, eI: 0, real2: 0, eM2: 0, eI2: 0, dias2: 0, pico2: 0 });
      for (let d = 0; d < 7; d++) {
        const f = sumarDias(lunes, d); if (f >= hoy) continue;
        const r = regReal[`${g.nombre}|${f}`] || 0;
        const eM = Math.abs(r - g.baseModeloExacta[d]), eI = Math.abs(r - g.baseIngenuo[d]);
        a.real += r; a.eM += eM; a.eI += eI;
        if (w <= 2) { a.real2 += r; a.eM2 += eM; a.eI2 += eI; a.dias2++; if (r <= g.picoReg[d]) a.pico2++; }
      }
    }
  }
  const out = {};
  for (const [nombre, a] of Object.entries(acc)) {
    const errM = a.real ? a.eM / a.real : null, errI = a.real ? a.eI / a.real : null;
    // Probado 26 sep–1 nov 2026: "la semana pasada" ganó 4 de 5 semanas. Queda como base y el promedio
    // ponderado solo la reemplaza en un SC si le gana por 3 puntos o más en las últimas 4 semanas.
    const metodo = errM !== null && errI !== null && errM <= errI - VENTAJA_MIN ? "malla" : "ingenuo";
    const err2 = a.real2 ? (metodo === "ingenuo" ? a.eI2 : a.eM2) / a.real2 : null;
    const pico2 = a.dias2 ? a.pico2 / a.dias2 : null;
    const alarmas = [];
    if (err2 !== null && err2 > ERROR_MAX) alarmas.push(`error del ${Math.round(err2 * 100)}% en 2 semanas`);
    if (pico2 !== null && pico2 < PICO_MIN) alarmas.push(`el pico alcanzó solo el ${Math.round(pico2 * 100)}% de los días`);
    out[nombre] = { errM, errI, metodo, err2, pico2, alarmas };
  }
  return out;
}
// Aplica a cada SC el pronóstico que ganó
function aplicarMetodo(g, ev) {
  const e = ev && ev[g.nombre];
  if (e && e.metodo === "malla") return { ...g, metodo: "malla" };
  const base = g.baseIngenuo.map(v => Math.round(v));
  return { ...g, base, pico: g.pico.map((v, d) => Math.max(v, base[d])), metodo: "ingenuo" };
}

// Prueba con lo que pasó: para cada semana, la malla se arma solo con los datos anteriores a esa semana
// y se compara su capacidad con lo que MELI ofreció y lo que se aceptó, rechazó y ejecutó de verdad.
const SEMANAS_PRUEBA = 4;
function probarMalla(datos, hoy) {
  const real = {};
  for (const p of datos.ped) {
    if (!p.facility_id || EXCLUIR.includes(p.facility_id) || p.status === "pending") continue;
    const k = `${grupoDe(p.facility_id)}|${p.fecha_ruta}`;
    const x = (real[k] = real[k] || { of: 0, ac: 0, ej: 0, naReg: 0, naUrg: 0 });
    x.of++;
    if (p.status === "accepted") { x.ac++; if (["started", "finished"].includes(p.travel_status_final)) x.ej++; }
    if (p.status === "rejected" || p.status === "expired") p.tipo === "urgent" ? x.naUrg++ : x.naReg++;
  }
  const lunesHoy = lunesDe(hoy), desde = sumarDias(lunesHoy, -7 * SEMANAS_PRUEBA), hasta = sumarDias(hoy, -1);
  const acc = {};
  for (let w = SEMANAS_PRUEBA; w >= 0; w--) {
    const lunes = sumarDias(lunesHoy, -7 * w);
    const gs = construirGrupos(datos, sumarDias(lunes, -7 * SEMANAS_DEMANDA), sumarDias(lunes, -1), sumarDias(lunes, -DIAS_FLOTA), sumarDias(lunes, -1));
    for (const g of gs) {
      const m = armarMalla(g, lunes);
      const a = (acc[g.nombre] = acc[g.nombre] || { nombre: g.nombre, of: 0, ac: 0, ej: 0, cap: 0, naReg: 0, naUrg: 0, cubReg: 0, cubUrg: 0, dias: 0, diasOk: 0, sobre: 0, noShow: 0 });
      for (let d = 0; d < 7; d++) {
        const f = sumarDias(lunes, d);
        if (f >= hoy) continue;
        const r = real[`${g.nombre}|${f}`] || { of: 0, ac: 0, ej: 0, naReg: 0, naUrg: 0 };
        const cap = m.trabajan[d] + m.llamados[d];
        const libre = Math.max(0, cap - r.ac);           // lo que la malla podía tomar además de lo aceptado
        const cReg = Math.min(r.naReg, libre), cUrg = Math.min(r.naUrg, libre - cReg);
        a.of += r.of; a.ac += r.ac; a.ej += r.ej; a.cap += cap; a.naReg += r.naReg; a.naUrg += r.naUrg; a.cubReg += cReg; a.cubUrg += cUrg;
        a.dias++; if (r.of <= cap) a.diasOk++;
        a.sobre += Math.max(0, r.ac - cap); a.noShow += r.ac - r.ej;
      }
    }
  }
  const filas = Object.values(acc).filter(a => a.dias > 0).sort((x, y) => (y.naReg + y.naUrg) - (x.naReg + x.naUrg));
  return { desde, hasta, filas };
}

// ─── Mañana: las tres capas del día siguiente, con lo ya publicado por MELI ───────────────
// Probado con octubre 2026: Spot de mañana = publicado a las 18:00 + 0,75 × (lo que llegó después, 25% la
// semana pasada y 75% ayer) + colchón (error no superado 9 de cada 10 días en las últimas 4 semanas).
const TZ_MX_MS = -6 * 3600e3; // Ciudad de México, sin horario de verano
const PESO_FALTA = 0.75, PESO_SEM_PASADA = 0.25, META_COLCHON = 0.9, DIAS_COLCHON = 28, DIAS_GUARDIA = 14;
function planManana(datos, hoy, grupos, evaluacion, publicadas = {}) {
  const manana = sumarDias(hoy, 1);
  const capa = p => (p.tipo === "urgent" ? "urg" : p.es_sdd ? "sdd" : "spot");
  // Por grupo y fecha: total por capa, y Spot publicado antes de las 18:00 del día anterior
  const T = {};
  for (const p of datos.ped) {
    if (!p.facility_id || EXCLUIR.includes(p.facility_id)) continue;
    const g = grupoDe(p.facility_id), f = p.fecha_ruta, c = capa(p);
    const x = (T[`${g}|${f}`] = T[`${g}|${f}`] || { sdd: 0, spot: 0, urg: 0, spot18: 0, urgMismoDia: 0 });
    if (p.status === "pending" && f < manana) continue;
    x[c]++;
    const creado = p.creado_meli ? new Date(new Date(p.creado_meli).getTime() + TZ_MX_MS) : null;
    const corte = new Date(sumarDias(f, -1) + "T18:00:00Z");
    if (c === "spot" && (!creado || creado < corte)) x.spot18++;
    if (c === "urg" && creado && creado.toISOString().slice(0, 10) >= f) x.urgMismoDia++;
  }
  const v = (g, f, c) => (T[`${g}|${f}`] || {})[c] || 0;
  const falta = (g, f) => v(g, f, "spot") - v(g, f, "spot18");
  const estimaFalta = (g, f) => PESO_FALTA * (PESO_SEM_PASADA * falta(g, sumarDias(f, -7)) + (1 - PESO_SEM_PASADA) * falta(g, sumarDias(f, -1)));
  const cuantil = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };
  return grupos.map(g => {
    const n = g.nombre;
    // SDD: contrato = lo ofrecido el mismo día de la semana pasada; y lo ya publicado para mañana
    const sddContrato = v(n, sumarDias(manana, -7), "sdd"), sddPublicado = v(n, manana, "sdd");
    const spotPublicado = v(n, manana, "spot"), spotFalta = Math.round(estimaFalta(n, manana));
    const res = []; for (let j = 1; j <= DIAS_COLCHON; j++) { const f = sumarDias(manana, -j); res.push(v(n, f, "spot") - (v(n, f, "spot18") + estimaFalta(n, f))); }
    const colchon = Math.max(0, Math.ceil(cuantil(res, META_COLCHON)));
    const urgAvisados = v(n, manana, "urg");
    // Guardia para urgentes del mismo día: percentil 90 de los últimos 14 días (binomial negativa aproximada por cuantil empírico)
    const mismo = []; for (let j = 1; j <= DIAS_GUARDIA; j++) mismo.push(v(n, sumarDias(manana, -j), "urgMismoDia"));
    const guardia = Math.ceil(cuantil(mismo, 0.9));
    const total = Math.max(sddContrato, sddPublicado) + spotPublicado + spotFalta + colchon + urgAvisados;
    // Vehículos de la malla para mañana
    const d = diaSemana(manana), pub = publicadas[`${lunesDe(manana)}|${n}`];
    let fijos, reserva;
    if (pub) { fijos = pub.filas.filter(f => f.rol === "Fijo" && f.dias7[d] === "T").length; reserva = pub.filas.filter(f => f.rol === "Reserva" && !f.vacante).length; }
    else { const m = armarMalla(g, lunesDe(manana)); fijos = m.trabajan[d]; reserva = m.filas.filter(f => f.rol === "Reserva").length; }
    return { nombre: n, supervisor: g.supervisor, sddContrato, sddPublicado, spotPublicado, spotFalta, colchon, urgAvisados, total, fijos, reserva, brecha: total - fijos - reserva, guardia };
  });
}

export default function MallaTurnosMX() {
  const hoy = fechaHoyOperativa();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [grupoSel, setGrupoSel] = useState(null);
  const [semanaSel, setSemanaSel] = useState(0);
  const [verComo, setVerComo] = useState(false);
  const [publicadas, setPublicadas] = useState({});   // { `${semana}|${grupo}`: { filas, base, pico, publicado_por, publicado_at, actualizado_at } }
  const [edicion, setEdicion] = useState(null);        // filas en edición de la malla publicada que se está viendo
  const [guardando, setGuardando] = useState(false);
  const cargarPublicadas = useCallback(async () => {
    const desde = lunesDe(hoy), hasta = sumarDias(desde, 21);
    const { data } = await sb.from("malla_publicada").select("semana, grupo, filas, base, pico, publicado_por, publicado_at, actualizado_at").gte("semana", desde).lte("semana", hasta);
    const m = {}; for (const r of (data || [])) m[`${r.semana}|${r.grupo}`] = r; setPublicadas(m);
  }, [hoy]);
  useEffect(() => { cargarPublicadas(); }, [cargarPublicadas]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const desdeDem = sumarDias(lunesDe(hoy), -7 * (SEMANAS_DEMANDA + 4)), hastaDem = sumarDias(hoy, -1);
        const desdeFlota = sumarDias(hoy, -DIAS_FLOTA - 7 * 4), hastaFlota = sumarDias(hoy, -1);
        const [ped, rutas, inv, sup] = await Promise.all([
          traerTodo("mx_pedidos_estado", "facility_id, fecha_ruta, status, tipo, es_sdd, creado_meli, travel_status_final", q => q.gte("fecha_ruta", desdeDem).lte("fecha_ruta", sumarDias(hoy, 1)).neq("status", "canceled").order("request_id")),
          traerTodo("vs_rutas_ejecutadas", "fecha, svc, placa_norm", q => q.gte("fecha", desdeFlota).lte("fecha", hastaFlota).order("fecha")),
          traerTodo("inventario_flota", "placa, empresa, tipo, status", q => q),
          sb.from("supervisores_bt").select("nombre, scs_asignados").eq("activo", true).then(r => r.data || []),
        ]);
        if (vivo) setDatos({ ped, rutas, inv, sup, desdeDem, hastaDem, desdeFlota, hastaFlota });
      } catch (e) { if (vivo) setError(e.message); }
    })();
    return () => { vivo = false; };
  }, [hoy]);

  const vent = useMemo(() => ({ dDem: sumarDias(lunesDe(hoy), -7 * SEMANAS_DEMANDA), hDem: sumarDias(hoy, -1), dFlo: sumarDias(hoy, -DIAS_FLOTA), hFlo: sumarDias(hoy, -1) }), [hoy]);
  const evaluacion = useMemo(() => (datos ? evaluarPronosticos(datos, hoy) : null), [datos, hoy]);
  const grupos = useMemo(() => (datos ? construirGrupos(datos, vent.dDem, vent.hDem, vent.dFlo, vent.hFlo).map(g => aplicarMetodo(g, evaluacion)) : []), [datos, vent, evaluacion]);
  const prueba = useMemo(() => (datos ? probarMalla(datos, hoy) : null), [datos, hoy]);
  const manana = useMemo(() => (datos && grupos.length ? planManana(datos, hoy, grupos, evaluacion, publicadas) : []), [datos, hoy, grupos, evaluacion, publicadas]);

  const lunesBase = lunesDe(hoy);
  const semanas = [0, 1, 2, 3].map(i => sumarDias(lunesBase, 7 * i));
  const lunes = semanas[semanaSel];
  const resumen = useMemo(() => grupos.map(g => {
    const pub = publicadas[`${lunes}|${g.nombre}`];
    if (!pub) return { g, m: armarMalla(g, lunes), pub: null };
    const filas = pub.filas;
    const trabajan = DIAS.map((_, d) => filas.filter(f => f.rol === "Fijo" && f.dias7[d] === "T").length);
    const llamados = DIAS.map((_, d) => filas.filter(f => f.rol === "Reserva" && f.dias7[d] === "R").length);
    const necesidad = DIAS.map((_, d) => Math.max(0, (pub.pico || g.pico)[d] - trabajan[d]));
    const N = filas.filter(f => f.rol === "Fijo").length, vacFijos = filas.filter(f => f.rol === "Fijo" && f.vacante).length;
    return { g: { ...g, base: pub.base || g.base, pico: pub.pico || g.pico }, m: { N, filas, trabajan, llamados, necesidad, faltaReserva: necesidad.map((k, d) => Math.max(0, k - llamados[d])), vacFijos, reservaMax: Math.max(...necesidad, 0) }, pub };
  }), [grupos, lunes, publicadas]);
  const sel = resumen.find(x => x.g.nombre === grupoSel) || resumen[0];
  useEffect(() => { setEdicion(null); }, [grupoSel, semanaSel]);
  const usuario = () => { try { return window.localStorage.getItem("usuario") || window.localStorage.getItem("brain_usuario") || "Brain"; } catch { return "Brain"; } };
  const publicar = async () => {
    if (!sel || guardando) return; setGuardando(true);
    const filas = sel.m.filas.map(f => ({ placa: f.placa, empresa: f.empresa, tipo: f.tipo, estado: f.estado, dias: f.dias, rol: f.rol, vacante: !!f.vacante, k: f.k, dias7: f.dias7 }));
    const { error: e } = await sb.from("malla_publicada").upsert({ semana: lunes, grupo: sel.g.nombre, filas, base: sel.g.base, pico: sel.g.pico, publicado_por: usuario(), publicado_at: new Date().toISOString(), actualizado_at: new Date().toISOString() }, { onConflict: "semana,grupo" });
    setGuardando(false);
    if (e) { alert("No se pudo publicar: " + e.message); return; }
    await cargarPublicadas();
  };
  const guardarCambios = async () => {
    if (!sel || !edicion || guardando) return; setGuardando(true);
    const { error: e } = await sb.from("malla_publicada").update({ filas: edicion, actualizado_at: new Date().toISOString() }).eq("semana", lunes).eq("grupo", sel.g.nombre);
    setGuardando(false);
    if (e) { alert("No se pudo guardar: " + e.message); return; }
    setEdicion(null); await cargarPublicadas();
  };
  const volverACalcular = async () => {
    if (!sel || !window.confirm("Se borra la malla publicada de esta semana y se vuelve a calcular con los datos de hoy. ¿Seguir?")) return;
    const { error: e } = await sb.from("malla_publicada").delete().eq("semana", lunes).eq("grupo", sel.g.nombre);
    if (e) { alert("No se pudo borrar: " + e.message); return; }
    setEdicion(null); await cargarPublicadas();
  };
  const SIG = { T: "D", D: "R", R: "—", "—": "T" };
  const tocarDia = (i, d) => { const base = edicion || sel.m.filas; const nuevo = base.map((f, j) => (j === i ? { ...f, dias7: f.dias7.map((v, k) => (k === d ? SIG[v] || "T" : v)) } : f)); setEdicion(nuevo); };
  const tocarRol = i => { const base = edicion || sel.m.filas; setEdicion(base.map((f, j) => (j === i ? { ...f, rol: f.rol === "Fijo" ? "Reserva" : "Fijo" } : f))); };

  const card = { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "18px 22px" };
  const th = { padding: "7px 8px", fontSize: 11, color: MUTED, fontWeight: 600, textAlign: "center", borderBottom: `1px solid ${BORDER}` };
  const td = { padding: "6px 8px", fontSize: 12, textAlign: "center", borderBottom: "1px solid #f0f1f3" };
  const color = v => v === "T" ? { background: "#dbe7fb", color: NAVY, fontWeight: 700 } : v === "D" ? { background: "#eeeeee", color: MUTED } : v === "R" ? { background: "#fde5d4", color: "#9a3c06", fontWeight: 700 } : { color: "#c4c8cf" };

  if (error) return <div style={{ ...card, color: "#b42318" }}>No se pudo cargar la malla: {error}</div>;
  if (!datos) return <div style={{ ...card, color: MUTED }}>Calculando la malla con los datos de MELI…</div>;

  const tot = resumen.reduce((a, { m }) => ({ fijo: a.fijo + m.N, vacF: a.vacF + m.vacFijos, res: a.res + m.reservaMax, vacR: a.vacR + Math.max(...m.faltaReserva, 0) }), { fijo: 0, vacF: 0, res: 0, vacR: 0 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>Malla de turnos</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
              Grupo fijo que sale 6 días con descanso rotativo, y reserva para los días pico. Se recalcula sola cada vez que se abre: demanda de las últimas {SEMANAS_DEMANDA} semanas ({fechaCorta(vent.dDem)} al {fechaCorta(vent.hDem)}) y flota que trabajó del {fechaCorta(vent.dFlo)} al {fechaCorta(vent.hFlo)}.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {semanas.map((s, i) => (
              <button key={s} onClick={() => setSemanaSel(i)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${i === semanaSel ? NAVY : BORDER}`, background: i === semanaSel ? NAVY : "#fff", color: i === semanaSel ? "#fff" : NAVY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {i === 0 ? "Esta semana" : `Semana del ${fechaCorta(s)}`}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          {[["Grupo fijo necesario", tot.fijo, NAVY], ["Vacantes del grupo fijo", tot.vacF, tot.vacF ? "#b42318" : "#15803d"], ["Reserva necesaria (día más alto de cada SC)", tot.res, "#9a3c06"], ["Reserva que falta conseguir", tot.vacR, tot.vacR ? "#b42318" : "#15803d"]].map(([t, v, c]) => (
            <div key={t} style={{ flex: "1 1 180px", background: "#f6f7f9", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ fontSize: 12, color: MUTED }}>{t}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: c }}>{v}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setVerComo(!verComo)} style={{ marginTop: 12, background: "none", border: "none", color: NAVY, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}>{verComo ? "▾" : "▸"} Cómo se calcula</button>
        {verComo && (
          <div style={{ fontSize: 13, color: "#2b3038", lineHeight: 1.6, marginTop: 6 }}>
            <b>1. Demanda:</b> <b>Base</b> = las rutas regulares que MELI ofreció el mismo día de la semana pasada (la prueba de octubre mostró que es lo que mejor acierta). Si en un SC el promedio de las últimas {SEMANAS_DEMANDA} semanas, con más peso a las recientes, acierta 3 puntos más, se usa ese. <b>Pico</b> = el nivel que se supera 1 de cada 5 días en esas semanas, más los urgentes<br />
            <b>2. Grupo fijo:</b> rutas base de la semana ÷ 6 días de trabajo. Así, cada vehículo fijo tiene trabajo los 6 días que le toca salir.<br />
            <b>3. Descansos:</b> uno por vehículo, en los días de menos demanda. Cada semana, cada vehículo avanza un lugar en la lista, para que nadie tenga siempre el mismo día.<br />
            <b>4. Quién es fijo:</b> los vehículos que más días trabajaron en las últimas 2 semanas. El resto queda como reserva. Si no alcanzan, aparece una <b>vacante</b>.<br />
            <b>5. Reserva:</b> cada día se llama, por turnos, a los vehículos de reserva que faltan para llegar al pico.<br />
            <b>6. Regla de aceptación:</b> cada día se acepta hasta la capacidad (fijos que trabajan + reserva llamada), primero SDD, después Spot y al final urgentes.<br />
            Los SC que comparten vehículos se planifican juntos: {GRUPOS_JUNTOS.map(g => g.join(", ")).join(" · ")}.
          </div>
        )}
      </div>

      {manana.length > 0 && (() => {
        const f = sumarDias(hoy, 1), t = manana.reduce((x, r) => { for (const k of Object.keys(r)) if (typeof r[k] === "number") x[k] = (x[k] || 0) + r[k]; return x; }, {});
        const n = v => (v ? v : "—");
        const filas = [...manana].sort((a, b) => b.total - a.total);
        return (
          <div style={{ ...card, borderColor: "#c7d6f2", background: "#f8faff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Mañana · {DIAS[diaSemana(f)]} {fechaCorta(f)} · qué hay que cubrir y con qué</div>
              <div style={{ fontSize: 12, color: MUTED }}>Se calcula con lo que MELI ya publicó hasta ahora; a las 18:00 queda casi completo</div>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              {[["Rutas a cubrir mañana", t.total, NAVY], ["SDD (contrato)", Math.max(t.sddContrato, t.sddPublicado), "#1f2937"], ["Spot: publicado + por llegar + colchón", t.spotPublicado + t.spotFalta + t.colchon, "#2f6fbf"], ["Urgentes ya avisados", t.urgAvisados, "#9a3c06"], ["Vehículos en la malla", t.fijos + t.reserva, "#15803d"], [t.brecha > 0 ? "Faltan" : "Sobran", Math.abs(t.brecha), t.brecha > 0 ? "#b42318" : "#15803d"]].map(([tt, v, c]) => (
                <div key={tt} style={{ flex: "1 1 150px", background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontSize: 12, color: MUTED }}>{tt}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980, background: "#fff" }}>
                <thead><tr>
                  {["SC", "SDD contrato", "SDD publicadas", "Spot publicado", "Spot por llegar", "Colchón", "Urgentes avisados", "Total a cubrir", "Fijos que trabajan", "Reserva", "Faltan / sobran", "Guardia para urgentes del día"].map(h => <th key={h} style={{ ...th, textAlign: h === "SC" ? "left" : "center" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filas.map(r => (
                    <tr key={r.nombre}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{r.nombre}</td>
                      <td style={td}>{n(r.sddContrato)}</td>
                      <td style={{ ...td, color: r.sddPublicado < r.sddContrato ? "#b45309" : "#1f2937" }}>{n(r.sddPublicado)}</td>
                      <td style={td}>{n(r.spotPublicado)}</td>
                      <td style={{ ...td, color: MUTED }}>{n(r.spotFalta)}</td>
                      <td style={{ ...td, color: MUTED }}>{n(r.colchon)}</td>
                      <td style={{ ...td, color: "#9a3c06" }}>{n(r.urgAvisados)}</td>
                      <td style={{ ...td, fontWeight: 800 }}>{r.total}</td>
                      <td style={td}>{r.fijos}</td>
                      <td style={td}>{n(r.reserva)}</td>
                      <td style={{ ...td, fontWeight: 800, color: r.brecha > 0 ? "#b42318" : "#15803d" }}>{r.brecha > 0 ? `faltan ${r.brecha}` : r.brecha < 0 ? `sobran ${-r.brecha}` : "justo"}</td>
                      <td style={{ ...td, color: "#9a3c06" }}>{n(r.guardia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
              <b>SDD contrato</b> = lo ofrecido el mismo día de la semana pasada. <b>Spot por llegar</b> = lo que suele publicarse después de las 18:00 (75% de peso a ayer, 25% a la semana pasada). <b>Colchón</b> = el error del Spot que no se superó 9 de cada 10 días en las últimas 4 semanas. <b>Guardia</b> = urgentes del mismo día que no se superaron 9 de cada 10 días en las últimas 2 semanas: es lo que conviene tener de guardia de 06:00 a 09:00, y se ajusta a las 09:00 con lo que ya llegó.
            </div>
          </div>
        );
      })()}

      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Resumen por SC · semana del {fechaCorta(lunes)}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead><tr>
              {["SC", "Supervisor", "Vehículos que trabajaron", "Grupo fijo", "Vacantes fijo", "Reserva necesaria", "Reserva disponible", "Reserva que falta", "Rutas base / semana", "Rutas pico / semana", "Pronóstico", "Alerta", ""].map(h => <th key={h} style={{ ...th, textAlign: h === "SC" || h === "Supervisor" ? "left" : "center" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {resumen.map(({ g, m }) => {
                const resDisp = m.filas.filter(f => f.rol === "Reserva").length, faltaR = Math.max(...m.faltaReserva, 0);
                const activo = sel && sel.g.nombre === g.nombre;
                return (
                  <tr key={g.nombre} onClick={() => setGrupoSel(g.nombre)} style={{ cursor: "pointer", background: activo ? "#eef3fc" : "transparent" }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{g.nombre}</td>
                    <td style={{ ...td, textAlign: "left", color: MUTED }}>{g.supervisor}</td>
                    <td style={td}>{g.vehiculos.length}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{m.N}</td>
                    <td style={{ ...td, color: m.vacFijos ? "#b42318" : "#15803d", fontWeight: 700 }}>{m.vacFijos || "—"}</td>
                    <td style={td}>{m.reservaMax}</td>
                    <td style={td}>{resDisp}</td>
                    <td style={{ ...td, color: faltaR ? "#9a3c06" : "#15803d", fontWeight: 700 }}>{faltaR || "—"}</td>
                    <td style={td}>{g.base.reduce((a, b) => a + b, 0)}</td>
                    <td style={td}>{g.pico.reduce((a, b) => a + b, 0)}</td>
                    <td style={{ ...td, color: MUTED }}>{g.metodo === "ingenuo" ? "Semana pasada" : "Malla"}</td>
                    {(() => { const al = evaluacion && evaluacion[g.nombre] ? evaluacion[g.nombre].alarmas : []; return <td style={{ ...td, color: al.length ? "#b42318" : "#15803d", fontWeight: 700 }} title={al.join(" · ")}>{al.length ? "Revisar" : "OK"}</td>; })()}
                    <td style={{ ...td, color: NAVY, fontWeight: 600, whiteSpace: "nowrap" }}>{resumen.find(x => x.g.nombre === g.nombre)?.pub ? <span style={{ color: "#15803d" }}>✓ Publicada · </span> : null}Ver malla ›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {evaluacion && Object.keys(evaluacion).length > 0 && (() => {
        const filas = resumen.map(({ g }) => ({ g, e: evaluacion[g.nombre] })).filter(x => x.e);
        const pct = v => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
        const conAlerta = filas.filter(x => x.e.alarmas.length);
        return (
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>¿Qué tan bien pronostica? · últimas 4 semanas</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
              Cada semana se pronosticó solo con lo anterior, con dos métodos: "la semana pasada" (las mismas rutas que el mismo día de la semana anterior), que es la base, y el promedio de las últimas semanas, con más peso a las recientes. Un SC usa el promedio solo si acierta al menos 3 puntos más. Alerta si el error supera el {Math.round(ERROR_MAX * 100)}% o si el pico alcanzó menos del {Math.round(PICO_MIN * 100)}% de los días en las últimas 2 semanas.
            </div>
            {conAlerta.length > 0 && <div style={{ marginTop: 10, background: "#fdecec", border: "1px solid #f5c2c0", color: "#b42318", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}><b>Revisar:</b> {conAlerta.map(x => `${x.g.nombre} (${x.e.alarmas.join(", ")})`).join(" · ")}</div>}
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead><tr>{["SC", "Error de la malla", "Error de la semana pasada", "Usa", "Error en 2 semanas", "Días que alcanzó el pico (2 sem.)", "Alerta"].map(h => <th key={h} style={{ ...th, textAlign: h === "SC" ? "left" : "center" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {filas.map(({ g, e }) => (
                    <tr key={g.nombre}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{g.nombre}</td>
                      <td style={{ ...td, fontWeight: e.metodo === "malla" ? 800 : 400 }}>{pct(e.errM)}</td>
                      <td style={{ ...td, fontWeight: e.metodo === "ingenuo" ? 800 : 400 }}>{pct(e.errI)}</td>
                      <td style={{ ...td, color: NAVY, fontWeight: 600 }}>{e.metodo === "ingenuo" ? "Semana pasada" : "Malla"}</td>
                      <td style={{ ...td, color: e.err2 > ERROR_MAX ? "#b42318" : "#1f2937" }}>{pct(e.err2)}</td>
                      <td style={{ ...td, color: e.pico2 !== null && e.pico2 < PICO_MIN ? "#b42318" : "#1f2937" }}>{pct(e.pico2)}</td>
                      <td style={{ ...td, color: e.alarmas.length ? "#b42318" : "#15803d", fontWeight: 700 }}>{e.alarmas.length ? e.alarmas.join(" · ") : "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {prueba && prueba.filas.length > 0 && (() => {
        const t = prueba.filas.reduce((x, a) => { for (const k of Object.keys(a)) if (typeof a[k] === "number") x[k] = (x[k] || 0) + a[k]; return x; }, {});
        const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
        const na = a => a.naReg + a.naUrg, cub = a => a.cubReg + a.cubUrg;
        return (
          <div style={card}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>¿La malla habría cubierto los rechazos? · prueba del {fechaCorta(prueba.desde)} al {fechaCorta(prueba.hasta)}</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
              Para cada semana, la malla se arma solo con los datos que había antes de esa semana, y se compara con lo que pasó de verdad. Un rechazo cuenta como cubierto si ese día la malla tenía capacidad libre, además de lo que se aceptó.
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              {[["Rechazos y vencidos reales", na(t), "#1f2937"], ["Que la malla cubría", `${cub(t)} · ${pct(cub(t), na(t))}`, "#15803d"], ["Regulares cubiertos", `${t.cubReg} de ${t.naReg} · ${pct(t.cubReg, t.naReg)}`, NAVY], ["Urgentes cubiertos", `${t.cubUrg} de ${t.naUrg} · ${pct(t.cubUrg, t.naUrg)}`, "#9a3c06"], ["Días en que la capacidad alcanzaba", pct(t.diasOk, t.dias), NAVY]].map(([tt, v, c]) => (
                <div key={tt} style={{ flex: "1 1 170px", background: "#f6f7f9", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontSize: 12, color: MUTED }}>{tt}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
                <thead><tr>
                  {["SC", "Rutas ofrecidas", "Ejecutadas (real)", "Capacidad de la malla", "Rechazos y vencidos", "Cubiertos por la malla", "% cubierto", "Regulares cubiertos", "Urgentes cubiertos", "Días que alcanzaba", "Aceptadas sobre la capacidad", "No show (real)"].map(h => <th key={h} style={{ ...th, textAlign: h === "SC" ? "left" : "center" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {[...prueba.filas, { ...t, nombre: "Total" }].map(a => {
                    const p = na(a) ? cub(a) / na(a) : 1;
                    return (
                      <tr key={a.nombre} style={{ background: a.nombre === "Total" ? "#fafafa" : "transparent", fontWeight: a.nombre === "Total" ? 800 : 400 }}>
                        <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{a.nombre}</td>
                        <td style={td}>{a.of}</td>
                        <td style={td}>{a.ej}</td>
                        <td style={td}>{a.cap}</td>
                        <td style={td}>{na(a)}</td>
                        <td style={{ ...td, color: "#15803d", fontWeight: 700 }}>{cub(a)}</td>
                        <td style={{ ...td, fontWeight: 800, color: p >= 0.7 ? "#15803d" : p >= 0.4 ? "#b45309" : "#b42318" }}>{pct(cub(a), na(a))}</td>
                        <td style={td}>{a.cubReg} / {a.naReg}</td>
                        <td style={td}>{a.cubUrg} / {a.naUrg}</td>
                        <td style={td}>{pct(a.diasOk, a.dias)}</td>
                        <td style={{ ...td, color: a.sobre ? "#9a3c06" : MUTED }}>{a.sobre || "—"}</td>
                        <td style={td}>{a.noShow || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
              <b>Aceptadas sobre la capacidad:</b> días en que se aceptaron más rutas de las que la malla podía cubrir; con la malla se habrían rechazado a tiempo, y compararlas con los no show reales muestra cuántos no show se habrían evitado. La prueba se recalcula sola cada día con las últimas {SEMANAS_PRUEBA} semanas.
            </div>
          </div>
        );
      })()}

      {sel && (() => {
        const { g, m } = sel;
        const fechasSem = DIAS.map((_, d) => sumarDias(lunes, d));
        return (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Malla de {g.nombre} · semana del {fechaCorta(lunes)}</div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Supervisor: {g.supervisor} · T = trabaja · D = descansa · R = reserva llamada</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {sel.pub ? (
                  <>
                    <span style={{ fontSize: 12, color: "#15803d", fontWeight: 700, background: "#ecfdf3", border: "1px solid #a6e3bf", borderRadius: 999, padding: "4px 10px" }}>Publicada el {fechaCorta(sel.pub.publicado_at.slice(0, 10))} por {sel.pub.publicado_por}{sel.pub.actualizado_at > sel.pub.publicado_at ? " · ajustada" : ""}</span>
                    {edicion && <button onClick={guardarCambios} disabled={guardando} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#15803d", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{guardando ? "Guardando…" : "Guardar cambios"}</button>}
                    {edicion && <button onClick={() => setEdicion(null)} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fff", color: MUTED, fontSize: 12, cursor: "pointer" }}>Descartar</button>}
                    <button onClick={volverACalcular} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fff", color: "#b42318", fontSize: 12, cursor: "pointer" }}>Volver a calcular</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 12, color: MUTED }}>Calculada hoy · cambia con los datos</span>
                    <button onClick={publicar} disabled={guardando} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{guardando ? "Publicando…" : "Publicar esta semana"}</button>
                  </>
                )}
              </div>
            </div>
            {sel.pub && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Esta malla queda fija para la semana. Para ajustarla, haz clic en una letra (cambia T → D → R → —) o en el rol (Fijo ↔ Reserva), y después "Guardar cambios".</div>}
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead><tr>
                  {["Placa", "Empresa", "Tipo", "Inventario", "Días trab. (2 sem)", "Rol"].map(h => <th key={h} style={{ ...th, textAlign: "left" }}>{h}</th>)}
                  {fechasSem.map((f, d) => <th key={f} style={th}>{DIAS[d]} {f.slice(8, 10)}</th>)}
                </tr></thead>
                <tbody>
                  {(edicion || m.filas).map((f, i) => (
                    <tr key={f.k}>
                      <td style={{ ...td, textAlign: "left", fontWeight: 700, color: f.vacante ? "#b42318" : "#1f2937" }}>{f.placa}</td>
                      <td style={{ ...td, textAlign: "left", color: f.vacante ? "#b42318" : MUTED, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.empresa}</td>
                      <td style={{ ...td, textAlign: "left" }}>{f.tipo || ""}</td>
                      <td style={{ ...td, textAlign: "left", color: f.estado === "INACTIVO" ? "#9a3c06" : MUTED, fontWeight: f.estado === "INACTIVO" ? 700 : 400 }} title={f.estado === "INACTIVO" ? "Figura INACTIVO en el inventario de flota, pero trabajó según MELI. Revisar con Terceros." : ""}>{f.estado || ""}</td>
                      <td style={td}>{f.dias ?? ""}</td>
                      <td onClick={() => sel.pub && tocarRol(i)} style={{ ...td, textAlign: "left", fontWeight: 600, color: f.rol === "Fijo" ? NAVY : "#9a3c06", cursor: sel.pub ? "pointer" : "default" }}>{f.rol}</td>
                      {f.dias7.map((v, d) => <td key={d} onClick={() => sel.pub && tocarDia(i, d)} style={{ ...td, ...color(v), cursor: sel.pub ? "pointer" : "default", userSelect: "none" }}>{v}</td>)}
                    </tr>
                  ))}
                  {(() => {
                    const filasV = edicion || m.filas;
                    const trab = DIAS.map((_, d) => filasV.filter(f => f.rol === "Fijo" && f.dias7[d] === "T").length);
                    const llam = DIAS.map((_, d) => filasV.filter(f => f.rol !== "Fijo" && f.dias7[d] === "R").length);
                    return [
                    ["Fijos que trabajan", trab, {}],
                    ["Reserva llamada", llam, {}],
                    ["Capacidad del día", DIAS.map((_, d) => trab[d] + llam[d]), { fontWeight: 800 }],
                    ["Rutas base (pronóstico)", g.base, { color: MUTED }],
                    ["Rutas pico (pronóstico)", g.pico, { color: MUTED }],
                    ["Faltan para el pico", DIAS.map((_, d) => Math.max(0, g.pico[d] - trab[d] - llam[d])), { color: "#b42318", fontWeight: 800 }],
                  ]; })().map(([t, vals, st]) => (
                    <tr key={t} style={{ background: "#fafafa" }}>
                      <td colSpan={6} style={{ ...td, textAlign: "right", fontWeight: 700, color: NAVY }}>{t}</td>
                      {vals.map((v, d) => <td key={d} style={{ ...td, ...st }}>{v || (t === "Faltan para el pico" ? "—" : v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
