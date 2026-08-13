// ════════════════════════════════════════════════════════════════════════════
// mermas_core.js — Lógica pura del módulo Cobros de Mermas (sin React, sin DOM)
//
// Se separó del componente para que sea testeable de forma aislada y para que
// la plantilla del PDF pueda regenerarse fuera del navegador (n8n, script, etc).
// Nada acá toca window, document ni Supabase.
// ════════════════════════════════════════════════════════════════════════════

// ── Estados del Excel ───────────────────────────────────────────────────────
// El archivo del analista trae tres estados en la columna ESTADO:
//   COBRADO            → ya se descontó, NO se vuelve a cobrar
//   PENDIENTE DE COBRO → esto es lo que se cobra
//   ASUME BIGTICKET    → la absorbe la empresa (casi siempre TERCERO INACTIVO)
// Por defecto solo se cobra PENDIENTE DE COBRO. Es una decisión de dinero:
// si se relaja, se puede cobrar dos veces la misma merma.
export const MM_ESTADO_COBRABLE = "PENDIENTE DE COBRO";
export const MM_ESTADOS_CONOCIDOS = ["PENDIENTE DE COBRO", "COBRADO", "ASUME BIGTICKET"];

// Sub-estados que igual entran en PENDIENTE DE COBRO pero necesitan ojo humano
// antes de mandar el correo (el monto puede estar en discusión).
export const MM_SUBESTADOS_OJO = ["PARCIAL", "APELACION TERCERO", "EN PROCESO COBRO"];

// Sufijos societarios que se ignoran al comparar nombres de empresa.
const MM_SUFIJOS = [
  "SA DE CV", "S A DE C V", "SAPI DE CV", "S DE RL DE CV", "SC", "SAS",
  "SA", "SRL", "SPA", "LTDA", "EIRL", "INC", "LLC", "CO",
];

// ── Normalización ───────────────────────────────────────────────────────────

export function mmNorm(s) {
  return String(s == null ? "" : s).trim().toUpperCase();
}

/**
 * Normaliza un nombre de empresa/persona para comparar:
 * mayúsculas, sin acentos, sin puntuación, sin sufijos societarios,
 * espacios colapsados. "Gemini Logistics Services, S.A. de C.V." → "GEMINI LOGISTICS SERVICES"
 */
export function mmNormEmpresa(s) {
  let t = String(s == null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // quita acentos
    .toUpperCase()
    .replace(/[.,;:_"'()]/g, " ")
    .replace(/&/g, " Y ")
    .replace(/\s+/g, " ")
    .trim();
  // Quitar sufijo societario si está al final
  for (const suf of MM_SUFIJOS) {
    const re = new RegExp("\\s+" + suf.replace(/ /g, "\\s+") + "$");
    if (re.test(t)) { t = t.replace(re, ""); break; }
  }
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Similitud 0..1 entre dos nombres ya normalizados, por solapamiento de tokens
 * (Jaccard ponderado por tokens largos). No es Levenshtein: para nombres de
 * personas y razones sociales el orden de las palabras varía más que las letras.
 */
export function mmSimilitud(a, b) {
  const ta = mmNormEmpresa(a).split(" ").filter(x => x.length > 2);
  const tb = mmNormEmpresa(b).split(" ").filter(x => x.length > 2);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta), sb = new Set(tb);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return inter / union;
}

/**
 * Deriva el CECO/SC que usa prefacturas_parametros_mx.
 * El Excel trae SITE = "SHP1" y CECOS = "ML_MX_SHP1"; el catálogo guarda "SHP1".
 */
export function mmCeco(site, cecos) {
  const s = mmNorm(site);
  if (s) return s;
  const c = mmNorm(cecos);
  return c.replace(/^ML[_\s-]*MX[_\s-]*/, "").trim();
}

// ── Formato ─────────────────────────────────────────────────────────────────

/**
 * Pesos mexicanos CON centavos. Ojo: el fmtMon de Pagos.jsx hace Math.round,
 * lo que en mermas rompe la conciliación (los montos de MELI vienen con
 * centavos: 310.08, 991.59). Acá NO se redondea.
 */
export function mmFmtMon(v) {
  const n = Number(v || 0);
  return "$ " + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mmFmtFecha(v) {
  if (!v) return "—";
  if (v instanceof Date && !isNaN(v)) {
    const d = String(v.getUTCDate()).padStart(2, "0");
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${v.getUTCFullYear()}`;
  }
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${dmy[3]}`;
  return s.slice(0, 10);
}

/** Fecha en formato ISO (YYYY-MM-DD) para guardar en Postgres. null si no parsea. */
export function mmFechaISO(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

export function mmCorreoValido(c) {
  if (!c) return false;
  return /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/.test(String(c).trim());
}

/** Une listas de correos deduplicando case-insensitive. Acepta strings con ; o , */
export function mmUnirCorreos(...listas) {
  const out = [];
  for (const l of listas) {
    if (!l) continue;
    for (const parte of String(l).split(/[;,]/)) {
      const c = parte.trim();
      if (!c) continue;
      if (!out.some(y => y.toLowerCase() === c.toLowerCase())) out.push(c);
    }
  }
  return out.join("; ");
}

// ── Lectura del Excel ───────────────────────────────────────────────────────

const MM_COLS = {
  descripcion: "DESCRIPCION MELI",
  site: "SITE",
  cecos: "CECOS",
  fecha: "DIA CARGA",
  idRuta: "ID RUTA",
  guia: "N° GUÍA",
  motivo: "MOTIVO COBRO",
  placa: "PLACA",
  conductor: "CONDUCTOR",
  transportista: "TRANSPORTISTA",
  valor: "VALOR",
  cobrado: "VALOR COBRADO A 3ERO",
  prefacturaMeli: "PREFACTURA MELI",
  periodoPrefactura: "PERIODO PREFACTURA",
  estado: "ESTADO",
  subEstado: "SUB ESTADO",
  periodoCobro3ro: "PERIODO COBRO 3RO",
  glosa: "GLOSA PREFACTURA",
};

/**
 * Recibe el AOA crudo de la hoja "Detalle" (XLSX.utils.sheet_to_json con header:1)
 * y devuelve { filas, avisos }. Busca la fila de encabezado en lugar de asumir
 * que está en la fila 1: el archivo real trae una fila de totales por encima.
 */
export function mmLeerDetalle(aoa) {
  const avisos = [];
  if (!Array.isArray(aoa) || !aoa.length) return { filas: [], avisos: ["La hoja está vacía."] };

  let iHead = -1;
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = (aoa[i] || []).map(c => mmNorm(c));
    if (row.includes(MM_COLS.descripcion) || (row.includes(MM_COLS.transportista) && row.includes(MM_COLS.valor))) {
      iHead = i; break;
    }
  }
  if (iHead < 0) {
    return { filas: [], avisos: ["No se encontró la fila de encabezados (se buscó DESCRIPCION MELI / TRANSPORTISTA + VALOR)."] };
  }

  const head = (aoa[iHead] || []).map(c => mmNorm(c));
  const idx = {};
  for (const [k, label] of Object.entries(MM_COLS)) {
    idx[k] = head.indexOf(label);
  }
  const faltantes = ["site", "fecha", "idRuta", "guia", "motivo", "placa", "conductor", "transportista", "valor", "estado"]
    .filter(k => idx[k] < 0);
  if (faltantes.length) {
    return { filas: [], avisos: [`Faltan columnas obligatorias en el Excel: ${faltantes.map(k => MM_COLS[k]).join(", ")}`] };
  }

  const filas = [];
  for (let i = iHead + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const get = (k) => (idx[k] >= 0 ? r[idx[k]] : "");
    const transportista = String(get("transportista") || "").trim();
    const valor = Number(String(get("valor") == null ? "" : get("valor")).toString().replace(/[^0-9.-]/g, ""));
    const estado = mmNorm(get("estado"));
    // Fila vacía o de totales
    if (!transportista && !estado && !isFinite(valor)) continue;
    if (!transportista && !isFinite(valor)) continue;

    filas.push({
      fila: i + 1,                       // número de fila real en Excel, para avisar al analista
      descripcion: String(get("descripcion") || "").trim(),
      site: mmNorm(get("site")),
      cecos: mmNorm(get("cecos")),
      ceco: mmCeco(get("site"), get("cecos")),
      fecha: get("fecha"),
      idRuta: String(get("idRuta") == null ? "" : get("idRuta")).trim(),
      guia: String(get("guia") == null ? "" : get("guia")).trim(),
      motivo: String(get("motivo") || "").trim(),
      placa: mmNorm(get("placa")),
      conductor: String(get("conductor") || "").trim(),
      transportista,
      valor: isFinite(valor) ? valor : 0,
      cobrado: Number(String(get("cobrado") == null ? "" : get("cobrado")).toString().replace(/[^0-9.-]/g, "")) || 0,
      prefacturaMeli: String(get("prefacturaMeli") == null ? "" : get("prefacturaMeli")).trim(),
      periodoPrefactura: String(get("periodoPrefactura") == null ? "" : get("periodoPrefactura")).trim(),
      estado,
      subEstado: mmNorm(get("subEstado")),
      periodoCobro3ro: String(get("periodoCobro3ro") || "").trim(),
      glosa: String(get("glosa") || "").trim(),
    });
  }

  // Avisos de integridad — no bloquean, informan
  const sinTransportista = filas.filter(f => !f.transportista).length;
  if (sinTransportista) avisos.push(`${sinTransportista} fila(s) sin TRANSPORTISTA: no se pueden cobrar.`);
  const sinSite = filas.filter(f => !f.ceco).length;
  if (sinSite) avisos.push(`${sinSite} fila(s) sin SITE/CECO: no se puede identificar el supervisor.`);
  const estadosRaros = [...new Set(filas.map(f => f.estado).filter(e => e && !MM_ESTADOS_CONOCIDOS.includes(e)))];
  if (estadosRaros.length) avisos.push(`ESTADO no reconocido: ${estadosRaros.join(", ")} (esas filas quedan fuera del cobro).`);
  const valorCero = filas.filter(f => f.estado === MM_ESTADO_COBRABLE && !(f.valor > 0)).length;
  if (valorCero) avisos.push(`${valorCero} fila(s) pendientes con VALOR 0 o vacío: se excluyen del PDF.`);

  // Guías duplicadas dentro de lo cobrable (misma merma cargada dos veces)
  const vistas = new Map();
  const dupes = [];
  for (const f of filas.filter(x => x.estado === MM_ESTADO_COBRABLE)) {
    const k = f.guia + "|" + f.motivo;
    if (!k.startsWith("|") && vistas.has(k)) dupes.push({ guia: f.guia, filas: [vistas.get(k), f.fila] });
    else vistas.set(k, f.fila);
  }
  if (dupes.length) {
    avisos.push(`${dupes.length} guía(s) repetida(s) entre las pendientes (${dupes.slice(0, 3).map(d => d.guia).join(", ")}${dupes.length > 3 ? "…" : ""}): revisar antes de cobrar.`);
  }

  return { filas, avisos, duplicados: dupes };
}

// ── Agrupación: empresa → sites → líneas ────────────────────────────────────

/**
 * Agrupa las filas cobrables por empresa, y dentro de cada empresa por Site.
 * Un PDF por empresa; dentro, un bloque por Site con su subtotal.
 */
export function mmAgrupar(filas, opts = {}) {
  const estados = opts.estados || [MM_ESTADO_COBRABLE];
  // Guías que ya salieron en un envío anterior (vienen del historial de cargas).
  // Se excluyen para que la misma merma no se cobre dos veces entre semanas.
  const excluir = opts.excluirGuias instanceof Set ? opts.excluirGuias : new Set(opts.excluirGuias || []);
  const cobrables = filas.filter(f =>
    estados.includes(f.estado) && f.transportista && f.valor > 0 && !excluir.has(String(f.guia))
  );

  const porEmpresa = new Map();
  for (const f of cobrables) {
    const clave = mmNormEmpresa(f.transportista);
    if (!porEmpresa.has(clave)) {
      porEmpresa.set(clave, {
        clave,
        empresa: f.transportista,          // el nombre tal cual viene del Excel
        sites: new Map(),
        lineas: [],
        total: 0,
      });
    }
    const g = porEmpresa.get(clave);
    if (!g.sites.has(f.ceco)) g.sites.set(f.ceco, { ceco: f.ceco, lineas: [], subtotal: 0 });
    const s = g.sites.get(f.ceco);
    s.lineas.push(f);
    s.subtotal += f.valor;
    g.lineas.push(f);
    g.total += f.valor;
  }

  const grupos = [...porEmpresa.values()].map(g => {
    const sites = [...g.sites.values()]
      .map(s => ({
        ...s,
        lineas: [...s.lineas].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
      }))
      .sort((a, b) => a.ceco.localeCompare(b.ceco));
    return {
      clave: g.clave,
      empresa: g.empresa,
      sites,
      nLineas: g.lineas.length,
      nSites: sites.length,
      total: g.total,
      subEstadosOjo: [...new Set(g.lineas.map(l => l.subEstado).filter(s => MM_SUBESTADOS_OJO.includes(s)))],
      motivos: [...new Set(g.lineas.map(l => l.motivo).filter(Boolean))],
    };
  });

  grupos.sort((a, b) => b.total - a.total);
  return grupos;
}

// ── Cruce contra los catálogos de Prefacturas ───────────────────────────────

/**
 * Cruza cada grupo contra prefacturas_transportistas_mx y prefacturas_parametros_mx.
 * - TO  = correo_to del transportista (el dueño)
 * - CC  = correo_cc del transportista + correo_supervisor de CADA site del PDF + jefaturas
 * Si no hay match exacto, ofrece el mejor candidato por similitud pero NO lo aplica:
 * un cobro mal dirigido es peor que un cobro no enviado.
 */
export function mmCruzar(grupos, transportistas, parametros, opts = {}) {
  const ccJefaturas = opts.ccJefaturas || "";
  const umbral = opts.umbralSugerencia == null ? 0.55 : opts.umbralSugerencia;
  const overrides = opts.overrides || {};   // { [clave]: { transportistaId, to, cc, bcc } }

  const porNombre = new Map();
  (transportistas || []).forEach(t => porNombre.set(mmNormEmpresa(t.nombre), t));
  const porCeco = new Map();
  (parametros || []).forEach(p => porCeco.set(mmNorm(p.ceco), p));

  return grupos.map(g => {
    const ov = overrides[g.clave] || {};
    let trans = porNombre.get(g.clave) || null;
    let sugerencia = null;
    let matchTipo = trans ? "exacto" : "ninguno";

    if (ov.transportistaId) {
      const forzado = (transportistas || []).find(t => String(t.id) === String(ov.transportistaId));
      if (forzado) { trans = forzado; matchTipo = "manual"; }
    }

    if (!trans) {
      let mejor = null, mejorScore = 0;
      for (const t of transportistas || []) {
        const sc = mmSimilitud(g.empresa, t.nombre);
        if (sc > mejorScore) { mejorScore = sc; mejor = t; }
      }
      if (mejor && mejorScore >= umbral) {
        sugerencia = { transportista: mejor, score: mejorScore };
        matchTipo = "sugerido";
      }
    }

    // Parámetros por site: cada SC aporta su supervisor al CC
    const sitesInfo = g.sites.map(s => {
      const p = porCeco.get(mmNorm(s.ceco)) || null;
      return { ceco: s.ceco, param: p, supervisor: p?.supervisor || "", correoSupervisor: p?.correo_supervisor || "" };
    });
    const cecosSinParam = sitesInfo.filter(s => !s.param).map(s => s.ceco);

    const ccAuto = mmUnirCorreos(
      trans?.correo_cc || "",
      ...sitesInfo.map(s => s.correoSupervisor),
      ccJefaturas
    );

    const to = ov.to != null ? ov.to : (trans?.correo_to || "");
    const cc = ov.cc != null ? ov.cc : ccAuto;
    const bcc = ov.bcc != null ? ov.bcc : (trans?.correo_bcc || "");

    // Bloqueos (impiden enviar) vs avisos (informan)
    const bloqueos = [];
    const avisos = [];
    if (!trans) bloqueos.push(sugerencia
      ? `Empresa no cruzada — ¿es "${sugerencia.transportista.nombre}"? (${Math.round(sugerencia.score * 100)}%)`
      : "Empresa no registrada en Transportistas");
    if (!String(to).trim()) bloqueos.push("Sin correo TO del dueño");
    else if (!mmUnirCorreos(to).split("; ").every(mmCorreoValido)) bloqueos.push("Correo TO inválido");
    if (cc && !mmUnirCorreos(cc).split("; ").every(mmCorreoValido)) bloqueos.push("Correo CC inválido");

    if (cecosSinParam.length) avisos.push(`SC sin parámetros/supervisor: ${cecosSinParam.join(", ")}`);
    if (matchTipo === "manual") avisos.push("Transportista asignado a mano");
    if (g.subEstadosOjo.length) avisos.push(`Sub-estado a revisar: ${g.subEstadosOjo.join(", ")}`);
    if (trans && String(trans.estado || "").toUpperCase() === "INACTIVO") {
      avisos.push("Transportista marcado INACTIVO en el catálogo: puede no haber saldo para descontar");
    }

    return {
      ...g,
      trans, sugerencia, matchTipo, sitesInfo, cecosSinParam,
      to, cc, bcc,
      bloqueos, avisos,
      listo: bloqueos.length === 0,
    };
  });
}

// ── PDF (HTML que renderiza el VPS, igual que Conciliación Terceros) ────────

/**
 * Mismo header, colores y tipografía que la prefactura, con el título cambiado.
 * `logoB64` es el mismo LOGO_PREFACTURA_B64 que ya usa Pagos.jsx.
 */
export function mmConstruirHTML(grupo, opts = {}) {
  const logoB64 = opts.logoB64 || "";
  const periodoCobro = opts.periodoCobro || "";
  const folio = opts.folio || "";
  const emisor = opts.emisor || {
    razon: "ADMINISTRADORA DE SERVICIOS BIGTICKET MX S.A DE C.V",
    giro: "Servicios de mensajería y paquetería local",
    rfc: "ASB250618323",
    direccion: "Juan Vázquez de Mella 481, Miguel Hidalgo",
    cp: "11510",
    regimen: "General de Ley de Personas Morales",
  };
  const t = grupo.trans || {};

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Resumen por site (arriba a la derecha, como el "RESUMEN POR PATENTE")
  const filasResumen = grupo.sites.map(s => `
      <tr><td>${esc(s.ceco)}</td><td>${s.lineas.length}</td><td style="text-align:right">${mmFmtMon(s.subtotal)}</td></tr>`).join("");

  // Un bloque de detalle por site
  const bloques = grupo.sites.map(s => {
    const info = (grupo.sitesInfo || []).find(x => x.ceco === s.ceco) || {};
    const filas = s.lineas.map(l => `
      <tr>
        <td>${mmFmtFecha(l.fecha)}</td>
        <td>${esc(l.idRuta)}</td>
        <td>${esc(l.guia)}</td>
        <td>${esc(l.motivo)}</td>
        <td>${esc(l.placa)}</td>
        <td style="text-align:left">${esc(l.conductor)}</td>
        <td style="text-align:right">${mmFmtMon(l.valor)}</td>
      </tr>`).join("");
    return `
  <div class="blk">
    <div class="det-title">SITE ${esc(s.ceco)} — OPERACIÓN ML_MX_${esc(s.ceco)}${info.supervisor ? ` · SUPERVISOR: ${esc(info.supervisor)}` : ""}</div>
    <table class="det">
      <tr><th>FECHA</th><th>ID RUTA</th><th>N° GUÍA</th><th>MOTIVO</th><th>PLACA</th><th>CONDUCTOR</th><th>MONTO</th></tr>
      ${filas}
      <tr class="sub"><td colspan="6">SUBTOTAL ${esc(s.ceco)} — ${s.lineas.length} cobro(s)</td><td style="text-align:right">${mmFmtMon(s.subtotal)}</td></tr>
    </table>
  </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cobro mermas ${esc(grupo.empresa)} ${esc(periodoCobro)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family: Arial, Helvetica, sans-serif; }
  body { padding: 28px 32px; color:#1a1a1a; font-size:11px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; background:#F47B20; color:#fff; padding:14px 18px; border-radius:4px; }
  .head h1 { font-size:24px; letter-spacing:1px; }
  .head .sub { font-size:9px; margin-top:4px; line-height:1.5; font-weight:600; }
  .cols { display:flex; justify-content:space-between; gap:24px; margin-top:16px; }
  table { border-collapse:collapse; }
  .info td { border:1px solid #cdd3dc; padding:4px 8px; font-size:10px; }
  .info td.k { background:#e8ebf0; font-weight:700; width:170px; }
  .info td.v { background:#f5f6f8; min-width:230px; }
  .pat th { background:#404040; color:#fff; padding:4px 10px; font-size:9px; }
  .pat td { border:1px solid #cdd3dc; padding:4px 10px; text-align:center; font-size:10px; }
  .pat .tt { background:#595959; color:#fff; font-weight:700; text-align:center; padding:4px 10px; font-size:10px; }
  .tot { margin-top:14px; }
  .tot td { border:1px solid #cdd3dc; padding:4px 8px; font-size:10px; }
  .tot td.k { background:#e8ebf0; font-weight:700; width:170px; }
  .tot td.v { background:#f5f6f8; text-align:right; width:110px; font-weight:700; }
  .tot tr.big td.k { background:#1a3a6b; color:#fff; }
  .tot tr.big td.v { background:#eef2ff; color:#1a3a6b; }
  .blk { margin-top:20px; page-break-inside:avoid; }
  .det { width:100%; }
  .det-title { font-weight:800; font-size:10px; margin-bottom:4px; color:#1a3a6b; }
  .det th { background:#F47B20; color:#fff; padding:5px 6px; font-size:9px; }
  .det td { padding:4px 6px; text-align:center; border-bottom:1px solid #eef0f3; font-size:10px; }
  .det tr.sub td { background:#e8ebf0; font-weight:700; text-align:right; font-size:10px; border-bottom:none; }
  .nota { margin-top:18px; border:1px solid #fdba74; background:#fff7ed; border-radius:4px; padding:10px 12px; }
  .nota-title { font-weight:800; font-size:10px; color:#9a3412; margin-bottom:6px; }
  .nota-row { font-size:10px; color:#7c2d12; padding:2px 0; }
  .pie { margin-top:22px; font-size:9px; color:#64748b; border-top:1px solid #e4e7ec; padding-top:8px; }
  @media print { body { padding: 10mm 12mm; } .noprint { display:none; } }
  .noprint { margin-top:24px; } .noprint button { padding:8px 18px; background:#1a3a6b; color:#fff; border:none; border-radius:6px; font-size:13px; cursor:pointer; }
</style></head><body>
  <div class="head">
    <div>
      <h1>COBRO A TERCEROS — MERMAS</h1>
      <div class="sub">${esc(emisor.razon)}<br/>
      ${esc(emisor.giro)}<br/>
      RFC: ${esc(emisor.rfc)} // DIRECCION: ${esc(emisor.direccion)} // CODIGO POSTAL: ${esc(emisor.cp)} // REGIMEN: ${esc(emisor.regimen)}</div>
    </div>
    ${logoB64 ? `<div class="logo"><img src="${logoB64}" alt="bigticket logística y transporte" style="height:50px;display:block"/></div>` : ""}
  </div>
  <div class="cols">
    <div>
      <table class="info">
        <tr><td class="k">EMPRESA TRANSPORTE:</td><td class="v">${esc(grupo.empresa)}</td></tr>
        <tr><td class="k">RFC EMPRESA TRANSPORTE:</td><td class="v">${esc(t.rfc || "—")}</td></tr>
        <tr><td class="k">SITES INVOLUCRADOS:</td><td class="v">${grupo.sites.map(s => esc(s.ceco)).join(" · ")}</td></tr>
        <tr><td class="k">PERIODO DE COBRO:</td><td class="v">${esc(periodoCobro || "—")}</td></tr>
        <tr><td class="k">FOLIO:</td><td class="v">${esc(folio || "—")}</td></tr>
        <tr><td class="k">EMITIDO:</td><td class="v">${mmFmtFecha(new Date())}</td></tr>
      </table>
      <table class="tot">
        <tr><td class="k">CANTIDAD DE COBROS</td><td class="v">${grupo.nLineas}</td></tr>
        <tr><td class="k">MOTIVOS</td><td class="v">${grupo.motivos.map(esc).join(" / ") || "—"}</td></tr>
        <tr class="big"><td class="k">TOTAL A DESCONTAR</td><td class="v">${mmFmtMon(grupo.total)}</td></tr>
      </table>
    </div>
    <div>
      <table class="pat">
        <tr><td class="tt" colspan="3">RESUMEN POR SITE:</td></tr>
        <tr><th>SITE</th><th>COBROS</th><th>SUBTOTAL</th></tr>
        ${filasResumen}
        <tr><td class="tt">TOTAL</td><td class="tt">${grupo.nLineas}</td><td class="tt" style="text-align:right">${mmFmtMon(grupo.total)}</td></tr>
      </table>
    </div>
  </div>
  ${bloques}
  <div class="nota">
    <div class="nota-title">CÓMO SE APLICA ESTE COBRO</div>
    <div class="nota-row">• El monto total de ${mmFmtMon(grupo.total)} se descuenta de su prefactura del período ${esc(periodoCobro || "en curso")}.</div>
    <div class="nota-row">• Cada línea corresponde a una penalización aplicada por Mercado Libre por paquete perdido o PNR, identificada por número de guía.</div>
    <div class="nota-row">• Si detecta diferencias, notifíquelas a su supervisor directo y a conciliacionesmx@bigticket.mx antes del cierre del período, indicando el número de guía.</div>
  </div>
  <div class="pie">Documento generado automáticamente por Bigticket Brain · ${esc(grupo.empresa)} · ${grupo.nSites} site(s) · ${grupo.nLineas} cobro(s) · ${mmFmtMon(grupo.total)}</div>
  <div class="noprint"><button onclick="window.print()">Imprimir / Guardar PDF</button></div>
</body></html>`;

  return { html, total: grupo.total, nombrePdf: mmNombrePdf(grupo, periodoCobro) };
}

export function mmNombrePdf(grupo, periodoCobro) {
  const emp = String(grupo.empresa).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const per = String(periodoCobro || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `Cobro_Mermas_${emp}${per ? "_" + per : ""}.pdf`;
}

/** Variables disponibles en las plantillas de asunto/cuerpo */
export function mmVariables(grupo, periodoCobro) {
  return {
    TRANSPORTISTA: grupo.empresa,
    RFC: grupo.trans?.rfc || "",
    SITES: grupo.sites.map(s => s.ceco).join(", "),
    N_SITES: String(grupo.nSites),
    N_COBROS: String(grupo.nLineas),
    TOTAL: mmFmtMon(grupo.total),
    PERIODO: periodoCobro || "",
    MOTIVOS: grupo.motivos.join(" / "),
  };
}

export function mmAplicarPlantilla(template, vars) {
  if (!template) return "";
  let out = String(template);
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp("\\{" + k + "\\}", "g"), v == null ? "" : String(v));
  }
  return out;
}
