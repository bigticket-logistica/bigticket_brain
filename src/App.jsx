import { useState, useEffect, useRef } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://psvdtgjvognbmxfvqbaa.supabase.co";
const SUPABASE_KEY = "sb_publishable_RayW0wqgesNI6FYZ6i0CFQ_6YHaHELP";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const PIPEFY_TOKEN = "eyJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJQaXBlZnkiLCJpYXQiOjE3NzU1ODc5MTQsImp0aSI6ImQzNzJiMzRlLTE4YzItNDA3OC1hYjFkLTBmOTI2MGMxZjhhZSIsInN1YiI6MzA2MzEwNjQ3LCJ1c2VyIjp7ImlkIjozMDYzMTA2NDcsImVtYWlsIjoiY2FtaWxvLm5hcmFuam9AYmlndGlja2V0LmNsIn0sInVzZXJfdHlwZSI6ImF1dGhlbnRpY2F0ZWQifQ.MsaieG6W9IUYB8diNf-Q4C87WC0pIv4FMHsSpnCZ6SD_qGiK-REQvfowkcfw3LzWVWI-o64TEJrlj5FCZBe1vA";
const PIPE_ID = "306833898";

const MODULOS = {
  superadmin: ["certificaciones", "wiki", "checklist", "kpis", "maestro", "configuracion"],
  certificacion: ["certificaciones"],
};

const MODULOS_LABELS = {
  certificaciones: "Certificaciones",
  wiki: "Wiki y Procesos",
  checklist: "Checklist",
  kpis: "KPIs",
  maestro: "Maestro Operaciones",
  configuracion: "Configuración",
};
const PIPEFY_FIELDS = {
  nombres:   "e1399354-35f2-4fbc-89c1-310c3cead4b5",
  curp:      "49649781-c018-4a02-b1eb-f4c5d4fd7366",
  rfc:       "2574ac84-af17-4b16-8832-094cd8d1adc8",
  ine:       "aa7676e4-eec7-4046-81f3-6c09c99cf406",
  licencia:  "dd990b4a-ec17-4c56-a65a-25cd7a4b3e33",
  puesto:    "5e1bc2ee-0c3a-4720-89d6-3752b80d012c",
  svc:       "0cf87e4e-2daa-4fca-b109-445a5838a048",
  email:     "bfcf7df3-ade1-46ca-ac8f-1929b2251281",
  telefono:  "3b9b3be7-c33b-44b4-8b22-06054b5b26d1",
  foto_rfc:  "351d23e2-b2e9-4d32-bf5d-5b1605932929",
  foto_curp: "1d8f2610-f292-4e01-8601-19273f45e497",
  foto_lic:  "270264a6-aadd-453c-b127-4e8f72ecbc97",
  foto_ine:  "5b90543d-5918-4352-bcad-858375a9e62e",
};

// Google Form IDs
const FORM_ACTION = "https://docs.google.com/forms/d/e/1FAIpQLSfKqWuSMBNwRcp-bJpqiSU8ZAFAPCGB3qTkfiMT2jk_8PVGzw/formResponse";
const FORM_FIELDS = {
  correo:    "entry.1418110277",
  nombre:    "entry.715792240",
  curp:      "entry.1912583612",
  mlp:       "entry.1391555266",
  svc:       "entry.1422784112",
  tramo:     "entry.1927588691",
  licencia:  "entry.1418110277",
  capacidad: "entry.137537185",
};

// Usuarios del sistema
const USUARIOS = {
  "admin@bigticket.cl":         { pass: "Admin2026!", rol: "superadmin", nombre: "Super Admin" },
  "cert@bigticket.mx":          { pass: "Cert2026!", rol: "certificacion", nombre: "Equipo Certificación" },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'DM Sans',sans-serif;background:#f0f2f5;min-height:100vh;}
  .topbar{background:#1a3a6b;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
  .logo{color:#fff;font-size:16px;font-weight:700;}.logo span{color:#F47B20;}
  .btn-gw{background:transparent;color:#fff;border:0.5px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;}
  .admin-nav{display:flex;gap:6px;padding:12px 20px;background:#fff;border-bottom:0.5px solid #e4e7ec;overflow-x:auto;}
  .nav-btn{padding:7px 14px;font-size:13px;border-radius:8px;border:none;cursor:pointer;background:transparent;color:#666;font-family:'DM Sans',sans-serif;white-space:nowrap;}
  .nav-btn.active{background:#eef2ff;color:#1a3a6b;font-weight:600;}
  .pg{padding:20px;max-width:1100px;margin:0 auto;padding-bottom:40px;}
  .sec-title{font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:4px;}
  .sec-sub{font-size:13px;color:#666;margin-bottom:20px;}
  .form-card{background:#fff;border:0.5px solid #e4e7ec;border-radius:14px;padding:20px;margin-bottom:16px;}
  .form-title{font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:14px;}
  .field-row{margin-bottom:14px;}
  .field-label{font-size:12px;color:#555;margin-bottom:4px;display:block;font-weight:500;}
  input,select,textarea{width:100%;padding:9px 12px;border:0.5px solid #d0d5dd;border-radius:8px;font-size:13px;background:#fff;color:#1a1a1a;font-family:'DM Sans',sans-serif;outline:none;transition:border-color 0.15s;}
  input:focus,select:focus,textarea:focus{border-color:#1a3a6b;}
  textarea{height:80px;resize:none;}
  .two-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;}
  .three-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr);gap:12px;}
  .btn-orange{background:#F47B20;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;}
  .btn-orange:hover{background:#d96a10;}.btn-orange:disabled{background:#ccc;cursor:not-allowed;}
  .btn-blue{background:#1a3a6b;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;}
  .btn-blue:hover{background:#142d54;}.btn-blue:disabled{background:#ccc;cursor:not-allowed;}
  .btn-danger{background:transparent;color:#c0392b;border:0.5px solid #f5a7a7;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;}
  .btn-back{background:transparent;border:none;cursor:pointer;font-size:13px;color:#1a3a6b;font-weight:600;font-family:'DM Sans',sans-serif;padding:0;}
  .camp-row{background:#fff;border:0.5px solid #e4e7ec;border-radius:10px;padding:14px 16px;margin-bottom:10px;}
  .login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f0f2f5;padding:20px;}
  .login-card{background:#fff;border-radius:16px;padding:40px 32px;width:100%;max-width:400px;border:0.5px solid #e4e7ec;}
  .loading{text-align:center;padding:40px;color:#888;font-size:14px;}
  .empty{text-align:center;padding:32px;color:#888;font-size:13px;background:#fff;border-radius:12px;border:0.5px dashed #e4e7ec;}
  .badge{font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;white-space:nowrap;}
  .badge-pendiente{background:#fef3c7;color:#92400e;}
  .badge-enviado{background:#dbeafe;color:#1e40af;}
  .badge-aprobado{background:#dcfce7;color:#166534;}
  .badge-rechazado{background:#fee2e2;color:#c0392b;}
  .foto-thumb{width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid #e4e7ec;cursor:pointer;}
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px;}
  .modal-box{background:#fff;border-radius:16px;overflow:hidden;max-width:700px;width:100%;max-height:90vh;display:flex;flex-direction:column;}
  .modal-header{background:#1a3a6b;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;}
  @media(max-width:600px){.two-col,.three-col{grid-template-columns:1fr;}}
`;

// ─── LOGIN ─────────────────────────────────────────────────────────
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
          <img src="https://psvdtgjvognbmxfvqbaa.supabase.co/storage/v1/object/public/assets/LOGO%20BT.jpeg"
            alt="BigTicket" style={{ height: 64, objectFit: "contain", marginBottom: 12 }} />
          <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>Sistema Integrado Bigticket</div>
        </div>
        {error && <div style={{ background: "#fee2e2", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#c0392b", marginBottom: 14, textAlign: "center" }}>{error}</div>}
        <div className="field-row">
          <span className="field-label">Correo electrónico</span>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@bigticket.cl" type="email" onKeyDown={e => e.key === "Enter" && login()} />
        </div>
        <div className="field-row">
          <span className="field-label">Contraseña</span>
          <div style={{ position: "relative" }}>
            <input value={pass} onChange={e => setPass(e.target.value)} type={show ? "text" : "password"} style={{ paddingRight: 40 }} onKeyDown={e => e.key === "Enter" && login()} />
            <button onClick={() => setShow(!show)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#888", fontSize: 16 }}>
              {show ? "🙈" : "👁"}
            </button>
          </div>
        </div>
        <button className="btn-blue" onClick={login} style={{ width: "100%", marginTop: 8 }}>Ingresar</button>
        <div style={{ fontSize: 11, color: "#aaa", textAlign: "center", marginTop: 16 }}>BigTicket Logística — Sistema interno</div>
      </div>
    </div>
  );
}

// ─── DETALLE CANDIDATO ──────────────────────────────────────────────
function DetalleCandidato({ candidato, onVolver, onActualizar }) {
  const [fotoAmpliada, setFotoAmpliada] = useState(null);
  const [analizando, setAnalizando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [analisis, setAnalisis] = useState(candidato.claude_observaciones || "");

  const estadoColor = {
    pendiente: "#92400e", enviado: "#1e40af",
    aprobado: "#166534", rechazado: "#c0392b"
  };
  const estadoBg = {
    pendiente: "#fef3c7", enviado: "#dbeafe",
    aprobado: "#dcfce7", rechazado: "#fee2e2"
  };

  const analizarConClaude = async () => {
    setAnalizando(true);
    try {
      const fotos = [
        { url: candidato.url_curp, tipo: "CURP" },
        { url: candidato.url_ine, tipo: "INE" },
        { url: candidato.url_licencia, tipo: "Licencia de conducir" },
        { url: candidato.url_rfc, tipo: "RFC" },
      ].filter(f => f.url);

      if (fotos.length === 0) { alert("No hay fotos para analizar."); setAnalizando(false); return; }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              ...fotos.map(f => ({
                type: "image",
                source: { type: "url", url: f.url }
              })),
              {
                type: "text",
                text: `Analiza los documentos del conductor y extrae la siguiente información de cada uno:
- CURP: número completo de 18 caracteres
- INE: nombre completo, CURP del INE, fecha de vencimiento
- Licencia: número, categoría, fecha de vencimiento
- RFC: número completo

Verifica que los datos coincidan entre documentos. Reporta cualquier inconsistencia.
Responde en formato estructurado y conciso. Datos del sistema: Nombre=${candidato.nombre}, CURP=${candidato.curp}, RFC=${candidato.rfc}`
              }
            ]
          }]
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
      // Determinar valor del campo licencia según puesto
      let valorLicencia = candidato.licencia || "";
      if (candidato.puesto === "Auxiliar") valorLicencia = "Auxiliar";
      else if (candidato.puesto === "Dispatcher") valorLicencia = "Dispatcher";

      // Construir form data
      const formData = new URLSearchParams();
      formData.append(FORM_FIELDS.correo, "camilonaranjo.bigticket@gmail.com");
      formData.append(FORM_FIELDS.nombre, candidato.nombre || "");
      formData.append(FORM_FIELDS.curp, candidato.curp_validado || candidato.curp || "");
      formData.append(FORM_FIELDS.mlp, "Big Ticket");
      formData.append(FORM_FIELDS.svc, candidato.svc || "");
      formData.append("entry.1927588691", "Last mile");
      formData.append(FORM_FIELDS.licencia, valorLicencia);
      formData.append("entry.137537185", "MLP");
      formData.append("emailReceipt", "true");
      formData.append("fvv", "1");
      formData.append("pageHistory", "0");

      // Enviar via N8N para evitar CORS
      await fetch("https://bigticket2026.app.n8n.cloud/webhook/enviar-meli-form", {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidato_id: candidato.id,
          nombre: candidato.nombre,
          curp: candidato.curp_validado || candidato.curp,
          svc: candidato.svc,
          licencia: valorLicencia,
          puesto: candidato.puesto,
          form_data: Object.fromEntries(formData),
        })
      });

      // Actualizar estado en Supabase
      const now = new Date().toISOString();
      await sb.from("certificaciones_mx").update({
        estado: "enviado",
        fecha_envio_meli: now,
      }).eq("id", candidato.id);

      onActualizar({ ...candidato, estado: "enviado", fecha_envio_meli: now });
      alert("✅ Solicitud enviada a Meli correctamente");
    } catch (e) { alert("Error al enviar: " + e.message); }
    finally { setEnviando(false); }
  };

  const Foto = ({ url, label }) => {
    if (!url) return (
      <div style={{ background: "#f8f9fa", borderRadius: 8, padding: "20px", textAlign: "center", border: "1px dashed #d0d5dd" }}>
        <div style={{ fontSize: 24 }}>📎</div>
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{label}</div>
        <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>Sin foto</div>
      </div>
    );
    return (
      <div style={{ cursor: "pointer" }} onClick={() => setFotoAmpliada({ url, label })}>
        <img src={url} alt={label} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #e4e7ec" }} />
        <div style={{ fontSize: 11, color: "#555", textAlign: "center", marginTop: 4, fontWeight: 500 }}>{label} 🔍</div>
      </div>
    );
  };

  return (
    <div>
      {/* Modal foto ampliada */}
      {fotoAmpliada && (
        <div className="modal-overlay" onClick={() => setFotoAmpliada(null)}>
          <div style={{ maxWidth: 600, width: "100%", background: "#fff", borderRadius: 16, overflow: "hidden" }}>
            <div className="modal-header">
              <span style={{ color: "#fff", fontWeight: 700 }}>{fotoAmpliada.label}</span>
              <button onClick={() => setFotoAmpliada(null)} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <img src={fotoAmpliada.url} alt={fotoAmpliada.label} style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", background: "#000" }} />
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "0.5px solid #e4e7ec", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 9 }}>
        <button className="btn-back" onClick={onVolver}>← Volver</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a1a" }}>{candidato.nombre}</div>
          <div style={{ fontSize: 12, color: "#888" }}>{candidato.svc} · {candidato.puesto} · CURP: {candidato.curp}</div>
        </div>
        <span className={`badge badge-${candidato.estado}`}>{candidato.estado?.toUpperCase()}</span>
      </div>

      <div className="pg">
        {/* Resumen datos */}
        <div className="form-card">
          <div className="form-title">📋 Datos del candidato</div>
          <div className="three-col">
            {[["Nombre", candidato.nombre], ["CURP", candidato.curp], ["RFC", candidato.rfc],
              ["INE", candidato.ine], ["Licencia", candidato.licencia], ["Puesto", candidato.puesto],
              ["SVC", candidato.svc], ["Email", candidato.email], ["Teléfono", candidato.telefono]
            ].map(([l, v]) => (
              <div key={l} style={{ padding: "8px 0", borderBottom: "1px solid #f4f5f7" }}>
                <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 13, color: "#1a1a1a", fontWeight: 600 }}>{v || "—"}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Fotos documentos */}
        <div className="form-card">
          <div className="form-title">📎 Documentos fotográficos</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 12 }}>
            <Foto url={candidato.url_curp} label="CURP" />
            <Foto url={candidato.url_ine} label="INE" />
            <Foto url={candidato.url_licencia} label="Licencia" />
            <Foto url={candidato.url_rfc} label="RFC" />
          </div>
          <button className="btn-blue" onClick={analizarConClaude} disabled={analizando} style={{ marginTop: 16, width: "100%" }}>
            {analizando ? "🔍 Analizando documentos con IA..." : "🤖 Analizar documentos con Claude"}
          </button>
        </div>

        {/* Análisis Claude */}
        {analisis && (
          <div className="form-card" style={{ border: "1px solid #bae6fd" }}>
            <div className="form-title">🤖 Análisis Claude Vision</div>
            <div style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{analisis}</div>
          </div>
        )}

        {/* Estado y acciones */}
        <div className="form-card" style={{ border: `1px solid ${estadoBg[candidato.estado]}` }}>
          <div className="form-title">📤 Certificación Mercado Libre</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[
              ["Estado", <span className={`badge badge-${candidato.estado}`}>{candidato.estado?.toUpperCase()}</span>],
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

          {/* Datos que se enviarán a Meli */}
          <div style={{ background: "#f0f9ff", borderRadius: 10, padding: "12px 16px", marginBottom: 16, border: "1px solid #bae6fd" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", marginBottom: 8 }}>📋 Datos a enviar al formulario Meli</div>
            <div style={{ fontSize: 12, color: "#555", lineHeight: 2 }}>
              <div>📧 Correo: <strong>camilonaranjo.bigticket@gmail.com</strong></div>
              <div>👤 Nombre: <strong>{candidato.nombre}</strong></div>
              <div>🪪 CURP: <strong>{candidato.curp_validado || candidato.curp}</strong></div>
              <div>🏢 MLP: <strong>Big Ticket</strong></div>
              <div>📍 SVC: <strong>{candidato.svc}</strong></div>
              <div>🚚 Tramo: <strong>Last mile</strong></div>
              <div>📄 Licencia/Puesto: <strong>{candidato.puesto === "Auxiliar" ? "Auxiliar" : candidato.puesto === "Dispatcher" ? "Dispatcher" : candidato.licencia}</strong></div>
              <div>🏷️ Capacidad: <strong>MLP</strong></div>
            </div>
          </div>

          {candidato.estado === "pendiente" && (
            <button className="btn-orange" onClick={enviarAMeli} disabled={enviando} style={{ width: "100%" }}>
              {enviando ? "Enviando a Meli..." : "📤 Enviar certificación a Mercado Libre"}
            </button>
          )}
          {candidato.estado === "enviado" && (
            <div style={{ background: "#dbeafe", borderRadius: 10, padding: "12px 16px", textAlign: "center", fontSize: 13, color: "#1e40af", fontWeight: 600 }}>
              ⏳ Esperando respuesta de Meli (hasta 72 hrs)
            </div>
          )}
          {candidato.estado === "aprobado" && (
            <div style={{ background: "#dcfce7", borderRadius: 10, padding: "12px 16px", textAlign: "center", fontSize: 13, color: "#166534", fontWeight: 700 }}>
              ✅ Conductor aprobado por Mercado Libre
            </div>
          )}
          {candidato.estado === "rechazado" && (
            <div style={{ background: "#fee2e2", borderRadius: 10, padding: "12px 16px", textAlign: "center", fontSize: 13, color: "#c0392b", fontWeight: 700 }}>
              ❌ Certificación rechazada — {candidato.respuesta_meli}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── LISTA CERTIFICACIONES ───────────────────────────────────────────
function ListaCertificaciones() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  const [busqueda, setBusqueda] = useState("");

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
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipe_id: PIPE_ID, fase: "Validación MELI" })
      });
      await new Promise(r => setTimeout(r, 3000));
      await cargar();
      alert("✅ Sincronización completada");
    } catch (e) { alert("Error: " + e.message); }
    finally { setSincronizando(false); }
  };

  const itemsFiltrados = items.filter(i => {
    const matchFiltro = filtro === "todos" || i.estado === filtro;
    const matchBusqueda = !busqueda || i.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
      i.curp?.toLowerCase().includes(busqueda.toLowerCase()) || i.svc?.toLowerCase().includes(busqueda.toLowerCase());
    return matchFiltro && matchBusqueda;
  });

  const conteo = {
    todos: items.length,
    pendiente: items.filter(i => i.estado === "pendiente").length,
    enviado: items.filter(i => i.estado === "enviado").length,
    aprobado: items.filter(i => i.estado === "aprobado").length,
    rechazado: items.filter(i => i.estado === "rechazado").length,
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

  return (
    <div className="pg">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Certificaciones MX 🇲🇽</div>
          <div className="sec-sub">Candidatos en fase "Validación MELI" — Pipefy</div>
        </div>
        <button className="btn-orange" onClick={sincronizarPipefy} disabled={sincronizando}>
          {sincronizando ? "Sincronizando..." : "🔄 Sincronizar desde Pipefy"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10, marginBottom: 20 }}>
        {[["Total", conteo.todos, "#1a3a6b"], ["Pendientes", conteo.pendiente, "#92400e"],
          ["Enviados", conteo.enviado, "#1e40af"], ["Aprobados", conteo.aprobado, "#166534"],
          ["Rechazados", conteo.rechazado, "#c0392b"]
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", border: "0.5px solid #e4e7ec", borderRadius: 10, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["todos", "pendiente", "enviado", "aprobado", "rechazado"].map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid #e4e7ec", fontSize: 12, cursor: "pointer",
              fontFamily: "'DM Sans',sans-serif", fontWeight: filtro === f ? 700 : 400,
              background: filtro === f ? "#1a3a6b" : "#fff", color: filtro === f ? "#fff" : "#555" }}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({conteo[f] || items.length})
          </button>
        ))}
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar por nombre, CURP o SVC..."
          style={{ flex: 1, minWidth: 200, padding: "6px 12px", borderRadius: 20, border: "1px solid #e4e7ec", fontSize: 12 }} />
      </div>

      {/* Lista */}
      {loading ? <div className="loading">Cargando...</div> :
        itemsFiltrados.length === 0 ? (
          <div className="empty">
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>No hay candidatos aún</div>
            <div style={{ fontSize: 12 }}>Sincroniza desde Pipefy para cargar los candidatos en fase "Validación MELI"</div>
          </div>
        ) : itemsFiltrados.map(item => (
          <div key={item.id} className="camp-row" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
            onClick={() => setSelected(item)}>
            {/* Avatar */}
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#1a3a6b", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
              {item.nombre?.charAt(0)?.toUpperCase() || "?"}
            </div>
            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{item.nombre || "Sin nombre"}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                {item.svc || "—"} · {item.puesto || "—"} · CURP: {item.curp || "—"}
              </div>
              {item.fecha_envio_meli && (
                <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                  Enviado: {new Date(item.fecha_envio_meli).toLocaleDateString("es-CL")}
                </div>
              )}
            </div>
            {/* Fotos mini */}
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {[item.url_curp, item.url_ine, item.url_licencia].filter(Boolean).map((url, i) => (
                <img key={i} src={url} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", border: "1px solid #e4e7ec" }} />
              ))}
            </div>
            {/* Badge estado */}
            <span className={`badge badge-${item.estado}`} style={{ flexShrink: 0 }}>
              {item.estado?.toUpperCase()}
            </span>
            <span style={{ color: "#888", fontSize: 18 }}>›</span>
          </div>
        ))
      }
    </div>
  );
}

// ─── APP PRINCIPAL ───────────────────────────────────────────────────
export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [tab, setTab] = useState("certificaciones");

  const logout = () => setUsuario(null);

  if (!usuario) return <><style>{css}</style><Login onLogin={setUsuario} /></>;

  return (
    <>
      <style>{css}</style>
      <div>
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              <span style={{ color: "#F47B20" }}>Big</span>
              <span style={{ color: "#fff" }}>ticket</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "#aac3e8" }}>👤 {usuario.nombre}</span>
            <button className="btn-gw" onClick={logout}>Salir</button>
          </div>
        </div>

        <div className="admin-nav">
          {MODULOS[usuario.rol]?.map(k => (
            <button key={k} className={`nav-btn ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>
              {MODULOS_LABELS[k]}
            </button>
          ))}
        </div>

        {tab === "certificaciones" && <ListaCertificaciones />}
        {tab === "configuracion" && (
          <div className="pg">
            <div className="sec-title">Configuración</div>
            <div className="sec-sub">Gestión del sistema de certificaciones</div>
            <div className="form-card">
              <div className="form-title">Conexiones activas</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 2 }}>
                <div>✅ Supabase — tabla certificaciones_mx</div>
                <div>✅ Pipefy — Pipe {PIPE_ID} · Fase: Validación MELI</div>
                <div>✅ Google Forms — Validación Drivers MLM</div>
                <div>✅ Gmail — certificacionbigticketmx@gmail.com</div>
                <div>✅ Claude Vision — Análisis de documentos</div>
              </div>
            </div>
            <div className="form-card">
              <div className="form-title">Usuarios del sistema</div>
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
        {["wiki","checklist","kpis","maestro"].includes(tab) && (
          <div className="pg">
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🚧</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>{MODULOS_LABELS[tab]}</div>
              <div style={{ fontSize: 13, color: "#888" }}>Módulo en desarrollo — próximamente disponible</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
