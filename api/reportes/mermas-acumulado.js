// ═══════════════════════════════════════════════════════════════════════════
// /api/mermas-acumulado.js — Trae el acumulado de penalidades del período en
// curso desde MELI y lo deja en mermas_cargas_lineas.
//
// Por qué un endpoint y no una llamada desde el navegador: envios.adminml.com
// no permite CORS y la petición necesita las cookies de sesión de MELI, que
// viven en sesiones_meli y no en el navegador del analista.
//
// Solo usa las sesiones de ext_castiala y ext_narjuan: son las únicas cuentas
// con acceso al módulo de facturación. Si se usara otra, MELI responde 403 y
// el barrido quedaría en silencio.
//
// MELI acumula en vivo: la pre-factura del período en curso se va llenando día
// a día. Por eso conviene correr esto cada mañana en vez de esperar al cierre,
// que es lo que hoy hace que el tercero se entere del cobro tres meses después.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const CARRIER_ID = "2147510029";
const USUARIOS_FACTURACION = ["ext_castiala", "ext_narjuan"];

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Períodos de MELI: Q1 es del 1 al 15, Q2 del 16 al fin de mes.
// Se calcula como respaldo; lo que manda es el period.name que devuelve la
// lista de pre-invoices, porque si MELI cambia la convención el barrido la sigue.
function periodoDe(fecha) {
  const d = new Date(fecha);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}Q${d.getUTCDate() <= 15 ? 1 : 2}`;
}

async function cookiesDeSesion() {
  const { data, error } = await sb.from("sesiones_meli")
    .select("usuario_id, cookies, actualizado_at")
    .in("usuario_id", USUARIOS_FACTURACION)
    .order("actualizado_at", { ascending: false });
  if (error) throw new Error("No se pudo leer sesiones_meli: " + error.message);
  if (!data || !data.length) {
    throw new Error(
      `No hay sesión de MELI para ${USUARIOS_FACTURACION.join(" ni ")}. ` +
      `Son las únicas cuentas con acceso a facturación: hay que renovar la sesión con Don B.`
    );
  }
  return { cookie: data[0].cookies, usuario: data[0].usuario_id, desde: data[0].actualizado_at };
}

async function pedir(url, cookie) {
  const r = await fetch(url, {
    headers: {
      cookie,
      "user-agent": "Mozilla/5.0",
      accept: "application/json, text/plain, */*",
      referer: "https://envios.adminml.com/logistics/billing/invoices",
    },
  });
  if (r.status === 401 || r.status === 403) {
    throw new Error("MELI rechazó la sesión (401/403): hay que renovarla con Don B.");
  }
  if (!r.ok) throw new Error(`MELI respondió ${r.status} en ${url}`);
  return r;
}

// Períodos vivos: los que MELI tiene in_progress o pending. En el cambio de Q
// hay dos abiertos a la vez, así que pedir solo el más nuevo pierde cobros.
async function periodosVivos(cookie) {
  const url = `https://envios.adminml.com/logistics/billing/api/pre-invoices` +
    `?page=1&sort_by=id&sort_type=desc&userType=3PL&carrier_id=${CARRIER_ID}`;
  const r = await pedir(url, cookie);
  const j = await r.json();
  const lista = j?.pre_invoices || [];
  const vivos = lista
    .filter(p => ["in_progress", "pending", "open"].includes(String(p.status || "").toLowerCase()))
    .map(p => p?.period?.name)
    .filter(Boolean);
  return [...new Set(vivos.length ? vivos : [periodoDe(new Date())])];
}

const N = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ""));
  return isFinite(n) ? n : null;
};
const T = (v) => (v === null || v === undefined) ? null : String(v).trim() || null;

// El Excel del acumulado tiene los mismos encabezados que el archivo que el
// analista carga a mano hoy, así que se mapea igual.
const COLS = {
  "GUIA": "guia", "GUÍA": "guia", "SHIPMENT ID": "guia", "ID ENVIO": "guia", "ID ENVÍO": "guia",
  "SITE": "site", "CECO": "ceco", "FECHA": "fecha",
  "ID RUTA": "id_ruta", "ROUTE ID": "id_ruta", "RUTA": "id_ruta",
  "MOTIVO": "motivo", "REASON": "motivo", "CONCEPTO": "motivo",
  "PLACA": "placa", "PATENTE": "placa",
  "CONDUCTOR": "conductor", "DRIVER": "conductor",
  "TRANSPORTISTA": "transportista", "CARRIER": "transportista",
  "VALOR": "valor", "MONTO": "valor", "AMOUNT": "valor", "COSTO": "valor",
  "ESTADO": "estado", "STATUS": "estado", "SUB ESTADO": "sub_estado",
};
const norm = (s) => String(s || "").toUpperCase().replace(/[_\-.]/g, " ").replace(/\s+/g, " ").trim();

function excelAFilas(buf, periodo) {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const hoja = wb.SheetNames[0];
  const crudo = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: null, raw: true });
  if (!crudo.length) return [];

  const mapa = {};
  for (const h of Object.keys(crudo[0])) {
    const destino = COLS[norm(h)];
    if (destino) mapa[h] = destino;
  }
  if (!Object.values(mapa).includes("guia")) {
    throw new Error(
      "El Excel del acumulado no trae una columna de guía reconocible. " +
      "Encabezados: " + Object.keys(crudo[0]).join(" · ")
    );
  }

  const vistas = new Set();
  const filas = [];
  for (const r of crudo) {
    const o = { periodo_prefactura: periodo, prefactura_meli: "ACUMULADO" };
    for (const [h, col] of Object.entries(mapa)) {
      let v = r[h];
      if (col === "valor") v = N(v);
      else if (col === "fecha") {
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        else v = T(v);
      } else v = T(v);
      o[col] = v;
    }
    const guia = T(o.guia);
    if (!guia || vistas.has(guia)) continue;   // sin guía no hay llave
    vistas.add(guia);
    o.guia = guia;
    o.estado = o.estado || "PENDIENTE DE COBRO";
    o.transportista_norm = o.transportista
      ? String(o.transportista).toUpperCase().replace(/\s+/g, " ").trim() : null;
    filas.push(o);
  }
  return filas;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Usa POST." });
  }
  try {
    const { cookie, usuario, desde } = await cookiesDeSesion();
    const periodos = req.query?.periodo ? [req.query.periodo] : await periodosVivos(cookie);

    const resumen = [];
    let totalNuevas = 0, totalActualizadas = 0, totalAnuladas = 0;

    for (const periodo of periodos) {
      const url = `https://envios.adminml.com/logistics/billing/api/files/accumulated-excel` +
        `/site/MLM/mile/LAST_MILE/carrier/${CARRIER_ID}?period_name=${periodo}`;
      const r = await pedir(url, cookie);
      const buf = Buffer.from(await r.arrayBuffer());
      const filas = excelAFilas(buf, periodo);

      // Lo que ya teníamos de este período, para saber qué es nuevo y qué
      // desapareció. Si MELI quita una guía del acumulado, es que la anuló:
      // el tercero tiene que dejar de verla sin que nadie lo decida a mano.
      const { data: previas } = await sb.from("mermas_cargas_lineas")
        .select("id, guia, valor")
        .eq("periodo_prefactura", periodo);
      const antes = new Map((previas || []).map(p => [p.guia, p]));
      const ahora = new Set(filas.map(f => f.guia));

      let nuevas = 0, actualizadas = 0;
      const aInsertar = [];
      for (const f of filas) {
        const p = antes.get(f.guia);
        if (!p) { aInsertar.push(f); nuevas++; }
        else if (Number(p.valor || 0) !== Number(f.valor || 0)) {
          await sb.from("mermas_cargas_lineas").update({ valor: f.valor }).eq("id", p.id);
          actualizadas++;
        }
      }
      for (let i = 0; i < aInsertar.length; i += 200) {
        const { error } = await sb.from("mermas_cargas_lineas").insert(aInsertar.slice(i, i + 200));
        if (error) throw new Error("Insert mermas: " + error.message);
      }

      // Anuladas por MELI: estaban y ya no vienen.
      const anuladas = [...antes.keys()].filter(g => !ahora.has(g));
      if (anuladas.length) {
        for (let i = 0; i < anuladas.length; i += 200) {
          const lote = anuladas.slice(i, i + 200);
          await sb.from("mermas_cargas_lineas")
            .update({ estado: "ANULADA POR MELI" })
            .eq("periodo_prefactura", periodo).in("guia", lote);
          // Y si ya se le había cobrado al tercero, se revierte sola.
          await sb.from("cobros_merma_mx")
            .update({ estado: "anulado" })
            .in("guia", lote).eq("estado", "enviado");
        }
      }

      totalNuevas += nuevas; totalActualizadas += actualizadas; totalAnuladas += anuladas.length;
      resumen.push({ periodo, lineas: filas.length, nuevas, actualizadas, anuladas: anuladas.length });
    }

    return res.status(200).json({
      ok: true, usuario, sesion_desde: desde,
      periodos: resumen,
      totales: { nuevas: totalNuevas, actualizadas: totalActualizadas, anuladas: totalAnuladas },
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || String(e) });
  }
}
