import { useState, useEffect, useRef } from "react";
import { sb, BIGGY_IMG } from "./shared";

const COLUMNAS = [
  { id: "recepcion",           label: "Etapa 1: Recepción Documental",  color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "llamada_supervisor",  label: "Etapa 2: Llamada de Supervisor", color: "#0e7490", bg: "#e8f6f9", border: "#c9e8f0" },
  { id: "prevalidacion_biggy", label: "Etapa 3: Pre Validación Biggy",  color: "#F47B20", bg: "#fff4ec", border: "#fbd9c0" },
  { id: "validacion_meli",     label: "Etapa 4: Validación MELI",       color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "validacion_nubarium", label: "Etapa 5: Nubarium / REPUVE",       color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "entrevista_operaciones", label: "Etapa 6: Entrevista con Operaciones", color: "#0e7490", bg: "#e8f6f9", border: "#c9e8f0" },
  { id: "solicitud_alta",      label: "Etapa 7: Solicitud de Alta",     color: "#0f766e", bg: "#e7f5f2", border: "#c4e6df" },
  { id: "firma_contrato",      label: "Etapa 8: Firma de Contrato",     color: "#7c3aed", bg: "#f5f0fe", border: "#ddd0f7" },
  { id: "aceptado",            label: "Aceptado",                       color: "#166534", bg: "#e8f5ec", border: "#b7e0c2" },
  { id: "rechazado",           label: "Rechazado",                      color: "#c0392b", bg: "#fbeaea", border: "#f0c4c4" },
];

// Etiquetas cortas para los KPIs del header (coinciden con las columnas)
const ETAPA_CORTA = {
  recepcion: "Etapa 1 · Recepción", llamada_supervisor: "Etapa 2 · Llamada Sup.", prevalidacion_biggy: "Etapa 3 · Biggy", validacion_meli: "Etapa 4 · MELI",
  validacion_nubarium: "Etapa 5 · Nubarium/REPUVE", entrevista_operaciones: "Etapa 6 · Entrevista", solicitud_alta: "Etapa 7 · Sol. de Alta", firma_contrato: "Etapa 8 · Firma", aceptado: "Aceptado", rechazado: "Rechazado",
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
      const tabla = fuente === "certificaciones_mx" ? "certificaciones_mx" : "certificaciones";
      const patch = fuente === "certificaciones_mx"
        ? { estado: "en_firma", etapa_kanban: "firma_contrato" }
        : { etapa_kanban: "firma_contrato" };
      await sb.from(tabla).update(patch).eq("id", registro.id);
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
      {minuta === null ? <Fila k="📋 Minuta de entrevista" v="Cargando…" /> : minuta && (
        <Fila k="📋 Minuta de entrevista" v={`${minuta.tipo_vehiculo || "—"} · ${minuta.cantidad_choferes ?? "—"} chofer(es) · ${minuta.cantidad_ayudantes ?? "—"} ayudante(s) · ${minuta.horario || "—"} · ${minuta.zona_operacion || "—"}`} />
      )}
      <Fila k="🏗 Items del contrato (Jefe)" v={
        itemsOp === null ? "Cargando…"
        : itemsOp ? `${itemsOp.cantidad_vehiculos ?? "—"} vehículo(s) ${itemsOp.tipo_vehiculos || ""} · inicio ${itemsOp.fecha_inicio || "—"} · ${itemsOp.esquema_tarifa || "—"}`
        : (tareaAlta && tareaAlta.estado === "pendiente" ? "⏳ Pendiente — tarea Alta Operacional en Indicadores (SLA 24 h)" : "Sin completar")
      } />

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
const MIFIEL_ENV = "sandbox";

// Carga el script del widget de MIFIEL una sola vez (compartido por Etapa 5 y Gestionador)
function cargarScriptMifiel() {
  if (document.querySelector("script[data-mifiel-widget]")) return;
  const s = document.createElement("script");
  s.type = "module";
  s.src = "https://app.mifiel.com/widget-component/index.js";
  s.setAttribute("data-mifiel-widget", "1");
  document.head.appendChild(s);
}

function SeccionFirmaContrato({ registro, tabla, datos, onActualizado }) {
  const [enviando, setEnviando] = useState(false);
  const [firmandoBT, setFirmandoBT] = useState(false);
  const docId = registro.mifiel_documento_id;

  // Carga el script del widget de MIFIEL solo cuando se abre la firma embebida
  useEffect(() => { if (firmandoBT) cargarScriptMifiel(); }, [firmandoBT]);

  const enviarAFirma = async () => {
    if (!datos.email) { alert("El prospecto no tiene email registrado — es necesario para enviar el contrato a firma."); return; }
    if (!confirm(`¿Generar el contrato de ${datos.nombre} y enviarlo a firma digital?`)) return;
    setEnviando(true);
    try {
      const resp = await fetch("https://bigticket2026.app.n8n.cloud/webhook/mifiel-crear-contrato", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabla, id: registro.id, ...datos }),
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
          <button onClick={enviarAFirma} disabled={enviando}
            style={{ width: "100%", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10,
              padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: enviando ? 0.6 : 1 }}>
            {enviando ? "Generando contrato…" : "📄 Generar contrato y enviar a firma"}
          </button>
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

          {!registro.mifiel_firmado_bigticket && registro.mifiel_widget_bigticket && (
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
          <div style={{ fontSize: 12, color: "#888" }}>{candidato.svc} · {candidato.puesto}</div>
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

        {candidato.comentario_supervisor && !enEtapa1 && !enLlamada && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0e7490", marginBottom: 4 }}>📞 Comentario del supervisor</div>
            <div style={{ fontSize: 13, color: "#155e70", lineHeight: 1.5 }}>{candidato.comentario_supervisor}</div>
          </div>
        )}

        {/* Datos del candidato */}
        <div className="form-card">
          <div className="form-title">Datos del candidato</div>
          <div className="three-col">
            {[["Nombre", candidato.nombre], ["CURP", candidato.curp], ["RFC", candidato.rfc],
              ["INE", candidato.ine], ["Licencia", candidato.licencia], ["Puesto", candidato.puesto],
              ["SVC", candidato.svc], ["Email", candidato.email], ["Teléfono", candidato.telefono]
            ].map(([l, v]) => (
              <div key={l} style={{ padding: "8px 0", borderBottom: "1px solid #f4f5f7" }}>
                <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{v || "—"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Comparativa de datos (solo cuando ya hay análisis) */}
        {tieneAnalisis && <ComparativaDatos candidato={candidato} analisis={analisis} />}

        {/* Validación Nubarium — solo en Etapa 4 (aprobado por MELI) */}
        {candidato.estado === "aprobado" && (
          <ValidacionNubarium candidato={candidato} onActualizar={onActualizar} />
        )}

        {/* Documentos */}
        <div className="form-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div className="form-title" style={{ margin: 0 }}>Documentos</div>
            <button className="btn-blue" onClick={analizarConClaude} disabled={analizando} style={{ fontSize: 12, padding: "7px 14px" }}>
              {analizando ? "Analizando..." : "🔄 Re-analizar"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 12 }}>
            <VisorDoc url={candidato.url_curp}     label="CURP" />
            <VisorDoc url={candidato.url_ine}      label="INE (delantera)" />
            <VisorDoc url={candidato.url_ine_2}    label="INE (trasera)" />
            <VisorDoc url={candidato.url_licencia} label="Licencia" />
            <VisorDoc url={candidato.url_rfc}      label="RFC" />
          </div>
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
  ine: "INE (frente)", ine_reverso: "INE (reverso)", curp: "CURP", licencia: "Licencia",
  tarjeta_circulacion: "Tarjeta de circulación", comprobante: "Comprobante",
  foto_frente: "Foto — frente", foto_trasera: "Foto — trasera",
  foto_lado_izq: "Foto — lado izquierdo", foto_lado_der: "Foto — lado derecho", otro: "Otro",
};

// Chip de TIPO
const TIPO_CFG = {
  conductor: { label: "Driver",   icon: "🚗", bg: "#f1f3f5", color: "#334155", border: "#dee2e6" },
  ayudante:  { label: "Ayudante", icon: "🧰", bg: "#f1f3f5", color: "#334155", border: "#dee2e6" },
  vehiculo:  { label: "Vehículo", icon: "🚚", bg: "#f1f3f5", color: "#334155", border: "#dee2e6" },
};

// Mapeo estado crudo → etapa del Kanban (columna)
const ETAPA_MX   = { pendiente: "recepcion", enviado: "validacion_meli", aprobado: "validacion_nubarium", en_entrevista: "entrevista_operaciones", alta_solicitada: "solicitud_alta", en_firma: "firma_contrato", aceptado: "aceptado", rechazado: "rechazado" };
const ETAPA_CERT = { enviado: "recepcion", en_validacion: "validacion_meli", validado: "aceptado", con_alertas: "aceptado", certificado: "aceptado", rechazado: "rechazado" };

// Etapa de un prospecto (Fuente A). "pendiente" se divide: sin análisis de Biggy → Recepción;
// con análisis cacheado → Etapa 2 (Pre Validación Biggy).
function etapaProspeccion(row) {
  const base = ETAPA_MX[row.estado] || "recepcion";
  // estados definidos (enviado/aprobado/aceptado/rechazado) mandan → automatización
  if (base !== "recepcion") return base;
  // estado "pendiente" → Etapas 1/2/3: usa el movimiento guardado si existe
  if (["recepcion", "llamada_supervisor", "prevalidacion_biggy"].includes(row.etapa_kanban)) return row.etapa_kanban;
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
    sc:     row.svc || "—",
    etapa:  etapaProspeccion(row),
    score:  row.claude_score_global ?? null,
    rec:    row.claude_recomendacion || null,
    estado_raw: row.estado,
    raw: row,
  };
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
    fuente: "portal_cert",
    origen: row.origen || "portal_web",
    tipo:   row.tipo || "conductor",
    titulo: esVeh ? (veh?.placa || "Sin placa") : (cond?.nombre || ter?.nombre || "Sin nombre"),
    sc:     row.service_center || ter?.service_center || "—",
    etapa:  row.etapa_kanban || ETAPA_CERT[row.estado] || "recepcion",
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

  const etapaActual = etapa || cert.etapa_kanban || ETAPA_CERT[cert.estado] || "recepcion";
  const enEtapa1 = etapaActual === "recepcion";
  const enLlamada = etapaActual === "llamada_supervisor";
  const enEtapa2 = etapaActual === "prevalidacion_biggy";
  const esVeh = cert.tipo === "vehiculo";
  const cond = cert._conductor;
  const veh  = cert._vehiculo;
  const ter  = cert._tercero;
  const titulo = esVeh ? (veh?.placa || "Sin placa") : (cond?.nombre || ter?.nombre || "Sin nombre");
  const tc = TIPO_CFG[cert.tipo] || TIPO_CFG.conductor;
  const fcFuente = cert.origen === "app_terceros" ? ORIGEN_CFG.app_terceros : FUENTE_CFG.portal_cert;

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await sb.from("certificacion_documentos")
          .select("tipo_documento, storage_path").eq("certificacion_id", cert.id);
        const rows = data || [];
        const conUrl = await Promise.all(rows.map(async (d) => {
          let url = "";
          try {
            const { data: sg } = await sb.storage.from("proceso_certificacion_bt").createSignedUrl(d.storage_path, 3600);
            url = sg?.signedUrl || "";
          } catch (e) { /* documento sin URL */ }
          return { ...d, url };
        }));
        if (!cancel) setDocsCert(conUrl);
      } catch (e) { if (!cancel) setDocsCert([]); }
    })();
    return () => { cancel = true; };
  }, [cert.id]);

  // Biggy (Claude Vision) para conductores/ayudantes de App/Portal.
  // Reusa el mismo webhook mapeando los documentos del portal a los campos esperados.
  const analizarCert = async (docs) => {
    const urlDe = (t) => (docs.find(d => d.tipo_documento === t)?.url) || "";
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
      if (errSave) console.error("No se pudo guardar el análisis (certificaciones):", errSave.message);
      if (onAnalizado) onAnalizado(parsed);
    } catch (e) {
      setAnalisis({ _error: true, resumen: "No se pudo conectar con el servicio de análisis." });
    } finally { setAnalizando(false); }
  };

  // Auto-Biggy al abrir en Etapa 2+ (solo personas), si no hay análisis cacheado.
  useEffect(() => {
    if (docsCert && !enEtapa1 && !enLlamada && !esVeh && !analisis && !analizando) analizarCert(docsCert);
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

  const campos = esVeh ? [
    ["Placa", veh?.placa], ["VIN", veh?.vin], ["Marca", veh?.marca], ["Modelo", veh?.modelo],
    ["Año", veh?.anio], ["Clase", veh?.clase], ["Entidad emplacamiento", veh?.entidad_emplaco],
    ["REPUVE ID", veh?.repuve_id], ["Estatus robo", veh?.estatus_robo],
    ["Registrado", veh ? (veh.registrado ? "Sí" : "No") : "—"],
  ] : [
    ["Nombre", cond?.nombre], ["CURP", cond?.curp], ["RFC", cond?.rfc],
    ["Teléfono", cond?.telefono], ["Email", cond?.email],
    ["Licencia N°", cond?.licencia_numero], ["Licencia estado", cond?.licencia_estado],
    ["Licencia vigencia", cond?.licencia_vigencia],
  ];

  return (
    <div>
      <div style={{ background: "#fff", borderBottom: "0.5px solid #e4e7ec", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 9 }}>
        <button className="btn-back" onClick={onVolver}>← Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{titulo}</div>
          <div style={{ fontSize: 12, color: "#888" }}>{cert.service_center || ter?.service_center || "—"} · {tc.label}</div>
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
                ? <>Este vehículo está en <b>Etapa 1 · Recepción</b>. Los vehículos no requieren llamada: pasan directo a <b>Pre Validación Biggy</b> y luego a REPUVE.</>
                : <>Esta postulación está en <b>Etapa 1 · Recepción</b>. A los 30 segundos pasa sola a <b>Etapa 2 · Llamada de Supervisor</b> (se genera la tarea en la Bitácora), o puedes pasarla ahora:</>}
            </div>
            <button className="btn-orange" onClick={onPasarEtapa2} style={{ width: "100%" }}>
              {esVeh ? "▶ Pasar a Etapa 3 · Pre Validación Biggy" : "▶ Pasar a Etapa 2 · Llamada de Supervisor"}
            </button>
          </div>
        )}

        {enLlamada && !esVeh && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 13, color: "#0e7490", lineHeight: 1.6 }}>
              📞 <b>Etapa 2 · Llamada de Supervisor.</b> Hay una tarea pendiente en la Bitácora del Supervisor (SLA 48 h).
              Si el supervisor acepta, la tarjeta pasa sola a <b>Pre Validación Biggy</b> con su comentario; si rechaza, pasa a <b>Rechazado</b>.
            </div>
          </div>
        )}

        {cert.comentario_supervisor && !enEtapa1 && !enLlamada && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0e7490", marginBottom: 4 }}>📞 Comentario del supervisor</div>
            <div style={{ fontSize: 13, color: "#155e70", lineHeight: 1.5 }}>{cert.comentario_supervisor}</div>
          </div>
        )}

        {/* Etapa 3+: Biggy para personas; vehículos usarán su Vision propia (track REPUVE) */}
        {!enEtapa1 && !enLlamada && !esVeh && (
          <BiggyChatBubble analizando={analizando} analisis={analisis} score={score} recomendacion={recomendacion} alertas={alertas} onReanalizar={() => docsCert && analizarCert(docsCert)} />
        )}
        {!enEtapa1 && esVeh && (
          <div className="form-card" style={{ background: "#eef2f7", border: "1px solid #d6def0" }}>
            <div style={{ fontSize: 13, color: "#1a3a6b" }}>Vehículo en <b>{ETAPA_CORTA[etapaActual] || etapaActual}</b>. La validación por Claude Vision (fotos vs modelo declarado) se conecta con el track <b>REPUVE</b>.</div>
          </div>
        )}

        {/* Etapa 2 → siguiente: MELI (persona) / REPUVE (vehículo, sin pasar por MELI) */}
        {enEtapa2 && (
          <div className="form-card">
            {esVeh ? (
              <button className="btn-orange" onClick={() => onMoverA("validacion_nubarium")} style={{ width: "100%" }}>
                ▶ Pasar a Validación REPUVE
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

        {/* Resultado de MELI */}
        {!enEtapa1 && !esVeh && etapaActual === "validacion_nubarium" && (
          <div className="form-card" style={{ background: "#eafaf0", border: "1px solid #b7e4c7" }}>
            <div style={{ fontSize: 13, color: "#166534" }}>✅ <b>Aprobado por MELI.</b> {cert.respuesta_meli || ""} — Ahora en <b>Etapa 4 · Nubarium</b>.</div>
          </div>
        )}
        {etapaActual === "rechazado" && (
          <div className="form-card" style={{ background: "#fdecec", border: "1px solid #f5c2c2" }}>
            <div style={{ fontSize: 13, color: "#991b1b" }}>✕ <b>Rechazado.</b> {cert.respuesta_meli || cert.motivo_rechazo || ""}</div>
          </div>
        )}

        {etapaActual === "entrevista_operaciones" && !esVeh && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 13, color: "#0e7490", lineHeight: 1.6 }}>
              🗣 <b>Etapa 6 · Entrevista con Operaciones.</b> Tarea <b>"Entrevista Prospección"</b> en la Bitácora del Supervisor (SLA 72 h).
              Si aprueba la minuta, pasa a <b>Solicitud de Alta</b>; si rechaza, a <b>Rechazado</b>.
            </div>
          </div>
        )}
        {etapaActual === "solicitud_alta" && !esVeh && (
          <ResumenSolicitudAlta fuente="certificaciones" registro={cert}
            datos={{ nombre: cond?.nombre || ter?.nombre, rfc: cond?.rfc, email: cond?.email }}
            onEnviado={(patch) => { Object.assign(cert, patch); if (onMoverA) onMoverA("firma_contrato"); }} />
        )}
        {cert.comentario_entrevista && ["solicitud_alta", "firma_contrato", "aceptado"].includes(etapaActual) && (
          <div className="form-card" style={{ background: "#e8f6f9", border: "1px solid #c9e8f0" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0e7490", marginBottom: 4 }}>🗣 Comentario de la entrevista (Operaciones)</div>
            <div style={{ fontSize: 13, color: "#155e70", lineHeight: 1.5 }}>{cert.comentario_entrevista}</div>
          </div>
        )}

        {etapaActual === "firma_contrato" && !esVeh && (
          <SeccionFirmaContrato registro={cert} tabla="certificaciones"
            datos={{ nombre: cond?.nombre || ter?.nombre, curp: cond?.curp, rfc: cond?.rfc, email: cond?.email,
              puesto: cert.tipo === "ayudante" ? "Ayudante" : "Driver", sc: cert.service_center || ter?.service_center, placa: null }}
            onActualizado={(patch) => { Object.assign(cert, patch); setDocsCert(d => d ? [...d] : d); }} />
        )}

        {ter?.nombre && (
          <div className="form-card">
            <div style={{ fontSize: 12, color: "#555" }}>Empresa transportista: <b>{ter.nombre}</b></div>
          </div>
        )}

        <div className="form-card">
          <div className="form-title">{esVeh ? "Datos del vehículo" : "Datos del candidato"}</div>
          <div className="three-col">
            {campos.map(([l, v]) => (
              <div key={l} style={{ padding: "8px 0", borderBottom: "1px solid #f4f5f7" }}>
                <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{v || "—"}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="form-card">
          <div className="form-title">Documentos</div>
          {docsCert === null ? (
            <div style={{ fontSize: 12, color: "#888" }}>Cargando documentos…</div>
          ) : docsCert.length === 0 ? (
            <div style={{ fontSize: 12, color: "#888" }}>Sin documentos cargados.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 12 }}>
              {docsCert.map((d) => (
                <VisorDoc key={d.tipo_documento} url={d.url} label={DOC_LABEL[d.tipo_documento] || d.tipo_documento} />
              ))}
            </div>
          )}
        </div>
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

function KanbanBoard({ items, onCardClick, onMover, onEliminar }) {
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
        {COLUMNAS.map(col => {
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
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 8, wordBreak: "break-word" }}>{card.titulo}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
                      {tc.icon} {tc.label}
                    </span>
                    <span style={{ fontSize: 10, color: "#888", fontWeight: 600 }}>📍 {card.sc}</span>
                    <NotaBiggy score={card.score} />
                    {card.rec && <span style={{ fontSize: 9, color: "#888" }}>{card.rec}</span>}
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

function GestionadorContratos() {
  const [docs, setDocs] = useState(null);
  const [terceros, setTerceros] = useState([]);
  const [nuevo, setNuevo] = useState(false);
  const [firmandoBT, setFirmandoBT] = useState(null); // id del doc con widget abierto
  const [f, setF] = useState({ tercero_id: "", titulo: "", tipo: "contrato", descripcion: "", archivo: null });
  const [guardando, setGuardando] = useState(false);
  const [enviandoId, setEnviandoId] = useState(null);

  const cargar = async () => {
    const { data } = await sb.from("contratos_gestion")
      .select("*, terceros(nombre, email_portal)")
      .order("created_at", { ascending: false });
    setDocs(data || []);
  };
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

  const eliminarDoc = async (doc) => {
    if (doc.estado !== "borrador") { alert("Solo se pueden eliminar documentos en borrador."); return; }
    if (!confirm(`¿Eliminar el borrador "${doc.titulo}"?`)) return;
    await sb.from("contratos_gestion").delete().eq("id", doc.id);
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 12, color: "#888" }}>
          Contratos, anexos, bajas y otros documentos de firma — independientes del proceso de ingreso.
        </div>
        <button className="btn-orange" onClick={() => setNuevo(!nuevo)} style={{ padding: "9px 16px" }}>
          {nuevo ? "Cancelar" : "➕ Nuevo documento"}
        </button>
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
          </div>
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
                <button onClick={() => setFirmandoBT(firmandoBT === doc.id ? null : doc.id)}
                  style={{ background: "#fff", color: "#7c3aed", border: "1.5px solid #ddd0f7", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {firmandoBT === doc.id ? "Cerrar" : "✍️ Firmar como Bigticket"}
                </button>
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
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t || !sel) return;
    setTexto("");
    const fila = { tercero_id: sel.tercero_id, autor: "bigticket", mensaje: t };
    const { data, error } = await sb.from("mensajes_terceros").insert(fila).select("*").single();
    if (error) { alert("No se pudo enviar: " + error.message); setTexto(t); return; }
    setMsgs(prev => [...(prev || []), data]);
    cargarConvos();
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
            <div style={{ padding: "12px 16px", borderBottom: "0.5px solid #e4e7ec", fontWeight: 700, fontSize: 14 }}>🏢 {sel.nombre}</div>
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
                      {new Date(m.created_at).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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

function ModuloCertificaciones() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [vista, setVista] = useState("kanban");
  const [seccion, setSeccion] = useState("certificaciones"); // certificaciones | contratos | mensajes
  const [busqueda, setBusqueda] = useState("");
  const [filtroFuente, setFiltroFuente] = useState("todas");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  useEffect(() => { (async () => { await autoSyncCRM(); await cargar(); })(); }, []);

  const cargar = async () => {
    setLoading(true);
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
      setItems([...cardsB, ...cardsA]);
    } catch (e) {
      console.error("Error cargando certificaciones:", e.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // Fuente A: jala prospectos del CRM/onboarding a certificaciones_mx
  const autoSyncCRM = async () => {
    try {
      const { data: onboardings, error: errOnb } = await sb
        .from("onboarding_terceros")
        .select("*, leads(id, nombre, etapa, curp, email, telefono, zona, region_estado)")
        .eq("pais", "México")
        .not("url_ine", "is", null)
        .not("url_curp", "is", null)
        .not("url_rfc", "is", null);
      if (errOnb || !onboardings) return;

      const enValidacion = onboardings.filter(o => o.leads?.etapa === "Entrevistas y Validaciones");
      if (enValidacion.length === 0) return;

      const { data: existentes } = await sb
        .from("certificaciones_mx").select("lead_crm_id").not("lead_crm_id", "is", null);
      const idsExistentes = (existentes || []).map(e => e.lead_crm_id);

      const nuevos = enValidacion.filter(o => !idsExistentes.includes(o.lead_id));
      if (nuevos.length === 0) return;

      const registros = nuevos.map(o => ({
        lead_crm_id:  o.lead_id,
        nombre:       o.nombre       || o.leads?.nombre    || "",
        curp:         o.curp         || o.leads?.curp      || "",
        rfc:          o.rfc          || "",
        ine:          o.rut          || "",
        licencia:     o.licencia     || "",
        puesto:       o.puesto       || "",
        svc:          (o.leads?.region_estado || o.leads?.zona || "").split(" ")[0],
        email:        o.email        || o.leads?.email     || "",
        telefono:     o.telefono     || o.leads?.telefono  || "",
        url_ine:      o.url_ine      || "",
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
      return <DetalleCertificacion cert={selected.raw} etapa={selected.etapa} onVolver={() => setSelected(null)}
        onPasarEtapa2={() => moverYCerrar(selected, selected.tipo === "vehiculo" ? "prevalidacion_biggy" : "llamada_supervisor")}
        onMoverA={(etapa) => moverYCerrar(selected, etapa)}
        onAnalizado={(parsed) => setItems(prev => prev.map(i => i.key === selected.key ? {
          ...i, score: parsed.score_global, rec: parsed.recomendacion,
          raw: { ...i.raw, claude_analisis: parsed, claude_score_global: parsed.score_global, claude_recomendacion: parsed.recomendacion, claude_alertas: parsed.alertas || [] },
        } : i))} />;
    }
    return (
      <DetalleCandidato
        candidato={selected.raw}
        onVolver={() => setSelected(null)}
        onPasarEtapa2={() => moverYCerrar(selected, "llamada_supervisor")}
        onActualizar={(updated) => {
          const rn = normalizarProspeccion(updated);
          setItems(prev => prev.map(i => i.key === rn.key ? rn : i));
          setSelected(rn);
        }}
      />
    );
  }

  // Buscador + filtros
  const q = busqueda.trim().toLowerCase();
  const itemsFiltrados = items.filter(i => {
    if (filtroFuente !== "todas" && i.fuente !== filtroFuente) return false;
    if (filtroTipo !== "todos" && i.tipo !== filtroTipo) return false;
    if (!q) return true;
    const r = i.raw || {};
    const campos = [i.titulo, i.sc, i.key, r.curp, r.rfc, r.email, r.telefono, r.svc]
      .filter(Boolean).join(" ").toLowerCase();
    return campos.includes(q);
  });

  const conteo = {
    total:       itemsFiltrados.length,
    recepcion:   itemsFiltrados.filter(i => i.etapa === "recepcion").length,
    prospeccion: itemsFiltrados.filter(i => i.fuente === "prospeccion").length,
    portal:      itemsFiltrados.filter(i => i.fuente === "portal_cert").length,
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
            <div style={{ display: "flex", background: "#fff", borderRadius: 8, border: "0.5px solid #e4e7ec", overflow: "hidden" }}>
              {[["kanban", "Kanban"], ["lista", "Lista"]].map(([v, l]) => (
                <button key={v} onClick={() => setVista(v)}
                  style={{ padding: "7px 14px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "'Geist',sans-serif",
                    background: vista === v ? "#1a3a6b" : "#fff", color: vista === v ? "#fff" : "#666", fontWeight: vista === v ? 600 : 400 }}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pestañas de sección */}
      <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid #e4e7ec" }}>
        {[["certificaciones", "📋 Certificaciones"], ["contratos", "📑 Gestionador de Contratos"], ["mensajes", "💬 Mensajes"]].map(([v, l]) => (
          <button key={v} onClick={() => { setSeccion(v); setSelected(null); }}
            style={{ padding: "10px 16px", border: "none", cursor: "pointer", fontSize: 13, fontFamily: "'Geist',sans-serif",
              background: "transparent", fontWeight: seccion === v ? 700 : 400,
              color: seccion === v ? "#1a3a6b" : "#888",
              borderBottom: seccion === v ? "2.5px solid #F47B20" : "2.5px solid transparent", marginBottom: -1 }}>
            {l}
          </button>
        ))}
      </div>

      {seccion === "contratos" && <GestionadorContratos />}
      {seccion === "mensajes" && <MensajesTerceros />}

      {seccion === "certificaciones" && (
      <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar por nombre, SC, CURP, RFC, email…"
          style={{ flex: 1, minWidth: 220, background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "'Geist',sans-serif" }}
        />
        <select value={filtroFuente} onChange={(e) => setFiltroFuente(e.target.value)}
          style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 12, fontFamily: "'Geist',sans-serif", color: "#333" }}>
          <option value="todas">Todas las fuentes</option>
          <option value="prospeccion">🎯 Prospección</option>
          <option value="portal_cert">🏢 Portal Cert.</option>
        </select>
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
          style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 8, padding: "9px 12px", fontSize: 12, fontFamily: "'Geist',sans-serif", color: "#333" }}>
          <option value="todos">Todos los tipos</option>
          <option value="conductor">🚗 Driver</option>
          <option value="ayudante">🧰 Ayudante</option>
          <option value="vehiculo">🚚 Vehículo</option>
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
          ...COLUMNAS.map(c => [ETAPA_CORTA[c.id] || c.label, itemsFiltrados.filter(i => i.etapa === c.id).length, c.color])
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 20 }}>
        Por fuente: 🎯 Prospección <b>{conteo.prospeccion}</b> · 🏢 Portal Cert. <b>{conteo.portal}</b>
      </div>

      {loading ? <div className="loading">Cargando...</div> : itemsFiltrados.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{items.length === 0 ? "Sin postulaciones" : "Sin resultados"}</div>
          <div style={{ fontSize: 12 }}>{items.length === 0 ? "Aún no hay ingresos desde Prospección ni desde el Portal de Certificación" : "Ninguna tarjeta coincide con la búsqueda o los filtros"}</div>
        </div>
      ) : vista === "kanban" ? (
        <KanbanBoard items={itemsFiltrados} onCardClick={setSelected} onMover={moverTarjeta} onEliminar={eliminarTarjeta} />
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
                    <NotaBiggy score={card.score} />
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>📍 {card.sc}</div>
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
