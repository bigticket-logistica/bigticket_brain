import { useState, useEffect, useRef } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://psvdtgjvognbmxfvqbaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_RayW0wqgesNI6FYZ6i0CFQ_6YHaHELP";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const PIPE_ID = "306833898";

const MODULOS = {
  superadmin: ["certificaciones", "wiki", "checklist", "kpis", "maestro", "configuracion"],
  certificacion: ["certificaciones"],
};
const MODULOS_LABELS = {
  certificaciones: "Certificaciones", wiki: "Wiki y Procesos",
  checklist: "Checklist", kpis: "KPIs",
  maestro: "Maestro Operaciones", configuracion: "Configuración",
};
const USUARIOS = {
  "admin@bigticket.cl": { pass: "Admin2026!", rol: "superadmin", nombre: "Super Admin" },
  "cert@bigticket.mx":  { pass: "Cert2026!", rol: "certificacion", nombre: "Equipo Certificación" },
};

const COLUMNAS = [
  { id: "pendiente", label: "Validación MELI", color: "#92400e", bg: "#fef3c7", border: "#fde68a" },
  { id: "enviado",   label: "Enviado a Meli",  color: "#1e40af", bg: "#dbeafe", border: "#93c5fd" },
  { id: "aprobado",  label: "Aprobado",        color: "#166534", bg: "#dcfce7", border: "#86efac" },
  { id: "rechazado", label: "Rechazado",       color: "#c0392b", bg: "#fee2e2", border: "#fca5a5" },
];

const css = `
  @import url('https://fonts.bunny.net/css?family=geist:400,500,600,700,800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Geist',sans-serif;background:#f0f2f5;min-height:100vh;}
  .topbar{background:#1a3a6b;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
  .btn-gw{background:transparent;color:#fff;border:0.5px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:'Geist',sans-serif;}
  .admin-nav{display:flex;gap:6px;padding:12px 20px;background:#fff;border-bottom:0.5px solid #e4e7ec;overflow-x:auto;}
  .nav-btn{padding:7px 14px;font-size:13px;border-radius:8px;border:none;cursor:pointer;background:transparent;color:#666;font-family:'Geist',sans-serif;white-space:nowrap;}
  .nav-btn.active{background:#eef2ff;color:#1a3a6b;font-weight:600;}
  .pg{padding:20px;max-width:1400px;margin:0 auto;padding-bottom:40px;}
  .pg-detail{padding:20px;max-width:960px;margin:0 auto;padding-bottom:40px;}
  .sec-title{font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:4px;}
  .sec-sub{font-size:13px;color:#666;margin-bottom:20px;}
  .form-card{background:#fff;border:0.5px solid #e4e7ec;border-radius:14px;padding:20px;margin-bottom:16px;}
  .form-title{font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:14px;}
  .field-row{margin-bottom:14px;}
  .field-label{font-size:12px;color:#555;margin-bottom:4px;display:block;font-weight:500;}
  input,select,textarea{width:100%;padding:9px 12px;border:0.5px solid #d0d5dd;border-radius:8px;font-size:13px;background:#fff;color:#1a1a1a;font-family:'Geist',sans-serif;outline:none;}
  textarea{height:80px;resize:none;}
  .two-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;}
  .three-col{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
  .btn-orange{background:#F47B20;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Geist',sans-serif;}
  .btn-orange:disabled{background:#ccc;cursor:not-allowed;}
  .btn-blue{background:#1a3a6b;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Geist',sans-serif;}
  .btn-blue:disabled{background:#ccc;cursor:not-allowed;}
  .btn-back{background:transparent;border:none;cursor:pointer;font-size:13px;color:#1a3a6b;font-weight:600;font-family:'Geist',sans-serif;padding:0;}
  .login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f2f5;padding:20px;}
  .login-card{background:#fff;border-radius:16px;padding:40px 32px;width:100%;max-width:400px;border:0.5px solid #e4e7ec;}
  .loading{text-align:center;padding:40px;color:#888;font-size:14px;}
  .empty{text-align:center;padding:32px;color:#888;font-size:13px;background:#fff;border-radius:12px;border:0.5px dashed #e4e7ec;}
  .badge{font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;white-space:nowrap;}
  .badge-pendiente{background:#fef3c7;color:#92400e;}
  .badge-enviado{background:#dbeafe;color:#1e40af;}
  .badge-aprobado{background:#dcfce7;color:#166534;}
  .badge-rechazado{background:#fee2e2;color:#c0392b;}
  .kanban-board{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-items:start;}
  .kanban-col{background:#f8f9fa;border-radius:12px;padding:12px;min-height:200px;}
  .kanban-col-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:8px 10px;border-radius:8px;}
  .kanban-card{background:#fff;border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;border:1px solid #e4e7ec;transition:box-shadow 0.15s,transform 0.1s;}
  .kanban-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.1);transform:translateY(-1px);}
  @media(max-width:900px){.kanban-board{grid-template-columns:1fr 1fr;}}
  @media(max-width:560px){.kanban-board{grid-template-columns:1fr;}.three-col{grid-template-columns:1fr;}.two-col{grid-template-columns:1fr;}}
`;

// ─── LOGIN ──────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const login = () => {
    const u = USUARIOS[email.toLowerCase()];
    if (!u || u.pass !== pass) { setError("Credenciales incorrectas"); return; }
    onLogin({ email, rol: u.rol, nombre: u.nombre });
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>
            <span style={{ color: "#1a3a6b" }}>Big</span><span style={{ color: "#F47B20" }}>ticket</span>
          </div>
          <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>Sistema Integrado Bigticket</div>
        </div>
        {error && <div style={{ background: "#fee2e2", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#c0392b", marginBottom: 14, textAlign: "center" }}>{error}</div>}
        <div className="field-row">
          <span className="field-label">Correo electrónico</span>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" onKeyDown={e => e.key === "Enter" && login()} />
        </div>
        <div className="field-row">
          <span className="field-label">Contraseña</span>
          <div style={{ position: "relative" }}>
            <input value={pass} onChange={e => setPass(e.target.value)} type={show ? "text" : "password"} style={{ paddingRight: 40 }} onKeyDown={e => e.key === "Enter" && login()} />
            <button onClick={() => setShow(!show)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 16 }}>{show ? "🙈" : "👁"}</button>
          </div>
        </div>
        <button className="btn-blue" onClick={login} style={{ width: "100%", marginTop: 8 }}>Ingresar</button>
      </div>
    </div>
  );
}

// ─── VISOR DOCUMENTO (imagen o PDF) ─────────────────────────────────
// Extrae bucket y path desde URL pública de Supabase Storage
function extraerPathSupabase(url) {
  if (!url) return null;
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/);
  if (!match) return null;
  const partes = match[1].split("/");
  return { bucket: partes[0], path: partes.slice(1).join("/") };
}

function VisorDoc({ url, label }) {
  const [ampliado, setAmpliado] = useState(false);
  const [signedUrl, setSignedUrl] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState(false);
  const esPDF = url && url.toLowerCase().includes(".pdf");

  useEffect(() => {
    if (!url) return;
    setCargando(true);
    setErr(false);
    setSignedUrl(null);
    const info = extraerPathSupabase(url);
    if (!info) { setSignedUrl(url); setCargando(false); return; }
    sb.storage.from(info.bucket).createSignedUrl(info.path, 3600)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) { setErr(true); }
        else { setSignedUrl(data.signedUrl); }
        setCargando(false);
      });
  }, [url]);

  if (!url) return (
    <div style={{ background: "#f8f9fa", borderRadius: 8, padding: "20px", textAlign: "center", border: "1px dashed #d0d5dd" }}>
      <div style={{ fontSize: 24 }}>📎</div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>Sin documento</div>
    </div>
  );

  const miniatura = () => {
    if (esPDF) return (
      <div style={{ background: "#f0f9ff", borderRadius: 8, height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "1px solid #bae6fd" }}>
        <div style={{ fontSize: 28 }}>📄</div>
        <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 600, marginTop: 4 }}>PDF</div>
        {cargando && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>Preparando...</div>}
      </div>
    );
    if (cargando) return (
      <div style={{ background: "#f8f9fa", borderRadius: 8, height: 120, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #e4e7ec" }}>
        <div style={{ fontSize: 11, color: "#888" }}>⏳ Cargando...</div>
      </div>
    );
    if (err || !signedUrl) return (
      <div style={{ background: "#fff0f0", borderRadius: 8, height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", border: "1px dashed #fca5a5" }}>
        <div style={{ fontSize: 22 }}>🖼️</div>
        <div style={{ fontSize: 10, color: "#c0392b", marginTop: 4 }}>Sin acceso</div>
        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#1a3a6b", marginTop: 2 }} onClick={e => e.stopPropagation()}>Ver enlace ↗</a>
      </div>
    );
    return <img src={signedUrl} alt={label} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #e4e7ec" }} onError={() => setErr(true)} />;
  };

  // PDF: usar Google Docs Viewer para evitar bloqueos del navegador
  const pdfViewerUrl = signedUrl
    ? `https://docs.google.com/viewer?url=${encodeURIComponent(signedUrl)}&embedded=true`
    : null;

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
                <a href={signedUrl || url} target="_blank" rel="noreferrer"
                  style={{ color: "#aac3e8", fontSize: 11, textDecoration: "none" }}>Abrir ↗</a>
                <button onClick={() => setAmpliado(false)}
                  style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            </div>
            {cargando ? (
              <div style={{ height: "75vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
                ⏳ Preparando documento...
              </div>
            ) : err || !signedUrl ? (
              <div style={{ height: "75vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#888" }}>
                <div style={{ fontSize: 32 }}>🔒</div>
                <div style={{ fontSize: 13 }}>No se pudo acceder al archivo</div>
                <a href={url} target="_blank" rel="noreferrer" style={{ color: "#1a3a6b", fontSize: 13 }}>Abrir enlace original ↗</a>
              </div>
            ) : esPDF ? (
              <iframe
                src={pdfViewerUrl}
                style={{ width: "100%", height: "75vh", border: "none" }}
                title={label}
              />
            ) : (
              <img src={signedUrl} alt={label}
                style={{ width: "100%", maxHeight: "75vh", objectFit: "contain", background: "#111" }}
                onError={() => setErr(true)} />
            )}
          </div>
        </div>
      )}
      <div onClick={() => !cargando && setAmpliado(true)} style={{ cursor: cargando ? "wait" : "pointer" }}>
        {miniatura()}
        <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginTop: 4, fontWeight: 500 }}>{label} 🔍</div>
      </div>
    </>
  );
}

// ─── COMPARATIVA DATOS ───────────────────────────────────────────────
function ComparativaDatos({ candidato, analisisTexto }) {
  if (!analisisTexto) return null;

  // Extraer datos del análisis de Claude
  const extraer = (texto, campo) => {
    const patrones = {
      curp: /curp[:\s]+([A-Z0-9]{18})/i,
      rfc:  /rfc[:\s]+([A-Z0-9]{12,13})/i,
      nombre: /nombre[:\s]+([^\n,]+)/i,
      licencia: /licencia[:\s#]+([A-Z0-9]{6,15})/i,
    };
    const match = texto.match(patrones[campo]);
    return match ? match[1].trim() : null;
  };

  const claudeNombre   = extraer(analisisTexto, "nombre");
  const claudeCurp     = extraer(analisisTexto, "curp");
  const claudeRfc      = extraer(analisisTexto, "rfc");
  const claudeLicencia = extraer(analisisTexto, "licencia");

  const Fila = ({ label, valorPipefy, valorClaude }) => {
    if (!valorClaude) return null;
    const coincide = valorPipefy?.toLowerCase().trim() === valorClaude?.toLowerCase().trim();
    return (
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 32px", gap: 8, padding: "8px 0", borderBottom: "1px solid #f4f5f7", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 12, color: "#1a1a1a", fontWeight: 500 }}>{valorPipefy || "—"}</div>
        <div style={{ fontSize: 12, color: "#1a1a1a", fontWeight: 500 }}>{valorClaude || "—"}</div>
        <div style={{ fontSize: 16, textAlign: "center" }}>{coincide ? "✅" : "❌"}</div>
      </div>
    );
  };

  return (
    <div className="form-card" style={{ border: "1px solid #e9d5ff" }}>
      <div className="form-title">🔍 Comparativa de datos</div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 32px", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase" }}>Campo</div>
        <div style={{ fontSize: 10, color: "#1a3a6b", fontWeight: 700, textTransform: "uppercase" }}>Pipefy</div>
        <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, textTransform: "uppercase" }}>Claude Vision</div>
        <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase" }}>OK</div>
      </div>
      <Fila label="Nombre"   valorPipefy={candidato.nombre}   valorClaude={claudeNombre} />
      <Fila label="CURP"     valorPipefy={candidato.curp}     valorClaude={claudeCurp} />
      <Fila label="RFC"      valorPipefy={candidato.rfc}      valorClaude={claudeRfc} />
      <Fila label="Licencia" valorPipefy={candidato.licencia} valorClaude={claudeLicencia} />
      {!claudeCurp && !claudeRfc && (
        <div style={{ fontSize: 12, color: "#888", marginTop: 8, fontStyle: "italic" }}>
          Claude no pudo extraer todos los campos automáticamente. Revisa el análisis completo abajo.
        </div>
      )}
    </div>
  );
}

// ─── DETALLE CANDIDATO ───────────────────────────────────────────────
function DetalleCandidato({ candidato, onVolver, onActualizar }) {
  const [analizando, setAnalizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [analisis, setAnalisis] = useState(candidato.claude_observaciones || "");

  const analizarConClaude = async () => {
    setAnalizando(true);
    try {
      const docs = [
        { url: candidato.url_curp,     tipo: "CURP",     esPDF: candidato.url_curp?.includes(".pdf") },
        { url: candidato.url_ine,      tipo: "INE (delantera)", esPDF: false },
        { url: candidato.url_ine_2,    tipo: "INE (trasera)",   esPDF: false },
        { url: candidato.url_licencia, tipo: "Licencia",  esPDF: candidato.url_licencia?.includes(".pdf") },
        { url: candidato.url_rfc,      tipo: "RFC",       esPDF: candidato.url_rfc?.includes(".pdf") },
      ].filter(f => f.url);

      if (docs.length === 0) { alert("No hay documentos para analizar."); setAnalizando(false); return; }

      const contenido = docs.map(d => {
        if (d.esPDF) {
          return { type: "document", source: { type: "url", url: d.url }, title: d.tipo };
        }
        return { type: "image", source: { type: "url", url: d.url } };
      });

      contenido.push({
        type: "text",
        text: `Analiza los documentos del conductor y extrae EXACTAMENTE esta información:

CURP: [número completo 18 caracteres]
RFC: [número completo]
Nombre completo: [nombre como aparece en documentos]
Número de licencia: [número]
Vigencia licencia: [fecha]
Número INE: [número]
Vigencia INE: [fecha]

Luego compara con los datos del sistema:
- Nombre sistema: ${candidato.nombre}
- CURP sistema: ${candidato.curp}
- RFC sistema: ${candidato.rfc}
- Licencia sistema: ${candidato.licencia}
- INE sistema: ${candidato.ine}

Indica si hay COINCIDENCIA o DISCREPANCIA para cada campo. Sé preciso y conciso.`
      });

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: contenido }]
        })
      });
      const data = await response.json();
      const texto = data.content?.[0]?.text || "Sin respuesta";
      setAnalisis(texto);
      await sb.from("certificaciones_mx").update({ claude_observaciones: texto }).eq("id", candidato.id);
      onActualizar({ ...candidato, claude_observaciones: texto });
    } catch (e) { alert("Error al analizar: " + e.message); }
    finally { setAnalizando(false); }
  };

  const enviarAMeli = async () => {
    if (!confirm(`¿Enviar a Meli la certificación de ${candidato.nombre}?`)) return;
    setEnviando(true);
    try {
      let valorLicencia = candidato.licencia || "";
      if (candidato.puesto === "Auxiliar") valorLicencia = "Auxiliar";
      else if (candidato.puesto === "Dispatcher") valorLicencia = "Dispatcher";
      else if (candidato.puesto === "Ayudante") valorLicencia = "Auxiliar";

      await fetch("https://bigticket2026.app.n8n.cloud/webhook/enviar-meli-form", {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidato_id: candidato.id,
          nombre: candidato.nombre,
          curp: candidato.curp_validado || candidato.curp,
          svc: candidato.svc,
          licencia: valorLicencia,
          puesto: candidato.puesto,
        })
      });

      const now = new Date().toISOString();
      await sb.from("certificaciones_mx").update({ estado: "enviado", fecha_envio_meli: now }).eq("id", candidato.id);
      onActualizar({ ...candidato, estado: "enviado", fecha_envio_meli: now });
      alert("✅ Solicitud enviada a Meli correctamente");
    } catch (e) { alert("Error al enviar: " + e.message); }
    finally { setEnviando(false); }
  };

  const estadoBadge = { pendiente: "badge-pendiente", enviado: "badge-enviado", aprobado: "badge-aprobado", rechazado: "badge-rechazado" };

  return (
    <div>
      {/* Header sticky */}
      <div style={{ background: "#fff", borderBottom: "0.5px solid #e4e7ec", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 9 }}>
        <button className="btn-back" onClick={onVolver}>← Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{candidato.nombre}</div>
          <div style={{ fontSize: 12, color: "#888" }}>{candidato.svc} · {candidato.puesto}</div>
        </div>
        <span className={`badge ${estadoBadge[candidato.estado]}`}>{candidato.estado?.toUpperCase()}</span>
      </div>

      <div className="pg-detail">
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

        {/* Documentos */}
        <div className="form-card">
          <div className="form-title">Documentos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 12 }}>
            <VisorDoc url={candidato.url_curp}     label="CURP" />
            <VisorDoc url={candidato.url_ine}      label="INE (delantera)" />
            <VisorDoc url={candidato.url_ine_2}    label="INE (trasera)" />
            <VisorDoc url={candidato.url_licencia} label="Licencia" />
            <VisorDoc url={candidato.url_rfc}      label="RFC" />
          </div>
          <button className="btn-blue" onClick={analizarConClaude} disabled={analizando} style={{ marginTop: 16, width: "100%" }}>
            {analizando ? "🔍 Analizando con Claude..." : "🤖 Analizar documentos con Claude Vision"}
          </button>
        </div>

        {/* Comparativa */}
        <ComparativaDatos candidato={candidato} analisisTexto={analisis} />

        {/* Análisis completo */}
        {analisis && (
          <div className="form-card" style={{ border: "1px solid #bae6fd" }}>
            <div className="form-title">🤖 Análisis completo Claude Vision</div>
            <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.8, whiteSpace: "pre-wrap", background: "#f8f9fa", borderRadius: 8, padding: "12px 16px" }}>{analisis}</div>
          </div>
        )}

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

          {/* Datos a enviar */}
          <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 16px", marginBottom: 16, border: "1px solid #bae6fd", fontSize: 12, color: "#555", lineHeight: 2 }}>
            <div style={{ fontWeight: 700, color: "#0369a1", marginBottom: 6 }}>Datos a enviar al formulario Meli</div>
            <div>📧 Correo: <strong>camilonaranjo.bigticket@gmail.com</strong></div>
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
            <div style={{ background: "#dcfce7", borderRadius: 10, padding: "12px", textAlign: "center", fontSize: 13, color: "#166534", fontWeight: 700 }}>
              ✅ Conductor aprobado por Mercado Libre
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

// ─── KANBAN ──────────────────────────────────────────────────────────
function KanbanBoard({ items, onCardClick }) {
  return (
    <div className="kanban-board">
      {COLUMNAS.map(col => {
        const cards = items.filter(i => i.estado === col.id);
        return (
          <div key={col.id} className="kanban-col">
            <div className="kanban-col-header" style={{ background: col.bg, border: `1px solid ${col.border}` }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: col.color }}>{col.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: col.color, background: "rgba(255,255,255,0.6)", borderRadius: 20, padding: "2px 8px" }}>{cards.length}</span>
            </div>
            {cards.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 10px", fontSize: 12, color: "#bbb" }}>Sin candidatos</div>
            )}
            {cards.map(card => (
              <div key={card.id} className="kanban-card" onClick={() => onCardClick(card)}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1a3a6b", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                    {card.nombre?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  {card.claude_observaciones && (
                    <span style={{ fontSize: 10, background: "#f0f9ff", color: "#0369a1", padding: "2px 6px", borderRadius: 10, fontWeight: 600 }}>🤖 Analizado</span>
                  )}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 2 }}>{card.nombre || "Sin nombre"}</div>
                <div style={{ fontSize: 11, color: "#888" }}>{card.svc || "—"} · {card.puesto || "—"}</div>
                <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>CURP: {card.curp?.substring(0, 10) || "—"}...</div>
                {card.fecha_envio_meli && (
                  <div style={{ fontSize: 10, color: "#888", marginTop: 4 }}>
                    Enviado: {new Date(card.fecha_envio_meli).toLocaleDateString("es-MX")}
                  </div>
                )}
              </div>
            ))}
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
  const [sincronizando, setSincronizando] = useState(false);
  const [selected, setSelected] = useState(null);
  const [vista, setVista] = useState("kanban"); // kanban | lista

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    const { data } = await sb.from("certificaciones_mx").select("*").order("created_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  };

  const sincronizarPipefy = async () => {
    setSincronizando(true);
    try {
      await fetch("https://bigticket2026.app.n8n.cloud/webhook/sync-pipefy-cert", {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipe_id: PIPE_ID, fase: "Validación MELI" })
      });
      await new Promise(r => setTimeout(r, 4000));
      await cargar();
      alert("✅ Sincronización completada");
    } catch (e) { alert("Error: " + e.message); }
    finally { setSincronizando(false); }
  };

  if (selected) return (
    <DetalleCandidato
      candidato={selected}
      onVolver={() => setSelected(null)}
      onActualizar={(updated) => {
        setItems(items.map(i => i.id === updated.id ? updated : i));
        setSelected(updated);
      }}
    />
  );

  const conteo = {
    total: items.length,
    pendiente: items.filter(i => i.estado === "pendiente").length,
    enviado: items.filter(i => i.estado === "enviado").length,
    aprobado: items.filter(i => i.estado === "aprobado").length,
    rechazado: items.filter(i => i.estado === "rechazado").length,
  };

  return (
    <div className="pg">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Certificaciones MX 🇲🇽</div>
          <div className="sec-sub">Candidatos en fase "Validación MELI" — Pipefy</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "#fff", borderRadius: 8, border: "0.5px solid #e4e7ec", overflow: "hidden" }}>
            {[["kanban", "Kanban"], ["lista", "Lista"]].map(([v, l]) => (
              <button key={v} onClick={() => setVista(v)}
                style={{ padding: "7px 14px", border: "none", cursor: "pointer", fontSize: 12, fontFamily: "'Geist',sans-serif",
                  background: vista === v ? "#1a3a6b" : "#fff", color: vista === v ? "#fff" : "#666", fontWeight: vista === v ? 600 : 400 }}>
                {l}
              </button>
            ))}
          </div>
          <button className="btn-orange" onClick={sincronizarPipefy} disabled={sincronizando}>
            {sincronizando ? "Sincronizando..." : "🔄 Sincronizar Pipefy"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 20 }}>
        {[["Total", conteo.total, "#1a3a6b"], ["Pendientes", conteo.pendiente, "#92400e"],
          ["Enviados", conteo.enviado, "#1e40af"], ["Aprobados", conteo.aprobado, "#166534"],
          ["Rechazados", conteo.rechazado, "#c0392b"]
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
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Sin candidatos</div>
          <div style={{ fontSize: 12 }}>Sincroniza desde Pipefy para cargar candidatos</div>
        </div>
      ) : vista === "kanban" ? (
        <KanbanBoard items={items} onCardClick={setSelected} />
      ) : (
        // Vista lista
        <div>
          {items.map(item => (
            <div key={item.id} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "14px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
              onClick={() => setSelected(item)}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#1a3a6b", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                {item.nombre?.charAt(0)?.toUpperCase() || "?"}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{item.nombre}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{item.svc} · {item.puesto} · {item.curp}</div>
              </div>
              <span className={`badge badge-${item.estado}`}>{item.estado?.toUpperCase()}</span>
              <span style={{ color: "#888", fontSize: 18 }}>›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── APP PRINCIPAL ───────────────────────────────────────────────────
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [tab, setTab] = useState("certificaciones");
  if (!usuario) return <><style>{css}</style><Login onLogin={setUsuario} /></>;
  return (
    <>
      <style>{css}</style>
      <div>
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              <span style={{ color: "#F47B20" }}>Big</span><span style={{ color: "#fff" }}>ticket</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#aac3e8" }}>👤 {usuario.nombre}</span>
            <button className="btn-gw" onClick={() => setUsuario(null)}>Salir</button>
          </div>
        </div>
        <div className="admin-nav">
          {MODULOS[usuario.rol]?.map(k => (
            <button key={k} className={`nav-btn ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
              {MODULOS_LABELS[k]}
            </button>
          ))}
        </div>
        {tab === "certificaciones" && <ModuloCertificaciones />}
        {tab === "configuracion" && (
          <div className="pg" style={{ maxWidth: 700 }}>
            <div className="sec-title">Configuración</div>
            <div className="sec-sub">Sistema Integrado Bigticket</div>
            <div className="form-card">
              <div className="form-title">Conexiones activas</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 2.2 }}>
                <div>✅ Supabase — tabla certificaciones_mx</div>
                <div>✅ Pipefy — Pipe {PIPE_ID} · Fase: Validación MELI</div>
                <div>✅ Google Forms — Validación Drivers MLM</div>
                <div>✅ Gmail — certificacionbigticketmx@gmail.com</div>
                <div>✅ Claude Vision — Análisis y comparativa de documentos</div>
              </div>
            </div>
            <div className="form-card">
              <div className="form-title">Usuarios</div>
              {Object.entries(USUARIOS).map(([email, u]) => (
                <div key={email} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f4f5f7" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{u.nombre}</div>
                    <div style={{ fontSize: 12, color: "#888" }}>{email}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 20, background: u.rol === "superadmin" ? "#eef2ff" : "#f0fdf4", color: u.rol === "superadmin" ? "#1a3a6b" : "#166534", fontWeight: 600 }}>
                    {u.rol}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {["wiki", "checklist", "kpis", "maestro"].includes(tab) && (
          <div className="pg">
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{MODULOS_LABELS[tab]}</div>
              <div style={{ fontSize: 13, color: "#888" }}>Módulo en desarrollo</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
