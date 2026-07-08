import { useState, useEffect, useRef } from "react";
import { sb, BIGGY_IMG } from "./shared";

const COLUMNAS = [
  { id: "recepcion",           label: "Etapa 1: Recepción Documental", color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "prevalidacion_biggy", label: "Etapa 2: Pre Validación Biggy",  color: "#F47B20", bg: "#fff4ec", border: "#fbd9c0" },
  { id: "validacion_meli",     label: "Etapa 3: Validación MELI",       color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "validacion_nubarium", label: "Etapa 4: Validación Nubarium",   color: "#1a3a6b", bg: "#eef2f7", border: "#d6def0" },
  { id: "aceptado",            label: "Aceptado",                       color: "#166534", bg: "#e8f5ec", border: "#b7e0c2" },
  { id: "rechazado",           label: "Rechazado",                      color: "#c0392b", bg: "#fbeaea", border: "#f0c4c4" },
];

// Etiquetas cortas para los KPIs del header (coinciden con las columnas)
const ETAPA_CORTA = {
  recepcion: "Etapa 1 · Recepción", prevalidacion_biggy: "Etapa 2 · Biggy", validacion_meli: "Etapa 3 · MELI",
  validacion_nubarium: "Etapa 4 · Nubarium", aceptado: "Aceptado", rechazado: "Rechazado",
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
function DetalleCandidato({ candidato, onVolver, onActualizar }) {
  const [analizando, setAnalizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [analisis, setAnalisis] = useState(candidato.claude_analisis || null);
  const [score, setScore] = useState(candidato.claude_score_global || null);
  const [recomendacion, setRecomendacion] = useState(candidato.claude_recomendacion || null);
  const [alertas, setAlertas] = useState(candidato.claude_alertas || []);
  const [decidiendo, setDecidiendo] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");

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

      await sb.from("certificaciones_mx").update({
        claude_analisis: parsed,
        claude_score_global: parsed.score_global,
        claude_recomendacion: parsed.recomendacion,
        claude_alertas: parsed.alertas || [],
        claude_reviewed_at: new Date().toISOString(),
      }).eq("id", candidato.id);

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
      const patch = { estado: nuevoEstado, decidido_at: now };
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

  const estadoBadge = { pendiente: "badge-pendiente", enviado: "badge-enviado", aprobado: "badge-aprobado", aceptado: "badge-aprobado", rechazado: "badge-rechazado" };

  const tieneAnalisis = !!(analisis || candidato.claude_analisis);
  const enEtapa1 = candidato.estado === "pendiente" && !tieneAnalisis;

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
        {/* Etapa 1: solo visualización + botón para pasar a Pre Validación Biggy.
            Al pasar, Biggy (Claude Vision) analiza los documentos. */}
        {(analisis || analizando) ? (
          <BiggyChatBubble analizando={analizando} analisis={analisis} score={score} recomendacion={recomendacion} alertas={alertas} onReanalizar={analizarConClaude} />
        ) : (
          <div className="form-card" style={{ background: "#fff4ec", border: "1px solid #fbd9c0" }}>
            <div style={{ fontSize: 13, color: "#7c3a12", lineHeight: 1.6, marginBottom: 12 }}>
              Este postulante está en <b>Etapa 1 · Recepción</b>. Revisa la información y los documentos; cuando estés listo, pásalo a <b>Pre Validación Biggy</b> para que Claude analice los documentos.
            </div>
            <button className="btn-orange" onClick={analizarConClaude} disabled={analizando} style={{ width: "100%" }}>
              {analizando ? "Analizando..." : "▶ Pasar a Etapa 2 · Pre Validación Biggy"}
            </button>
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

        {/* Certificación MELI — oculto en Etapa 1 (aún no pre-validado por Biggy) */}
        {!enEtapa1 && (
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
                  <button onClick={() => decidir("aceptado")} disabled={decidiendo}
                    style={{ flex: 1, background: "#16a34a", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: decidiendo ? 0.6 : 1 }}>
                    {decidiendo ? "Guardando..." : "✓ Aceptar certificación"}
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
              ✅ Aceptado — validado por MELI y Nubarium
            </div>
          )}
          {candidato.estado === "rechazado" && (
            <div style={{ background: "#fee2e2", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#c0392b", fontWeight: 700 }}>
              ❌ Certificación rechazada — {candidato.motivo_rechazo || candidato.respuesta_meli}
            </div>
          )}
        </div>
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
const ETAPA_MX   = { pendiente: "recepcion", enviado: "validacion_meli", aprobado: "validacion_nubarium", aceptado: "aceptado", rechazado: "rechazado" };
const ETAPA_CERT = { enviado: "recepcion", en_validacion: "validacion_meli", validado: "aceptado", con_alertas: "aceptado", certificado: "aceptado", rechazado: "rechazado" };

// Etapa de un prospecto (Fuente A). "pendiente" se divide: sin análisis de Biggy → Recepción;
// con análisis cacheado → Etapa 2 (Pre Validación Biggy).
function etapaProspeccion(row) {
  const base = ETAPA_MX[row.estado] || "recepcion";
  if (base === "recepcion" && row.claude_analisis) return "prevalidacion_biggy";
  return base;
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
    etapa:  ETAPA_CERT[row.estado] || "recepcion",
    estado_raw: row.estado,
    raw: { ...row, _conductor: cond, _vehiculo: veh, _tercero: ter },
  };
}

// Resumen de postulación (read-only) para tarjetas del Portal de Certificación.
// DetalleCandidato (certificaciones_mx) sigue intacto para la otra fuente.
function DetalleCertificacion({ cert, onVolver, onPasarEtapa2 }) {
  const [docsCert, setDocsCert] = useState(null);
  const enEtapa1 = (ETAPA_CERT[cert.estado] || "recepcion") === "recepcion";
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
  const cond = cert._conductor;
  const veh  = cert._vehiculo;
  const ter  = cert._tercero;
  const esVeh = cert.tipo === "vehiculo";
  const titulo = esVeh ? (veh?.placa || "Sin placa") : (cond?.nombre || ter?.nombre || "Sin nombre");
  const tc = TIPO_CFG[cert.tipo] || TIPO_CFG.conductor;

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
        {/* Etapa 1: pasar a Pre Validación Biggy (mismo patrón que Prospección) */}
        {enEtapa1 && (
          <div className="form-card" style={{ background: "#fff4ec", border: "1px solid #fbd9c0" }}>
            <div style={{ fontSize: 13, color: "#7c3a12", lineHeight: 1.6, marginBottom: 12 }}>
              Esta postulación está en <b>Etapa 1 · Recepción</b>. Revisa la información y los documentos; cuando estés listo, pásala a <b>Pre Validación Biggy</b>.
            </div>
            <button className="btn-orange" onClick={onPasarEtapa2} style={{ width: "100%" }}>
              ▶ Pasar a Etapa 2 · Pre Validación Biggy
            </button>
          </div>
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
function ModuloCertificaciones() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [vista, setVista] = useState("kanban");
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
      const cardsA = (rp.data || []).map(normalizarProspeccion);
      const cardsB = (rc.data || []).map(normalizarPortalCert);
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
    recepcion: "pendiente", prevalidacion_biggy: "pendiente", validacion_meli: "enviado",
    validacion_nubarium: "aprobado", aceptado: "aceptado", rechazado: "rechazado",
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
    setItems(prev => prev.map(i => i.key === cardKey ? { ...i, etapa: targetEtapa } : i));
    // Persiste solo la Fuente A; el Portal (Fuente B) se mueve solo en el tablero
    if (card.fuente === "prospeccion") {
      const estado = ESTADO_POR_ETAPA[targetEtapa];
      if (estado) {
        const { error } = await sb.from("certificaciones_mx").update({ estado, updated_at: new Date().toISOString() }).eq("id", card.id);
        if (error) { alert("No se pudo guardar el movimiento: " + error.message); await cargar(); return; }
      }
      // Al entrar a Etapa 2, Biggy analiza los documentos (si aún no lo hizo)
      if (targetEtapa === "prevalidacion_biggy" && !card.raw?.claude_analisis) {
        analizarProspecto(card);
      }
    }
  };

  // Quitar tarjeta del tablero (SOLO front, no borra de la BBDD)
  const eliminarTarjeta = (card) => {
    if (!confirm(`¿Quitar "${card.titulo}" del tablero?\n\nSolo se oculta de la vista — NO se elimina de la base de datos.`)) return;
    setItems(prev => prev.filter(i => i.key !== card.key));
  };

  if (selected) {
    if (selected.fuente === "portal_cert") {
      return <DetalleCertificacion cert={selected.raw} onVolver={() => setSelected(null)}
        onPasarEtapa2={() => {
          setItems(prev => prev.map(i => i.key === selected.key ? { ...i, etapa: "prevalidacion_biggy" } : i));
          setSelected(null);
        }} />;
    }
    return (
      <DetalleCandidato
        candidato={selected.raw}
        onVolver={() => setSelected(null)}
        onActualizar={(updated) => {
          const rn = normalizarProspeccion(updated);
          setItems(items.map(i => i.key === rn.key ? rn : i));
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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Certificaciones MX 🇲🇽</div>
          <div className="sec-sub">Recepción documental — Prospección + Portal de Certificación</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <img src={BIGGY_IMG} alt="Biggy" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", border: "2px solid #F47B20" }} />
          <div style={{ display: "flex", background: "#fff", borderRadius: 8, border: "0.5px solid #e4e7ec", overflow: "hidden" }}>
            {[["kanban", "Kanban"], ["lista", "Lista"]].map(([v, l]) => (
              <button key={v} onClick={() => setVista(v)}
                style={{ padding: "7px 14px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "'Geist',sans-serif",
                  background: vista === v ? "#1a3a6b" : "#fff", color: vista === v ? "#fff" : "#666", fontWeight: vista === v ? 600 : 400 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

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
    </div>
  );
}

export default ModuloCertificaciones;
