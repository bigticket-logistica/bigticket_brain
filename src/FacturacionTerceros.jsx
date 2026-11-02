// ═══════════════════════════════════════════════════════════════════════════
// FacturacionTerceros.jsx — Las facturas que los terceros suben desde su
// portal, contra cada prefactura enviada.
//
// Tres cosas que el analista necesita ver de un vistazo:
//   · Qué prefacturas enviadas todavía no tienen factura.
//   · De las que sí, cuáles cuadran con el monto y cuáles no.
//   · Qué dice el SAT de cada una: vigente, cancelada o no la encuentra.
//
// El estado del SAT se consulta al subir la factura desde el portal. Si el SAT
// estaba caído o la factura era muy reciente, queda pendiente y el reintento
// la vuelve a tomar — por eso hay un botón para forzar la consulta.
// ═══════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { sb } from "./shared";
import { avisarPortal } from "./avisarPortal";

const money = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (s) => s ? new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
const BRAIN_API = "/api/reportes/validar-cfdi";
// Un solo webhook para los correos de esta pestaña (rechazo y pago): n8n solo
// recibe destinatarios, asunto y cuerpo, y los manda por Brevo.
const WEBHOOK_CORREO = "https://bigticket2026.app.n8n.cloud/webhook/facturacion-terceros-mx";
const REMITENTE = "conciliacionesmx@bigticket.mx";
const PORTAL_URL = "https://prospeccionbtinterna.vercel.app";

// Si el correo falla, lo guardado en la base no se deshace: se avisa al
// analista y sigue. Devuelve true si n8n confirmó el envío.
async function enviarCorreo({ tipo, correoTo, cc, asunto, cuerpo, idRef }) {
  if (!correoTo) return false;
  try {
    const r = await fetch(WEBHOOK_CORREO, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, remitente: REMITENTE, correoTo, cc: cc || "", asunto, cuerpo, idRef }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.ok === true;
  } catch { return false; }
}

export default function FacturacionTerceros({ usuario }) {
  const [semana, setSemana] = useState(null);
  const [semanas, setSemanas] = useState([]);
  const [filas, setFilas] = useState(null);
  const [filtro, setFiltro] = useState("todas");
  const [busca, setBusca] = useState("");
  const [validando, setValidando] = useState(null);
  const [sel, setSel] = useState({});        // id de prefactura -> marcada para pagar
  const [pagando, setPagando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [rechazo, setRechazo] = useState(null); // { p, f } mientras se escribe el motivo
  const [motivo, setMotivo] = useState("");
  const [revisando, setRevisando] = useState(null);
  const quien = () => (usuario && (usuario.nombre || usuario.email)) || "Brain";

  const cargar = useCallback(async () => {
    setFilas(null);
    // Se parte de las prefacturas enviadas: la pregunta del analista es "¿quién
    // me falta por facturar?", no "¿qué facturas llegaron?".
    let q = sb.from("conciliaciones_terceros")
      .select("id, semana, empresa_nombre, service_center, liquido_pago, enviado_at, tercero_id, pagado_at, pagado_por, pago_referencia, correo_to, correo_cc, pdf_url, total_neto")
      .eq("estado", "enviada").not("tercero_id", "is", null)
      .order("semana", { ascending: false });
    if (semana) q = q.eq("semana", semana);
    const { data: prefs } = await q.limit(1000);

    const ids = (prefs || []).map(p => p.id);
    let facts = [];
    if (ids.length) {
      const { data } = await sb.from("facturas_tercero").select("*").in("conciliacion_id", ids);
      facts = data || [];
    }
    const porPref = {};
    // La más reciente primero: si el tercero sube otra después de un rechazo,
    // la pantalla tiene que mostrar la nueva, no la rechazada.
    facts.sort((a, b) => Number(b.id) - Number(a.id));
    for (const f of facts) (porPref[f.conciliacion_id] = porPref[f.conciliacion_id] || []).push(f);

    setFilas((prefs || []).map(p => ({ ...p, facturas: porPref[p.id] || [] })));

    const { data: ws } = await sb.from("conciliaciones_terceros")
      .select("semana").eq("estado", "enviada").order("semana", { ascending: false }).limit(500);
    const lista = [...new Set((ws || []).map(w => w.semana))];
    setSemanas(lista);
    // Arranca en la más reciente: el analista revisa la semana que acaba de
    // enviar, no el histórico completo.
    if (semana == null && lista.length) setSemana(lista[0]);
  }, [semana]);

  useEffect(() => { cargar(); }, [cargar]);

  const validar = async (f) => {
    setValidando(f.id); setMsg(null);
    try {
      const r = await fetch(`${BRAIN_API}?factura_id=${f.id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Sin detalle");
      const res = j.resultados?.[0];
      setMsg(res?.vigente
        ? { ok: true, txt: `El SAT confirma la factura ${f.serie_folio || f.uuid} como vigente.` }
        : { ok: false, txt: `El SAT responde: ${res?.estado || res?.codigo || res?.error || "sin respuesta"}.` });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo consultar al SAT: " + (e.message || e) }); }
    setValidando(null);
  };

  // El pago es uno por prefactura, así que se marca la prefactura entera y con
  // eso todas sus líneas quedan resueltas en el portal del tercero. Marcar
  // línea por línea sería pedir un trabajo que no refleja cómo ocurre el pago.
  const marcarPagadas = async () => {
    const ids = Object.keys(sel).filter(k => sel[k]).map(Number);
    if (!ids.length) return;
    const filasSel = (filas || []).filter(f => ids.includes(f.id));
    const total = filasSel.reduce((t, f) => t + Number(f.liquido_pago || 0), 0);
    // Pagar sin factura conforme deja al tercero cobrado sin comprobante
    // válido: se puede, pero no en silencio.
    const flojas = filasSel.filter(f => !["conforme", "aprobada"].includes(estadoDe(f)));
    if (flojas.length && !window.confirm(
      `${flojas.length} de las ${ids.length} prefacturas marcadas no tienen una factura conforme:\n\n` +
      flojas.slice(0, 8).map(f => `· ${f.empresa_nombre} — ${ESTADOS[estadoDe(f)].l}`).join("\n") +
      (flojas.length > 8 ? `\n· y ${flojas.length - 8} más` : "") +
      `\n\n¿Las marcas igual como pagadas?`)) return;
    const ref = window.prompt(
      `Marcar ${ids.length} prefactura(s) como pagadas.\n\nTotal: ${money(total)}\n\n` +
      `Referencia de la transferencia (opcional, queda visible para el tercero):`, "");
    if (ref === null) return;

    setPagando(true); setMsg(null);
    try {
      const { error } = await sb.from("conciliaciones_terceros").update({
        pagado_at: new Date().toISOString(),
        pagado_por: quien(),
        pago_referencia: ref.trim() || null,
      }).in("id", ids);
      if (error) throw error;
      // El pago es la noticia que el tercero más espera: va al teléfono.
      avisarPortal("pago", { prefacturas: ids.length });
      // Y también al correo, uno por prefactura, a los mismos destinatarios
      // que recibieron la prefactura.
      let sinCorreo = 0;
      for (const f of filasSel) {
        const ok = await enviarCorreo({
          tipo: "pago_realizado", correoTo: f.correo_to, cc: f.correo_cc, idRef: `pago|${f.id}`,
          asunto: `Pago realizado · semana ${f.semana} · ${f.empresa_nombre}`,
          cuerpo: `Hola,\n\nTe informamos que se realizó el pago de tu prefactura de la semana ${f.semana} ` +
            `(${f.service_center}) por ${money(f.liquido_pago)}.` +
            (ref.trim() ? `\n\nReferencia de la transferencia: ${ref.trim()}` : "") +
            `\n\nPuedes ver el detalle en tu portal: ${PORTAL_URL}\n\nEquipo de Conciliaciones Bigticket`,
        });
        if (!ok) sinCorreo++;
      }
      setMsg({ ok: sinCorreo === 0, txt: `${ids.length} prefactura(s) marcadas como pagadas por ${money(total)}. El tercero ya lo ve en su portal.` +
        (sinCorreo ? ` Ojo: ${sinCorreo} correo(s) de pago no se pudieron enviar.` : " Se le envió el correo.") });
      setSel({});
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudo marcar el pago: " + (e.message || e) }); }
    setPagando(false);
  };

  const nSel = Object.values(sel).filter(Boolean).length;

  // Aprobar es solo una marca del analista: no avisa al tercero.
  const aprobar = async (f) => {
    setRevisando(f.id); setMsg(null);
    const { error } = await sb.from("facturas_tercero").update({
      estado: "aprobada", revision_motivo: null, revision_por: quien(), revision_at: new Date().toISOString(),
    }).eq("id", f.id);
    setMsg(error ? { ok: false, txt: "No se pudo aprobar: " + error.message } : { ok: true, txt: `Factura ${f.serie_folio || f.uuid || ""} aprobada.` });
    setRevisando(null);
    await cargar();
  };

  // Rechazar guarda el motivo, manda el correo y avisa al portal. El tercero
  // corrige y sube otra factura contra la misma prefactura.
  const enviarRechazo = async () => {
    const { p, f } = rechazo;
    const m = motivo.trim();
    if (!m) return;
    setRevisando(f.id); setMsg(null);
    const { error } = await sb.from("facturas_tercero").update({
      estado: "rechazada", revision_motivo: m, revision_por: quien(), revision_at: new Date().toISOString(),
    }).eq("id", f.id);
    if (error) { setMsg({ ok: false, txt: "No se pudo rechazar: " + error.message }); setRevisando(null); return; }
    avisarPortal("factura_rechazada", { tercero_id: p.tercero_id, conciliacion_id: p.id });
    const ok = await enviarCorreo({
      tipo: "factura_rechazada", correoTo: p.correo_to, cc: p.correo_cc, idRef: `rechazo|${f.id}`,
      asunto: `Factura rechazada · semana ${p.semana} · ${p.empresa_nombre}`,
      cuerpo: `Hola,\n\nRevisamos la factura ${f.serie_folio || f.uuid || ""} que subiste para la prefactura de la semana ` +
        `${p.semana} (${p.service_center}, ${money(p.liquido_pago)}) y no pudimos aceptarla.\n\nMotivo: ${m}\n\n` +
        `Por favor sube una factura corregida desde tu portal: ${PORTAL_URL}\n\nEquipo de Conciliaciones Bigticket`,
    });
    setMsg(ok
      ? { ok: true, txt: `Factura rechazada. Se envió el correo a ${p.correo_to} y el aviso al portal.` }
      : { ok: false, txt: `Factura rechazada y avisada en el portal, pero el correo no se pudo enviar${p.correo_to ? "" : " (la prefactura no tiene correo)"}.` });
    setRechazo(null); setMotivo(""); setRevisando(null);
    await cargar();
  };

  // Dos botones separados: leer es rápido y no depende del SAT; el SAT es
  // lento y se cae seguido, así que no debe trabar la lectura.

  // 1) Leer y comparar: lee cada factura, compara los netos y Biggy marca en
  // rojo lo que no es de Ingreso. Va de a 10 por llamada (el servidor tiene
  // tiempo límite) y se repite hasta que no quede ninguna por leer.
  const leerPendientes = async () => {
    setValidando("leer"); setMsg(null);
    try {
      const l = { revisadas: 0, prerechazadas: 0 };
      for (let vuelta = 0; vuelta < 30; vuelta++) {
        setMsg({ ok: true, txt: `Leyendo facturas… ${l.revisadas} leída(s)` });
        const r = await fetch(`${BRAIN_API}?reintentar=1&solo_lectura=1`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Sin detalle");
        l.revisadas += j.revisadas; l.prerechazadas += j.prerechazadas || 0;
        if (j.revisadas < 10) break;
      }
      setMsg({ ok: true, txt: l.revisadas
        ? `${l.revisadas} factura(s) leída(s) y comparada(s)` +
          (l.prerechazadas ? `, ${l.prerechazadas} prerrechazada(s) por Biggy para tu revisión (no son de Ingreso).` : ".")
        : "No hay facturas nuevas por leer." });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "No se pudieron leer: " + (e.message || e) }); }
    setValidando(null);
  };

  // 2) Validar en el SAT: solo las que ya tienen datos y nunca se consultaron,
  // de a 5 por vez. Si quedan, se vuelve a apretar.
  const validarSat = async () => {
    setValidando("sat"); setMsg({ ok: true, txt: "Consultando al SAT…" });
    try {
      const r = await fetch(`${BRAIN_API}?reintentar=1`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Sin detalle");
      setMsg({ ok: true, txt: j.revisadas
        ? `SAT: ${j.vigentes} vigentes, ${j.con_problema} con problema, ${j.sin_respuesta} sin respuesta` +
          (j.revisadas === 5 ? ". Quedan más: vuelve a apretar." : ".")
        : "SAT: no hay facturas pendientes de validar." });
      await cargar();
    } catch (e) { setMsg({ ok: false, txt: "El SAT no respondió; vuelve a intentar en un rato. (" + (e.message || e) + ")" }); }
    setValidando(null);
  };

  // Lo que se compara es el neto: subtotal de la factura contra el neto de la
  // prefactura, antes de IVA y de retenciones. Si la factura todavía no tiene
  // el subtotal leído, se cae a la comparación de totales que había antes.
  const difDe = (p, f) => {
    if (!f) return { dif: null, neto: false };
    if (f.subtotal_factura != null && p.total_neto != null)
      return { dif: Math.round((Number(f.subtotal_factura) - Number(p.total_neto)) * 100) / 100, neto: true };
    return { dif: f.diferencia != null ? Number(f.diferencia) : null, neto: false };
  };

  // El estado de cada prefactura se decide por su factura: sin factura, con
  // diferencia de monto, rechazada por el SAT, o conforme.
  const estadoDe = (p) => {
    if (!p.facturas.length) return "sin_factura";
    const f = p.facturas[0];
    // La revisión del analista manda sobre las validaciones automáticas. Es el
    // mismo campo `estado` que lee el portal: "aprobada" la pasa a Facturado y
    // "rechazada" la devuelve a Por facturar, en rojo.
    if (f.estado === "rechazada") return "rechazada";
    if (f.estado === "aprobada") return "aprobada";
    // Marcada por Biggy (no es de Ingreso): espera la decisión del analista.
    if (f.validaciones?.prerechazo) return "prerechazada";
    if (f.sat_estado && String(f.sat_estado).toLowerCase() !== "vigente") return "sat_problema";
    const { dif } = difDe(p, f);
    if (dif != null && Math.abs(dif) > 1) return "descuadre";
    if (!f.uuid) return "sin_xml";
    if (!f.sat_estado) return "sin_validar";
    return "conforme";
  };

  const ESTADOS = {
    sin_factura:  { l: "Sin factura",      bg: "#f1f5f9", fg: "#64748b" },
    sin_xml:      { l: "Sin leer",          bg: "#f1f5f9", fg: "#64748b" },
    sin_validar:  { l: "Falta validar",    bg: "#dbeafe", fg: "#1e40af" },
    descuadre:    { l: "No cuadra",        bg: "#fef3c7", fg: "#92400e" },
    sat_problema: { l: "Rechazada por SAT", bg: "#fee2e2", fg: "#991b1b" },
    conforme:     { l: "Conforme",         bg: "#dcfce7", fg: "#166534" },
    aprobada:     { l: "Aprobada",         bg: "#16a34a", fg: "#fff" },
    rechazada:    { l: "Rechazada",        bg: "#dc2626", fg: "#fff" },
    prerechazada: { l: "Prerrechazada",    bg: "#fee2e2", fg: "#b91c1c" },
  };

  const { visibles, resumen } = useMemo(() => {
    const fs = (filas || []).map(p => ({ ...p, _estado: estadoDe(p) }));
    const r = {};
    for (const p of fs) {
      r[p._estado] = (r[p._estado] || 0) + 1;
      r[p.pagado_at ? "pagadas" : "por_pagar"] = (r[p.pagado_at ? "pagadas" : "por_pagar"] || 0) + 1;
    }
    // "Pagadas" y "Por pagar" no son estados de la factura sino del pago, así
    // que se filtran aparte.
    let v = filtro === "todas" ? fs
      : filtro === "pagadas" ? fs.filter(p => p.pagado_at)
      : filtro === "por_pagar" ? fs.filter(p => !p.pagado_at)
      : fs.filter(p => p._estado === filtro);
    const q = busca.trim().toLowerCase();
    if (q) v = v.filter(p => [p.empresa_nombre, p.service_center, p.facturas[0]?.uuid, p.facturas[0]?.serie_folio]
      .some(x => String(x || "").toLowerCase().includes(q)));
    return { visibles: v, resumen: r };
  }, [filas, filtro, busca]);

  // La prefactura se guarda como .html y Supabase la entrega como texto plano
  // (por eso se veía el código). Se descarga y se abre como página. La ventana
  // se abre antes de esperar la descarga para que el navegador no la bloquee.
  const abrir = async (path) => {
    if (/\.html?$/i.test(path || "")) {
      const ventana = window.open("", "_blank");
      const { data: blob, error } = await sb.storage.from("proceso_certificacion_bt").download(path);
      if (error || !blob) { if (ventana) ventana.close(); setMsg({ ok: false, txt: "No se pudo abrir la prefactura." }); return; }
      const url = URL.createObjectURL(new Blob([await blob.text()], { type: "text/html;charset=utf-8" }));
      if (ventana) ventana.location.href = url; else window.open(url, "_blank");
      return;
    }
    const { data } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 10.5, fontWeight: 700, color: "#64748b", background: "#f8fafc", textTransform: "uppercase", letterSpacing: .4, whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", fontSize: 12, borderBottom: "1px solid #f1f5f9" };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>Facturación de terceros</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2, maxWidth: 680, lineHeight: 1.5 }}>
            Las facturas que suben desde su portal contra cada prefactura enviada. El monto y el RFC
            se comparan al subirla; el estado lo confirma el SAT.
          </div>
        </div>
        {/* Siempre a la vista, aunque no haya nada marcado: escondido, el
            analista no sabe que puede marcar el pago desde aquí. */}
        <button onClick={marcarPagadas} disabled={pagando || nSel === 0}
          title={nSel === 0 ? "Marca las prefacturas que ya pagaste" : ""}
          style={{ padding: "9px 18px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700,
            background: pagando || nSel === 0 ? "#cbd5e1" : "#16a34a", color: "#fff", marginRight: 8,
            cursor: pagando || nSel === 0 ? "not-allowed" : "pointer" }}>
          {pagando ? "Marcando…" : nSel === 0 ? "Marcar como pagadas" : `Marcar ${nSel} como pagadas`}
        </button>
        <button onClick={leerPendientes} disabled={validando !== null}
          style={{ padding: "9px 18px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700,
            background: validando ? "#cbd5e1" : "#1a3a6b", color: "#fff", marginRight: 8,
            cursor: validando ? "not-allowed" : "pointer" }}>
          {validando === "leer" ? "Leyendo…" : "Leer y comparar"}
        </button>
        <button onClick={validarSat} disabled={validando !== null}
          style={{ padding: "9px 18px", borderRadius: 8, border: "1px solid #1a3a6b", fontSize: 12.5, fontWeight: 700,
            background: validando ? "#f1f5f9" : "#fff", color: "#1a3a6b",
            cursor: validando ? "not-allowed" : "pointer" }}>
          {validando === "sat" ? "Consultando…" : "Validar en el SAT"}
        </button>
      </div>

      {msg && (
        <div style={{ background: msg.ok ? "#f0fdf4" : "#fef2f2", color: msg.ok ? "#166534" : "#991b1b",
          border: `1px solid ${msg.ok ? "#86efac" : "#fca5a5"}`, borderRadius: 8,
          padding: "10px 12px", fontSize: 12.5, marginBottom: 12 }}>{msg.txt}</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <select value={semana || ""} onChange={e => setSemana(e.target.value ? Number(e.target.value) : null)}
          style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 11px", fontSize: 12.5 }}>
          <option value="">Todas las semanas</option>
          {semanas.map(w => <option key={w} value={w}>Semana {w}</option>)}
        </select>
        {[["todas", "Todas"], ["sin_factura", "Sin factura"], ["descuadre", "No cuadran"],
          ["sat_problema", "SAT"], ["prerechazada", "Prerrechazadas"], ["aprobada", "Aprobadas"], ["rechazada", "Rechazadas"], ["sin_validar", "Por validar"], ["conforme", "Conformes"],
          ["por_pagar", "Por pagar"], ["pagadas", "Pagadas"]].map(([id, l]) => (
          <button key={id} onClick={() => setFiltro(id)}
            style={{ padding: "6px 13px", borderRadius: 16, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${filtro === id ? "#1a3a6b" : "#e4e7ec"}`,
              background: filtro === id ? "#1a3a6b" : "#fff", color: filtro === id ? "#fff" : "#64748b" }}>
            {l}{resumen[id] ? ` (${resumen[id]})` : ""}
          </button>
        ))}
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Empresa, SC, folio fiscal…"
          style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 11px", fontSize: 12, minWidth: 220 }} />
      </div>

      {filas === null ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 36, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          Sin prefacturas en este filtro.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, width: 28 }}>
                <input type="checkbox"
                  checked={visibles.some(p => !p.pagado_at) && visibles.every(p => p.pagado_at || sel[p.id])}
                  onChange={e => {
                    const n = { ...sel };
                    for (const p of visibles) if (!p.pagado_at) n[p.id] = e.target.checked;
                    setSel(n);
                  }} />
                {/* Marca todas las de la pantalla; las ya pagadas quedan fuera. */}
              </th>
              <th style={th}>Sem</th><th style={th}>Empresa</th><th style={th}>SC</th>
              <th style={{ ...th, textAlign: "right" }}>Neto prefactura</th>
              <th style={{ ...th, textAlign: "right" }}>Neto factura</th>
              <th style={{ ...th, textAlign: "right" }}>Dif.</th>
              <th style={th}>Folio fiscal</th>
              <th style={{ ...th, textAlign: "center" }}>Monto</th>
              <th style={{ ...th, textAlign: "center" }}>SAT</th>
              <th style={th}>Estado</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {visibles.map(p => {
                const f = p.facturas[0];
                const e = ESTADOS[p._estado];
                const { dif, neto } = difDe(p, f);
                return (
                  <tr key={p.id} style={{ background: p.pagado_at ? "#f0fdf4" : "#fff" }}>
                    <td style={td}>
                      {!p.pagado_at && (
                        <input type="checkbox" checked={!!sel[p.id]}
                          onChange={() => setSel(x => ({ ...x, [p.id]: !x[p.id] }))} />
                      )}
                    </td>
                    <td style={{ ...td, color: "#64748b" }}>{p.semana}</td>
                    <td style={{ ...td, fontWeight: 600, color: "#334155" }}>{p.empresa_nombre}</td>
                    <td style={{ ...td, color: "#64748b" }}>{p.service_center}</td>
                    {/* Arriba el neto (lo que se compara); abajo, chico, el total con IVA. */}
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {p.total_neto != null ? money(p.total_neto) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: f?.subtotal_factura != null || f?.monto_factura != null ? "#334155" : "#cbd5e1" }}>
                      {f?.subtotal_factura != null ? money(f.subtotal_factura) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700,
                      color: dif == null ? "#cbd5e1" : Math.abs(dif) <= 1 ? "#16a34a" : "#b45309" }}>
                      {dif != null ? money(dif) : "—"}
                      {dif != null && !neto && <div style={{ fontSize: 9.5, fontWeight: 400, color: "#94a3b8" }}>en totales</div>}
                    </td>
                    <td style={{ ...td, color: "#94a3b8", fontSize: 10.5 }}>
                      {f?.serie_folio && <div style={{ color: "#334155", fontSize: 11.5 }}>{f.serie_folio}</div>}
                      {f?.uuid || (f ? (f.validaciones?.folio_repetido ? "" : "sin leer") : "—")}
                      {f?.validaciones?.folio_repetido && (
                        <div style={{ color: "#b45309" }}>Folio {f.validaciones.folio_repetido.slice(0, 8)}… ya subido en otra prefactura</div>
                      )}
                      {f?.validaciones?.efecto && !["Ingreso", "desconocido"].includes(f.validaciones.efecto) && (
                        <div style={{ color: "#dc2626", fontWeight: 600 }}>Comprobante de {f.validaciones.efecto}</div>
                      )}
                      {f?.validaciones?.prerechazo && !["rechazada", "aprobada"].includes(f.estado) && (
                        <div style={{ color: "#b91c1c", marginTop: 2 }}>Biggy: no es de Ingreso. Revisa y decide.</div>
                      )}
                      {f?.rfc_emisor && <div>RFC {f.rfc_emisor}</div>}
                    </td>
                    {/* Dos validaciones distintas: que el monto cuadre con la
                        prefactura, y que el SAT reconozca el comprobante. Una
                        puede pasar y la otra no. */}
                    <td style={{ ...td, textAlign: "center", fontSize: 15 }}>
                      {!f ? <span style={{ color: "#cbd5e1" }}>—</span>
                        : dif == null ? <span title="No se pudo leer el monto" style={{ color: "#94a3b8" }}>?</span>
                        : Math.abs(dif) <= 1
                          ? <span title={neto ? "El neto cuadra con la prefactura" : "El total cuadra con la prefactura"} style={{ color: "#16a34a" }}>✓</span>
                          : <span title={`Difiere en ${money(dif)}`} style={{ color: "#dc2626" }}>✗</span>}
                    </td>
                    <td style={{ ...td, textAlign: "center", fontSize: 15 }}>
                      {!f ? <span style={{ color: "#cbd5e1" }}>—</span>
                        : !f.sat_estado ? <span title="Todavía sin validar" style={{ color: "#94a3b8" }}>?</span>
                        : String(f.sat_estado).toLowerCase() === "vigente"
                          ? <span title="El SAT la confirma vigente" style={{ color: "#16a34a" }}>✓</span>
                          : <span title={`El SAT responde: ${f.sat_estado}`} style={{ color: "#dc2626" }}>✗</span>}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 10, background: e.bg, color: e.fg, whiteSpace: "nowrap" }}>
                        {e.l}
                      </span>
                      {f?.sat_estado && (
                        <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 2 }}>
                          SAT {fecha(f.sat_validado_at)}
                        </div>
                      )}
                      {f?.revision_at && ["rechazada", "aprobada"].includes(f.estado) && (
                        <div style={{ fontSize: 9.5, color: "#94a3b8", marginTop: 2, maxWidth: 220 }}>
                          {f.revision_por} · {fecha(f.revision_at)}
                          {f.revision_motivo && <div style={{ color: "#991b1b" }}>“{f.revision_motivo}”</div>}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      {p.pagado_at && (
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "#166534", marginBottom: 3 }}>
                          Pagada {fecha(p.pagado_at)}
                          {p.pago_referencia && <div style={{ fontWeight: 400, color: "#94a3b8" }}>{p.pago_referencia}</div>}
                        </div>
                      )}
                      {/* La prefactura que se le envió al tercero, para compararla con su factura. */}
                      {p.pdf_url && (
                        <button onClick={() => abrir(p.pdf_url)}
                          style={{ border: "1px solid #F47B20", background: "#fff", color: "#F47B20",
                            borderRadius: 5, padding: "4px 10px", fontSize: 10.5, cursor: "pointer", marginRight: 4 }}>
                          Prefactura
                        </button>
                      )}
                      {f && (
                        <>
                          <button onClick={() => abrir(f.storage_path)}
                            style={{ border: "1px solid #e4e7ec", background: "#fff", color: "#1a3a6b",
                              borderRadius: 5, padding: "4px 10px", fontSize: 10.5, cursor: "pointer" }}>
                            Ver factura
                          </button>
                          {f.uuid && (
                            <button onClick={() => validar(f)} disabled={validando !== null}
                              style={{ marginLeft: 4, border: "1px solid #1a3a6b", background: "#fff", color: "#1a3a6b",
                                borderRadius: 5, padding: "4px 10px", fontSize: 10.5, cursor: "pointer" }}>
                              {validando === f.id ? "…" : "SAT"}
                            </button>
                          )}
                          {/* Una prefactura pagada ya no se revisa. */}
                          {!p.pagado_at && (
                            <div style={{ marginTop: 4 }}>
                              <button onClick={() => aprobar(f)} disabled={revisando !== null || f.estado === "aprobada"}
                                style={{ border: "1px solid #16a34a", borderRadius: 5, padding: "4px 10px", fontSize: 10.5,
                                  background: f.estado === "aprobada" ? "#16a34a" : "#fff",
                                  color: f.estado === "aprobada" ? "#fff" : "#16a34a", cursor: "pointer" }}>
                                {revisando === f.id ? "…" : "Aprobar"}
                              </button>
                              <button onClick={() => { setRechazo({ p, f }); setMotivo(f.revision_motivo || f.validaciones?.prerechazo?.motivo || ""); }}
                                disabled={revisando !== null}
                                style={{ marginLeft: 4, border: "1px solid #dc2626", borderRadius: 5, padding: "4px 10px", fontSize: 10.5,
                                  background: f.estado === "rechazada" ? "#dc2626" : "#fff",
                                  color: f.estado === "rechazada" ? "#fff" : "#dc2626", cursor: "pointer" }}>
                                Rechazar
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rechazo && (
        <div onClick={() => revisando === null && setRechazo(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, padding: 22, width: 460, maxWidth: "92vw" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#991b1b" }}>Rechazar factura</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
              {rechazo.p.empresa_nombre} · semana {rechazo.p.semana} · {rechazo.p.service_center}<br />
              Se enviará a <strong>{rechazo.p.correo_to || "— sin correo —"}</strong>
              {rechazo.p.correo_cc ? ` (cc ${rechazo.p.correo_cc})` : ""} y le llegará el aviso en el portal y la app.
            </div>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} autoFocus rows={5}
              placeholder="Motivo del rechazo (lo verá el tercero)"
              style={{ width: "100%", boxSizing: "border-box", marginTop: 12, border: "1px solid #e4e7ec",
                borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setRechazo(null)} disabled={revisando !== null}
                style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #e4e7ec", background: "#fff",
                  color: "#64748b", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={enviarRechazo} disabled={revisando !== null || !motivo.trim()}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700, color: "#fff",
                  background: revisando !== null || !motivo.trim() ? "#fca5a5" : "#dc2626",
                  cursor: revisando !== null || !motivo.trim() ? "not-allowed" : "pointer" }}>
                {revisando !== null ? "Enviando…" : "Enviar rechazo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
