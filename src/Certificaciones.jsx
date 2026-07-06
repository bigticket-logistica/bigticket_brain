import { useState, useEffect } from "react";
import { sb, BIGGY_IMG } from "./shared";

const COLUMNAS = [
  { id: "recepcion",           label: "Etapa 1: Recepción Documental", color: "#1a3a6b", bg: "#eef2ff", border: "#c7d2fe" },
  { id: "prevalidacion_biggy", label: "Etapa 2: Pre Validación Biggy",  color: "#c2410c", bg: "#fff7ed", border: "#fed7aa" },
  { id: "validacion_meli",     label: "Etapa 3: Validación MELI",       color: "#92400e", bg: "#fef3c7", border: "#fde68a" },
  { id: "validacion_nubarium", label: "Etapa 4: Validación Nubarium",   color: "#0369a1", bg: "#e0f2fe", border: "#7dd3fc" },
  { id: "aceptado",            label: "Aceptado",                       color: "#166534", bg: "#dcfce7", border: "#86efac" },
  { id: "rechazado",           label: "Rechazado",                      color: "#c0392b", bg: "#fee2e2", border: "#fca5a5" },
];

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

// ─── DETALLE CANDIDATO ───────────────────────────────────────────────
function DetalleCandidato({ candidato, onVolver, onActualizar }) {
  const [analizando, setAnalizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [analisis, setAnalisis] = useState(candidato.claude_analisis || null);
  const [score, setScore] = useState(candidato.claude_score_global || null);
  const [recomendacion, setRecomendacion] = useState(candidato.claude_recomendacion || null);
  const [alertas, setAlertas] = useState(candidato.claude_alertas || []);

  // ✅ Análisis automático: corre si no hay analisis local cargado
  useEffect(() => {
    if (!analisis && !analizando) {
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

  const estadoBadge = { pendiente: "badge-pendiente", enviado: "badge-enviado", aprobado: "badge-aprobado", aceptado: "badge-aprobado", rechazado: "badge-rechazado" };

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
        {/* Biggy análisis automático */}
        <BiggyChatBubble analizando={analizando} analisis={analisis} score={score} recomendacion={recomendacion} alertas={alertas} onReanalizar={analizarConClaude} />

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

        {/* Comparativa de datos */}
        <ComparativaDatos candidato={candidato} analisis={analisis} />

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

        {/* Estado certificación */}
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
            <div style={{ background: "#e0f2fe", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#0369a1", fontWeight: 700 }}>
              ✅ Aprobado por Mercado Libre — pasa a Validación Nubarium
            </div>
          )}
          {candidato.estado === "aceptado" && (
            <div style={{ background: "#dcfce7", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#166534", fontWeight: 700 }}>
              ✅ Aceptado — validado por MELI y Nubarium
            </div>
          )}
          {candidato.estado === "rechazado" && (
            <div style={{ background: "#fee2e2", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#c0392b", fontWeight: 700 }}>
              ❌ Certificación rechazada — {candidato.respuesta_meli}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const FUENTE_CFG = {
  prospeccion: { label: "Prospección",  icon: "🎯", bg: "#ede9fe", color: "#6d28d9", border: "#c4b5fd" },
  portal_cert: { label: "Portal Cert.", icon: "🏢", bg: "#e0f2fe", color: "#0369a1", border: "#7dd3fc" },
};

// Chip de TIPO
const TIPO_CFG = {
  conductor: { label: "Driver",   icon: "🚗", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  ayudante:  { label: "Ayudante", icon: "🧰", bg: "#f0fdf4", color: "#166534", border: "#bbf7d0" },
  vehiculo:  { label: "Vehículo", icon: "🚚", bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
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
function DetalleCertificacion({ cert, onVolver }) {
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
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: FUENTE_CFG.portal_cert.bg, color: FUENTE_CFG.portal_cert.color, border: `1px solid ${FUENTE_CFG.portal_cert.border}` }}>
          {FUENTE_CFG.portal_cert.icon} {FUENTE_CFG.portal_cert.label}
        </span>
      </div>

      <div className="pg-detail">
        <div className="form-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tc.bg, color: tc.color, border: `1px solid ${tc.border}` }}>
              {tc.icon} {tc.label}
            </span>
            <span className={`badge`} style={{ fontSize: 11 }}>{(cert.estado || "—").toUpperCase()}</span>
          </div>
          {ter?.nombre && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
              Empresa transportista: <b>{ter.nombre}</b>
            </div>
          )}
        </div>

        <div className="form-card">
          <div className="form-title">Resumen de postulación</div>
          <div className="three-col">
            {campos.map(([l, v]) => (
              <div key={l} style={{ padding: "8px 0", borderBottom: "1px solid #f4f5f7" }}>
                <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{v || "—"}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#0369a1" }}>
          Validación MELI y Nubarium se conectan en el siguiente paso del rediseño.
        </div>
      </div>
    </div>
  );
}

// ─── KANBAN ──────────────────────────────────────────────────────────
function KanbanBoard({ items, onCardClick }) {
  return (
    <div className="kanban-board">
      {COLUMNAS.map(col => {
        const cards = items.filter(i => i.etapa === col.id);
        return (
          <div key={col.id} className="kanban-col">
            <div className="kanban-col-header" style={{ background: col.bg, border: `1px solid ${col.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>{col.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: col.color, background: "rgba(255,255,255,0.6)", borderRadius: 20, padding: "2px 8px" }}>{cards.length}</span>
            </div>
            {cards.length === 0 && <div style={{ textAlign: "center", padding: "20px 10px", fontSize: 12, color: "#bbb" }}>Sin postulaciones</div>}
            {cards.map(card => {
              const fc = FUENTE_CFG[card.fuente] || FUENTE_CFG.prospeccion;
              const tc = TIPO_CFG[card.tipo] || TIPO_CFG.conductor;
              const esVeh = card.tipo === "vehiculo";
              return (
                <div key={card.key} className="kanban-card" onClick={() => onCardClick(card)}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 }}>
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
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── MÓDULO CERTIFICACIONES ──────────────────────────────────────────
function ModuloCertificaciones() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [vista, setVista] = useState("kanban");

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

  if (selected) {
    if (selected.fuente === "portal_cert") {
      return <DetalleCertificacion cert={selected.raw} onVolver={() => setSelected(null)} />;
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

  const conteo = {
    total:       items.length,
    recepcion:   items.filter(i => i.etapa === "recepcion").length,
    prospeccion: items.filter(i => i.fuente === "prospeccion").length,
    portal:      items.filter(i => i.fuente === "portal_cert").length,
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
        {[["Total", conteo.total, "#1a3a6b"], ["Etapa 1 · Recepción", conteo.recepcion, "#1a3a6b"],
          ["🎯 Prospección", conteo.prospeccion, "#6d28d9"], ["🏢 Portal Cert.", conteo.portal, "#0369a1"]
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      {loading ? <div className="loading">Cargando...</div> : items.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Sin postulaciones</div>
          <div style={{ fontSize: 12 }}>Aún no hay ingresos desde Prospección ni desde el Portal de Certificación</div>
        </div>
      ) : vista === "kanban" ? (
        <KanbanBoard items={items} onCardClick={setSelected} />
      ) : (
        <div>
          {items.map(card => {
            const fc = FUENTE_CFG[card.fuente] || FUENTE_CFG.prospeccion;
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
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>📍 {card.sc}</div>
                </div>
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
