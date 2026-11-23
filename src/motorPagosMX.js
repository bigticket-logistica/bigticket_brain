// ═══════════════════════════════════════════════════════════════════════════
// motorPagosMX.js — Motor de pago de México (Brain)
//
// Una sola lógica de cálculo para todos los que la necesiten:
//   · el botón "Calcular" del Listado de Pagos (Pagos.jsx), en el navegador;
//   · el cálculo automático nocturno del VPS (próximo paso).
// Si cambia una regla, se cambia aquí y aplica a los dos.
//
// Este archivo NO importa React ni la conexión del Brain: quien lo use le
// entrega su cliente de Supabase con usarClienteMotor(cliente).
//
// Contenido movido tal cual desde Pagos.jsx el 19-nov-2026 (sin cambios de
// lógica), más calcularDiaMotor(), que reúne la carga de datos del día y el
// cálculo que antes vivían dentro del botón.
// ═══════════════════════════════════════════════════════════════════════════

let _clienteMotor = null;
export function usarClienteMotor(cliente) { _clienteMotor = cliente; }
function sbm() {
  if (!_clienteMotor) throw new Error("motorPagosMX: falta usarClienteMotor(cliente) antes de calcular.");
  return _clienteMotor;
}

export function parsearTipologia(vehiculoRaw, categorias) {
  if (!vehiculoRaw) return null;
  const v = String(vehiculoRaw).toUpperCase();
  // Match contra las categorías configuradas en matriz_precios (las más largas primero,
  // para evitar colisiones de substring tipo "CAR" dentro de "CARGO").
  if (categorias && categorias.length) {
    const cats = Array.from(new Set(categorias.filter(Boolean).map(c => String(c).toUpperCase()))).sort((a, b) => b.length - a.length);
    for (const c of cats) if (v.includes(c)) return c;
  }
  if (v.includes("LARGE VAN")) return "LARGE VAN";
  if (v.includes("SMALL VAN")) return "SMALL VAN";
  if (v.includes("CAR")) return "CAR";
  return null;
}

// ── Ayudantes: nombres y porcentajes (formato "A // B" verificado en get_helper_por_ruta_dia) ──
// No se corta por coma: un nombre puede venir "APELLIDO, NOMBRE" y se rompería en dos.
function _partirHelper(v, permitirComa) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter(x => x != null && String(x).trim() !== "").map(x => String(x).trim());
  const t = String(v).trim();
  if (!t) return [];
  const re = permitirComa ? /\s*(?:\/\/|[;|,]|\s\/\s)\s*/ : /\s*(?:\/\/|[;|]|\s\/\s)\s*/;
  return t.split(re).map(x => x.trim()).filter(Boolean);
}
export function fmtHelperNombres(v) { const a = _partirHelper(v, false); return a.length ? a.join(" // ") : null; }
export function fmtHelperPcts(v) {
  const a = _partirHelper(v, true).map(x => {
    const num = Number(String(x).replace("%", "").trim());
    return isNaN(num) ? String(x) : `${Math.round(num * 10) / 10}%`;
  });
  return a.length ? a.join(" // ") : null;
}

export function normalizarPlaca(p) {
  if (!p) return null;
  const s = String(p).trim().toUpperCase().replace(/^SDD-/, "");
  return s || null;
}

export function tipologiaTitleCase(t) {
  if (!t) return null;
  const map = { "LARGE VAN": "Large Van", "SMALL VAN": "Small Van", "CAR": "Car" };
  return map[t] || t;
}

export function determinarTramoKm(km, rangos) {
  // Trunca hacia abajo (piso): 100.05 -> 100, 100.9 -> 100, 101.0 -> 101.
  // El tramo se fija con el km PLANIFICADO (el real es solo informativo).
  // Si recibe los rangos configurados (desde matriz_precios), los usa; si no, cae a los 5 fijos.
  const k = Math.floor(Number(km) || 0);
  if (rangos && rangos.length) {
    const matches = rangos.filter(x => k >= x.min && k <= x.max);
    if (matches.length) {
      // Si varios rangos se solapan, gana el más específico:
      // primero el de cota superior más baja (acotado > abierto "N+"), luego el más angosto.
      matches.sort((a, b) => (a.max - b.max) || ((a.max - a.min) - (b.max - b.min)));
      return matches[0].label;
    }
    return rangos[rangos.length - 1].label;
  }
  if (k <= 100) return "0-100";
  if (k <= 150) return "101-150";
  if (k <= 200) return "151-200";
  if (k <= 250) return "201-250";
  return "251+";
}

export function normEmpresaTarifa(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

export function buscarTarifa(empresaRuta, tipologia, zona, tramo, fecha, especiales, matrizPrecios, site, tipoSDD) {
  const tipTitleCase = tipologiaTitleCase(tipologia);
  const empNorm = normEmpresaTarifa(empresaRuta);
  if (empNorm) {
    const especial = (especiales || []).find(e =>
      normEmpresaTarifa(e.empresa || e.driver_name) === empNorm &&
      e.tipologia === tipTitleCase &&
      e.zona === zona &&
      e.tramo_km === tramo &&
      (!e.vigente_desde || !fecha || String(e.vigente_desde).slice(0, 10) <= fecha) &&
      (!e.vigente_hasta || !fecha || String(e.vigente_hasta).slice(0, 10) >= fecha)
    );
    if (especial) return { monto: Number(especial.monto), fuente: "ESPECIAL" };
  }

  // Vigencia: una tarifa sin fechas se considera siempre vigente (comportamiento previo).
  // Con fechas, solo aplica dentro del rango; asi recalcular un dia pasado nunca toma
  // tarifas cargadas despues. El cambio de un periodo ya pagado debe ser intencional.
  const vigenteEnFecha = (m) =>
    (!m.vigente_desde || !fecha || String(m.vigente_desde).slice(0, 10) <= fecha) &&
    (!m.vigente_hasta || !fecha || String(m.vigente_hasta).slice(0, 10) >= fecha);

  // Solo las tarifas de ruta entran al pago. Las de otro tipo (Cancelacion)
  // quedan guardadas como referencia y nunca se usan para tarifar una ruta.
  const esTarifaDeRuta = (m) => !m.tipo_tarifa || String(m.tipo_tarifa).trim().toUpperCase() === "RUTA";

  const base = (matrizPrecios || []).filter(m =>
    m.activo === true &&
    m.tipo_vehiculo === tipologia &&
    m.tramo_km === tramo &&
    esTarifaDeRuta(m) &&
    vigenteEnFecha(m)
  );

  // Cascada de lo mas especifico a lo mas general. Las filas sin site ni tipo_ruta
  // (todas las historicas) caen en el ultimo caso: la busqueda por zona de siempre.
  const candidatos = [
    { f: (m) => m.site === site && m.tipo_ruta === tipoSDD,                     fuente: "MATRIZ_SITE_TIPO" },
    { f: (m) => m.site === site && !m.tipo_ruta,                                fuente: "MATRIZ_SITE" },
    { f: (m) => !m.site && m.zonificacion === zona && m.tipo_ruta === tipoSDD,  fuente: "MATRIZ_ZONA_TIPO" },
    { f: (m) => !m.site && m.zonificacion === zona && !m.tipo_ruta,             fuente: "MATRIZ" },
  ];
  for (const c of candidatos) {
    const hit = base.find(c.f);
    if (hit) return { monto: Number(hit.tarifa_mxn), fuente: c.fuente };
  }

  return { monto: 0, fuente: "SIN_TARIFA" };
}

export function calcularSemanaPago(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target) / (7 * 24 * 3600 * 1000));
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const SC_FORANEOS = new Set(["SCY1","SCQ1","SQR1","SHP1","STL1","STX1","SVH1","SPB1","SPY1"]);

export const AUX_COBRAR_MELI = 350;

// Webhook n8n que avisa al supervisor cuando el analista rechaza un ayudante.
export const WEBHOOK_RECHAZO_HELPER = "https://bigticket2026.app.n8n.cloud/webhook/notificar-rechazo-helper";

// ── Lectura del Maestro Supervisores de un día ────────────────────────────
// vw_maestro_supervisores_auto tarda ~46 s (recalcula el reparto de paquetes
// sobre todo el histórico antes de filtrar por fecha) y Supabase corta las
// consultas de la app: de ahí "canceling statement due to statement timeout".
//
// Orden de intentos:
//   1. tabla materializada por cron    → instantánea
//   2. RPC get_maestro_supervisores_dia → levanta el timeout para esta consulta
//   3. lectura directa de la vista      → lo de antes; falla si hay timeout
let fuenteMaestroPreferida = null;   // "tabla" | "rpc" | "vista"

export async function leerMaestroDia(fecha) {
  // 1) Tabla materializada
  if (fuenteMaestroPreferida === null || fuenteMaestroPreferida === "tabla") {
    const t = await sbm().from("maestro_supervisores_dia_mx").select("*").eq("fecha", fecha).limit(5000);
    if (!t.error && (t.data || []).length > 0) {
      fuenteMaestroPreferida = "tabla";
      return { data: t.data, fuente: "tabla" };
    }
    if (t.error) fuenteMaestroPreferida = "rpc";   // la tabla todavía no existe
  }

  // 2) RPC que levanta el statement_timeout solo para esta consulta
  if (fuenteMaestroPreferida !== "vista") {
    const r = await sbm().rpc("get_maestro_supervisores_dia", { p_fecha: fecha });
    if (!r.error) {
      fuenteMaestroPreferida = "rpc";
      return { data: r.data || [], fuente: "rpc" };
    }
    const cod = String(r.error.code || "");
    if (cod === "PGRST202" || cod === "42883") fuenteMaestroPreferida = "vista";
    else return { error: r.error, fuente: "rpc" };
  }

  // 3) Lectura directa de la vista
  const v = await sbm().from("vw_maestro_supervisores_auto").select("*").eq("fecha", fecha).limit(5000);
  if (v.error) return { error: v.error, fuente: "vista" };
  return { data: v.data || [], fuente: "vista" };
}

// ── Estado del auxiliar: MISMA lógica que usa calcularDia() ────────────────
// Se centraliza acá para que la pestaña Ayudantes muestre exactamente lo que
// el motor va a pagar, sin reimplementar la regla y quedar desfasada.
//   pagaSegunMaestro = con_ayudante === "SI" en vw_maestro_supervisores_auto
//   La decisión del analista manda; sin decisión no se paga.
// ── Redondeo contable a 2 decimales ──────────────────────────────────
// Los montos del motor salen con decimales largos porque el ajuste NS y las
// bonificaciones son PORCENTAJES sobre la tarifa base (ej. 1847 * 0.07 =
// 129.28999999999999). El KM no aporta decimales: solo elige el tramo, y el
// tramo devuelve una tarifa discreta de la matriz.
// Regla contable aplicada: se redondea CADA COMPONENTE a 2 decimales y el total
// se arma sumando componentes ya redondeados. Así la suma de las líneas de una
// prefactura cuadra exactamente con su total (sin descuadres de un centavo).
// Se usa Number(...toFixed(2)) en vez de Math.round(x*100)/100 porque toFixed
// resuelve mejor los casos límite del punto flotante (ej. 1.005).
export function r2(x) {
  const v = Number(x || 0);
  return Number.isFinite(v) ? Number(v.toFixed(2)) : 0;
}

export function estadoAuxiliar({ pagaSegunMaestro, decision, sc, tipologia }) {
  if (!pagaSegunMaestro) return "SIN_HELPER";
  const d = decision ? String(decision).toLowerCase() : null;
  if (d === "aprobado") return "APROBADO";
  if (d === "rechazado") return "RECHAZADO";
  if (SC_FORANEOS.has(sc) && tipologia === "SMALL VAN") return "BLOQUEADO_ESTRUCTURAL";
  return "SIN_APROBACION";
}

export function calcularAjusteVisitadoNS(pctVisitado, nsPct, cfg) {
  const visMin    = (cfg && cfg.vis_min_pago   != null) ? cfg.vis_min_pago   : 90;
  const visPremio = (cfg && cfg.vis_premio_min != null) ? cfg.vis_premio_min : 99.5;
  const nsPremio  = (cfg && cfg.ns_premio_min  != null) ? cfg.ns_premio_min  : 99.5;
  const nsCastigo = (cfg && cfg.ns_castigo_max != null) ? cfg.ns_castigo_max : 95;
  const premioPct = (cfg && cfg.ns_premio_pct  != null) ? cfg.ns_premio_pct  : 5;
  const castPct   = (cfg && cfg.ns_castigo_pct != null) ? cfg.ns_castigo_pct : 3;
  if (pctVisitado == null) return { pct: 0, categoria: "SIN_VISITADO", noPaga: false };
  const vis = Number(pctVisitado);
  const ns = Number(nsPct) || 0;
  if (vis < visMin) return { pct: 0, categoria: "NO_PAGO_VIS<90%", noPaga: true };
  if (vis >= visPremio) {
    if (ns > nsPremio) return { pct: premioPct, categoria: "PREMIO_+5%", noPaga: false };
    return { pct: 0, categoria: "NEUTRO", noPaga: false };
  }
  if (ns < nsCastigo) return { pct: -castPct, categoria: "CASTIGO_-3%", noPaga: false };
  return { pct: 0, categoria: "NEUTRO", noPaga: false };
}

export function calcularPagos({ maestro, snapshots, scZonas, especiales, matrizPrecios, aprobaciones, tarifasCobrar, cfg, calculadoAt, bonificaciones, placaEmpresa, traspasosPorRuta = {} }) {
  const errores = [];
  const filas = [];

  // Index snapshots por id_ruta (para Bloque D + cruce de medianoche)
  const snapsPorRuta = {};
  for (const s of snapshots) {
    const k = String(s.id_ruta);
    if (!snapsPorRuta[k]) snapsPorRuta[k] = [];
    snapsPorRuta[k].push(s);
  }

  // Index aprobaciones de helper por travel_id
  const aprobPorRuta = {};
  for (const a of (aprobaciones || [])) aprobPorRuta[String(a.travel_id)] = a;

  // Index tarifas por cobrar MELI por categoria|zona|tramo
  const cobrarIdx = {};
  for (const c of (tarifasCobrar || [])) cobrarIdx[`${c.categoria}|${c.zonificacion}|${c.tramo_km}`] = Number(c.tarifa_mxn);

  // Rangos de km dinámicos: derivados de los tramo_km configurados en matriz_precios (pagar).
  const categoriasMatriz = Array.from(new Set((matrizPrecios || []).map(m => m.tipo_vehiculo).filter(Boolean)));
  const rangosKm = (() => {
    const labels = Array.from(new Set((matrizPrecios || []).map(m => m.tramo_km).filter(Boolean)));
    const parsed = labels.map(L => {
      const s = String(L).trim();
      if (s.endsWith("+")) return { min: parseInt(s, 10) || 0, max: Infinity, label: s };
      const p = s.split("-"); const a = parseInt(p[0], 10); const b = parseInt(p[1], 10);
      return { min: isNaN(a) ? 0 : a, max: isNaN(b) ? Infinity : b, label: s };
    }).filter(r => Number.isFinite(r.min));
    parsed.sort((x, y) => x.min - y.min);
    return parsed;
  })();

  // Index sc_zonas
  const zonaPorSC = {};
  for (const z of scZonas) zonaPorSC[z.service_center_id] = z.zona;

  for (const m of maestro) {
    const idRuta = String(m.idviaje || "");
    const driverName = m.driver_name || "Sin nombre";
    const driverIdML = m.driver_id != null ? Number(m.driver_id) : null;
    const sc = m.service_center_id || null;
    const vehiculoRaw = m.tipo_vehiculo || null;
    const placa = normalizarPlaca(m.patentes);
    const ciclo = m.cluster_meli || null;
    const esSDD = (m.es_sdd === "SI" || m.es_sdd === true);  // SDD/SPOT lo da la vista (es_sdd, desde tipo_vehiculo_meli "...SDD")

    // Km de pago: SOLO el REAL de MELI (km_recorridos_meli, route-detail) — decisión de gerencia (jul-2026).
    // Sin fallbacks: si no hay real, la ruta paga con 0 km y queda marcada (tarjeta "KM real bajo/ausente");
    // la corrección del monto la hace el analista después, en la prefactura. Si el real existe pero es muy
    // bajo frente al planificado (< cfg km_real_bajo_pct %, default 30), también se marca para revisión.
    // km_meli (TMS) y km_planificados NO pagan; el planificado es solo informativo.
    const kmRealMeli = m.km_recorridos_meli != null ? Number(m.km_recorridos_meli) : null;
    const kmPlanif = (m.km_planificados != null && Number(m.km_planificados) > 0) ? Number(m.km_planificados) : null;
    // Regla de kilometraje (18-nov-2026, desde el 16-nov): si MELI no tiene km
    // reales de la ruta (por ejemplo, el teléfono no transmitió el recorrido),
    // se paga con los km planificados. Antes del 16-nov se mantiene la regla
    // anterior (sin km real = 0 km, tramo mínimo) para no mover lo ya cerrado.
    const _kmFecha = m.fecha ? String(m.fecha).slice(0, 10) : "";
    const _kmPlanifValeComoPago = _kmFecha >= "2026-11-16";
    const _tieneKmReal = kmRealMeli != null && kmRealMeli > 0;
    const kmFuentePago = _tieneKmReal ? "real"
      : (_kmPlanifValeComoPago && kmPlanif != null) ? "planificado" : "ninguno";
    const km = kmFuentePago === "real" ? kmRealMeli : kmFuentePago === "planificado" ? kmPlanif : 0;
    const umbralBajo = (cfg && cfg.km_real_bajo_pct != null) ? Number(cfg.km_real_bajo_pct) : 30;
    const kmRealBajo = kmFuentePago === "ninguno" || (kmFuentePago === "real" && kmPlanif != null && km < kmPlanif * umbralBajo / 100);

    // Datos REALES de MELI adicionales (kmRealMeli ya definido arriba: es el km de pago)
    const pctVisitadoReal = m.pct_no_visitado_real != null
      ? Math.round((100 - Number(m.pct_no_visitado_real)) * 100) / 100
      : null;
    // GATE DE PAGO: usa el visitado REAL (MELI route-detail) cuando existe;
    // si no hay dato real, cae al visitado del maestro (comportamiento previo).
    const pctVisitadoGate = pctVisitadoReal != null ? pctVisitadoReal : null;

    // NS = entregados / cargados (equivalente a "Entrega exitosa")
    const cargados = Number(m.cargados || 0);
    const entregados = Number(m.entregados || 0);
    const traspasado = Number((traspasosPorRuta && traspasosPorRuta[idRuta]) || 0);  // paquetes que esta ruta (origen) traspasó a otras (ambulancias)
    const cargadosNS = Math.max(0, cargados - traspasado);  // total ajustado: se restan los traspasados al origen
    const nsPct = cargadosNS > 0 ? (entregados / cargadosNS * 100) : 0;  // NS se calcula sobre el total ajustado

    // % visitado (segunda variable de premio/castigo)
    const pctVisitado = m.pct_visitado != null ? Number(m.pct_visitado) : null;
    const noVisitado = pctVisitado != null ? (100 - pctVisitado) : null;

    const fechaSalida = m.fecha ? String(m.fecha).slice(0, 10) : null;

    // Validaciones
    if (!idRuta) { errores.push({ tms_id: m.idviaje, motivo: "Sin idviaje en el Maestro Supervisores" }); continue; }
    if (!sc) { errores.push({ tms_id: m.idviaje, motivo: "Sin service_center_id" }); continue; }

    const tipologia = parsearTipologia(vehiculoRaw, categoriasMatriz);
    const zona = zonaPorSC[sc] || null;
    const tramo = determinarTramoKm(km, rangosKm);

    const obs = [];
    if (!tipologia) obs.push(`Tipología no reconocida: "${vehiculoRaw}"`);
    if (!zona) obs.push(`SC no mapeado en sc_zonas_mx: ${sc}`);
    if (pctVisitado == null) obs.push("Sin % visitado en el snapshot");
    if (kmFuentePago === "planificado") obs.push(`SIN KM REAL \u2014 pagado con km planificado (${kmPlanif} km)`);
    if (kmRealBajo) obs.push(kmFuentePago === "ninguno"
      ? (_kmPlanifValeComoPago
          ? "SIN KM REAL NI PLANIFICADO \u2014 pagado con 0 km (tramo m\u00ednimo); corregir monto en la prefactura"
          : "SIN KM REAL \u2014 pagado con 0 km (tramo m\u00ednimo); corregir monto en la prefactura")
      : `KM REAL MUY BAJO: ${km} km vs planificado ${kmPlanif} km \u2014 verificar y corregir en la prefactura si corresponde`);
    // km_meli (TMS) no paga. El km de pago es el real de MELI (route-detail);
    // desde el 16-nov, si no hay real, se usa el planificado.
    if (m.status_final && m.status_final !== "close") obs.push(`Status no cerrado: ${m.status_final} — revisar`);

    // Tarifa base
    let tarifaInfo = { monto: 0, fuente: "SIN_TARIFA" };
    if (tipologia && zona) {
      const empresaRuta = (placaEmpresa || {})[placa] || null;
      tarifaInfo = buscarTarifa(empresaRuta, tipologia, zona, tramo, fechaSalida, especiales, matrizPrecios, sc, esSDD ? "SDD" : "SPOT");
      if (tarifaInfo.fuente === "SIN_TARIFA") obs.push(`Sin tarifa para ${tipologia} / ${zona} / ${tramo}`);
    }
    const tarifaBase = tarifaInfo.monto;
    const tieneTarifaEspecial = tarifaInfo.fuente === "ESPECIAL";

    // Ajuste por matriz visitado × NS (reemplaza a matriz_ns)
    const pctVisitadoEfectivo = pctVisitadoGate != null ? pctVisitadoGate : pctVisitado;
    const ajuste = calcularAjusteVisitadoNS(pctVisitadoEfectivo, nsPct, cfg);
    const noPagaNS0 = nsPct <= 0;  // Regla: nivel de servicio 0 => sin pago
    const noPaga = ajuste.noPaga || noPagaNS0;
    const factorNS = 1 + (ajuste.pct / 100);
    const ajusteNS = r2(tarifaBase * (ajuste.pct / 100));

    // ── Helper: gatillo = con_ayudante del Maestro Supervisores ──
    // La DECISIÓN explícita del analista (aprobaciones_helper.decision) manda:
    //  aprobado → paga $300 (aun si estaba bloqueada por defecto)
    //  rechazado → no paga
    //  sin decisión → no paga (bloqueada por defecto si es foránea+small van)
    const tieneHelper = String(m.con_ayudante || "").toUpperCase() === "SI";
    let auxiliarEstado = "SIN_HELPER";
    let montoAux = 0;
    if (tieneHelper) {
      const esForaneo = SC_FORANEOS.has(sc);
      const esSmallVan = tipologia === "SMALL VAN";
      const aprob = aprobPorRuta[idRuta] || null;
      const decision = (aprob && aprob.decision) ? String(aprob.decision).toLowerCase() : null;
      if (decision === "aprobado") {
        auxiliarEstado = "APROBADO";
        montoAux = (cfg && cfg.aux_por_pagar != null) ? cfg.aux_por_pagar : 300;
      } else if (decision === "rechazado") {
        auxiliarEstado = "RECHAZADO";
        montoAux = 0;
        obs.push("Helper rechazado por el analista");
      } else if (esForaneo && esSmallVan) {
        auxiliarEstado = "BLOQUEADO_ESTRUCTURAL";
        montoAux = 0;
        obs.push("Helper bloqueado por defecto: SC foráneo + Small Van — requiere aprobación");
      } else {
        auxiliarEstado = "SIN_APROBACION";
        montoAux = 0;
        obs.push("Helper sin decisión del analista — no se paga hasta aprobar");
      }
    } else {
      // REGLA: sin flag de ayudante activo, la ruta está FUERA del pago de
      // auxiliares. Si quedó una aprobación de antes, se ignora — pero se deja
      // constancia en la fila para que la exclusión sea rastreable y no muda.
      const aprobFuera = aprobPorRuta[idRuta] || null;
      const decFuera = (aprobFuera && aprobFuera.decision)
        ? String(aprobFuera.decision).toLowerCase() : null;
      if (decFuera === "aprobado") {
        obs.push("Aprobación de ayudante IGNORADA: la ruta no tiene flag de ayudante activo — no corresponde pago de auxiliar");
      }
    }

    // ── Bloque D: métricas del raw_json (desde snapshots) ──
    const snapsRuta = snapsPorRuta[idRuta] || [];
    let initDateUnix = null, finalDateUnix = null;
    let loyaltyTier = null, performanceScore = null;
    let tieneRetrasoInicial = false, cantidadIncidentes = 0, stemOutMinutos = null;
    if (snapsRuta.length > 0) {
      const ordenados = [...snapsRuta].sort((a, b) =>
        new Date(b.hora_snapshot || 0) - new Date(a.hora_snapshot || 0)
      );
      for (const s of ordenados) {
        const rj = s.raw_json || {};
        if (!initDateUnix && rj.initDate) initDateUnix = Number(rj.initDate);
        if (!finalDateUnix && rj.finalDate) finalDateUnix = Number(rj.finalDate);
        if (initDateUnix && finalDateUnix) break;
      }
      for (const s of ordenados) {
        const rj = s.raw_json || {};
        if (loyaltyTier === null && rj.driver?.loyalty?.name) loyaltyTier = rj.driver.loyalty.name;
        if (performanceScore === null && rj.routePerformanceScore) performanceScore = rj.routePerformanceScore;
        if (rj.flags?.hasInitialDelay === true) tieneRetrasoInicial = true;
        if (Array.isArray(rj.incidentTypes) && rj.incidentTypes.length > cantidadIncidentes) cantidadIncidentes = rj.incidentTypes.length;
        if (stemOutMinutos === null && rj.timingData?.stemOut != null) stemOutMinutos = Number(rj.timingData.stemOut);
        if (loyaltyTier && performanceScore && stemOutMinutos !== null) break;
      }
    }
    if (performanceScore === null && m.performance_score) performanceScore = m.performance_score;

    // Cruce de medianoche
    let cruzaMedianoche = false;
    let duracionMinutos = null;
    if (initDateUnix && finalDateUnix) {
      duracionMinutos = Math.round((finalDateUnix - initDateUnix) / 60);
      const fIni = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(initDateUnix * 1000));
      const fFin = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(finalDateUnix * 1000));
      if (fIni !== fFin) {
        cruzaMedianoche = true;
        const h = Math.floor(duracionMinutos / 60), mm = duracionMinutos % 60;
        obs.push(`Ruta cruzó medianoche: ${fIni} → ${fFin} (duración ${h}h ${mm}min)`);
      }
    } else if (snapsRuta.length > 0 && fechaSalida) {
      const fechasSnap = [...new Set(snapsRuta.map(s => s.fecha))];
      if (fechasSnap.filter(f => f !== fechaSalida).length > 0) {
        cruzaMedianoche = true;
        obs.push(`Ruta cruzó medianoche (estimado por snapshots): fechas ${fechasSnap.join(", ")}`);
      }
    }

    // Ruta no operada: NO se descarta; se marca para que el analista decida
    const rutaNoOperada = !!m.ruta_no_operada;
    if (rutaNoOperada) obs.push(`🚫 NO OPERADA${m.motivo_no_operada ? `: ${m.motivo_no_operada}` : ""} — revisar antes de pagar`);

    // Descarte por visitado < 90% (reemplaza al viejo no_visitado > 10%)
    if (ajuste.noPaga) obs.push(`NO PAGADO: visitado ${pctVisitadoEfectivo != null ? pctVisitadoEfectivo.toFixed(2) : "?"}% < 90% (${pctVisitadoGate != null ? "REAL MELI" : "maestro"})`);
    if (noPagaNS0) obs.push("NO PAGADO: NS 0% (sin entregas)");
    if (traspasado > 0) obs.push(`🔄 TRASPASO: ${traspasado} paquete(s) traspasados — total ajustado ${cargadosNS} de ${cargados}; NS recalculado sobre ${cargadosNS}`);
    if (pctVisitadoGate != null && pctVisitado != null && Math.abs(pctVisitadoGate - pctVisitado) >= 5) {
      obs.push(`Visitado maestro ${pctVisitado.toFixed(1)}% vs real ${pctVisitadoGate.toFixed(1)}% — gate usó el REAL`);
    }

    // BONIFICACION: % extra sobre la TARIFA BASE. Solo si la ruta paga (NO_PAGO queda en 0).
    // Se acumula con el ajuste NS (ambos calculados sobre la base): pago = base + ajusteNS + bono + aux.
    let montoBono = 0;
    let bonoAplicado = null;
    if (!noPaga && !esSDD && Array.isArray(bonificaciones) && bonificaciones.length) {  // los bonos NO aplican a rutas SDD
      const tipoR = esSDD ? "SDD" : "SPOT";  // (aquí siempre SPOT por la guarda de arriba)
      const kmR = Number(km || 0);
      let mejor = null;
      for (const b of bonificaciones) {
        if (b.activo === false) continue;
        if (b.fecha_desde && fechaSalida && fechaSalida < b.fecha_desde) continue;
        if (b.fecha_hasta && fechaSalida && fechaSalida > b.fecha_hasta) continue;
        const scs = Array.isArray(b.scs) ? b.scs : [];
        if (scs.length && !scs.includes(sc)) continue;
        if (b.tipo_ruta && b.tipo_ruta !== "AMBOS" && tipoR !== b.tipo_ruta) continue;
        if (b.km_min != null && b.km_min !== "" && kmR < Number(b.km_min)) continue;
        if (b.km_max != null && b.km_max !== "" && kmR > Number(b.km_max)) continue;
        if (!mejor || Number(b.pct_aumento || 0) > Number(mejor.pct_aumento || 0)) mejor = b;
      }
      if (mejor) {
        montoBono = r2(tarifaBase * (Number(mejor.pct_aumento || 0) / 100));
        bonoAplicado = mejor;
        obs.push(`Bonificación "${mejor.nombre}" +${Number(mejor.pct_aumento || 0)}% sobre base = +${montoBono.toFixed(2)}`);
      }
    }

    // Suma de componentes ya redondeados: garantiza que detalle y total cuadren.
    const pagoBruto = noPaga ? 0 : r2(r2(tarifaBase) + ajusteNS + montoBono + r2(montoAux));
    const descuentos = 0;
    const pagoNeto = r2(pagoBruto - descuentos);
    const nsCategoriaFinal = ajuste.categoria;

    // Pago MELI: lo que MELI nos paga (matriz por cobrar + $350 si hubo helper).
    // Independiente de si al chofer se le paga o no. CANCELACION no se aplica aún.
    let pagoMeli = null;
    if (tipologia && zona) {
      const baseCobrar = cobrarIdx[`${tipologia}|${zona}|${tramo}`];
      if (baseCobrar != null) pagoMeli = baseCobrar + (tieneHelper ? ((cfg && cfg.aux_por_cobrar != null) ? cfg.aux_por_cobrar : AUX_COBRAR_MELI) : 0);
    }

    filas.push({
      fecha: fechaSalida,
      id_ruta: idRuta,
      driver_id: driverIdML,
      driver_name: driverName,
      vehiculo_raw: vehiculoRaw,
      tipo_vehiculo_meli: m.tipo_vehiculo_meli || null,
      tipo_ruta_sdd: esSDD ? "SDD" : "SPOT",
      tipologia,
      placa,
      service_center_id: sc,
      zona,
      km_recorridos: km,
      km_recorridos_meli: kmRealMeli,
      km_planificados: m.km_planificados != null ? Number(m.km_planificados) : null,  // informativo, no paga
      km_fuente: km > 0 ? "REAL" : null,  // trazabilidad en exports
      sin_km_planificado: kmRealBajo,  // legado: hoy marca "KM real ausente o muy bajo" (corregir en prefactura)
      tramo_km: tramo,
      ciclo,
      envios_despachados: cargadosNS,  // total ajustado (cargados - traspasados); el warning queda en observaciones
      envios_entregados: entregados,
      ns_pct: nsPct,
      ns_no_visitado: noVisitado,
      pct_visitado: pctVisitado,
      pct_visitado_real: pctVisitadoReal,
      ns_categoria: nsCategoriaFinal,
      factor_ns: factorNS,
      tarifa_base: r2(tarifaBase),
      ajuste_ns: ajusteNS,
      monto_bonificacion: noPaga ? 0 : montoBono,
      bonificacion_nombre: bonoAplicado ? bonoAplicado.nombre : null,
      bonificacion_pct: bonoAplicado ? Number(bonoAplicado.pct_aumento || 0) : 0,
      tiene_auxiliar: tieneHelper,
      // Ayudantes: nombre(s) y %(s) tal como vienen del maestro (get_maestro_supervisores_dia los
      // incluye, verificado). Se persisten acá para que Listado y Excel no consulten
      // vw_helper_por_ruta, que es costosa (causó el agotamiento de Disk IO).
      ayudantes_nombres: tieneHelper ? (m.nombre_ayudante != null ? String(m.nombre_ayudante) : (m.nombre_helper != null ? String(m.nombre_helper) : null)) : null,
      ayudantes_pcts: tieneHelper ? (m.pct_por_persona != null ? String(m.pct_por_persona) : (m.pct_helper != null ? String(m.pct_helper) : null)) : null,
      auxiliar_estado: auxiliarEstado,
      auxiliar_snapshots_total: tieneHelper ? Number(m.cantidad_personas || 0) : 0,
      monto_auxiliar: noPaga ? 0 : r2(montoAux),
      pago_bruto: pagoBruto,
      descuentos_externos: descuentos,
      pago_neto: pagoNeto,
      pago_meli: pagoMeli == null ? null : r2(pagoMeli),
      semana_pago: calcularSemanaPago(fechaSalida),
      tiene_tarifa_especial: tieneTarifaEspecial,
      ruta_no_operada: rutaNoOperada,
      status_final: m.status_final || null,
      calculado_at: calculadoAt,
      observaciones: obs.length > 0 ? obs.join(" | ") : null,
      hora_inicio_ruta: initDateUnix ? new Date(initDateUnix * 1000).toISOString() : null,
      hora_fin_ruta: finalDateUnix ? new Date(finalDateUnix * 1000).toISOString() : null,
      duracion_minutos: duracionMinutos,
      cruza_medianoche: cruzaMedianoche,
      loyalty_tier: loyaltyTier,
      performance_score: performanceScore,
      tiene_retraso_inicial: tieneRetrasoInicial,
      cantidad_incidentes: cantidadIncidentes,
      stem_out_minutos: stemOutMinutos,
    });
  }

  return { filas, errores };
}

export function tipoRutaDeFila(placa) {
  // Regla de negocio: SDD = placa con prefijo "SDD-". Todo lo demás = SPOT
  // (otros prefijos o sin prefijo). Una placa vacía/nula no clasifica.
  const s = String(placa || "").trim().toUpperCase();
  if (!s) return null;
  return s.startsWith("SDD-") ? "SDD" : "SPOT";
}


// ── Cálculo completo de un día ────────────────────────────────────────────
// Lee todo lo que el motor necesita para la fecha y devuelve las filas a
// guardar en maestro_jornada_mx. No guarda nada: eso lo decide quien llama.
// Opciones:
//   bonificaciones: si quien llama ya las tiene cargadas, se usan esas; si no,
//                   se leen las activas de bonificaciones_mx.
export async function calcularDiaMotor(fecha, { bonificaciones = null } = {}) {
  const fechaInicio = fecha;
  const fechaSig = new Date(fecha + "T00:00:00");
  fechaSig.setDate(fechaSig.getDate() + 1);
  const fechaFin = fechaSig.toISOString().slice(0, 10);

  // Para snapshots usamos ventana ±1 día porque las rutas pueden cruzar medianoche
  // (rutas que arrancan tarde y se cierran al día siguiente)
  const fechaPrev = new Date(fecha + "T00:00:00");
  fechaPrev.setDate(fechaPrev.getDate() - 1);
  const fechaSnapDesde = fechaPrev.toISOString().slice(0, 10);
  const fechaSnapHasta = fechaFin; // ya es +1 día

  const calculadoAt = new Date().toISOString();

  const [mRes, sRes, zRes, mpRes, eRes, apRes, tcRes, cfgRes, fRes, bRes] = await Promise.all([
    leerMaestroDia(fecha),
    sbm().from("logistic_ayudantes_snapshots").select("*").gte("fecha", fechaSnapDesde).lte("fecha", fechaSnapHasta).limit(30000),
    sbm().from("sc_zonas_mx").select("service_center_id, zona"),
    sbm().from("matriz_precios").select("*").eq("activo", true),
    sbm().from("tarifas_especiales_mx").select("*"),
    sbm().from("aprobaciones_helper").select("*").eq("fecha", fecha),
    sbm().from("tarifas_cobrar_meli_mx").select("*").eq("activo", true),
    sbm().from("config_pagos_mx").select("*"),
    sbm().from("flota_terceros_mx").select("placa, empresa_transporte, fecha_hora_envio").order("fecha_hora_envio", { ascending: false }).limit(20000),
    bonificaciones ? Promise.resolve({ data: bonificaciones }) : sbm().from("bonificaciones_mx").select("*").eq("activo", true),
  ]);

  if (mRes.error) {
    const esTimeout = String(mRes.error.message || "").toLowerCase().includes("timeout");
    throw new Error("maestro supervisores: " + mRes.error.message + (esTimeout
      ? "\n\nLa vista del Maestro tarda mas de lo que la base permite. Corre el script maestro_dia.sql y volve a intentar."
      : ""));
  }
  console.log(`[Calculo ${fecha}] Maestro leido desde: ${mRes.fuente}`);
  if (sRes.error) throw new Error("snapshots: " + sRes.error.message);

  const maestro = mRes.data || [];
  if (maestro.length === 0) return { maestro, filas: [], errores: [], fuente: mRes.fuente, calculadoAt };

  const cfg = {};
  for (const c of (cfgRes.data || [])) cfg[c.clave] = Number(c.valor);

  const placaEmpresa = {};
  for (const f of (fRes.data || [])) {
    const pl = normalizarPlaca(f.placa);
    if (pl && !(pl in placaEmpresa) && f.empresa_transporte) placaEmpresa[pl] = f.empresa_transporte;
  }
  // Traspasos de paquetes (ambulancias) del día: ruta_origen -> total traspasado
  const traspasosPorRuta = {};
  try {
    const { data: amb } = await sbm().from("vw_ambulancias_diario")
      .select("ruta_origen, paquetes_traspasados").eq("fecha", fecha);
    for (const a of (amb || [])) {
      const k = String(a.ruta_origen);
      traspasosPorRuta[k] = (traspasosPorRuta[k] || 0) + Number(a.paquetes_traspasados || 0);
    }
  } catch (e) { console.error("traspasos ambulancias:", e); }
  const { filas, errores } = calcularPagos({
    maestro,
    snapshots: sRes.data || [],
    scZonas: zRes.data || [],
    especiales: eRes.data || [],
    matrizPrecios: mpRes.data || [],
    aprobaciones: apRes.data || [],
    tarifasCobrar: tcRes.data || [],
    cfg,
    calculadoAt,
    bonificaciones: bRes.data || [],
    placaEmpresa,
    traspasosPorRuta,
  });
  // Red de certificación (19-nov-2026): cada línea lleva sus alertas de
  // Certificaciones (empresa no certificada, sin contrato firmado, vehículo o
  // chofer sin certificar). Hoy los controles están en OBSERVACIÓN: la alerta
  // se ve en la línea y la ruta se paga normal. Si la validación falla, el
  // cálculo sigue igual, sin alertas.
  if (filas.length && String(fecha) >= "2026-11-16") {
    try {
      await agregarAlertasCertificacion(fecha, filas);
    } catch (e) { console.error("[Calculo " + fecha + "] alertas de certificación:", e.message || e); }
  }

  return { maestro, filas, errores, fuente: mRes.fuente, calculadoAt };
}

// Pide a la base las alertas de certificación de las rutas del día (una sola
// llamada) y las suma a las observaciones de cada línea. La empresa la resuelve
// la base con la misma regla única de placa ↔ empresa que usa el pago.
export async function agregarAlertasCertificacion(fecha, filas) {
  const rutas = filas.map(f => ({ id_ruta: String(f.id_ruta), placa: f.placa || null, driver_id: f.driver_id != null ? String(f.driver_id) : null }));
  const { data, error } = await sbm().rpc("fn_red_cert_validar", { p_fecha: fecha, p_rutas: rutas });
  if (error) throw new Error(error.message);
  const porRuta = {};
  for (const r of (data || [])) porRuta[String(r.id_ruta)] = r;
  let n = 0;
  const retenidas = [];
  for (const f of filas) {
    const r = porRuta[String(f.id_ruta)];
    if (!r) continue;
    if (r.alertas && r.alertas.length) {
      f.observaciones = [f.observaciones, ...r.alertas].filter(Boolean).join(" | ");
      n++;
    }
    // Retención (21-nov-2026): si falla un control ENCENDIDO y Certificaciones
    // no la habilitó, la ruta no se paga. Su monto queda guardado en
    // viajes_retenidos_mx y se paga cuando se regulariza o se habilita.
    const monto = Number(f.pago_neto || 0);
    if (r.retener && monto > 0) {
      retenidas.push({
        id_ruta: String(f.id_ruta), tercero_id: r.tercero_id || null, empresa: r.empresa || null,
        placa: f.placa || null, service_center: f.service_center_id || null,
        monto, motivos: r.motivos_retencion || null,
      });
      f.pago_neto = 0;
      f.observaciones = [f.observaciones,
        `⛔ RETENIDO por certificación: ${r.motivos_retencion || "control encendido"} · se habría pagado $${monto.toFixed(2)} · lo habilita Certificaciones`]
        .filter(Boolean).join(" | ");
    }
  }
  // Se registra siempre (aunque no haya retenidas): así lo que estaba retenido
  // ese día y ya se regularizó queda "liberado".
  const { error: eReg } = await sbm().rpc("fn_red_cert_registrar_retenidas", { p_fecha: fecha, p_retenidas: retenidas });
  if (eReg) console.error("[Calculo " + fecha + "] registrar retenidas:", eReg.message);
  return n;
}


// ═══════════════════════════════════════════════════════════════════════════
// Guardado y publicación del día (movidos desde Pagos.jsx el 19-nov-2026).
// Los usan el botón Guardar del Brain y el cálculo automático del VPS.
// ═══════════════════════════════════════════════════════════════════════════

// Escribe el cálculo en maestro_jornada_mx (reemplaza el día completo) y
// refresca el resumen por empresa. Misma lógica que tenía el botón Calcular.
export async function escribirMaestroDia(fecha, filas) {
  const { error: delError } = await sbm().from("maestro_jornada_mx").delete().eq("fecha", fecha);
  if (delError) throw new Error("DELETE previo falló: " + delError.message);

  let insertados = 0;
  let primerError = null;
  for (let i = 0; i < filas.length; i += 100) {
    const chunk = filas.slice(i, i + 100);
    const { error: insError } = await sbm().from("maestro_jornada_mx").insert(chunk);
    if (insError) {
      for (const fila of chunk) {
        const { error: e2 } = await sbm().from("maestro_jornada_mx").insert(fila);
        if (e2) {
          primerError = { mensaje: e2.message, fila_problema: fila };
          break;
        } else {
          insertados++;
        }
      }
      if (primerError) break;
    } else {
      insertados += chunk.length;
    }
  }

  if (primerError) {
    const f = primerError.fila_problema;
    throw new Error(
      `Falló al insertar registro:\n\n` +
      `Chofer: ${f.driver_name}\n` +
      `Ruta: ${f.id_ruta}\n` +
      `ns_categoria: "${f.ns_categoria}"\n` +
      `Mensaje BD: ${primerError.mensaje}\n\n` +
      `Se insertaron ${insertados} registros antes del error.`
    );
  }

  // Refrescar el snapshot por empresa (pagos_terceros_diario) del día calculado
  try {
    await sbm().rpc("refrescar_pagos_terceros_diario", { p_fecha: fecha });
  } catch (e) { console.error("refrescar pagos_terceros_diario:", e); }

  return { insertados };
}

// Columnas que pasan del cálculo (maestro_jornada_mx) al guardado (tarifado_mx).
export const COLUMNAS_TARIFADO = ["fecha","id_ruta","driver_id","driver_name","vehiculo_raw","tipo_ruta_sdd","tipologia","placa",
  "service_center_id","zona","km_recorridos","tramo_km","ciclo","envios_despachados","envios_entregados",
  "ns_pct","ns_no_visitado","pct_visitado","ns_categoria","factor_ns","tarifa_base","ajuste_ns",
  "tiene_auxiliar","auxiliar_estado","monto_auxiliar","pago_bruto","descuentos_externos","pago_neto",
  "semana_pago","tiene_tarifa_especial","ruta_no_operada","pago_meli","observaciones"];

// Guarda el día en tarifado_mx (reemplaza el guardado previo: el consolidado
// final es siempre el último guardado). "pagos" son las filas del día tal como
// quedaron en maestro_jornada_mx.
export async function guardarTarifadoDia(fecha, pagos) {
  const corridaId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${fecha}-${Date.now()}`;
  const guardadoAt = new Date().toISOString();
  const rows = pagos.map(p => {
    const r = { corrida_id: corridaId, guardado_at: guardadoAt };
    for (const c of COLUMNAS_TARIFADO) r[c] = (p[c] !== undefined ? p[c] : null);
    return r;
  });
  const { error: delErr } = await sbm().from("tarifado_mx").delete().eq("fecha", fecha);
  if (delErr) throw new Error("No se pudo limpiar el guardado previo: " + delErr.message);

  let ok = 0, primerError = null;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await sbm().from("tarifado_mx").insert(chunk);
    if (error) { primerError = error.message; break; }
    ok += chunk.length;
  }
  if (primerError) throw new Error(primerError);
  return { ok, corridaId, guardadoAt };
}

// Escribe la publicación de un SC y la FOTO de cada ruta. La foto es lo que
// ve el tercero: sin ella, cualquier recálculo posterior le cambia el número
// en pantalla sin que nadie lo haya decidido.
// soloRutas: si viene, republica únicamente esas (las demás conservan su foto).
export async function publicarSCMotor(fecha, sc, { motivo = null, soloRutas = null, version, publicadoPor = "brain" }) {
  if (!version) throw new Error("falta la versión a publicar");
  const { data: guardado, error: eG } = await sbm().from("tarifado_mx")
    .select("*").eq("fecha", fecha).eq("service_center_id", sc);
  if (eG) throw new Error("no se pudo leer el tarifado guardado");
  if (!guardado || guardado.length === 0) throw new Error("sin tarifado guardado");

  const { data: exc } = await sbm().from("revision_ruta_mx")
    .select("id_ruta, estado").eq("fecha", fecha)
    .in("id_ruta", guardado.map(g => g.id_ruta));
  const estadoDe = {};
  for (const e of (exc || [])) estadoDe[e.id_ruta] = e.estado;

  const aPublicar = soloRutas ? guardado.filter(g => soloRutas.includes(g.id_ruta)) : guardado;
  if (aPublicar.length === 0) throw new Error("no marcaste ninguna ruta");

  const lineas = aPublicar.map(g => ({
    fecha, service_center: sc, id_ruta: g.id_ruta, version,
    tercero_id: g.tercero_id, placa: g.placa, driver_name: g.driver_name,
    ns_pct: g.ns_pct, pct_visitado: g.pct_visitado, ns_categoria: g.ns_categoria,
    tiene_auxiliar: g.tiene_auxiliar, monto_auxiliar: g.monto_auxiliar,
    pago_neto: g.pago_neto, motivo,
    publicado_por: publicadoPor,
  }));
  for (let i = 0; i < lineas.length; i += 500) {
    const { error } = await sbm().from("publicacion_lineas_mx").insert(lineas.slice(i, i + 500));
    if (error) throw error;
  }

  const rechazadas = guardado.filter(g => estadoDe[g.id_ruta] === "rechazada").length;
  const pausadas   = guardado.filter(g => ["pausada", "bloqueada"].includes(estadoDe[g.id_ruta])).length;
  const { error } = await sbm().from("publicacion_dia_mx").insert({
    fecha, service_center: sc, version,
    rutas_total: guardado.length,
    rutas_aprobadas: guardado.length - rechazadas - pausadas,
    rutas_rechazadas: rechazadas,
    rutas_pausadas: pausadas,
    monto_total: guardado.reduce((t, g) => estadoDe[g.id_ruta] ? t : t + Number(g.pago_neto || 0), 0),
    motivo_version: motivo,
    publicado_por: publicadoPor,
  });
  if (error) throw error;
}

// ── Guardar publica ──
// Decisión del 17-nov-2026: cada guardado del día queda publicado en el portal,
// sin botón aparte. CADA guardado sube la versión de cada centro (v1, v2, v3…):
// el número de versión es el contador de cuántas veces se recalculó y guardó
// ese día. En el motivo de la versión queda si hubo cambios y en cuántas rutas
// (monto, empresa, auxiliar o NS). No envía aviso al tercero.
// prefijoMotivo: "Guardado del día" (analista) o "Cálculo automático".
export async function publicarDiaMotor(fecha, { publicadoPor = "brain", prefijoMotivo = "Guardado del día" } = {}) {
  const num = (v) => Math.round(Number(v || 0) * 100) / 100;
  const firma = (r) => [r.tercero_id || "", r.placa || "", r.driver_name || "", num(r.ns_pct), num(r.pct_visitado),
    r.ns_categoria || "", r.tiene_auxiliar ? 1 : 0, num(r.monto_auxiliar), num(r.pago_neto)].join("|");
  const [tarR, linR, pubR] = await Promise.all([
    sbm().from("tarifado_mx").select("service_center_id, id_ruta, tercero_id, placa, driver_name, ns_pct, pct_visitado, ns_categoria, tiene_auxiliar, monto_auxiliar, pago_neto").eq("fecha", fecha),
    // Se compara contra lo último publicado DE ESTE MISMO DÍA, no contra la
    // vista del portal: una ruta que se repite en varios días se muestra con
    // la fecha del primero, y en la vista "no existe" para los días siguientes.
    sbm().from("publicacion_lineas_mx").select("service_center, id_ruta, version, tercero_id, placa, driver_name, ns_pct, pct_visitado, ns_categoria, tiene_auxiliar, monto_auxiliar, pago_neto").eq("fecha", fecha).order("version", { ascending: false }).limit(20000),
    sbm().from("vw_publicacion_vigente_mx").select("service_center, version").eq("fecha", fecha),
  ]);
  if (tarR.error) throw new Error("no se pudo leer el tarifado guardado: " + tarR.error.message);
  const porSC = {};
  for (const r of (tarR.data || [])) (porSC[r.service_center_id] = porSC[r.service_center_id] || []).push(r);
  const vista = {};
  // Vienen de la versión más nueva a la más vieja: la primera de cada ruta manda.
  for (const l of (linR.data || [])) { const k = String(l.id_ruta); if (!(k in vista)) vista[k] = firma(l); }
  const versionDe = {};
  for (const v of (pubR.data || [])) versionDe[v.service_center] = Number(v.version || 0);

  let publicados = 0, sinCambio = 0, rutasCambiadas = 0; const fallos = [];
  for (const sc of Object.keys(porSC).sort()) {
    const filas = porSC[sc];
    const previa = versionDe[sc] || 0;
    const nCamb = previa ? filas.filter(r => vista[String(r.id_ruta)] !== firma(r)).length : filas.length;
    const motivo = !previa ? (prefijoMotivo === "Guardado del día" ? null : prefijoMotivo)
      : (nCamb ? `${prefijoMotivo} · ${nCamb} ruta(s) con cambios` : `${prefijoMotivo} · sin cambios`);
    try {
      await publicarSCMotor(fecha, sc, { motivo, version: previa + 1, publicadoPor });
      publicados++;
      if (previa && !nCamb) sinCambio++; else rutasCambiadas += nCamb;
    } catch (e) { fallos.push(`${sc}: ${e.message}`); }
  }
  const sinEmpresa = (tarR.data || []).filter(r => !r.tercero_id);
  if (publicados > 0) {
    await sbm().rpc("fn_portal_refrescar_maestro")
      .then(({ error }) => { if (error) console.error("Refresco del maestro:", error.message); });
  }
  return { publicados, sinCambio, rutasCambiadas, fallos, sinEmpresa: sinEmpresa.length,
           montoSinEmpresa: sinEmpresa.reduce((s, r) => s + Number(r.pago_neto || 0), 0) };
}

// Deja registrado quién guardó el día: 'analista' o 'automatico'.
// El automático nunca pisa un día marcado por el analista.
export async function marcarDiaGuardado(fecha, { origen, usuario = null, rutas = null, pagoNeto = null }) {
  const { error } = await sbm().from("dia_guardado_mx").upsert({
    fecha, origen, usuario, rutas, pago_neto: pagoNeto, guardado_at: new Date().toISOString(),
  }, { onConflict: "fecha" });
  if (error) throw new Error("no se pudo marcar quién guardó el día: " + error.message);
}
