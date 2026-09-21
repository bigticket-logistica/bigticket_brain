// ═══════════════════════════════════════════════════════════════════════════
// /api/reportes/validar-cfdi.js — Pregunta al SAT si un CFDI existe y si sigue
// vigente.
//
// Usa ConsultaCFDIService, el servicio SOAP público del SAT: el mismo que está
// detrás de "Verifica tus facturas" en su portal. No necesita credenciales.
//
// Va como endpoint y no en el navegador porque el SAT no permite CORS.
//
// Qué NO hace: no verifica el sello digital ni que los datos del XML coincidan
// con lo timbrado. Confirma que ese folio fiscal existe en el SAT con ese
// emisor, ese receptor y ese total — que es lo que atrapa una factura
// inventada o cancelada, que es el caso real.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const SAT_URL = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";

// El SAT espera el total con 6 decimales y sin separadores de miles.
const totalSat = (n) => Number(n || 0).toFixed(6);

function armarSobre({ rfcEmisor, rfcReceptor, total, uuid }) {
  const expr =
    `?re=${encodeURIComponent(rfcEmisor)}` +
    `&rr=${encodeURIComponent(rfcReceptor)}` +
    `&tt=${encodeURIComponent(totalSat(total))}` +
    `&id=${encodeURIComponent(uuid)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            xmlns:tem="http://tempuri.org/">
  <s:Header/>
  <s:Body>
    <tem:Consulta><tem:expresionImpresa><![CDATA[${expr}]]></tem:expresionImpresa></tem:Consulta>
  </s:Body>
</s:Envelope>`;
}

const sacar = (xml, etiqueta) => {
  const m = xml.match(new RegExp(`<a:${etiqueta}>([\\s\\S]*?)</a:${etiqueta}>`))
    || xml.match(new RegExp(`<${etiqueta}>([\\s\\S]*?)</${etiqueta}>`));
  return m ? m[1].trim() : null;
};

async function consultarSat(datos) {
  const ctrl = new AbortController();
  // El SAT se cae o se pone lento con frecuencia. Mejor cortar y reintentar
  // después que dejar la petición colgada.
  const reloj = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(SAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://tempuri.org/IConsultaCFDIService/Consulta",
      },
      body: armarSobre(datos),
      signal: ctrl.signal,
    });
    const xml = await r.text();
    if (!r.ok) throw new Error(`El SAT respondió ${r.status}`);
    return {
      codigo: sacar(xml, "CodigoEstatus"),
      estado: sacar(xml, "Estado"),
      esCancelable: sacar(xml, "EsCancelable"),
      estatusCancelacion: sacar(xml, "EstatusCancelacion"),
      validacionEFOS: sacar(xml, "ValidacionEFOS"),
    };
  } finally { clearTimeout(reloj); }
}

export default async function handler(req, res) {
  try {
    const { factura_id, reintentar } = req.query || {};

    // Una factura puntual, o las que quedaron sin validar. Lo segundo es para
    // el reintento: una factura recién timbrada puede tardar en aparecer en el
    // SAT, así que un "no encontrado" al subirla no significa que sea falsa.
    let q = sb.from("facturas_tercero")
      .select("id, uuid, rfc_emisor, rfc_receptor, monto_factura, nombre_archivo")
      .not("uuid", "is", null);
    if (factura_id) q = q.eq("id", factura_id);
    else if (reintentar) q = q.is("sat_validado_at", null).limit(50);
    else return res.status(200).json({ ok: false, error: "Pasa factura_id, o reintentar=1 para las pendientes." });

    const { data: facturas, error } = await q;
    if (error) throw error;
    if (!facturas?.length) return res.status(200).json({ ok: true, revisadas: 0, resultados: [] });

    const resultados = [];
    for (const f of facturas) {
      if (!f.rfc_emisor || !f.rfc_receptor || f.monto_factura == null) {
        resultados.push({ id: f.id, uuid: f.uuid, estado: null,
          nota: "Faltan datos del XML para consultar al SAT" });
        continue;
      }
      try {
        const sat = await consultarSat({
          rfcEmisor: f.rfc_emisor, rfcReceptor: f.rfc_receptor,
          total: f.monto_factura, uuid: f.uuid,
        });

        // "Vigente" es el único estado que confirma la factura. "Cancelado"
        // significa que existió y ya no vale: es peor que no encontrarla,
        // porque alguien la subió sabiendo que estaba cancelada.
        const vigente = String(sat.estado || "").toLowerCase() === "vigente";
        const noExiste = String(sat.codigo || "").startsWith("N -");

        await sb.from("facturas_tercero").update({
          sat_estado: sat.estado,
          sat_es_cancelable: sat.esCancelable,
          sat_estatus_cancelacion: sat.estatusCancelacion,
          sat_codigo: sat.codigo,
          sat_mensaje: sat.validacionEFOS || null,
          sat_validado_at: new Date().toISOString(),
          // Solo se marca conciliada si el SAT la confirma. Una factura que el
          // SAT no reconoce no debería quedar como buena por omisión.
          ...(vigente ? {} : { estado: "recibida" }),
        }).eq("id", f.id);

        resultados.push({
          id: f.id, uuid: f.uuid, archivo: f.nombre_archivo,
          estado: sat.estado, codigo: sat.codigo, vigente, noExiste,
        });
      } catch (e) {
        // No se marca validado_at: así el reintento vuelve a tomarla.
        resultados.push({ id: f.id, uuid: f.uuid, error: e.message || String(e) });
      }
    }

    return res.status(200).json({
      ok: true, revisadas: resultados.length,
      vigentes: resultados.filter(r => r.vigente).length,
      con_problema: resultados.filter(r => r.estado && !r.vigente).length,
      sin_respuesta: resultados.filter(r => r.error).length,
      resultados,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || String(e) });
  }
}
