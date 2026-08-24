import { useState, useEffect, useRef } from "react";
import { sb, BIGGY_IMG } from "./shared";

// Todas las fechas del módulo se muestran en HORA DE MÉXICO, sin importar desde
// dónde se abra el Brain. Sin timeZone, el navegador usa su zona local y el
// mismo registro se vería con dos horas de diferencia entre Chile y México.
const TZ_MX = "America/Mexico_City";
const fMX = (v, opts) => v ? new Date(v).toLocaleString("es-MX", { timeZone: TZ_MX, ...(opts || {}) }) : "";

const COLUMNAS = [
  { id: "recepcion",           label: "Etapa 1: Recepción Documental",  color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "llamada_supervisor",  label: "Etapa 2: Llamada de Supervisor", color: "#0e7490", bg: "#e8f6f9", border: "#c9e8f0" },
  { id: "stand_by",            label: "Stand By",                       color: "#b45309", bg: "#fff8ef", border: "#fcd9b6" },
  { id: "prevalidacion_biggy", label: "Etapa 3: Pre Validación Biggy",  color: "#F47B20", bg: "#fff4ec", border: "#fbd9c0" },
  { id: "validacion_meli",     label: "Etapa 4: Validación MELI",       color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "validacion_nubarium", label: "Etapa 5: Nubarium / REPUVE",       color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "entrevista_operaciones", label: "Etapa 6: Entrevista con Operaciones", color: "#0e7490", bg: "#e8f6f9", border: "#c9e8f0" },
  { id: "solicitud_alta",      label: "Etapa 7: Solicitud de Alta",     color: "#0f766e", bg: "#e7f5f2", border: "#c4e6df" },
  { id: "firma_contrato",      label: "Etapa 8: Firma de Contrato",     color: "#7c3aed", bg: "#f5f0fe", border: "#ddd0f7" },
  { id: "revision_interna",    label: "Revisión Interna",               color: "#b45309", bg: "#fff4e5", border: "#fcd9b6" },
  { id: "aceptado",            label: "Aceptado",                       color: "#166534", bg: "#e8f5ec", border: "#b7e0c2" },
  { id: "rechazado",           label: "Rechazado",                      color: "#c0392b", bg: "#fbeaea", border: "#f0c4c4" },
];

// Flujo B (Vehículos y Personas · App/Portal): la empresa YA existe, por lo que
// no aplican Llamada de Supervisor (E2), Entrevista (E6), Solicitud de Alta (E7)
// ni Firma de Contrato (E8). Tras Nubarium/REPUVE la tarjeta pasa a Aceptado/Rechazado.
const ETAPAS_SOLO_INGRESOS = ["llamada_supervisor", "entrevista_operaciones", "solicitud_alta", "firma_contrato"];
const COLUMNAS_B = COLUMNAS.filter(c => !ETAPAS_SOLO_INGRESOS.includes(c.id));

// Etiquetas cortas para los KPIs del header (coinciden con las columnas)
const ETAPA_CORTA = {

  stand_by: "Stand By",
  recepcion: "Etapa 1 · Recepción", llamada_supervisor: "Etapa 2 · Llamada Sup.", prevalidacion_biggy: "Etapa 3 · Biggy", validacion_meli: "Etapa 4 · MELI",
  validacion_nubarium: "Etapa 5 · Nubarium/REPUVE", entrevista_operaciones: "Etapa 6 · Entrevista", solicitud_alta: "Etapa 7 · Sol. de Alta", firma_contrato: "Etapa 8 · Firma", revision_interna: "Revisión Interna", aceptado: "Aceptado", rechazado: "Rechazado",
};

// ─── VISOR DOCUMENTO ────────────────────────────────────────────────
function VisorDoc({ url, label }) {
  const [ampliado, setAmpliado] = useState(false);
  const esPDF = url && url.toLowerCase().includes(".pdf");
  if (!url) return (
    <div style={{ background: "#f8f9fa", borderRadius: 8, padding: "20px", textAlign: "center", border: "1px dashed #d0d5dd" }}>
      <div style={{ fontSize: 24 }}>📎</div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>Sin documento</div>
    </div>
  );
  const pdfViewerUrl = esPDF ? `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true` : null;
  return (
    <>
      {ampliado && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 500, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setAmpliado(false)}>
          <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", maxWidth: 800, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: "#1a3a6b", padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{label}</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <a href={url} target="_blank" rel="noreferrer" style={{ color: "#aac3e8", fontSize: 11, textDecoration: "none" }}>Abrir ↗</a>
                <button onClick={() => setAmpliado(false)} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            </div>
            {esPDF ? (
              <iframe src={pdfViewerUrl} style={{ width: "100%", height: "75vh", border: "none" }} title={label} />
            ) : (
              <img src={url} alt={label} style={{ width: "100%", maxHeight: "75vh", objectFit: "contain", background: "#111" }} />
            )}
          </div>
        </div>
      )}
      <div onClick={() => setAmpliado(true)} style={{ cursor: "pointer" }}>
        {esPDF ? (
          <div style={{ background: "#f0f9ff", borderRadius: 8, height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "1px solid #bae6fd" }}>
            <div style={{ fontSize: 28 }}>📄</div>
            <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 600, marginTop: 4 }}>PDF</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>Click para ver</div>
          </div>
        ) : (
          <img src={url} alt={label} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #e4e7ec" }} />
        )}
        <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginTop: 4, fontWeight: 500 }}>{label} 🔍</div>
      </div>
    </>
  );
}

// ─── GESTIÓN DE DOCUMENTOS (Ver / Reemplazar / Eliminar / Cargar) ───
const _btnDoc = { background: "#fff", border: "1px solid #d0d5dd", borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "#344054", fontFamily: "'Geist',sans-serif" };
const _btnDocRojo = { background: "#fff", border: "1px solid #f0c4c4", borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", color: "#c0392b", fontFamily: "'Geist',sans-serif" };

// Fuente A · columnas url_* de certificaciones_mx, bucket público documentos-terceros.
// El analista puede reemplazar, eliminar o cargar lo mismo que el prospecto ve en su portal.
const DOCS_PROSPECTO = [
  ["url_curp", "CURP"], ["url_ine", "INE (delantera)"], ["url_ine_2", "INE (trasera)"],
  ["url_licencia", "Licencia"], ["url_rfc", "RFC"],
];
function GestorDocsProspecto({ candidato, onActualizar }) {
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);
  const ctxRef = useRef(null);

  const elegir = (col) => { ctxRef.current = col; if (fileRef.current) fileRef.current.click(); };

  const subir = async (col, file) => {
    setBusy(col);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const campo = col.replace("url_", "");
      const path = `prospeccion/${candidato.id}/${campo}_${Date.now()}.${ext}`;
      const { error: eUp } = await sb.storage.from("documentos-terceros").upload(path, file, { upsert: true });
      if (eUp) throw new Error(eUp.message);
      const { data: pu } = sb.storage.from("documentos-terceros").getPublicUrl(path);
      const url = pu?.publicUrl || "";
      if (!url) throw new Error("No se obtuvo la URL pública del documento");
      const { error: eUpd } = await sb.from("certificaciones_mx").update({ [col]: url }).eq("id", candidato.id);
      if (eUpd) throw new Error("El archivo subió pero no se registró: " + eUpd.message);
      onActualizar({ ...candidato, [col]: url });
    } catch (e) { alert("No se pudo cargar: " + e.message); }
    finally { setBusy(null); }
  };

  const eliminar = async (col, label) => {
    if (!confirm(`¿Eliminar ${label}? El prospecto podrá volver a cargarlo desde el portal.`)) return;
    setBusy(col);
    try {
      const url = candidato[col] || "";
      const resto = url.split("/documentos-terceros/")[1];
      if (resto) {
        try { await sb.storage.from("documentos-terceros").remove([decodeURIComponent(resto.split("?")[0])]); }
        catch (e) { /* el objeto puede no existir en Storage — se limpia igual la columna */ }
      }
      const { error: eUpd } = await sb.from("certificaciones_mx").update({ [col]: null }).eq("id", candidato.id);
      if (eUpd) throw new Error(eUpd.message);
      onActualizar({ ...candidato, [col]: null });
    } catch (e) { alert("No se pudo eliminar: " + e.message); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
        {DOCS_PROSPECTO.map(([col, label]) => (
          <div key={col}>
            <VisorDoc url={candidato[col]} label={label} />
            <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 6, flexWrap: "wrap" }}>
              <button disabled={busy === col} onClick={() => elegir(col)} style={_btnDoc}>
                {busy === col ? "…" : (candidato[col] ? "Reemplazar" : "📎 Cargar")}
              </button>
              {candidato[col] && (
                <button disabled={busy === col} onClick={() => eliminar(col, label)} style={_btnDocRojo}>Eliminar</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; const col = ctxRef.current; ctxRef.current = null; if (f && col) subir(col, f); }} />
    </>
  );
}

// Fuente B · filas de certificacion_documentos, bucket privado proceso_certificacion_bt.
// Diseño de "slots" como en Fuente A: los documentos esperados según el tipo de
// certificación aparecen SIEMPRE (con botón Cargar si están vacíos); lo demás
// queda en "Otros documentos" con la opción "Usar como…" para recategorizar lo
// que el tercero subió (p. ej. un "Otro" que en realidad es la INE corregida).
const SLOTS_CERT_PERSONA  = ["ine", "ine_reverso", "curp", "rfc", "licencia"];
const SLOTS_CERT_VEHICULO = ["foto_frente", "foto_trasera", "foto_lado_izq", "foto_lado_der", "tarjeta_circulacion"];

function GestorDocsCert({ cert, docs, onRecargar, cambios, resaltar, avisoSinIndexar }) {
  const [busy, setBusy] = useState(null);
  const [nuevoTipo, setNuevoTipo] = useState("otro");
  const fileReemRef = useRef(null);
  const fileNuevoRef = useRef(null);
  const ctxRef = useRef(null);

  const esVeh = cert.tipo === "vehiculo";
  const slots = esVeh ? SLOTS_CERT_VEHICULO : SLOTS_CERT_PERSONA;

  // El documento MÁS RECIENTE de cada tipo ocupa el slot (docs viene en orden asc);
  // versiones anteriores y tipos fuera de los slots van a "Otros documentos".
  const docDeSlot = {};
  (docs || []).forEach((d) => { docDeSlot[docTipoLimpioCert(d.tipo_documento)] = d; });
  const idsEnSlots = new Set(slots.map((s) => docDeSlot[s]?.id).filter(Boolean));
  const extras = (docs || []).filter((d) => !idsEnSlots.has(d.id));

  // Mientras la tarjeta tenga "cambios pendientes", se resalta el documento que
  // la empresa cargó/reemplazó: match duro por doc_id (logs nuevos) o, para logs
  // viejos sin doc_id, por tipo + cercanía de hora (±10 min) con la carga.
  const marcaDe = (d) => {
    if (!resaltar) return null;
    const tDoc = new Date(d.updated_at || d.created_at).getTime();
    for (const c of (cambios || [])) {
      if (c.tipo !== "documento" || c.accion === "eliminado") continue;
      const porId = c.doc_id && c.doc_id === d.id;
      const porTiempo = !c.doc_id && c.campo
        && docTipoLimpioCert(c.campo) === docTipoLimpioCert(d.tipo_documento)
        && Math.abs(new Date(c.at).getTime() - tDoc) < 10 * 60 * 1000;
      if (porId || porTiempo) return c.accion === "reemplazado" ? "♻ Actualizado" : "🆕 Nuevo";
    }
    return null;
  };

  const basePath = () => `${cert.tercero_id || "brain"}/${cert.id}`;

  const reemplazar = async (d, file) => {
    setBusy(d.id);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const tipo = docTipoLimpioCert(d.tipo_documento) || "otro";
      const path = `${basePath()}/${tipo}_${Date.now()}.${ext}`;
      const { error: eUp } = await sb.storage.from("proceso_certificacion_bt").upload(path, file, { upsert: true });
      if (eUp) throw new Error(eUp.message);
      if (d._virtual) {
        // El doc vivía solo en Storage: se registra el nuevo y se retira el archivo viejo
        const { error: eIns } = await insDocCert({ certificacion_id: cert.id, tipo_documento: tipo, storage_path: path, subido_por: "analista_brain" });
        if (eIns) throw new Error("El archivo subió pero no se registró: " + eIns.message);
        try { await quitarDeStorageCert(d.storage_path); } catch (e) { console.warn("Versión anterior no retirada:", e.message); }
      } else {
        const { error: eUpd } = await updDocCert(d.id,
          { storage_path: path, updated_at: new Date().toISOString(), subido_por: "analista_brain" },
          { storage_path: path });
        if (eUpd) throw new Error("El archivo subió pero no se registró: " + eUpd.message);
      }
      await onRecargar();
    } catch (e) { alert("No se pudo reemplazar: " + e.message); }
    finally { setBusy(null); }
  };

  const eliminar = async (d) => {
    if (!confirm(`¿Eliminar ${docEtiquetaCert(d.tipo_documento)}? Esta acción no se puede deshacer.`)) return;
    setBusy(d.id);
    try {
      // Primero el archivo (con fallback a papelera/ si protect_delete bloquea el DELETE);
      // si no se logra retirar del bucket, se aborta — o el merge desde Storage lo reviviría.
      await quitarDeStorageCert(d.storage_path);
      if (!d._virtual) {
        const { error: eDel } = await sb.from("certificacion_documentos").delete().eq("id", d.id);
        if (eDel) throw new Error(eDel.message);
      }
      await onRecargar();
    } catch (e) { alert("No se pudo eliminar: " + e.message); }
    finally { setBusy(null); }
  };

  const cargarConTipo = async (tipo, file) => {
    setBusy(`carga-${tipo}`);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${basePath()}/${tipo}_${Date.now()}.${ext}`;
      const { error: eUp } = await sb.storage.from("proceso_certificacion_bt").upload(path, file, { upsert: true });
      if (eUp) throw new Error(eUp.message);
      const { error: eIns } = await insDocCert({ certificacion_id: cert.id, tipo_documento: tipo, storage_path: path, subido_por: "analista_brain" });
      if (eIns) console.warn("Documento en Storage sin fila en tabla:", eIns.message); // el listado igual lo mostrará
      await onRecargar();
    } catch (e) { alert("No se pudo cargar: " + e.message); }
    finally { setBusy(null); }
  };

  // Recategoriza un documento (p. ej. "Otro" del portal → "INE (frente)").
  // Al cambiar el tipo, pasa a ocupar el slot oficial y Biggy lo toma en el próximo análisis.
  const usarComo = async (d, tipo) => {
    if (!tipo) return;
    setBusy(d.id);
    try {
      if (d._virtual) {
        const { error } = await insDocCert({ certificacion_id: cert.id, tipo_documento: tipo, storage_path: d.storage_path, subido_por: "analista_brain" });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await updDocCert(d.id,
          { tipo_documento: tipo, updated_at: new Date().toISOString(), subido_por: "analista_brain" },
          { tipo_documento: tipo });
        if (error) throw new Error(error.message);
      }
      await onRecargar();
    } catch (e) { alert("No se pudo recategorizar: " + e.message); }
    finally { setBusy(null); }
  };

  const pedirReemplazo = (d) => { ctxRef.current = { d }; if (fileReemRef.current) fileReemRef.current.click(); };
  const pedirCarga = (tipo) => { ctxRef.current = { tipo }; if (fileNuevoRef.current) fileNuevoRef.current.click(); };

  const fichaDoc = (d, esExtra) => {
    const marca = marcaDe(d);
    return (
      <div key={d.id} style={marca ? { border: "2px solid #F47B20", borderRadius: 12, padding: 6, background: "#fff8f2" } : undefined}>
        {marca && (
          <div style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: "#F47B20", borderRadius: 6, padding: "2px 8px", textAlign: "center", marginBottom: 5 }}>
            {marca} — revisar
          </div>
        )}
        <VisorDoc url={d.url} label={docEtiquetaCert(d.tipo_documento)} />
        <div style={{ fontSize: 10, color: "#98a2b3", textAlign: "center", marginTop: 3, lineHeight: 1.5 }}>
          Cargado {fmtFH(d.created_at)}{d.updated_at ? ` · reempl. ${fmtFH(d.updated_at)}` : ""}{d.subido_por ? ` · ${d.subido_por}` : ""}
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 5, flexWrap: "wrap" }}>
          <button disabled={busy === d.id} style={_btnDoc} onClick={() => pedirReemplazo(d)}>
            {busy === d.id ? "…" : "Reemplazar"}
          </button>
          <button disabled={busy === d.id} onClick={() => eliminar(d)} style={_btnDocRojo}>Eliminar</button>
        </div>
        {esExtra && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 5 }}>
            <select value="" disabled={busy === d.id} onChange={(e) => usarComo(d, e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid #d6def0", fontSize: 11, color: "#1a3a6b", fontWeight: 700, fontFamily: "'Geist',sans-serif", background: "#eef2f7" }}>
              <option value="">Usar como…</option>
              {TIPOS_DOC_CERT.filter((t) => t !== "otro").map((t) => <option key={t} value={t}>{DOC_LABEL[t] || t}</option>)}
            </select>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="form-card">
      <div className="form-title">Documentos</div>
      {avisoSinIndexar > 0 && (
        <div style={{ background: "#fff4e5", border: "1px solid #f5d9b8", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, color: "#8a4a0f", marginBottom: 10 }}>
          ⚠ {avisoSinIndexar} documento(s) se muestran directo desde Storage porque no se pudieron registrar en <b>certificacion_documentos</b> — corre <b>docs_certificacion_v2.sql</b> y revisa las policies de la tabla (detalle en la consola del navegador). Mientras tanto todo funciona igual.
        </div>
      )}
      {docs === null ? (
        <div style={{ fontSize: 12, color: "#888" }}>Cargando documentos…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
            {slots.map((s) => {
              const d = docDeSlot[s];
              if (d) return fichaDoc(d, false);
              return (
                <div key={s}>
                  <VisorDoc url={null} label={DOC_LABEL[s] || s} />
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
                    <button disabled={busy === `carga-${s}`} style={_btnDoc} onClick={() => pedirCarga(s)}>
                      {busy === `carga-${s}` ? "Subiendo…" : "📎 Cargar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {extras.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#667085", textTransform: "uppercase", margin: "16px 0 8px" }}>
                Otros documentos cargados (del portal o versiones anteriores)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
                {extras.map((d) => fichaDoc(d, true))}
              </div>
            </>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap", borderTop: "1px solid #f0f2f5", paddingTop: 12 }}>
        <select value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e4e7ec", fontSize: 12, fontFamily: "'Geist',sans-serif" }}>
          {TIPOS_DOC_CERT.map((t) => <option key={t} value={t}>{DOC_LABEL[t] || t}</option>)}
        </select>
        <button className="btn-orange" disabled={busy === `carga-${nuevoTipo}`} style={{ fontSize: 12, padding: "8px 14px" }}
          onClick={() => pedirCarga(nuevoTipo)}>
          {busy === `carga-${nuevoTipo}` ? "Subiendo…" : "📎 Cargar documento nuevo"}
        </button>
      </div>
      <input ref={fileReemRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; const ctx = ctxRef.current; ctxRef.current = null; if (f && ctx && ctx.d) reemplazar(ctx.d, f); }} />
      <input ref={fileNuevoRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; const ctx = ctxRef.current; ctxRef.current = null; if (f && ctx && ctx.tipo) cargarConTipo(ctx.tipo, f); }} />
    </div>
  );
}

// ─── CHAT CON LA EMPRESA (mensajes_terceros → pestaña Consultas del portal) ───
// Mismo canal que el módulo Mensajes del Brain, embebido en la tarjeta de
// certificación Fuente B. Lo que se escribe aquí aparece en el hilo de
// Consultas del Portal de Terceros, y viceversa.
function ChatEmpresaCert({ terceroId, empresa, titulo }) {
  const [abierto, setAbierto] = useState(false);
  const [msgs, setMsgs] = useState(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [noLeidos, setNoLeidos] = useState(0);
  const finRef = useRef(null);

  const cargar = async () => {
    const { data } = await sb.from("mensajes_terceros")
      .select("*").eq("tercero_id", terceroId).order("created_at", { ascending: true });
    setMsgs(data || []);
    setNoLeidos((data || []).filter(m => m.autor === "tercero" && !m.leido).length);
  };
  useEffect(() => { setMsgs(null); setAbierto(false); setTexto(""); cargar(); }, [terceroId]);
  useEffect(() => { if (abierto && finRef.current) finRef.current.scrollIntoView({ block: "nearest" }); }, [abierto, msgs]);

  const alternar = async () => {
    const nx = !abierto;
    setAbierto(nx);
    if (nx) {
      if (!texto && titulo) setTexto(`Sobre la certificación de ${titulo}: `);
      if (noLeidos > 0) {
        await sb.from("mensajes_terceros").update({ leido: true })
          .eq("tercero_id", terceroId).eq("autor", "tercero").eq("leido", false);
        setNoLeidos(0);
      }
    }
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    const { data, error } = await sb.from("mensajes_terceros")
      .insert({ tercero_id: terceroId, autor: "bigticket", mensaje: t }).select("*").single();
    if (error) { alert("No se pudo enviar: " + error.message); }
    else { setMsgs(prev => [...(prev || []), data]); setTexto(""); }
    setEnviando(false);
  };

  return (
    <div className="form-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }} onClick={alternar}>
        <div className="form-title" style={{ margin: 0, flex: 1 }}>💬 Mensajes con {empresa || "la empresa"}</div>
        {noLeidos > 0 && (
          <span style={{ background: "#F47B20", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 10, padding: "2px 8px" }}>{noLeidos} sin leer</span>
        )}
        <span style={{ fontSize: 13, color: "#888" }}>{abierto ? "▴" : "▾"}</span>
      </div>
      <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 4 }}>
        Este hilo llega a la pestaña <b>Consultas</b> del Portal de Terceros — es la misma conversación del módulo Mensajes del Brain.
      </div>
      {abierto && (
        <div style={{ marginTop: 12, borderTop: "1px solid #f0f2f5", paddingTop: 10 }}>
          <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
            {msgs === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div>
            : msgs.length === 0 ? <div style={{ fontSize: 12, color: "#888" }}>Sin mensajes con esta empresa. Escribe el primero abajo.</div>
            : msgs.map(m => (
              <div key={m.id} style={{ display: "flex", justifyContent: m.autor === "bigticket" ? "flex-end" : "flex-start", marginBottom: 8 }}>
                <div style={{ maxWidth: "78%", padding: "8px 12px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.5,
                  background: m.autor === "bigticket" ? "#1a3a6b" : "#f4f5f7",
                  color: m.autor === "bigticket" ? "#fff" : "#222",
                  borderBottomRightRadius: m.autor === "bigticket" ? 4 : 12,
                  borderBottomLeftRadius: m.autor === "bigticket" ? 12 : 4 }}>
                  {m.mensaje}
                  <div style={{ fontSize: 9, opacity: 0.6, marginTop: 4, textAlign: "right" }}>{fmtFH(m.created_at)}</div>
                </div>
              </div>
            ))}
            <div ref={finRef} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              placeholder={`Escribe a ${empresa || "la empresa"}…`}
              style={{ flex: 1, border: "1px solid #e4e7ec", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontFamily: "'Geist',sans-serif", resize: "vertical" }} />
            <button className="btn-orange" onClick={enviar} disabled={enviando || !texto.trim()} style={{ fontSize: 12, padding: "8px 16px", alignSelf: "flex-end" }}>
              {enviando ? "…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BIGGY MESSENGER ────────────────────────────────────────────────
function BiggyChatBubble({ analizando, analisis, score, recomendacion, alertas, onReanalizar }) {
  const colorRec = { APROBAR: { bg: "#dcfce7", color: "#166534", border: "#86efac" }, REVISAR: { bg: "#fef3c7", color: "#92400e", border: "#fde68a" }, RECHAZAR: { bg: "#fee2e2", color: "#c0392b", border: "#fca5a5" } };
  const nivelColor = { ALTA: "#c0392b", MEDIA: "#92400e", BAJA: "#1e40af" };
  const nivelBg   = { ALTA: "#fee2e2", MEDIA: "#fef3c7", BAJA: "#dbeafe" };
  const recStyle = recomendacion ? colorRec[recomendacion] || colorRec.REVISAR : null;

  return (
    <div className="form-card" style={{ border: "1.5px solid #F47B20", background: "#fffaf5" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <img src={BIGGY_IMG} alt="Biggy" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: "2px solid #F47B20" }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>Biggy</div>
          <div style={{ fontSize: 11, color: "#F47B20", fontWeight: 600 }}>Asistente IA · BigTicket</div>
        </div>
        {score && (
          <div style={{ marginLeft: "auto", textAlign: "center", background: score >= 7 ? "#dcfce7" : score >= 4 ? "#fef3c7" : "#fee2e2", borderRadius: 12, padding: "6px 14px", border: `1px solid ${score >= 7 ? "#86efac" : score >= 4 ? "#fde68a" : "#fca5a5"}` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: score >= 7 ? "#166534" : score >= 4 ? "#92400e" : "#c0392b" }}>{score}</div>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 600 }}>/ 10</div>
          </div>
        )}
      </div>

      {analizando ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#fff", borderRadius: 12, border: "1px solid #fde68a" }}>
          <div className="biggy-typing"><span/><span/><span/></div>
          <span style={{ fontSize: 13, color: "#92400e" }}>Biggy está revisando los documentos...</span>
        </div>
      ) : !analisis ? (
        <div style={{ fontSize: 13, color: "#888", fontStyle: "italic" }}>Biggy revisará los documentos automáticamente al cargar el candidato.</div>
      ) : analisis._error ? (
        <div style={{ background: "#fee2e2", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#c0392b" }}>
          ⚠️ {analisis.resumen}
          <button onClick={onReanalizar} style={{ marginLeft: 12, background: "#c0392b", color: "#fff", border: "none", borderRadius: 8, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>Reintentar</button>
        </div>
      ) : (
        <div className="biggy-bubble">
          {recomendacion && recStyle && (
            <div style={{ background: recStyle.bg, border: `1px solid ${recStyle.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{recomendacion === "APROBAR" ? "✅" : recomendacion === "RECHAZAR" ? "❌" : "⚠️"}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: recStyle.color }}>Recomendación: {recomendacion}</div>
                {analisis?.resumen && <div style={{ fontSize: 12, color: recStyle.color, marginTop: 2, opacity: 0.85 }}>{analisis.resumen}</div>}
              </div>
            </div>
          )}

          {alertas && alertas.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>🚨 Alertas detectadas</div>
              {alertas.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", background: nivelBg[a.nivel] || "#f8f9fa", borderRadius: 8, marginBottom: 6, border: `1px solid ${nivelColor[a.nivel] || "#e4e7ec"}22` }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: nivelColor[a.nivel] || "#888", color: "#fff", whiteSpace: "nowrap", marginTop: 1 }}>{a.nivel}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{a.campo}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                      Declarado: <strong>{a.declarado || "—"}</strong> · Encontrado: <strong>{a.encontrado || "—"}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {analisis?.documentos && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>📋 Análisis por documento</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 8 }}>
                {Object.entries(analisis.documentos).map(([doc, d]) => {
                  if (!d || d.score === undefined) return null;
                  const sc = d.score;
                  const docBg = sc >= 7 ? "#dcfce7" : sc >= 4 ? "#fef3c7" : "#fee2e2";
                  const docCol = sc >= 7 ? "#166534" : sc >= 4 ? "#92400e" : "#c0392b";
                  return (
                    <div key={doc} style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", border: "1px solid #e4e7ec" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#1a3a6b" }}>{doc}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, background: docBg, color: docCol, borderRadius: 8, padding: "2px 8px" }}>{sc}/10</span>
                      </div>
                      {d.observaciones && <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>{d.observaciones}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── COMPARATIVA DATOS ───────────────────────────────────────────────
function ComparativaDatos({ candidato, analisis }) {
  if (!analisis?.documentos) return null;
  const docs = analisis.documentos;

  const filas = [
    { label: "Nombre", declarado: candidato.nombre, encontrado: docs.ine?.nombre_extraido || docs.curp?.nombre_extraido || "" },
    { label: "CURP",   declarado: candidato.curp,   encontrado: docs.curp?.curp_extraido || "" },
    { label: "RFC",    declarado: candidato.rfc,    encontrado: docs.rfc?.rfc_extraido || "" },
    { label: "INE",    declarado: candidato.ine,    encontrado: docs.ine?.numero_extraido || "" },
    { label: "Licencia", declarado: candidato.licencia, encontrado: docs.licencia?.numero_extraido || "" },
  ].filter(f => f.encontrado);

  if (filas.length === 0) return null;

  return (
    <div className="form-card" style={{ border: "1px solid #e9d5ff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <img src={BIGGY_IMG} alt="Biggy" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
        <div className="form-title" style={{ margin: 0 }}>Comparativa de datos</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 32px", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase" }}>Campo</div>
        <div style={{ fontSize: 10, color: "#1a3a6b", fontWeight: 700, textTransform: "uppercase" }}>Declarado</div>
        <div style={{ fontSize: 10, color: "#F47B20", fontWeight: 700, textTransform: "uppercase" }}>Biggy extrajo</div>
        <div style={{ fontSize: 10, color: "#888", fontWeight: 700 }}>OK</div>
      </div>
      {filas.map(({ label, declarado, encontrado }) => {
        const coincide = declarado?.toLowerCase().trim() === encontrado?.toLowerCase().trim();
        return (
          <div key={label} style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr 32px", gap: 8, padding: "8px 0", borderBottom: "1px solid #f4f5f7", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontSize: 12, color: "#1a1a1a", fontWeight: 500, wordBreak: "break-all" }}>{declarado || "—"}</div>
            <div style={{ fontSize: 12, color: coincide ? "#166534" : "#c0392b", fontWeight: 600, wordBreak: "break-all" }}>{encontrado || "—"}</div>
            <div style={{ fontSize: 16, textAlign: "center" }}>{coincide ? "✅" : "❌"}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── VALIDACIÓN NUBARIUM (Etapa 4) — informe crudo; el analista decide ───
const SEM = {
  ok:   { dot: "#16a34a", bg: "#dcfce7", border: "#86efac", label: "OK" },
  warn: { dot: "#d97706", bg: "#fef3c7", border: "#fde68a", label: "Revisar" },
  bad:  { dot: "#dc2626", bg: "#fee2e2", border: "#fca5a5", label: "Alerta" },
  none: { dot: "#9ca3af", bg: "#f3f4f6", border: "#e5e7eb", label: "—" },
};
const normNub = (s) => (s || "").toString().toUpperCase().replace(/\s+/g, " ").trim();

function SeccionNubarium({ titulo, sem, children }) {
  const c = SEM[sem] || SEM.none;
  return (
    <div style={{ border: `1px solid ${c.border}`, background: c.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{titulo}</span>
        <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: c.dot, textTransform: "uppercase" }}>{c.label}</span>
      </div>
      <div style={{ fontSize: 12, color: "#333", lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}
function CampoN({ l, v }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: "#888", minWidth: 120, flexShrink: 0 }}>{l}</span>
      <span style={{ fontWeight: 600, wordBreak: "break-word" }}>{v || "—"}</span>
    </div>
  );
}

function ValidacionNubarium({ candidato, onActualizar }) {
  const [corriendo, setCorriendo] = useState(false);
  const [reporte, setReporte] = useState(candidato.nubarium_reporte || null);
  const [err, setErr] = useState(null);

  const urlAB64 = async (url) => {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const rd = new FileReader();
      rd.onloadend = () => res(String(rd.result).split(",")[1] || "");
      rd.onerror = rej;
      rd.readAsDataURL(blob);
    });
  };

  const correr = async () => {
    if (!candidato.curp && !candidato.rfc) { setErr("Faltan CURP y RFC declarados."); return; }
    setCorriendo(true); setErr(null);
    try {
      let ine_b64 = "", ine_reverso_b64 = "";
      if (candidato.url_ine)   { try { ine_b64         = await urlAB64(candidato.url_ine);   } catch (e) { /* sigue sin INE */ } }
      if (candidato.url_ine_2) { try { ine_reverso_b64 = await urlAB64(candidato.url_ine_2); } catch (e) { /* sigue sin reverso */ } }
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/nubarium-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: candidato.id, curp: candidato.curp, rfc: candidato.rfc, ine_b64, ine_reverso_b64 }),
      });
      const txt = await resp.text();
      if (!txt || !txt.trim()) throw new Error("Nubarium devolvió respuesta vacía.");
      const rep = JSON.parse(txt);
      setReporte(rep);
      onActualizar({ ...candidato, nubarium_reporte: rep });
    } catch (e) {
      setErr("No se pudo correr Nubarium: " + e.message);
    } finally {
      setCorriendo(false);
    }
  };

  const r = reporte || {};
  const c = r.curp || {}, f = r.rfc || {}, b = r.antecedentes_69b || {}, i = r.ine || {}, ln = r.ine_lista_nominal || {};
  const semCurp = c._error ? "warn" : (c.estatus === "OK" && c.estatusCurp === "RCN") ? "ok" : c.estatus === "ERROR" ? "bad" : c.estatus ? "warn" : "none";
  const semRfc  = f._error ? "warn" : f.estatus === "OK" ? "ok" : f.estatus === "ERROR" ? "bad" : f.estatus ? "warn" : "none";
  const situ    = normNub(b.situacion);
  const sem69   = b._error ? "warn" : (situ === "DEFINITIVO" || situ === "PRESUNTO") ? "bad" : b.estatus === "OK" ? "ok" : b.estatus ? "warn" : "none";
  const curpOcrMatch = i.curp && candidato.curp && normNub(i.curp) === normNub(candidato.curp);
  const semIne  = i._error ? "warn" : (i.nombres || i.curp) ? ((curpOcrMatch || !candidato.curp) ? "ok" : "warn") : "none";
  const msgLN = normNub(ln.mensaje);
  let semLN = "none";
  if (ln._error) semLN = "warn";
  else if (ln.estatus === "ERROR") semLN = "bad";
  else if (ln.estatus === "OK") {
    if (msgLN.includes("NO VIGENTE") || msgLN.includes("BAJA") || msgLN.includes("EXPIR") || msgLN.includes("NO EXIST")) semLN = "bad";
    else if (msgLN.includes("ROBO") || msgLN.includes("EXTRAV") || msgLN.includes("SUSPEN")) semLN = "warn";
    else if (msgLN.includes("VIGENTE")) semLN = "ok";
    else semLN = "warn";
  } else if (ln.estatus) semLN = "warn";

  return (
    <div className="form-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="form-title" style={{ margin: 0 }}>🔎 Validación Nubarium <span style={{ fontSize: 11, fontWeight: 500, color: "#888" }}>· RENAPO · SAT · INE (OCR + Lista Nominal) · 69-B</span></div>
        <button className="btn-blue" onClick={correr} disabled={corriendo} style={{ fontSize: 12, padding: "7px 14px" }}>
          {corriendo ? "Consultando..." : reporte ? "🔄 Re-correr" : "▶ Correr Nubarium"}
        </button>
      </div>

      {err && <div style={{ background: "#fee2e2", color: "#c0392b", borderRadius: 8, padding: "10px 12px", fontSize: 12, marginBottom: 10 }}>{err}</div>}

      {!reporte && !corriendo && (
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "14px 16px", fontSize: 12, color: "#555" }}>
          Genera el informe oficial (CURP en RENAPO, RFC en SAT, OCR del INE y lista negra 69-B). El informe es de apoyo — <strong>la decisión de Aceptar o Rechazar la tomas tú</strong> moviendo la tarjeta.
        </div>
      )}

      {reporte && (
        <div>
          {r.generado_at && <div style={{ fontSize: 10, color: "#aab", marginBottom: 10 }}>Generado {new Date(r.generado_at).toLocaleString("es-CL")}</div>}

          <SeccionNubarium titulo="CURP · RENAPO" sem={semCurp}>
            {c.estatus === "OK" ? (
              <>
                <CampoN l="Nombre" v={`${c.nombre || ""} ${c.apellidoPaterno || ""} ${c.apellidoMaterno || ""}`.trim()} />
                <CampoN l="CURP" v={c.curp} />
                <CampoN l="Nacimiento" v={`${c.fechaNacimiento || "—"} · ${c.sexo || ""}`} />
                <CampoN l="Entidad" v={c.estadoNacimiento} />
                <CampoN l="Estatus CURP" v={c.estatusCurp} />
                {c.datosDocProbatorio && <CampoN l="Acta" v={`No. ${c.datosDocProbatorio.numActa || "—"} · ${c.datosDocProbatorio.entidadRegistro || ""} ${c.datosDocProbatorio.anioReg || ""}`} />}
              </>
            ) : (
              <CampoN l="Resultado" v={c.mensaje || (c._error ? "Sin respuesta del servicio" : "No validado")} />
            )}
          </SeccionNubarium>

          <SeccionNubarium titulo="RFC · SAT" sem={semRfc}>
            {f.estatus === "OK" ? (
              <>
                <CampoN l="Resultado" v={f.mensaje} />
                <CampoN l="Tipo persona" v={f.tipoPersona === "F" ? "Física" : f.tipoPersona === "M" ? "Moral" : f.tipoPersona} />
                <CampoN l="Nota" v={f.informacionAdicional} />
              </>
            ) : (
              <CampoN l="Resultado" v={f.mensaje || (f._error ? "Sin respuesta del servicio" : "No validado")} />
            )}
          </SeccionNubarium>

          <SeccionNubarium titulo="Antecedentes fiscales · Lista 69-B SAT" sem={sem69}>
            {b.estatus === "OK" ? (
              situ ? (
                <>
                  <CampoN l="Situación" v={b.situacion} />
                  <CampoN l="Contribuyente" v={b.nombreContribuyente} />
                  <CampoN l="Oficio definitivo" v={b.numeroFechaOficioDefinitivo} />
                  <CampoN l="Publicación DOF" v={b.publicacionDofDefinitivo} />
                </>
              ) : (
                <CampoN l="Resultado" v="Sin coincidencias en lista negra 69-B" />
              )
            ) : (
              <CampoN l="Resultado" v={b.mensaje || (b._error ? "Sin respuesta del servicio" : "No consultado")} />
            )}
          </SeccionNubarium>

          <SeccionNubarium titulo="INE · OCR" sem={semIne}>
            {(i.nombres || i.curp) ? (
              <>
                <CampoN l="Nombre OCR" v={`${i.nombres || ""} ${i.primerApellido || ""} ${i.segundoApellido || ""}`.trim()} />
                <CampoN l="CURP OCR" v={<span>{i.curp} {candidato.curp ? (curpOcrMatch ? "✅" : "⚠️ ≠ declarada") : ""}</span>} />
                <CampoN l="Clave elector" v={i.claveElector} />
                <CampoN l="CIC" v={i.cic} />
                <CampoN l="Vigencia" v={i.vigencia} />
                <CampoN l="Domicilio" v={[i.calle, i.colonia, i.ciudad].filter(Boolean).join(", ")} />
                <CampoN l="Sección" v={i.seccion} />
                {i.validacionMRZ && <CampoN l="Chequeo MRZ" v={Object.entries(i.validacionMRZ).map(([k, v]) => `${k}: ${v}`).join(" · ")} />}
              </>
            ) : (
              <CampoN l="Resultado" v={i._error ? "Sin respuesta del servicio (¿se envió la imagen del INE?)" : "Sin datos"} />
            )}
          </SeccionNubarium>

          <SeccionNubarium titulo="INE · Lista Nominal (vigencia oficial)" sem={semLN}>
            {ln.estatus === "OK" ? (
              <>
                <CampoN l="Estado" v={ln.mensaje} />
                <CampoN l="Clave elector" v={ln.claveElector} />
                <CampoN l="Vigencia" v={ln.vigencia} />
                <CampoN l="Emisión / Registro" v={`${ln.anioEmision || "—"} · reg. ${ln.anioRegistro || "—"} · núm. ${ln.numeroEmision ?? "—"}`} />
              </>
            ) : (
              <CampoN l="Resultado" v={ln.mensaje || (ln._error ? "No se pudo validar (¿faltó el reverso del INE para leer el CIC?)" : "No consultado")} />
            )}
          </SeccionNubarium>
        </div>
      )}
    </div>
  );
}

// ─── DETALLE CANDIDATO ───────────────────────────────────────────────
// ─── ETAPA 7 · SOLICITUD DE ALTA ────────────────────────────────────
// Resumen ejecutivo de todo el proceso + creación de empresa con
// credenciales del portal (vía n8n). Al enviar, la tarjeta pasa a Firma.
function ResumenSolicitudAlta({ fuente, registro, datos, onEnviado }) {
  const [minuta, setMinuta] = useState(null);
  const [itemsOp, setItemsOp] = useState(null);
  const [tareaAlta, setTareaAlta] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    (async () => {
      const [rm, rc, rt] = await Promise.all([
        sb.from("minutas_entrevista").select("*").eq("fuente", fuente).eq("registro_id", registro.id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("contrato_operacional").select("*").eq("fuente", fuente).eq("registro_id", registro.id).maybeSingle(),
        sb.from("tareas_supervisor").select("estado, sla_vence_at").eq("fuente", fuente)
          .eq("registro_id", registro.id).eq("tipo_tarea", "alta_operacional").maybeSingle(),
      ]);
      setMinuta(rm.data || false);
      setItemsOp(rc.data || false);
      setTareaAlta(rt.data || false);
    })();
  }, [registro.id]);

  const crearEmpresa = async () => {
    if (!datos.email) { alert("El prospecto no tiene email registrado — es necesario para crear su acceso al portal."); return; }
    if (itemsOp === false && !confirm("El Jefe de Supervisores aún NO completa los items del contrato (tarea Alta Operacional pendiente).\n\n¿Crear la empresa y enviar credenciales de todas formas?")) return;
    if (!confirm(`¿Crear la empresa de ${datos.nombre} y enviarle las credenciales del portal a ${datos.email}?`)) return;
    setEnviando(true);
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/crear-empresa-terceros", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuente, id: registro.id, nombre: datos.nombre, rfc: datos.rfc || "", email: datos.email }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt || !txt.trim()) throw new Error("el servicio no respondió");
      const r = JSON.parse(txt);
      if (!r.ok) throw new Error(r.error || "no se pudo crear la empresa");
      // Archivador: indexar los documentos de la minuta (fotos, póliza, tarjeta, GPS)
      // en la empresa recién creada — sin volver a subir nada (mismo archivo, nueva ficha).
      if (r.tercero_id) {
        try {
          const ETIQ = { frente: "Frente", posterior: "Posterior", lat_izq: "Lateral izq", lat_der: "Lateral der", placa: "Placa", interior: "Interior", odometro: "Odómetro", tarjeta: "Tarjeta de circulación", seguro: "Póliza de seguro", gps: "Info GPS" };
          const { data: ms } = await sb.from("minutas_entrevista")
            .select("vehiculos").eq("fuente", fuente).eq("registro_id", registro.id)
            .order("created_at", { ascending: false }).limit(1);
          const vehs = (ms && ms[0] && Array.isArray(ms[0].vehiculos)) ? ms[0].vehiculos : [];
          const filas = [];
          vehs.forEach((v, i) => {
            const ref = (v.placa || `Unidad ${i + 1}`).toUpperCase();
            Object.entries(v.fotos || {}).forEach(([slot, path]) => {
              filas.push({
                tercero_id: r.tercero_id, bucket: "proceso_certificacion_bt", storage_path: path,
                categoria: slot === "seguro" ? "seguros" : "vehiculos",
                nombre_archivo: `${ref} — ${ETIQ[slot] || slot}.jpg`, mime_type: "image/jpeg",
                referencia: ref, notas: "Capturado en la minuta de entrevista",
                subido_por: window.__PERFIL_EMAIL || "", origen: "brain",
              });
            });
          });
          if (filas.length) await sb.from("documentos_empresa").upsert(filas, { onConflict: "storage_path" });
        } catch (eIdx) { console.warn("Indexación de minuta al archivador falló:", eIdx.message); }
      }
      const tabla = fuente === "certificaciones_mx" ? "certificaciones_mx" : "certificaciones";
      // El tercero_id recién creado se escribe de vuelta en la tarjeta. Sin
      // esto la tarjeta queda huérfana: sin bloqueo de prefactura posible,
      // sin vínculo al archivador ni al chat de empresa (bug Perla/Fidel,
      // 17-ago-2026: el webhook devolvía el id y nunca se guardaba).
      const patch = fuente === "certificaciones_mx"
        ? { estado: "en_firma", etapa_kanban: "firma_contrato", ...(r.tercero_id ? { tercero_id: r.tercero_id } : {}) }
        : { etapa_kanban: "firma_contrato", ...(r.tercero_id ? { tercero_id: r.tercero_id } : {}) };
      await sb.from(tabla).update(patch).eq("id", registro.id);
      // Y si ya existía una solicitud de firma para esta tarjeta (no debería
      // en el flujo normal, pero sí tras un backfill), se completa el vínculo.
      if (r.tercero_id) {
        await sb.from("solicitudes_tercero")
          .update({ tercero_id: r.tercero_id })
          .eq("ref_tabla", tabla).eq("ref_id", String(registro.id))
          .is("tercero_id", null);
      }
      alert("✅ Empresa creada y credenciales enviadas por correo.\nLa tarjeta pasa a Etapa 8 · Firma de Contrato.");
      onEnviado(patch);
    } catch (e) { alert("No se pudo completar: " + e.message); }
    finally { setEnviando(false); }
  };

  const Fila = ({ k, v }) => (
    <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid #f0f4f3", fontSize: 13 }}>
      <span style={{ flex: "0 0 190px", color: "#888", fontWeight: 600 }}>{k}</span>
      <span style={{ flex: 1, fontWeight: 600 }}>{v || "—"}</span>
    </div>
  );

  return (
    <div className="form-card" style={{ background: "#e7f5f2", border: "1px solid #c4e6df" }}>
      <div className="form-title" style={{ color: "#0f766e" }}>📄 Etapa 7 · Solicitud de Alta — Resumen del proceso</div>

      <Fila k="🤖 Nota Biggy" v={registro.claude_score_global != null ? `${registro.claude_score_global}/10 · ${registro.claude_recomendacion || ""}` : null} />
      <Fila k="🛒 Validación MELI" v={registro.respuesta_meli || (registro.fecha_respuesta_meli ? "Aprobado" : null)} />
      <Fila k="🪪 Validación Nubarium" v={registro.nubarium_reporte ? `Informe generado${registro.nubarium_reviewed_at ? " el " + new Date(registro.nubarium_reviewed_at).toLocaleDateString("es-MX") : ""}` : null} />
      <Fila k="📞 Nota del supervisor" v={registro.comentario_supervisor} />
      <Fila k="🗣 Entrevista Operaciones" v={registro.comentario_entrevista} />
      {/* Calificación del guion de llamada (lo captura el supervisor en su Bitácora) */}
      {minuta === null ? <Fila k="📋 Minuta de entrevista" v="Cargando…" /> : minuta && (
        <Fila k="📋 Minuta de entrevista" v={`${minuta.tipo_vehiculo || "—"} · ${minuta.cantidad_choferes ?? "—"} chofer(es) · ${minuta.cantidad_ayudantes ?? "—"} ayudante(s) · ${minuta.horario || "—"} · ${minuta.zona_operacion || "—"}`} />
      )}
      {/* Unidades de la minuta: GPS y seguro declarados por el supervisor en terreno */}
      {minuta && Array.isArray(minuta.vehiculos) && minuta.vehiculos.length > 0 && (
        <Fila k="🚚 Unidades de la entrevista" v={
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {minuta.vehiculos.map((v, i) => {
              const nFotos = v.fotos ? Object.keys(v.fotos).length : 0;
              const gpsSi = String(v.gps || "").toLowerCase().startsWith("s");
              const segSi = String(v.seguro || "").toLowerCase().startsWith("s");
              return (
                <div key={i} style={{ fontSize: 12.5 }}>
                  <b>{v.placa || `Unidad ${i + 1}`}</b>
                  {v.tipo ? ` · ${v.tipo}` : ""}{v.marca ? ` ${v.marca}` : ""}{v.anio ? ` ${v.anio}` : ""}
                  {v.prop ? ` · ${v.prop}` : ""}{v.km ? ` · ${Number(v.km).toLocaleString("es-MX")} km` : ""}
                  {" · "}
                  <span style={{ fontWeight: 700, color: v.gps ? (gpsSi ? "#166534" : "#c0392b") : "#98a2b3" }}>
                    📡 GPS {v.gps ? (gpsSi ? "Sí" : "NO") : "sin dato"}
                  </span>
                  {" · "}
                  <span style={{ fontWeight: 700, color: v.seguro ? (segSi ? "#166534" : "#c0392b") : "#98a2b3" }}>
                    🛡 Seguro {v.seguro ? (segSi ? "Sí" : "NO") : "sin dato"}
                  </span>
                  {nFotos ? <span style={{ color: "#667085" }}> · 📷 {nFotos} foto(s)</span> : null}
                </div>
              );
            })}
            {minuta.vehiculos.some((v) => !String(v.gps || "").toLowerCase().startsWith("s")) && (
              <div style={{ fontSize: 11.5, color: "#b45309", fontWeight: 600 }}>
                ⚠️ Certificación completa exige GPS + seguro antes de salir a ruta.
              </div>
            )}
          </div>
        } />
      )}
      {/* El Jefe ya cumplió: la tarjeta está lista para crear credenciales.
          Antes no había ninguna señal y las tarjetas se quedaban esperando
          en silencio (Susana 7 días, Jaime 9). */}
      {itemsOp && itemsOp.fecha_inicio && !registro.tercero_id && (
        <div style={{ background: "#e8f5ec", border: "1.5px solid #86c9a0", borderRadius: 12, padding: "13px 15px", margin: "10px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#166534" }}>
                El Jefe de Operaciones ya completó sus items
              </div>
              <div style={{ fontSize: 12, color: "#2f6b47", lineHeight: 1.5 }}>
                La tarjeta está lista para crear las credenciales del portal y pasar a Etapa 8.
              </div>
              {itemsOp.completado_at && (
                <div style={{ fontSize: 11.5, color: "#4a7c5f", marginTop: 3 }}>
                  Completado el {fMX(itemsOp.completado_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {itemsOp.sla_cumplido === false && <b style={{ color: "#c0392b" }}> · SLA 24 h vencido</b>}
                  {itemsOp.sla_cumplido === true && <b style={{ color: "#166534" }}> · SLA cumplido</b>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Fila k="🏗 Items del contrato (Jefe)" v={
        itemsOp === null ? "Cargando…"
        : itemsOp ? `inicio ${itemsOp.fecha_inicio || "—"} · ${itemsOp.esquema_tarifa || itemsOp.tarifa_aplicable || "—"}`
        : (tareaAlta && tareaAlta.estado === "pendiente" ? "⏳ Pendiente — tarea Alta Operacional en Indicadores (SLA 24 h)" : "Sin completar")
      } />

      {/* Líneas del Anexo A tal como las dejó el Jefe de Operaciones: lo que
          esté incompleto aquí es exactamente lo que el analista tendrá que
          cruzar a mano en Etapa 8 antes de generar el contrato. */}
      {itemsOp && (
        <Fila k="📋 Líneas del Anexo A" v={
          Array.isArray(itemsOp.lineas) && itemsOp.lineas.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {itemsOp.lineas.slice(0, 3).map((l, i) => {
                const svc = (l.svc || l.sc || "").toUpperCase();
                const falta = [];
                if (!svc) falta.push("SVC");
                if (!normModeloLinea(l.modelo)) falta.push("modelo");
                if (!normTipoVehiculo(l.tipo)) falta.push("tipo");
                if (!String(l.n ?? l.cantidad ?? "").trim()) falta.push("cantidad");
                if (!normAyudanteLinea(l.ayudante)) falta.push("ayudante");
                return (
                  <div key={i} style={{ fontSize: 12.5 }}>
                    <b>{i + 1}.</b> {svc || "—"} · {normModeloLinea(l.modelo) || "—"} · {normTipoVehiculo(l.tipo) || "—"}
                    {" · "}{String(l.n ?? l.cantidad ?? "—")} unidad(es) · ayudante {normAyudanteLinea(l.ayudante) || "—"}
                    {l.placa ? <span style={{ color: "#667085" }}> · {String(l.placa).toUpperCase()}</span> : null}
                    {falta.length ? <span style={{ color: "#c0392b", fontWeight: 700 }}> · falta {falta.join(", ")}</span> : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <span style={{ color: "#b45309", fontWeight: 600 }}>
              ⚠️ El Jefe no cargó las líneas por unidad — el analista deberá completarlas en Etapa 8.
            </span>
          )
        } />
      )}

      <button onClick={crearEmpresa} disabled={enviando}
        style={{ width: "100%", marginTop: 14, background: "#0f766e", color: "#fff", border: "none", borderRadius: 10,
          padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: enviando ? 0.6 : 1 }}>
        {enviando ? "Creando empresa…" : "🏢 Crear empresa y enviar credenciales del portal"}
      </button>
      <div style={{ fontSize: 11, color: "#0f766e", marginTop: 8, textAlign: "center" }}>
        Crea la empresa en Terceros (se une al motor de Pagos), genera su acceso y envía el link del portal con las credenciales. La tarjeta pasa a <b>Etapa 8 · Firma de Contrato</b>.
      </div>
    </div>
  );
}

// ─── ETAPA 5 · FIRMA DE CONTRATO (MIFIEL) ───────────────────────────
// Mismo componente para ambas fuentes (regla: todas las tarjetas iguales).
// ⚠️ Cambiar a "production" al salir del sandbox de MIFIEL.
const MIFIEL_ENV = "production";

// Carga el script del widget de MIFIEL una sola vez (compartido por Etapa 5 y Gestionador)
function cargarScriptMifiel() {
  if (document.querySelector("script[data-mifiel-widget]")) return;
  const s = document.createElement("script");
  s.type = "module";
  s.src = "https://app.mifiel.com/widget-component/index.js";
  s.setAttribute("data-mifiel-widget", "1");
  document.head.appendChild(s);
}

// ═══ GENERADOR DE CONTRATO v2 · plantilla ContratoTransportista v1.0 ═══
// Consolida los datos (Jefe > minuta > tarjeta), el ANALISTA los revisa y
// puede editarlos manualmente, y el Brain llena la plantilla con pdf-lib:
// Hoja de Firmas (pág 11) + Anexo A (pág 13) + Backup A.2 (pág 14).
const CONTRATO_COORDS = {
  plantilla: "plantillas/contrato_transportista_v2.pdf",
  pagFirmas: 10, pagAnexoA: 12, pagA2: 13,
  firmas: {
    dia: { x: 188, y: 318.5, s: 9 }, mes: { x: 228, y: 318.5, s: 9 }, anio: { x: 330, y: 318.5, s: 9 },
    nombre: { x: 421, y: 279, s: 8 }, rfc: { x: 338, y: 268.5, s: 8.5 }, rep: { x: 424, y: 258, s: 8.5 },
    chkMoral: { x: 372.5, y: 206.3 }, chkFisica: { x: 553.9, y: 206.3 },
    col: 311.7, tNombre: 194.8, tRfc: 182.8, tDomicilio: 170.7, tRep: 158.7, tCorreo: 146.6, tRepse: 134.6,
  },
  anexoA: {
    col: 311.7, nombre: 602.9, rfc: 590.8, rep: 578.8, correo: 566.7,
    chkMeli: { x: 371.7, y: 555.6 }, chkOtro: { x: 406.8, y: 555.6 },
    chkB2bSi: { x: 322.1, y: 545.3 }, chkB2bNo: { x: 350.5, y: 545.3 },
    fechaInicio: 534.1, vigencia: 522.0,
    modX: 223.0, modY: { SDD: 458.3, Spot: 415.5, Backup: 377.3 },
    filasY: [293.0, 243.1, 193.2], ayudanteY: [301.0, 251.1, 201.2],
    svcX: 100, cantX: 292, ayuSiX: 350.2, ayuNoX: 375.0, obsX: 512,
    // Casillas de la TABLA DE LÍNEAS (una fila por unidad). x absoluto y
    // dy relativo al ancla de la fila (filasY). Medidas sobre la plantilla
    // v2, página 13 (índice 12) — cada casilla va bajo su etiqueta.
    lin: {
      modelo: {
        "SDD":    { x: 181.4, dy:  3.9 },
        "Spot":   { x: 163.9, dy: -4.2 },
        "Backup": { x: 205.1, dy: -4.2 },
      },
      tipo: {
        "Large Van":  { x: 223.2, dy:  3.9 },
        "Small Van":  { x: 223.2, dy: -4.2 },
        "Car":        { x: 250.5, dy: -4.2 },
        "Medium Van": { x: 264.7, dy: -12.4 },
      },
      ayudante: {
        "Sí":               { x: 350.3, dy:  8.0 },
        "No":               { x: 375.1, dy:  8.0 },
        "Según activación": { x: 379.6, dy: -8.3 },
      },
      tarifa: {
        "Tabla vigente": { x: 460.2, dy: -0.1 },
        "Especial":      { x: 460.2, dy: -8.3 },
      },
    },
  },
  a2: {
    col: 311.7,
    chkSi: { x: 322.1, y: 529.2 }, chkNo: { x: 350.5, y: 529.2 },
    transportista: 517.7, svc: 505.6, dias: 493.6,
    chkLarge: { x: 355.4, y: 482.8 }, chkSmall: { x: 413.1, y: 482.8 }, chkCar: { x: 444.3, y: 482.8 },
    chkCostoSi: { x: 322.1, y: 451.9 }, chkCostoNo: { x: 350.5, y: 451.9 }, chkCostoPropio: { x: 458.0, y: 451.9 },
    chkAprOper: { x: 364.9, y: 441.6 }, chkAprGer: { x: 418.3, y: 441.6 }, chkAprFin: { x: 470.9, y: 441.6 },
  },
};

function cargarPdfLib() {
  return new Promise((resolve, reject) => {
    if (window.PDFLib) return resolve(window.PDFLib);
    let s = document.querySelector("script[data-pdf-lib]");
    if (!s) {
      s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
      s.setAttribute("data-pdf-lib", "1");
      document.head.appendChild(s);
    }
    s.addEventListener("load", () => resolve(window.PDFLib));
    s.addEventListener("error", () => reject(new Error("no se pudo cargar pdf-lib")));
  });
}

const MESES_ES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// ── Línea operativa del Anexo A: una fila por unidad ─────────────────
// Cada unidad tiene su propio SVC, modelo (SDD/Spot/Backup), tipo de
// vehículo, ayudante y tarifa: dos camionetas del mismo transportista
// pueden ser una SDD Large Van y otra Spot Small Van.
const MODELOS_LINEA  = ["SDD", "Spot", "Backup"];
const TIPOS_LINEA    = ["Large Van", "Medium Van", "Small Van", "Car"];
const AYUDANTE_LINEA = ["Sí", "No", "Según activación"];
const TARIFAS_LINEA  = ["Tabla vigente", "Especial"];

// Normaliza lo que escriba el Jefe o venga de la minuta a los valores
// exactos de la plantilla ("large" / "LARGE VAN" / "Van Grande" → "Large Van").
function normTipoVehiculo(v) {
  const t = String(v || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return "";
  if (t.includes("large") || t.includes("grande")) return "Large Van";
  if (t.includes("medi")) return "Medium Van";      // cubre "Medim Van" de la plantilla
  if (t.includes("small") || t.includes("chica") || t.includes("pequen")) return "Small Van";
  if (t.includes("car") || t.includes("auto") || t.includes("sedan")) return "Car";
  return TIPOS_LINEA.find((x) => x.toLowerCase() === String(v).toLowerCase()) || "";
}
function normModeloLinea(v) {
  const t = String(v || "").toLowerCase();
  if (!t) return "";
  if (t.includes("sdd") || t.includes("dedic")) return "SDD";
  if (t.includes("spot")) return "Spot";
  if (t.includes("backup") || t.includes("respaldo")) return "Backup";
  return "";
}
function normAyudanteLinea(v) {
  const t = String(v || "").toLowerCase();
  if (!t) return "";
  if (t.startsWith("s")) return "Sí";
  if (t.startsWith("n")) return "No";
  if (t.includes("activ")) return "Según activación";
  return "";
}
function normLinea(l, svcDefault, tarifaDefault) {
  l = l || {};
  return {
    svc:      String(l.svc || l.sc || svcDefault || "").toUpperCase(),
    modelo:   normModeloLinea(l.modelo || l.modelo_operativo),
    tipo:     normTipoVehiculo(l.tipo || l.tipo_vehiculo),
    n:        String(l.n ?? l.cantidad ?? l.cantidad_vehiculos ?? ""),
    ayudante: normAyudanteLinea(l.ayudante ?? l.ayudante_helper),
    tarifa:   TARIFAS_LINEA.includes(l.tarifa) ? l.tarifa : (tarifaDefault || "Tabla vigente"),
    placa:    String(l.placa || "").toUpperCase(),
    obs:      l.obs || "",
  };
}
// Qué le falta al contrato para poder estamparse. Devuelve textos legibles.
function faltantesContrato(D) {
  const f = [];
  if (!D) return ["sin datos"];
  if (!String(D.nombre || "").trim())    f.push("Nombre / razón social");
  if (!String(D.rfc || "").trim())       f.push("RFC");
  if (!String(D.domicilio || "").trim()) f.push("Domicilio fiscal");
  if (!String(D.fechaIni || "").trim())  f.push("Fecha de inicio de operación");
  const ls = (D.lineas || []).filter((l) => l.tipo || l.modelo || l.n || l.svc);
  if (!ls.length) f.push("Al menos una línea operativa (Anexo A)");
  ls.forEach((l, i) => {
    const q = [];
    if (!l.svc)      q.push("SVC");
    if (!l.modelo)   q.push("modelo (SDD/Spot/Backup)");
    if (!l.tipo)     q.push("tipo de vehículo");
    if (!String(l.n).trim()) q.push("cantidad");
    if (!l.ayudante) q.push("ayudante");
    if (q.length) f.push(`Línea ${i + 1}: falta ${q.join(", ")}`);
  });
  if (D.backup && D.backup.aplica === "Sí") {
    if (!D.backup.svc)  f.push("Backup A.2: SVC");
    if (!D.backup.tipo) f.push("Backup A.2: tipo de vehículo");
  }
  return f;
}

// Consolida las fuentes en un objeto EDITABLE por el analista.
async function consolidarDatosContrato({ tabla, registro, datos }) {
  const { data: cos } = await sb.from("contrato_operacional")
    .select("*").eq("fuente", tabla).eq("registro_id", registro.id).limit(1);
  const co = cos && cos[0];
  if (!co) throw new Error("no existe el alta operacional de este prospecto — el Jefe de Operaciones debe completar su tarea (Solicitud de Alta) antes de generar el contrato");
  const { data: ms } = await sb.from("minutas_entrevista")
    .select("*").eq("fuente", tabla).eq("registro_id", registro.id)
    .order("created_at", { ascending: false }).limit(1);
  const m = (ms && ms[0]) || {};
  const mf = m.datos?.fields || {}, mr = m.datos?.radio || {}, mm = m.datos?.multi || {};

  const svcDefault    = ((co.sc || registro.svc || "").split("_").pop() || "").toUpperCase();
  const tarifaDefault = co.tarifa_aplicable || "Tabla vigente";

  // Prioridad de fuentes para la tabla del Anexo A:
  //  1) contrato_operacional.lineas — lo que definió el JEFE DE OPERACIONES
  //     (una fila por unidad, con su modelo, tipo, ayudante y tarifa).
  //  2) unidades de la minuta de entrevista — una fila por unidad, con el
  //     tipo que vio el supervisor en terreno; modelo y ayudante quedan
  //     vacíos y el analista los completa en Etapa 8.
  //  3) el resumen antiguo (tipo_vehiculos + cantidad_vehiculos) — una sola fila.
  let lineas = [];
  const vehs = Array.isArray(m.vehiculos) ? m.vehiculos : [];
  if (Array.isArray(co.lineas) && co.lineas.length) {
    lineas = co.lineas.slice(0, 3).map((l) => normLinea(l, svcDefault, tarifaDefault));
  } else if (vehs.length) {
    lineas = vehs.slice(0, 3).map((v) => normLinea(
      { tipo: v.tipo, n: "1", placa: v.placa, ayudante: co.ayudante_helper },
      svcDefault, tarifaDefault));
  } else {
    lineas = [normLinea(
      { tipo: co.tipo_vehiculos, n: co.cantidad_vehiculos, modelo: co.modelos_operativos },
      svcDefault, tarifaDefault)];
  }

  return {
    nombre:    mf.p_nombre || datos.nombre || "",
    rfc:       co.rfc_razon_social || mf.p_rfc || datos.rfc || "",
    rep:       mf.p_decide || datos.nombre || "",
    correo:    mf.p_correo || datos.email || "",
    domicilio: co.domicilio_fiscal || mf.p_domicilio || "",
    repse:     co.repse || mf.p_repse || "",
    figura:    (mr.p_figura || "").startsWith("Moral") ? "Moral" : "Física",
    b2b:       co.back_to_back || "No",
    tarifa:    co.tarifa_aplicable || "Tabla vigente",
    vigencia:  co.vigencia_particular || "12 meses renovables",
    fechaIni:  co.fecha_inicio || mf.op_inicio || "",
    // Bloque superior "Modelo" del Anexo A: es el conjunto de modelos que
    // aparecen en las líneas (si una unidad es SDD y otra Spot, se marcan ambos).
    modelos:   (() => {
      const deLineas = [...new Set(lineas.map((l) => l.modelo).filter(Boolean))];
      if (deLineas.length) return deLineas;
      const deCO = (co.modelos_operativos || "").split("/").map(normModeloLinea).filter(Boolean);
      return deCO.length ? deCO : (mm.op_modelo || []);
    })(),
    ayudante:  normAyudanteLinea(co.ayudante_helper || mr.op_ayudante) || "",
    svc:       svcDefault,
    lineas,
    backup: {
      aplica: co.backup_aplica || "", svc: co.backup_svc || "", dias: co.backup_dias || "",
      tipo: co.backup_tipo || "", costo: co.backup_costo_cliente || "", aprobador: co.backup_aprobador || "",
    },
  };
}

// Llena la plantilla con los datos (posiblemente editados) y sube a Storage.
async function generarContratoPDFDesde(D, { tabla, registro }) {
  const PDFLib = await cargarPdfLib();
  const { data: plantilla, error: eDl } = await sb.storage
    .from("proceso_certificacion_bt").download(CONTRATO_COORDS.plantilla);
  if (eDl || !plantilla) throw new Error("no se pudo descargar la plantilla del contrato (Storage: " + CONTRATO_COORDS.plantilla + ")");
  const pdf = await PDFLib.PDFDocument.load(await plantilla.arrayBuffer());
  const font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const negro = PDFLib.rgb(0.1, 0.1, 0.12);
  const pF = pdf.getPage(CONTRATO_COORDS.pagFirmas);
  const pA = pdf.getPage(CONTRATO_COORDS.pagAnexoA);
  const p2 = pdf.getPage(CONTRATO_COORDS.pagA2);
  const T = (pg, x, y, txt, s = 8.5) => { if (txt) pg.drawText(String(txt), { x, y, size: s, font, color: negro }); };
  const X = (pg, c) => { if (c) pg.drawText("X", { x: c.x, y: c.y, size: 9, font: bold, color: negro }); };

  const F = CONTRATO_COORDS.firmas, A = CONTRATO_COORDS.anexoA, B = CONTRATO_COORDS.a2;
  const hoy = new Date();
  T(pF, F.dia.x, F.dia.y, String(hoy.getDate()).padStart(2, "0"), F.dia.s);
  T(pF, F.mes.x, F.mes.y, MESES_ES[hoy.getMonth()], F.mes.s);
  T(pF, F.anio.x, F.anio.y, String(hoy.getFullYear()).slice(-2), F.anio.s);
  T(pF, F.nombre.x, F.nombre.y, D.nombre, F.nombre.s);
  T(pF, F.rfc.x, F.rfc.y, D.rfc, F.rfc.s);
  T(pF, F.rep.x, F.rep.y, D.rep, F.rep.s);
  X(pF, D.figura === "Moral" ? F.chkMoral : F.chkFisica);
  T(pF, F.col, F.tNombre, D.nombre); T(pF, F.col, F.tRfc, D.rfc);
  T(pF, F.col, F.tDomicilio, D.domicilio, 7);
  T(pF, F.col, F.tRep, D.rep); T(pF, F.col, F.tCorreo, D.correo); T(pF, F.col, F.tRepse, D.repse || "—");

  T(pA, A.col, A.nombre, D.nombre); T(pA, A.col, A.rfc, D.rfc);
  T(pA, A.col, A.rep, D.rep); T(pA, A.col, A.correo, D.correo);
  X(pA, A.chkMeli);
  X(pA, D.b2b === "Sí" ? A.chkB2bSi : A.chkB2bNo);
  T(pA, A.col, A.fechaInicio, D.fechaIni); T(pA, A.col, A.vigencia, D.vigencia);
  (D.modelos || []).forEach(mo => { if (A.modY[mo]) X(pA, { x: A.modX, y: A.modY[mo] }); });
  // Tabla de líneas: cada unidad marca SU modelo, SU tipo, SU ayudante y
  // SU tarifa. Antes esto se escribía como texto en Observaciones y las
  // casillas quedaban vacías — el analista tenía que cruzarlas a mano.
  (D.lineas || []).slice(0, 3).forEach((l, i) => {
    if (!l.tipo && !l.n && !l.modelo && !l.svc) return;
    const y = A.filasY[i];
    const casilla = (grupo, valor) => {
      const c = A.lin[grupo] && A.lin[grupo][valor];
      if (c) X(pA, { x: c.x, y: y + c.dy });
    };
    T(pA, A.svcX,  y, l.svc || D.svc, 8);
    T(pA, A.cantX, y, l.n, 8);
    casilla("modelo",   l.modelo);
    casilla("tipo",     normTipoVehiculo(l.tipo));
    casilla("ayudante", l.ayudante || D.ayudante);
    casilla("tarifa",   l.tarifa || D.tarifa);
    // Observaciones: solo lo que escriba el analista (placa u observación).
    const obs = l.obs || l.placa || "";
    if (obs) T(pA, A.obsX, y, obs, 6.5);
  });

  // A.2 Backup Operativo — la casilla Sí/No se marca SIEMPRE (antes, si
  // nadie tocaba Backup, el anexo salía en blanco y el analista lo cruzaba).
  const bk = D.backup || {};
  const aplicaBk = bk.aplica
    || (((D.modelos || []).includes("Backup") || (D.lineas || []).some((l) => l.modelo === "Backup")) ? "Sí" : "No");
  {
    X(p2, aplicaBk === "Sí" ? B.chkSi : B.chkNo);
    if (aplicaBk === "Sí") {
      T(p2, B.col, B.transportista, D.nombre);
      T(p2, B.col, B.svc, bk.svc);
      T(p2, B.col, B.dias, bk.dias);
      X(p2, bk.tipo === "Large Van" ? B.chkLarge : bk.tipo === "Small Van" ? B.chkSmall : bk.tipo === "Car" ? B.chkCar : null);
      X(p2, bk.costo === "Sí" ? B.chkCostoSi : bk.costo === "No" ? B.chkCostoNo : bk.costo ? B.chkCostoPropio : null);
      X(p2, bk.aprobador === "Operaciones" ? B.chkAprOper : bk.aprobador === "Gerencia" ? B.chkAprGer : bk.aprobador === "Finanzas" ? B.chkAprFin : null);
    }
  }

  const bytes = await pdf.save();
  const path = `contratos_generados/${tabla}/${registro.id}.pdf`;
  const { error: eUp } = await sb.storage.from("proceso_certificacion_bt")
    .upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: true });
  if (eUp) throw new Error("no se pudo guardar el contrato generado: " + eUp.message);
  const { data: su } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(path, 3600);
  return { path, url: su?.signedUrl || null };
}

// ── Formulario de revisión manual del ANALISTA (a nivel de módulo:
//    identidad estable para que los inputs no pierdan el foco) ──
const CG_INP = { width: "100%", boxSizing: "border-box", border: "1px solid #ddd0f7", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontFamily: "'Geist',sans-serif", background: "#fff" };
const CG_LBL = { fontSize: 9.5, fontWeight: 700, color: "#7c6f96", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 3, display: "block" };
function CGField({ label, children }) {
  return (<div><span style={CG_LBL}>{label}</span>{children}</div>);
}
function EditorContrato({ D, setD, generando, onGenerar }) {
  const faltan = faltantesContrato(D);
  const S = (k, v) => setD((p) => ({ ...p, [k]: v }));
  const SB_ = (k, v) => setD((p) => ({ ...p, backup: { ...p.backup, [k]: v } }));
  const SL = (i, k, v) => setD((p) => ({ ...p, lineas: p.lineas.map((l, ix) => ix === i ? { ...l, [k]: v } : l) }));
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 };
  return (
    <div style={{ background: "#fff", border: "1px solid #ddd0f7", borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#7c3aed", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".4px" }}>
        Revisión del analista · datos que se estamparán en el contrato
      </div>
      <div style={grid}>
        <CGField label="Nombre / Razón social"><input style={CG_INP} value={D.nombre} onChange={(e) => S("nombre", e.target.value)} /></CGField>
        <CGField label="RFC de la razón social"><input style={{ ...CG_INP, fontFamily: "monospace" }} value={D.rfc} onChange={(e) => S("rfc", e.target.value.toUpperCase())} /></CGField>
        <CGField label="Figura jurídica">
          <select style={CG_INP} value={D.figura} onChange={(e) => S("figura", e.target.value)}>
            <option>Moral</option><option>Física</option>
          </select></CGField>
        <CGField label="Representante / Titular (firmante)"><input style={CG_INP} value={D.rep} onChange={(e) => S("rep", e.target.value)} /></CGField>
        <CGField label="Correo del firmante"><input style={CG_INP} value={D.correo} onChange={(e) => S("correo", e.target.value)} /></CGField>
        <CGField label="REPSE (si aplica)"><input style={{ ...CG_INP, fontFamily: "monospace" }} value={D.repse} onChange={(e) => S("repse", e.target.value)} /></CGField>
      </div>
      <div style={{ marginTop: 10 }}>
        <CGField label="Domicilio fiscal"><input style={CG_INP} value={D.domicilio} onChange={(e) => S("domicilio", e.target.value)} /></CGField>
      </div>
      <div style={{ ...grid, marginTop: 10 }}>
        <CGField label="Operación back-to-back">
          <select style={CG_INP} value={D.b2b} onChange={(e) => S("b2b", e.target.value)}><option>Sí</option><option>No</option></select></CGField>
        <CGField label="Tarifa aplicable">
          <select style={CG_INP} value={D.tarifa} onChange={(e) => S("tarifa", e.target.value)}><option>Tabla vigente</option><option>Especial</option></select></CGField>
        <CGField label="Fecha inicio operación"><input type="date" style={CG_INP} value={D.fechaIni} onChange={(e) => S("fechaIni", e.target.value)} /></CGField>
        <CGField label="Vigencia particular"><input style={CG_INP} value={D.vigencia} onChange={(e) => S("vigencia", e.target.value)} /></CGField>
        <CGField label="Ayudante (valor por defecto)">
          <select style={CG_INP} value={D.ayudante || ""} onChange={(e) => S("ayudante", e.target.value)}>
            <option value="">—</option>{AYUDANTE_LINEA.map((a) => <option key={a}>{a}</option>)}
          </select></CGField>
        <CGField label="SVC (valor por defecto)"><input style={{ ...CG_INP, fontFamily: "monospace" }} value={D.svc} onChange={(e) => S("svc", e.target.value.toUpperCase())} /></CGField>
      </div>
      <div style={{ marginTop: 10 }}>
        <span style={CG_LBL}>Modelos operativos (Anexo A)</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["SDD", "Spot", "Backup"].map((mo) => {
            const on = (D.modelos || []).includes(mo);
            return (
              <span key={mo} onClick={() => S("modelos", on ? D.modelos.filter((x) => x !== mo) : [...(D.modelos || []), mo])}
                style={{ cursor: "pointer", userSelect: "none", borderRadius: 999, padding: "6px 14px", fontSize: 12.5,
                  border: `1.5px solid ${on ? "#7c3aed" : "#ddd0f7"}`, background: on ? "#7c3aed" : "#fff",
                  color: on ? "#fff" : "#555", fontWeight: on ? 700 : 400 }}>{mo}</span>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <span style={CG_LBL}>Líneas operativas del Anexo A · una fila por unidad (máx. 3)</span>
        <div style={{ fontSize: 11, color: "#7c6f96", marginBottom: 6 }}>
          Vienen del Jefe de Operaciones. Lo que falte, complétalo aquí: cada casilla se cruza en el PDF.
        </div>
        {(D.lineas || []).map((l, i) => {
          const falta = (v) => (!v ? { border: "1.5px solid #f0b4b4", background: "#fff6f6" } : null);
          return (
            <div key={i} style={{ border: "1px solid #ede7fb", borderRadius: 10, padding: 10, marginBottom: 8, background: "#fcfaff" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#7c3aed" }}>
                  Línea {i + 1}{l.placa ? ` · ${l.placa}` : ""}
                </span>
                <button onClick={() => setD((p) => ({ ...p, lineas: p.lineas.filter((_, ix) => ix !== i) }))}
                  style={{ border: "none", background: "none", color: "#c0392b", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Quitar</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 8 }}>
                <CGField label="Centro / SVC">
                  <input style={{ ...CG_INP, ...falta(l.svc), fontFamily: "monospace" }} value={l.svc || ""}
                    onChange={(e) => SL(i, "svc", e.target.value.toUpperCase())} placeholder="STX1" /></CGField>
                <CGField label="Modelo">
                  <select style={{ ...CG_INP, ...falta(l.modelo) }} value={l.modelo || ""} onChange={(e) => SL(i, "modelo", e.target.value)}>
                    <option value="">— Modelo —</option>{MODELOS_LINEA.map((m) => <option key={m}>{m}</option>)}
                  </select></CGField>
                <CGField label="Tipo vehículo">
                  <select style={{ ...CG_INP, ...falta(l.tipo) }} value={l.tipo || ""} onChange={(e) => SL(i, "tipo", e.target.value)}>
                    <option value="">— Tipo —</option>{TIPOS_LINEA.map((t) => <option key={t}>{t}</option>)}
                  </select></CGField>
                <CGField label="Cantidad">
                  <input type="number" min="0" style={{ ...CG_INP, ...falta(String(l.n || "").trim()), fontFamily: "monospace" }}
                    value={l.n || ""} onChange={(e) => SL(i, "n", e.target.value)} /></CGField>
                <CGField label="Ayudante / helper">
                  <select style={{ ...CG_INP, ...falta(l.ayudante) }} value={l.ayudante || ""} onChange={(e) => SL(i, "ayudante", e.target.value)}>
                    <option value="">— Ayudante —</option>{AYUDANTE_LINEA.map((a) => <option key={a}>{a}</option>)}
                  </select></CGField>
                <CGField label="Tarifa aplicable">
                  <select style={CG_INP} value={l.tarifa || "Tabla vigente"} onChange={(e) => SL(i, "tarifa", e.target.value)}>
                    {TARIFAS_LINEA.map((t) => <option key={t}>{t}</option>)}
                  </select></CGField>
                <CGField label="Observaciones">
                  <input style={CG_INP} value={l.obs || ""} onChange={(e) => SL(i, "obs", e.target.value)} placeholder="Placa u observación" /></CGField>
              </div>
            </div>
          );
        })}
        {(D.lineas || []).length < 3 && (
          <button onClick={() => setD((p) => ({ ...p, lineas: [...(p.lineas || []), { svc: p.svc || "", modelo: "", tipo: "", n: "1", ayudante: p.ayudante || "", tarifa: p.tarifa || "Tabla vigente", obs: "" }] }))}
            style={{ border: "1.5px dashed #ddd0f7", background: "#faf7ff", color: "#7c3aed", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
            + Agregar línea
          </button>
        )}
      </div>
      {(D.modelos || []).includes("Backup") && (
        <div style={{ marginTop: 12, background: "#fff8f0", border: "1px solid #f5d9b8", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "#b45309", marginBottom: 8, textTransform: "uppercase" }}>🛟 Backup Operativo (A.2)</div>
          <div style={grid}>
            <CGField label="¿Aplica?"><select style={CG_INP} value={D.backup.aplica} onChange={(e) => SB_("aplica", e.target.value)}><option value="">—</option><option>Sí</option><option>No</option></select></CGField>
            <CGField label="SVC"><input style={{ ...CG_INP, fontFamily: "monospace" }} value={D.backup.svc} onChange={(e) => SB_("svc", e.target.value.toUpperCase())} /></CGField>
            <CGField label="Días y horario"><input style={CG_INP} value={D.backup.dias} onChange={(e) => SB_("dias", e.target.value)} /></CGField>
            <CGField label="Tipo de vehículo"><select style={CG_INP} value={D.backup.tipo} onChange={(e) => SB_("tipo", e.target.value)}><option value="">—</option><option>Large Van</option><option>Small Van</option><option>Car</option></select></CGField>
            <CGField label="Costo reconocido por Cliente"><select style={CG_INP} value={D.backup.costo} onChange={(e) => SB_("costo", e.target.value)}><option value="">—</option><option>Sí</option><option>No</option><option>Costo propio BigTicket</option></select></CGField>
            <CGField label="Aprobador interno"><select style={CG_INP} value={D.backup.aprobador} onChange={(e) => SB_("aprobador", e.target.value)}><option value="">—</option><option>Operaciones</option><option>Gerencia</option><option>Finanzas</option></select></CGField>
          </div>
        </div>
      )}
      {faltan.length > 0 && (
        <div style={{ marginTop: 12, background: "#fff6f6", border: "1px solid #f0b4b4", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "#c0392b", marginBottom: 4 }}>
            ⚠️ Falta completar antes de generar el contrato
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#8b3a3a", lineHeight: 1.55 }}>
            {faltan.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
      <button onClick={onGenerar} disabled={generando || faltan.length > 0}
        style={{ width: "100%", marginTop: 12, background: faltan.length ? "#c9c2d8" : "#7c3aed", color: "#fff", border: "none", borderRadius: 10,
          padding: "12px", fontSize: 13.5, fontWeight: 700, cursor: faltan.length ? "not-allowed" : "pointer", opacity: generando ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
        {generando ? "Generando PDF…" : faltan.length ? "Completa los datos marcados para generar el PDF" : "📄 Generar PDF del contrato con estos datos"}
      </button>
    </div>
  );
}


// ─── 🔍 Biggy Vision Vehicular (Fuente B): fotos vs placa declarada ───
function AnalisisVehiculoBiggy({ cert, veh, docs, onActualizado }) {
  const [analizando, setAnalizando] = useState(false);
  const analizar = async () => {
    setAnalizando(true);
    try {
      // Fotos DEL VEHÍCULO desde certificacion_documentos → URLs firmadas.
      // Se excluyen documentos de identidad/papeles (INE, licencia, tarjeta de
      // circulación, comprobantes) para que Biggy analice solo la unidad.
      const esImagen = d => /jpe?g|png|webp/i.test(d.storage_path || "");
      const esPapel = d => /ine|licencia|circulacion|tarjeta|comprobante|curp|rfc/i.test(`${d.tipo_documento || ""} ${d.storage_path || ""}`);
      let fotos = (docs || []).filter(d => esImagen(d) && !esPapel(d));
      if (!fotos.length) fotos = (docs || []).filter(esImagen);   // fallback si el tipado no distingue
      if (!fotos.length) throw new Error("este vehículo no tiene fotos cargadas en su certificación");
      const urls = [];
      for (const f of fotos.slice(0, 4)) {
        const { data } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(f.storage_path, 600);
        if (data?.signedUrl) urls.push(data.signedUrl);
      }
      if (!urls.length) throw new Error("no se pudieron generar los enlaces de las fotos");
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/analizar-vehiculo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuente: "certificacion", id: cert.id, foto_urls: urls,
          placa: veh?.placa || null, modelo_declarado: [veh?.marca, veh?.modelo].filter(Boolean).join(" ") || null }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt.trim()) throw new Error("Biggy Vision no respondió");
      const r = JSON.parse(txt);
      onActualizado({ vehiculo_veredicto: r.veredicto, vehiculo_score: r.score,
        vehiculo_comentario: r.comentario, vehiculo_placa_detectada: r.placa_detectada,
        vehiculo_analizado_at: new Date().toISOString() });
    } catch (e) { alert("No se pudo analizar el vehículo: " + e.message); }
    finally { setAnalizando(false); }
  };

  const v = cert.vehiculo_veredicto;
  const colores = v === "Aprobado" ? ["#dcfce7", "#86efac", "#166534"] : v === "Revisar" ? ["#fef3c7", "#fcd34d", "#92400e"] : ["#fee2e2", "#fca5a5", "#c0392b"];
  return (
    <div className="form-card" style={{ background: "#eef2f7", border: "1px solid #d6def0" }}>
      <div className="form-title" style={{ color: "#1a3a6b" }}>🔍 Biggy Vision Vehicular</div>
      {v ? (
        <div style={{ background: colores[0], border: `1px solid ${colores[1]}`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, color: colores[2] }}>{v === "Aprobado" ? "✅" : v === "Revisar" ? "⚠️" : "❌"} {v}</span>
            {cert.vehiculo_score != null && <span style={{ fontWeight: 800, color: colores[2], marginLeft: "auto" }}>{cert.vehiculo_score}/100</span>}
          </div>
          {cert.vehiculo_placa_detectada && (
            <div style={{ fontSize: 12, color: colores[2], marginBottom: 4 }}>
              Placa detectada en foto: <b style={{ fontFamily: "monospace" }}>{cert.vehiculo_placa_detectada}</b>
              {veh?.placa && <> · declarada: <b style={{ fontFamily: "monospace" }}>{veh.placa}</b></>}
            </div>
          )}
          <div style={{ fontSize: 12.5, color: colores[2], lineHeight: 1.55, fontStyle: "italic" }}>"{cert.vehiculo_comentario}"</div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "#1a3a6b", marginBottom: 10 }}>
          Biggy analiza las fotos del vehículo contra la placa y el modelo declarados. El track <b>REPUVE</b> (Nubarium) valida después los datos oficiales.
        </div>
      )}
      <button onClick={analizar} disabled={analizando}
        style={{ width: "100%", background: v ? "#fff" : "#1a3a6b", color: v ? "#1a3a6b" : "#fff",
          border: "1.5px solid #1a3a6b", borderRadius: 8, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: analizando ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
        {analizando ? "Biggy analizando fotos…" : v ? "↻ Re-analizar con Biggy Vision" : "🔍 Analizar fotos con Biggy Vision"}
      </button>
    </div>
  );
}


// ─── 🚚 Vehículos declarados en la MINUTA (Fuente A) · Biggy Vision por unidad ───
// Fotos capturadas por el supervisor en la entrevista (sección C). El veredicto
// se guarda dentro del jsonb de la minuta (vehiculos[i].vision). En Etapa 5,
// las placas de estas unidades pasan por REPUVE (Nubarium).
function VehiculosMinutaBiggy({ candidato, etapa }) {
  const [minuta, setMinuta] = useState(undefined);   // undefined=cargando · null=sin minuta
  const [analizandoIdx, setAnalizandoIdx] = useState(null);
  const [repuveIdx, setRepuveIdx] = useState(null);
  const enNubarium = etapa === "validacion_nubarium";

  const validarRepuve = async (i) => {
    const v = (Array.isArray(minuta?.vehiculos) ? minuta.vehiculos : [])[i];
    if (!v?.placa) { alert("Esta unidad no tiene placa registrada en la minuta."); return; }
    setRepuveIdx(i);
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/validar-repuve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificacion_id: candidato.id, placa: v.placa, vin: null }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt.trim()) throw new Error("el flujo REPUVE no respondió (¿activo en n8n? ¿acceso Nubarium?)");
      const r = JSON.parse(txt);
      const nuevos = minuta.vehiculos.map((x, ix) => ix === i ? { ...x, repuve: {
        registrado: r.registrado ?? null, estatus_robo: r.estatus_robo ?? null,
        marca: r.marca ?? null, modelo: r.modelo ?? null, anio: r.anio ?? null,
        entidad: r.entidad_emplaco ?? null, at: new Date().toISOString(),
      } } : x);
      const { error } = await sb.from("minutas_entrevista").update({ vehiculos: nuevos }).eq("id", minuta.id);
      if (error) throw new Error("guardando REPUVE: " + error.message);
      setMinuta({ ...minuta, vehiculos: nuevos });
    } catch (e) { alert("No se pudo validar en REPUVE: " + e.message); }
    finally { setRepuveIdx(null); }
  };

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("minutas_entrevista")
        .select("id, vehiculos").eq("fuente", "certificaciones_mx").eq("registro_id", candidato.id)
        .order("created_at", { ascending: false }).limit(1);
      setMinuta((data && data[0]) || null);
    })();
  }, [candidato.id]);

  if (minuta === undefined || minuta === null) return null;
  const vehs = Array.isArray(minuta.vehiculos) ? minuta.vehiculos : [];
  if (!vehs.length) return null;

  const analizar = async (i) => {
    setAnalizandoIdx(i);
    try {
      const v = vehs[i];
      // Prioridad: las 4 fotos más informativas de la unidad (frente, posterior,
      // laterales, placa); interior/odómetro/tarjeta quedan fuera del análisis.
      const ORDEN_SLOTS = ["frente", "posterior", "lat_izq", "lat_der", "placa"];
      const f = v.fotos || {};
      const paths = [...ORDEN_SLOTS.filter(s => f[s]).map(s => f[s]),
                     ...Object.keys(f).filter(s => !ORDEN_SLOTS.includes(s) && s !== "tarjeta").map(s => f[s])];
      if (!paths.length) throw new Error("esta unidad no tiene fotos en la minuta");
      const urls = [];
      for (const p of paths.slice(0, 4)) {
        const { data } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(p, 600);
        if (data?.signedUrl) urls.push(data.signedUrl);
      }
      if (!urls.length) throw new Error("no se pudieron generar los enlaces de las fotos");
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/analizar-vehiculo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuente: "certificacion", id: candidato.id, foto_urls: urls,
          placa: v.placa || null, modelo_declarado: [v.marca, v.tipo].filter(Boolean).join(" ") || null }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt.trim()) throw new Error("Biggy Vision no respondió");
      const r = JSON.parse(txt);
      const nuevos = vehs.map((x, ix) => ix === i ? { ...x, vision: {
        veredicto: r.veredicto, score: r.score, comentario: r.comentario,
        placa_detectada: r.placa_detectada, coincide_placa: r.coincide_placa, at: new Date().toISOString(),
      } } : x);
      const { error } = await sb.from("minutas_entrevista").update({ vehiculos: nuevos }).eq("id", minuta.id);
      if (error) throw new Error("guardando veredicto: " + error.message);
      setMinuta({ ...minuta, vehiculos: nuevos });
    } catch (e) { alert("No se pudo analizar la unidad: " + e.message); }
    finally { setAnalizandoIdx(null); }
  };

  return (
    <div className="form-card" style={{ background: "#eef2f7", border: "1px solid #d6def0" }}>
      <div className="form-title" style={{ color: "#1a3a6b" }}>🚚 Vehículos de la minuta · Biggy Vision por unidad</div>
      {vehs.map((v, i) => {
        const nFotos = Object.keys(v.fotos || {}).length;
        const vi = v.vision;
        const col = vi?.veredicto === "Aprobado" ? ["#dcfce7", "#86efac", "#166534"]
          : vi?.veredicto === "Revisar" ? ["#fef3c7", "#fcd34d", "#92400e"] : ["#fee2e2", "#fca5a5", "#c0392b"];
        return (
          <div key={i} style={{ background: "#fff", border: "1px solid #d6def0", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: vi ? 8 : 0 }}>
              <span style={{ fontWeight: 800, color: "#fff", background: "#1a3a6b", borderRadius: 8, minWidth: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{i + 1}</span>
              <span style={{ fontFamily: "monospace", fontWeight: 700, letterSpacing: ".06em" }}>{(v.placa || "SIN PLACA").toUpperCase()}</span>
              <span style={{ fontSize: 12, color: "#555" }}>{[v.tipo, v.marca].filter(Boolean).join(" · ") || "—"} · {nFotos} foto(s)</span>
              <button onClick={() => analizar(i)} disabled={analizandoIdx !== null || !nFotos}
                style={{ marginLeft: "auto", background: vi ? "#fff" : "#1a3a6b", color: vi ? "#1a3a6b" : "#fff",
                  border: "1.5px solid #1a3a6b", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700,
                  cursor: nFotos ? "pointer" : "not-allowed", opacity: analizandoIdx === i ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                {analizandoIdx === i ? "Analizando…" : vi ? "↻ Re-analizar" : "🔍 Analizar con Biggy Vision"}
              </button>
            </div>
            {vi && (
              <div style={{ background: col[0], border: `1px solid ${col[1]}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, color: col[2], fontSize: 13 }}>{vi.veredicto === "Aprobado" ? "✅" : vi.veredicto === "Revisar" ? "⚠️" : "❌"} {vi.veredicto}</span>
                  {vi.placa_detectada && <span style={{ fontSize: 11.5, color: col[2] }}>placa en foto: <b style={{ fontFamily: "monospace" }}>{vi.placa_detectada}</b>{vi.coincide_placa === false && " · ⚠️ NO coincide"}</span>}
                  {vi.score != null && <span style={{ fontWeight: 800, color: col[2], marginLeft: "auto", fontSize: 13 }}>{vi.score}/100</span>}
                </div>
                <div style={{ fontSize: 12, color: col[2], lineHeight: 1.5, fontStyle: "italic" }}>"{vi.comentario}"</div>
              </div>
            )}
            {enNubarium && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {v.repuve ? (
                  <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "7px 12px",
                    background: (String(v.repuve.estatus_robo || "").toUpperCase().includes("ROBO") && !String(v.repuve.estatus_robo || "").toUpperCase().includes("SIN")) ? "#fee2e2" : "#eafaf0",
                    color: (String(v.repuve.estatus_robo || "").toUpperCase().includes("ROBO") && !String(v.repuve.estatus_robo || "").toUpperCase().includes("SIN")) ? "#c0392b" : "#166534",
                    border: "1px solid currentColor" }}>
                    {(String(v.repuve.estatus_robo || "").toUpperCase().includes("ROBO") && !String(v.repuve.estatus_robo || "").toUpperCase().includes("SIN")) ? "⛔ CON REPORTE DE ROBO" : "✅ REPUVE"}
                    {" · registrado: "}{v.repuve.registrado === true ? "Sí" : v.repuve.registrado === false ? "No" : "—"}
                    {v.repuve.estatus_robo ? ` · ${v.repuve.estatus_robo}` : ""}
                  </span>
                ) : null}
                <button onClick={() => validarRepuve(i)} disabled={repuveIdx !== null}
                  style={{ marginLeft: "auto", background: v.repuve ? "#fff" : "#b45309", color: v.repuve ? "#b45309" : "#fff",
                    border: "1.5px solid #b45309", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", opacity: repuveIdx === i ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                  {repuveIdx === i ? "Consultando…" : v.repuve ? "↻ Re-consultar REPUVE" : "🔎 Validar REPUVE (placa)"}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {!enNubarium && <div style={{ fontSize: 11, color: "#888" }}>En la Etapa 5, cada unidad tendrá su botón de validación <b>REPUVE</b> (reporte de robo) vía Nubarium.</div>}
    </div>
  );
}


// ─── 🔎 Validación REPUVE (Etapa 5 · Nubarium) — placa y reporte de robo ───
function ValidacionRepuve({ cert, veh, onMoverA, onVehActualizado }) {
  const [validando, setValidando] = useState(false);

  const ejecutar = async () => {
    if (!veh?.placa) { alert("Este vehículo no tiene placa registrada."); return; }
    setValidando(true);
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/validar-repuve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificacion_id: cert.id, placa: veh.placa, vin: veh.vin || null }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt.trim()) throw new Error("el flujo REPUVE no respondió (¿está activo en n8n? ¿acceso Nubarium restablecido?)");
      // Releer la fila para reflejar lo guardado
      const { data } = await sb.from("certificacion_vehiculo").select("*").eq("certificacion_id", cert.id).limit(1);
      if (data && data[0]) onVehActualizado(data[0]);
    } catch (e) { alert("No se pudo validar en REPUVE: " + e.message); }
    finally { setValidando(false); }
  };

  const yaValidado = veh?.repuve_raw || veh?.estatus_robo || veh?.repuve_id;
  const conRobo = (veh?.estatus_robo || "").toString().toUpperCase().includes("ROBO") &&
                  !(veh?.estatus_robo || "").toString().toUpperCase().includes("SIN");
  return (
    <div className="form-card" style={{ background: "#fff8f0", border: "1px solid #f5d9b8" }}>
      <div className="form-title" style={{ color: "#b45309" }}>🔎 Etapa 5 · Validación Nubarium (REPUVE)</div>
      <div style={{ fontSize: 13, color: "#7a5a2f", marginBottom: 10 }}>
        Consulta la placa <b style={{ fontFamily: "monospace" }}>{(veh?.placa || "—").toUpperCase()}</b> en el Registro
        Público Vehicular: existencia, datos oficiales y <b>reporte de robo</b>.
      </div>
      {yaValidado && (
        <div style={{ background: conRobo ? "#fee2e2" : "#eafaf0", border: `1px solid ${conRobo ? "#fca5a5" : "#b7e4c7"}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontSize: 12.5, color: conRobo ? "#c0392b" : "#166534" }}>
        <b>{conRobo ? "⛔ CON REPORTE DE ROBO" : "✅ Consulta REPUVE registrada"}</b>
          {" · "}Registrado: <b>{veh.registrado === true ? "Sí" : veh.registrado === false ? "No" : "—"}</b>
          {veh.estatus_robo ? <> · Estatus: <b>{String(veh.estatus_robo)}</b></> : null}
          {veh.marca ? <> · {[veh.marca, veh.modelo, veh.anio].filter(Boolean).join(" ")}</> : null}
          {veh.entidad_emplaco ? <> · {veh.entidad_emplaco}</> : null}
        </div>
      )}
      <button onClick={ejecutar} disabled={validando}
        style={{ width: "100%", background: yaValidado ? "#fff" : "#b45309", color: yaValidado ? "#b45309" : "#fff",
          border: "1.5px solid #b45309", borderRadius: 8, padding: "11px", fontSize: 13, fontWeight: 700,
          cursor: "pointer", opacity: validando ? 0.6 : 1, marginBottom: 10, fontFamily: "'Geist',sans-serif" }}>
        {validando ? "Consultando REPUVE…" : yaValidado ? "↻ Re-consultar REPUVE" : "🔎 Ejecutar validación REPUVE"}
      </button>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => onMoverA("aceptado")} disabled={!yaValidado || conRobo}
          style={{ flex: 1, minWidth: 160, background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "11px", fontSize: 13, fontWeight: 700, cursor: yaValidado && !conRobo ? "pointer" : "not-allowed", opacity: yaValidado && !conRobo ? 1 : 0.45 }}>
          ✓ Certificado → Aceptado
        </button>
        <button onClick={() => { if (confirm("¿Rechazar este vehículo?")) onMoverA("rechazado"); }}
          style={{ flex: 1, minWidth: 160, background: "#fff", color: "#c0392b", border: "1.5px solid #f0c4c4", borderRadius: 8, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          ✕ Rechazar vehículo
        </button>
      </div>
    </div>
  );
}


// ─── 📣 Notificar documentación fallida (WhatsApp / Email) · Etapa Pre-validación Biggy ───
// Los items observados por Biggy se seleccionan y se avisan al tercero por el canal elegido.
function NotificarDocsFallidas({ nombre, telefonoInicial, emailInicial, alertas, fuente, registroId, terceroId, empresa, titulo }) {
  const [abierto, setAbierto] = useState(false);
  const [historial, setHistorial] = useState([]);
  const [verHist, setVerHist] = useState(false);

  const cargarHistorial = async () => {
    if (!fuente || !registroId) return;
    const { data } = await sb.from("notificaciones_terceros")
      .select("id, canal, items, telefono, email, created_at")
      .eq("fuente", fuente).eq("registro_id", registroId)
      .order("created_at", { ascending: false }).limit(20);
    setHistorial(data || []);
  };
  useEffect(() => { cargarHistorial(); }, [registroId]);
  const [sel, setSel] = useState({});            // índice de alerta → seleccionada
  const [extra, setExtra] = useState("");        // observación adicional manual
  const [tel, setTel] = useState(telefonoInicial || "");
  const [mail, setMail] = useState(emailInicial || "");
  const [canal, setCanal] = useState("ambos");   // whatsapp | email | ambos
  const [enviando, setEnviando] = useState(false);
  const [enviadoAt, setEnviadoAt] = useState(null);

  // Fuente B: si la tarjeta no trae contacto, se toma del Perfil de Empresa
  // (perfiles_empresa.fono_contacto / correo_contacto); fallback: email del portal.
  useEffect(() => {
    (async () => {
      if (!terceroId) return;
      if ((telefonoInicial || "").trim() && (emailInicial || "").trim()) return;
      try {
        const { data: perfil } = await sb.from("perfiles_empresa")
          .select("fono_contacto, correo_contacto").eq("tercero_id", terceroId).maybeSingle();
        if (perfil) {
          if (perfil.fono_contacto) setTel((t) => t.trim() ? t : perfil.fono_contacto);
          if (perfil.correo_contacto) setMail((m) => m.trim() ? m : perfil.correo_contacto);
        }
        if (!(perfil && perfil.correo_contacto)) {
          const { data: t } = await sb.from("terceros").select("email_portal").eq("id", terceroId).limit(1);
          const ep = t && t[0] && t[0].email_portal;
          if (ep) setMail((m) => m.trim() ? m : ep);
        }
      } catch (e) { console.warn("Prefill contacto empresa:", e?.message || e); }
    })();
  }, [terceroId]);

  // Convierte una alerta de Biggy (objeto o string) a texto legible para el mensaje
  const alertaATexto = (a) => {
    if (typeof a === "string") return a;
    if (!a || typeof a !== "object") return String(a || "");
    const partes = [];
    if (a.campo) partes.push(String(a.campo).toUpperCase());
    const cuerpo = a.detalle || a.mensaje || "";
    if (cuerpo) partes.push(cuerpo);
    if (!cuerpo && (a.declarado || a.encontrado)) partes.push(`declarado "${a.declarado || "—"}" vs encontrado "${a.encontrado || "—"}"`);
    return partes.join(": ") || JSON.stringify(a);
  };

  const items = () => {
    const l = (alertas || []).filter((_, i) => sel[i]).map(alertaATexto);
    if (extra.trim()) l.push(extra.trim());
    return l;
  };

  const enviar = async () => {
    const lista = items();
    if (!lista.length) { alert("Selecciona al menos un documento/observación a notificar."); return; }
    const necesitaTel = canal !== "email", necesitaMail = canal !== "whatsapp";
    if (necesitaTel && !tel.trim()) { alert("Falta el teléfono (WhatsApp) del tercero."); return; }
    if (necesitaMail && !mail.trim()) { alert("Falta el correo del tercero."); return; }
    if (!confirm(`¿Enviar la notificación por ${canal === "ambos" ? "WhatsApp y correo" : canal} a ${nombre}?`)) return;
    setEnviando(true);
    try {
      // Fuente A y B tienen plantilla WhatsApp, redacción de correo y link de portal
      // distintos → flujos n8n separados.
      const webhook = fuente === "certificaciones"
        ? "https://bigticket2026.app.n8n.cloud/webhook/notificar-doc-fallida-terceros"
        : "https://bigticket2026.app.n8n.cloud/webhook/notificar-doc-fallida";
      const resp = await fetch(webhook, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal, nombre, empresa: empresa || "", titulo: titulo || nombre, telefono: tel.trim(), email: mail.trim(), items: lista }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt.trim()) throw new Error("el servicio de notificación no respondió");
      const r = JSON.parse(txt);
      if (r.ok === false) throw new Error(r.error || "envío rechazado");
      await sb.from("notificaciones_terceros").insert({
        fuente, registro_id: registroId, canal, telefono: tel.trim(), email: mail.trim(),
        items: lista, enviado_por: window.__PERFIL_EMAIL || "",
      });
      // Fuente B: la observación también llega al hilo de Consultas del portal de la empresa
      if (fuente === "certificaciones") {
        try {
          const { data: cr } = await sb.from("certificaciones").select("tercero_id").eq("id", registroId).limit(1);
          const tid = cr && cr[0] && cr[0].tercero_id;
          if (tid) {
            await sb.from("mensajes_terceros").insert({
              tercero_id: tid, autor: "bigticket",
              mensaje: `📣 Observaciones sobre la certificación de ${nombre}:\n\n` +
                lista.map((x, i) => `${i + 1}) ${x}`).join("\n") +
                `\n\nCorrige lo señalado en la sección "Estado de certificación" del portal (reemplaza o carga los documentos observados).`,
            });
          }
        } catch (eMsg) { console.warn("No se pudo dejar el mensaje en Consultas:", eMsg.message); }
      }
      await cargarHistorial();
      setEnviadoAt(new Date());
      setSel({}); setExtra("");
      setAbierto(false);
    } catch (e) { alert("No se pudo notificar: " + e.message); }
    finally { setEnviando(false); }
  };

  return (
    <div className="form-card" style={{ background: "#fdf6ee", border: "1px solid #f0ddc4" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="form-title" style={{ color: "#b45309", marginBottom: 2 }}>📣 Notificar documentación fallida</div>
          <div style={{ fontSize: 12, color: "#8a6a3f" }}>Avisa al tercero por WhatsApp y/o correo qué documentos debe corregir o reponer.</div>
        </div>
        {historial.length > 0 && (
          <button onClick={() => setVerHist(!verHist)}
            style={{ fontSize: 12, fontWeight: 700, color: "#166534", background: "#e8f5ec", border: "1px solid #b7e0c2", borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
            ✓ {historial.length} notificación{historial.length === 1 ? "" : "es"} enviada{historial.length === 1 ? "" : "s"} {verHist ? "▴" : "▾"}
          </button>
        )}
        <button onClick={() => setAbierto(!abierto)}
          style={{ background: abierto ? "#fff" : "#b45309", color: abierto ? "#b45309" : "#fff", border: "1.5px solid #b45309", borderRadius: 8, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
          {abierto ? "Cerrar" : "Notificar"}
        </button>
      </div>
      {verHist && historial.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {historial.map(h => (
            <div key={h.id} style={{ background: "#fff", border: "1px solid #f0ddc4", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: "#8a6a3f", fontWeight: 700, marginBottom: 6 }}>
                <span>{new Date(h.created_at).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span>{h.canal === "ambos" ? "📱 WhatsApp + ✉️ Correo" : h.canal === "whatsapp" ? "📱 WhatsApp" : "✉️ Correo"}</span>
                <span style={{ fontWeight: 400 }}>{[h.canal !== "email" ? h.telefono : null, h.canal !== "whatsapp" ? h.email : null].filter(Boolean).join(" · ")}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(Array.isArray(h.items) ? h.items : []).map((it, i) => (
                  <li key={i} style={{ fontSize: 12, color: "#5a4630", marginBottom: 3 }}>{String(it)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {abierto && (
        <div style={{ marginTop: 12 }}>
          {(alertas || []).length > 0 ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: "#8a6a3f", textTransform: "uppercase", marginBottom: 6 }}>Items observados por Biggy — marca los que se notificarán</div>
              {(alertas || []).map((a, i) => (
                <label key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "flex-start", textAlign: "left", width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 8, background: sel[i] ? "#fff4e0" : "transparent", cursor: "pointer", fontSize: 12.5, color: "#5a4630", marginBottom: 2 }}>
                  {/* width/height explícitos: el CSS global del Brain pone width:100% a los input y desarma el flex */}
                  <input type="checkbox" checked={!!sel[i]} onChange={() => setSel(s => ({ ...s, [i]: !s[i] }))}
                    style={{ width: 16, height: 16, minWidth: 16, maxWidth: 16, flex: "0 0 16px", margin: "2px 0 0 0", padding: 0, accentColor: "#b45309" }} />
                  <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left", lineHeight: 1.5 }}>{typeof a === "string" ? a : (a.detalle || a.mensaje || JSON.stringify(a))}</span>
                </label>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#8a6a3f", marginBottom: 10 }}>Biggy no registró alertas — escribe abajo la observación a notificar.</div>
          )}
          <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={2}
            placeholder="Observación adicional (opcional) — ej. 'La INE está borrosa, súbela de nuevo por el portal'"
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid #f0ddc4", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontFamily: "'Geist',sans-serif", background: "#fff", resize: "vertical", marginBottom: 10 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#8a6a3f", textTransform: "uppercase", marginBottom: 4 }}>📱 WhatsApp del tercero</div>
              <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="+52 1 55 ..." inputMode="tel"
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #f0ddc4", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontFamily: "monospace", background: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#8a6a3f", textTransform: "uppercase", marginBottom: 4 }}>✉️ Correo del tercero</div>
              <input value={mail} onChange={(e) => setMail(e.target.value)} placeholder="correo@…" inputMode="email"
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #f0ddc4", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontFamily: "monospace", background: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#8a6a3f", textTransform: "uppercase", marginBottom: 4 }}>Canal</div>
              <select value={canal} onChange={(e) => setCanal(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #f0ddc4", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontFamily: "'Geist',sans-serif", background: "#fff" }}>
                <option value="ambos">WhatsApp + Correo</option>
                <option value="whatsapp">Solo WhatsApp</option>
                <option value="email">Solo Correo</option>
              </select>
            </div>
          </div>
          <button onClick={enviar} disabled={enviando}
            style={{ width: "100%", background: "#b45309", color: "#fff", border: "none", borderRadius: 8, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: enviando ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
            {enviando ? "Enviando…" : `📣 Enviar notificación (${items().length} item${items().length === 1 ? "" : "s"})`}
          </button>
        </div>
      )}
    </div>
  );
}

function SeccionFirmaContrato({ registro, tabla, datos, onActualizado }) {
  const [enviando, setEnviando] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [D, setD] = useState(null);               // datos consolidados EDITABLES por el analista
  const [contratoGen, setContratoGen] = useState(null);   // { path, url }
  const [firmandoBT, setFirmandoBT] = useState(false);
  const [verificandoFirma, setVerificandoFirma] = useState(false);
  const [avisoFirma, setAvisoFirma] = useState("");
  const docId = registro.mifiel_documento_id;

  // Items que dejó el Jefe de Operaciones, con la marca de su SLA. Se ven
  // aquí para que el analista revise y corrija sin volver a la Etapa 7.
  const [itemsJefe, setItemsJefe] = useState(null);
  const cargarItemsJefe = async () => {
    const { data } = await sb.from("contrato_operacional")
      .select("*").eq("registro_id", registro.id).maybeSingle();
    setItemsJefe(data || null);
  };
  useEffect(() => { cargarItemsJefe(); }, [registro.id]);

  // Relee la tarjeta para saber si el prestador ya firmó desde su portal
  // El botón consulta MIFIEL de verdad (vía n8n) y luego relee la BD.
  // Antes solo leía la BD, que dependía del callback del widget en el
  // navegador del prestador: si firmaba por el correo de MIFIEL, nada se
  // actualizaba nunca (caso Perla, 19-ago-2026).
  const verificarFirmaPrestador = async () => {
    // El spinner arranca ANTES del webhook: la consulta a MIFIEL tarda unos
    // segundos y sin esto el botón parecía muerto hasta que llegaba todo.
    setVerificandoFirma(true); setAvisoFirma("");
    try {
      await fetch("https://bigticket2026.app.n8n.cloud/webhook/sincronizar-firma-flujo-a", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: registro.id }),
      });
    } catch (eSync) { console.warn("Sincronización MIFIEL no disponible:", eSync.message); }
    try {
      const { data, error } = await sb.from(tabla)
        .select("mifiel_firmado_conductor, mifiel_firmado_bigticket")
        .eq("id", registro.id).maybeSingle();
      if (error) throw new Error(error.message);
      if (data?.mifiel_firmado_conductor) {
        onActualizado({ ...registro, ...data });
      } else {
        setAvisoFirma("Aún sin firma del prestador — recuérdale entrar a su portal, sección ✍️ Firma.");
      }
    } catch (e) { setAvisoFirma("No se pudo verificar: " + e.message); }
    finally { setVerificandoFirma(false); }
  };

  // Chequeo automático: mientras se espera la firma del prestador, revisa cada 45 s
  // (además del botón manual) — el aviso verde aparece solo cuando firme.
  useEffect(() => {
    if (!docId || registro.mifiel_firmado_conductor || registro.mifiel_firmado_bigticket) return;
    const t = setInterval(() => { if (!document.hidden) verificarFirmaPrestador(); }, 45000);
    return () => clearInterval(t);
  }, [docId, registro.mifiel_firmado_conductor]);

  // Paso 1: consolidar datos (Jefe > minuta > tarjeta) y abrir el editor
  const prepararContrato = async () => {
    setGenerando(true);
    try {
      const d = await consolidarDatosContrato({ tabla, registro, datos });
      setD(d); setContratoGen(null);
    } catch (e) { alert("No se pudo preparar el contrato: " + e.message); }
    finally { setGenerando(false); }
  };

  // Paso 2: generar el PDF con los datos revisados/editados
  const generarContrato = async () => {
    const faltan = faltantesContrato(D);
    if (faltan.length) {
      alert("El contrato no puede generarse todavía:\n\n• " + faltan.join("\n• ")); return;
    }
    setGenerando(true);
    try {
      const r = await generarContratoPDFDesde(D, { tabla, registro });
      setContratoGen(r);
    } catch (e) { alert("No se pudo generar el contrato: " + e.message); }
    finally { setGenerando(false); }
  };

  // Carga el script del widget de MIFIEL solo cuando se abre la firma embebida
  useEffect(() => { if (firmandoBT) cargarScriptMifiel(); }, [firmandoBT]);

  const enviarAFirma = async () => {
    if (!contratoGen?.url) { alert("Primero genera el contrato para revisarlo."); return; }
    const emailFirmante = (D && D.correo) || datos.email;
    if (!emailFirmante) { alert("El prospecto no tiene email registrado — es necesario para enviar el contrato a firma."); return; }
    if (!confirm(`¿Enviar el contrato de ${datos.nombre} a firma digital de ambas partes?`)) return;
    setEnviando(true);
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/mifiel-crear-contrato", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabla, id: registro.id, archivo_url: contratoGen.url,
          firmante_nombre: (D && (D.rep || D.nombre)) || datos.nombre, firmante_email: emailFirmante,
          nombre: (D && D.nombre) || datos.nombre }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt || !txt.trim()) throw new Error("el servicio de contratos no respondió");
      const r = JSON.parse(txt);
      if (!r.documento_id) throw new Error(r.error || "respuesta sin documento_id");
      const patch = {
        mifiel_documento_id: r.documento_id,
        mifiel_widget_conductor: r.widget_conductor || null,
        mifiel_widget_bigticket: r.widget_bigticket || null,
        contrato_enviado_at: new Date().toISOString(),
      };
      const { error } = await sb.from(tabla).update(patch).eq("id", registro.id);
      if (error) alert("El contrato se creó en MIFIEL pero no se pudo guardar la referencia: " + error.message);
      onActualizado(patch);
    } catch (e) {
      alert("No se pudo enviar a firma: " + e.message);
    } finally { setEnviando(false); }
  };

  const ChipFirma = ({ label, listo }) => (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
      background: listo ? "#e8f5ec" : "#fff", color: listo ? "#166534" : "#7c3aed",
      border: `1px solid ${listo ? "#b7e0c2" : "#ddd0f7"}` }}>
      {listo ? "✓" : "⏳"} {label}
    </span>
  );

  return (
    <div className="form-card" style={{ border: "1px solid #ddd0f7", background: "#f5f0fe" }}>
      <div className="form-title" style={{ color: "#7c3aed" }}>✍️ Etapa 5 · Firma de Contrato</div>

      {!docId ? (
        <>
          <div style={{ fontSize: 13, color: "#4c1d95", lineHeight: 1.6, marginBottom: 12 }}>
            Validado por todos los entes. El Brain generará el contrato con los datos del prospecto
            y lo enviará a firma digital (e.firma) de <b>ambas partes</b>: el prestador y Bigticket.
          </div>
          <div className="three-col" style={{ marginBottom: 12 }}>
            {[["Nombre", datos.nombre], ["CURP", datos.curp], ["RFC", datos.rfc],
              ["Email", datos.email], ["Puesto", datos.puesto], ["SC", datos.sc]].map(([l, v]) => (
              <div key={l} style={{ padding: "6px 0" }}>
                <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase" }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{v || "—"}</div>
              </div>
            ))}
          </div>
          {!D ? (
            <button onClick={prepararContrato} disabled={generando}
              style={{ width: "100%", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10,
                padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: generando ? 0.6 : 1 }}>
              {generando ? "Consolidando datos…" : "📄 Preparar contrato (revisión del analista)"}
            </button>
          ) : (
            <>
              {/* Lo que dejó el Jefe + cumplimiento de su SLA de 24 h */}
              {itemsJefe && (
                <div style={{ background: "#f7f9fc", border: "1px solid #dde5f0", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: ".4px", flex: 1 }}>
                      🏗 Items del Jefe de Operaciones
                    </span>
                    {itemsJefe.completado_at && (
                      <>
                        <span style={{ fontSize: 11.5, color: "#667085" }}>
                          Completado {fMX(itemsJefe.completado_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {itemsJefe.completado_por ? ` · ${itemsJefe.completado_por}` : ""}
                        </span>
                        {itemsJefe.sla_cumplido !== null && itemsJefe.sla_cumplido !== undefined && (
                          <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 20,
                            background: itemsJefe.sla_cumplido ? "#e8f5ec" : "#fbeaea",
                            color: itemsJefe.sla_cumplido ? "#166534" : "#c0392b" }}>
                            {itemsJefe.sla_cumplido ? "✓ SLA 24 h CUMPLIDO" : "✕ SLA 24 h VENCIDO"}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, fontSize: 12 }}>
                    {[["Fecha inicio", itemsJefe.fecha_inicio], ["Esquema tarifa", itemsJefe.esquema_tarifa],
                      ["Tarifa aplicable", itemsJefe.tarifa_aplicable], ["Back-to-back", itemsJefe.back_to_back],
                      ["Vigencia", itemsJefe.vigencia_particular], ["Horario", itemsJefe.horario],
                      ["Choferes", itemsJefe.cantidad_choferes], ["Ayudantes", itemsJefe.cantidad_ayudantes]].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "#98a2b3", textTransform: "uppercase" }}>{k}</div>
                        <div style={{ fontWeight: 600, color: v ? "#1a1a2e" : "#c0392b" }}>{v || "— falta —"}</div>
                      </div>
                    ))}
                  </div>
                  {Array.isArray(itemsJefe.lineas) && itemsJefe.lineas.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid #e6ecf5" }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#98a2b3", textTransform: "uppercase", marginBottom: 4 }}>Líneas del Anexo A</div>
                      {itemsJefe.lineas.map((l, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#33415c" }}>
                          <b>{i + 1}.</b> {l.svc || "—"} · {l.modelo || "— sin modelo —"} · {l.tipo || "— sin tipo —"} · {l.n || "?"} unidad(es) · ayudante {l.ayudante || "—"}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "#8a94a6", marginTop: 9 }}>
                    Si algo viene mal, corrígelo abajo: lo que edites aquí es lo que se estampa en el contrato,
                    sin necesidad de devolverle la tarea al Jefe.
                  </div>
                </div>
              )}

              {/* Sin empresa creada no hay portal ni firma posible */}
              {!registro.tercero_id && (
                <div style={{ background: "#fbeaea", border: "1.5px solid #f0b4b4", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#c0392b", marginBottom: 3 }}>
                    ⚠️ Esta tarjeta no tiene empresa creada
                  </div>
                  <div style={{ fontSize: 12, color: "#8b3a3a", lineHeight: 1.5 }}>
                    Sin empresa no hay portal al cual mandar la firma. Esta tarjeta llegó aquí sin pasar
                    por la creación de credenciales: vuelve a Etapa 7 con «Mover» y usa
                    «🏢 Crear empresa y enviar credenciales».
                  </div>
                </div>
              )}

              {!contratoGen && <EditorContrato D={D} setD={setD} generando={generando} onGenerar={generarContrato} />}
              {contratoGen && (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10,
                    background: "#fff", border: "1px solid #ddd0f7", borderRadius: 10, padding: "10px 12px" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#4c1d95" }}>✅ Contrato generado</span>
                    <a href={contratoGen.url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12.5, fontWeight: 700, color: "#7c3aed" }}>📄 Revisar PDF (Hoja de Firmas, Anexo A y A.2)</a>
                    <button onClick={() => setContratoGen(null)}
                      style={{ marginLeft: "auto", border: "none", background: "none", color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      ✏️ Editar datos y regenerar
                    </button>
                  </div>
                  <button onClick={enviarAFirma} disabled={enviando}
                    style={{ width: "100%", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10,
                      padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: enviando ? 0.6 : 1 }}>
                    {enviando ? "Enviando a MIFIEL…" : "✍️ Enviar a firma digital (ambas partes)"}
                  </button>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "#4c1d95", marginBottom: 10 }}>
            Contrato enviado a firma{registro.contrato_enviado_at ? ` el ${new Date(registro.contrato_enviado_at).toLocaleString("es-CL")}` : ""}.
            La tarjeta pasará sola a <b>Aceptado</b> cuando ambas firmas estén completas.
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <ChipFirma label={`Prestador: ${datos.nombre || "—"}`} listo={!!registro.mifiel_firmado_conductor} />
            <ChipFirma label="Bigticket" listo={!!registro.mifiel_firmado_bigticket} />
          </div>

          {/* ORDEN DE FIRMA: primero el prestador en su portal, después BigTicket.
              El widget BT queda BLOQUEADO hasta que la firma del tercero esté lista. */}
          {!registro.mifiel_firmado_bigticket && !registro.mifiel_firmado_conductor && (
            <div style={{ background: "#fff4e5", border: "1.5px solid #F47B20", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#b45309", marginBottom: 4 }}>⚠️ NO firmar todavía como BigTicket</div>
              <div style={{ fontSize: 12.5, color: "#8a4a0f", lineHeight: 1.55 }}>
                El orden de firma es: <b>1º el prestador</b> desde su portal (sección ✍️ Firma) → <b>2º BigTicket</b>.
                El botón de firma se habilitará automáticamente cuando la firma del prestador esté lista.
              </div>
              <button disabled={verificandoFirma} onClick={verificarFirmaPrestador}
                style={{ marginTop: 10, background: "#fff", color: "#b45309", border: "1.5px solid #b45309", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: verificandoFirma ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                {verificandoFirma ? "Verificando…" : "🔄 Verificar si el prestador ya firmó"}
              </button>
              {avisoFirma && <div style={{ fontSize: 12, color: "#8a4a0f", marginTop: 6, fontWeight: 600 }}>{avisoFirma}</div>}
            </div>
          )}

          {!registro.mifiel_firmado_bigticket && registro.mifiel_firmado_conductor && (
            <div style={{ background: "#e8f5ec", border: "1px solid #b7e0c2", borderRadius: 10, padding: "10px 14px", marginBottom: 10, fontSize: 13, color: "#166534", fontWeight: 700 }}>
              ✅ Firma del prestador lista — ahora corresponde la firma de BigTicket.
            </div>
          )}

          {!registro.mifiel_firmado_bigticket && registro.mifiel_firmado_conductor && registro.mifiel_widget_bigticket && (
            !firmandoBT ? (
              <button onClick={() => setFirmandoBT(true)}
                style={{ width: "100%", background: "#fff", color: "#7c3aed", border: "1.5px solid #ddd0f7",
                  borderRadius: 10, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                ✍️ Firmar como Bigticket (aquí, sin salir del Brain)
              </button>
            ) : (
              <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #ddd0f7", padding: 8, minHeight: 620 }}>
                <mifiel-widget id={registro.mifiel_widget_bigticket} environment={MIFIEL_ENV}></mifiel-widget>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

// ─── CALIFICACIÓN DE LA LLAMADA (guion del supervisor) ───────────────
// Lee lo que el supervisor capturó en la Bitácora con el script oficial
// de calificación de flota: semáforo, filtros duros y respuestas clave.
const CALIF_SEM = {
  verde: { t: "VERDE · CALIFICA", bg: "#e8f5ec", fg: "#166534", bd: "#b7e0c2" },
  amarillo: { t: "AMARILLO · STANDBY", bg: "#fff4e5", fg: "#b45309", bd: "#fcd9b6" },
  rojo: { t: "ROJO · NO CALIFICA", bg: "#fdecea", fg: "#c0392b", bd: "#f5c6c0" },
};
const CALIF_EXP = { sin: "Sin experiencia", menos_1: "Menos de 1 año", "1": "1 año", "2": "2 años", "3_mas": "3 años o más" };

function CalificacionLlamada({ registroId }) {
  const [c, setC] = useState(undefined);
  const [abierto, setAbierto] = useState(false);
  useEffect(() => { (async () => {
    if (!registroId) { setC(null); return; }
    const { data } = await sb.from("calificacion_llamada").select("*")
      .eq("registro_id", registroId).order("actualizado_at", { ascending: false }).limit(1);
    setC((data && data[0]) || null);
  })(); }, [registroId]);

  if (c === undefined) return null;
  if (!c) return (
    <div className="form-card">
      <div className="form-title">📞 Calificación de la llamada</div>
      <div style={{ fontSize: 12, color: "#888" }}>El supervisor aún no ha registrado el guion de calificación en su Bitácora.</div>
    </div>
  );

  const info = CALIF_SEM[c.semaforo] || CALIF_SEM.amarillo;
  const SiNo = (v) => v === true ? "✅ Sí" : v === false ? "❌ No" : "—";
  const filas = [
    ["Nombre confirmado (INE)", SiNo(c.nombre_confirmado)],
    ["Correo validado", SiNo(c.email_validado) + (c.email ? " · " + c.email : "")],
    ["WhatsApp validado", SiNo(c.whatsapp_validado) + (c.telefono ? " · " + c.telefono : "")],
    ["Ciudad / municipio", c.ciudad],
    ["Figura fiscal", c.figura === "moral" ? "Persona moral" + (c.representante_legal ? " · rep: " + c.representante_legal : "") : c.figura === "fisica" ? "Persona física" : null],
    ["Puede emitir factura", SiNo(c.puede_facturar)],
    ["Vehículo propio", SiNo(c.vehiculo_propio) + (c.propietario_tercero ? " · de: " + c.propietario_tercero : "")],
    ["Tipo de unidad", c.tipo_vehiculo === "Otro" ? c.tipo_vehiculo_otro : c.tipo_vehiculo],
    ["Unidades disponibles", c.cantidad_vehiculos],
    ["Detalle de unidades", Array.isArray(c.vehiculos) && c.vehiculos.length
      ? c.vehiculos.map((v, i) => {
          const a = Number(v.anio) > 0 ? new Date().getFullYear() - Number(v.anio) : null;
          return `${i + 1}) ${[v.marca, v.modelo, v.anio].filter(Boolean).join(" ") || "—"}${a != null && a > 15 ? " ⚠️ " + a + " años" : ""}`;
        }).join(" · ")
      : [c.marca, c.modelo, c.anio].filter(Boolean).join(" ")],
    ["Documentos vehiculares al día", SiNo(c.docs_vehiculares_al_dia)],
    ["Disponibilidad CEDIS / horario", SiNo(c.disponibilidad_horario) + (c.cedis ? " · " + c.cedis : "")],
    ["Traslado al CEDIS", c.tiempo_traslado_min != null ? c.tiempo_traslado_min + " min" + (Number(c.tiempo_traslado_min) > 90 ? " ⚠️ riesgo de deserción" : "") : null],
    ["Fecha de arranque", c.fecha_arranque],
    ["Experiencia", (CALIF_EXP[c.experiencia] || "—") + (c.experiencia_empresa ? " · " + c.experiencia_empresa : "") + (c.cedis_previo_meli ? " · CEDIS MELI: " + c.cedis_previo_meli : "")],
    ["Acepta propuesta comercial", SiNo(c.acepta_propuesta)],
  ];

  return (
    <div className="form-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div className="form-title" style={{ marginTop: 0, marginBottom: 0 }}>📞 Calificación de la llamada</div>
        <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 12, background: info.bg, color: info.fg, border: "1px solid " + info.bd }}>{info.t}</span>
        {c.estado !== "completada" && <span style={{ fontSize: 10, fontWeight: 700, color: "#b45309" }}>· borrador</span>}
        <button onClick={() => setAbierto(!abierto)} style={{ marginLeft: "auto", background: "#fff", border: "1px solid #e4e7ec", color: "#1a3a6b", borderRadius: 7, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
          {abierto ? "▾ Ocultar detalle" : "▸ Ver checklist completo"}
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "#475467", lineHeight: 1.6 }}>
        {c.motivo ? <><b>Motivo:</b> {c.motivo}{c.recuperable ? " (recuperable)" : " (definitivo)"} · </> : null}
        {c.supervisor ? <>Registró: {c.supervisor} · </> : null}
        {c.actualizado_at ? new Date(c.actualizado_at).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
      </div>
      {c.observaciones && (
        <div style={{ fontSize: 12.5, color: "#28323f", background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 8, padding: "8px 11px", marginTop: 8 }}>
          <b>Observaciones:</b> {c.observaciones}
        </div>
      )}
      {abierto && (
        <div style={{ marginTop: 10 }}>
          {filas.map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid #f4f5f7", fontSize: 12.5 }}>
              <span style={{ flex: "0 0 220px", color: "#888", fontWeight: 600 }}>{k}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{v || "—"}</span>
            </div>
          ))}
          {c.dudas && <div style={{ fontSize: 12.5, marginTop: 8 }}><b>Dudas del prospecto:</b> {c.dudas}</div>}
        </div>
      )}
    </div>
  );
}

// ─── AVISO DE REVISIÓN INTERNA ───────────────────────────────────────────────
// Aparece cuando MELI declinó al candidato: la tarjeta NO se rechaza sola, queda
// en Revisión Interna y el analista decide. Se muestra en ambos flujos (A y B).
function AvisoRevisionInterna({ registro, onAceptar, onRechazar, moviendo }) {
  const declinado = (registro.estado === "rechazado")
    || /declinad|rechazad|no se recomienda|riesgo/i.test(registro.respuesta_meli || "");
  return (
    <div style={{ background: "#fff4e5", border: "2px solid #F47B20", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: "#b45309", marginBottom: 6 }}>
        ⚠️ MELI recomienda no seguir con el proceso
      </div>
      <div style={{ fontSize: 12.5, color: "#8a4a0f", lineHeight: 1.6 }}>
        {registro.respuesta_meli
          ? <>Respuesta de MELI: <b>{registro.respuesta_meli}</b></>
          : <>MELI declinó al candidato en la validación.</>}
        {registro.fecha_respuesta_meli && (
          <> · {new Date(registro.fecha_respuesta_meli).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>
        )}
        {registro.motivo_rechazo ? <><br />Motivo registrado: {registro.motivo_rechazo}</> : null}
      </div>
      <div style={{ fontSize: 12, color: "#8a4a0f", marginTop: 8, fontStyle: "italic" }}>
        La recomendación de MELI no cierra el caso: revisa la información de arriba y decide.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={onAceptar} disabled={moviendo}
          style={{ flex: 1, minWidth: 190, background: "#166534", color: "#fff", border: "none", borderRadius: 9, padding: "12px", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: moviendo ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
          ✓ Continuar de todas formas → Aceptado
        </button>
        <button onClick={onRechazar} disabled={moviendo}
          style={{ flex: 1, minWidth: 190, background: "#fff", color: "#c0392b", border: "1.5px solid #f0c4c4", borderRadius: 9, padding: "12px", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: moviendo ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
          ✕ Acatar recomendación → Rechazado
        </button>
      </div>
    </div>
  );
}

// ─── EDITOR DE DATOS DEL PROSPECTO ───────────────────────────────────────────
// Permite al analista corregir los datos en CUALQUIER etapa del flujo (A o B).
// Guarda en la tabla/registro que corresponda y refresca la vista.
//   campos: [{ k, label, tipo?, opciones? }]
//   valores: objeto con los valores actuales
//   onGuardar: async (cambios) => void   ← recibe solo lo que cambió
function EditorDatos({ titulo, campos, valores, onGuardar, extra }) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  const abrir = () => {
    const b = {};
    campos.forEach((c) => { b[c.k] = valores[c.k] ?? ""; });
    setBorrador(b); setMsg(null); setEditando(true);
  };

  const guardar = async () => {
    // Solo se envía lo que realmente cambió, para no pisar datos ajenos
    const cambios = {};
    campos.forEach((c) => {
      const antes = valores[c.k] ?? "";
      const ahora = borrador[c.k] ?? "";
      if (String(antes) !== String(ahora)) {
        cambios[c.k] = c.tipo === "number"
          ? (String(ahora).trim() === "" ? null : Number(ahora))
          : (String(ahora).trim() === "" ? null : String(ahora).trim());
      }
    });
    if (!Object.keys(cambios).length) { setEditando(false); return; }
    setGuardando(true); setMsg(null);
    try {
      await onGuardar(cambios);
      setMsg({ ok: true, t: `✅ ${Object.keys(cambios).length} campo(s) actualizado(s).` });
      setEditando(false);
    } catch (e) {
      setMsg({ ok: false, t: "No se pudo guardar: " + e.message });
    } finally { setGuardando(false); }
  };

  const inp = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 13, fontFamily: "'Geist',sans-serif" };

  return (
    <div className="form-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div className="form-title" style={{ marginTop: 0, marginBottom: 0 }}>{titulo}</div>
        {!editando ? (
          <button onClick={abrir}
            style={{ marginLeft: "auto", background: "#fff", border: "1.5px solid #1a3a6b", color: "#1a3a6b", borderRadius: 8, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
            ✎ Editar datos
          </button>
        ) : (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => { setEditando(false); setMsg(null); }} disabled={guardando}
              style={{ background: "#fff", border: "1px solid #e4e7ec", color: "#667085", borderRadius: 8, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
              Cancelar
            </button>
            <button onClick={guardar} disabled={guardando}
              style={{ background: "#166534", border: "none", color: "#fff", borderRadius: 8, padding: "6px 15px", fontSize: 12, fontWeight: 800, cursor: "pointer", opacity: guardando ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
              {guardando ? "Guardando…" : "💾 Guardar"}
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div style={{ marginBottom: 10, fontSize: 12.5, fontWeight: 700, color: msg.ok ? "#166534" : "#c0392b" }}>{msg.t}</div>
      )}

      <div className="three-col">
        {extra}
        {campos.map((c) => (
          <div key={c.k} style={{ padding: "8px 0", borderBottom: "1px solid #f4f5f7" }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{c.label}</div>
            {editando ? (
              c.opciones ? (
                <select style={inp} value={borrador[c.k] ?? ""} onChange={(e) => setBorrador({ ...borrador, [c.k]: e.target.value })}>
                  <option value="">—</option>
                  {c.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input style={inp} type={c.tipo === "number" ? "text" : (c.tipo || "text")}
                  value={borrador[c.k] ?? ""}
                  onChange={(e) => setBorrador({ ...borrador, [c.k]: c.mayus ? e.target.value.toUpperCase() : e.target.value })} />
              )
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{valores[c.k] || "—"}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── EVIDENCIA DE LA ENTREVISTA EN TERRENO ───────────────────────────────────
// Muestra al analista las fotos que subió el supervisor y dónde se hizo la
// entrevista (geolocalización capturada por la Bitácora al guardar la minuta).
const ETIQ_FOTO = {
  frente: "Frente", posterior: "Posterior", lat_izq: "Lateral izq.", lat_der: "Lateral der.",
  placa: "Placa", interior: "Interior", odometro: "Odómetro",
  tarjeta: "Tarjeta de circulación", seguro: "Póliza de seguro", gps: "Instalación GPS",
};

function EvidenciaMinuta({ minuta }) {
  const [urls, setUrls] = useState({});      // path -> url firmada
  const [cargando, setCargando] = useState(false);
  const [zoom, setZoom] = useState(null);    // { url, etiqueta }

  const unidades = Array.isArray(minuta?.vehiculos) ? minuta.vehiculos : [];
  const paths = [];
  unidades.forEach((v) => Object.values(v.fotos || {}).forEach((p) => { if (p) paths.push(p); }));

  useEffect(() => { (async () => {
    if (!paths.length) return;
    setCargando(true);
    const m = {};
    for (const path of paths) {
      // Las fotos de terreno viven en el bucket de la bitácora
      for (const bucket of ["bitacora-cancelaciones-meli", "archivador_empresas", "proceso_certificacion_bt"]) {
        try {
          const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
          if (!error && data?.signedUrl) { m[path] = data.signedUrl; break; }
        } catch (e) { /* siguiente bucket */ }
      }
    }
    setUrls(m); setCargando(false);
  })(); }, [minuta?.id]);

  const geo = minuta?.geo && typeof minuta.geo === "object" ? minuta.geo : null;
  if (!unidades.length && !geo) return null;

  return (
    <div className="form-card">
      <div className="form-title">📷 Evidencia de la entrevista en terreno</div>

      {geo ? (
        <div style={{ background: "#f8fafc", border: "1px solid #eef1f5", borderRadius: 9, padding: "10px 13px", marginBottom: 12, fontSize: 12.5 }}>
          <b>📍 Ubicación de la entrevista:</b>{" "}
          <a href={`https://www.google.com/maps?q=${geo.lat},${geo.lng}`} target="_blank" rel="noreferrer"
            style={{ color: "#1a3a6b", fontWeight: 700 }}>
            {Number(geo.lat).toFixed(6)}, {Number(geo.lng).toFixed(6)} — ver en Google Maps ↗
          </a>
          {geo.precision != null && <span style={{ color: "#667085" }}> · precisión ±{geo.precision} m</span>}
          {geo.at && <span style={{ color: "#667085" }}> · {fMX(geo.at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#b45309", background: "#fff4e5", border: "1px solid #fcd9b6", borderRadius: 9, padding: "9px 12px", marginBottom: 12 }}>
          ⚠️ Sin geolocalización: el supervisor guardó la minuta sin permiso de ubicación.
        </div>
      )}

      {cargando && <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>Cargando fotos…</div>}

      {unidades.map((v, i) => {
        const fotos = Object.entries(v.fotos || {});
        return (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#1a3a6b", marginBottom: 6 }}>
              🚚 {v.placa || `Unidad ${i + 1}`}
              {v.marca ? ` · ${v.marca}` : ""}{v.anio ? ` ${v.anio}` : ""}
              <span style={{ color: "#98a2b3", fontWeight: 600 }}> · {fotos.length} foto(s)</span>
            </div>
            {fotos.length === 0 ? (
              <div style={{ fontSize: 12, color: "#98a2b3" }}>Sin fotos cargadas para esta unidad.</div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {fotos.map(([slot, path]) => (
                  <div key={slot} style={{ width: 128 }}>
                    <div
                      onClick={() => urls[path] && setZoom({ url: urls[path], etiqueta: ETIQ_FOTO[slot] || slot })}
                      style={{ width: 128, height: 96, borderRadius: 8, border: "1px solid #e4e7ec", overflow: "hidden",
                        background: "#f4f5f7", cursor: urls[path] ? "zoom-in" : "default",
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {urls[path]
                        ? <img src={urls[path]} alt={slot} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ fontSize: 10, color: "#98a2b3", textAlign: "center", padding: 6 }}>no disponible</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "#667085", fontWeight: 700, marginTop: 3, textAlign: "center" }}>
                      {ETIQ_FOTO[slot] || slot}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {zoom && (
        <div onClick={() => setZoom(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, padding: 20 }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{zoom.etiqueta} · clic para cerrar</div>
          <img src={zoom.url} alt={zoom.etiqueta} style={{ maxWidth: "92vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 8 }} />
          <a href={zoom.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
            style={{ color: "#9ec5ff", fontSize: 12.5, fontWeight: 700 }}>Abrir en pestaña nueva ↗</a>
        </div>
      )}
    </div>
  );
}

// ─── SLA DE TAREAS (contador + reactivación con justificación) ───────────────
// El mismo cronómetro que ve el supervisor en su Bitácora, para que el analista
// sepa desde el Brain si una tarea está por vencer o ya venció, y pueda
// renovar el plazo dejando constancia del motivo.
function fmtSLA(ms) {
  const neg = ms < 0;
  const t = Math.abs(ms);
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  return (neg ? "-" : "") + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}
function colorSLA(ms) {
  if (ms < 0) return { bg: "#fdecea", fg: "#c0392b", bd: "#f5c6c0" };   // vencido
  if (ms < 6 * 3600000) return { bg: "#fff4e5", fg: "#b45309", bd: "#fcd9b6" }; // por vencer
  return { bg: "#e8f5ec", fg: "#166534", bd: "#b7e0c2" };
}

// Contador compacto para la tarjeta del Kanban
function ChipSLA({ vence }) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);
  if (!vence) return null;
  const ms = new Date(vence).getTime() - ahora;
  const c = colorSLA(ms);
  return (
    <span title={ms < 0 ? "SLA vencido" : "Tiempo restante del SLA"}
      style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 6, background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}>
      ⏱ {fmtSLA(ms)}
    </span>
  );
}

// Panel del detalle: estado del SLA + reactivación con motivo obligatorio
function PanelSLA({ tarea, onReactivado }) {
  const [ahora, setAhora] = useState(Date.now());
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [horas, setHoras] = useState(48);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 60000); return () => clearInterval(t); }, []);

  if (!tarea || tarea.estado !== "pendiente") return null;
  const ms = tarea.sla_vence_at ? new Date(tarea.sla_vence_at).getTime() - ahora : null;
  const c = ms == null ? colorSLA(0) : colorSLA(ms);
  const etiqueta = tarea.tipo_tarea === "entrevista_prospecto" ? "Entrevista de operaciones" : "Llamada del supervisor";

  const reactivar = async () => {
    if (motivo.trim().length < 10) { setMsg({ ok: false, t: "Escribe el motivo (mínimo 10 caracteres)." }); return; }
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await sb.rpc("reactivar_sla_tarea", {
        p_tarea_id: tarea.id, p_motivo: motivo.trim(),
        p_horas: Number(horas) || 48, p_email: window.__PERFIL_EMAIL || "",
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error || "no se pudo reactivar");
      setMsg({ ok: true, t: `✅ Plazo renovado por ${horas} h.` });
      setMotivo(""); setAbierto(false);
      if (onReactivado) await onReactivado();
    } catch (e) { setMsg({ ok: false, t: e.message }); }
    finally { setBusy(false); }
  };

  const inp = { border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 13, fontFamily: "'Geist',sans-serif" };

  return (
    <div style={{ background: c.bg, border: `1.5px solid ${c.bd}`, borderRadius: 10, padding: "12px 15px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: c.fg }}>
          ⏱ {etiqueta}: {ms == null ? "sin plazo definido" : ms < 0 ? `SLA vencido hace ${fmtSLA(ms).replace("-", "")}` : `vence en ${fmtSLA(ms)}`}
        </div>
        <span style={{ fontSize: 11, color: "#667085" }}>
          {tarea.sc ? `· ${tarea.sc}` : ""}{tarea.asignado_a ? ` · ${tarea.asignado_a}` : " · según SC"}
        </span>
        <button onClick={() => setAbierto(!abierto)}
          style={{ marginLeft: "auto", background: "#fff", border: `1.5px solid ${c.fg}`, color: c.fg, borderRadius: 8, padding: "6px 12px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
          {abierto ? "Cancelar" : "🔄 Reactivar plazo"}
        </button>
      </div>

      {abierto && (
        <div style={{ marginTop: 10, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 9, padding: "11px 13px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#667085", textTransform: "uppercase", marginBottom: 5 }}>
            Motivo de la reactivación (obligatorio)
          </div>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
            placeholder="Ej. El prospecto no contestó en los intentos previos; se reagenda contacto para esta semana."
            style={{ ...inp, width: "100%", boxSizing: "border-box", minHeight: 52 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, color: "#667085", fontWeight: 700 }}>Nuevo plazo:</span>
            <select value={horas} onChange={(e) => setHoras(e.target.value)} style={inp}>
              <option value={24}>24 horas</option>
              <option value={48}>48 horas</option>
              <option value={72}>72 horas</option>
              <option value={120}>5 días</option>
            </select>
            <button onClick={reactivar} disabled={busy}
              style={{ marginLeft: "auto", background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: busy ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
              {busy ? "Guardando…" : "Reactivar y registrar"}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: "#98a2b3", marginTop: 7 }}>
            Queda registrado quién reactivó, cuándo, con qué motivo y cuánto llevaba vencida.
          </div>
        </div>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: msg.ok ? "#166534" : "#c0392b" }}>{msg.t}</div>}
    </div>
  );
}

function DetalleCandidato({ candidato, onVolver, onActualizar, onPasarEtapa2 }) {
  const [analizando, setAnalizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [analisis, setAnalisis] = useState(candidato.claude_analisis || null);
  const [score, setScore] = useState(candidato.claude_score_global || null);
  const [recomendacion, setRecomendacion] = useState(candidato.claude_recomendacion || null);
  const [alertas, setAlertas] = useState(candidato.claude_alertas || []);
  const [decidiendo, setDecidiendo] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  // Resolución de la Revisión Interna (posterior al rechazo de MELI)
  // Tarea pendiente asociada (para el SLA y su reactivación)
  const [tareaSLA, setTareaSLA] = useState(null);
  const cargarTareaSLA = async () => {
    const { data } = await sb.from("tareas_supervisor")
      .select("id, tipo_tarea, estado, sc, asignado_a, sla_vence_at")
      .eq("fuente", "certificaciones_mx").eq("registro_id", candidato.id)
      .eq("estado", "pendiente")
      .in("tipo_tarea", ["llamada_prospecto", "entrevista_prospecto"])
      .order("created_at", { ascending: false }).limit(1);
    setTareaSLA((data && data[0]) || null);
  };
  useEffect(() => { cargarTareaSLA(); }, [candidato.id]);

  // Minuta de la entrevista en terreno (para ver fotos y geolocalización)
  const [minutaDet, setMinutaDet] = useState(null);
  useEffect(() => { (async () => {
    const { data } = await sb.from("minutas_entrevista").select("*")
      .eq("fuente", "certificaciones_mx").eq("registro_id", candidato.id)
      .order("created_at", { ascending: false }).limit(1);
    setMinutaDet((data && data[0]) || null);
  })(); }, [candidato.id]);

  // Re-entrevista / re-llamada: la tarea original se ejecutó pero hay que
  // repetirla. Crea una tarea NUEVA copiando SC y contacto de la ejecutada;
  // la vieja queda intacta como historia. Auditado en tareas_reactivaciones.
  const [reactivandoTarea, setReactivandoTarea] = useState(false);
  const reactivarTareaEjecutada = async (tipo) => {
    const etiqueta = tipo === "entrevista_prospecto" ? "la entrevista" : "la llamada del supervisor";
    const motivo = prompt(
      `Repetir ${etiqueta} de este prospecto.\n\n` +
      `Se creará una tarea nueva para el supervisor del SC; la anterior queda como registro.\n\n` +
      `Motivo (mínimo 10 caracteres, queda auditado):`, "");
    if (motivo === null) return;
    setReactivandoTarea(true);
    try {
      const { data, error } = await sb.rpc("reactivar_tarea_supervisor", {
        p_fuente: "certificaciones_mx",
        p_registro_id: String(candidato.id),
        p_tipo_tarea: tipo,
        p_motivo: motivo,
        p_email: window.__PERFIL_EMAIL || "brain",
        p_sla_horas: 24,
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error);
      if (data && data.ya_pendiente) {
        alert("Ya había una tarea pendiente de este tipo — el supervisor ya la tiene en su bitácora, no se duplicó.");
      } else {
        alert(`Tarea creada y visible para el supervisor del SC ${data.sc || ""}. SLA: 24 horas.`);
      }
      await cargarTareaSLA();
    } catch (e) { alert("No se pudo reactivar: " + e.message); }
    finally { setReactivandoTarea(false); }
  };

  // Reactivación desde Stand By: el prospecto vuelve al flujo cuando se necesita
  const [reactivando, setReactivando] = useState(false);
  const reactivarFlujo = async () => {
    if (!confirm("Reactivar el flujo de este prospecto.\n\nPasará a Etapa 3 · Pre Validación Biggy. ¿Continuar?")) return;
    setReactivando(true);
    try {
      const patch = { etapa_kanban: "prevalidacion_biggy", updated_at: new Date().toISOString() };
      const { error } = await sb.from("certificaciones_mx").update(patch).eq("id", candidato.id);
      if (error) throw new Error(error.message);
      onActualizar({ ...candidato, ...patch });
    } catch (e) { alert("No se pudo reactivar: " + e.message); }
    finally { setReactivando(false); }
  };

  const [resolviendoRI, setResolviendoRI] = useState(false);
  const resolverRevisionInterna = async (decision) => {
    const txt = decision === "aceptado"
      ? "Continuar con el proceso a pesar de la recomendación de MELI.\n\n¿Confirmas pasar a ACEPTADO?"
      : "Acatar la recomendación de MELI.\n\n¿Confirmas pasar a RECHAZADO?";
    if (!confirm(txt)) return;
    setResolviendoRI(true);
    try {
      const patch = { etapa_kanban: decision, estado: decision, updated_at: new Date().toISOString() };
      if (decision === "rechazado") {
        patch.motivo_rechazo = "Revisión interna: se acata la recomendación de MELI"
          + (candidato.respuesta_meli ? " (" + candidato.respuesta_meli + ")" : "");
      }
      const { error } = await sb.from("certificaciones_mx").update(patch).eq("id", candidato.id);
      if (error) throw new Error(error.message);
      onActualizar({ ...candidato, ...patch });
    } catch (e) { alert("No se pudo resolver la revisión: " + e.message); }
    finally { setResolviendoRI(false); }
  };

  // Biggy corre automático al abrir SOLO si la tarjeta ya está en Etapa 2+ y no tiene análisis.
  // En Etapa 1 (recepción) NO corre — ahí solo se visualiza.
  useEffect(() => {
    if (!["recepcion", "llamada_supervisor"].includes(etapaProspeccion(candidato)) && !candidato.claude_analisis && !analisis && !analizando) {
      analizarConClaude();
    }
  }, [candidato.id]);

  const analizarConClaude = async () => {
    setAnalizando(true);
    try {
      const docs = [
        { url: candidato.url_curp,     tipo: "CURP",           esPDF: candidato.url_curp?.includes(".pdf") },
        { url: candidato.url_ine,      tipo: "INE (delantera)", esPDF: false },
        { url: candidato.url_ine_2,    tipo: "INE (trasera)",   esPDF: false },
        { url: candidato.url_licencia, tipo: "Licencia",        esPDF: candidato.url_licencia?.includes(".pdf") },
        { url: candidato.url_rfc,      tipo: "RFC",             esPDF: candidato.url_rfc?.includes(".pdf") },
      ].filter(f => f.url);

      if (docs.length === 0) { setAnalizando(false); return; }

      const contenido = [];
      contenido.push({
        type: "text",
        text: `Eres un experto en verificación de documentos de identidad mexicanos.
Analiza los documentos del prospecto y responde ÚNICAMENTE con un JSON válido, sin texto adicional ni bloques de código.

DATOS DECLARADOS:
- Nombre: ${candidato.nombre}
- CURP: ${candidato.curp}
- RFC: ${candidato.rfc}
- No. INE: ${candidato.ine}
- Licencia: ${candidato.licencia || "No proporcionó"}
- Puesto: ${candidato.puesto}

Responde con este JSON exacto:
{
  "score_global": <número 1-10>,
  "recomendacion": "APROBAR" o "REVISAR" o "RECHAZAR",
  "documentos": {
    "ine":      { "score": <1-10>, "numero_extraido": "", "nombre_extraido": "", "observaciones": "" },
    "curp":     { "score": <1-10>, "curp_extraido": "",   "nombre_extraido": "", "observaciones": "" },
    "rfc":      { "score": <1-10>, "rfc_extraido": "",    "nombre_extraido": "", "observaciones": "" },
    "licencia": { "score": <1-10>, "numero_extraido": "", "nombre_extraido": "", "observaciones": "" }
  },
  "alertas": [
    { "campo": "", "declarado": "", "encontrado": "", "nivel": "ALTA" o "MEDIA" o "BAJA" }
  ],
  "resumen": "<conclusión breve 1-2 oraciones>"
}`
      });

      for (const d of docs) {
        contenido.push({ type: "text", text: `--- ${d.tipo} ---` });
        if (d.esPDF) {
          contenido.push({ type: "document", source: { type: "url", url: d.url }, title: d.tipo });
        } else {
          contenido.push({ type: "image", source: { type: "url", url: d.url } });
        }
      }

      const response = await fetch("https://bigticket2026.app.n8n.cloud/webhook/analizar-documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...candidato })
      });

      const rawText = await response.text();
      console.log("🔍 Respuesta N8N:", rawText.substring(0, 500));
      if (!rawText || rawText.trim() === "") throw new Error("N8N devolvió respuesta vacía");
      const data = JSON.parse(rawText);
      const parsed = data.analisis;
      if (!parsed) throw new Error("Sin análisis — respuesta: " + rawText.substring(0, 200));

      setAnalisis(parsed);
      setScore(parsed.score_global);
      setRecomendacion(parsed.recomendacion);
      setAlertas(parsed.alertas || []);

      const { error: errSave } = await sb.from("certificaciones_mx").update({
        claude_analisis: parsed,
        claude_score_global: parsed.score_global,
        claude_recomendacion: parsed.recomendacion,
        claude_alertas: parsed.alertas || [],
        claude_reviewed_at: new Date().toISOString(),
      }).eq("id", candidato.id);
      if (errSave) { console.error("No se pudo guardar el análisis Biggy:", errSave.message); alert("El análisis se generó pero NO se pudo guardar: " + errSave.message + "\n\n(¿faltan las columnas claude_* en certificaciones_mx?)"); }

      onActualizar({ ...candidato, claude_analisis: parsed, claude_score_global: parsed.score_global, claude_recomendacion: parsed.recomendacion, claude_alertas: parsed.alertas || [] });
    } catch (e) {
      console.error("Error Claude:", e.message);
      setAnalisis({ _error: true, resumen: "No se pudo conectar con el servicio de análisis. Intenta de nuevo." });
    } finally {
      setAnalizando(false);
    }
  };

  const enviarAMeli = async () => {
    if (!confirm(`¿Enviar a Meli la certificación de ${candidato.nombre}?`)) return;
    setEnviando(true);
    const now = new Date().toISOString();
    try {
      let valorLicencia = candidato.licencia || "";
      const puesto = (candidato.puesto || "").toLowerCase();
      if (puesto === "ayudante" || puesto === "auxiliar") valorLicencia = "Auxiliar";
      else if (puesto === "dispatcher") valorLicencia = "Dispatcher";

      // ✅ Abrir Google Form pre-rellenado — Google bloquea envíos automáticos desde servidores
      function encode(v) { return encodeURIComponent(v || ""); }
      const nombreMayus = (candidato.nombre || "").toUpperCase();
      const svcFinal = (candidato.svc || "").split("_").pop();

      const prefilledUrl = [
        "https://docs.google.com/forms/d/e/1FAIpQLSfKqWuSMBNwRcp-bJpqiSU8ZAFAPCGB3qTkfiMT2jk_8PVGzw/viewform",
        `?entry.1418110277=${encode(nombreMayus)}`,
        `&entry.715792240=${encode(candidato.curp_validado || candidato.curp)}`,
        `&entry.1927588691=Last+mile`,
        `&entry.1391555266=Big+Ticket`,
        `&entry.1422784112=${encode(svcFinal)}`,
        `&entry.1912583612=${encode(valorLicencia)}`,
        `&entry.137537185=MLP`,
      ].join("");

      window.open(prefilledUrl, "_blank");

      // ✅ Marcar como enviado en Supabase
      await sb.from("certificaciones_mx")
        .update({ estado: "enviado", fecha_envio_meli: now })
        .eq("id", candidato.id);

      onActualizar({ ...candidato, estado: "enviado", fecha_envio_meli: now });
      alert("✅ Formulario abierto con los datos pre-rellenados.\n\nVerifica que estés con la cuenta certificacionbigticketmx@gmail.com y haz clic en Enviar.");
    } catch (e) {
      alert("Error al enviar: " + e.message);
    } finally {
      setEnviando(false);
    }
  };

  const decidir = async (nuevoEstado, motivoTxt = "") => {
    setDecidiendo(true);
    const now = new Date().toISOString();
    try {
      const patch = { estado: nuevoEstado, decidido_at: now, etapa_kanban: ETAPA_MX[nuevoEstado] || null };
      if (nuevoEstado === "rechazado") patch.motivo_rechazo = motivoTxt;
      await sb.from("certificaciones_mx").update(patch).eq("id", candidato.id);
      onActualizar({ ...candidato, ...patch });
    } catch (e) {
      alert("Error al guardar la decisión: " + e.message);
    } finally {
      setDecidiendo(false);
      setRechazando(false);
      setMotivo("");
    }
  };

  const estadoBadge = { pendiente: "badge-pendiente", enviado: "badge-enviado", aprobado: "badge-aprobado", en_entrevista: "badge-enviado", alta_solicitada: "badge-enviado", en_firma: "badge-enviado", aceptado: "badge-aprobado", rechazado: "badge-rechazado" };

  const tieneAnalisis = !!(analisis || candidato.claude_analisis);
  const etapaActual = etapaProspeccion(candidato);
  const enEtapa1 = etapaActual === "recepcion";
  const enLlamada = etapaActual === "llamada_supervisor";

  return (
    <div>
      <div style={{ background: "#fff", borderBottom: "0.5px solid #e4e7ec", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 9 }}>
        <button className="btn-back" onClick={onVolver}>← Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{candidato.nombre}</div>
          <div style={{ fontSize: 12, color: "#888" }}>
            {candidato.svc} · {candidato.puesto}
            {candidato.created_at && <> · 🗓 ingresó al flujo el {fMX(candidato.created_at, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} <span style={{ color: "#b0b7c3" }}>(hora de México)</span></>}
          </div>
        </div>
        <span className={`badge ${estadoBadge[candidato.estado]}`}>{candidato.estado?.toUpperCase()}</span>
      </div>

      <div className="pg-detail">
        {/* Etapa 1: visualización + botón a Llamada de Supervisor (auto a los 30 s).
            Etapa 2: espera de decisión del supervisor. Etapa 3+: Biggy corre automático. */}
        {enEtapa1 ? (
          <div className="form-card" style={{ background: "#fff4ec", border: "1px solid #fbd9c0" }}>
            <div style={{ fontSize: 13, color: "#7c3a12", lineHeight: 1.6, marginBottom: 12 }}>
              Este postulante está en <b>Etapa 1 · Recepción</b>. A los 30 segundos pasa solo a <b>Etapa 2 · Llamada de Supervisor</b> (se genera la tarea en la Bitácora), o puedes pasarlo ahora:
            </div>
            <button className="btn-orange" onClick={onPasarEtapa2} style={{ width: "100%" }}>
              ▶ Pasar a Etapa 2 · Llamada de Supervisor
            </button>
          </div>
        ) : enLlamada ? (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 13, color: "#0e7490", lineHeight: 1.6 }}>
              📞 <b>Etapa 2 · Llamada de Supervisor.</b> Hay una tarea pendiente en la Bitácora del Supervisor (SLA 48 h).
              Si el supervisor acepta, la tarjeta pasa sola a <b>Pre Validación Biggy</b> con su comentario; si rechaza, pasa a <b>Rechazado</b>.
            </div>
          </div>
        ) : (
          <BiggyChatBubble analizando={analizando} analisis={analisis} score={score} recomendacion={recomendacion} alertas={alertas} onReanalizar={analizarConClaude} />
        )}

        {candidato.cambios_pendientes && (
          <div className="form-card" style={{ background: "#fff4e5", border: "1.5px solid #F47B20" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <div className="form-title" style={{ color: "#b45309", margin: 0 }}>⚠ El prospecto actualizó su postulación desde el portal</div>
              <button onClick={async () => {
                // Deja constancia de la revisión: en la bitácora de la tarjeta y en el
                // Historial de postulación del portal (lead_historial → timeline).
                const log = [...(candidato.cambios_prospecto || []), { tipo: "revision", accion: "revisado_por_analista", at: new Date().toISOString() }];
                await sb.from("certificaciones_mx").update({ cambios_pendientes: false, cambios_prospecto: log }).eq("id", candidato.id);
                if (candidato.lead_crm_id) {
                  const { error } = await sb.from("lead_historial").insert({
                    lead_id: candidato.lead_crm_id,
                    etapa_anterior: "Cambios del prospecto",
                    etapa_nueva: "Cambios leídos y revisados por el analista",
                  });
                  if (error) console.warn("lead_historial:", error.message);
                }
                onActualizar({ ...candidato, cambios_pendientes: false, cambios_prospecto: log });
              }} style={{ marginLeft: "auto", background: "#fff", color: "#b45309", border: "1.5px solid #b45309", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                ✓ Marcar como revisado
              </button>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(candidato.cambios_prospecto || []).slice(-8).reverse().map((c, i) => (
                c.tipo === "revision" ? (
                  <li key={i} style={{ fontSize: 12.5, color: "#166534", marginBottom: 4, fontWeight: 700 }}>
                    <b>{new Date(c.at).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</b>
                    {" · "}✅ Cambios revisados por el analista
                  </li>
                ) : (
                <li key={i} style={{ fontSize: 12.5, color: "#8a4a0f", marginBottom: 4 }}>
                  <b>{new Date(c.at).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</b>
                  {" · "}{c.tipo === "documento" ? `📎 ${c.campo}: ${c.accion}` : `✏️ ${c.campo}: "${c.antes}" → "${c.despues}"`}
                </li>
                )
              ))}
            </ul>
            <div style={{ fontSize: 11.5, color: "#8a6a3f", marginTop: 8 }}>Revisa los documentos/datos actualizados — si corresponde, re-corre el análisis de Biggy.</div>
          </div>
        )}

        {candidato.etapa_kanban === "prevalidacion_biggy" && (
          <NotificarDocsFallidas nombre={candidato.nombre} telefonoInicial={candidato.telefono} emailInicial={candidato.email} alertas={alertas} fuente="certificaciones_mx" registroId={candidato.id} />
        )}

        {!enEtapa1 && !enLlamada && <VehiculosMinutaBiggy candidato={candidato} etapa={candidato.etapa_kanban} />}

        {candidato.comentario_supervisor && !enEtapa1 && !enLlamada && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0e7490", marginBottom: 4 }}>📞 Comentario del supervisor</div>
            <div style={{ fontSize: 13, color: "#155e70", lineHeight: 1.5 }}>{candidato.comentario_supervisor}</div>
          </div>
        )}

        {/* Stand By: prospecto válido que aún no se necesita */}
        {etapaProspeccion(candidato) === "stand_by" && (
          <div style={{ background: "#fff8ef", border: "2px solid #F47B20", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: "#b45309", marginBottom: 6 }}>
              ⏸ En Stand By — prospecto válido, aún no requerido
            </div>
            <div style={{ fontSize: 12.5, color: "#8a4a0f", lineHeight: 1.6 }}>
              El supervisor lo dejó en espera; la información queda intacta y el flujo se puede reactivar en cualquier momento.
              {candidato.comentario_supervisor && <><br />Motivo: <b>{candidato.comentario_supervisor}</b></>}
            </div>
            <button onClick={reactivarFlujo} disabled={reactivando}
              style={{ marginTop: 12, width: "100%", background: "#F47B20", color: "#fff", border: "none", borderRadius: 9, padding: "12px", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: reactivando ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
              {reactivando ? "Reactivando…" : "▶ Reactivar flujo → Pre Validación Biggy"}
            </button>
          </div>
        )}

        {/* Revisión Interna: MELI declinó y el analista decide */}
        {etapaProspeccion(candidato) === "revision_interna" && (
          <AvisoRevisionInterna registro={candidato} moviendo={resolviendoRI}
            onAceptar={() => resolverRevisionInterna("aceptado")}
            onRechazar={() => resolverRevisionInterna("rechazado")} />
        )}

        {/* Calificación de la llamada del supervisor (guion oficial) */}
        <CalificacionLlamada registroId={candidato.id} />

        {/* SLA de la tarea pendiente + reactivación con motivo */}
        <PanelSLA tarea={tareaSLA} onReactivado={cargarTareaSLA} />


        {/* Repetir una tarea YA EJECUTADA (entrevista o llamada). Solo se
            ofrece cuando no hay tarea pendiente: si hay una viva, el
            supervisor ya la tiene y crear otra duplicaría trabajo. */}
        {!tareaSLA && ["entrevista_operaciones", "llamada_supervisor", "solicitud_alta"].includes(etapaProspeccion(candidato)) && (
          <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: 16, marginTop: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0e7490", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>
              🔁 Repetir tarea del supervisor
            </div>
            <div style={{ fontSize: 12.5, color: "#667085", lineHeight: 1.6, marginBottom: 10 }}>
              La tarea anterior ya se ejecutó. Si hubo un error y hay que repetirla, esto crea una
              tarea nueva en la bitácora del supervisor del SC (la original queda como registro).
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => reactivarTareaEjecutada("entrevista_prospecto")} disabled={reactivandoTarea}
                style={{ flex: 1, minWidth: 180, background: "#0e7490", color: "#fff", border: "none", borderRadius: 9, padding: "11px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: reactivandoTarea ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                {reactivandoTarea ? "Creando…" : "🔁 Repetir entrevista"}
              </button>
              <button onClick={() => reactivarTareaEjecutada("llamada_prospecto")} disabled={reactivandoTarea}
                style={{ flex: 1, minWidth: 180, background: "#fff", color: "#0e7490", border: "1.5px solid #0e7490", borderRadius: 9, padding: "11px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: reactivandoTarea ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                🔁 Repetir llamada
              </button>
            </div>
          </div>
        )}

        {/* Evidencia de la entrevista: fotos del supervisor + geolocalización.
            Aparece desde la etapa de entrevista, cuando ya existe la minuta. */}
        {minutaDet && <EvidenciaMinuta minuta={minutaDet} />}

        {/* Datos del candidato — editables por el analista en cualquier etapa */}
        <EditorDatos
          titulo="Datos del candidato"
          valores={candidato}
          campos={[
            { k: "nombre", label: "Nombre" },
            { k: "curp", label: "CURP", mayus: true },
            { k: "rfc", label: "RFC", mayus: true },
            { k: "ine", label: "INE" },
            { k: "licencia", label: "Licencia" },
            { k: "puesto", label: "Puesto" },
            { k: "svc", label: "SVC", mayus: true },
            { k: "email", label: "Email" },
            { k: "telefono", label: "Teléfono" },
            { k: "cantidad_vehiculos", label: "Vehículos a presentar", tipo: "number" },
            { k: "tipo_vehiculo", label: "Tipo de vehículo", opciones: ["Small Van", "Large Van", "Car Sedán", "Otro"] },
            { k: "empresa", label: "Empresa" },
          ]}
          onGuardar={async (cambios) => {
            const { error } = await sb.from("certificaciones_mx")
              .update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", candidato.id);
            if (error) throw new Error(error.message);
            onActualizar({ ...candidato, ...cambios });
          }} />

        {/* Comparativa de datos (solo cuando ya hay análisis) */}
        {tieneAnalisis && <ComparativaDatos candidato={candidato} analisis={analisis} />}

        {/* Validación Nubarium — solo en Etapa 4 (aprobado por MELI) + informe RHCHECK confidencial */}
        {candidato.estado === "aprobado" && (
          <>
            <ValidacionNubarium candidato={candidato} onActualizar={onActualizar} />
            <InformeRHCheck fuente="certificaciones_mx" registroId={candidato.id} terceroId={candidato.tercero_id || null}
              titulo={candidato.nombre} pathInicial={candidato.rhcheck_informe_path}
              onCambio={(p) => onActualizar({ ...candidato, rhcheck_informe_path: p })} />
          </>
        )}

        {/* Documentos — el analista puede ver, reemplazar, eliminar y cargar (mismas columnas url_* que el portal) */}
        <div className="form-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div className="form-title" style={{ margin: 0 }}>Documentos</div>
            <button className="btn-blue" onClick={analizarConClaude} disabled={analizando} style={{ fontSize: 12, padding: "7px 14px" }}>
              {analizando ? "Analizando..." : "🔄 Re-analizar"}
            </button>
          </div>
          <GestorDocsProspecto candidato={candidato} onActualizar={onActualizar} />
        </div>

        {/* Certificación MELI — oculto en Etapas 1 y 2 (aún no pre-validado por Biggy) */}
        {!enEtapa1 && !enLlamada && (
        <div className="form-card">
          <div className="form-title">Certificación Mercado Libre</div>
          <div className="two-col" style={{ marginBottom: 16 }}>
            {[
              ["Estado", <span className={`badge ${estadoBadge[candidato.estado]}`}>{candidato.estado?.toUpperCase()}</span>],
              ["Fecha envío", candidato.fecha_envio_meli ? new Date(candidato.fecha_envio_meli).toLocaleString("es-CL") : "—"],
              ["Fecha respuesta", candidato.fecha_respuesta_meli ? new Date(candidato.fecha_respuesta_meli).toLocaleString("es-CL") : "—"],
              ["Respuesta Meli", candidato.respuesta_meli || "Pendiente"],
            ].map(([l, v]) => (
              <div key={l} style={{ padding: "8px 12px", background: "#f8f9fa", borderRadius: 8 }}>
                <div style={{ fontSize: 10, color: "#888", fontWeight: 700, marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 16px", marginBottom: 16, border: "1px solid #bae6fd", fontSize: 12, color: "#555", lineHeight: 2 }}>
            <div style={{ fontWeight: 700, color: "#0369a1", marginBottom: 6 }}>Datos a enviar al formulario Meli</div>
            <div>📧 Correo: <strong>certificacionbigticketmx@gmail.com</strong></div>
            <div>👤 Nombre: <strong>{candidato.nombre}</strong></div>
            <div>🪪 CURP: <strong>{candidato.curp_validado || candidato.curp}</strong></div>
            <div>🏢 MLP: <strong>Big Ticket</strong></div>
            <div>📍 SVC: <strong>{candidato.svc}</strong></div>
            <div>🚚 Tramo: <strong>Last mile</strong></div>
            <div>📄 Licencia/Puesto: <strong>{candidato.puesto === "Auxiliar" || candidato.puesto === "Ayudante" ? "Auxiliar" : candidato.puesto === "Dispatcher" ? "Dispatcher" : candidato.licencia}</strong></div>
            <div>🏷️ Capacidad: <strong>MLP</strong></div>
          </div>

          {candidato.estado === "pendiente" && (
            <button className="btn-orange" onClick={enviarAMeli} disabled={enviando} style={{ width: "100%" }}>
              {enviando ? "Enviando..." : "📤 Enviar certificación a Mercado Libre"}
            </button>
          )}
          {candidato.estado === "enviado" && (
            <div style={{ background: "#dbeafe", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#1e40af", fontWeight: 600 }}>
              ⏳ Esperando respuesta de Meli (hasta 72 hrs)
            </div>
          )}
          {candidato.estado === "aprobado" && (
            <div>
              <div style={{ background: "#e0f2fe", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#0369a1", fontWeight: 700, marginBottom: 12 }}>
                ✅ Aprobado por Mercado Libre — revisa el informe Nubarium y decide
              </div>
              {!rechazando ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => decidir("en_entrevista")} disabled={decidiendo}
                    style={{ flex: 1, background: "#16a34a", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: decidiendo ? 0.6 : 1 }}>
                    {decidiendo ? "Guardando..." : "✓ Aceptar → Entrevista con Operaciones"}
                  </button>
                  <button onClick={() => setRechazando(true)} disabled={decidiendo}
                    style={{ flex: 1, background: "#fff", color: "#dc2626", border: "1.5px solid #fca5a5", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    ✕ Rechazar
                  </button>
                </div>
              ) : (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#c0392b", marginBottom: 8 }}>Motivo del rechazo (obligatorio)</div>
                  <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} autoFocus
                    placeholder="Ej.: CURP no coincide con el INE / RFC en lista 69-B / documento ilegible…"
                    style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginBottom: 10 }} />
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={() => { if (!motivo.trim()) { alert("El motivo es obligatorio."); return; } decidir("rechazado", motivo.trim()); }} disabled={decidiendo}
                      style={{ flex: 1, background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: decidiendo ? 0.6 : 1 }}>
                      {decidiendo ? "Guardando..." : "Confirmar rechazo"}
                    </button>
                    <button onClick={() => { setRechazando(false); setMotivo(""); }} disabled={decidiendo}
                      style={{ background: "#fff", color: "#555", border: "1px solid #e4e7ec", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {candidato.estado === "aceptado" && (
            <div style={{ background: "#dcfce7", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#166534", fontWeight: 700 }}>
              ✅ Aceptado — validado por MELI y Nubarium, contrato firmado
            </div>
          )}
          {candidato.estado === "rechazado" && (
            <div style={{ background: "#fee2e2", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#c0392b", fontWeight: 700 }}>
              ❌ Certificación rechazada — {candidato.motivo_rechazo || candidato.respuesta_meli}
            </div>
          )}
        </div>
        )}

        {candidato.estado === "en_entrevista" && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 13, color: "#0e7490", lineHeight: 1.6 }}>
              🗣 <b>Etapa 6 · Entrevista con Operaciones.</b> Se generó la tarea <b>"Entrevista Prospección"</b> en la Bitácora del Supervisor (SLA 72 h).
              El supervisor llenará la minuta de entrevista: si aprueba, la tarjeta pasa a <b>Solicitud de Alta</b>; si rechaza, a <b>Rechazado</b>.
            </div>
          </div>
        )}
        {candidato.estado === "alta_solicitada" && (
          <ResumenSolicitudAlta fuente="certificaciones_mx" registro={candidato}
            datos={{ nombre: candidato.nombre, rfc: candidato.rfc, email: candidato.email }}
            onEnviado={(patch) => onActualizar({ ...candidato, ...patch })} />
        )}
        {candidato.comentario_entrevista && ["alta_solicitada", "en_firma", "aceptado"].includes(candidato.estado) && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0e7490", marginBottom: 4 }}>🗣 Comentario de la entrevista (Operaciones)</div>
            <div style={{ fontSize: 13, color: "#155e70", lineHeight: 1.5 }}>{candidato.comentario_entrevista}</div>
          </div>
        )}

        {candidato.estado === "en_firma" && (
          <SeccionFirmaContrato registro={candidato} tabla="certificaciones_mx"
            datos={{ nombre: candidato.nombre, curp: candidato.curp_validado || candidato.curp, rfc: candidato.rfc,
              email: candidato.email, puesto: candidato.puesto || "Driver", sc: candidato.svc, placa: null }}
            onActualizado={(patch) => onActualizar({ ...candidato, ...patch })} />
        )}
      </div>
    </div>
  );
}

const FUENTE_CFG = {
  prospeccion: { label: "Prospección",  icon: "🎯", bg: "#eef2f7", color: "#1a3a6b", border: "#d6def0" },
  portal_cert: { label: "Portal Cert.", icon: "🏢", bg: "#fff4ec", color: "#F47B20", border: "#fbd9c0" },
};

// Distintivo cuando la certificación nace de la app del tercero
const ORIGEN_CFG = {
  app_terceros: { label: "App Terceros", icon: "📱", bg: "#eef1f5", color: "#334155", border: "#cbd5e1" },
};
// Badge de fuente para una tarjeta, distinguiendo el origen app.
function fuenteBadge(card) {
  if (card.fuente === "portal_cert" && card.origen === "app_terceros") return ORIGEN_CFG.app_terceros;
  return FUENTE_CFG[card.fuente] || FUENTE_CFG.prospeccion;
}
// Etiquetas legibles de los documentos guardados en certificacion_documentos
const DOC_LABEL = {
  ine: "INE (frente)", ine_reverso: "INE (reverso)", curp: "CURP", rfc: "RFC", licencia: "Licencia",
  tarjeta_circulacion: "Tarjeta de circulación", comprobante: "Comprobante", poliza_seguro: "Póliza de seguro",
  foto_frente: "Foto — frente", foto_trasera: "Foto — trasera",
  foto_lado_izq: "Foto — lado izquierdo", foto_lado_der: "Foto — lado derecho", otro: "Otro",
};
// Documentos antiguos del portal quedaron con sufijo _timestamp en el tipo — se limpia solo para mostrar/matchear.
const docTipoLimpioCert = (t) => String(t || "").replace(/_\d{10,}$/, "");
const docEtiquetaCert = (t) => DOC_LABEL[docTipoLimpioCert(t)] || docTipoLimpioCert(t).replace(/_/g, " ");
const fmtFH = (x) => x ? new Date(x).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
// Tipos disponibles al cargar un documento nuevo desde el Brain (Fuente B)
const TIPOS_DOC_CERT = ["ine", "ine_reverso", "curp", "rfc", "licencia", "foto_frente", "foto_trasera", "foto_lado_izq", "foto_lado_der", "tarjeta_circulacion", "poliza_seguro", "comprobante", "otro"];

// Inserta/actualiza en certificacion_documentos con REINTENTO MINIMAL: si las
// columnas nuevas (subido_por/updated_at de docs_certificacion_v2.sql) aún no
// existen o una policy las rechaza, reintenta solo con las columnas base para
// que el registro nunca se pierda en silencio.
async function insDocCert(fila) {
  let r = await sb.from("certificacion_documentos").insert(fila).select("*");
  if (r.error) {
    const min = Array.isArray(fila)
      ? fila.map((f) => ({ certificacion_id: f.certificacion_id, tipo_documento: f.tipo_documento, storage_path: f.storage_path }))
      : { certificacion_id: fila.certificacion_id, tipo_documento: fila.tipo_documento, storage_path: fila.storage_path };
    console.warn("insert certificacion_documentos (completo) falló:", r.error.message, "— reintento minimal");
    r = await sb.from("certificacion_documentos").insert(min).select("*");
  }
  return r;
}
async function updDocCert(id, patch, patchMin) {
  let r = await sb.from("certificacion_documentos").update(patch).eq("id", id);
  if (r.error) {
    console.warn("update certificacion_documentos (completo) falló:", r.error.message, "— reintento minimal");
    r = await sb.from("certificacion_documentos").update(patchMin).eq("id", id);
  }
  return r;
}
// Elimina un objeto de un bucket. El trigger protect_delete puede bloquear el
// DELETE incluso vía Storage API — en ese caso se MUEVE a papelera/ (move =
// rename/UPDATE, no dispara el trigger) para que desaparezca del listado.
async function quitarDeStorage(bucket, path) {
  const { data: rm, error: eRm } = await sb.storage.from(bucket).remove([path]);
  if (!eRm && Array.isArray(rm) && rm.length > 0) return;
  const { error: eMv } = await sb.storage.from(bucket).move(path, `papelera/${path}`);
  if (eMv) throw new Error((eRm?.message || "delete bloqueado (protect_delete)") + " · papelera: " + eMv.message);
}
async function quitarDeStorageCert(path) { return quitarDeStorage("proceso_certificacion_bt", path); }

// ─── 🔒 INFORME RHCHECK (Etapa Nubarium · ambas fuentes) ────────────
// El analista de RHCHECK sube su informe PDF. Es CONFIDENCIAL: queda en el
// bucket privado archivador_empresas y, si la tarjeta tiene empresa, se indexa
// en documentos_empresa con confidencial=true — el Portal de Terceros filtra
// esa marca y la categoría, así el tercero NUNCA lo ve ni lo descarga.
function InformeRHCheck({ fuente, registroId, terceroId, titulo, pathInicial, onCambio }) {
  const [path, setPath] = useState(pathInicial || null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const tabla = fuente === "certificaciones" ? "certificaciones" : "certificaciones_mx";

  const ver = async () => {
    const { data } = await sb.storage.from("archivador_empresas").createSignedUrl(path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else alert("No se pudo abrir el informe.");
  };

  const subir = async (file) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("El informe RHCHECK debe ser un PDF."); return;
    }
    setBusy(true);
    try {
      const base = terceroId ? `${terceroId}/rhcheck` : `prospectos/${registroId}/rhcheck`;
      const p = `${base}/RHCHECK_${Date.now()}.pdf`;
      const { error: eUp } = await sb.storage.from("archivador_empresas")
        .upload(p, file, { contentType: "application/pdf", upsert: false });
      if (eUp) throw new Error(eUp.message);
      const { error: eUpd } = await sb.from(tabla).update({ rhcheck_informe_path: p }).eq("id", registroId);
      if (eUpd) throw new Error("El PDF subió pero no se registró en la tarjeta (¿falta rhcheck_confidencial.sql?): " + eUpd.message);
      if (terceroId) {
        // Indexa en el archivador digital de la empresa. OJO: si falla por falta de la
        // columna `confidencial`, NO se reintenta sin ella — quedaría visible al portal.
        const { error: eIns } = await sb.from("documentos_empresa").insert({
          tercero_id: terceroId, categoria: "rhcheck", nombre_archivo: file.name,
          storage_path: p, bucket: "archivador_empresas", mime_type: "application/pdf",
          tamano_bytes: file.size, referencia: (titulo || "").slice(0, 120) || null,
          subido_por: window.__PERFIL_EMAIL || "analista_brain", origen: "brain",
          confidencial: true,
        });
        if (eIns) alert("El informe quedó guardado en la tarjeta, pero NO se indexó en el archivador: " + eIns.message + "\n\nCorre rhcheck_confidencial.sql y vuelve a cargarlo para indexarlo.");
      }
      // Retira la versión anterior (archivo + índice) para no dejar copias sueltas
      if (path && path !== p) {
        try { await quitarDeStorage("archivador_empresas", path); } catch (e) { console.warn("Versión anterior no retirada:", e.message); }
        try { await sb.from("documentos_empresa").delete().eq("storage_path", path); } catch (e) { /* sin índice previo */ }
      }
      setPath(p);
      if (onCambio) onCambio(p);
    } catch (e) { alert("No se pudo cargar el informe: " + e.message); }
    finally { setBusy(false); }
  };

  const eliminar = async () => {
    if (!confirm("¿Eliminar el informe RHCHECK? Se retira del archivador y de la tarjeta.")) return;
    setBusy(true);
    try {
      await quitarDeStorage("archivador_empresas", path);
      try { await sb.from("documentos_empresa").delete().eq("storage_path", path); } catch (e) { /* sin índice */ }
      const { error } = await sb.from(tabla).update({ rhcheck_informe_path: null }).eq("id", registroId);
      if (error) throw new Error(error.message);
      setPath(null);
      if (onCambio) onCambio(null);
    } catch (e) { alert("No se pudo eliminar: " + e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="form-card" style={{ border: "1.5px solid #b45309", background: "#fdf6ee" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="form-title" style={{ color: "#b45309", margin: 0 }}>🔒 Informe RHCHECK <span style={{ fontSize: 11, fontWeight: 500 }}>· confidencial</span></div>
          <div style={{ fontSize: 11.5, color: "#8a6a3f", marginTop: 3 }}>
            Solo visible y descargable para BigTicket — el tercero <b>nunca</b> lo ve en su portal ni en sus documentos.
            {terceroId ? " Queda indexado en el archivador digital de la empresa." : " Sin empresa creada aún: queda en la tarjeta; al crear la empresa (E7) se podrá archivar."}
          </div>
        </div>
        {path ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#166534", background: "#e8f5ec", border: "1px solid #b7e0c2", borderRadius: 20, padding: "5px 12px" }}>✓ Informe cargado</span>
            <button style={_btnDoc} onClick={ver} disabled={busy}>Ver</button>
            <button style={_btnDoc} onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>{busy ? "…" : "Reemplazar"}</button>
            <button style={_btnDocRojo} onClick={eliminar} disabled={busy}>Eliminar</button>
          </div>
        ) : (
          <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
            style={{ border: "2px dashed #b45309", background: "#fff", color: "#b45309", fontWeight: 700, fontSize: 12.5, borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
            {busy ? "Subiendo…" : "📄 Cargar informe RHCHECK (PDF)"}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) subir(f); }} />
    </div>
  );
}

// Chip de TIPO
// El resultado de Biggy se muestra desde la Etapa 3 en adelante. Si el análisis
// se generó antes (algún proceso lo dispara al crearse la tarjeta), queda
// guardado y se reutiliza: al pasar a Etapa 3 se muestra sin correr de nuevo.
const ETAPAS_SIN_NOTA_BIGGY = ["recepcion", "llamada_supervisor", "stand_by"];


const TIPO_CFG = {
  conductor: { label: "Driver",   icon: "🚗", bg: "#f1f3f5", color: "#334155", border: "#dee2e6" },
  ayudante:  { label: "Ayudante", icon: "🧰", bg: "#f1f3f5", color: "#334155", border: "#dee2e6" },
  vehiculo:  { label: "Vehículo", icon: "🚚", bg: "#f1f3f5", color: "#334155", border: "#dee2e6" },
};

// Mapeo estado crudo → etapa del Kanban (columna)
// OJO: estado "rechazado" NO significa etapa Rechazado. Cuando MELI declina, la
// tarjeta pasa a REVISIÓN INTERNA y es el analista quien decide Aceptado o
// Rechazado. Solo si el analista ya movió la tarjeta se respeta su decisión.
const ETAPA_MX   = { pendiente: "recepcion", enviado: "validacion_meli", aprobado: "validacion_nubarium", en_entrevista: "entrevista_operaciones", alta_solicitada: "solicitud_alta", en_firma: "firma_contrato", aceptado: "aceptado", rechazado: "revision_interna" };
const ETAPA_CERT = { enviado: "recepcion", en_validacion: "validacion_meli", validado: "aceptado", con_alertas: "aceptado", certificado: "aceptado", rechazado: "revision_interna" };

// Etapa de un prospecto (Fuente A). "pendiente" se divide: sin análisis de Biggy → Recepción;
// con análisis cacheado → Etapa 2 (Pre Validación Biggy).
function etapaProspeccion(row) {
  // Si el analista ya resolvió la Revisión Interna, su decisión es definitiva
  if (["aceptado", "rechazado"].includes(row.etapa_kanban)) return row.etapa_kanban;
  if (row.etapa_kanban === "revision_interna") return "revision_interna";
  const base = ETAPA_MX[row.estado] || "recepcion";
  // estados definidos (enviado/aprobado/aceptado/rechazado) mandan → automatización
  if (base !== "recepcion") return base;
  // estado "pendiente" → Etapas 1/2/3: usa el movimiento guardado si existe
  if (["recepcion", "llamada_supervisor", "stand_by", "prevalidacion_biggy"].includes(row.etapa_kanban)) return row.etapa_kanban;
  return row.claude_analisis ? "prevalidacion_biggy" : "recepcion";
}

// PostgREST devuelve el embed 1:1 como objeto o como array de 1 — normalizamos.
const _one = (x) => Array.isArray(x) ? (x[0] || null) : (x || null);

// Fuente A · certificaciones_mx (Prospección) — sólo personas, sin placa
function normalizarProspeccion(row) {
  const puesto = (row.puesto || "").toLowerCase();
  const tipo = (puesto === "ayudante" || puesto === "auxiliar") ? "ayudante" : "conductor";
  return {
    key:    `mx-${row.id}`,
    id:     row.id,
    fuente: "prospeccion",
    tipo,
    titulo: row.nombre || "Sin nombre",
    empresa: row.empresa || null,
    creado: row.created_at || null,
    sc:     row.svc || "—",
    etapa:  etapaProspeccion(row),
    score:  row.claude_score_global ?? null,
    rec:    row.claude_recomendacion || null,
    estado_raw: row.estado,
    raw: row,
  };
}

// Etapa de una tarjeta Fuente B. La automatización de MELI (RPC del correo)
// actualiza estado + fecha_respuesta_meli pero puede no tocar etapa_kanban; como
// etapa_kanban persiste los movimientos manuales, tendría prioridad y la tarjeta
// quedaría "clavada" en Validación MELI. Regla: si ya hay resolución y la tarjeta
// sigue parada en MELI, el estado resuelto manda (aprobado → Etapa 5 · Nubarium,
// rechazado → Rechazado). Movimientos manuales posteriores siguen ganando.
function etapaPortalCert(row) {
  // La decisión del analista (Aceptado / Rechazado) siempre manda
  if (["aceptado", "rechazado", "revision_interna", "stand_by"].includes(row.etapa_kanban)) return row.etapa_kanban;
  // MELI declinó → Revisión Interna (no Rechazado directo)
  const resuelto = { aprobado: "validacion_nubarium", rechazado: "revision_interna" }[row.estado];
  if (resuelto && row.fecha_respuesta_meli && (!row.etapa_kanban || row.etapa_kanban === "validacion_meli")) return resuelto;
  return row.etapa_kanban || ETAPA_CERT[row.estado] || "recepcion";
}

// Fuente B · certificaciones + detalle (Portal de Prospección interno)
function normalizarPortalCert(row) {
  const cond = _one(row.certificacion_conductor);
  const veh  = _one(row.certificacion_vehiculo);
  const ter  = _one(row.terceros);
  const esVeh = row.tipo === "vehiculo";
  return {
    key:    `cert-${row.id}`,
    id:     row.id,
    creado: row.created_at || null,
    fuente: "portal_cert",
    origen: row.origen || "portal_web",
    tipo:   row.tipo || "conductor",
    titulo: esVeh ? (veh?.placa || "Sin placa") : (cond?.nombre || ter?.nombre || "Sin nombre"),
    empresa: ter?.nombre || null,
    sc:     row.service_center || ter?.service_center || "—",
    etapa:  etapaPortalCert(row),
    score:  row.claude_score_global ?? null,
    rec:    row.claude_recomendacion || null,
    estado_raw: row.estado,
    raw: { ...row, _conductor: cond, _vehiculo: veh, _tercero: ter },
  };
}

// Resumen de postulación (read-only) para tarjetas del Portal de Certificación.
// DetalleCandidato (certificaciones_mx) sigue intacto para la otra fuente.
function DetalleCertificacion({ cert, etapa, onVolver, onPasarEtapa2, onMoverA, onAnalizado }) {
  const [docsCert, setDocsCert] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [analisis, setAnalisis] = useState(cert.claude_analisis || null);
  const [score, setScore] = useState(cert.claude_score_global || null);
  const [recomendacion, setRecomendacion] = useState(cert.claude_recomendacion || null);
  const [alertas, setAlertas] = useState(cert.claude_alertas || []);
  const [enviando, setEnviando] = useState(false);

  const etapaActual = etapa || etapaPortalCert(cert);
  const enEtapa1 = etapaActual === "recepcion";
  const enLlamada = etapaActual === "llamada_supervisor";
  const enEtapa2 = etapaActual === "prevalidacion_biggy";
  const esVeh = cert.tipo === "vehiculo";
  // Los registros hijos viven en cert.raw (así los deja normalizarPortalCert);
  // se aceptan ambas rutas por compatibilidad con vistas que los pasan planos.
  const cond = cert._conductor || cert.raw?._conductor || null;
  const veh  = cert._vehiculo  || cert.raw?._vehiculo  || null;
  const ter  = cert._tercero   || cert.raw?._tercero   || null;
  const titulo = esVeh ? (veh?.placa || "Sin placa") : (cond?.nombre || ter?.nombre || "Sin nombre");
  const tc = TIPO_CFG[cert.tipo] || TIPO_CFG.conductor;
  const fcFuente = cert.origen === "app_terceros" ? ORIGEN_CFG.app_terceros : FUENTE_CFG.portal_cert;

  const docsReq = useRef(0);
  const [docsSinIndexar, setDocsSinIndexar] = useState(0);
  const cargarDocsCert = async () => {
    const req = ++docsReq.current;
    try {
      const { data } = await sb.from("certificacion_documentos")
        .select("*").eq("certificacion_id", cert.id); // sin .order: la tabla puede no tener created_at (se ordena en cliente)
      let rows = data || [];
      let sinIndexar = 0;

      // STORAGE ES LA FUENTE DE VERDAD: siempre se lista la carpeta de la
      // certificación y se fusiona con la tabla. Los archivos sin fila (el portal
      // viejo insertaba en silencio y podía fallar) se intentan indexar; si el
      // insert falla (columna faltante, policy), se muestran IGUAL como documentos
      // "virtuales" directo desde Storage — el analista nunca se queda ciego.
      if (cert.tercero_id) {
        try {
          const carpeta = `${cert.tercero_id}/${cert.id}`;
          const { data: files, error: eList } = await sb.storage.from("proceso_certificacion_bt").list(carpeta, { limit: 200 });
          if (eList) throw new Error(eList.message);
          const conocidos = new Set(rows.map((r) => r.storage_path));
          const huerfanos = (files || []).filter((f) => f.name && f.id && !conocidos.has(`${carpeta}/${f.name}`));
          if (huerfanos.length) {
            const nuevos = huerfanos.map((f) => ({
              certificacion_id: cert.id,
              tipo_documento: docTipoLimpioCert(f.name.replace(/\.[^.]+$/, "")) || "otro",
              storage_path: `${carpeta}/${f.name}`,
              subido_por: "reindex_brain",
              ...(f.created_at ? { created_at: f.created_at } : {}),
            }));
            const { data: ins, error: eIns } = await insDocCert(nuevos);
            if (!eIns && ins?.length) {
              rows = [...rows, ...ins];
            } else {
              if (eIns) console.warn("Re-index certificacion_documentos:", eIns.message);
              sinIndexar = huerfanos.length;
              rows = [...rows, ...huerfanos.map((f) => ({
                id: `v:${carpeta}/${f.name}`,
                _virtual: true,
                certificacion_id: cert.id,
                tipo_documento: docTipoLimpioCert(f.name.replace(/\.[^.]+$/, "")) || "otro",
                storage_path: `${carpeta}/${f.name}`,
                created_at: f.created_at || null,
                subido_por: "portal · sin indexar",
              }))];
            }
          }
        } catch (e) { console.warn("Listado Storage:", e?.message || e); }
      }

      rows = [...rows].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      const conUrl = await Promise.all(rows.map(async (d) => {
        let url = "";
        try {
          const { data: sg } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(d.storage_path, 3600);
          url = sg?.signedUrl || "";
        } catch (e) { /* documento sin URL */ }
        return { ...d, url };
      }));
      if (req === docsReq.current) { setDocsCert(conUrl); setDocsSinIndexar(sinIndexar); }
    } catch (e) { if (req === docsReq.current) setDocsCert([]); }
  };
  useEffect(() => { setDocsCert(null); cargarDocsCert(); }, [cert.id]);

  // URL firmada del documento más reciente de un tipo (para Nubarium/Biggy)
  const urlDocDe = (t) => {
    const r = [...(docsCert || [])].reverse().find((d) => docTipoLimpioCert(d.tipo_documento) === t);
    return r?.url || "";
  };

  // Biggy (Claude Vision) para conductores/ayudantes de App/Portal.
  // Reusa el mismo webhook mapeando los documentos del portal a los campos esperados.
  const analizarCert = async (docs) => {
    // Matchea por tipo LIMPIO (docs viejos tienen sufijo _timestamp) y prefiere la carga más reciente
    const urlDe = (t) => { const r = [...docs].reverse().find(d => docTipoLimpioCert(d.tipo_documento) === t); return r?.url || ""; };
    setAnalizando(true);
    try {
      const payload = {
        id: cert.id,
        nombre: cond?.nombre || ter?.nombre || "", curp: cond?.curp || "", rfc: cond?.rfc || "",
        ine: "", licencia: cond?.licencia_numero || "", puesto: cert.tipo === "ayudante" ? "Ayudante" : "Driver",
        url_curp: urlDe("curp"), url_ine: urlDe("ine"), url_ine_2: urlDe("ine_reverso"),
        url_licencia: urlDe("licencia"), url_rfc: urlDe("rfc"),
      };
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/analizar-documentos", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const txt = await resp.text();
      if (!txt || !txt.trim()) throw new Error("respuesta vacía");
      const parsed = JSON.parse(txt).analisis;
      if (!parsed) throw new Error("sin análisis");
      setAnalisis(parsed); setScore(parsed.score_global); setRecomendacion(parsed.recomendacion); setAlertas(parsed.alertas || []);
      const { error: errSave } = await sb.from("certificaciones").update({
        claude_analisis: parsed, claude_score_global: parsed.score_global,
        claude_recomendacion: parsed.recomendacion, claude_alertas: parsed.alertas || [], claude_reviewed_at: new Date().toISOString(),
      }).eq("id", cert.id);
      if (errSave) alert("⚠ El análisis corrió pero NO quedó guardado — corre biggy_fuente_b.sql.\n\n" + errSave.message);
      else Object.assign(cert, { claude_analisis: parsed, claude_score_global: parsed.score_global, claude_recomendacion: parsed.recomendacion, claude_alertas: parsed.alertas || [] });
      if (onAnalizado) onAnalizado(parsed);
    } catch (e) {
      setAnalisis({ _error: true, resumen: "No se pudo conectar con el servicio de análisis." });
    } finally { setAnalizando(false); }
  };

  // Auto-Biggy al abrir en Etapa 2+ (solo personas), si no hay análisis cacheado.
  // Resolución de la Revisión Interna (posterior al rechazo de MELI)
  // Tarea pendiente asociada (para el SLA y su reactivación)
  const [tareaSLA, setTareaSLA] = useState(null);
  const cargarTareaSLA = async () => {
    const { data } = await sb.from("tareas_supervisor")
      .select("id, tipo_tarea, estado, sc, asignado_a, sla_vence_at")
      .eq("fuente", "certificaciones").eq("registro_id", cert.id)
      .eq("estado", "pendiente")
      .in("tipo_tarea", ["llamada_prospecto", "entrevista_prospecto"])
      .order("created_at", { ascending: false }).limit(1);
    setTareaSLA((data && data[0]) || null);
  };
  useEffect(() => { cargarTareaSLA(); }, [cert.id]);

  // Re-entrevista / re-llamada: la tarea original se ejecutó pero hay que
  // repetirla. Crea una tarea NUEVA copiando SC y contacto de la ejecutada;
  // la vieja queda intacta como historia. Auditado en tareas_reactivaciones.
  const [reactivandoTarea, setReactivandoTarea] = useState(false);
  const reactivarTareaEjecutada = async (tipo) => {
    const etiqueta = tipo === "entrevista_prospecto" ? "la entrevista" : "la llamada del supervisor";
    const motivo = prompt(
      `Repetir ${etiqueta} de este prospecto.\n\n` +
      `Se creará una tarea nueva para el supervisor del SC; la anterior queda como registro.\n\n` +
      `Motivo (mínimo 10 caracteres, queda auditado):`, "");
    if (motivo === null) return;
    setReactivandoTarea(true);
    try {
      const { data, error } = await sb.rpc("reactivar_tarea_supervisor", {
        p_fuente: "certificaciones",
        p_registro_id: String(cert.id),
        p_tipo_tarea: tipo,
        p_motivo: motivo,
        p_email: window.__PERFIL_EMAIL || "brain",
        p_sla_horas: 24,
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error);
      if (data && data.ya_pendiente) {
        alert("Ya había una tarea pendiente de este tipo — el supervisor ya la tiene en su bitácora, no se duplicó.");
      } else {
        alert(`Tarea creada y visible para el supervisor del SC ${data.sc || ""}. SLA: 24 horas.`);
      }
      await cargarTareaSLA();
    } catch (e) { alert("No se pudo reactivar: " + e.message); }
    finally { setReactivandoTarea(false); }
  };

  // Reactivación desde Stand By: el prospecto vuelve al flujo cuando se necesita
  const [reactivando, setReactivando] = useState(false);
  const reactivarFlujo = async () => {
    if (!confirm("Reactivar el flujo de este prospecto.\n\nPasará a Etapa 3 · Pre Validación Biggy. ¿Continuar?")) return;
    setReactivando(true);
    try {
      const patch = { etapa_kanban: "prevalidacion_biggy", updated_at: new Date().toISOString() };
      const { error } = await sb.from("certificaciones").update(patch).eq("id", cert.id);
      if (error) throw new Error(error.message);
      Object.assign(cert, patch);
      if (onMoverA) onMoverA("prevalidacion_biggy"); else onVolver();
    } catch (e) { alert("No se pudo reactivar: " + e.message); }
    finally { setReactivando(false); }
  };

  const [resolviendoRI, setResolviendoRI] = useState(false);
  const resolverRevisionInterna = async (decision) => {
    const txt = decision === "aceptado"
      ? "Continuar con el proceso a pesar de la recomendación de MELI.\n\n¿Confirmas pasar a ACEPTADO?"
      : "Acatar la recomendación de MELI.\n\n¿Confirmas pasar a RECHAZADO?";
    if (!confirm(txt)) return;
    setResolviendoRI(true);
    try {
      const patch = { etapa_kanban: decision, updated_at: new Date().toISOString() };
      const { error } = await sb.from("certificaciones").update(patch).eq("id", cert.id);
      if (error) throw new Error(error.message);
      Object.assign(cert, patch);
      if (onMoverA) onMoverA(decision);
      else onVolver();
    } catch (e) { alert("No se pudo resolver la revisión: " + e.message); }
    finally { setResolviendoRI(false); }
  };

  // REGLA ESTRICTA (igual que Fuente A): Biggy corre automático ÚNICAMENTE en la
  // etapa "Pre-validación Biggy", una sola vez, y solo si hay documentos y no
  // existe un análisis guardado. En cualquier otra etapa (incluido Rechazado)
  // JAMÁS corre — solo se muestra el resultado ya obtenido desde claude_*.
  const biggyDisparado = useRef(false);
  useEffect(() => {
    const yaGuardado = !!(cert.claude_analisis || cert.claude_reviewed_at);
    if (
      etapaActual === "prevalidacion_biggy" &&
      !esVeh &&
      !yaGuardado && !analisis && !analizando &&
      !biggyDisparado.current &&
      Array.isArray(docsCert) && docsCert.length > 0
    ) {
      biggyDisparado.current = true;
      analizarCert(docsCert);
    }
  }, [docsCert]);

  // Envío a MELI (mismo formulario pre-rellenado que Prospección). Solo conductores/ayudantes.
  const enviarCertAMeli = async () => {
    if (!confirm(`¿Enviar a MELI la certificación de ${cond?.nombre || "este conductor"}?`)) return;
    setEnviando(true);
    try {
      const encode = (v) => encodeURIComponent(v || "");
      const valorLicencia = cert.tipo === "ayudante" ? "Auxiliar" : (cond?.licencia_numero || "");
      const svcFinal = (cert.service_center || ter?.service_center || "").split("_").pop();
      const url = [
        "https://docs.google.com/forms/d/e/1FAIpQLSfKqWuSMBNwRcp-bJpqiSU8ZAFAPCGB3qTkfiMT2jk_8PVGzw/viewform",
        `?entry.1418110277=${encode((cond?.nombre || "").toUpperCase())}`,
        `&entry.715792240=${encode(cond?.curp)}`,
        `&entry.1927588691=Last+mile`,
        `&entry.1391555266=Big+Ticket`,
        `&entry.1422784112=${encode(svcFinal)}`,
        `&entry.1912583612=${encode(valorLicencia)}`,
        `&entry.137537185=MLP`,
      ].join("");
      window.open(url, "_blank");
      await sb.from("certificaciones").update({ fecha_envio_meli: new Date().toISOString() }).eq("id", cert.id);
      cert.fecha_envio_meli = new Date().toISOString();
      alert("✅ Formulario abierto con los datos pre-rellenados.\n\nVerifica que estés con la cuenta certificacionbigticketmx@gmail.com y haz clic en Enviar.\n\nLa resolución por correo moverá la tarjeta sola a Etapa 4 o Rechazado.");
    } catch (e) { alert("Error al enviar: " + e.message); }
    finally { setEnviando(false); }
  };


  return (
    <div>
      <div style={{ background: "#fff", borderBottom: "0.5px solid #e4e7ec", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 9 }}>
        <button className="btn-back" onClick={onVolver}>← Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{titulo}</div>
          <div style={{ fontSize: 12, color: "#888" }}>
            {cert.service_center || ter?.service_center || "—"} · {tc.label}{ter?.nombre ? <> · <b style={{ color: "#1a3a6b" }}>🏢 {ter.nombre}</b></> : null}
            {cert.created_at && <> · 🗓 ingresó al flujo el {fMX(cert.created_at, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} <span style={{ color: "#b0b7c3" }}>(hora de México)</span></>}
          </div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: fcFuente.bg, color: fcFuente.color, border: `1px solid ${fcFuente.border}` }}>
          {fcFuente.icon} {fcFuente.label}
        </span>
      </div>

      <div className="pg-detail">
        {/* Etapa 1: solo mover a Etapa 2 (Biggy corre al ABRIR en Etapa 2) */}
        {enEtapa1 && (
          <div className="form-card" style={{ background: "#fff4ec", border: "1px solid #fbd9c0" }}>
            <div style={{ fontSize: 13, color: "#7c3a12", lineHeight: 1.6, marginBottom: 12 }}>
              {esVeh
                ? <>Este vehículo está en <b>Etapa 1 · Recepción</b>. Sigue a <b>Pre Validación Biggy</b> y luego a <b>REPUVE</b>.</>
                : <>Esta certificación está en <b>Etapa 1 · Recepción</b>. En este flujo la empresa ya existe: no hay llamada de supervisor — sigue directo a <b>Pre Validación Biggy</b>.</>}
            </div>
            <button className="btn-orange" onClick={onPasarEtapa2} style={{ width: "100%" }}>
              ▶ Pasar a Pre Validación Biggy
            </button>
          </div>
        )}

        {cert.comentario_supervisor && !enEtapa1 && !enLlamada && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0e7490", marginBottom: 4 }}>📞 Comentario del supervisor</div>
            <div style={{ fontSize: 13, color: "#155e70", lineHeight: 1.5 }}>{cert.comentario_supervisor}</div>
          </div>
        )}

        {/* Stand By: prospecto válido que aún no se necesita */}
        {etapaActual === "stand_by" && (
          <div style={{ background: "#fff8ef", border: "2px solid #F47B20", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: "#b45309", marginBottom: 6 }}>
              ⏸ En Stand By — prospecto válido, aún no requerido
            </div>
            <div style={{ fontSize: 12.5, color: "#8a4a0f", lineHeight: 1.6 }}>
              El supervisor lo dejó en espera; la información queda intacta y el flujo se puede reactivar en cualquier momento.
              {cert.comentario_supervisor && <><br />Motivo: <b>{cert.comentario_supervisor}</b></>}
            </div>
            <button onClick={reactivarFlujo} disabled={reactivando}
              style={{ marginTop: 12, width: "100%", background: "#F47B20", color: "#fff", border: "none", borderRadius: 9, padding: "12px", fontSize: 13, fontWeight: 800, cursor: "pointer", opacity: reactivando ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
              {reactivando ? "Reactivando…" : "▶ Reactivar flujo → Pre Validación Biggy"}
            </button>
          </div>
        )}

        {/* Revisión Interna: MELI declinó y el analista decide */}
        {etapaActual === "revision_interna" && (
          <AvisoRevisionInterna registro={cert} moviendo={resolviendoRI}
            onAceptar={() => resolverRevisionInterna("aceptado")}
            onRechazar={() => resolverRevisionInterna("rechazado")} />
        )}

        {/* Etapa 3+: Biggy para personas; vehículos usarán su Vision propia (track REPUVE) */}
        {!enEtapa1 && !enLlamada && !esVeh && (
          <BiggyChatBubble analizando={analizando} analisis={analisis} score={score} recomendacion={recomendacion} alertas={alertas} onReanalizar={() => docsCert && analizarCert(docsCert)} />
        )}
        {cert.cambios_pendientes && (
          <div className="form-card" style={{ background: "#fff4e5", border: "1.5px solid #F47B20" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
              <div className="form-title" style={{ color: "#b45309", margin: 0 }}>⚠ La empresa actualizó documentos desde su portal</div>
              <button onClick={async () => {
                await sb.from("certificaciones").update({ cambios_pendientes: false }).eq("id", cert.id);
                cert.cambios_pendientes = false;
                setDocsCert(d => d ? [...d] : d);
              }} style={{ marginLeft: "auto", background: "#fff", color: "#b45309", border: "1.5px solid #b45309", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                ✓ Marcar como revisado
              </button>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(cert.cambios_prospecto || []).slice(-8).reverse().map((c, i) => (
                <li key={i} style={{ fontSize: 12.5, color: "#8a4a0f", marginBottom: 4 }}>
                  <b>{new Date(c.at).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</b>
                  {" · "}📎 {docEtiquetaCert(c.campo)}: {c.accion}{c.por ? ` (${c.por})` : ""}
                  {c.storage_path && (
                    <button onClick={async () => {
                      const { data: sg } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(c.storage_path, 600);
                      if (sg?.signedUrl) window.open(sg.signedUrl, "_blank");
                      else alert("No se pudo abrir — el archivo pudo haber sido reemplazado o eliminado después.");
                    }} style={{ marginLeft: 8, background: "#fff", color: "#b45309", border: "1px solid #e8c48f", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                      👁 Ver documento
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div style={{ fontSize: 11.5, color: "#8a6a3f", marginTop: 8 }}>Los documentos nuevos o reemplazados aparecen <b>resaltados en naranja</b> abajo en la sección Documentos — revísalos y, si corresponde, re-corre el análisis de Biggy o la validación de la etapa.</div>
          </div>
        )}

        {etapaActual === "prevalidacion_biggy" && (
          <NotificarDocsFallidas nombre={cert.nombre_display || cert.nombre} telefonoInicial={cert.telefono || cert.raw?.telefono || ""} emailInicial={cert.email || cert.raw?.email || cert.raw?.correo || ""} alertas={alertas} fuente="certificaciones" registroId={cert.id} terceroId={cert.tercero_id} empresa={ter?.nombre || ""} titulo={titulo} />
        )}
        {!enEtapa1 && esVeh && (
          <AnalisisVehiculoBiggy cert={cert} veh={veh} docs={docsCert}
            onActualizado={async (patch) => { Object.assign(cert, patch); const { error } = await sb.from("certificaciones").update(patch).eq("id", cert.id); if (error) alert("⚠ El análisis corrió pero NO quedó guardado — corre biggy_fuente_b.sql.\n\n" + error.message); setDocsCert(d => d ? [...d] : d); }} />
        )}

        {/* Etapa 2 → siguiente: MELI (persona) / REPUVE (vehículo, sin pasar por MELI) */}
        {enEtapa2 && (
          <div className="form-card">
            {esVeh ? (
              <button className="btn-orange" onClick={() => onMoverA("validacion_nubarium")} style={{ width: "100%" }}>
                ▶ Pasar a Etapa 5 · Validación Nubarium (REPUVE: placa y reporte de robo)
              </button>
            ) : (
              <button className="btn-orange" onClick={() => onMoverA("validacion_meli")} style={{ width: "100%" }}>
                ▶ Pasar a Validación MELI
              </button>
            )}
          </div>
        )}

        {/* Etapa 3 · Validación MELI (conductores): datos del formulario + envío */}
        {!enEtapa1 && !esVeh && etapaActual === "validacion_meli" && (
          <div className="form-card" style={{ border: "1px solid #d6def0", background: "#eef2f7" }}>
            <div className="form-title" style={{ color: "#1a3a6b" }}>Datos a enviar al formulario MELI</div>
            <div className="three-col" style={{ marginBottom: 12 }}>
              {[
                ["Nombre", (cond?.nombre || "").toUpperCase()], ["CURP", cond?.curp],
                ["Correo (invitación MELI)", cond?.email || "⚠ SIN CORREO"],
                ["Empresa", "Big Ticket"], ["Servicio", "Last mile"],
                ["SVC", (cert.service_center || ter?.service_center || "").split("_").pop()],
                ["Puesto/Licencia", cert.tipo === "ayudante" ? "Auxiliar" : (cond?.licencia_numero || "")],
                ["Tipo", "MLP"],
              ].map(([l, v]) => (
                <div key={l} style={{ padding: "6px 0" }}>
                  <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase" }}>{l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{v || "—"}</div>
                </div>
              ))}
            </div>
            {cert.fecha_envio_meli ? (
              <div style={{ fontSize: 13, color: "#1a3a6b", background: "#fff", padding: "10px 12px", borderRadius: 8, border: "1px solid #d6def0" }}>
                ⏳ <b>Enviado a MELI.</b> Esperando la resolución por correo — la tarjeta se moverá sola a <b>Etapa 4</b> (aprobado) o <b>Rechazado</b>.
              </div>
            ) : (
              <button className="btn-orange" onClick={enviarCertAMeli} disabled={enviando} style={{ width: "100%" }}>
                {enviando ? "Abriendo…" : "Enviar certificación a Mercado Libre"}
              </button>
            )}
          </div>
        )}

        {/* Etapa 5 personas: informe Nubarium (mismo componente de Fuente A, adaptado) + decisión */}
        {!enEtapa1 && !esVeh && etapaActual === "validacion_nubarium" && (
          <>
            <div className="form-card" style={{ background: "#eafaf0", border: "1px solid #b7e4c7" }}>
              <div style={{ fontSize: 13, color: "#166534" }}>✅ <b>Aprobado por MELI.</b> {cert.respuesta_meli || ""} — Ahora en <b>Validación Nubarium</b>: corre el informe oficial abajo y decide.</div>
            </div>
            <ValidacionNubarium
              candidato={{
                id: cert.id,
                nombre: cond?.nombre || "",
                curp: cond?.curp || "",
                rfc: cond?.rfc || "",
                url_ine: urlDocDe("ine"),
                url_ine_2: urlDocDe("ine_reverso"),
                nubarium_reporte: cert.nubarium_reporte || null,
              }}
              onActualizar={async (u) => {
                cert.nubarium_reporte = u.nubarium_reporte;
                const { error } = await sb.from("certificaciones").update({ nubarium_reporte: u.nubarium_reporte }).eq("id", cert.id);
                if (error) console.warn("No se guardó nubarium_reporte (¿falta la columna? corre fuente_b_nubarium.sql):", error.message);
                setDocsCert((d) => d ? [...d] : d);
              }}
            />
            <div className="form-card">
              <button className="btn-orange" onClick={() => onMoverA("aceptado")} style={{ width: "100%" }}>
                ✓ Certificación validada → Aceptado
              </button>
            </div>
          </>
        )}
        {esVeh && etapaActual === "validacion_nubarium" && (
          <ValidacionRepuve cert={cert} veh={veh} onMoverA={onMoverA}
            onVehActualizado={(v) => { cert._vehiculo = v; setDocsCert(d => d ? [...d] : d); }} />
        )}
        {/* 🔒 Informe RHCHECK — Etapa Nubarium, personas Y vehículos */}
        {!enEtapa1 && etapaActual === "validacion_nubarium" && (
          <InformeRHCheck fuente="certificaciones" registroId={cert.id} terceroId={cert.tercero_id}
            titulo={titulo} pathInicial={cert.rhcheck_informe_path}
            onCambio={(p) => { cert.rhcheck_informe_path = p; }} />
        )}
        {etapaActual === "rechazado" && (
          <div className="form-card" style={{ background: "#fdecec", border: "1px solid #f5c2c2" }}>
            <div style={{ fontSize: 13, color: "#991b1b" }}>✕ <b>Rechazado.</b> {cert.respuesta_meli || cert.motivo_rechazo || ""}</div>
          </div>
        )}

        {cert.tercero_id && (
          <ChatEmpresaCert terceroId={cert.tercero_id} empresa={ter?.nombre} titulo={titulo} />
        )}

        {/* SLA de la tarea pendiente + reactivación con motivo */}
        <PanelSLA tarea={tareaSLA} onReactivado={cargarTareaSLA} />


        {/* Repetir una tarea YA EJECUTADA (entrevista o llamada). Solo para
            personas (los vehículos no llevan entrevista) y cuando no hay
            tarea pendiente viva. */}
        {!tareaSLA && !esVeh && ["validacion_meli", "validacion_nubarium", "entrevista_operaciones", "revision_interna"].includes(cert.etapa_kanban) && (
          <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: 16, marginTop: 12 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0e7490", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>
              🔁 Repetir tarea del supervisor
            </div>
            <div style={{ fontSize: 12.5, color: "#667085", lineHeight: 1.6, marginBottom: 10 }}>
              La tarea anterior ya se ejecutó. Si hubo un error y hay que repetirla, esto crea una
              tarea nueva en la bitácora del supervisor del SC (la original queda como registro).
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => reactivarTareaEjecutada("entrevista_prospecto")} disabled={reactivandoTarea}
                style={{ flex: 1, minWidth: 180, background: "#0e7490", color: "#fff", border: "none", borderRadius: 9, padding: "11px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: reactivandoTarea ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                {reactivandoTarea ? "Creando…" : "🔁 Repetir entrevista"}
              </button>
              <button onClick={() => reactivarTareaEjecutada("llamada_prospecto")} disabled={reactivandoTarea}
                style={{ flex: 1, minWidth: 180, background: "#fff", color: "#0e7490", border: "1.5px solid #0e7490", borderRadius: 9, padding: "11px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: reactivandoTarea ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                🔁 Repetir llamada
              </button>
            </div>
          </div>
        )}

        {/* Datos editables: conductor o vehículo, según el tipo de certificación.
            Se guarda en la tabla hija correspondiente y se recarga la vista. */}
        <EditorDatos
          titulo={esVeh ? "Datos del vehículo" : "Datos del candidato"}
          valores={esVeh ? (veh || {}) : (cond || {})}
          campos={esVeh ? [
            { k: "placa", label: "Placa", mayus: true },
            { k: "vin", label: "VIN", mayus: true },
            { k: "marca", label: "Marca" },
            { k: "modelo", label: "Modelo" },
            { k: "anio", label: "Año", tipo: "number" },
            { k: "clase", label: "Clase" },
            { k: "entidad_emplaco", label: "Entidad emplacamiento" },
          ] : [
            { k: "nombre", label: "Nombre" },
            { k: "curp", label: "CURP", mayus: true },
            { k: "rfc", label: "RFC", mayus: true },
            { k: "telefono", label: "Teléfono" },
            { k: "email", label: "Email" },
            { k: "licencia_numero", label: "Licencia N°" },
            { k: "licencia_estado", label: "Licencia estado" },
            { k: "licencia_vigencia", label: "Licencia vigencia", tipo: "date" },
          ]}
          onGuardar={async (cambios) => {
            const tabla = esVeh ? "certificacion_vehiculo" : "certificacion_conductor";
            const fila = esVeh ? veh : cond;
            // Se actualiza por id si se conoce; si no, por certificacion_id (la
            // relación es 1 a 1, así que apunta al mismo registro).
            let q = sb.from(tabla).update(cambios);
            q = fila?.id ? q.eq("id", fila.id) : q.eq("certificacion_id", cert.id);
            const { data, error } = await q.select();
            if (error) throw new Error(error.message);
            if (!data || !data.length) {
              throw new Error("no existe el registro de " + (esVeh ? "vehículo" : "conductor") + " para esta certificación");
            }
            if (fila) Object.assign(fila, cambios);
            if (typeof cargarDocsCert === "function") await cargarDocsCert();
          }} />

        <GestorDocsCert cert={cert} docs={docsCert} onRecargar={cargarDocsCert}
          cambios={cert.cambios_prospecto} resaltar={!!cert.cambios_pendientes} avisoSinIndexar={docsSinIndexar} />
      </div>
    </div>
  );
}

// ─── KANBAN ──────────────────────────────────────────────────────────
// Badge de nota Biggy con semáforo (verde ≥7, amarillo ≥4, rojo <4)
function NotaBiggy({ score }) {
  if (score === null || score === undefined) return null;
  const bg  = score >= 7 ? "#dcfce7" : score >= 4 ? "#fef3c7" : "#fee2e2";
  const col = score >= 7 ? "#166534" : score >= 4 ? "#92400e" : "#c0392b";
  const bd  = score >= 7 ? "#86efac" : score >= 4 ? "#fde68a" : "#fca5a5";
  return (
    <span title="Nota de Biggy" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: bg, color: col, border: `1px solid ${bd}` }}>
      <img src={BIGGY_IMG} alt="" style={{ width: 12, height: 12, borderRadius: "50%", objectFit: "cover" }} />
      {score}/10
    </span>
  );
}

function KanbanBoard({ items, columnas = COLUMNAS, onCardClick, onMover, onEliminar }) {
  const dragKey = useRef(null);
  const didDrag = useRef(false);
  const [overCol, setOverCol] = useState(null);
  const topRef = useRef(null);
  const boardRef = useRef(null);
  const [contentW, setContentW] = useState(0);

  useEffect(() => {
    const medir = () => { if (boardRef.current) setContentW(boardRef.current.scrollWidth); };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [items]);

  const syncFromTop   = () => { if (boardRef.current && topRef.current) boardRef.current.scrollLeft = topRef.current.scrollLeft; };
  const syncFromBoard = () => { if (boardRef.current && topRef.current) topRef.current.scrollLeft = boardRef.current.scrollLeft; };

  return (
    <div style={{ position: "relative" }}>
      {/* Barra de scroll horizontal SUPERIOR — sincronizada con el tablero. Como el tablero
          hace su propio scroll interno (abajo), esta barra siempre queda visible arriba. */}
      <div ref={topRef} onScroll={syncFromTop}
        style={{ overflowX: "auto", overflowY: "hidden", height: 14, background: "#eef1f5", border: "0.5px solid #e4e7ec", borderRadius: 7, marginBottom: 8 }}>
        <div style={{ width: contentW, height: 1 }} />
      </div>
      {/* Tablero acotado al viewport: el scroll vertical y horizontal ocurre AQUÍ dentro,
          así la barra de arriba y los encabezados de columna no se van al bajar. */}
      <div ref={boardRef} className="kanban-board" onScroll={syncFromBoard}
        style={{ display: "flex", gap: 12, alignItems: "flex-start", overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 300px)", minHeight: 360, paddingBottom: 10 }}>
        {columnas.map(col => {
          const cards = items.filter(i => i.etapa === col.id);
        return (
          <div key={col.id} className="kanban-col"
            onDragOver={(e) => { e.preventDefault(); if (overCol !== col.id) setOverCol(col.id); }}
            onDragLeave={() => setOverCol(prev => prev === col.id ? null : prev)}
            onDrop={() => { setOverCol(null); const k = dragKey.current; dragKey.current = null; if (k) onMover(k, col.id); }}
            style={{ flex: "1 1 0", minWidth: 205, alignSelf: "stretch", ...(overCol === col.id ? { outline: `2px dashed ${col.color}`, outlineOffset: -4, borderRadius: 10 } : {}) }}>
            <div className="kanban-col-header" style={{ background: col.bg, border: `1px solid ${col.border}`, position: "sticky", top: 0, zIndex: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>{col.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: col.color, background: "rgba(255,255,255,0.6)", borderRadius: 20, padding: "2px 8px" }}>{cards.length}</span>
            </div>
            {cards.length === 0 && <div style={{ textAlign: "center", padding: "20px 10px", fontSize: 12, color: "#bbb" }}>Sin postulaciones</div>}
            {cards.map(card => {
              const fc = fuenteBadge(card);
              const tc = TIPO_CFG[card.tipo] || TIPO_CFG.conductor;
              const esVeh = card.tipo === "vehiculo";
              const esRechazo = col.id === "rechazado";
              return (
                <div key={card.key} className="kanban-card"
                  draggable
                  onDragStart={() => { dragKey.current = card.key; didDrag.current = false; }}
                  onDrag={() => { didDrag.current = true; }}
                  onDragEnd={() => { dragKey.current = null; }}
                  onClick={() => { if (didDrag.current) { didDrag.current = false; return; } onCardClick(card); }}
                  style={{ position: "relative", cursor: "grab" }}>
                  {/* eliminar (solo front) */}
                  <button title="Quitar del tablero" onClick={(e) => { e.stopPropagation(); onEliminar(card); }}
                    style={{ position: "absolute", top: 6, right: 6, width: 20, height: 20, lineHeight: "18px", textAlign: "center", borderRadius: "50%", border: "1px solid #e4e7ec", background: "#fff", color: "#c0392b", fontSize: 12, cursor: "pointer", padding: 0 }}>✕</button>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8, paddingRight: 22 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1a3a6b", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                      {esVeh ? "🚚" : (card.titulo?.charAt(0)?.toUpperCase() || "?")}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, flexShrink: 0, background: fc.bg, color: fc.color, border: `1px solid ${fc.border}` }}>
                      {fc.icon} {fc.label}
                    </span>
                  </div>
                  {/* Fecha y hora de entrada al flujo (sirve para medir antigüedad) */}
                  {card.creado && (
                    <div title={"Ingresó al flujo el " + fMX(card.creado) + " (hora de México)"}
                      style={{ fontSize: 9.5, color: "#98a2b3", fontWeight: 600, marginBottom: 4 }}>
                      🗓 {fMX(card.creado, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {(() => {
                        const h = Math.floor((Date.now() - new Date(card.creado).getTime()) / 3600000);
                        if (h < 24) return <span style={{ color: "#667085" }}> · hace {h} h</span>;
                        const d = Math.floor(h / 24);
                        return <span style={{ color: d > 7 ? "#b45309" : "#667085", fontWeight: d > 7 ? 800 : 600 }}> · hace {d} día{d === 1 ? "" : "s"}</span>;
                      })()}
                    </div>
                  )}
                  {card.tarea?.sla_vence_at && (
                    <div style={{ marginBottom: 5 }}><ChipSLA vence={card.tarea.sla_vence_at} /></div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 4, wordBreak: "break-word" }}>{card.titulo}</div>
                  {card.empresa && (
                    <div title={card.empresa} style={{ fontSize: 11, fontWeight: 800, color: "#1a3a6b", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      🏢 {card.empresa}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
                      {tc.icon} {tc.label}
                    </span>
                    <span style={{ fontSize: 10, color: "#888", fontWeight: 600 }}>📍 {card.sc}</span>
                    {!ETAPAS_SIN_NOTA_BIGGY.includes(col.id) && <NotaBiggy score={card.score} />}
                    {!ETAPAS_SIN_NOTA_BIGGY.includes(col.id) && card.rec && <span style={{ fontSize: 9, color: "#888" }}>{card.rec}</span>}
                    {card.raw?.cambios_pendientes && (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#fff4e5", color: "#b45309", border: "1px solid #f5d9b8" }}>
                        ⚠ Cambios del prospecto
                      </span>
                    )}
                  </div>
                  {esRechazo && card.raw?.respuesta_meli && (
                    <div style={{ fontSize: 10, color: "#c0392b", marginTop: 6 }}>❌ {card.raw.respuesta_meli}</div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ─── MÓDULO CERTIFICACIONES ──────────────────────────────────────────
// ─── GESTIONADOR DE CONTRATOS ────────────────────────────────────────
// Documentos de firma independientes del ingreso: contratos, anexos,
// bajas de vehículo, etc. El analista sube el PDF, lo envía a firma
// (MIFIEL) y el tercero lo firma desde su portal.
const TIPO_DOC_GESTION = {
  contrato:      { label: "Contrato",         color: "#1a3a6b", bg: "#eef2f7" },
  anexo:         { label: "Anexo",            color: "#F47B20", bg: "#fff4ec" },
  baja_vehiculo: { label: "Baja de vehículo", color: "#c0392b", bg: "#fbeaea" },
  otro:          { label: "Otro",             color: "#555555", bg: "#f0f0f0" },
};
const ESTADO_DOC_GESTION = {
  borrador: { label: "Borrador",         color: "#555555", bg: "#f0f0f0" },
  enviado:  { label: "Enviado a firma",  color: "#7c3aed", bg: "#f5f0fe" },
  firmado:  { label: "Firmado ✓",        color: "#166534", bg: "#e8f5ec" },
};

// ─── 🗂 DOCUMENTACIÓN TERCEROS · archivador digital por empresa ──────
// Carga masiva (drag & drop / selección múltiple, imágenes comprimidas)
// al bucket privado `archivador_empresas`, indexado en `documentos_empresa`.
// El Portal de Terceros lee este mismo archivador (solo su empresa).
const DOC_CATEGORIAS = [
  { id: "contratos", label: "📑 Contratos" },
  { id: "empresa",   label: "🏛 Documentación Empresa" },   // ficha de ingreso, datos bancarios, CSF, RFC, acta constitutiva
  { id: "seguros",   label: "🛡 Seguros" },
  { id: "vehiculos", label: "🚚 Vehículos" },
  { id: "qr",        label: "🔳 QR MELI" },                 // código QR de MELI por camioneta (Referencia = placa)
  { id: "personal",  label: "👤 Personal" },
  { id: "rhcheck",   label: "🔒 RHCHECK (confidencial)" },  // informes del analista RHCHECK — el portal NO los muestra
  { id: "anexos",    label: "📎 Anexos" },
  { id: "otros",     label: "🗃 Otros" },
];
const docCatLabel = (id) => (DOC_CATEGORIAS.find(c => c.id === id) || {}).label || id;
const fmtBytes = (b) => {
  if (b == null) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
};
// Comprime imágenes a JPEG máx. 1400px (documentos fotográficos legibles y livianos)
function comprimirImagenDoc(file) {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type) || file.type === "image/gif") return resolve(file);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const MAX = 1400;
        let w = img.width, h = img.height;
        if (w <= MAX && h <= MAX && file.size < 600000) return resolve(file);
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        else if (h >= w && h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        c.toBlob((blob) => resolve(blob && blob.size < file.size
          ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" })
          : file), "image/jpeg", 0.72);
      };
      img.onerror = () => resolve(file);
      img.src = reader.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

function DocumentacionTerceros() {
  const [empresas, setEmpresas] = useState(null);
  const [terceroId, setTerceroId] = useState("");
  const [categoria, setCategoria] = useState("contratos");
  const [referencia, setReferencia] = useState("");
  const [cola, setCola] = useState([]);          // { nombre, tamano, estado: en_cola|subiendo|ok|error, msg }
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [docs, setDocs] = useState(null);
  const [filtroCat, setFiltroCat] = useState("todas");
  const fileRef = useRef(null);
  // Generación de contrato de transportista desde el archivador (empresas antiguas)
  const [DG, setDG] = useState(null);          // datos editables (formulario del analista)
  const [genRow, setGenRow] = useState(null);  // fila en contratos_gestion (motor de firma)
  const [genPdf, setGenPdf] = useState(null);  // { path, url }
  const [genBusy, setGenBusy] = useState(false);
  const [enviandoFirma, setEnviandoFirma] = useState(false);
  const [firmaEnviada, setFirmaEnviada] = useState(false);

  const prepararContratoEmpresa = async () => {
    if (!terceroId) { alert("Selecciona primero la empresa."); return; }
    setGenBusy(true);
    try {
      const t = (empresas || []).find(e => e.id === terceroId) || {};
      const { data: ps } = await sb.from("perfiles_empresa").select("*").eq("tercero_id", terceroId).limit(1);
      const perfil = (ps && ps[0]) || {};
      const { data: ts } = await sb.from("terceros").select("email_portal").eq("id", terceroId).limit(1);
      setDG({
        nombre:    perfil.razon_social || t.nombre || "",
        rfc:       perfil.rfc_razon_social || t.rfc || "",
        rep:       perfil.representante_legal || t.nombre || "",
        correo:    perfil.correo_contacto || (ts && ts[0] && ts[0].email_portal) || "",
        domicilio: perfil.direccion || "",
        repse:     "", figura: "Moral", b2b: "No",
        tarifa:    "Tabla vigente", vigencia: "12 meses renovables",
        fechaIni:  perfil.fecha_ingreso_operacion || "",
        modelos:   [], ayudante: "", svc: "",
        lineas:    [{ svc: "", modelo: "", tipo: "", n: "1", ayudante: "", tarifa: "Tabla vigente", obs: "" }],
        backup:    { aplica: "", svc: "", dias: "", tipo: "", costo: "", aprobador: "" },
      });
      setGenPdf(null); setGenRow(null); setFirmaEnviada(false);
      if (!perfil.razon_social) alert("Aviso: esta empresa aún no completa su Perfil de Empresa en el portal — el formulario viene con lo mínimo; completa a mano lo que falte.");
    } catch (e) { alert("No se pudo preparar el formulario: " + e.message); }
    finally { setGenBusy(false); }
  };

  const generarContratoEmpresa = async () => {
    const faltanG = faltantesContrato(DG);
    if (faltanG.length) {
      alert("El contrato no puede generarse todavía:\n\n• " + faltanG.join("\n• ")); return;
    }
    setGenBusy(true);
    try {
      let row = genRow;
      if (!row) {
        const { data, error } = await sb.from("contratos_gestion")
          .insert({ tercero_id: terceroId, titulo: `Contrato de prestación de servicios — ${DG.nombre}`, tipo: "contrato", estado: "borrador" })
          .select("id").single();
        if (error) throw new Error(error.message);
        row = data; setGenRow(data);
      }
      const r = await generarContratoPDFDesde(DG, { tabla: "gestion", registro: { id: row.id } });
      await sb.from("contratos_gestion").update({ archivo_path: r.path }).eq("id", row.id);
      // Indexar también en el archivador de la empresa (una sola vez)
      const nombreArchivo = `Contrato transportista — ${DG.nombre}.pdf`;
      await sb.from("documentos_empresa").upsert({
        tercero_id: terceroId, categoria: "contratos", nombre_archivo: nombreArchivo,
        storage_path: r.path, bucket: "proceso_certificacion_bt", mime_type: "application/pdf",
        referencia: "Generado con plantilla oficial", subido_por: window.__PERFIL_EMAIL || "", origen: "brain",
      }, { onConflict: "storage_path" });
      setGenPdf(r);
      await cargarDocs(terceroId);
    } catch (e) { alert("No se pudo generar el contrato: " + e.message); }
    finally { setGenBusy(false); }
  };

  const enviarContratoAFirma = async () => {
    if (!genRow || !genPdf) return;
    const correo = (DG.correo || "").trim();
    if (!correo) { alert("El contrato necesita el correo del firmante (campo Correo del firmante en el formulario)."); return; }
    if (!confirm(`¿Enviar el contrato de ${DG.nombre} a firma digital? El tercero lo firmará desde su portal.`)) return;
    setEnviandoFirma(true);
    try {
      const { data: sg, error: eSg } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(genPdf.path, 604800);
      if (eSg || !sg?.signedUrl) throw new Error("no se pudo generar la URL del PDF");
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/mifiel-contrato-gestion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: genRow.id, titulo: `Contrato de prestación de servicios — ${DG.nombre}`,
          archivo_url: sg.signedUrl, firmante_nombre: DG.rep || DG.nombre, firmante_email: correo }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt.trim()) throw new Error("el servicio de firma no respondió");
      const r = JSON.parse(txt);
      if (!r.documento_id) throw new Error(r.error || "respuesta sin documento_id");
      setFirmaEnviada(true);
    } catch (e) { alert("No se pudo enviar a firma: " + e.message); }
    finally { setEnviandoFirma(false); }
  };

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("terceros").select("id, nombre, rfc").order("nombre");
      setEmpresas(data || []);
    })();
  }, []);

  const cargarDocs = async (tid) => {
    if (!tid) { setDocs(null); return; }
    setDocs(null);
    const { data } = await sb.from("documentos_empresa")
      .select("*").eq("tercero_id", tid).order("created_at", { ascending: false });
    setDocs(data || []);
  };
  useEffect(() => { cargarDocs(terceroId); }, [terceroId]);

  const subirArchivos = async (files) => {
    if (!terceroId) { alert("Selecciona primero la empresa a la que pertenecen los archivos."); return; }
    const lista = Array.from(files || []);
    if (!lista.length) return;
    const emp = empresas.find(e => e.id === terceroId);
    setSubiendo(true);
    setCola(lista.map(f => ({ nombre: f.name, tamano: f.size, estado: "en_cola", msg: "" })));
    for (let i = 0; i < lista.length; i++) {
      setCola(p => p.map((x, ix) => ix === i ? { ...x, estado: "subiendo" } : x));
      try {
        const archivo = await comprimirImagenDoc(lista[i]);
        const limpio = archivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${terceroId}/${categoria}/${Date.now()}_${limpio}`;
        const { error: eUp } = await sb.storage.from("archivador_empresas")
          .upload(path, archivo, { contentType: archivo.type || "application/octet-stream", upsert: false });
        if (eUp) throw new Error(eUp.message);
        const { error: eIns } = await sb.from("documentos_empresa").insert({
          tercero_id: terceroId, categoria, nombre_archivo: lista[i].name,
          storage_path: path, mime_type: archivo.type || null, tamano_bytes: archivo.size,
          referencia: referencia.trim() || null,
          subido_por: window.__PERFIL_EMAIL || "", origen: "brain",
          ...(categoria === "rhcheck" ? { confidencial: true } : {}),
        });
        if (eIns) throw new Error("índice: " + eIns.message);
        setCola(p => p.map((x, ix) => ix === i ? { ...x, estado: "ok", tamano: archivo.size } : x));
      } catch (e) {
        setCola(p => p.map((x, ix) => ix === i ? { ...x, estado: "error", msg: e.message } : x));
      }
    }
    setSubiendo(false);
    await cargarDocs(terceroId);
  };

  const descargar = async (doc) => {
    const { data, error } = await sb.storage.from(doc.bucket || "archivador_empresas").createSignedUrl(doc.storage_path, 300);
    if (error || !data?.signedUrl) { alert("No se pudo generar el enlace: " + (error?.message || "")); return; }
    window.open(data.signedUrl, "_blank");
  };

  const eliminar = async (doc) => {
    if (!confirm(`¿Eliminar "${doc.nombre_archivo}" del archivador?\n\nSe borra el archivo y su registro. Esta acción no se puede deshacer.`)) return;
    const { error: eSt } = await sb.storage.from(doc.bucket || "archivador_empresas").remove([doc.storage_path]);
    if (eSt) { alert("No se pudo borrar el archivo: " + eSt.message); return; }
    await sb.from("documentos_empresa").delete().eq("id", doc.id);
    setDocs(p => (p || []).filter(d => d.id !== doc.id));
  };

  const emp = (empresas || []).find(e => e.id === terceroId);
  const docsFiltrados = (docs || []).filter(d => filtroCat === "todas" || d.categoria === filtroCat);
  const totalBytes = (docs || []).reduce((s, d) => s + (d.tamano_bytes || 0), 0);
  const inp = { background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "'Geist',sans-serif" };

  return (
    <div className="pg">
      <div style={{ marginBottom: 14 }}>
        <div className="sec-title">🗂 Documentación Terceros</div>
        <div className="sec-sub">Archivador digital por empresa — contratos, seguros, fotos de unidades, anexos. Las empresas ven su carpeta desde el Portal de Terceros.</div>
      </div>

      {/* Selección + carga masiva */}
      <div className="form-card">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <select value={terceroId} onChange={(e) => setTerceroId(e.target.value)} style={{ ...inp, flex: 2, minWidth: 240 }}>
            <option value="">— Selecciona la empresa —</option>
            {(empresas || []).map(e => <option key={e.id} value={e.id}>{e.nombre} · {e.rfc || "sin RFC"}</option>)}
          </select>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ ...inp, flex: 1, minWidth: 150 }}>
            {DOC_CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)}
            placeholder={categoria === "qr" ? "Placa de la camioneta (recomendado)" : categoria === "empresa" ? "Ej. CSF, acta constitutiva, ficha…" : "Referencia opcional (placa, persona…)"}
            style={{ ...inp, flex: 1, minWidth: 180 }} />
        </div>

        <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => { subirArchivos(e.target.files); e.target.value = ""; }} />
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); subirArchivos(e.dataTransfer.files); }}
          onClick={() => fileRef.current && fileRef.current.click()}
          style={{ border: `2px dashed ${arrastrando ? "#F47B20" : "#1a3a6b"}`, background: arrastrando ? "#fff4ec" : "#eef2f7",
            borderRadius: 12, padding: "28px 16px", textAlign: "center", cursor: "pointer", transition: "all .15s" }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>📁</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#1a3a6b" }}>Arrastra aquí los archivos o haz clic para elegirlos</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Carga masiva · PDF, imágenes (se comprimen solas), Office, lo que sea · quedan en {emp ? <b>{emp.nombre}</b> : "la empresa seleccionada"} → {docCatLabel(categoria)}</div>
        </div>

        {categoria === "contratos" && terceroId && (
          <div style={{ marginTop: 12, background: "#faf7ff", border: "1px solid #ddd0f7", borderRadius: 12, padding: 14 }}>
            {!DG ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240, fontSize: 12.5, color: "#4c1d95" }}>
                  <b>¿Contrato de transportista?</b> En vez de subir un PDF, genéralo aquí con la plantilla oficial de 24 páginas y el formulario del analista, precargado desde el Perfil de Empresa.
                </div>
                <button onClick={prepararContratoEmpresa} disabled={genBusy}
                  style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: genBusy ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                  {genBusy ? "Preparando…" : "🧾 Generar contrato con formulario"}
                </button>
              </div>
            ) : !genPdf ? (
              <>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, color: "#7c3aed", fontWeight: 700 }}>Formulario del contrato — revisa, completa y genera</span>
                  <button onClick={() => { setDG(null); setGenRow(null); }} style={{ marginLeft: "auto", border: "none", background: "none", color: "#888", fontSize: 12, cursor: "pointer" }}>✕ Cancelar</button>
                </div>
                <EditorContrato D={DG} setD={setDG} generando={genBusy} onGenerar={generarContratoEmpresa} />
              </>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#4c1d95" }}>✅ Contrato generado y archivado en 📑 Contratos</span>
                <a href={genPdf.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 700, color: "#7c3aed" }}>📄 Revisar PDF</a>
                <button onClick={() => setGenPdf(null)} style={{ border: "none", background: "none", color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✏️ Editar y regenerar</button>
                {firmaEnviada ? (
                  <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: "#166534", background: "#e8f5ec", border: "1px solid #b7e0c2", borderRadius: 20, padding: "6px 14px" }}>
                    ✍️ Enviado — el tercero lo firma en su portal
                  </span>
                ) : (
                  <button onClick={enviarContratoAFirma} disabled={enviandoFirma}
                    style={{ marginLeft: "auto", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: enviandoFirma ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                    {enviandoFirma ? "Enviando a MIFIEL…" : "✍️ Enviar a firma del tercero"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {cola.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {cola.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", borderBottom: "1px solid #f4f5f7", fontSize: 12.5 }}>
                <span style={{ width: 20, textAlign: "center" }}>
                  {c.estado === "ok" ? "✅" : c.estado === "error" ? "❌" : c.estado === "subiendo" ? "⏳" : "·"}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                <span style={{ color: "#888", fontFamily: "monospace" }}>{fmtBytes(c.tamano)}</span>
                {c.msg && <span style={{ color: "#c0392b", fontSize: 11 }}>{c.msg}</span>}
              </div>
            ))}
            <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
              {subiendo ? "Subiendo…" : `Listo: ${cola.filter(c => c.estado === "ok").length}/${cola.length} archivo(s) cargado(s).`}
            </div>
          </div>
        )}
      </div>

      {/* Explorador del archivador de la empresa */}
      {terceroId && (
        <div className="form-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="form-title" style={{ margin: 0 }}>Archivador de {emp?.nombre || "la empresa"}</div>
            <span style={{ fontSize: 11, color: "#888" }}>{(docs || []).length} archivo(s) · {fmtBytes(totalBytes)}</span>
            <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)} style={{ ...inp, marginLeft: "auto", fontSize: 12 }}>
              <option value="todas">Todas las categorías</option>
              {DOC_CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          {docs === null ? <div className="loading">Cargando archivador…</div>
          : docsFiltrados.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 10px", color: "#888", fontSize: 13 }}>
              {(docs || []).length === 0 ? "Esta empresa aún no tiene documentos en su archivador." : "Sin archivos en esta categoría."}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#888", fontSize: 10.5, textTransform: "uppercase" }}>
                  <th style={{ padding: "6px 4px" }}>Archivo</th><th>Categoría</th><th>Referencia</th><th>Tamaño</th><th>Subido</th><th></th>
                </tr>
              </thead>
              <tbody>
                {docsFiltrados.map(d => (
                  <tr key={d.id} style={{ borderTop: "1px solid #f4f5f7" }}>
                    <td style={{ padding: "8px 4px", fontWeight: 600, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {/^image\//.test(d.mime_type || "") ? "🖼" : (d.mime_type || "").includes("pdf") ? "📄" : "📎"} {d.nombre_archivo}
                    </td>
                    <td>{docCatLabel(d.categoria)}</td>
                    <td style={{ color: "#555" }}>{d.referencia || "—"}</td>
                    <td style={{ fontFamily: "monospace", color: "#555" }}>{fmtBytes(d.tamano_bytes)}</td>
                    <td style={{ fontSize: 11.5, color: "#888" }}>{new Date(d.created_at).toLocaleDateString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "2-digit", year: "2-digit" })} · {d.subido_por || "—"}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button onClick={() => descargar(d)} style={{ border: "1px solid #d6def0", background: "#eef2f7", color: "#1a3a6b", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", marginRight: 6 }}>Ver / Descargar</button>
                      <button onClick={() => eliminar(d)} style={{ border: "none", background: "none", color: "#c0392b", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function GestionadorContratos() {
  const [docs, setDocs] = useState(null);
  const [terceros, setTerceros] = useState([]);
  const [nuevo, setNuevo] = useState(false);
  const [firmandoBT, setFirmandoBT] = useState(null); // id del doc con widget abierto
  const [f, setF] = useState({ tercero_id: "", titulo: "", tipo: "contrato", descripcion: "", archivo: null });
  const [guardando, setGuardando] = useState(false);
  const [enviandoId, setEnviandoId] = useState(null);
  // Generación de contrato con formulario (misma plantilla y editor de Certificaciones)
  const [DG, setDG] = useState(null);          // datos editables del contrato
  const [genRow, setGenRow] = useState(null);  // fila borrador creada en contratos_gestion
  const [genPdf, setGenPdf] = useState(null);  // { path, url } del PDF generado
  const [genBusy, setGenBusy] = useState(false);

  const resetGeneracion = () => { setDG(null); setGenRow(null); setGenPdf(null); };

  // Prellenar el formulario del contrato desde terceros + Perfil de Empresa
  const prepararGeneracion = async () => {
    if (!f.tercero_id) { alert("Selecciona primero la empresa."); return; }
    setGenBusy(true);
    try {
      const { data: ts } = await sb.from("terceros").select("id, nombre, rfc, email_portal").eq("id", f.tercero_id).limit(1);
      const t = (ts && ts[0]) || {};
      const { data: ps } = await sb.from("perfiles_empresa").select("*").eq("tercero_id", f.tercero_id).limit(1);
      const perfil = (ps && ps[0]) || {};
      setDG({
        nombre:    perfil.razon_social || t.nombre || "",
        rfc:       perfil.rfc_razon_social || t.rfc || "",
        rep:       perfil.representante_legal || t.nombre || "",
        correo:    perfil.correo_contacto || t.email_portal || "",
        domicilio: perfil.direccion || "",
        repse:     "",
        figura:    "Moral",
        b2b:       "No",
        tarifa:    "Tabla vigente",
        vigencia:  "12 meses renovables",
        fechaIni:  perfil.fecha_ingreso_operacion || "",
        modelos:   ["SDD"],
        ayudante:  "No",
        svc:       "",
        lineas:    [{ tipo: "", n: "" }],
        backup:    { aplica: "", svc: "", dias: "", tipo: "", costo: "", aprobador: "" },
      });
      setGenPdf(null);
    } catch (e) { alert("No se pudo preparar el formulario: " + e.message); }
    finally { setGenBusy(false); }
  };

  // Generar el PDF (crea el borrador en contratos_gestion la primera vez)
  const generarPdfGestion = async () => {
    if (!DG.nombre.trim() || !DG.rfc.trim() || !DG.domicilio.trim()) {
      alert("Nombre, RFC y domicilio fiscal son obligatorios para el contrato."); return;
    }
    setGenBusy(true);
    try {
      let row = genRow;
      if (!row) {
        const titulo = f.titulo.trim() || `Contrato de prestación de servicios — ${DG.nombre}`;
        const { data, error } = await sb.from("contratos_gestion")
          .insert({ tercero_id: f.tercero_id, titulo, tipo: "contrato", descripcion: f.descripcion || null, estado: "borrador" })
          .select("id").single();
        if (error) throw new Error(error.message);
        row = data; setGenRow(data);
      }
      const r = await generarContratoPDFDesde(DG, { tabla: "gestion", registro: { id: row.id } });
      await sb.from("contratos_gestion").update({ archivo_path: r.path }).eq("id", row.id);
      setGenPdf(r);
      await cargar();
    } catch (e) { alert("No se pudo generar el contrato: " + e.message); }
    finally { setGenBusy(false); }
  };

  const cargar = async () => {
    const { data } = await sb.from("contratos_gestion")
      .select("*, terceros(nombre, email_portal)")
      .order("created_at", { ascending: false });
    setDocs(data || []);
  };

  // Refresco automático: las firmas llegan por evento desde el portal, así que
  // el listado se actualiza solo mientras el analista tiene la pestaña abierta.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    cargar();
    (async () => {
      const { data } = await sb.from("terceros").select("id, nombre, email_portal").order("nombre");
      setTerceros(data || []);
    })();
  }, []);
  useEffect(() => { if (firmandoBT) cargarScriptMifiel(); }, [firmandoBT]);

  const crear = async () => {
    if (!f.tercero_id || !f.titulo.trim() || !f.archivo) {
      alert("Faltan datos: empresa, título y el PDF del documento son obligatorios."); return;
    }
    setGuardando(true);
    try {
      const { data: row, error } = await sb.from("contratos_gestion")
        .insert({ tercero_id: f.tercero_id, titulo: f.titulo.trim(), tipo: f.tipo, descripcion: f.descripcion || null, estado: "borrador" })
        .select("id").single();
      if (error) throw new Error(error.message);
      const path = `gestion_contratos/${row.id}/${f.archivo.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: eUp } = await sb.storage.from("proceso_certificacion_bt").upload(path, f.archivo, { contentType: "application/pdf" });
      if (eUp) throw new Error("subiendo PDF: " + eUp.message);
      await sb.from("contratos_gestion").update({ archivo_path: path }).eq("id", row.id);
      // Indexar en el Archivador de la empresa → visible en Empresas → Documentos
      // y en "Documentos de mi empresa" del portal.
      try {
        await sb.from("documentos_empresa").upsert({
          tercero_id: f.tercero_id, categoria: "contratos", nombre_archivo: f.archivo.name,
          storage_path: path, bucket: "proceso_certificacion_bt", mime_type: "application/pdf",
          tamano_bytes: f.archivo.size,
          referencia: `${f.tipo === "anexo" ? "Anexo" : f.tipo === "baja" ? "Baja" : "Contrato"} · ${f.titulo.trim()}`,
          subido_por: window.__PERFIL_EMAIL || "", origen: "brain",
        }, { onConflict: "storage_path" });
      } catch (e) { console.warn("Archivador:", e.message); }
      setNuevo(false);
      setF({ tercero_id: "", titulo: "", tipo: "contrato", descripcion: "", archivo: null });
      await cargar();
    } catch (e) { alert("No se pudo crear: " + e.message); }
    finally { setGuardando(false); }
  };

  const enviarAFirma = async (doc) => {
    const emailTercero = doc.terceros?.email_portal;
    if (!emailTercero) { alert("La empresa no tiene email registrado (email_portal) — es necesario para la firma."); return; }
    if (!doc.archivo_path) { alert("El documento no tiene PDF adjunto."); return; }
    if (!confirm(`¿Enviar "${doc.titulo}" a firma digital de ${doc.terceros?.nombre}?`)) return;
    setEnviandoId(doc.id);
    try {
      const { data: sg, error: eSg } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(doc.archivo_path, 604800);
      if (eSg || !sg?.signedUrl) throw new Error("no se pudo generar la URL del PDF");
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/mifiel-contrato-gestion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: doc.id, titulo: doc.titulo, archivo_url: sg.signedUrl,
          firmante_nombre: doc.terceros?.nombre || "Tercero", firmante_email: emailTercero,
        }),
      });
      const txt = await resp.text();
      if (!resp.ok || !txt || !txt.trim()) throw new Error("el servicio de firma no respondió");
      const r = JSON.parse(txt);
      if (!r.documento_id) throw new Error(r.error || "respuesta sin documento_id");
      const { error } = await sb.from("contratos_gestion").update({
        estado: "enviado", mifiel_documento_id: r.documento_id,
        mifiel_widget_tercero: r.widget_tercero || null, mifiel_widget_bigticket: r.widget_bigticket || null,
        enviado_at: new Date().toISOString(),
      }).eq("id", doc.id);
      if (error) alert("Se envió a MIFIEL pero no se pudo guardar la referencia: " + error.message);
      await cargar();
    } catch (e) { alert("No se pudo enviar a firma: " + e.message); }
    finally { setEnviandoId(null); }
  };

  // Sincroniza con MIFIEL: refresca firmas y, si ya firmaron ambos, baja el
  // PDF firmado al archivador. Se dispara al cerrar el widget de BT y con el
  // botón manual del encabezado.
  const [sincronizando, setSincronizando] = useState(false);
  const sincronizarFirmados = async (contratoId, silencioso) => {
    setSincronizando(true);
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/sincronizar-firmados", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contratoId ? { contrato_id: contratoId, origen: "brain" } : { origen: "brain" }),
      });
      const txt = await resp.text();
      const r = txt && txt.trim() ? JSON.parse(txt) : null;
      const guardados = (r?.resultado || []).filter((x) => x.accion === "FIRMADO_GUARDADO");
      if (!silencioso) {
        if (guardados.length) alert(`✅ ${guardados.length} documento(s) firmado(s) guardado(s) en el archivador de su empresa.`);
        else alert("Sin novedades: no hay documentos con las dos firmas completas todavía.");
      }
      await cargar();
    } catch (e) {
      if (!silencioso) alert("No se pudo sincronizar con MIFIEL: " + e.message + "\n\nRevisa que el flujo 'sincronizar-firmados' esté activo en n8n.");
    } finally { setSincronizando(false); }
  };

  const abrirDelArchivador = async (path, descargar = false) => {
    if (!path) { alert("Este documento aún no tiene archivo firmado guardado."); return; }
    const { data, error } = await sb.storage.from("archivador_empresas")
      .createSignedUrl(path, 3600, descargar ? { download: true } : undefined);
    if (error || !data?.signedUrl) {
      // Diagnóstico útil: qué ruta se pidió y qué respondió Storage
      const carpeta = path.split("/").slice(0, -1).join("/");
      const { data: lista } = await sb.storage.from("archivador_empresas").list(carpeta, { limit: 20 });
      alert(
        "No se pudo abrir el archivo.\n\n" +
        "Ruta pedida:\n" + path + "\n\n" +
        "Error de Storage: " + (error?.message || "sin mensaje") + "\n\n" +
        "Archivos que SÍ existen en esa carpeta:\n" +
        ((lista || []).map((f) => "• " + f.name).join("\n") || "(carpeta vacía o sin permiso de lectura)")
      );
      return;
    }
    window.open(data.signedUrl, "_blank");
  };
  const eliminarDoc = async (doc) => {
    // Se puede eliminar en cualquier estado (equivocaciones y pruebas), con
    // confirmación proporcional al riesgo.
    const firmadoCompleto = !!doc.firmado_tercero && !!doc.firmado_bigticket;
    let aviso;
    if (doc.estado === "borrador") aviso = `¿Eliminar el borrador "${doc.titulo}"?`;
    else if (firmadoCompleto) aviso = `⚠️ "${doc.titulo}" está FIRMADO POR AMBAS PARTES.\n\nEliminarlo aquí borra el registro del Brain y del archivador, pero el documento firmado SIGUE EXISTIENDO en MIFIEL con validez legal (NOM-151).\n\nSolo hazlo si es una prueba. ¿Eliminar de todas formas?`;
    else aviso = `⚠️ "${doc.titulo}" ya fue ENVIADO A FIRMA.\n\nSe eliminará del Brain, del portal del tercero y del archivador. Si alguien ya tiene el link de firma de MIFIEL, ese documento quedará huérfano allá (puedes cancelarlo en app.mifiel.com).\n\n¿Eliminar?`;
    if (!confirm(aviso)) return;
    if (doc.estado !== "borrador" && !confirm(`Confirmación final: eliminar definitivamente "${doc.titulo}" (${doc.folio || doc.id}).`)) return;
    // Archivo del archivador → papelera (protect_delete impide el DELETE directo)
    if (doc.archivo_path) {
      try { await quitarDeStorage("archivador_empresas", doc.archivo_path); }
      catch (e) { console.warn("Archivo no retirado:", e.message); }
    }
    const { error } = await sb.from("contratos_gestion").delete().eq("id", doc.id);
    if (error) { alert("No se pudo eliminar: " + error.message); return; }
    await cargar();
  };

  const Pill = ({ cfg, label }) => (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}22` }}>
      {label || cfg.label}
    </span>
  );
  const ChipFirma = ({ label, listo }) => (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
      background: listo ? "#e8f5ec" : "#fff", color: listo ? "#166534" : "#7c3aed",
      border: `1px solid ${listo ? "#b7e0c2" : "#ddd0f7"}` }}>
      {listo ? "✓" : "⏳"} {label}
    </span>
  );

  return (
    <div>
      {(() => {
        const esperando = (docs || []).filter((d) => d.firmado_tercero && !d.firmado_bigticket && d.estado !== "firmado");
        const listos = (docs || []).filter((d) => d.archivo_firmado_path);
        return (
          <>
            {esperando.length > 0 && (
              <div style={{ background: "#fff4e5", border: "1.5px solid #F47B20", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#b45309", marginBottom: 4 }}>
                  ✍️ {esperando.length} documento(s) ya firmados por el tercero — falta la firma de BigTicket
                </div>
                {esperando.map((d) => (
                  <div key={d.id} style={{ fontSize: 12.5, color: "#8a4a0f" }}>• {d.titulo} — {d.terceros?.nombre || "—"}</div>
                ))}
              </div>
            )}
            {listos.length > 0 && (
              <div style={{ background: "#e8f5ec", border: "1px solid #b7e0c2", borderRadius: 10, padding: "10px 16px", marginBottom: 12, fontSize: 12.5, color: "#166534", fontWeight: 600 }}>
                ✅ {listos.length} documento(s) firmados por ambas partes y guardados en el archivador (botón “📄 Ver firmado”).
              </div>
            )}
          </>
        );
      })()}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: "#888" }}>
          Contratos, anexos, bajas y otros documentos de firma — independientes del proceso de ingreso.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => sincronizarFirmados(null, false)} disabled={sincronizando}
            title="Consulta MIFIEL y descarga al archivador los documentos que ya tengan ambas firmas"
            style={{ background: "#fff", color: "#1a3a6b", border: "1.5px solid #1a3a6b", borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif", opacity: sincronizando ? 0.6 : 1 }}>
            {sincronizando ? "Verificando…" : "📥 Traer firmados de MIFIEL"}
          </button>
          <button className="btn-orange" onClick={() => { setNuevo(!nuevo); resetGeneracion(); }} style={{ padding: "9px 16px" }}>
            {nuevo ? "Cancelar" : "➕ Nuevo documento"}
          </button>
        </div>
      </div>

      {nuevo && (
        <div className="form-card" style={{ border: "1px solid #fbd9c0", background: "#fff9f4", marginBottom: 16 }}>
          <div className="form-title" style={{ color: "#F47B20" }}>Nuevo documento de firma</div>
          <div className="three-col" style={{ marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Empresa *</div>
              <select value={f.tercero_id} onChange={e => setF({ ...f, tercero_id: e.target.value })}
                style={{ width: "100%", background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", fontSize: 13, fontFamily: "'Geist',sans-serif" }}>
                <option value="">Selecciona…</option>
                {terceros.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Tipo *</div>
              <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}
                style={{ width: "100%", background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", fontSize: 13, fontFamily: "'Geist',sans-serif" }}>
                {Object.entries(TIPO_DOC_GESTION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Título *</div>
              <input value={f.titulo} onChange={e => setF({ ...f, titulo: e.target.value })} placeholder="Ej. Anexo de tarifas 2026"
                style={{ width: "100%", background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", fontSize: 13, fontFamily: "'Geist',sans-serif", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Descripción (opcional)</div>
            <input value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} placeholder="Notas internas o contexto para el tercero"
              style={{ width: "100%", background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", fontSize: 13, fontFamily: "'Geist',sans-serif", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: "1px dashed #F47B20", borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", color: f.archivo ? "#166534" : "#F47B20", fontWeight: 600 }}>
              📎 {f.archivo ? `✓ ${f.archivo.name}` : "Adjuntar PDF *"}
              <input type="file" accept="application/pdf" style={{ display: "none" }}
                onChange={e => setF({ ...f, archivo: e.target.files[0] || null })} />
            </label>
            <button className="btn-orange" onClick={crear} disabled={guardando} style={{ padding: "10px 18px" }}>
              {guardando ? "Guardando…" : "Crear borrador"}
            </button>
            {f.tipo === "contrato" && !DG && (
              <>
                <span style={{ fontSize: 12, color: "#888" }}>— o —</span>
                <button onClick={prepararGeneracion} disabled={genBusy}
                  style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: genBusy ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                  {genBusy ? "Preparando…" : "🧾 Generar contrato con formulario (plantilla oficial)"}
                </button>
              </>
            )}
          </div>

          {DG && !genPdf && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11.5, color: "#7c3aed", fontWeight: 700, marginBottom: 8 }}>
                Formulario precargado desde el Perfil de Empresa — revisa, completa y genera. Es la misma plantilla oficial de 24 páginas del proceso de ingreso.
              </div>
              <EditorContrato D={DG} setD={setDG} generando={genBusy} onGenerar={generarPdfGestion} />
            </div>
          )}
          {DG && genPdf && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 14,
              background: "#fff", border: "1px solid #ddd0f7", borderRadius: 10, padding: "10px 12px" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#4c1d95" }}>✅ Contrato generado y guardado como borrador</span>
              <a href={genPdf.url} target="_blank" rel="noreferrer"
                style={{ fontSize: 12.5, fontWeight: 700, color: "#7c3aed" }}>📄 Revisar PDF</a>
              <button onClick={() => setGenPdf(null)}
                style={{ border: "none", background: "none", color: "#7c3aed", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                ✏️ Editar datos y regenerar
              </button>
              <span style={{ fontSize: 11.5, color: "#888", marginLeft: "auto" }}>Para enviarlo a firma, usa su botón en la lista de abajo ↓</span>
            </div>
          )}
        </div>
      )}

      {docs === null ? <div className="loading">Cargando…</div> : docs.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 32, marginBottom: 12 }}>📑</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Sin documentos</div>
          <div style={{ fontSize: 12 }}>Crea un contrato, anexo o baja y envíalo a firma digital del tercero</div>
        </div>
      ) : docs.map(doc => {
        const tc = TIPO_DOC_GESTION[doc.tipo] || TIPO_DOC_GESTION.otro;
        const ec = ESTADO_DOC_GESTION[doc.estado] || ESTADO_DOC_GESTION.borrador;
        const firmado = doc.estado === "firmado";
        return (
          <div key={doc.id} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{doc.titulo}</span>
                  <Pill cfg={tc} />
                  <Pill cfg={ec} />
                </div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
                  🏢 {doc.terceros?.nombre || "—"}
                  {doc.descripcion ? ` · ${doc.descripcion}` : ""}
                  {doc.enviado_at ? ` · enviado ${new Date(doc.enviado_at).toLocaleDateString("es-MX")}` : ""}
                </div>
              </div>
              {doc.estado !== "borrador" && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <ChipFirma label="Tercero" listo={!!doc.firmado_tercero || firmado} />
                  <ChipFirma label="Bigticket" listo={!!doc.firmado_bigticket || firmado} />
                </div>
              )}
              {doc.estado === "borrador" && (
                <>
                  <button className="btn-orange" onClick={() => enviarAFirma(doc)} disabled={enviandoId === doc.id} style={{ padding: "8px 14px" }}>
                    {enviandoId === doc.id ? "Enviando…" : "✍️ Enviar a firma"}
                  </button>
                  <button title="Eliminar borrador" onClick={() => eliminarDoc(doc)}
                    style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #e4e7ec", background: "#fff", color: "#c0392b", fontSize: 13, cursor: "pointer", padding: 0 }}>✕</button>
                </>
              )}
              {doc.estado === "enviado" && !doc.firmado_bigticket && doc.mifiel_widget_bigticket && (
                <button onClick={() => {
                    const cerrando = firmandoBT === doc.id;
                    setFirmandoBT(cerrando ? null : doc.id);
                    if (cerrando) sincronizarFirmados(doc.id, true);   // al cerrar, verifica y baja el firmado
                  }}
                  style={{ background: "#fff", color: "#7c3aed", border: "1.5px solid #ddd0f7", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {firmandoBT === doc.id ? "Cerrar y verificar firma" : "✍️ Firmar como Bigticket"}
                </button>
              )}
              {doc.archivo_firmado_path && (
                <button onClick={() => abrirDelArchivador(doc.archivo_firmado_path, true)}
                  style={{ background: "#e8f5ec", color: "#166534", border: "1.5px solid #b7e0c2", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  ⬇ Descargar PDF firmado
                </button>
              )}
              {doc.zip_path && (
                <button onClick={() => abrirDelArchivador(doc.zip_path, true)}
                  title="Constancia de conservación NOM-151 emitida por MIFIEL"
                  style={{ background: "#fff", color: "#7c3aed", border: "1.5px solid #ddd0f7", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                  🗜 NOM-151
                </button>
              )}
              {doc.estado !== "borrador" && (
                <button title="Eliminar documento (pruebas / equivocaciones)" onClick={() => eliminarDoc(doc)}
                  style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #f0c4c4", background: "#fff", color: "#c0392b", fontSize: 13, cursor: "pointer", padding: 0 }}>🗑</button>
              )}
            </div>
            {firmandoBT === doc.id && (
              <div style={{ marginTop: 12, border: "1px solid #ddd0f7", borderRadius: 10, padding: 8, minHeight: 620, background: "#fff" }}>
                <mifiel-widget id={doc.mifiel_widget_bigticket} environment={MIFIEL_ENV}></mifiel-widget>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── MENSAJES DE TERCEROS ────────────────────────────────────────────
// Consultas que dejan las empresas desde su portal; el analista responde aquí.
function MensajesTerceros() {
  const [convos, setConvos] = useState(null);
  const [terceros, setTerceros] = useState([]);
  const [sel, setSel] = useState(null);       // { tercero_id, nombre }
  const [msgs, setMsgs] = useState(null);
  const [texto, setTexto] = useState("");
  const [nuevoPara, setNuevoPara] = useState("");
  // 📣 Notificación manual: el analista escribe lo que necesite y avisa UNA
  // vez por WhatsApp + correo con el botón. El contacto viene del Perfil de
  // Empresa y se puede editar solo para este envío (no pisa el perfil).
  const [notif, setNotif] = useState(null);       // { n, correo, telefono } del tercero abierto
  const [editContacto, setEditContacto] = useState(false);
  const [notificando, setNotificando] = useState(false);

  const cargarNotif = async (terceroId) => {
    const { data } = await sb.rpc("mensajes_sin_leer_tercero", { p_tercero_id: terceroId });
    const f = Array.isArray(data) ? data[0] : data;
    setNotif(f ? { n: f.mensajes_sin_leer, correo: f.correo || "", telefono: f.telefono || "" } : null);
  };

  const notificar = async () => {
    if (!sel || !notif || !notif.n) return;
    if (!notif.correo && !notif.telefono) {
      alert("La empresa no tiene correo ni teléfono. Edita el contacto antes de notificar."); return;
    }
    const canales = [notif.telefono && `WhatsApp (${notif.telefono})`, notif.correo && `correo (${notif.correo})`].filter(Boolean).join(" y ");
    if (!confirm(`¿Avisar a ${sel.nombre} que tiene ${notif.n} mensaje(s) sin leer?\n\nSale UN aviso por ${canales}.`)) return;
    setNotificando(true);
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/notificar-mensajes-tercero", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tercero_id: sel.tercero_id, correo: notif.correo, telefono: notif.telefono }),
      });
      const r = await resp.json().catch(() => null);
      if (!resp.ok || !r) throw new Error("el servicio de avisos no respondió");
      if (r.ok === false) throw new Error(r.error || "no se pudo notificar");
      alert(`📣 Aviso enviado a ${r.empresa}.\n\nWhatsApp: ${r.whatsapp}\nCorreo: ${r.email}`);
      await cargarNotif(sel.tercero_id);
    } catch (e) { alert("No se pudo notificar: " + e.message); }
    finally { setNotificando(false); }
  };

  const cargarConvos = async () => {
    const { data } = await sb.from("mensajes_terceros")
      .select("tercero_id, autor, mensaje, leido, created_at, terceros(nombre)")
      .order("created_at", { ascending: false }).limit(500);
    const porEmpresa = {};
    (data || []).forEach(m => {
      const t = Array.isArray(m.terceros) ? m.terceros[0] : m.terceros;
      if (!porEmpresa[m.tercero_id]) {
        porEmpresa[m.tercero_id] = { tercero_id: m.tercero_id, nombre: t?.nombre || "—", ultimo: m.mensaje, fecha: m.created_at, no_leidos: 0 };
      }
      if (m.autor === "tercero" && !m.leido) porEmpresa[m.tercero_id].no_leidos++;
    });
    setConvos(Object.values(porEmpresa));
  };
  useEffect(() => {
    cargarConvos();
    (async () => {
      const { data } = await sb.from("terceros").select("id, nombre").order("nombre");
      setTerceros(data || []);
    })();
  }, []);

  const abrir = async (c) => {
    setSel(c); setMsgs(null);
    const { data } = await sb.from("mensajes_terceros")
      .select("*").eq("tercero_id", c.tercero_id).order("created_at", { ascending: true });
    setMsgs(data || []);
    // marcar como leídos los mensajes del tercero
    await sb.from("mensajes_terceros").update({ leido: true })
      .eq("tercero_id", c.tercero_id).eq("autor", "tercero").eq("leido", false);
    cargarConvos();
    setEditContacto(false);
    cargarNotif(c.tercero_id);
  };

  // El hilo abierto se refresca solo: si el tercero responde mientras el
  // analista mira la conversación, aparece sin cerrar y reabrir.
  useEffect(() => {
    if (!sel) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const { data } = await sb.from("mensajes_terceros")
        .select("*").eq("tercero_id", sel.tercero_id).order("created_at", { ascending: true });
      if (data) {
        setMsgs(prev => (prev && data.length === prev.length) ? prev : data);
        const hayNuevosDelTercero = (data || []).some(m => m.autor === "tercero" && !m.leido);
        if (hayNuevosDelTercero) {
          await sb.from("mensajes_terceros").update({ leido: true })
            .eq("tercero_id", sel.tercero_id).eq("autor", "tercero").eq("leido", false);
          cargarConvos();
        }
      }
    }, 20000);
    return () => clearInterval(t);
  }, [sel]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || !sel) return;
    setTexto("");
    const fila = { tercero_id: sel.tercero_id, autor: "bigticket", mensaje: t };
    const { data, error } = await sb.from("mensajes_terceros").insert(fila).select("*").single();
    if (error) { alert("No se pudo enviar: " + error.message); setTexto(t); return; }
    setMsgs(prev => [...(prev || []), data]);
    cargarConvos();
    cargarNotif(sel.tercero_id);   // el contador del botón Notificar sube al tiro
  };

  const iniciarConversacion = () => {
    if (!nuevoPara) return;
    const t = terceros.find(x => x.id === nuevoPara);
    if (t) abrir({ tercero_id: t.id, nombre: t.nombre });
    setNuevoPara("");
  };

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
      {/* Lista de conversaciones */}
      <div style={{ flex: "0 0 300px", minWidth: 260, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "12px 14px", borderBottom: "0.5px solid #e4e7ec" }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>💬 Conversaciones</div>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={nuevoPara} onChange={e => setNuevoPara(e.target.value)}
              style={{ flex: 1, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "7px 8px", fontSize: 12, fontFamily: "'Geist',sans-serif" }}>
              <option value="">Nueva conversación…</option>
              {terceros.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            <button onClick={iniciarConversacion} disabled={!nuevoPara}
              style={{ background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", opacity: nuevoPara ? 1 : 0.5 }}>+</button>
          </div>
        </div>
        <div style={{ overflowY: "auto", flex: 1, maxHeight: 520 }}>
          {convos === null ? <div style={{ padding: 14, fontSize: 12, color: "#888" }}>Cargando…</div>
          : convos.length === 0 ? <div style={{ padding: 14, fontSize: 12, color: "#888" }}>Sin mensajes aún. Cuando una empresa escriba desde su portal, aparecerá aquí.</div>
          : convos.map(c => (
            <div key={c.tercero_id} onClick={() => abrir(c)}
              style={{ padding: "11px 14px", borderBottom: "0.5px solid #f0f1f3", cursor: "pointer", background: sel?.tercero_id === c.tercero_id ? "#eef2f7" : "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                {c.no_leidos > 0 && (
                  <span style={{ background: "#F47B20", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 7px", flexShrink: 0 }}>{c.no_leidos}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.ultimo}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Hilo */}
      <div style={{ flex: 1, minWidth: 320, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, display: "flex", flexDirection: "column", minHeight: 420 }}>
        {!sel ? (
          <div className="empty" style={{ margin: "auto" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
            <div style={{ fontWeight: 600 }}>Selecciona una conversación</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>o inicia una nueva con cualquier empresa</div>
          </div>
        ) : (
          <>
            <div style={{ padding: "12px 16px", borderBottom: "0.5px solid #e4e7ec" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: notif && notif.n > 0 ? 8 : 0 }}>🏢 {sel.nombre}</div>
              {/* Barra de notificación: mensajes sin leer + contacto + botón */}
              {notif && notif.n > 0 && (
                <div style={{ background: "#fff8e6", border: "1px solid #f5d9b8", borderRadius: 10, padding: "9px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#b45309", flex: 1, minWidth: 160 }}>
                      ✉️ {notif.n} mensaje(s) que el tercero aún no lee
                    </span>
                    <button onClick={() => setEditContacto(!editContacto)}
                      style={{ border: "none", background: "none", color: "#7c3aed", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                      {editContacto ? "Cerrar" : "✎ Contacto"}
                    </button>
                    <button onClick={notificar} disabled={notificando}
                      style={{ background: "#F47B20", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px",
                        fontSize: 12, fontWeight: 800, cursor: "pointer", opacity: notificando ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
                      {notificando ? "Enviando…" : "📣 Notificar por WhatsApp y correo"}
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#7a5c1e", marginTop: 5 }}>
                    Irá a: 📧 {notif.correo || <b style={{ color: "#c0392b" }}>sin correo</b>} · 📱 {notif.telefono || <b style={{ color: "#c0392b" }}>sin teléfono</b>}
                  </div>
                  {editContacto && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 8 }}>
                      <input value={notif.correo} onChange={(e) => setNotif({ ...notif, correo: e.target.value })}
                        placeholder="correo@empresa.com"
                        style={{ border: "1px solid #ddd0f7", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontFamily: "'Geist',sans-serif" }} />
                      <input value={notif.telefono} onChange={(e) => setNotif({ ...notif, telefono: e.target.value.replace(/\D/g, "").slice(-10) })}
                        placeholder="10 dígitos, sin +52"
                        style={{ border: "1px solid #ddd0f7", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontFamily: "monospace" }} />
                      <div style={{ gridColumn: "1 / -1", fontSize: 10.5, color: "#7c6f96" }}>
                        Solo para este aviso — no cambia el Perfil de Empresa. Para corregirlo de raíz, usa la pestaña Avisos.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, maxHeight: 440 }}>
              {msgs === null ? <div style={{ fontSize: 12, color: "#888" }}>Cargando…</div>
              : msgs.length === 0 ? <div style={{ fontSize: 12, color: "#888" }}>Sin mensajes. Escribe el primero abajo.</div>
              : msgs.map(m => (
                <div key={m.id} style={{ display: "flex", justifyContent: m.autor === "bigticket" ? "flex-end" : "flex-start", marginBottom: 8 }}>
                  <div style={{ maxWidth: "72%", padding: "9px 13px", borderRadius: 12, fontSize: 13, lineHeight: 1.5,
                    background: m.autor === "bigticket" ? "#1a3a6b" : "#f4f5f7",
                    color: m.autor === "bigticket" ? "#fff" : "#222",
                    borderBottomRightRadius: m.autor === "bigticket" ? 4 : 12,
                    borderBottomLeftRadius: m.autor === "bigticket" ? 12 : 4 }}>
                    {m.mensaje}
                    <div style={{ fontSize: 9, opacity: 0.6, marginTop: 4, textAlign: "right" }}>
                      {new Date(m.created_at).toLocaleString("es-MX", { timeZone: TZ_MX, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "0.5px solid #e4e7ec" }}>
              <input value={texto} onChange={e => setTexto(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Escribe tu respuesta…"
                style={{ flex: 1, background: "#f8f9fa", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontFamily: "'Geist',sans-serif" }} />
              <button className="btn-orange" onClick={enviar} disabled={!texto.trim()} style={{ padding: "10px 18px" }}>Enviar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ALTA DE VEHÍCULOS Y PERSONAL (empresas antiguas) — el analista carga desde el
// Brain con los mismos datos y fotos que los formularios del Portal de Terceros.
// Crea la certificación (Kanban B · Recepción), sube los documentos al proceso
// (visibles en la tarjeta y en el portal de la empresa) y guarda copia en el
// Archivador digital (categorías 👤 Personal / 🚚 Vehículos).
// ═══════════════════════════════════════════════════════════════════════════
const ESTADOS_MX_ALTA = [
  "AGUASCALIENTES","BAJA CALIFORNIA","BAJA CALIFORNIA SUR","CAMPECHE","CHIAPAS","CHIHUAHUA",
  "CIUDAD DE MEXICO","COAHUILA","COLIMA","DURANGO","ESTADO DE MEXICO","GUANAJUATO","GUERRERO",
  "HIDALGO","JALISCO","MICHOACAN","MORELOS","NAYARIT","NUEVO LEON","OAXACA","PUEBLA","QUERETARO",
  "QUINTANA ROO","SAN LUIS POTOSI","SINALOA","SONORA","TABASCO","TAMAULIPAS","TLAXCALA","VERACRUZ","YUCATAN","ZACATECAS",
];
const SC_LIST_ALTA = ["AMX7","ECH4","ECH5","EGD0","EGD9","EHM4","EHM5","EHP5","EHP6","ELP2","ELP3","EPB3","EQR2","ERX6","ETA4","ETG4","ETL1","ETL2","EVM2","EVR3","EZL1","SAG1","SBJ1","SCC1","SCD1","SCG1","SCH1","SCJ1","SCM1","SCN1","SCP1","SCT1","SCU1","SCV1","SCX1","SCY1","SDC1","SDG1","SEN1","SGD1","SGD2","SGD3","SGD4","SHM1","SHP1","SHP2","SJA1","SJD1","SLE1","SLP1","SLV1","SLW1","SLZ1","SMA1","SMD1","SML1","SMO1","SMT1","SMT2","SMT3","SMX1","SMX10","SMX2","SMX3","SMX4","SMX5","SMX6","SMX7","SMX8","SMX9","SMZ1","SNG1","SNL1","SOX1","SPB1","SPD1","SPV1","SPY1","SPZ1","SQR1","SQR2","SRX1","SSL1","STA1","STG1","STJ1","STL1","STL2","STN1","STP1","STR1","STT1","STX1","SUR1","SVH1","SVM1","SVR1","SXL1","SZC1","SZL1","SZM1","XSM11"];

const DOCS_PERSONA_ALTA = [
  ["ine", "INE (frente)"], ["ine_reverso", "INE (reverso)"],
  ["curp", "CURP (PDF)"], ["rfc", "Constancia RFC"], ["licencia", "Licencia de conducir"],
];
const DOCS_VEHICULO_ALTA = [
  ["foto_frente", "Foto: Frente"], ["foto_trasera", "Foto: Trasera"],
  ["foto_lado_izq", "Foto: Lado izquierdo"], ["foto_lado_der", "Foto: Lado derecho"],
  ["tarjeta_circulacion", "Tarjeta de circulación"],
  ["poliza_seguro", "Póliza de seguro"],
];

function SlotArchivoAlta({ label, file, onFile, obligatorio }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: file ? "#e8f5ec" : "#f8f9fb", border: "1px solid " + (file ? "#b7e0c2" : "#e4e7ec"), borderRadius: 9, marginBottom: 7 }}>
      <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "#333" }}>
        {file ? "✅" : "📎"} {label}{obligatorio ? " *" : ""}
        {file && <span style={{ fontWeight: 400, color: "#667085" }}> — {file.name}</span>}
      </div>
      <label style={{ background: "#fff", border: "1px solid #1a3a6b", color: "#1a3a6b", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
        {file ? "Cambiar" : "Elegir archivo"}
        <input type="file" accept="image/*,.pdf" style={{ display: "none" }}
          onChange={(e) => { const x = e.target.files?.[0]; if (x) onFile(x); e.target.value = ""; }} />
      </label>
    </div>
  );
}

function AltaVehiculosPersonal({ onCreada }) {
  const [empresas, setEmpresas] = useState(null);
  const [terceroId, setTerceroId] = useState("");
  const [tipoAlta, setTipoAlta] = useState("conductor");   // conductor | ayudante | vehiculo
  const [sc, setSc] = useState("");
  const [f, setF] = useState({ nombre: "", curp: "", rfc: "", telefono: "", email: "", licencia_numero: "", licencia_estado: "", licencia_vigencia: "" });
  const [v, setV] = useState({ placa: "", vin: "", marca: "", modelo: "", anio: "" });
  const [files, setFiles] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { tipo: 'ok'|'err', texto }
  const [padron, setPadron] = useState(null);      // padrón de la empresa seleccionada
  const cargarPadron = async (tid) => {
    if (!tid) { setPadron(null); return; }
    const { data } = await sb.from("flota_personal_terceros").select("*")
      .eq("tercero_id", tid).order("created_at", { ascending: false });
    setPadron(data || []);
  };
  useEffect(() => { cargarPadron(terceroId); }, [terceroId]);
  const esVeh = tipoAlta === "vehiculo";
  const esCond = tipoAlta === "conductor";

  useEffect(() => { (async () => {
    // Empresas dadas de baja no se ofrecen para altas nuevas
    let { data, error } = await sb.from("terceros")
      .select("id, nombre, rfc, estado_operacional").order("nombre");
    if (error) ({ data } = await sb.from("terceros").select("id, nombre, rfc").order("nombre"));
    setEmpresas((data || []).filter((e) => (e.estado_operacional || "activa") !== "baja"));
  })(); }, []);

  const inp = { width: "100%", boxSizing: "border-box", background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 11px", fontSize: 13, fontFamily: "'Geist',sans-serif" };
  const lbl = { fontSize: 10.5, fontWeight: 700, color: "#667085", textTransform: "uppercase", letterSpacing: 0.5, display: "block", marginBottom: 4 };

  // Copia al Archivador digital de la empresa (no bloquea el alta si falla)
  const copiarAArchivador = async (tid, categoria, file, referencia) => {
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const p = `${tid}/${categoria}/${Date.now()}_${safe}`;
      const { error: eUp } = await sb.storage.from("archivador_empresas").upload(p, file, { upsert: false, contentType: file.type || undefined });
      if (eUp) throw new Error(eUp.message);
      const { error: eIns } = await sb.from("documentos_empresa").insert({
        tercero_id: tid, categoria, nombre_archivo: file.name, storage_path: p,
        bucket: "archivador_empresas", mime_type: file.type || null, tamano_bytes: file.size,
        referencia: (referencia || "").slice(0, 120) || null,
        subido_por: window.__PERFIL_EMAIL || "analista_brain", origen: "brain",
      });
      if (eIns) throw new Error(eIns.message);
      return p;
    } catch (e) { console.warn("Archivador (" + file.name + "):", e.message); return null; }
  };

  const crear = async () => {
    setMsg(null);
    const falta = [];
    if (!terceroId) falta.push("Empresa");
    if (!sc) falta.push("Centro de servicio (SC)");
    if (!esVeh) {
      if (!f.nombre.trim()) falta.push("Nombre completo");
      if (!f.curp.trim()) falta.push("CURP");
      if (!f.rfc.trim()) falta.push("RFC");
      if (!f.telefono.trim()) falta.push("Teléfono");
      if (!f.email.trim() || !f.email.includes("@")) falta.push("Correo (invitación MELI)");
      if (esCond) {
        if (!f.licencia_numero.trim()) falta.push("Número de licencia");
        if (!f.licencia_estado) falta.push("Estado emisor de la licencia");
        if (!f.licencia_vigencia) falta.push("Vigencia de la licencia");
      }
      // Documentos OPCIONALES: los terceros antiguos no siempre los tienen;
      // se pueden completar después (archivador o re-certificación).
    } else {
      if (!v.placa.trim()) falta.push("Placa");
      if (!v.marca.trim()) falta.push("Marca");
      if (!v.modelo.trim()) falta.push("Modelo");
      if (!/^(19|20)\d{2}$/.test(v.anio.trim())) falta.push("Año (4 dígitos)");
      // Fotos y tarjeta también opcionales en el alta del padrón.
    }
    if (falta.length) { setMsg({ tipo: "err", texto: "Faltan campos obligatorios: " + falta.join(" · ") }); return; }

    setBusy(true);
    try {
      const emp = (empresas || []).find((e) => e.id === terceroId);
      // 1) Fila del padrón (flota_personal_terceros) — lo que YA opera de la empresa
      const datos = !esVeh ? {
        nombre: f.nombre.trim(), curp: f.curp.trim().toUpperCase(),
        rfc: f.rfc.trim().toUpperCase() || null, telefono: f.telefono || null,
        email: f.email.trim().toLowerCase(),
        licencia_numero: esCond ? (f.licencia_numero || null) : null,
        licencia_estado: esCond ? (f.licencia_estado || null) : null,
        licencia_vigencia: esCond ? (f.licencia_vigencia || null) : null,
      } : {
        placa: v.placa.trim().toUpperCase().replace(/\s/g, ""), vin: v.vin.trim().toUpperCase() || null,
        marca: v.marca.trim().toUpperCase(), modelo: v.modelo.trim().toUpperCase(), anio: Number(v.anio.trim()),
      };
      const { data: fila, error } = await sb.from("flota_personal_terceros").insert({
        tercero_id: terceroId, tipo: tipoAlta, estado: "activo", origen: "alta_brain",
        service_center: sc, creado_por: window.__PERFIL_EMAIL || "analista_brain", ...datos,
      }).select().single();
      if (error) throw new Error(error.message + (error.code === "42P01" ? " — corre flota_personal.sql" : ""));

      // 2) Documentos → Archivador digital (👤 Personal / 🚚 Vehículos) + referencia en la fila
      const catArch = esVeh ? "vehiculos" : "personal";
      const ref = esVeh ? `Vehículo ${datos.placa}` : `${esCond ? "Driver" : "Ayudante"} ${datos.nombre}`;
      const etiquetas = Object.fromEntries(esVeh ? DOCS_VEHICULO_ALTA : DOCS_PERSONA_ALTA);
      const docsJson = []; let total = 0;
      for (const [t, file] of Object.entries(files)) if (file) {
        total++;
        const pth = await copiarAArchivador(terceroId, catArch, file, ref);
        if (pth) docsJson.push({ tipo: t, label: etiquetas[t] || t, storage_path: pth, bucket: "archivador_empresas" });
      }
      if (docsJson.length) await sb.from("flota_personal_terceros").update({ documentos: docsJson }).eq("id", fila.id);

      setMsg({ tipo: "ok", texto: `✅ ${esVeh ? "Vehículo " + datos.placa : datos.nombre} quedó registrado como ${esVeh ? "unidad activa" : "personal activo"} de ${emp?.nombre || "la empresa"} — ya aparece en el padrón de abajo y en la sección "Vehículos y Personal" del portal de la empresa${total ? ` — ${docsJson.length}/${total} documento(s) en su Archivador` : " (sin documentos adjuntos; puedes cargarlos después)"}.` });
      setFiles({});
      setF({ nombre: "", curp: "", rfc: "", telefono: "", email: "", licencia_numero: "", licencia_estado: "", licencia_vigencia: "" });
      setV({ placa: "", vin: "", marca: "", modelo: "", anio: "" });
      cargarPadron(terceroId);
      if (onCreada) onCreada();
    } catch (e) { setMsg({ tipo: "err", texto: "No se pudo crear el alta: " + e.message }); }
    finally { setBusy(false); }
  };

  const docsAlta = esVeh ? DOCS_VEHICULO_ALTA : DOCS_PERSONA_ALTA.filter(([t]) => t !== "licencia" || esCond);

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "20px 22px" }}>
        <div className="form-title" style={{ marginTop: 0 }}>➕ Alta de Vehículos y Personal (empresas antiguas)</div>
        <div style={{ fontSize: 12, color: "#667085", marginBottom: 16, lineHeight: 1.55 }}>
          Padrón de lo que <b>ya opera</b>: carga los vehículos y el personal vigentes de una empresa antigua, con los
          mismos datos y fotos del Portal de Terceros. La empresa lo ve en su portal (sección "Vehículos y Personal"),
          los documentos quedan en su Archivador digital, y toda certificación nueva que termine <b>Aceptada</b> se suma sola a este padrón.
        </div>

        {/* Empresa + tipo de alta */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={lbl}>Empresa *</label>
            <select value={terceroId} onChange={(e) => setTerceroId(e.target.value)} style={inp}>
              <option value="">{empresas === null ? "Cargando empresas…" : "Selecciona la empresa…"}</option>
              {(empresas || []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}{e.rfc ? (String(e.rfc).toUpperCase().startsWith("PENDIENTE") ? " · ⚠ RFC pendiente" : ` · ${e.rfc}`) : ""}
                  {(e.estado_operacional || "activa") === "pausada" ? " · ⏸ pausada" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={lbl}>Tipo de alta</label>
            <div style={{ display: "flex", gap: 6 }}>
              {[["conductor", "🚗 Driver"], ["ayudante", "🧰 Ayudante"], ["vehiculo", "🚚 Vehículo"]].map(([t, l]) => (
                <button key={t} onClick={() => { setTipoAlta(t); setFiles({}); setMsg(null); }}
                  style={{ padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontFamily: "'Geist',sans-serif",
                    fontWeight: tipoAlta === t ? 700 : 500,
                    background: tipoAlta === t ? "#1a3a6b" : "#fff", color: tipoAlta === t ? "#fff" : "#555",
                    border: tipoAlta === t ? "1.5px solid #1a3a6b" : "1px solid #e4e7ec" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>Centro de servicio (SC) *</label>
          <input list="sc-list-alta" value={sc} onChange={(e) => setSc(e.target.value.toUpperCase())} placeholder="Escribe o elige: SMX10, STX1…" style={{ ...inp, maxWidth: 260 }} />
          <datalist id="sc-list-alta">{SC_LIST_ALTA.map((s) => <option key={s} value={s} />)}</datalist>
        </div>

        {/* Datos persona */}
        {!esVeh && (
          <>
            <div className="form-title" style={{ fontSize: 13 }}>Datos personales</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 6 }}>
              <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>Nombre completo *</label>
                <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Nombre y apellidos" style={inp} /></div>
              <div><label style={lbl}>CURP *</label><input value={f.curp} maxLength={18} onChange={(e) => setF({ ...f, curp: e.target.value })} placeholder="18 caracteres" style={inp} /></div>
              <div><label style={lbl}>RFC *</label><input value={f.rfc} maxLength={13} onChange={(e) => setF({ ...f, rfc: e.target.value })} placeholder="13 caracteres" style={inp} /></div>
              <div><label style={lbl}>Teléfono *</label><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="10 dígitos" style={inp} /></div>
              <div><label style={lbl}>Correo (invitación MELI) *</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="correo@ejemplo.com" style={inp} />
                <div style={{ fontSize: 10.5, color: "#667085", marginTop: 3 }}>📩 A este correo llega la invitación de MELI.</div></div>
            </div>
            {esCond && (
              <>
                <div className="form-title" style={{ fontSize: 13 }}>Licencia de conducir</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 6 }}>
                  <div><label style={lbl}>Número *</label><input value={f.licencia_numero} onChange={(e) => setF({ ...f, licencia_numero: e.target.value })} style={inp} /></div>
                  <div><label style={lbl}>Estado emisor *</label>
                    <select value={f.licencia_estado} onChange={(e) => setF({ ...f, licencia_estado: e.target.value })} style={inp}>
                      <option value="">Selecciona…</option>{ESTADOS_MX_ALTA.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select></div>
                  <div><label style={lbl}>Vigencia *</label><input type="date" value={f.licencia_vigencia} onChange={(e) => setF({ ...f, licencia_vigencia: e.target.value })} style={inp} /></div>
                </div>
              </>
            )}
          </>
        )}

        {/* Datos vehículo */}
        {esVeh && (
          <>
            <div className="form-title" style={{ fontSize: 13 }}>Datos de la unidad</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 6 }}>
              <div><label style={lbl}>Placa *</label><input value={v.placa} onChange={(e) => setV({ ...v, placa: e.target.value })} placeholder="ABC1234" style={inp} /></div>
              <div><label style={lbl}>VIN (opcional)</label><input value={v.vin} onChange={(e) => setV({ ...v, vin: e.target.value })} style={inp} /></div>
              <div><label style={lbl}>Año *</label><input value={v.anio} maxLength={4} onChange={(e) => setV({ ...v, anio: e.target.value })} placeholder="2019" style={inp} /></div>
              <div><label style={lbl}>Marca *</label><input value={v.marca} onChange={(e) => setV({ ...v, marca: e.target.value })} placeholder="NISSAN" style={inp} /></div>
              <div><label style={lbl}>Modelo *</label><input value={v.modelo} onChange={(e) => setV({ ...v, modelo: e.target.value })} placeholder="URVAN" style={inp} /></div>
            </div>
            <div style={{ fontSize: 11, color: "#8a4a0f", background: "#fff4e5", border: "1px solid #fcd9b6", borderRadius: 8, padding: "7px 10px", marginBottom: 8 }}>
              ⏳ Recuerda: unidades con más de 15 años no son certificables.
            </div>
          </>
        )}

        {/* Documentos */}
        <div className="form-title" style={{ fontSize: 13 }}>📎 Documentos {esVeh ? "de la unidad" : "de la persona"} <span style={{ fontWeight: 400, color: "#98a2b3", fontSize: 11 }}>(opcionales — carga los que tengas; el resto se puede completar después)</span></div>
        {docsAlta.map(([t, l]) => (
          <SlotArchivoAlta key={t} label={l} file={files[t]} onFile={(x) => setFiles((p) => ({ ...p, [t]: x }))} />
        ))}

        {msg && (
          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, lineHeight: 1.55,
            background: msg.tipo === "ok" ? "#e8f5ec" : "#fdecea", border: "1px solid " + (msg.tipo === "ok" ? "#b7e0c2" : "#f5c6c0"),
            color: msg.tipo === "ok" ? "#166534" : "#c0392b" }}>
            {msg.texto}
          </div>
        )}

        <button onClick={crear} disabled={busy}
          style={{ width: "100%", marginTop: 14, background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
          {busy ? "Registrando…" : "✓ Registrar en el padrón y cargar documentos"}
        </button>
      </div>

      {/* Padrón vigente de la empresa seleccionada */}
      {terceroId && padron !== null && (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: "16px 20px", marginTop: 14 }}>
          <div className="form-title" style={{ marginTop: 0 }}>
            📋 Padrón vigente ({padron.filter((r) => r.estado !== "baja").length} activos{padron.some((r) => r.estado === "baja") ? ` · ${padron.filter((r) => r.estado === "baja").length} en baja` : ""})
          </div>
          {padron.length === 0 ? (
            <div style={{ fontSize: 12, color: "#888" }}>Sin registros aún — lo que cargues aquí y las certificaciones que queden Aceptadas aparecerán en esta lista y en el portal de la empresa.</div>
          ) : padron.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f4f5f7", opacity: r.estado === "baja" ? 0.55 : 1 }}>
              <span style={{ fontSize: 17 }}>{r.tipo === "vehiculo" ? "🚚" : r.tipo === "ayudante" ? "🧰" : "🚗"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.tipo === "vehiculo" ? `${r.placa || "—"} · ${[r.marca, r.modelo, r.anio].filter(Boolean).join(" ")}` : r.nombre || "—"}
                </div>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {r.service_center || "sin SC"} · {r.origen === "certificacion" ? "✅ Vía certificación aceptada" : r.origen === "bitacora" ? "📡 Confirmación de terreno" : r.origen === "seed_flota_semanal" ? "📦 Seed flota" : "➕ Alta directa del analista"} · {(r.documentos || []).length} doc(s)
                </div>
              </div>
              <span style={{ fontSize: 9.5, fontWeight: 800, padding: "3px 9px", borderRadius: 12, background: r.estado === "baja" ? "#fdecea" : "#e8f5ec", color: r.estado === "baja" ? "#c0392b" : "#166534" }}>
                {r.estado === "baja" ? "BAJA" : "ACTIVO"}
              </span>
              <button onClick={async () => {
                const nuevo = r.estado === "baja" ? "activo" : "baja";
                if (!confirm(nuevo === "baja" ? "¿Dar de baja este registro del padrón? (la empresa lo verá como Baja)" : "¿Reactivar este registro?")) return;
                const { error } = await sb.from("flota_personal_terceros").update({ estado: nuevo, actualizado_at: new Date().toISOString() }).eq("id", r.id);
                if (error) { alert("No se pudo actualizar: " + error.message); return; }
                cargarPadron(terceroId);
              }} style={{ background: "#fff", color: r.estado === "baja" ? "#166534" : "#c0392b", border: "1px solid " + (r.estado === "baja" ? "#b7e0c2" : "#f0c4c4"), borderRadius: 7, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                {r.estado === "baja" ? "Reactivar" : "Dar de baja"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── 🔔 AVISOS Y RECORDATORIOS ────────────────────────────────────────
// Lo que Certificaciones le pidió a un tercero y sigue sin resolverse.
// Ciclo: pendiente → (3 días) avisado por correo + WhatsApp → (lunes
// siguiente) escalado, con la prefactura del tercero en pausa.
// El barrido de 3 días y el del lunes corren en n8n; esta pestaña es la
// vista del analista y el punto donde se cierra o se libera a mano.
const SOL_TIPOS = {
  firma_contrato:      { label: "Firma de contrato",       icon: "✍️" },
  firma_anexo:         { label: "Firma de anexo",          icon: "📎" },
  actualizacion_datos: { label: "Actualización de datos",  icon: "🏢" },
  documento_pendiente: { label: "Documento pendiente",     icon: "📄" },
  otro:                { label: "Otro",                    icon: "•" },
};
const SOL_ESTADOS = {
  pendiente: { label: "Pendiente",        color: "#166534", bg: "#e8f5ec", border: "#c3e6cd" },
  avisado:   { label: "Aviso enviado",    color: "#b45309", bg: "#fff8e6", border: "#f5d9b8" },
  escalado:  { label: "Escalado",         color: "#c0392b", bg: "#fbeaea", border: "#f0b4b4" },
  cumplida:  { label: "Cumplida",         color: "#0f766e", bg: "#e7f5f2", border: "#c4e6df" },
  anulada:   { label: "Anulada",          color: "#667085", bg: "#f2f4f7", border: "#e4e7ec" },
};
const WEBHOOK_AVISO_MANUAL = "https://bigticket2026.app.n8n.cloud/webhook/aviso-solicitud-tercero";

// De dónde sale cada dato de contacto, para que el analista sepa qué está
// corrigiendo: el perfil lo llena el tercero en su portal.
const ORIGEN_CONTACTO = {
  editado:  { label: "editado aquí",   color: "#7c3aed" },
  perfil:   { label: "perfil empresa", color: "#0f766e" },
  portal:   { label: "acceso portal",  color: "#1a3a6b" },
  sin_dato: { label: "sin dato",       color: "#c0392b" },
};

function EditorContacto({ row, onGuardado, onCancelar }) {
  const [correo, setCorreo] = useState(row.correo_envio || "");
  const [tel, setTel] = useState(row.telefono_envio || "");
  const [enPerfil, setEnPerfil] = useState(true);
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    setBusy(true);
    try {
      const { data, error } = await sb.rpc("actualizar_contacto_solicitud", {
        p_id: row.id, p_email: correo, p_telefono: tel,
        p_guardar_en_perfil: enPerfil, p_usuario: window.__PERFIL_EMAIL || "brain",
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error);
      if (enPerfil && data && data.perfil_actualizado === false)
        alert("Guardado para este aviso. Ojo: la empresa aún no tiene Perfil de Empresa creado, así que no se pudo corregir en la raíz.");
      onGuardado();
    } catch (e) { alert("No se pudo guardar: " + e.message); }
    finally { setBusy(false); }
  };

  const inp = { width: "100%", boxSizing: "border-box", border: "1px solid #ddd0f7", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, fontFamily: "'Geist',sans-serif", background: "#fff" };
  const lb = { fontSize: 9.5, fontWeight: 700, color: "#7c6f96", textTransform: "uppercase", marginBottom: 3, display: "block" };

  return (
    <div style={{ marginTop: 10, background: "#faf7ff", border: "1px solid #ddd0f7", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
        ✎ Contacto de este aviso
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div><span style={lb}>Correo</span>
          <input value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="correo@empresa.com" style={inp} /></div>
        <div><span style={lb}>WhatsApp · 10 dígitos</span>
          <input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="5512345678"
            style={{ ...inp, fontFamily: "monospace" }} />
          <div style={{ fontSize: 10, color: "#888", marginTop: 3 }}>Sin +52 ni espacios.</div>
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, fontSize: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={enPerfil} onChange={(e) => setEnPerfil(e.target.checked)} style={{ marginTop: 2 }} />
        <span>
          <b>Guardar también en el Perfil de Empresa</b>
          <div style={{ fontSize: 11, color: "#7c6f96" }}>
            Corrige la raíz: sirve para los avisos siguientes y para las notificaciones
            de documentos fallidos, que leen los mismos campos. Sin esto, el cambio
            aplica solo a este aviso.
          </div>
        </span>
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={guardar} disabled={busy}
          style={{ flex: 1, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
          {busy ? "Guardando…" : "💾 Guardar contacto"}
        </button>
        <button onClick={onCancelar}
          style={{ border: "1px solid #ddd0f7", background: "#fff", color: "#7c3aed", borderRadius: 8, padding: "10px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function AvisosRecordatorios({ onContador }) {
  const [editando, setEditando] = useState(null);   // id de la solicitud en edición
  const [rows, setRows] = useState(null);
  const [bloqueos, setBloqueos] = useState([]);
  const [filtro, setFiltro] = useState("atencion");   // atencion | todas | cumplidas
  const [busca, setBusca] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [nueva, setNueva] = useState(false);
  const [terceros, setTerceros] = useState([]);
  const [f, setF] = useState({ tercero_id: "", tipo: "actualizacion_datos", titulo: "", detalle: "", dias_plazo: 3 });

  const cargar = async () => {
    const [{ data: sols }, { data: blo }] = await Promise.all([
      sb.from("vw_solicitudes_tercero").select("*").order("solicitado_at", { ascending: false }).limit(400),
      sb.from("vw_terceros_bloqueados_prefactura").select("*"),
    ]);
    setRows(sols || []);
    setBloqueos(blo || []);
    if (onContador) onContador((sols || []).filter((r) => r.estado === "avisado" || r.estado === "escalado"
      || (r.estado === "pendiente" && r.semaforo === "amarillo")).length);
  };
  useEffect(() => { cargar(); (async () => {
    const { data } = await sb.from("terceros").select("id, nombre, email_portal").order("nombre");
    setTerceros(data || []);
  })(); }, []);
  // Refresco suave: los barridos de n8n cambian estados mientras la
  // pestaña está abierta.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 60000);
    return () => clearInterval(t);
  }, []);

  const crear = async () => {
    if (!f.tercero_id || !f.titulo.trim()) { alert("Selecciona la empresa y escribe qué se le solicita."); return; }
    setBusyId("nueva");
    try {
      const { data, error } = await sb.rpc("crear_solicitud_tercero", {
        p_tercero_id: f.tercero_id, p_tipo: f.tipo, p_titulo: f.titulo.trim(),
        p_detalle: f.detalle.trim() || null, p_origen: "manual",
        p_email: window.__PERFIL_EMAIL || "brain",
        p_dias_plazo: parseInt(f.dias_plazo, 10) || 3,
      });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error);
      if (data && data.duplicada) alert("Ya existía una solicitud viva del mismo tipo para esa empresa — no se duplicó.");
      setNueva(false);
      setF({ tercero_id: "", tipo: "actualizacion_datos", titulo: "", detalle: "", dias_plazo: 3 });
      await cargar();
    } catch (e) { alert("No se pudo crear: " + e.message); }
    finally { setBusyId(null); }
  };

  const cumplir = async (r) => {
    if (!confirm(`¿Marcar como cumplida "${r.titulo}"?\n\nSi la empresa tenía la prefactura en pausa por esta solicitud, se libera.`)) return;
    setBusyId(r.id);
    try {
      const { data, error } = await sb.rpc("cumplir_solicitud_tercero", { p_id: r.id, p_email: window.__PERFIL_EMAIL || "brain" });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error);
      if (data && data.escaladas_restantes > 0)
        alert(`Cumplida. Atención: a esta empresa le quedan ${data.escaladas_restantes} solicitud(es) escalada(s), así que la prefactura sigue en pausa.`);
      await cargar();
    } catch (e) { alert("No se pudo cerrar: " + e.message); }
    finally { setBusyId(null); }
  };

  const anular = async (r) => {
    const motivo = prompt("Motivo de la anulación (mínimo 10 caracteres):", "");
    if (motivo === null) return;
    setBusyId(r.id);
    try {
      const { data, error } = await sb.rpc("anular_solicitud_tercero", { p_id: r.id, p_motivo: motivo, p_email: window.__PERFIL_EMAIL || "brain" });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error);
      await cargar();
    } catch (e) { alert("No se pudo anular: " + e.message); }
    finally { setBusyId(null); }
  };

  // Reenvío manual del aviso (mismo flujo de n8n que el barrido de 3 días).
  const reenviar = async (r) => {
    if (!r.correo_envio && !r.telefono_envio) {
      alert("Esta empresa no tiene correo ni teléfono: no hay por dónde avisarle.\n\nCorrige el contacto con «✎ Editar contacto» antes de reenviar."); return;
    }
    const canales = [r.correo_envio && `correo (${r.correo_envio})`, r.telefono_envio && `WhatsApp (${r.telefono_envio})`].filter(Boolean).join(" y ");
    if (!confirm(`¿Reenviar el aviso de "${r.titulo}" a ${r.razon_social || r.empresa || "la empresa"}?\n\nSale por ${canales}.`)) return;
    setBusyId(r.id);
    try {
      const resp = await fetch(WEBHOOK_AVISO_MANUAL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ solicitud_id: r.id, origen: "brain_manual" }),
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(txt || "el servicio de avisos no respondió");
      await cargar();
      alert("Aviso reenviado.");
    } catch (e) { alert("No se pudo reenviar: " + e.message); }
    finally { setBusyId(null); }
  };

  const liberar = async (b) => {
    const motivo = prompt(`Liberar la prefactura de ${b.empresa || "la empresa"} sin que regularice.\n\nMotivo (mínimo 10 caracteres, queda auditado):`, "");
    if (motivo === null) return;
    try {
      const { data, error } = await sb.rpc("liberar_bloqueo_prefactura", { p_tercero_id: b.tercero_id, p_motivo: motivo, p_email: window.__PERFIL_EMAIL || "brain" });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error);
      await cargar();
    } catch (e) { alert("No se pudo liberar: " + e.message); }
  };

  const vivas = (rows || []).filter((r) => ["pendiente", "avisado", "escalado"].includes(r.estado));
  const nAtencion = vivas.filter((r) => r.estado !== "pendiente" || r.semaforo === "amarillo").length;
  const nEscaladas = vivas.filter((r) => r.estado === "escalado").length;

  const q = busca.trim().toLowerCase();
  const visibles = (rows || []).filter((r) => {
    if (filtro === "atencion" && !(["pendiente", "avisado", "escalado"].includes(r.estado)
      && (r.estado !== "pendiente" || r.semaforo === "amarillo"))) return false;
    if (filtro === "todas" && !["pendiente", "avisado", "escalado"].includes(r.estado)) return false;
    if (filtro === "cumplidas" && !["cumplida", "anulada"].includes(r.estado)) return false;
    if (!q) return true;
    return `${r.empresa || ""} ${r.titulo || ""} ${r.detalle || ""}`.toLowerCase().includes(q);
  });

  const Kpi = ({ label, valor, color, bg }) => (
    <div style={{ flex: "1 1 130px", background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
    </div>
  );

  const inp = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 11px", fontSize: 13, fontFamily: "'Geist',sans-serif", background: "#fff" };
  const lbl = { fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", marginBottom: 4, display: "block" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="sec-title" style={{ margin: 0, flex: 1 }}>🔔 Avisos y Recordatorios</div>
        <button onClick={() => setNueva(!nueva)}
          style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "#1a3a6b", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
          {nueva ? "✕ Cancelar" : "➕ Nueva solicitud"}
        </button>
        <button onClick={cargar}
          style={{ padding: "9px 14px", borderRadius: 8, border: "0.5px solid #e4e7ec", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
          🔄 Actualizar
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Requieren atención" valor={nAtencion} color="#b45309" bg="#fff8e6" />
        <Kpi label="Escaladas" valor={nEscaladas} color="#c0392b" bg="#fbeaea" />
        <Kpi label="Prefacturas en pausa" valor={bloqueos.length} color="#7c3aed" bg="#f5f0fe" />
        <Kpi label="Vivas en total" valor={vivas.length} color="#1a3a6b" bg="#eef2f7" />
      </div>

      {/* Prefacturas pausadas: lo que el motor de Pagos debe respetar */}
      {bloqueos.length > 0 && (
        <div style={{ background: "#fbeaea", border: "1px solid #f0b4b4", borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#c0392b", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
            🚫 Prefactura en pausa por documentación pendiente
          </div>
          {bloqueos.map((b) => (
            <div key={b.tercero_id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "7px 0", borderBottom: "1px solid #f5d0d0", fontSize: 13 }}>
              <span style={{ fontWeight: 700, flex: 1, minWidth: 180 }}>{b.empresa || b.tercero_id}</span>
              <span style={{ fontSize: 12, color: "#8b3a3a" }}>{b.motivos}</span>
              <span style={{ fontSize: 11.5, color: "#888" }}>desde {b.desde ? fMX(b.desde, { day: "2-digit", month: "short" }) : "—"}</span>
              <button onClick={() => liberar(b)}
                style={{ border: "1px solid #c0392b", background: "#fff", color: "#c0392b", borderRadius: 7, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                Liberar con motivo
              </button>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#8b3a3a", marginTop: 8 }}>
            El motor de Pagos consulta <b>vw_terceros_bloqueados_prefactura</b> antes de enviar la prefactura.
          </div>
        </div>
      )}

      {/* Nueva solicitud manual */}
      {nueva && (
        <div className="form-card" style={{ marginBottom: 14 }}>
          <div className="form-title" style={{ marginTop: 0 }}>➕ Solicitar algo a una empresa</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div><span style={lbl}>Empresa *</span>
              <select value={f.tercero_id} onChange={(e) => setF({ ...f, tercero_id: e.target.value })} style={inp}>
                <option value="">Selecciona…</option>
                {terceros.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select></div>
            <div><span style={lbl}>Tipo *</span>
              <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} style={inp}>
                {Object.entries(SOL_TIPOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></div>
            <div><span style={lbl}>Días de plazo antes del aviso</span>
              <input type="number" min="0" value={f.dias_plazo} onChange={(e) => setF({ ...f, dias_plazo: e.target.value })} style={{ ...inp, fontFamily: "monospace" }} /></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <span style={lbl}>Qué se le solicita *</span>
            <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })}
              placeholder="Ej. Actualizar datos de empresa en el portal" style={inp} />
          </div>
          <div style={{ marginTop: 10 }}>
            <span style={lbl}>Detalle (va en el correo)</span>
            <textarea value={f.detalle} onChange={(e) => setF({ ...f, detalle: e.target.value })} rows={2}
              placeholder="Qué debe hacer exactamente y dónde" style={{ ...inp, resize: "vertical" }} />
          </div>
          <button onClick={crear} disabled={busyId === "nueva"}
            style={{ width: "100%", marginTop: 12, background: "#1a3a6b", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: busyId === "nueva" ? 0.6 : 1, fontFamily: "'Geist',sans-serif" }}>
            {busyId === "nueva" ? "Creando…" : "✓ Crear solicitud"}
          </button>
          <div style={{ fontSize: 11, color: "#888", marginTop: 8, textAlign: "center" }}>
            El recordatorio por correo y WhatsApp sale solo cuando se cumplan los días de plazo.
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {[["atencion", `⚠️ Requieren atención (${nAtencion})`], ["todas", `Todas las vivas (${vivas.length})`], ["cumplidas", "Cerradas"]].map(([v, l]) => (
          <button key={v} onClick={() => setFiltro(v)}
            style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontFamily: "'Geist',sans-serif",
              fontWeight: filtro === v ? 700 : 500,
              background: filtro === v ? "#1a3a6b" : "#fff", color: filtro === v ? "#fff" : "#555",
              border: filtro === v ? "1.5px solid #1a3a6b" : "1px solid #e4e7ec" }}>{l}</button>
        ))}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔍 Empresa o solicitud…"
          style={{ ...inp, flex: 1, minWidth: 180, width: "auto" }} />
      </div>

      {/* Listado */}
      {rows === null ? (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: 24, textAlign: "center", color: "#888", fontSize: 13 }}>Cargando solicitudes…</div>
      ) : visibles.length === 0 ? (
        <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✅</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Nada pendiente por avisar</div>
          <div style={{ fontSize: 12, color: "#888" }}>Las solicitudes aparecen aquí en cuanto se envía un contrato a firma o se pide una actualización.</div>
        </div>
      ) : visibles.map((r) => {
        const est = SOL_ESTADOS[r.estado] || SOL_ESTADOS.pendiente;
        const tp = SOL_TIPOS[r.tipo] || SOL_TIPOS.otro;
        const amarillo = r.estado === "avisado" || (r.estado === "pendiente" && r.semaforo === "amarillo");
        return (
          <div key={r.id} style={{ background: "#fff", border: "0.5px solid #e4e7ec",
            borderLeft: `4px solid ${est.color}`, borderRadius: 12, padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{tp.icon} {r.titulo}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 20, background: est.bg, color: est.color, border: `1px solid ${est.border}` }}>
                    {est.label}
                  </span>
                  {/* Aviso amarillo en la línea de la solicitud */}
                  {amarillo && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#fff8e6", color: "#b45309", border: "1px solid #f5d9b8" }}>
                      ⚠️ {r.estado === "avisado"
                        ? `Aviso enviado hace ${r.dias_desde_aviso ?? 0} día(s)`
                        : `${r.dias_solicitada} días sin respuesta — se avisará en el próximo barrido`}
                    </span>
                  )}
                  {r.prefactura_bloqueada && (
                    <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#fbeaea", color: "#c0392b", border: "1px solid #f0b4b4" }}>
                      🚫 Prefactura en pausa
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b" }}>{r.razon_social || r.empresa || "— empresa sin crear —"}</div>
                {r.detalle && <div style={{ fontSize: 12, color: "#667085", marginTop: 2 }}>{r.detalle}</div>}

                {/* A dónde va a salir el aviso, y de dónde sale ese dato */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 6,
                  background: "#f8f9fb", border: "1px solid #eceff4", borderRadius: 8, padding: "6px 10px" }}>
                  {[["📧", r.correo_envio, r.correo_origen], ["📱", r.telefono_envio, r.telefono_origen]].map(([ic, val, org], ix) => {
                    const o = ORIGEN_CONTACTO[org] || ORIGEN_CONTACTO.sin_dato;
                    return (
                      <span key={ix} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                        {ic} <span style={{ fontWeight: 600, color: val ? "#1a1a1a" : "#c0392b" }}>
                          {val || (ix === 0 ? "sin correo" : "sin teléfono — no habrá WhatsApp")}
                        </span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: o.color, background: "#fff",
                          border: `1px solid ${o.color}33`, borderRadius: 20, padding: "1px 7px" }}>{o.label}</span>
                      </span>
                    );
                  })}
                  <button onClick={() => setEditando(editando === r.id ? null : r.id)}
                    style={{ border: "none", background: "none", color: "#7c3aed", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif", padding: 0 }}>
                    {editando === r.id ? "Cerrar" : "✎ Editar contacto"}
                  </button>
                </div>
                {editando === r.id && (
                  <EditorContacto row={r}
                    onGuardado={() => { setEditando(null); cargar(); }}
                    onCancelar={() => setEditando(null)} />
                )}
                <div style={{ fontSize: 11.5, color: "#888", marginTop: 3 }}>
                  Solicitada el {fMX(r.solicitado_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" · "}{r.dias_solicitada} día(s)
                  {r.aviso_at && <> · aviso {fMX(r.aviso_at, { day: "2-digit", month: "short" })}</>}
                  {r.escalar_desde && r.estado === "avisado" && <> · escala el {String(r.escalar_desde)}</>}
                  {r.escalado_at && <> · escalada el {fMX(r.escalado_at, { day: "2-digit", month: "short" })}</>}
                  {r.aviso_canales && <> · canales: {Object.entries(r.aviso_canales).map(([k, v]) => `${k}=${v}`).join(", ")}</>}
                </div>
              </div>
              {["pendiente", "avisado", "escalado"].includes(r.estado) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => cumplir(r)} disabled={busyId === r.id}
                    style={{ border: "none", background: "#0f766e", color: "#fff", borderRadius: 7, padding: "7px 13px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                    ✓ Cumplida
                  </button>
                  <button onClick={() => reenviar(r)} disabled={busyId === r.id}
                    style={{ border: "1px solid #e4e7ec", background: "#fff", color: "#1a3a6b", borderRadius: 7, padding: "7px 13px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                    ↻ Reenviar aviso
                  </button>
                  <button onClick={() => anular(r)} disabled={busyId === r.id}
                    style={{ border: "none", background: "none", color: "#c0392b", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif" }}>
                    Anular
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ─── 📊 TABLERO DE CONTROL · SLA de supervisores ──────────────────────
// Mide el cumplimiento de llamadas y entrevistas para el bono de SLA.
// Una tarea CUMPLE si se cerró antes de su sla_vence_at. Las reactivaciones
// se cuentan aparte: extender el plazo no borra que se extendió.
//
// Los nombres de las columnas de cierre varían según la tabla, así que se
// detectan sobre la fila en vez de asumirse (esa suposición ya costó caro).
const CIERRE_RE = /^(completad|completo|cerrad|resuelt|finalizad|atendid)/i;
const fechaCierre = (t) => {
  for (const [k, v] of Object.entries(t || {})) {
    if (!v || typeof v !== "string") continue;
    if (CIERRE_RE.test(k) && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
  }
  return null;
};
const TIPO_LBL = { llamada_prospecto: "Llamada", entrevista_prospecto: "Entrevista" };

function TableroControl() {
  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const primeroMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const [modo, setModo] = useState("mes");            // dia | rango | mes
  const [desde, setDesde] = useState(iso(primeroMes));
  const [hasta, setHasta] = useState(iso(hoy));
  const [mes, setMes] = useState(iso(hoy).slice(0, 7));
  const [rows, setRows] = useState(null);
  const [reacts, setReacts] = useState([]);
  const [padron, setPadron] = useState([]);      // supervisores_bt activos
  const [fSup, setFSup] = useState("todos");
  const [fSC, setFSC] = useState("todos");
  const [verSinTareas, setVerSinTareas] = useState(true);

  // El padrón es la fuente de verdad de qué SC atiende cada supervisor.
  // scs_asignados es jsonb (array): se compara en JS, no con = ANY().
  const [errPadron, setErrPadron] = useState(null);
  // El padrón vive en padron_sc_supervisor: una fila por SC, sin el RLS de
  // supervisores_bt (que está pensado para que cada supervisor vea solo su
  // propia fila y por eso deja al Brain sin datos).
  const cargarPadron = async () => {
    const { data, error } = await sb.from("padron_sc_supervisor")
      .select("sc, supervisor, email, activo").order("sc");
    if (error) { setErrPadron(error.message); setPadron([]); return; }
    const act = (data || []).filter((x) => x.activo !== false);
    setPadron(act);
    setErrPadron(act.length ? null : "La tabla padron_sc_supervisor está vacía — corre padron_sc_supervisor.sql");
  };
  useEffect(() => { cargarPadron(); }, []);
  const supDeSC = (sc) => {
    if (!sc) return null;
    const f = padron.find((p) => String(p.sc).toUpperCase() === String(sc).toUpperCase());
    return f ? { nombre: f.supervisor, email: f.email } : null;
  };
  const nombrePorEmail = (mail) => {
    if (!mail) return null;
    const p = padron.find((x) => String(x.email || "").toLowerCase() === String(mail).toLowerCase());
    if (p) return p.supervisor;
    // Sin ficha en el padrón: se arma un nombre legible del correo en vez
    // de mostrar la dirección cruda en un reporte de bonos.
    const l = String(mail).split("@")[0].replace(/[._-]+/g, " ");
    return l.replace(/\b\w/g, (c) => c.toUpperCase());
  };

  // Rango efectivo según el modo elegido
  const rango = (() => {
    if (modo === "mes") {
      const [a, m] = mes.split("-").map(Number);
      return { ini: `${mes}-01`, fin: iso(new Date(a, m, 0)) };
    }
    if (modo === "dia") return { ini: desde, fin: desde };
    return { ini: desde, fin: hasta };
  })();

  const cargar = async () => {
    setRows(null);
    const desdeTs = `${rango.ini}T00:00:00`;
    const hastaTs = `${rango.fin}T23:59:59`;
    // Hay DOS orígenes de reactivación y hay que sumar los dos:
    //  · sla_reactivaciones      → botón "🔄 Reactivar plazo" (el habitual)
    //  · tareas_reactivaciones   → repetir entrevista/llamada ya ejecutada
    const [{ data: tareas }, { data: reaSla }, { data: reaTar }] = await Promise.all([
      sb.from("tareas_supervisor").select("*")
        .in("tipo_tarea", ["llamada_prospecto", "entrevista_prospecto"])
        .gte("created_at", desdeTs).lte("created_at", hastaTs)
        .order("created_at", { ascending: false }).limit(3000),
      sb.from("sla_reactivaciones").select("*").limit(5000),
      sb.from("tareas_reactivaciones").select("*").limit(5000),
    ]);
    // Los nombres de las llaves varían entre las dos tablas, así que se
    // recogen todos los valores que puedan ser el id de la tarea.
    const clavesId = (r) => Object.entries(r || {})
      .filter(([k, v]) => v && /tarea|registro/i.test(k))
      .map(([, v]) => String(v));
    setReacts([...(reaSla || []), ...(reaTar || [])].map((r) => ({ ids: clavesId(r) })));
    setRows(tareas || []);
  };
  useEffect(() => { cargar(); }, [modo, desde, hasta, mes]);

  // Una fila por tarea, con su veredicto de SLA
  const detalle = (rows || []).map((t) => {
    const cierre = fechaCierre(t);
    const vence = t.sla_vence_at;
    const abierta = t.estado === "pendiente";
    const nReact = (reacts || []).filter((r) =>
      r.ids.includes(String(t.id)) || r.ids.includes(String(t.registro_id))).length;
    let veredicto;
    if (cierre && vence) veredicto = new Date(cierre) <= new Date(vence) ? "CUMPLE" : "NO CUMPLE";
    else if (abierta && vence && new Date() > new Date(vence)) veredicto = "NO CUMPLE";
    else if (abierta) veredicto = "EN CURSO";
    else veredicto = cierre ? "CUMPLE" : "SIN DATO";
    // Atribución, en orden de honestidad: quien la cerró > quien la tenía
    // asignada > el supervisor del SC (las entrevistas van sin asignar por
    // diseño, así que sin este último paso caían todas en un mismo balde).
    // Regla de la operación:
    //  · Llamadas    → TODAS a Jorge Arellano, sin importar el SC.
    //  · Entrevistas → al supervisor dueño del SC, según el padrón.
    const delSC = supDeSC(t.sc);
    let supervisor, origenAtrib;
    if (t.tipo_tarea === "llamada_prospecto") {
      supervisor = nombrePorEmail(t.asignado_a) || "Jorge Arellano";
      origenAtrib = "llamadas";
    } else if (delSC && delSC.nombre) {
      supervisor = delSC.nombre; origenAtrib = "SC";
    } else {
      supervisor = `— SC ${t.sc || "?"} sin supervisor —`; origenAtrib = "sin padrón";
    }

    return {
      id: t.id, sc: t.sc || "—", tipo: TIPO_LBL[t.tipo_tarea] || t.tipo_tarea,
      supervisor, origenAtrib,
      titulo: t.titulo || "", estado: t.estado,
      creada: t.created_at, vence, cierre, veredicto, reactivaciones: nReact,
    };
  });

  // Con tareas + los del padrón que no tuvieron ninguna: un supervisor en
  // cero es información para el bono, no ausencia de información.
  const supervisores = [...new Set([
    ...detalle.map((d) => d.supervisor),
    ...(verSinTareas ? padron.map((p) => p.supervisor) : []),
  ])].sort();
  const scs = [...new Set(detalle.map((d) => d.sc))].sort();
  const visibles = detalle.filter((d) =>
    (fSup === "todos" || d.supervisor === fSup) && (fSC === "todos" || d.sc === fSC));

  // Resumen por supervisor: la base del bono
  const resumen = supervisores
    .filter((sup) => fSup === "todos" || sup === fSup)
    .map((sup) => {
      const t = visibles.filter((d) => d.supervisor === sup);
      const cumple = t.filter((d) => d.veredicto === "CUMPLE").length;
      const no = t.filter((d) => d.veredicto === "NO CUMPLE").length;
      const curso = t.filter((d) => d.veredicto === "EN CURSO").length;
      const medidas = cumple + no;
      const suyos = padron.filter((p) => p.supervisor === sup).map((p) => p.sc);
      return {
        supervisor: sup,
        scs: suyos.length ? suyos.join(", ") : "—",
        total: t.length,
        llamadas: t.filter((d) => d.tipo === "Llamada").length,
        entrevistas: t.filter((d) => d.tipo === "Entrevista").length,
        cumple, no, curso,
        reactivaciones: t.reduce((a, d) => a + d.reactivaciones, 0),
        pct: medidas ? Math.round((cumple / medidas) * 100) : null,
      };
    }).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  const tot = {
    cumple: visibles.filter((d) => d.veredicto === "CUMPLE").length,
    no: visibles.filter((d) => d.veredicto === "NO CUMPLE").length,
    curso: visibles.filter((d) => d.veredicto === "EN CURSO").length,
    react: visibles.reduce((a, d) => a + d.reactivaciones, 0),
  };
  const pctGlobal = (tot.cumple + tot.no) ? Math.round((tot.cumple / (tot.cumple + tot.no)) * 100) : null;

  // ── Exportar a Excel ──
  // .xls como tabla HTML con estilos: Excel lo abre nativo y conserva los
  // colores corporativos, sin depender de ninguna librería.
  const exportar = () => {
    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const th = (t) => `<th style="background:#1a3a6b;color:#fff;font-weight:bold;border:1px solid #16305a;padding:6px 8px;font-size:11px;">${t}</th>`;
    const td = (t, extra) => `<td style="border:1px solid #dfe3e8;padding:5px 8px;font-size:11px;${extra || ""}">${esc(t)}</td>`;
    const colorV = (v) => v === "CUMPLE" ? "background:#e8f5ec;color:#166534;font-weight:bold;"
      : v === "NO CUMPLE" ? "background:#fbeaea;color:#c0392b;font-weight:bold;"
      : "background:#fff8e6;color:#b45309;";
    const filasRes = resumen.map((r) => `<tr>${td(r.supervisor)}${td(r.scs)}${td(r.total)}${td(r.llamadas)}${td(r.entrevistas)}
      ${td(r.cumple, "background:#e8f5ec;color:#166534;font-weight:bold;")}${td(r.no, "background:#fbeaea;color:#c0392b;font-weight:bold;")}
      ${td(r.curso)}${td(r.reactivaciones)}${td(r.pct === null ? "—" : r.pct + "%", "font-weight:bold;")}</tr>`).join("");
    const filasDet = visibles.map((d) => `<tr>${td(fMX(d.creada, { day: "2-digit", month: "2-digit", year: "numeric" }))}
      ${td(fMX(d.creada, { hour: "2-digit", minute: "2-digit" }))}${td(d.sc)}${td(d.tipo)}${td(d.supervisor)}${td(d.titulo)}
      ${td(d.vence ? fMX(d.vence, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—")}
      ${td(d.cierre ? fMX(d.cierre, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—")}
      ${td(d.veredicto, colorV(d.veredicto))}${td(d.reactivaciones)}${td(d.estado)}${td(d.origenAtrib)}</tr>`).join("");
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" />
      <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
      <x:ExcelWorksheet><x:Name>SLA Supervisores</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
      </x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body style="font-family:Calibri,Arial;">
      <table><tr><td colspan="10" style="background:#1a3a6b;color:#fff;font-size:15px;font-weight:bold;padding:10px;">
        BIGTICKET · Cumplimiento SLA de supervisores</td></tr>
      <tr><td colspan="10" style="background:#F47B20;color:#fff;font-size:11px;padding:6px 10px;">
        Periodo ${rango.ini} al ${rango.fin} · generado ${fMX(new Date().toISOString(), { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td></tr></table>
      <br/><table style="border-collapse:collapse;"><tr>${["Supervisor", "SC asignados", "Tareas", "Llamadas", "Entrevistas", "Cumple", "No cumple", "En curso", "Reactivaciones", "% Cumplimiento"].map(th).join("")}</tr>${filasRes}</table>
      <br/><br/><table style="border-collapse:collapse;"><tr><td colspan="12" style="background:#1a3a6b;color:#fff;font-weight:bold;padding:7px 10px;font-size:12px;">Detalle por tarea</td></tr>
      <tr>${["Fecha", "Hora", "Centro / SVC", "Tipo", "Supervisor", "Prospecto", "Vence SLA", "Cierre", "Cumple SLA", "Reactivaciones", "Estado", "Atribución"].map(th).join("")}</tr>${filasDet}</table>
      </body></html>`;
    const blob = new Blob([`\ufeff${html}`], { type: "application/vnd.ms-excel;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `SLA_supervisores_${rango.ini}_a_${rango.fin}.xls`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const Kpi = ({ label, valor, color, bg }) => (
    <div style={{ flex: "1 1 120px", background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
    </div>
  );
  const inp = { border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, fontFamily: "'Geist',sans-serif", background: "#fff" };
  const th = { padding: "9px 10px", fontSize: 10.5, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: ".4px", textAlign: "left", background: "#1a3a6b", position: "sticky", top: 0 };
  const td = { padding: "8px 10px", fontSize: 12, borderBottom: "1px solid #f0f1f3" };
  const colorV = (v) => v === "CUMPLE" ? { bg: "#e8f5ec", fg: "#166534" }
    : v === "NO CUMPLE" ? { bg: "#fbeaea", fg: "#c0392b" }
    : v === "EN CURSO" ? { bg: "#fff8e6", fg: "#b45309" } : { bg: "#f2f4f7", fg: "#667085" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="sec-title" style={{ margin: 0, flex: 1 }}>📊 Tablero de Control · SLA de supervisores</div>
        <button onClick={exportar} disabled={!rows || !visibles.length}
          style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "#F47B20", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "'Geist',sans-serif", opacity: (!rows || !visibles.length) ? .5 : 1 }}>
          ⬇ Descargar Excel
        </button>
      </div>

      {/* Periodo */}
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {[["dia", "📅 Un día"], ["rango", "📆 Rango"], ["mes", "🗓 Mes completo"]].map(([v, l]) => (
            <button key={v} onClick={() => setModo(v)}
              style={{ padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontFamily: "'Geist',sans-serif",
                fontWeight: modo === v ? 700 : 500, background: modo === v ? "#1a3a6b" : "#fff",
                color: modo === v ? "#fff" : "#555", border: modo === v ? "1.5px solid #1a3a6b" : "1px solid #e4e7ec" }}>{l}</button>
          ))}
          <div style={{ width: 1, height: 24, background: "#e4e7ec", margin: "0 4px" }} />
          {modo === "mes" ? (
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={inp} />
          ) : modo === "dia" ? (
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={inp} />
          ) : (
            <>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={inp} />
              <span style={{ fontSize: 12, color: "#888" }}>a</span>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={inp} />
            </>
          )}
          <div style={{ flex: 1 }} />
          <select value={fSup} onChange={(e) => setFSup(e.target.value)} style={inp}>
            <option value="todos">Todos los supervisores</option>
            {supervisores.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={fSC} onChange={(e) => setFSC(e.target.value)} style={inp}>
            <option value="todos">Todos los SC</option>
            {scs.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555", cursor: "pointer" }}>
            <input type="checkbox" checked={verSinTareas} onChange={(e) => setVerSinTareas(e.target.checked)} />
            Incluir supervisores sin tareas
          </label>
        </div>
      </div>

      {errPadron && (
        <div style={{ background: "#fbeaea", border: "1px solid #f0b4b4", borderRadius: 10, padding: "11px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#c0392b", marginBottom: 3 }}>
            ⚠️ No se pudo leer el padrón de supervisores
          </div>
          <div style={{ fontSize: 12, color: "#8b3a3a", lineHeight: 1.5 }}>
            El tablero lee <i>padron_sc_supervisor</i> (una fila por SC). Sin ella las entrevistas no se
            pueden atribuir y todo aparece como «sin supervisor». Detalle: {errPadron}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Kpi label="Cumplimiento" valor={pctGlobal === null ? "—" : pctGlobal + "%"} color="#1a3a6b" bg="#eef2f7" />
        <Kpi label="Cumple" valor={tot.cumple} color="#166534" bg="#e8f5ec" />
        <Kpi label="No cumple" valor={tot.no} color="#c0392b" bg="#fbeaea" />
        <Kpi label="En curso" valor={tot.curso} color="#b45309" bg="#fff8e6" />
        <Kpi label="Reactivaciones" valor={tot.react} color="#7c3aed" bg="#f5f0fe" />
      </div>

      {/* Resumen por supervisor — la base del bono */}
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "11px 16px", background: "#fafbfc", borderBottom: "1px solid #eef0f3", fontSize: 12, fontWeight: 800, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: ".4px" }}>
          Resumen por supervisor
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr>{["Supervisor", "SC asignados", "Tareas", "Llamadas", "Entrevistas", "Cumple", "No cumple", "En curso", "Reactiv.", "% SLA"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows === null ? <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#888" }}>Cargando…</td></tr>
                : resumen.length === 0 ? <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#888" }}>Sin tareas en el periodo.</td></tr>
                : resumen.map((r) => (
                  <tr key={r.supervisor}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.supervisor}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11, color: "#667085" }}>{r.scs}</td>
                    <td style={{ ...td, color: r.total ? "inherit" : "#c3cad6" }}>{r.total}</td><td style={td}>{r.llamadas}</td><td style={td}>{r.entrevistas}</td>
                    <td style={{ ...td, color: "#166534", fontWeight: 700 }}>{r.cumple}</td>
                    <td style={{ ...td, color: "#c0392b", fontWeight: 700 }}>{r.no}</td>
                    <td style={{ ...td, color: "#b45309" }}>{r.curso}</td>
                    <td style={{ ...td, color: r.reactivaciones ? "#7c3aed" : "#98a2b3", fontWeight: r.reactivaciones ? 700 : 400 }}>{r.reactivaciones}</td>
                    <td style={{ ...td, fontWeight: 800, color: r.pct === null ? "#98a2b3" : r.pct >= 90 ? "#166534" : r.pct >= 75 ? "#b45309" : "#c0392b" }}>
                      {r.pct === null ? "—" : r.pct + "%"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalle por tarea */}
      <div style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "11px 16px", background: "#fafbfc", borderBottom: "1px solid #eef0f3", fontSize: 12, fontWeight: 800, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: ".4px" }}>
          Detalle por tarea {visibles.length ? `(${visibles.length})` : ""}
        </div>
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead><tr>{["Fecha", "Hora", "SVC", "Tipo", "Supervisor", "Prospecto", "Vence SLA", "Cierre", "Cumple", "Reactiv."].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows === null ? <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#888" }}>Cargando…</td></tr>
                : visibles.length === 0 ? <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#888" }}>Sin tareas en el periodo.</td></tr>
                : visibles.map((d) => {
                  const c = colorV(d.veredicto);
                  return (
                    <tr key={d.id}>
                      <td style={td}>{fMX(d.creada, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>{fMX(d.creada, { hour: "2-digit", minute: "2-digit" })}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontWeight: 700 }}>{d.sc}</td>
                      <td style={td}>{d.tipo}</td>
                      <td style={td}>{d.supervisor}</td>
                      <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.titulo}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>{d.vence ? fMX(d.vence, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>{d.cierre ? fMX(d.cierre, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td style={td}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 20, background: c.bg, color: c.fg }}>{d.veredicto}</span>
                      </td>
                      <td style={{ ...td, textAlign: "center", color: d.reactivaciones ? "#7c3aed" : "#c3cad6", fontWeight: d.reactivaciones ? 800 : 400 }}>{d.reactivaciones || "–"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "#98a2b3", marginTop: 10, lineHeight: 1.6 }}>
        <b>Cómo se mide:</b> una tarea CUMPLE si se cerró antes de su vencimiento de SLA. Las que siguen
        pendientes con el plazo vencido cuentan como NO CUMPLE; las pendientes dentro de plazo quedan
        EN CURSO y no entran en el porcentaje. Las reactivaciones se muestran aparte a propósito:
        extender un plazo no borra que hubo que extenderlo.
        <br /><b>Atribución:</b> las <b>entrevistas</b> se cargan al supervisor dueño del SC según la tabla
        <i> padron_sc_supervisor</i>; las <b>llamadas</b> van todas a Jorge Arellano, sin importar el SC.
        Para cambiar quién cubre un SC se edita esa tabla y el tablero lo toma al recargar.
        <br /><b>Reactivaciones:</b> suma las de <i>sla_reactivaciones</i> (botón «Reactivar plazo») y las
        de <i>tareas_reactivaciones</i> (repetir una entrevista o llamada ya ejecutada).
      </div>
    </div>
  );
}

function ModuloCertificaciones() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [vista, setVista] = useState("kanban");
  const [seccion, setSeccion] = useState("certificaciones"); // certificaciones | contratos | mensajes
  const [flujo, setFlujo] = useState("ingresos"); // ingresos (Fuente A · Prospección) | terceros (Fuente B · App/Portal)
  const [busqueda, setBusqueda] = useState("");
  const [filtroFuente, setFiltroFuente] = useState("todas");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  // Contador amarillo de la pestaña Avisos: solicitudes que ya requieren
  // atención (avisadas, escaladas o vencidas sin avisar).
  const [nAvisos, setNAvisos] = useState(0);
  // Contador naranja de la pestaña Mensajes: mensajes de terceros sin leer.
  const [nMensajes, setNMensajes] = useState(0);

  useEffect(() => { (async () => { await autoSyncCRM(); await cargar(); })(); }, []);

  // El contador se lee aunque la pestaña Avisos no esté abierta, para que
  // el número esté visible desde que se entra al módulo.
  useEffect(() => {
    const leer = async () => {
      const { data } = await sb.from("vw_avisos_contador").select("atencion").maybeSingle();
      if (data) setNAvisos(data.atencion || 0);
      const { count } = await sb.from("mensajes_terceros")
        .select("id", { count: "exact", head: true })
        .eq("autor", "tercero").eq("leido", false);
      setNMensajes(count || 0);
    };
    leer();
    const t = setInterval(() => { if (!document.hidden) leer(); }, 120000);
    return () => clearInterval(t);
  }, []);

  const [refrescando, setRefrescando] = useState(false);
  const cargar = async (silencioso = false) => {
    if (silencioso) setRefrescando(true); else setLoading(true);
    try {
      const [rp, rc] = await Promise.all([
        sb.from("certificaciones_mx").select("*").order("created_at", { ascending: false }),
        sb.from("certificaciones")
          .select("*, certificacion_conductor(*), certificacion_vehiculo(*), terceros(nombre, service_center)")
          .order("created_at", { ascending: false }),
      ]);
      const cardsA = (rp.data || []).filter(r => !r.oculto_kanban).map(normalizarProspeccion);
      const cardsB = (rc.data || []).filter(r => !r.oculto_kanban).map(normalizarPortalCert);
      // Portal primero para que lo más nuevo del rediseño quede visible arriba
      // SLA de las tareas pendientes, para el contador en cada tarjeta
      let todas = [...cardsB, ...cardsA];
      try {
        const { data: tks } = await sb.from("tareas_supervisor")
          .select("id, registro_id, tipo_tarea, sla_vence_at, estado, sc, asignado_a")
          .eq("estado", "pendiente")
          .in("tipo_tarea", ["llamada_prospecto", "entrevista_prospecto"]);
        const porReg = {};
        (tks || []).forEach((t) => { porReg[String(t.registro_id)] = t; });
        todas = todas.map((i) => ({ ...i, tarea: porReg[String(i.id)] || null }));
      } catch (e) { /* el contador es informativo: no debe romper el tablero */ }
      setItems(todas);
    } catch (e) {
      console.error("Error cargando certificaciones:", e.message);
      if (!silencioso) setItems([]);
    } finally {
      setLoading(false); setRefrescando(false);
    }
  };

  // Auto-refresh de fondo cada 60 s (solo en el tablero, sin tarjeta abierta y con
  // la pestaña visible) — así los movimientos de las automatizaciones (correo MELI,
  // cargas del portal) aparecen solos, sin recargar la página.
  const selRef = useRef(null);
  selRef.current = selected;
  useEffect(() => {
    const t = setInterval(() => {
      if (!selRef.current && !document.hidden) cargar(true);
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // ── Auto-avance Etapa 1 → Etapa 2 (Fuente A) ──
  // Toda tarjeta de prospección que lleve más de 30 s en Recepción pasa sola a
  // "Llamada de Supervisor" (y con eso se genera la tarea en la Bitácora).
  // Se revisa cada 15 s mientras el módulo está abierto; el ref evita repetir
  // el movimiento de una misma tarjeta.
  const SEGUNDOS_ETAPA1 = 30;
  const avanzadas = useRef(new Set());
  const autoAvanzarEtapa1 = async (lista) => {
    const ahora = Date.now();
    const candidatas = (lista || []).filter((i) => {
      if (i.fuente !== "prospeccion" || i.etapa !== "recepcion") return false;
      if (avanzadas.current.has(i.id)) return false;
      const desde = i.raw?.updated_at || i.raw?.created_at;
      if (!desde) return false;
      return ahora - new Date(desde).getTime() >= SEGUNDOS_ETAPA1 * 1000;
    });
    if (!candidatas.length) return;
    for (const c of candidatas) {
      avanzadas.current.add(c.id);
      const { error } = await sb.from("certificaciones_mx").update({
        etapa_kanban: "llamada_supervisor",
        updated_at: new Date().toISOString(),
      }).eq("id", c.id).eq("etapa_kanban", "recepcion");   // solo si sigue en Etapa 1
      if (error) { console.warn("auto-avance E1→E2:", error.message); avanzadas.current.delete(c.id); }
    }
    await cargar(true);
  };

  const itemsRef = useRef([]);
  itemsRef.current = items;
  useEffect(() => {
    const t = setInterval(() => {
      if (!selRef.current && !document.hidden) autoAvanzarEtapa1(itemsRef.current);
    }, 15000);
    return () => clearInterval(t);
  }, []);

  // Fuente A: jala prospectos del CRM/onboarding a certificaciones_mx
  const autoSyncCRM = async () => {
    try {
      // Intenta traer leads.empresa; si la columna no existe en tu CRM, reintenta sin ella
      let { data: onboardings, error: errOnb } = await sb
        .from("onboarding_terceros")
        .select("*, leads(id, nombre, etapa, curp, email, telefono, zona, region_estado, empresa)")
        .eq("pais", "México")
        .not("url_ine", "is", null)
        .not("url_curp", "is", null)
        .not("url_rfc", "is", null);
      if (errOnb) {
        ({ data: onboardings, error: errOnb } = await sb
          .from("onboarding_terceros")
          .select("*, leads(id, nombre, etapa, curp, email, telefono, zona, region_estado)")
          .eq("pais", "México")
          .not("url_ine", "is", null)
          .not("url_curp", "is", null)
          .not("url_rfc", "is", null));
      }
      if (errOnb || !onboardings) return;

      // El CRM renombró la etapa: se aceptan el nombre nuevo y el histórico
      const ETAPAS_CERT = ["Proceso Interno de Certificaciones", "Entrevistas y Validaciones"];
      const enValidacion = onboardings.filter(o => ETAPAS_CERT.includes(o.leads?.etapa));
      if (enValidacion.length === 0) return;

      const { data: existentes } = await sb
        .from("certificaciones_mx").select("lead_crm_id").not("lead_crm_id", "is", null);
      const idsExistentes = (existentes || []).map(e => e.lead_crm_id);

      const nuevos = enValidacion.filter(o => !idsExistentes.includes(o.lead_id));
      if (nuevos.length === 0) return;

      const registros = nuevos.map(o => ({
        lead_crm_id:  o.lead_id,
        nombre:       ([o.nombre, o.apellidos].filter(Boolean).join(" ").replace(/\s+/g, " ").trim())
                        || (o.leads?.nombre || "").trim(),
        curp:         o.curp         || o.leads?.curp      || "",
        rfc:          o.rfc          || "",
        ine:          o.rut          || "",
        licencia:     o.licencia     || "",
        puesto:       o.puesto       || "",
        empresa:      o.empresa      || o.leads?.empresa   || "",
        cantidad_vehiculos: o.cantidad_vehiculos ?? null,
        tipo_vehiculo: Array.isArray(o.tipos_vehiculo) ? (o.tipos_vehiculo[0] || null) : (o.tipos_vehiculo || null),
        svc:          (o.leads?.region_estado || o.leads?.zona || "").split(" ")[0],
        email:        o.email        || o.leads?.email     || "",
        telefono:     o.telefono     || o.leads?.telefono  || "",
        url_ine:      o.url_ine      || "",
        url_ine_2:    o.url_ine_2    || "",
        url_curp:     o.url_curp     || "",
        url_rfc:      o.url_rfc      || "",
        url_licencia: o.url_licencia || "",
        estado:       "pendiente",
        origen:       "crm",
        updated_at:   new Date().toISOString(),
      }));

      const { error: errInsert } = await sb.from("certificaciones_mx").insert(registros);
      if (!errInsert) await cargar();
    } catch (e) {
      console.error("Auto-sync CRM error:", e.message);
    }
  };

  // Etapa del Kanban → estado persistido (Fuente A / certificaciones_mx)
  const ESTADO_POR_ETAPA = {
    recepcion: "pendiente", llamada_supervisor: "pendiente", prevalidacion_biggy: "pendiente", validacion_meli: "enviado",
    validacion_nubarium: "aprobado", entrevista_operaciones: "en_entrevista", solicitud_alta: "alta_solicitada", firma_contrato: "en_firma", aceptado: "aceptado", rechazado: "rechazado",
  };

  // Dispara Biggy (Claude Vision) sobre un prospecto (Fuente A) y cachea el análisis.
  const analizarProspecto = async (card) => {
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/analizar-documentos", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...card.raw }),
      });
      const txt = await resp.text();
      if (!txt || !txt.trim()) return;
      const parsed = JSON.parse(txt).analisis;
      if (!parsed) return;
      await sb.from("certificaciones_mx").update({
        claude_analisis: parsed, claude_score_global: parsed.score_global,
        claude_recomendacion: parsed.recomendacion, claude_alertas: parsed.alertas || [],
        claude_reviewed_at: new Date().toISOString(),
      }).eq("id", card.id);
      setItems(prev => prev.map(i => i.key === card.key ? {
        ...i, score: parsed.score_global, rec: parsed.recomendacion,
        raw: { ...i.raw, claude_analisis: parsed, claude_score_global: parsed.score_global, claude_recomendacion: parsed.recomendacion, claude_alertas: parsed.alertas || [] },
      } : i));
    } catch (e) { console.error("Análisis al mover:", e.message); }
  };

  // Mover tarjeta de columna manualmente (con confirmación)
  const moverTarjeta = async (cardKey, targetEtapa) => {
    const card = items.find(i => i.key === cardKey);
    if (!card || card.etapa === targetEtapa) return;
    const col = COLUMNAS.find(c => c.id === targetEtapa);
    if (!confirm(`¿Mover "${card.titulo}" a "${col?.label || targetEtapa}"?`)) return;
    setItems(prev => prev.map(i => i.key === cardKey ? { ...i, etapa: targetEtapa, raw: { ...i.raw, etapa_kanban: targetEtapa, ...(card.fuente === "prospeccion" && ESTADO_POR_ETAPA[targetEtapa] ? { estado: ESTADO_POR_ETAPA[targetEtapa] } : {}) } } : i));
    // Persiste la etapa en ambas fuentes (para que no se revierta al refrescar).
    // NO se dispara Biggy aquí: la Pre Validación corre al ABRIR la tarjeta en Etapa 2.
    if (card.fuente === "prospeccion") {
      const patch = { etapa_kanban: targetEtapa, updated_at: new Date().toISOString() };
      const estado = ESTADO_POR_ETAPA[targetEtapa];
      if (estado) patch.estado = estado;
      const { error } = await sb.from("certificaciones_mx").update(patch).eq("id", card.id);
      if (error) { alert("No se pudo guardar el movimiento: " + error.message); await cargar(); return; }
    } else if (card.fuente === "portal_cert") {
      const { error } = await sb.from("certificaciones").update({ etapa_kanban: targetEtapa }).eq("id", card.id);
      if (error) { alert("No se pudo guardar el movimiento: " + error.message); await cargar(); return; }
    }
  };

  // Mover la tarjeta seleccionada a una etapa y volver al tablero (usado por los botones del detalle)
  const moverYCerrar = async (card, targetEtapa) => {
    const patchRaw = { etapa_kanban: targetEtapa };
    if (card.fuente === "prospeccion") {
      const estado = ESTADO_POR_ETAPA[targetEtapa];
      if (estado) patchRaw.estado = estado;
      await sb.from("certificaciones_mx").update({ ...patchRaw, updated_at: new Date().toISOString() }).eq("id", card.id);
    } else {
      await sb.from("certificaciones").update({ etapa_kanban: targetEtapa }).eq("id", card.id);
    }
    setItems(prev => prev.map(i => i.key === card.key ? { ...i, etapa: targetEtapa, raw: { ...i.raw, ...patchRaw } } : i));
    setSelected(null);
  };

  // Quitar tarjeta del tablero — persistido (no reaparece al refrescar)
  const eliminarTarjeta = async (card) => {
    if (!confirm(`¿Quitar "${card.titulo}" del tablero?\n\nSe oculta del tablero (no se borra la fila de la base de datos).`)) return;
    setItems(prev => prev.filter(i => i.key !== card.key));
    const tabla = card.fuente === "prospeccion" ? "certificaciones_mx" : "certificaciones";
    const { error } = await sb.from(tabla).update({ oculto_kanban: true }).eq("id", card.id);
    if (error) { alert("No se pudo ocultar: " + error.message); await cargar(); }
  };

  if (selected) {
    if (selected.fuente === "portal_cert") {
      return <DetalleCertificacion cert={selected.raw} etapa={selected.etapa} onVolver={() => { setSelected(null); cargar(true); }}
        onPasarEtapa2={() => moverYCerrar(selected, "prevalidacion_biggy")}
        onMoverA={(etapa) => moverYCerrar(selected, etapa)}
        onAnalizado={(parsed) => setItems(prev => prev.map(i => i.key === selected.key ? {
          ...i, score: parsed.score_global, rec: parsed.recomendacion,
          raw: { ...i.raw, claude_analisis: parsed, claude_score_global: parsed.score_global, claude_recomendacion: parsed.recomendacion, claude_alertas: parsed.alertas || [] },
        } : i))} />;
    }
    return (
      <DetalleCandidato
        candidato={selected.raw}
        onVolver={() => { setSelected(null); cargar(true); }}
        onPasarEtapa2={() => moverYCerrar(selected, "llamada_supervisor")}
        onActualizar={(updated) => {
          const rn = normalizarProspeccion(updated);
          setItems(prev => prev.map(i => i.key === rn.key ? rn : i));
          setSelected(rn);
        }}
      />
    );
  }

  // Separación de flujos: Nuevos Ingresos (Prospección) vs Vehículos y Personas (App/Portal)
  const colsFlujo = flujo === "terceros" ? COLUMNAS_B : COLUMNAS;
  const itemsFlujo = items.filter(i => flujo === "ingresos" ? i.fuente === "prospeccion" : i.fuente === "portal_cert");
  const nIngresos = items.filter(i => i.fuente === "prospeccion").length;
  const nTerceros = items.filter(i => i.fuente === "portal_cert").length;

  // Buscador + filtros
  const q = busqueda.trim().toLowerCase();
  const itemsFiltrados = itemsFlujo.filter(i => {
    if (flujo === "terceros" && filtroFuente !== "todas") {
      const esApp = (i.raw?.origen === "app_terceros");
      if (filtroFuente === "app" && !esApp) return false;
      if (filtroFuente === "portal" && esApp) return false;
    }
    if (filtroTipo !== "todos" && i.tipo !== filtroTipo) return false;
    if (!q) return true;
    const r = i.raw || {};
    const campos = [i.titulo, i.sc, i.key, r.curp, r.rfc, r.email, r.telefono, r.svc]
      .filter(Boolean).join(" ").toLowerCase();
    return campos.includes(q);
  });

  const conteo = {
    total:  itemsFiltrados.length,
    app:    itemsFiltrados.filter(i => i.raw?.origen === "app_terceros").length,
    portal: itemsFiltrados.filter(i => i.raw?.origen !== "app_terceros").length,
  };

  return (
    <div className="pg">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Certificaciones MX 🇲🇽</div>
          <div className="sec-sub">Recepción documental — Prospección + Portal de Certificación</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <img src={BIGGY_IMG} alt="Biggy" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: "2px solid #F47B20" }} />
          {seccion === "certificaciones" && (
            <>
            <button onClick={() => cargar(true)} disabled={refrescando} title="Traer los últimos movimientos sin recargar la página"
              style={{ padding: "7px 14px", borderRadius: 8, border: "0.5px solid #e4e7ec", background: "#fff", color: "#1a3a6b", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Geist',sans-serif", opacity: refrescando ? 0.6 : 1 }}>
              {refrescando ? "⏳ Actualizando…" : "🔄 Actualizar"}
            </button>
            <div style={{ display: "flex", background: "#fff", borderRadius: 8, border: "0.5px solid #e4e7ec", overflow: "hidden" }}>
              {[["kanban", "Kanban"], ["lista", "Lista"]].map(([v, l]) => (
                <button key={v} onClick={() => setVista(v)}
                  style={{ padding: "7px 14px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "'Geist',sans-serif",
                    background: vista === v ? "#1a3a6b" : "#fff", color: vista === v ? "#fff" : "#666", fontWeight: vista === v ? 600 : 400 }}>
                  {l}
                </button>
              ))}
            </div>
            </>
          )}
        </div>
      </div>

      {/* Pestañas de sección */}
      <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid #e4e7ec" }}>
        {[["certificaciones", "📋 Certificaciones"], ["altas", "➕ Vehículos y Personal"], ["contratos", "📑 Gestionador de Contratos"], ["documentacion", "🗂 Documentación Terceros"], ["avisos", "🔔 Avisos"], ["mensajes", "💬 Mensajes"], ["tablero", "📊 Tablero de Control"]].map(([v, l]) => (
          <button key={v} onClick={() => { setSeccion(v); setSelected(null); }}
            style={{ padding: "10px 16px", border: "none", cursor: "pointer", fontSize: 13, fontFamily: "'Geist',sans-serif",
              background: "transparent", fontWeight: seccion === v ? 700 : 400,
              color: seccion === v ? "#1a3a6b" : "#888", position: "relative",
              borderBottom: seccion === v ? "2.5px solid #F47B20" : "2.5px solid transparent", marginBottom: -1 }}>
            {/* Número naranja de mensajes sin leer */}
            {v === "mensajes" && nMensajes > 0 && (
              <span style={{ position: "absolute", top: -2, right: 4, minWidth: 18, height: 18, padding: "0 5px",
                borderRadius: 999, background: "#F47B20", color: "#fff", fontSize: 10.5, fontWeight: 800,
                display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                border: "1px solid #d96a15", fontVariantNumeric: "tabular-nums" }}>
                {nMensajes > 99 ? "99+" : nMensajes}
              </span>
            )}
            {/* Número amarillo sobre el nombre de la pestaña */}
            {v === "avisos" && nAvisos > 0 && (
              <span style={{ position: "absolute", top: -2, right: 4, minWidth: 18, height: 18, padding: "0 5px",
                borderRadius: 999, background: "#F5B301", color: "#3d2b00", fontSize: 10.5, fontWeight: 800,
                display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                border: "1px solid #dc9f00", fontVariantNumeric: "tabular-nums" }}>
                {nAvisos > 99 ? "99+" : nAvisos}
              </span>
            )}
            {l}
          </button>
        ))}
      </div>

      {seccion === "altas" && <AltaVehiculosPersonal onCreada={() => cargar(true)} />}
      {seccion === "contratos" && <GestionadorContratos />}
      {seccion === "documentacion" && <DocumentacionTerceros />}
      {seccion === "avisos" && <AvisosRecordatorios onContador={setNAvisos} />}
      {seccion === "tablero" && <TableroControl />}
      {seccion === "mensajes" && <MensajesTerceros />}

      {seccion === "certificaciones" && (
      <>
      {/* Flujos separados: Fuente A (Prospección) y Fuente B (App/Portal) */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {[["ingresos", "🎯 Certificación Nuevos Ingresos", nIngresos],
          ["terceros", "🚚 Certificación Vehículos y Personas", nTerceros]].map(([v, l, n]) => (
          <button key={v} onClick={() => { setFlujo(v); setSelected(null); setFiltroFuente("todas"); setFiltroTipo("todos"); }}
            style={{ padding: "10px 18px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "'Geist',sans-serif",
              fontWeight: flujo === v ? 700 : 500,
              background: flujo === v ? "#1a3a6b" : "#fff",
              color: flujo === v ? "#fff" : "#555",
              border: flujo === v ? "1.5px solid #1a3a6b" : "1px solid #e4e7ec" }}>
            {l} {n != null && <span style={{ opacity: 0.75, fontWeight: 400 }}>({n})</span>}
          </button>
        ))}
      </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar por nombre, SC, CURP, RFC, email…"
          style={{ flex: 1, minWidth: 220, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "'Geist',sans-serif" }}
        />
        {flujo === "terceros" && (
          <select value={filtroFuente} onChange={(e) => setFiltroFuente(e.target.value)}
            style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 12, fontFamily: "'Geist',sans-serif", color: "#333" }}>
            <option value="todas">App y Portal</option>
            <option value="app">📱 App Terceros</option>
            <option value="portal">🏢 Portal web</option>
          </select>
        )}
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
          style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 12, fontFamily: "'Geist',sans-serif", color: "#333" }}>
          <option value="todos">Todos los tipos</option>
          <option value="conductor">🚗 Driver</option>
          <option value="ayudante">🧰 Ayudante</option>
          {flujo === "terceros" && <option value="vehiculo">🚚 Vehículo</option>}
        </select>
        {(q || filtroFuente !== "todas" || filtroTipo !== "todos") && (
          <button onClick={() => { setBusqueda(""); setFiltroFuente("todas"); setFiltroTipo("todos"); }}
            style={{ background: "#f4f5f7", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 12, cursor: "pointer", color: "#666" }}>
            Limpiar
          </button>
        )}
      </div>

      {/* KPIs por etapa — coinciden 1:1 con las columnas del tablero (Σ etapas = Total) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 10, marginBottom: 8 }}>
        {[["Total", itemsFiltrados.length, "#1a3a6b"],
          ...colsFlujo.map(c => [ETAPA_CORTA[c.id] || c.label, itemsFiltrados.filter(i => i.etapa === c.id).length, c.color])
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
      {flujo === "terceros" && (
        <div style={{ fontSize: 11, color: "#888", marginBottom: 20 }}>
          Por origen: 📱 App Terceros <b>{conteo.app}</b> · 🏢 Portal web <b>{conteo.portal}</b>
        </div>
      )}

      {loading ? <div className="loading">Cargando...</div> : itemsFiltrados.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{itemsFlujo.length === 0 ? (flujo === "ingresos" ? "Sin postulaciones" : "Sin certificaciones") : "Sin resultados"}</div>
          <div style={{ fontSize: 12 }}>{itemsFlujo.length === 0
            ? (flujo === "ingresos" ? "Aún no hay postulaciones desde el Portal de Prospección" : "Aún no hay certificaciones desde la App ni el Portal de Terceros")
            : "Ninguna tarjeta coincide con la búsqueda o los filtros"}</div>
        </div>
      ) : vista === "kanban" ? (
        <KanbanBoard items={itemsFiltrados} columnas={colsFlujo} onCardClick={setSelected} onMover={moverTarjeta} onEliminar={eliminarTarjeta} />
      ) : (
        <div>
          {itemsFiltrados.map(card => {
            const fc = fuenteBadge(card);
            const tc = TIPO_CFG[card.tipo] || TIPO_CFG.conductor;
            const esVeh = card.tipo === "vehiculo";
            return (
              <div key={card.key} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "14px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                onClick={() => setSelected(card)}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#1a3a6b", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                  {esVeh ? "🚚" : (card.titulo?.charAt(0)?.toUpperCase() || "?")}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{card.titulo}</div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: fc.bg, color: fc.color, border: `1px solid ${fc.border}` }}>
                      {fc.icon} {fc.label}
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
                      {tc.icon} {tc.label}
                    </span>
                    {!ETAPAS_SIN_NOTA_BIGGY.includes(card.etapa) && <NotaBiggy score={card.score} />}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                    📍 {card.sc}
                    {card.creado && <> · 🗓 {fMX(card.creado, { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })} <span style={{ fontSize: 10, color: "#b0b7c3" }}>(MX)</span></>}
                  </div>
                </div>
                <button title="Quitar del tablero" onClick={(e) => { e.stopPropagation(); eliminarTarjeta(card); }}
                  style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid #e4e7ec", background: "#fff", color: "#c0392b", fontSize: 13, cursor: "pointer", padding: 0, flexShrink: 0 }}>✕</button>
                <span style={{ color: "#888", fontSize: 18 }}>›</span>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}

export default ModuloCertificaciones;
