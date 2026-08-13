// ════════════════════════════════════════════════════════════════════════════
// Mermas.jsx — Pestaña "Cobros de Mermas" (Pagos → Cobros Mermas)
//
// Flujo: el analista carga el Excel de mermas → el Brain agrupa por empresa
// (un PDF por empresa, un bloque por Site) → cruza contra los catálogos de
// Prefacturas para sacar los correos → el analista revisa → envío masivo por
// n8n/Brevo desde conciliacionesmx@bigticket.mx.
//
// Igual que Conciliación Terceros, al webhook se manda el HTML y el VPS
// renderiza el PDF. No se manda base64 desde el navegador.
// ════════════════════════════════════════════════════════════════════════════

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { descargarExcelMultihoja, sb } from "./shared";
import {
  MM_ESTADO_COBRABLE, MM_ESTADOS_CONOCIDOS,
  mmLeerDetalle, mmAgrupar, mmCruzar, mmConstruirHTML, mmNombrePdf,
  mmVariables, mmAplicarPlantilla, mmFmtMon, mmFmtFecha, mmUnirCorreos, mmSimilitud,
  mmFechaISO, mmNormEmpresa,
} from "./mermas_core";

// El logo (LOGO_PREFACTURA_B64) vive en Pagos.jsx y llega por prop.
// No se importa desde acá: Pagos.jsx importa este módulo, así que un import
// en sentido contrario sería circular.

const MERMAS_WEBHOOK = "https://bigticket2026.app.n8n.cloud/webhook/cobros-mermas-mx";
const REMITENTE = "conciliacionesmx@bigticket.mx";
const PAUSA_ENTRE_ENVIOS_MS = 1500;
const XLSX_CDN = "https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js";

const LS_ASUNTO = "mm_mx_asunto";
const LS_CUERPO = "mm_mx_cuerpo";
const LS_JEFATURAS = "mm_mx_cc_jefaturas";

const VARIABLES = ["TRANSPORTISTA", "RFC", "SITES", "N_SITES", "N_COBROS", "TOTAL", "PERIODO", "MOTIVOS"];

const ASUNTO_DEFAULT = "Cobro de mermas {PERIODO} — {TRANSPORTISTA} — {TOTAL}";

const CUERPO_DEFAULT = `Estimado(a) {TRANSPORTISTA},

Adjunto encontrará el detalle de los cobros por mermas correspondientes al período {PERIODO}, por un total de {TOTAL} distribuido en {N_COBROS} cobro(s) en {N_SITES} site(s): {SITES}.

Estos montos corresponden a penalizaciones aplicadas por Mercado Libre por paquete perdido y/o PNR, y se descontarán de su prefactura del período {PERIODO}.

Cada cobro está identificado en el documento adjunto con su fecha, ID de ruta, número de guía, placa y conductor, para que pueda validarlo internamente.

En caso de presentar diferencias, favor notificarlas a su supervisor directo con copia a conciliacionesmx@bigticket.mx antes del cierre del período, indicando el número de guía correspondiente. Las diferencias reportadas después del cierre se procesan en la siguiente conciliación.

Quedamos a sus órdenes ante cualquier consulta.

Saludos cordiales,
Conciliaciones MX — Bigticket`;

async function asegurarXLSX() {
  if (window.XLSX) return true;
  await new Promise((res) => {
    const s = document.createElement("script");
    s.src = XLSX_CDN; s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
  return !!window.XLSX;
}

// ════════════════════════════════════════════════════════════════════════════
// Shell con sub-pestañas: cargar/enviar, historial de cargas, historial de envíos
// ════════════════════════════════════════════════════════════════════════════
export default function ModuloCobrosMermas({ usuario, logoB64 = "" }) {
  const [subtab, setSubtab] = useState(() => {
    try { return localStorage.getItem("mm_subtab") || "envio"; } catch { return "envio"; }
  });
  const cambiar = (t) => { try { localStorage.setItem("mm_subtab", t); } catch {} setSubtab(t); };

  const subtabs = [
    { id: "envio",    label: "Cargar y enviar",       icon: "📊" },
    { id: "cargas",   label: "Historial de cargas",   icon: "📥" },
    { id: "enviados", label: "Historial de envíos",   icon: "📨" },
  ];

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {subtabs.map(t => (
            <button key={t.id} onClick={() => cambiar(t.id)}
              style={{
                padding: "8px 16px", borderRadius: 8,
                border: `1px solid ${subtab === t.id ? "#1a3a6b" : "#e4e7ec"}`,
                background: subtab === t.id ? "#1a3a6b" : "#fff",
                color: subtab === t.id ? "#fff" : "#475569",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Geist, sans-serif",
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {subtab === "envio"    && <MermasCargaYEnvio usuario={usuario} logoB64={logoB64} />}
      {subtab === "cargas"   && <MermasHistorialCargas />}
      {subtab === "enviados" && <MermasHistorialEnvios />}
    </div>
  );
}

function MermasCargaYEnvio({ usuario, logoB64 = "" }) {
  // ── Maestros de Prefacturas (misma fuente de verdad, sin duplicar) ────────
  const [transportistas, setTransportistas] = useState([]);
  const [parametros, setParametros] = useState([]);
  const [cargandoMaestros, setCargandoMaestros] = useState(true);

  // ── Archivo cargado ──────────────────────────────────────────────────────
  const [archivo, setArchivo] = useState(null);
  const [filas, setFilas] = useState([]);
  const [avisosArchivo, setAvisosArchivo] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [cargaId, setCargaId] = useState(null);          // id en mermas_cargas
  const [guiasCobradas, setGuiasCobradas] = useState(new Set()); // ya cobradas antes
  const [error, setError] = useState("");
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef(null);

  // ── Parámetros del lote ──────────────────────────────────────────────────
  const [periodoCobro, setPeriodoCobro] = useState("");
  const [estadosIncluidos, setEstadosIncluidos] = useState([MM_ESTADO_COBRABLE]);
  const [ccJefaturas, setCcJefaturas] = useState(() => {
    try { return localStorage.getItem(LS_JEFATURAS) || ""; } catch { return ""; }
  });
  const [asuntoLote, setAsuntoLote] = useState(() => {
    try { return localStorage.getItem(LS_ASUNTO) || ASUNTO_DEFAULT; } catch { return ASUNTO_DEFAULT; }
  });
  const [cuerpoLote, setCuerpoLote] = useState(() => {
    try { return localStorage.getItem(LS_CUERPO) || CUERPO_DEFAULT; } catch { return CUERPO_DEFAULT; }
  });
  useEffect(() => { try { localStorage.setItem(LS_ASUNTO, asuntoLote); } catch {} }, [asuntoLote]);
  useEffect(() => { try { localStorage.setItem(LS_CUERPO, cuerpoLote); } catch {} }, [cuerpoLote]);
  useEffect(() => { try { localStorage.setItem(LS_JEFATURAS, ccJefaturas); } catch {} }, [ccJefaturas]);

  // ── Overrides y estado de envío por empresa (clave normalizada) ───────────
  const [overrides, setOverrides] = useState({});     // { clave: { transportistaId, to, cc, bcc } }
  const [envios, setEnvios] = useState({});           // { clave: { estado, motivo, ts, messageId } }
  const [seleccion, setSeleccion] = useState(new Set());
  const [modalEditar, setModalEditar] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState({ actual: 0, total: 0 });
  const [logFinal, setLogFinal] = useState(null);
  const abortRef = useRef(false);

  const cargarMaestros = async () => {
    setCargandoMaestros(true);
    try {
      const [{ data: t }, { data: p }] = await Promise.all([
        sb.from("prefacturas_transportistas_mx").select("*").order("nombre"),
        sb.from("prefacturas_parametros_mx").select("*").order("ceco"),
      ]);
      setTransportistas(t || []);
      setParametros(p || []);
    } catch (e) {
      console.error("maestros mermas:", e);
      setError("No se pudieron cargar los catálogos de Prefacturas: " + (e.message || e));
    }
    setCargandoMaestros(false);
  };
  useEffect(() => { cargarMaestros(); }, []);

  // ── Lectura del Excel ────────────────────────────────────────────────────
  const leerArchivo = async (file) => {
    setError(""); setLeyendo(true);
    try {
      if (!(await asegurarXLSX())) throw new Error("No se pudo cargar la librería de Excel.");
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
      const nombreHoja = wb.SheetNames.find(n => /detalle/i.test(n)) || wb.SheetNames[0];
      const ws = wb.Sheets[nombreHoja];
      const aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      const { filas: f, avisos: avs } = mmLeerDetalle(aoa);
      if (!f.length) throw new Error(avs[0] || "No se encontraron filas de mermas en el archivo.");
      const avisos = [...(avs || [])];

      // Un archivo nuevo invalida todo lo anterior
      setOverrides({}); setEnvios({}); setSeleccion(new Set()); setLogFinal(null);

      // ── Guías que ya se cobraron en un envío anterior ──────────────────────
      // Es la protección real contra cobrar dos veces la misma merma entre
      // semanas: el Excel de MELI arrastra las pendientes de períodos previos.
      const guias = [...new Set(f.filter(x => x.estado === MM_ESTADO_COBRABLE).map(x => x.guia).filter(Boolean))];
      let yaCobradas = new Set();
      if (guias.length) {
        try {
          const enLotes = [];
          for (let i = 0; i < guias.length; i += 300) enLotes.push(guias.slice(i, i + 300));
          for (const lote of enLotes) {
            const { data } = await sb.from("vw_mermas_guias_cobradas")
              .select("guia, periodo_cobro, transportista").in("guia", lote);
            (data || []).forEach(r => yaCobradas.add(String(r.guia)));
          }
        } catch (e) { console.error("chequeo guías cobradas:", e); }
      }
      setGuiasCobradas(yaCobradas);
      if (yaCobradas.size) {
        const monto = f.filter(x => yaCobradas.has(String(x.guia))).reduce((s2, x) => s2 + x.valor, 0);
        avisos.push(`${yaCobradas.size} guía(s) ya fueron cobradas en un envío anterior (${mmFmtMon(monto)}): quedan EXCLUIDAS del cobro.`);
      }

      setFilas(f);
      setAvisosArchivo(avisos);
      setArchivo({ nombre: file.name, size: file.size, hoja: nombreHoja });

      // Sugerir período desde el archivo si viene poblado
      const per = f.map(x => x.periodoPrefactura).filter(Boolean).sort().pop();
      if (per && !periodoCobro) setPeriodoCobro(per);

      // ── Guardar la carga en el historial ─────────────────────────────────
      await guardarCarga(file, buf, nombreHoja, f, avisos, yaCobradas);
    } catch (e) {
      setError(e.message || String(e));
      setFilas([]); setArchivo(null); setAvisosArchivo([]);
    }
    setLeyendo(false);
  };

  // ── Persistir la carga (cabecera + líneas) en el historial ───────────────
  const guardarCarga = async (file, buf, hoja, f, avisos, yaCobradas) => {
    try {
      let hash = null;
      try {
        const h = await crypto.subtle.digest("SHA-256", buf);
        hash = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
      } catch { /* sin hash si el navegador no expone subtle en http */ }

      const porEstado = (e) => f.filter(x => x.estado === e);
      const pend = porEstado(MM_ESTADO_COBRABLE);
      const empresas = new Set(pend.filter(x => !yaCobradas.has(String(x.guia))).map(x => mmNormEmpresa(x.transportista))).size;

      const { data: cab, error: errCab } = await sb.from("mermas_cargas").insert({
        usuario: usuario?.email || usuario?.nombre || "—",
        archivo_nombre: file.name,
        archivo_hash: hash,
        archivo_bytes: file.size,
        hoja,
        filas_total: f.length,
        filas_pendiente: pend.length,
        filas_cobrado: porEstado("COBRADO").length,
        filas_asume: porEstado("ASUME BIGTICKET").length,
        monto_total: Number(f.reduce((s2, x) => s2 + x.valor, 0).toFixed(2)),
        monto_pendiente: Number(pend.reduce((s2, x) => s2 + x.valor, 0).toFixed(2)),
        empresas_pendientes: empresas,
        periodo_sugerido: f.map(x => x.periodoPrefactura).filter(Boolean).sort().pop() || null,
        avisos: (avisos || []).join(" | ") || null,
        pais: "MX",
      }).select("id").single();
      if (errCab) throw errCab;

      setCargaId(cab.id);

      // Detalle en lotes: 618 filas de una sola vez hace timeout
      const lineas = f.map(x => ({
        carga_id: cab.id,
        fila_excel: x.fila,
        site: x.site || null,
        ceco: x.ceco || null,
        fecha: mmFechaISO(x.fecha),
        id_ruta: x.idRuta || null,
        guia: x.guia || null,
        motivo: x.motivo || null,
        placa: x.placa || null,
        conductor: x.conductor || null,
        transportista: x.transportista || null,
        transportista_norm: mmNormEmpresa(x.transportista) || null,
        valor: Number((x.valor || 0).toFixed(2)),
        estado: x.estado || null,
        sub_estado: x.subEstado || null,
        prefactura_meli: x.prefacturaMeli || null,
        periodo_prefactura: x.periodoPrefactura || null,
      }));
      for (let i = 0; i < lineas.length; i += 200) {
        const { error } = await sb.from("mermas_cargas_lineas").insert(lineas.slice(i, i + 200));
        if (error) throw error;
      }
    } catch (e) {
      console.error("guardar carga:", e);
      // La carga al historial no debe impedir trabajar: se avisa y se sigue.
      setAvisosArchivo(prev => [...prev, "No se pudo guardar esta carga en el historial: " + (e.message || e)]);
    }
  };

  const onDrop = (fileList) => {
    const f = Array.from(fileList || []).find(x => /\.(xlsx|xlsm|xls)$/i.test(x.name) && x.size > 0);
    if (!f) { setError("Arrastrá el archivo de mermas en formato .xlsx"); return; }
    leerArchivo(f);
  };

  const limpiarTodo = () => {
    if (!confirm("¿Quitar el archivo cargado y todos los resultados?\n\n(El asunto, cuerpo y jefaturas se mantienen)")) return;
    setFilas([]); setArchivo(null); setAvisosArchivo([]); setOverrides({});
    setEnvios({}); setSeleccion(new Set()); setLogFinal(null); setError("");
    setCargaId(null); setGuiasCobradas(new Set());
  };

  // ── Conteo por estado (para el filtro) ───────────────────────────────────
  const conteoEstados = useMemo(() => {
    const m = {};
    for (const f of filas) {
      if (!m[f.estado]) m[f.estado] = { n: 0, monto: 0 };
      m[f.estado].n++; m[f.estado].monto += f.valor;
    }
    return m;
  }, [filas]);

  // ── Agrupación + cruce ───────────────────────────────────────────────────
  const grupos = useMemo(
    () => mmAgrupar(filas, { estados: estadosIncluidos, excluirGuias: guiasCobradas }),
    [filas, estadosIncluidos, guiasCobradas]
  );

  const gruposCruzados = useMemo(
    () => mmCruzar(grupos, transportistas, parametros, { ccJefaturas, overrides }),
    [grupos, transportistas, parametros, ccJefaturas, overrides]
  );

  // Enriquecer con estado de envío y textos finales del correo
  const gruposFinales = useMemo(() => gruposCruzados.map(g => {
    const env = envios[g.clave] || {};
    const vars = mmVariables(g, periodoCobro);
    const ov = overrides[g.clave] || {};
    return {
      ...g,
      estadoEnvio: env.estado || null,
      motivoEnvio: env.motivo || "",
      tsEnvio: env.ts || null,
      asuntoFinal: mmAplicarPlantilla(ov.asunto != null ? ov.asunto : asuntoLote, vars),
      cuerpoFinal: mmAplicarPlantilla(ov.cuerpo != null ? ov.cuerpo : cuerpoLote, vars),
      // Un grupo ya enviado no vuelve a ser enviable: el bug que hoy permite
      // reenviar prefacturas ya entregadas no se replica acá.
      enviable: g.listo && env.estado !== "ok" && !!periodoCobro.trim(),
    };
  }), [gruposCruzados, envios, asuntoLote, cuerpoLote, periodoCobro, overrides]);

  const stats = useMemo(() => {
    const total = gruposFinales.reduce((s, g) => s + g.total, 0);
    const listos = gruposFinales.filter(g => g.listo);
    const bloqueados = gruposFinales.filter(g => !g.listo);
    return {
      empresas: gruposFinales.length,
      cobros: gruposFinales.reduce((s, g) => s + g.nLineas, 0),
      total,
      listos: listos.length,
      montoListos: listos.reduce((s, g) => s + g.total, 0),
      bloqueados: bloqueados.length,
      montoBloqueados: bloqueados.reduce((s, g) => s + g.total, 0),
      enviados: gruposFinales.filter(g => g.estadoEnvio === "ok").length,
      fallidos: gruposFinales.filter(g => g.estadoEnvio === "fallido").length,
    };
  }, [gruposFinales]);

  const seleccionEnviable = useMemo(
    () => gruposFinales.filter(g => seleccion.has(g.clave) && g.enviable),
    [gruposFinales, seleccion]
  );

  const toggleSel = (clave) => {
    setSeleccion(prev => {
      const n = new Set(prev);
      if (n.has(clave)) n.delete(clave); else n.add(clave);
      return n;
    });
  };
  const selTodos = () => setSeleccion(new Set(gruposFinales.filter(g => g.enviable).map(g => g.clave)));
  const selNinguno = () => setSeleccion(new Set());

  // ── PDF ──────────────────────────────────────────────────────────────────
  const verPDF = (g) => {
    const { html } = mmConstruirHTML(g, {
      logoB64,
      periodoCobro,
      folio: folioDe(g),
    });
    const w = window.open("", "_blank");
    if (!w) return alert("El navegador bloqueó la ventana emergente. Habilitá pop-ups para ver el PDF.");
    w.document.write(html); w.document.close();
  };

  const folioDe = (g) => {
    const per = String(periodoCobro || "").replace(/[^A-Za-z0-9]/g, "");
    const emp = String(g.empresa).replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
    return `MM-${per || "SINPER"}-${emp}`;
  };

  // ── Envío ────────────────────────────────────────────────────────────────
  const registrarLog = async (g, resultado) => {
    // Se inserta fila por fila, en el momento: si el navegador se cierra a mitad
    // del lote, lo ya enviado queda registrado.
    try {
      const { data: logRow, error: errLog } = await sb.from("mermas_cobros_envios_log").insert({
        fecha_envio: resultado.ts,
        periodo_cobro: periodoCobro,
        folio: folioDe(g),
        transportista: g.empresa,
        rfc: g.trans?.rfc || null,
        sites: g.sites.map(s => s.ceco).join(", "),
        n_sites: g.nSites,
        n_cobros: g.nLineas,
        monto_total: Number(g.total.toFixed(2)),
        guias: g.sites.flatMap(s => s.lineas.map(l => l.guia)).join(","),
        correo_to: g.to,
        correo_cc: g.cc,
        correo_bcc: g.bcc || null,
        asunto: g.asuntoFinal,
        nombre_pdf: mmNombrePdf(g, periodoCobro),
        estado: resultado.ok ? "enviado" : "fallido",
        motivo: resultado.motivo,
        message_id: resultado.messageId || null,
        match_tipo: g.matchTipo,
        usuario: usuario?.email || usuario?.nombre || "—",
        archivo_origen: archivo?.nombre || null,
        pais: "MX",
      }).select("id").single();
      if (errLog) throw errLog;

      // Marcar las líneas de esta carga como cobradas. Esto es lo que impide
      // que la próxima carga vuelva a cobrar las mismas guías.
      if (resultado.ok && cargaId) {
        const guias = g.sites.flatMap(s2 => s2.lineas.map(l => l.guia)).filter(Boolean);
        for (let i = 0; i < guias.length; i += 200) {
          const { error } = await sb.from("mermas_cargas_lineas")
            .update({ enviado_at: resultado.ts, periodo_cobro: periodoCobro, envio_log_id: logRow.id })
            .eq("carga_id", cargaId)
            .in("guia", guias.slice(i, i + 200));
          if (error) console.error("marcar líneas enviadas:", error);
        }
      }
    } catch (e) {
      console.error("log mermas:", e);
    }
  };

  const enviarUno = async (g) => {
    const { html, nombrePdf } = mmConstruirHTML(g, {
      logoB64,
      periodoCobro,
      folio: folioDe(g),
    });
    const payload = {
      idEnvio: `${folioDe(g)}|${Date.now()}`,
      remitente: REMITENTE,
      transportista: g.empresa,
      rfc: g.trans?.rfc || "",
      sites: g.sites.map(s => s.ceco).join(","),
      periodo: periodoCobro,
      folio: folioDe(g),
      nCobros: g.nLineas,
      montoTotal: Number(g.total.toFixed(2)),
      correoTo: mmUnirCorreos(g.to),
      cc: mmUnirCorreos(g.cc),
      bcc: mmUnirCorreos(g.bcc),
      asunto: g.asuntoFinal,
      cuerpo: g.cuerpoFinal,
      nombrePdf,
      html,
    };
    const resp = await fetch(MERMAS_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data.messageId || "";
  };

  const enviarSeleccionados = async () => {
    const items = seleccionEnviable;
    if (!items.length) return alert("No hay empresas seleccionadas y listas para enviar.");
    if (!periodoCobro.trim()) return alert("Falta el período de cobro: va en el PDF y en el asunto.");
    const totalMonto = items.reduce((s, g) => s + g.total, 0);
    if (!confirm(
      `Se enviarán ${items.length} cobro(s) de mermas desde ${REMITENTE}.\n\n` +
      `Monto total: ${mmFmtMon(totalMonto)}\nPeríodo: ${periodoCobro}\n\n` +
      `${stats.bloqueados > 0 ? `${stats.bloqueados} empresa(s) bloqueada(s) (${mmFmtMon(stats.montoBloqueados)}) NO se envían.\n\n` : ""}` +
      `¿Confirmás el envío?`
    )) return;

    abortRef.current = false;
    setEnviando(true); setLogFinal(null);
    setProgreso({ actual: 0, total: items.length });
    const inicio = Date.now();
    let ok = 0, err = 0, abortados = 0;

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) { abortados = items.length - i; break; }
      const g = items[i];
      setProgreso({ actual: i + 1, total: items.length });
      setEnvios(prev => ({ ...prev, [g.clave]: { estado: "enviando", motivo: "", ts: null } }));

      let resultado;
      try {
        const messageId = await enviarUno(g);
        resultado = { ok: true, motivo: messageId || "Enviado", messageId, ts: new Date().toISOString() };
        ok++;
      } catch (e) {
        resultado = { ok: false, motivo: e.message || String(e), messageId: "", ts: new Date().toISOString() };
        err++;
      }
      setEnvios(prev => ({
        ...prev,
        [g.clave]: { estado: resultado.ok ? "ok" : "fallido", motivo: resultado.motivo, ts: resultado.ts, messageId: resultado.messageId },
      }));
      await registrarLog(g, resultado);

      if (i < items.length - 1 && !abortRef.current) {
        await new Promise(r => setTimeout(r, PAUSA_ENTRE_ENVIOS_MS));
      }
    }

    setLogFinal({ ok, err, abortados, bloqueados: stats.bloqueados, segs: Math.round((Date.now() - inicio) / 1000) });
    setEnviando(false); setProgreso({ actual: 0, total: 0 });
    abortRef.current = false;
  };

  // ── Exportes ─────────────────────────────────────────────────────────────
  const descargarLog = async () => {
    const detalle = [
      ["Empresa", "Match", "Sites", "N° cobros", "Monto", "TO", "CC", "BCC", "Asunto", "Estado", "Motivo / MessageID", "Timestamp", "Bloqueos", "Avisos"],
      ...gruposFinales.map(g => [
        g.empresa, g.matchTipo, g.sites.map(s => s.ceco).join(" / "), g.nLineas, Number(g.total.toFixed(2)),
        g.to, g.cc, g.bcc, g.asuntoFinal,
        g.estadoEnvio === "ok" ? "ENVIADO" : g.estadoEnvio === "fallido" ? "FALLIDO" : (g.listo ? "PENDIENTE" : "BLOQUEADO"),
        g.motivoEnvio, g.tsEnvio ? new Date(g.tsEnvio).toLocaleString("es-MX") : "",
        g.bloqueos.join(" · "), g.avisos.join(" · "),
      ]),
    ];
    const lineas = [
      ["Empresa", "Site", "Fecha", "ID Ruta", "N° Guía", "Motivo", "Placa", "Conductor", "Monto", "Estado Excel", "Sub estado", "Fila Excel"],
      ...gruposFinales.flatMap(g => g.sites.flatMap(s => s.lineas.map(l => [
        g.empresa, s.ceco, mmFmtFecha(l.fecha), l.idRuta, l.guia, l.motivo, l.placa, l.conductor,
        Number(l.valor.toFixed(2)), l.estado, l.subEstado, l.fila,
      ]))),
    ];
    const resumen = [
      ["Cobros de mermas MX"],
      ["Archivo origen", archivo?.nombre || "—"],
      ["Período de cobro", periodoCobro || "—"],
      ["Estados incluidos", estadosIncluidos.join(" / ")],
      ["Generado", new Date().toLocaleString("es-MX")],
      ["Usuario", usuario?.nombre || usuario?.email || "—"],
      [""],
      ["Empresas", stats.empresas],
      ["Cobros", stats.cobros],
      ["Monto total", Number(stats.total.toFixed(2))],
      ["Listas para enviar", stats.listos],
      ["Bloqueadas", stats.bloqueados],
      ["Monto bloqueado", Number(stats.montoBloqueados.toFixed(2))],
      ["Enviadas OK", stats.enviados],
      ["Fallidas", stats.fallidos],
    ];
    await descargarExcelMultihoja(
      [{ nombre: "Resumen", datos: resumen }, { nombre: "Por empresa", datos: detalle }, { nombre: "Detalle cobros", datos: lineas }],
      `cobros_mermas_${(periodoCobro || "sin_periodo").replace(/\W+/g, "_")}`
    );
  };

  const abrirPDFsBloqueados = () => {
    const bloq = gruposFinales.filter(g => !g.listo);
    if (!bloq.length) return alert("No hay empresas bloqueadas.");
    if (!confirm(`Se abrirán ${bloq.length} PDF(s) en pestañas nuevas para enviarlos a mano.\n\n¿Continuar?`)) return;
    for (const g of bloq) verPDF(g);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const cargado = filas.length > 0;

  return (
    <div className="pg" style={{ maxWidth: 1500 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Cobros de Mermas · México</div>
        <div className="sec-sub">
          Cargá el Excel de mermas. El Brain agrupa por empresa (un PDF por empresa, un bloque por Site),
          cruza contra Transportistas y Parámetros/CECOs de Prefacturas para armar los destinatarios,
          y envía por Brevo desde <strong>{REMITENTE}</strong>.
        </div>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b", padding: "10px 14px", borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      {/* ═══ ZONA DE CARGA ══════════════════════════════════════════════════ */}
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(true); }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(false); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setArrastrando(false); onDrop(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `3px dashed ${arrastrando ? "#F47B20" : "#1a3a6b"}`, borderRadius: 16,
          padding: cargado ? "22px 24px" : "40px 24px", textAlign: "center", cursor: "pointer",
          background: arrastrando ? "#fff7ed" : "#f8fafc", transition: "all 0.2s", marginBottom: 16,
        }}
      >
        <div style={{ fontSize: cargado ? 30 : 48, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 17, color: "#1a3a6b", fontWeight: 700, marginBottom: 6 }}>
          {leyendo ? "Leyendo el archivo..." : arrastrando ? "Soltá el Excel aquí" : cargado ? `✓ ${archivo.nombre}` : "Arrastrá el Excel de mermas"}
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          {cargado
            ? `Hoja "${archivo.hoja}" · ${filas.length} filas leídas · ${(archivo.size / 1024).toFixed(0)} KB`
            : "o hacé clic para seleccionarlo · se lee la hoja \"Detalle\""}
        </div>
        {cargado && (
          <button onClick={e => { e.stopPropagation(); limpiarTodo(); }}
            style={{ marginTop: 12, background: "#fee2e2", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#991b1b", cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif" }}>
            Quitar archivo
          </button>
        )}
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" style={{ display: "none" }}
          onChange={e => { onDrop(e.target.files); e.target.value = ""; }} />
      </div>

      {avisosArchivo.length > 0 && (
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9a3412", marginBottom: 4 }}>Avisos del archivo (no bloquean el envío)</div>
          {avisosArchivo.map((a, i) => (
            <div key={i} style={{ fontSize: 11.5, color: "#7c2d12", padding: "1px 0" }}>• {a}</div>
          ))}
        </div>
      )}

      {cargado && (
        <>
          {/* ═══ PARÁMETROS DEL LOTE ══════════════════════════════════════ */}
          <div className="form-card">
            <div className="form-title">⚙️ Parámetros del cobro</div>
            <div className="two-col">
              <div className="field-row">
                <div className="field-label">Período de cobro * (va en el PDF y en el asunto)</div>
                <input value={periodoCobro} onChange={e => setPeriodoCobro(e.target.value)} placeholder="202608Q1" />
              </div>
              <div className="field-row">
                <div className="field-label">CC fijo — jefaturas (se suma a todos los envíos)</div>
                <input value={ccJefaturas} onChange={e => setCcJefaturas(e.target.value)} placeholder="jefatura.mx@bigticket.mx; control@bigticket.mx" />
              </div>
            </div>

            <div className="field-row">
              <div className="field-label">Estados del Excel que se cobran</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MM_ESTADOS_CONOCIDOS.map(est => {
                  const c = conteoEstados[est];
                  const activo = estadosIncluidos.includes(est);
                  const riesgoso = est !== MM_ESTADO_COBRABLE;
                  return (
                    <button key={est}
                      onClick={() => {
                        if (!activo && riesgoso && !confirm(
                          `"${est}" no es un estado cobrable.\n\n` +
                          (est === "COBRADO"
                            ? "Estas mermas YA se descontaron. Incluirlas cobra dos veces lo mismo."
                            : "Estas mermas las absorbe Bigticket (normalmente porque el tercero está inactivo).") +
                          `\n\n${c ? `${c.n} fila(s) · ${mmFmtMon(c.monto)}` : "sin filas"}\n\n¿Incluir de todas formas?`
                        )) return;
                        setEstadosIncluidos(prev => activo ? prev.filter(x => x !== est) : [...prev, est]);
                      }}
                      style={{
                        padding: "7px 12px", borderRadius: 8, cursor: "pointer",
                        border: `1px solid ${activo ? (riesgoso ? "#dc2626" : "#16a34a") : "#e4e7ec"}`,
                        background: activo ? (riesgoso ? "#fee2e2" : "#f0fdf4") : "#fff",
                        color: activo ? (riesgoso ? "#991b1b" : "#166534") : "#64748b",
                        fontSize: 12, fontWeight: 600, fontFamily: "Geist, sans-serif",
                      }}>
                      {activo ? "✓ " : ""}{est}
                      <span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>
                        {c ? `${c.n} · ${mmFmtMon(c.monto)}` : "0"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                Por defecto solo se cobra <strong>{MM_ESTADO_COBRABLE}</strong>. Los otros dos están fuera por diseño.
              </div>
            </div>
          </div>

          {/* ═══ EDITOR DE CORREO ══════════════════════════════════════════ */}
          <div className="form-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <div className="form-title" style={{ margin: 0 }}>✉️ Asunto y cuerpo</div>
              <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: "auto" }}>Se aplica a todos los envíos del lote</span>
              <button onClick={() => {
                if (!confirm("¿Restaurar asunto y cuerpo al valor por defecto?")) return;
                setAsuntoLote(ASUNTO_DEFAULT); setCuerpoLote(CUERPO_DEFAULT);
              }} style={{ background: "transparent", border: "1px solid #e4e7ec", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#64748b", cursor: "pointer", fontWeight: 600, fontFamily: "Geist, sans-serif" }}>
                ↺ Restaurar default
              </button>
            </div>
            <div className="field-row">
              <div className="field-label">Asunto</div>
              <input value={asuntoLote} onChange={e => setAsuntoLote(e.target.value)} style={{ fontSize: 13 }} />
            </div>
            <div className="field-row">
              <div className="field-label">Cuerpo</div>
              <textarea value={cuerpoLote} onChange={e => setCuerpoLote(e.target.value)}
                style={{ height: 240, fontSize: 12, fontFamily: "monospace", lineHeight: 1.6, resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Variables:</span>
              {VARIABLES.map(v => (
                <code key={v} style={{ background: "#eef2ff", color: "#1a3a6b", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontFamily: "monospace" }}>
                  {"{" + v + "}"}
                </code>
              ))}
            </div>
          </div>

          {/* ═══ INDICADORES ═══════════════════════════════════════════════ */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
            <Ind label="Empresas a cobrar" valor={stats.empresas} sub={`${stats.cobros} cobros`} color="#1a3a6b" />
            <Ind label="Monto total" valor={mmFmtMon(stats.total)} color="#1a3a6b" />
            <Ind label="Listas para enviar" valor={stats.listos} sub={mmFmtMon(stats.montoListos)} color="#16a34a" />
            <Ind label="Bloqueadas" valor={stats.bloqueados} sub={mmFmtMon(stats.montoBloqueados)} color="#dc2626" />
            {(stats.enviados > 0 || stats.fallidos > 0) && (
              <Ind label="Enviadas" valor={stats.enviados} sub={stats.fallidos ? `${stats.fallidos} fallidas` : "sin fallos"} color="#0891b2" />
            )}
          </div>

          {/* ═══ TABLA ═════════════════════════════════════════════════════ */}
          <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div className="form-title" style={{ margin: 0 }}>Revisión y envío</div>
                <button onClick={selTodos} style={btnGhost}>Seleccionar todos los listos</button>
                <button onClick={selNinguno} style={btnGhost}>Ninguno</button>
                {seleccion.size > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#065f46" }}>
                    {seleccionEnviable.length} seleccionada(s) · {mmFmtMon(seleccionEnviable.reduce((s, g) => s + g.total, 0))}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {stats.bloqueados > 0 && (
                  <button onClick={abrirPDFsBloqueados} style={btnGhost}>
                    📄 Abrir PDFs bloqueados ({stats.bloqueados})
                  </button>
                )}
                <button onClick={descargarLog} style={btnGhost}>⬇ Descargar Excel</button>
                {enviando ? (
                  <button onClick={() => { abortRef.current = true; }}
                    style={{ ...btnGhost, borderColor: "#fca5a5", color: "#991b1b", background: "#fef2f2" }}>
                    ⏹ Detener después del actual
                  </button>
                ) : (
                  <button onClick={enviarSeleccionados} disabled={seleccionEnviable.length === 0}
                    className="btn-orange" style={{ padding: "9px 18px", fontSize: 13, opacity: seleccionEnviable.length === 0 ? 0.5 : 1 }}>
                    📨 Enviar {seleccionEnviable.length} cobro{seleccionEnviable.length === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            </div>

            {!periodoCobro.trim() && (
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #e4e7ec", background: "#fff7ed", fontSize: 12, color: "#9a3412", fontWeight: 600 }}>
                ⚠ Falta el período de cobro. Sin eso no se puede enviar (va en el PDF y en el asunto).
              </div>
            )}

            {enviando && (
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #e4e7ec", background: "#fffbeb" }}>
                <div style={{ fontSize: 12, color: "#92400e", marginBottom: 6, fontWeight: 600 }}>
                  Enviando {progreso.actual} de {progreso.total}...
                </div>
                <div style={{ height: 8, background: "#fef3c7", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${(progreso.actual / Math.max(progreso.total, 1)) * 100}%`, height: "100%", background: "#F47B20", transition: "width 0.3s" }} />
                </div>
              </div>
            )}

            {logFinal && !enviando && (
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #e4e7ec", background: logFinal.err === 0 ? "#f0fdf4" : "#fffbeb" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: logFinal.err === 0 ? "#166534" : "#92400e" }}>
                  {logFinal.err === 0 ? "✓" : "⚠"} Envío finalizado en {logFinal.segs}s · {logFinal.ok} enviado(s) · {logFinal.err} fallido(s)
                  {logFinal.abortados > 0 && ` · ${logFinal.abortados} cancelado(s)`}
                  {logFinal.bloqueados > 0 && ` · ${logFinal.bloqueados} bloqueado(s)`}
                </div>
              </div>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                    <th style={{ ...th(), width: 30 }}></th>
                    <th style={th()}>Estado</th>
                    <th style={th()}>Empresa</th>
                    <th style={th()}>Sites</th>
                    <th style={th("right")}>Cobros</th>
                    <th style={th("right")}>Monto</th>
                    <th style={th()}>TO</th>
                    <th style={th()}>CC</th>
                    <th style={th()}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposFinales.map(g => (
                    <FilaGrupo key={g.clave} g={g}
                      seleccionado={seleccion.has(g.clave)}
                      onToggle={() => toggleSel(g.clave)}
                      onVerPDF={() => verPDF(g)}
                      onEditar={() => setModalEditar(g)}
                      enviando={enviando} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modalEditar && (
        <ModalEditarGrupo
          g={modalEditar}
          transportistas={transportistas}
          onCancelar={() => setModalEditar(null)}
          onGuardar={(campos) => {
            setOverrides(prev => ({ ...prev, [modalEditar.clave]: { ...(prev[modalEditar.clave] || {}), ...campos } }));
            setModalEditar(null);
          }}
        />
      )}
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────────────────────

function FilaGrupo({ g, seleccionado, onToggle, onVerPDF, onEditar, enviando }) {
  const [abierto, setAbierto] = useState(false);
  let bg = "transparent";
  if (g.estadoEnvio === "ok") bg = "#f0fdf4";
  else if (g.estadoEnvio === "fallido") bg = "#fef2f2";
  else if (g.estadoEnvio === "enviando") bg = "#fffbeb";
  else if (!g.listo) bg = "#fef2f2";

  return (
    <>
      <tr style={{ background: bg, borderBottom: "1px solid #f1f5f9" }}>
        <td style={td()}>
          <input type="checkbox" checked={seleccionado} disabled={!g.enviable || enviando}
            onChange={onToggle}
            title={g.estadoEnvio === "ok" ? "Ya enviado" : !g.listo ? "Bloqueado: revisá los errores" : "Marcar para enviar"} />
        </td>
        <td style={td()}><Badge g={g} /></td>
        <td style={td()}>
          <div style={{ fontWeight: 600 }}>{g.empresa}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {g.trans ? `RFC ${g.trans.rfc || "—"}` : "no registrado"}
            {g.matchTipo === "manual" && " · asignado a mano"}
          </div>
          {g.avisos.map((a, i) => (
            <div key={i} style={{ fontSize: 9.5, color: "#9a3412", marginTop: 2 }}>⚠ {a}</div>
          ))}
        </td>
        <td style={td()}>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", maxWidth: 190 }}>
            {g.sites.map(s => (
              <span key={s.ceco} title={`${s.lineas.length} cobros · ${mmFmtMon(s.subtotal)}`}
                style={{
                  background: (g.sitesInfo.find(x => x.ceco === s.ceco)?.param) ? "#eef2ff" : "#fff7ed",
                  color: (g.sitesInfo.find(x => x.ceco === s.ceco)?.param) ? "#1a3a6b" : "#9a3412",
                  padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                }}>{s.ceco}</span>
            ))}
          </div>
        </td>
        <td style={{ ...td("right"), fontWeight: 600 }}>{g.nLineas}</td>
        <td style={{ ...td("right"), fontWeight: 700, color: "#1a3a6b" }}>{mmFmtMon(g.total)}</td>
        <td style={td()}>
          <div style={{ wordBreak: "break-all", maxWidth: 190, fontSize: 11 }}>
            {g.to || <em style={{ color: "#dc2626" }}>vacío</em>}
          </div>
        </td>
        <td style={td()}>
          <div style={{ wordBreak: "break-all", maxWidth: 190, fontSize: 10, color: "#64748b" }}>{g.cc || "—"}</div>
        </td>
        <td style={td()}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <button onClick={onVerPDF} style={btnMini("#1a3a6b")}>Ver PDF</button>
            <button onClick={onEditar} disabled={enviando || g.estadoEnvio === "ok"} style={btnMini("#0891b2", enviando || g.estadoEnvio === "ok")}>
              {g.trans ? "Editar correos" : "Asignar / correos"}
            </button>
            <button onClick={() => setAbierto(v => !v)} style={btnMini("#64748b")}>
              {abierto ? "Ocultar" : "Ver cobros"}
            </button>
          </div>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={9} style={{ padding: "10px 16px", background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
            {g.sites.map(s => (
              <div key={s.ceco} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>
                  {s.ceco} — {s.lineas.length} cobro(s) · {mmFmtMon(s.subtotal)}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#e8ebf0" }}>
                      {["Fecha", "ID Ruta", "N° Guía", "Motivo", "Placa", "Conductor", "Monto", "Sub estado"].map(h => (
                        <th key={h} style={{ padding: "4px 8px", textAlign: h === "Monto" ? "right" : "left", fontSize: 10, color: "#475569" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.lineas.map((l, i) => (
                      <tr key={l.guia + i} style={{ borderBottom: "1px solid #eef0f3" }}>
                        <td style={{ padding: "3px 8px" }}>{mmFmtFecha(l.fecha)}</td>
                        <td style={{ padding: "3px 8px" }}>{l.idRuta}</td>
                        <td style={{ padding: "3px 8px", fontFamily: "monospace" }}>{l.guia}</td>
                        <td style={{ padding: "3px 8px" }}>{l.motivo}</td>
                        <td style={{ padding: "3px 8px" }}>{l.placa}</td>
                        <td style={{ padding: "3px 8px" }}>{l.conductor}</td>
                        <td style={{ padding: "3px 8px", textAlign: "right", fontWeight: 600 }}>{mmFmtMon(l.valor)}</td>
                        <td style={{ padding: "3px 8px", color: "#94a3b8", fontSize: 10 }}>{l.subEstado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function Badge({ g }) {
  const pill = (bg, color, txt, title) => (
    <span title={title} style={{ background: bg, color, padding: "3px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{txt}</span>
  );
  if (g.estadoEnvio === "ok") return pill("#dcfce7", "#166534", "✓ ENVIADO", g.motivoEnvio);
  if (g.estadoEnvio === "fallido") return (
    <div>
      {pill("#fee2e2", "#991b1b", "✗ FALLIDO", g.motivoEnvio)}
      <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2, maxWidth: 150 }}>{String(g.motivoEnvio).slice(0, 60)}</div>
    </div>
  );
  if (g.estadoEnvio === "enviando") return pill("#fef3c7", "#92400e", "⏳ ENVIANDO");
  if (!g.listo) return (
    <div>
      {pill("#fee2e2", "#991b1b", "⚠ BLOQUEADO", g.bloqueos.join(" · "))}
      <div style={{ fontSize: 9, color: "#991b1b", marginTop: 2, maxWidth: 160 }}>{g.bloqueos[0]}</div>
    </div>
  );
  if (!g.enviable) return pill("#f1f5f9", "#64748b", "SIN PERÍODO", "Falta el período de cobro");
  return pill("#dbeafe", "#1e40af", "LISTO");
}

function ModalEditarGrupo({ g, transportistas, onCancelar, onGuardar }) {
  const [busqueda, setBusqueda] = useState("");
  const [transportistaId, setTransportistaId] = useState(g.trans?.id ? String(g.trans.id) : "");
  const [to, setTo] = useState(g.to);
  const [cc, setCc] = useState(g.cc);
  const [bcc, setBcc] = useState(g.bcc);
  const [asunto, setAsunto] = useState(g.asuntoFinal);
  const [cuerpo, setCuerpo] = useState(g.cuerpoFinal);

  // ── Cierre seguro del modal ──────────────────────────────────────────────
  // El evento `click` se dispara en el ancestro común del mousedown y el
  // mouseup. Al seleccionar texto arrastrando desde un input y soltando fuera
  // de la caja, ese ancestro era el overlay y el modal se cerraba solo.
  // Solución: cerrar únicamente si el gesto empezó Y terminó en el overlay.
  const presionoOverlay = useRef(false);

  const huboCambios =
    to !== g.to || cc !== g.cc || bcc !== g.bcc ||
    asunto !== g.asuntoFinal || cuerpo !== g.cuerpoFinal ||
    transportistaId !== (g.trans?.id ? String(g.trans.id) : "");

  const cerrar = () => {
    if (huboCambios && !confirm("Tenés cambios sin guardar en este cobro.\n\n¿Cerrar y descartarlos?")) return;
    onCancelar();
  };

  // Escape cierra (con el mismo aviso de cambios sin guardar)
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q
      ? transportistas.filter(t => String(t.nombre).toLowerCase().includes(q) || String(t.rfc || "").toLowerCase().includes(q))
      : [...transportistas].sort((a, b) => mmSimilitud(g.empresa, b.nombre) - mmSimilitud(g.empresa, a.nombre));
    return base.slice(0, 40);
  }, [busqueda, transportistas, g.empresa]);

  const aplicarTransportista = (id) => {
    setTransportistaId(id);
    const t = transportistas.find(x => String(x.id) === String(id));
    if (t) {
      setTo(t.correo_to || "");
      setCc(mmUnirCorreos(t.correo_cc || "", ...g.sitesInfo.map(s => s.correoSupervisor)));
      setBcc(t.correo_bcc || "");
    }
  };

  return (
    <div
      onMouseDown={e => { presionoOverlay.current = e.target === e.currentTarget; }}
      onClick={e => {
        // Solo cierra el clic que nació y murió en el fondo oscuro.
        if (presionoOverlay.current && e.target === e.currentTarget) cerrar();
        presionoOverlay.current = false;
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}
    >
      <div style={{ background: "#fff", borderRadius: 14, padding: 24, maxWidth: 780, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>{g.empresa}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          {g.nLineas} cobro(s) · {mmFmtMon(g.total)} · sites {g.sites.map(s => s.ceco).join(", ")}
        </div>

        {!g.trans && (
          <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#9a3412", marginBottom: 6 }}>
              Esta empresa no cruzó con el catálogo de Transportistas
            </div>
            {g.sugerencia && (
              <div style={{ fontSize: 11.5, color: "#7c2d12", marginBottom: 8 }}>
                Coincidencia probable: <strong>{g.sugerencia.transportista.nombre}</strong> ({Math.round(g.sugerencia.score * 100)}%).
                Confirmalo abajo si es la misma empresa.
              </div>
            )}
            <div style={{ fontSize: 11, color: "#7c2d12" }}>
              Podés asignarla a un transportista existente, o cargar los correos a mano solo para este envío.
              Si es una empresa nueva, conviene crearla en Prefacturas → Transportistas para que quede en el catálogo.
            </div>
          </div>
        )}

        <div className="field-row">
          <div className="field-label">Asignar a transportista del catálogo</div>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o RFC..." style={{ marginBottom: 6 }} />
          <select value={transportistaId} onChange={e => aplicarTransportista(e.target.value)} style={{ width: "100%" }}>
            <option value="">— sin asignar (correos manuales) —</option>
            {candidatos.map(t => (
              <option key={t.id} value={t.id}>
                {t.nombre} {t.rfc ? `· ${t.rfc}` : ""} {t.correo_to ? `· ${t.correo_to}` : "· SIN CORREO"}
                {!busqueda ? ` · ${Math.round(mmSimilitud(g.empresa, t.nombre) * 100)}%` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="two-col">
          <div className="field-row">
            <div className="field-label">Correo TO * (dueño)</div>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="dueno@empresa.mx (varios con ;)" />
          </div>
          <div className="field-row">
            <div className="field-label">CC (supervisores + jefaturas)</div>
            <input value={cc} onChange={e => setCc(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-label">BCC</div>
          <input value={bcc} onChange={e => setBcc(e.target.value)} placeholder="opcional" />
        </div>
        <div className="field-row">
          <div className="field-label">Asunto (override solo para esta empresa)</div>
          <input value={asunto} onChange={e => setAsunto(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field-label">Cuerpo (override solo para esta empresa · variables ya reemplazadas)</div>
          <textarea value={cuerpo} onChange={e => setCuerpo(e.target.value)} style={{ height: 160, fontSize: 12 }} />
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={cerrar} style={btnGhost}>Cancelar</button>
          <button onClick={() => onGuardar({ transportistaId: transportistaId || null, to, cc, bcc, asunto, cuerpo })}
            className="btn-blue" style={{ padding: "8px 16px", fontSize: 12 }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function Ind({ label, valor, sub, color }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || "#1a1a1a", letterSpacing: -0.5, lineHeight: 1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const btnGhost = {
  background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 12px",
  fontSize: 11.5, color: "#475569", cursor: "pointer", fontFamily: "Geist, sans-serif", fontWeight: 600,
};

function btnMini(color, disabled) {
  return {
    background: "transparent", border: `1px solid ${disabled ? "#e4e7ec" : color}`, borderRadius: 6,
    padding: "3px 8px", fontSize: 10.5, color: disabled ? "#94a3b8" : color,
    cursor: disabled ? "default" : "pointer", fontFamily: "Geist, sans-serif", fontWeight: 600,
    opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
  };
}

function th(align = "left") {
  return { padding: "9px 10px", fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "#64748b", textAlign: align, borderBottom: "1px solid #e4e7ec", whiteSpace: "nowrap" };
}

function td(align = "left") {
  return { padding: "8px 10px", fontSize: 12, color: "#1a1a1a", textAlign: align, verticalAlign: "top" };
}

// ════════════════════════════════════════════════════════════════════════════
// HISTORIAL DE CARGAS — qué Excel se subió, cuándo, y qué salió de cada uno
// ════════════════════════════════════════════════════════════════════════════

function MermasHistorialCargas() {
  const [cargas, setCargas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [limite, setLimite] = useState(50);
  const [abierta, setAbierta] = useState(null);       // id de la carga expandida
  const [lineas, setLineas] = useState([]);
  const [cargandoLineas, setCargandoLineas] = useState(false);
  const [filtroLineas, setFiltroLineas] = useState("todas");
  const [busqueda, setBusqueda] = useState("");

  const cargar = async () => {
    setCargando(true);
    try {
      const { data } = await sb.from("mermas_cargas")
        .select("*").eq("pais", "MX")
        .order("cargado_at", { ascending: false }).limit(limite);
      setCargas(data || []);
    } catch (e) { console.error("historial cargas:", e); }
    setCargando(false);
  };
  useEffect(() => { cargar(); }, [limite]);

  const abrir = async (id) => {
    if (abierta === id) { setAbierta(null); setLineas([]); return; }
    setAbierta(id); setCargandoLineas(true); setLineas([]); setFiltroLineas("todas");
    try {
      const { data } = await sb.from("mermas_cargas_lineas")
        .select("*").eq("carga_id", id)
        .order("fila_excel", { ascending: true });
      setLineas(data || []);
    } catch (e) { console.error("líneas de la carga:", e); }
    setCargandoLineas(false);
  };

  const lineasVisibles = useMemo(() => {
    let r = lineas;
    if (filtroLineas === "enviadas") r = r.filter(l => l.enviado_at);
    else if (filtroLineas === "pendientes") r = r.filter(l => !l.enviado_at && l.estado === MM_ESTADO_COBRABLE);
    else if (filtroLineas !== "todas") r = r.filter(l => l.estado === filtroLineas);
    const q = busqueda.trim().toLowerCase();
    if (q) r = r.filter(l =>
      String(l.transportista || "").toLowerCase().includes(q) ||
      String(l.guia || "").includes(q) ||
      String(l.site || "").toLowerCase().includes(q) ||
      String(l.placa || "").toLowerCase().includes(q)
    );
    return r.slice(0, 400);
  }, [lineas, filtroLineas, busqueda]);

  const descargar = async (carga) => {
    const { data } = await sb.from("mermas_cargas_lineas")
      .select("*").eq("carga_id", carga.id).order("fila_excel");
    const rows = data || [];
    await descargarExcelMultihoja([
      {
        nombre: "Resumen", datos: [
          ["Carga de mermas"],
          ["Archivo", carga.archivo_nombre],
          ["Cargado", new Date(carga.cargado_at).toLocaleString("es-MX")],
          ["Usuario", carga.usuario || "—"],
          ["Filas totales", carga.filas_total],
          ["Pendientes de cobro", carga.filas_pendiente],
          ["Ya cobradas (Excel)", carga.filas_cobrado],
          ["Asume Bigticket", carga.filas_asume],
          ["Monto total", Number(carga.monto_total || 0)],
          ["Monto pendiente", Number(carga.monto_pendiente || 0)],
          ["Empresas a cobrar", carga.empresas_pendientes],
          ["Avisos", carga.avisos || "—"],
        ]
      },
      {
        nombre: "Líneas", datos: [
          ["Fila Excel", "Site", "Fecha", "ID Ruta", "N° Guía", "Motivo", "Placa", "Conductor",
           "Transportista", "Valor", "Estado", "Sub estado", "Enviado", "Período cobro"],
          ...rows.map(l => [
            l.fila_excel, l.site, l.fecha, l.id_ruta, l.guia, l.motivo, l.placa, l.conductor,
            l.transportista, Number(l.valor || 0), l.estado, l.sub_estado,
            l.enviado_at ? new Date(l.enviado_at).toLocaleString("es-MX") : "", l.periodo_cobro || "",
          ]),
        ]
      },
    ], `carga_mermas_${carga.id}`);
  };

  const totales = useMemo(() => ({
    cargas: cargas.length,
    filas: cargas.reduce((s, c) => s + (c.filas_total || 0), 0),
    pendiente: cargas.reduce((s, c) => s + Number(c.monto_pendiente || 0), 0),
  }), [cargas]);

  return (
    <div className="pg" style={{ maxWidth: 1500 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Historial de cargas</div>
        <div className="sec-sub">
          Cada Excel de mermas que se subió al Brain, con su detalle línea por línea.
          Las líneas marcadas como enviadas son las que quedan excluidas de las cargas siguientes.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Ind label="Cargas" valor={totales.cargas} color="#1a3a6b" />
        <Ind label="Filas acumuladas" valor={totales.filas.toLocaleString("es-MX")} color="#1a3a6b" />
        <Ind label="Monto pendiente acumulado" valor={mmFmtMon(totales.pendiente)} color="#dc2626" />
      </div>

      <div className="form-card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={limite} onChange={e => setLimite(Number(e.target.value))} style={{ width: 150 }}>
            <option value={20}>Últimas 20</option>
            <option value={50}>Últimas 50</option>
            <option value={200}>Últimas 200</option>
          </select>
          <button onClick={cargar} style={btnGhost}>🔄 Refrescar</button>
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        {cargando ? (
          <div className="loading">Cargando historial...</div>
        ) : cargas.length === 0 ? (
          <div className="empty">Todavía no se cargó ningún archivo de mermas.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                  <th style={th()}>Cargado</th>
                  <th style={th()}>Archivo</th>
                  <th style={th()}>Usuario</th>
                  <th style={th("right")}>Filas</th>
                  <th style={th("right")}>Pendientes</th>
                  <th style={th("right")}>Monto pendiente</th>
                  <th style={th("right")}>Empresas</th>
                  <th style={th()}>Avisos</th>
                  <th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {cargas.map(c => (
                  <Fragment key={c.id}>
                    <tr style={{ borderBottom: "1px solid #f1f5f9", background: abierta === c.id ? "#eff6ff" : "transparent" }}>
                      <td style={td()}>
                        <div style={{ fontSize: 11.5 }}>{new Date(c.cargado_at).toLocaleString("es-MX")}</div>
                        <div style={{ fontSize: 9.5, color: "#94a3b8" }}>#{c.id}</div>
                      </td>
                      <td style={td()}>
                        <div style={{ fontWeight: 600, maxWidth: 240, wordBreak: "break-all" }}>{c.archivo_nombre}</div>
                        <div style={{ fontSize: 9.5, color: "#94a3b8" }}>
                          hoja {c.hoja || "—"} · {c.archivo_bytes ? (c.archivo_bytes / 1024).toFixed(0) + " KB" : "—"}
                          {c.periodo_sugerido ? ` · ${c.periodo_sugerido}` : ""}
                        </div>
                      </td>
                      <td style={td()}><span style={{ fontSize: 10.5, color: "#64748b" }}>{c.usuario || "—"}</span></td>
                      <td style={td("right")}>{c.filas_total}</td>
                      <td style={td("right")}>
                        <span style={{ fontWeight: 600 }}>{c.filas_pendiente}</span>
                        <div style={{ fontSize: 9.5, color: "#94a3b8" }}>
                          {c.filas_cobrado} cobr · {c.filas_asume} asume
                        </div>
                      </td>
                      <td style={{ ...td("right"), fontWeight: 700, color: "#1a3a6b" }}>{mmFmtMon(c.monto_pendiente)}</td>
                      <td style={td("right")}>{c.empresas_pendientes ?? "—"}</td>
                      <td style={td()}>
                        {c.avisos
                          ? <div style={{ fontSize: 9.5, color: "#9a3412", maxWidth: 260 }}>⚠ {c.avisos.slice(0, 160)}{c.avisos.length > 160 ? "…" : ""}</div>
                          : <span style={{ fontSize: 10, color: "#94a3b8" }}>sin avisos</span>}
                      </td>
                      <td style={td()}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <button onClick={() => abrir(c.id)} style={btnMini("#1a3a6b")}>
                            {abierta === c.id ? "Ocultar" : "Ver detalle"}
                          </button>
                          <button onClick={() => descargar(c)} style={btnMini("#0891b2")}>⬇ Excel</button>
                        </div>
                      </td>
                    </tr>
                    {abierta === c.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                          {cargandoLineas ? (
                            <div className="loading">Cargando líneas...</div>
                          ) : (
                            <>
                              <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <input placeholder="Buscar guía, empresa, site o placa..." value={busqueda}
                                  onChange={e => setBusqueda(e.target.value)} style={{ flex: "1 1 260px", maxWidth: 340 }} />
                                <select value={filtroLineas} onChange={e => setFiltroLineas(e.target.value)} style={{ width: 200 }}>
                                  <option value="todas">Todas ({lineas.length})</option>
                                  <option value="pendientes">Pendientes sin cobrar</option>
                                  <option value="enviadas">Ya cobradas desde el Brain</option>
                                  {MM_ESTADOS_CONOCIDOS.map(e => <option key={e} value={e}>{e}</option>)}
                                </select>
                                <span style={{ fontSize: 11, color: "#64748b" }}>
                                  {lineasVisibles.length} visible(s) · {mmFmtMon(lineasVisibles.reduce((s, l) => s + Number(l.valor || 0), 0))}
                                </span>
                              </div>
                              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                  <thead>
                                    <tr style={{ background: "#e8ebf0", position: "sticky", top: 0 }}>
                                      {["Fila", "Site", "Fecha", "ID Ruta", "N° Guía", "Motivo", "Placa", "Transportista", "Valor", "Estado", "Cobrado"].map(h => (
                                        <th key={h} style={{ padding: "5px 8px", textAlign: h === "Valor" ? "right" : "left", fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lineasVisibles.map(l => (
                                      <tr key={l.id} style={{ borderBottom: "1px solid #eef0f3", background: l.enviado_at ? "#f0fdf4" : "transparent" }}>
                                        <td style={{ padding: "3px 8px", color: "#94a3b8" }}>{l.fila_excel}</td>
                                        <td style={{ padding: "3px 8px" }}>{l.site}</td>
                                        <td style={{ padding: "3px 8px" }}>{mmFmtFecha(l.fecha)}</td>
                                        <td style={{ padding: "3px 8px" }}>{l.id_ruta}</td>
                                        <td style={{ padding: "3px 8px", fontFamily: "monospace" }}>{l.guia}</td>
                                        <td style={{ padding: "3px 8px" }}>{l.motivo}</td>
                                        <td style={{ padding: "3px 8px" }}>{l.placa}</td>
                                        <td style={{ padding: "3px 8px", maxWidth: 190 }}>{l.transportista}</td>
                                        <td style={{ padding: "3px 8px", textAlign: "right", fontWeight: 600 }}>{mmFmtMon(l.valor)}</td>
                                        <td style={{ padding: "3px 8px", fontSize: 10, color: "#64748b" }}>{l.estado}</td>
                                        <td style={{ padding: "3px 8px", fontSize: 10 }}>
                                          {l.enviado_at
                                            ? <span style={{ color: "#166534", fontWeight: 600 }}>✓ {l.periodo_cobro || new Date(l.enviado_at).toLocaleDateString("es-MX")}</span>
                                            : <span style={{ color: "#94a3b8" }}>—</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {lineas.length > 400 && (
                                  <div style={{ fontSize: 10.5, color: "#94a3b8", padding: "8px 0" }}>
                                    Se muestran las primeras 400 líneas. Usá el buscador o bajá el Excel para ver todo.
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HISTORIAL DE ENVÍOS — qué cobro salió, a quién, por cuánto
// ════════════════════════════════════════════════════════════════════════════

function MermasHistorialEnvios() {
  const [logs, setLogs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [limite, setLimite] = useState(200);
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [periodo, setPeriodo] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [detalle, setDetalle] = useState(null);

  const cargar = async () => {
    setCargando(true);
    try {
      const { data } = await sb.from("mermas_cobros_envios_log")
        .select("*").eq("pais", "MX")
        .order("fecha_envio", { ascending: false }).limit(limite);
      setLogs(data || []);
    } catch (e) { console.error("historial envíos:", e); }
    setCargando(false);
  };
  useEffect(() => { cargar(); }, [limite]);

  const periodos = useMemo(
    () => [...new Set(logs.map(l => l.periodo_cobro).filter(Boolean))].sort().reverse(),
    [logs]
  );

  const filtrados = useMemo(() => {
    let r = logs;
    if (filtroEstado !== "todos") r = r.filter(l => l.estado === filtroEstado);
    if (periodo !== "todos") r = r.filter(l => l.periodo_cobro === periodo);
    const q = busqueda.trim().toLowerCase();
    if (q) r = r.filter(l =>
      String(l.transportista || "").toLowerCase().includes(q) ||
      String(l.correo_to || "").toLowerCase().includes(q) ||
      String(l.sites || "").toLowerCase().includes(q) ||
      String(l.folio || "").toLowerCase().includes(q) ||
      String(l.guias || "").includes(q)
    );
    return r;
  }, [logs, filtroEstado, periodo, busqueda]);

  const stats = useMemo(() => ({
    total: filtrados.length,
    ok: filtrados.filter(l => l.estado === "enviado").length,
    err: filtrados.filter(l => l.estado === "fallido").length,
    monto: filtrados.filter(l => l.estado === "enviado").reduce((s, l) => s + Number(l.monto_total || 0), 0),
    cobros: filtrados.filter(l => l.estado === "enviado").reduce((s, l) => s + (l.n_cobros || 0), 0),
  }), [filtrados]);

  const descargar = async () => {
    await descargarExcelMultihoja([
      {
        nombre: "Envíos", datos: [
          ["Fecha", "Estado", "Período", "Folio", "Transportista", "RFC", "Sites", "N° cobros",
           "Monto", "TO", "CC", "Asunto", "PDF", "Match", "Motivo / MessageID", "Usuario", "Archivo origen", "Guías"],
          ...filtrados.map(l => [
            new Date(l.fecha_envio).toLocaleString("es-MX"), l.estado, l.periodo_cobro, l.folio,
            l.transportista, l.rfc, l.sites, l.n_cobros, Number(l.monto_total || 0),
            l.correo_to, l.correo_cc, l.asunto, l.nombre_pdf, l.match_tipo,
            l.motivo || l.message_id, l.usuario, l.archivo_origen, l.guias,
          ]),
        ]
      },
    ], "historial_envios_mermas");
  };

  return (
    <div className="pg" style={{ maxWidth: 1500 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Historial de envíos</div>
        <div className="sec-sub">Cada cobro de mermas que salió del Brain, con su monto, destinatarios y las guías incluidas.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Ind label="Envíos" valor={stats.total} color="#1a3a6b" />
        <Ind label="Enviados OK" valor={stats.ok} sub={`${stats.cobros} cobros`} color="#16a34a" />
        <Ind label="Fallidos" valor={stats.err} color="#dc2626" />
        <Ind label="Monto cobrado" valor={mmFmtMon(stats.monto)} color="#1a3a6b" />
      </div>

      <div className="form-card" style={{ padding: "12px 16px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="Buscar empresa, correo, folio, site o guía..." value={busqueda}
            onChange={e => setBusqueda(e.target.value)} style={{ flex: "1 1 260px", maxWidth: 380 }} />
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ width: 160 }}>
            <option value="todos">Todos los estados</option>
            <option value="enviado">Solo enviados</option>
            <option value="fallido">Solo fallidos</option>
          </select>
          <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={{ width: 150 }}>
            <option value="todos">Todos los períodos</option>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={limite} onChange={e => setLimite(Number(e.target.value))} style={{ width: 140 }}>
            <option value={100}>Últimos 100</option>
            <option value={200}>Últimos 200</option>
            <option value={1000}>Últimos 1000</option>
          </select>
          <button onClick={cargar} style={btnGhost}>🔄 Refrescar</button>
          <button onClick={descargar} style={btnGhost}>⬇ Excel</button>
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        {cargando ? (
          <div className="loading">Cargando historial...</div>
        ) : filtrados.length === 0 ? (
          <div className="empty">Sin envíos registrados.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                  <th style={th()}>Fecha</th>
                  <th style={th()}>Estado</th>
                  <th style={th()}>Transportista</th>
                  <th style={th()}>Sites</th>
                  <th style={th("right")}>Cobros</th>
                  <th style={th("right")}>Monto</th>
                  <th style={th()}>Destinatarios</th>
                  <th style={th()}>Período / Folio</th>
                  <th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(l => (
                  <Fragment key={l.id}>
                    <tr style={{ borderBottom: "1px solid #f1f5f9", background: l.estado === "fallido" ? "#fef2f2" : "transparent" }}>
                      <td style={td()}><span style={{ fontSize: 11 }}>{new Date(l.fecha_envio).toLocaleString("es-MX")}</span></td>
                      <td style={td()}>
                        <span style={{
                          background: l.estado === "enviado" ? "#dcfce7" : "#fee2e2",
                          color: l.estado === "enviado" ? "#166534" : "#991b1b",
                          padding: "3px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
                        }}>{l.estado === "enviado" ? "✓ ENVIADO" : "✗ FALLIDO"}</span>
                        {l.match_tipo && l.match_tipo !== "exacto" && (
                          <div style={{ fontSize: 9, color: "#9a3412", marginTop: 2 }}>cruce {l.match_tipo}</div>
                        )}
                      </td>
                      <td style={td()}>
                        <div style={{ fontWeight: 600, maxWidth: 220 }}>{l.transportista}</div>
                        <div style={{ fontSize: 9.5, color: "#94a3b8" }}>{l.rfc || "sin RFC"}</div>
                      </td>
                      <td style={td()}><span style={{ fontSize: 10.5, color: "#475569" }}>{l.sites || "—"}</span></td>
                      <td style={td("right")}>{l.n_cobros}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: "#1a3a6b" }}>{mmFmtMon(l.monto_total)}</td>
                      <td style={td()}>
                        <div style={{ fontSize: 10.5, wordBreak: "break-all", maxWidth: 210 }}>{l.correo_to}</div>
                        {l.correo_cc && <div style={{ fontSize: 9, color: "#94a3b8", wordBreak: "break-all", maxWidth: 210 }}>cc: {l.correo_cc}</div>}
                      </td>
                      <td style={td()}>
                        <div style={{ fontSize: 10.5 }}>{l.periodo_cobro || "—"}</div>
                        <div style={{ fontSize: 9, color: "#94a3b8" }}>{l.folio || "—"}</div>
                      </td>
                      <td style={td()}>
                        <button onClick={() => setDetalle(detalle === l.id ? null : l.id)} style={btnMini("#64748b")}>
                          {detalle === l.id ? "Ocultar" : "Ver más"}
                        </button>
                      </td>
                    </tr>
                    {detalle === l.id && (
                      <tr>
                        <td colSpan={9} style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #e4e7ec", fontSize: 11.5 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
                            <div>
                              <b>Asunto:</b> {l.asunto || "—"}<br />
                              <b>PDF:</b> {l.nombre_pdf || "—"}<br />
                              <b>BCC:</b> {l.correo_bcc || "—"}
                            </div>
                            <div>
                              <b>Usuario:</b> {l.usuario || "—"}<br />
                              <b>Archivo origen:</b> {l.archivo_origen || "—"}<br />
                              <b>Message ID:</b> <span style={{ fontFamily: "monospace", fontSize: 10 }}>{l.message_id || "—"}</span>
                            </div>
                            {l.estado === "fallido" && (
                              <div style={{ color: "#991b1b" }}>
                                <b>Motivo del fallo:</b><br />{l.motivo || "—"}
                              </div>
                            )}
                          </div>
                          {l.guias && (
                            <div style={{ marginTop: 10 }}>
                              <b>Guías incluidas ({String(l.guias).split(",").filter(Boolean).length}):</b>
                              <div style={{ fontFamily: "monospace", fontSize: 10, color: "#475569", marginTop: 4, wordBreak: "break-all", maxHeight: 90, overflowY: "auto" }}>
                                {String(l.guias).split(",").join(" · ")}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
