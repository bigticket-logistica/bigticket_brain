import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import ModuloMaestro from "./maestro";
import { fechaHoyOperativa, fechaOperativaOffset, pct, Input, KpiCardMaestro, BadgeEstadoMaestro } from "./shared";
// PNR ahora vive en la Torre; su pestaña la reemplaza Alertas Portal.
import ModuloAlertasPortal from "./AlertasPortal";
import ModuloReferidos from "./Referidos";
import ModuloCertificaciones from "./Certificaciones";
import ModuloEmpresas from "./Empresas";
import ModuloAuditoriaMeli from "./AuditoriaMeli";
import { sb, BIGGY_IMG } from "./shared";
import { ShellBrain } from "./shared/shell";
import { useAccesosCL, CampanaAvisosCL } from "./cl/AccesosAvisos";
import { registrarSubtabs, useSubtab } from "./shared/subtabs";
import ModuloPoolMeliMX from "./Pool";
import { descargarExcelMeli, descargarExcelMultihoja } from "./shared";
import ModuloPagosMadre from "./Pagos";
import ModuloContabilidad from "./Contabilidad";
import Salud from "./Salud";
import ModuloCertificacionesCL from "./cl/CertificacionesCL";
import ModuloMaestroCL from "./cl/Maestro";
import ModuloGpsSegurosCL from "./cl/GpsSeguros";
import ModuloPnrCL from "./cl/PNR";
import ModuloAceptacionCL from "./cl/Aceptacion";
import CuidadoActivoCL from "./cl/CuidadoActivo";
import ModuloMantenedorCL from "./cl/Mantenedor";
const PIPE_ID = "306833898";

// Devuelve el periodo "operativo" actual (mes en México) en formato YYYY-MM
function periodoHoyOperativo() {
  return fechaHoyOperativa().slice(0, 7);
}

// Formatea una hora ISO en formato CL · MX (ej: "09:00 CL · 07:00 MX")
function formatHoraDual(isoTimestamp) {
  if (!isoTimestamp) return "—";
  try {
    const d = new Date(isoTimestamp);
    const cl = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
    const mx = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
    return `${cl} CL · ${mx} MX`;
  } catch { return "—"; }
}

// Solo hora Chile (formato corto)
function formatHoraCL(isoTimestamp) {
  if (!isoTimestamp) return "—";
  try {
    return new Date(isoTimestamp).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
  } catch { return "—"; }
}

// Solo hora México (formato corto)
function formatHoraMX(isoTimestamp) {
  if (!isoTimestamp) return "—";
  try {
    return new Date(isoTimestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
  } catch { return "—"; }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS GLOBALES PARA DESCARGA EXCEL (reutilizables en cualquier pestaña)
// ═══════════════════════════════════════════════════════════════════════════

// Genera un archivo Excel con múltiples hojas
// hojas = [{ nombre: "Resumen", datos: [["col1","col2"], ["a","b"]] }, ...]

// Convierte array de objetos a array 2D para Excel (con headers)
function objetosATabla(objetos, columnas) {
  // columnas: [{ key: "campo", label: "Etiqueta" }] o solo array de strings
  if (!columnas) {
    if (objetos.length === 0) return [[]];
    columnas = Object.keys(objetos[0]).map(k => ({ key: k, label: k }));
  }
  if (typeof columnas[0] === "string") {
    columnas = columnas.map(k => ({ key: k, label: k }));
  }
  const headers = columnas.map(c => c.label);
  const rows = objetos.map(obj => columnas.map(c => {
    let v = obj[c.key];
    if (v == null) return "";
    if (typeof v === "boolean") return v ? "Sí" : "No";
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  }));
  return [headers, ...rows];
}

// Botón de descarga estandarizado
function BotonDescargarExcel({ onClick, disabled, label = "Descargar Excel" }) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn-blue"
      style={{
        padding: "7px 14px", fontSize: 11, fontWeight: 600,
        background: "#002E5D", color: "#fff", border: "none",
        borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, fontFamily: "'Open Sans', sans-serif",
        whiteSpace: "nowrap",
      }}>
      📥 {label}
    </button>
  );
}

// Operaciones (países) disponibles en el Brain. Se irán sumando más adelante.
const PAISES_DISPONIBLES = ["Chile", "México"];

// Config visual del selector de operación (código de bandera + acento).
const PAIS_SELECT_CFG = {
  "Chile":  { code: "cl", label: "Chile",  acento: "#0033A0" },
  "México": { code: "mx", label: "México", acento: "#006341" },
};

// Módulos visibles por operación y rol. Al abrir Chile todavía no hay módulos
// propios (se irán agregando aquí); México conserva todo lo ya existente.
const MODULOS_POR_PAIS = {
  "México": {
    superadmin: ["pool_meli_mx", "pagos", "contabilidad", "maestro", "certificaciones", "empresas", "alertas_portal", "referidos", "auditoria_meli", "salud", "configuracion"],
    certificacion: ["certificaciones", "empresas"],
    certificacion_full: ["certificaciones", "empresas"],  // Certificaciones MX + CL (ver Chile abajo)
    certificacion_mant: ["certificaciones", "empresas"],  // Certificaciones MX + CL + Mantenciones CL
    prefacturas: ["pagos"],
  },
  "Chile": {
    superadmin: ["certificaciones_cl", "mantenciones_cl", "maestro_cl", "gps_seguros_cl", "pnr_cl", "aceptacion_cl", "mantenedor_cl"],
    certificacion: [],
    certificacion_full: ["certificaciones_cl"],
    certificacion_mant: ["certificaciones_cl", "mantenciones_cl", "gps_seguros_cl"],
    prefacturas: [],
  },
};
const modulosVisibles = (pais, rol) => (MODULOS_POR_PAIS[pais] && MODULOS_POR_PAIS[pais][rol]) || [];
const MODULOS_LABELS = {
  brain: "Brain Central",
  pool_meli_mx: "Indicadores Operacionales MX",
  certificaciones: "Certificaciones",
  empresas: "Empresas",
  certificaciones_cl: "Certificaciones",
  mantenciones_cl: "Cuidado de Activo",
  maestro_cl: "Maestro Operaciones",
  gps_seguros_cl: "GPS y Seguros",
  pnr_cl: "Posventa",
  aceptacion_cl: "Aceptación de Rutas",
  mantenedor_cl: "Mantenedor",
  maestro: "Maestro Operaciones",
  mantenciones: "Mantenciones",
  alertas_portal: "Alertas Portal",
  referidos: "Referidos",
  auditoria_meli: "Auditoría MELI",
  pagos: "Administración",
  contabilidad: "Contabilidad",
  salud: "Salud del sistema",
  configuracion: "Configuración",
};
const USUARIOS = {
  // Opcional por usuario: paises: ["Chile"] o ["México"] para restringir qué operación ve.
  // Si se omite, el usuario ve todas las operaciones disponibles (PAISES_DISPONIBLES).
  "esteban.dussaut@bigticket.cl": { pass: "esteban.2026", rol: "superadmin", nombre: "Super Admin" },
  "cert@bigticket.mx":  { pass: "Cert2026!", rol: "certificacion", nombre: "Equipo Certificación" },
  "adriana.giummarra@bigticket.cl": { pass: "adriana.2026", rol: "superadmin", nombre: "Adriana Giummarra" },
  "nicole.vargas@bigticket.cl":     { pass: "nicole.2026",  rol: "superadmin", nombre: "Nicole Vargas" },
  "yaritza.medina@bigticket.cl":     { pass: "yaritza.2026",  rol: "superadmin", nombre: "Yaritza Medina" },
  "arturo.pina@bigticket.mx":     { pass: "arturo.2026", rol: "superadmin", nombre: "Arturo Piña" },
  "roberto.rayon@bigticket.mx":     { pass: "roberto.2026", rol: "superadmin", nombre: "Roberto Rayón" },
  "alejandra.degollada@bigticket.cl":     { pass: "alejandra.2026", rol: "superadmin", nombre: "Alejandra Degollada" },
  "eduardo.stine@bigticket.cl":     { pass: "eduardo.2026", rol: "superadmin", nombre: "Eduardo Stine" },
  "randy.becerra@bigticket.cl":     { pass: "randy.2026", rol: "superadmin", nombre: "Randy Becerra" },
  "danny.calas@bigticket.cl":       { pass: "danny.2026",   rol: "prefacturas", nombre: "Danny Calas" },
  "roberto.sanmartin@bigticket.cl":       { pass: "robertosn.2026",   rol: "prefacturas", nombre: "Roberto San Martin" },
  "antonio.mariangel@bigticket.cl":       { pass: "antonio.2026",  rol: "superadmin", nombre: "Antonio Mariangel" },
  "camila.valenzuela@bigticket.cl":       { pass: "camila.2026",   rol: "superadmin", nombre: "Camila Valenzuela" },
  "galiz.martinez@bigticket.cl":         { pass: "Galiz.2026!",  rol: "superadmin", nombre: "Galiz Martínez" },
  "maycol.olavarria@bigticket.cl":       { pass: "Maycol.2026!", rol: "superadmin", nombre: "Maycol Olavarría" },
  "katherine.ortega@bigticket.cl":       { pass: "katherine.2026!", rol: "superadmin", nombre: "Katherine" },
  "gabriela.aguirre@bigticket.cl":       { pass: "gabriela.2026!", rol: "superadmin", nombre: "Gabriela Aguirre =)" },
  
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Open+Sans:wght@400;500;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Open Sans',sans-serif;background:#f0f2f5;min-height:100vh;}
  .topbar{background:#002E5D;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}
  .btn-gw{background:transparent;color:#fff;border:0.5px solid rgba(255,255,255,0.3);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:'Open Sans',sans-serif;}
  .admin-nav{display:flex;gap:6px;padding:12px 20px;background:#fff;border-bottom:0.5px solid #e4e7ec;overflow-x:auto;}
  .nav-btn{padding:7px 14px;font-size:13px;border-radius:8px;border:none;cursor:pointer;background:transparent;color:#666;font-family:'Open Sans',sans-serif;white-space:nowrap;}
  .nav-btn.active{background:#eef2ff;color:#002E5D;font-weight:600;}
  .pg{padding:20px;max-width:1400px;margin:0 auto;padding-bottom:40px;}
  .pg-detail{padding:20px;max-width:960px;margin:0 auto;padding-bottom:40px;}
  .sec-title{font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:4px;}
  .sec-sub{font-size:13px;color:#666;margin-bottom:20px;}
  .form-card{background:#fff;border:0.5px solid #e4e7ec;border-radius:14px;padding:20px;margin-bottom:16px;}
  .form-title{font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:14px;}
  .field-row{margin-bottom:14px;}
  .field-label{font-size:12px;color:#555;margin-bottom:4px;display:block;font-weight:500;}
  input,select,textarea{width:100%;padding:9px 12px;border:0.5px solid #d0d5dd;border-radius:8px;font-size:13px;background:#fff;color:#1a1a1a;font-family:'Open Sans',sans-serif;outline:none;}
  textarea{height:80px;resize:none;}
  .two-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;}
  .three-col{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
  .btn-orange{background:#FF6600;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Open Sans',sans-serif;}
  .btn-orange:disabled{background:#ccc;cursor:not-allowed;}
  .btn-blue{background:#002E5D;color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Open Sans',sans-serif;}
  .btn-blue:disabled{background:#ccc;cursor:not-allowed;}
  .btn-back{background:transparent;border:none;cursor:pointer;font-size:13px;color:#002E5D;font-weight:600;font-family:'Open Sans',sans-serif;padding:0;}
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
  @keyframes biggypulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .biggy-bubble{animation:fadeIn 0.4s ease;}
  .biggy-typing span{display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF6600;margin:0 2px;animation:biggypulse 0.9s infinite;}
  .biggy-typing span:nth-child(2){animation-delay:0.2s;}
  .biggy-typing span:nth-child(3){animation-delay:0.4s;}
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
          <img src={BIGGY_IMG} alt="Biggy" style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", marginBottom: 12 }} />
          <div style={{ fontSize: 26, fontWeight: 800 }}>
            <span style={{ color: "#002E5D" }}>Big</span><span style={{ color: "#FF6600" }}>ticket</span>
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

// ─── APP PRINCIPAL ───────────────────────────────────────────────────

// ─── CONFIGURACIÓN SUPABASE ───────────────────────────────────────────────────
const LF_SUPABASE_URL = "https://psvdtgjvognbmxfvqbaa.supabase.co";
const LF_SUPABASE_KEY = "sb_publishable_RayW0wqgesNI6FYZ6i0CFQ_6YHaHELP";

const lfSupabase = createClient(LF_SUPABASE_URL, LF_SUPABASE_KEY);

// wrapper compatible con el código existente
const lfSb = {
  from: (table) => ({
    select: async (cols="*", opts={}) => {
      let q = lfSupabase.from(table).select(cols);
      if (opts.order) { const parts=opts.order.split("."); q=q.order(parts[0],{ascending:parts[1]==="asc"}); }
      if (opts.filter) { const m=opts.filter.match(/^(\w+)=eq\.(.+)$/); if(m) q=q.eq(m[1],m[2]); }
      const {data,error}=await q; if(error) throw error; return data||[];
    },
    update: async (data, filter) => {
      const m=filter.match(/^(\w+)=eq\.(.+)$/);
      const {data:r,error}=await lfSupabase.from(table).update(data).eq(m[1],m[2]).select();
      if(error) throw error; return r;
    },
    insert: async (data) => {
      const {data:r,error}=await lfSupabase.from(table).insert(data).select();
      if(error) throw error; return r;
    },
    delete: async (filter) => {
      const m=filter.match(/^(\w+)=eq\.(.+)$/);
      const {error}=await lfSupabase.from(table).delete().eq(m[1],m[2]);
      if(error) throw error; return true;
    },
  }),
};

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const ETAPAS_PIPELINE = ["Nuevo Lead","Propuesta Enviada","Propuesta Aceptada","Propuesta Rechazada","Entrevistas y Validaciones"];
const ETAPAS_CIERRE   = ["Postulante Aprobado","Postulante No Calificado"];
const ETAPAS_TODAS    = [...ETAPAS_PIPELINE, ...ETAPAS_CIERRE];
const ETAPAS_BASE_DATOS = ["Base Datos Leads"]; // leads tibios y fríos

const ETAPA_CFG = {
  "Nuevo Lead":          { color:"#3B82F6", icon:"🎯" },
  "Propuesta Enviada":   { color:"#F97316", icon:"📄" },
  "Propuesta Aceptada":  { color:"#10B981", icon:"✅" },
  "Propuesta Rechazada": { color:"#EF4444", icon:"❌" },
  "Entrevistas y Validaciones": { color:"#8B5CF6", icon:"🎤" },
  "Postulante Aprobado":  { color:"#059669", icon:"🏆" },
  "Postulante No Calificado": { color:"#DC2626", icon:"🚫" },
  "Base Datos Leads":    { color:"#8B5CF6", icon:"🗄️" },
};

const CANAL_CFG = {
  whatsapp:   { color:"#25D366", icon:"💬", label:"WhatsApp" },
  email:      { color:"#EA4335", icon:"📧", label:"Email" },
  facebook:   { color:"#1877F2", icon:"📘", label:"Facebook" },
  instagram:  { color:"#E1306C", icon:"📸", label:"Instagram" },
  linkedin:   { color:"#0A66C2", icon:"💼", label:"LinkedIn" },
  referido:   { color:"#F97316", icon:"🤝", label:"Referido" },
  formulario: { color:"#8B5CF6", icon:"📝", label:"Formulario" },
};

const CANALES_PLANTILLA = ["WhatsApp","Email","Facebook","Instagram","Todos"];

const getCanalCfg = (canal) => {
  if (!canal) return { color:"#888888", icon:"•", label:"Desconocido" };
  return CANAL_CFG[canal.toLowerCase()] || { color:"#888888", icon:"•", label:canal };
};

const getScoreColor = (s, clasificacion) => {
  if (clasificacion) {
    const c = clasificacion.toLowerCase();
    if (c.includes("caliente")) return "#10B981";
    if (c.includes("tibio") || c.includes("candidato")) return "#F59E0B";
    return "#EF4444";
  }
  // fallback sin clasificacion: usa porcentaje sobre 100
  return s>=70?"#10B981":s>=40?"#F59E0B":"#EF4444";
};

const formatFecha = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const esHoy = d.toDateString() === now.toDateString();
  const ayer = new Date(now); ayer.setDate(now.getDate()-1);
  const esAyer = d.toDateString() === ayer.toDateString();
  const hora = d.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"});
  if (esHoy)  return `Hoy ${hora}`;
  if (esAyer) return `Ayer ${hora}`;
  return `${d.toLocaleDateString("es-CL",{day:"2-digit",month:"short"})} ${hora}`;
};

const diasEntre = (a,b) => (!a||!b)?null:Math.round(Math.abs(new Date(b)-new Date(a))/86400000);

// ─── COMPONENTES BASE ─────────────────────────────────────────────────────────
const ScoreDot = ({ score, clasificacion }) => {
  const c=getScoreColor(score||0, clasificacion);
  const pct = clasificacion?.toLowerCase().includes("caliente") ? 100
    : clasificacion?.toLowerCase().includes("tibio") || clasificacion?.toLowerCase().includes("candidato") ? 65
    : clasificacion ? 25
    : Math.min(score||0, 100);
  const s = pct;
  return (
    <svg width={36} height={36} viewBox="0 0 36 36" style={{flexShrink:0}}>
      <circle cx={18} cy={18} r={15} fill="none" stroke="#f0f2f5" strokeWidth={3}/>
      <circle cx={18} cy={18} r={15} fill="none" stroke={c} strokeWidth={3}
        strokeDasharray={`${s*0.942} 94.2`} strokeLinecap="round"
        transform="rotate(-90 18 18)" style={{transition:"stroke-dasharray .6s ease"}}/>
      <text x={18} y={22} textAnchor="middle" fontSize={9} fill={c} fontWeight={700}>{s}</text>
    </svg>
  );
};

const Tag = ({ label, color }) => (
  <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:20,
    background:color+"22",color,border:`1px solid ${color}44`,letterSpacing:.5}}>{label}</span>
);

const PAIS_CFG = {
  "Chile":  { bandera:"https://flagcdn.com/w40/cl.png", color:"#c0392b" },
  "México": { bandera:"https://flagcdn.com/w40/mx.png", color:"#27ae60" },
};

const CanalTag = ({ canal }) => { const cfg=getCanalCfg(canal); return <Tag label={`${cfg.icon} ${cfg.label}`} color={cfg.color}/>; };

const PaisFlag = ({ pais }) => {
  if(!pais) return null;
  const cfg=PAIS_CFG[pais];
  if(!cfg) return <span style={{fontSize:11,color:"#888"}}>{pais}</span>;
  return <img src={cfg.bandera} alt={pais} title={pais} style={{width:20,height:14,objectFit:"cover",borderRadius:2,display:"inline-block"}}/>;
};

const Spinner = () => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",padding:60}}>
    <div style={{width:32,height:32,border:"3px solid #e4e7ec",borderTopColor:"#002E5D",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
  </div>
);

const Modal = ({ title, onClose, children }) => (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
    <div style={{background:"#ffffff",border:"1px solid #e4e7ec",borderRadius:14,padding:28,width:560,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{fontSize:16,fontWeight:900,color:"#1a1a1a",fontFamily:"'Outfit',sans-serif"}}>{title}</div>
        <button onClick={onClose} style={{background:"#eef2ff",border:"1px solid #dbeafe",color:"#666666",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      </div>
      {children}
    </div>
  </div>
);

const Btn = ({ children, onClick, color="#3B82F6", outline=false, small=false }) => (
  <button onClick={onClick} style={{
    background:outline?"transparent":color, color:outline?color:"white",
    border:`1px solid ${color}`, borderRadius:8,
    padding:small?"5px 12px":"9px 18px", fontSize:small?11:12,
    cursor:"pointer", fontWeight:700, fontFamily:"'Outfit',sans-serif", transition:"all .2s"
  }}>{children}</button>
);

const Textarea = ({ value, onChange, placeholder, rows=4 }) => (
  <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
    style={{width:"100%",background:"#f0f2f5",color:"#1a1a1a",border:"1px solid #e4e7ec",
      borderRadius:8,padding:"9px 12px",fontSize:12,resize:"vertical"}}/>
);

const Select = ({ value, onChange, children, style={} }) => (
  <select value={value} onChange={onChange}
    style={{width:"100%",background:"#f0f2f5",color:"#1a1a1a",border:"1px solid #e4e7ec",
      borderRadius:8,padding:"9px 12px",fontSize:12,cursor:"pointer",...style}}>
    {children}
  </select>
);

const Label = ({ children }) => (
  <div style={{fontSize:9,color:"#555555",fontWeight:800,letterSpacing:1,
    textTransform:"uppercase",marginBottom:6}}>{children}</div>
);

// ── Vista de jornadas y liquidación ──────────────────────────────────────────
const VistaJornadasMaestro = ({ periodo }) => {
  const [jornadas, setJornadas] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filtro, setFiltro]     = useState("todas");
  const [editando, setEditando] = useState(null);
  const [formMonto, setFormMonto] = useState({ monto_base: 0, bonos: 0, descuentos: 0, notas: "" });

  useEffect(() => { cargarJornadas(); }, [periodo]);

  const cargarJornadas = async () => {
    setLoading(true);
    let q = sb.from("jornadas")
      .select("*, drivers(nombre, rut, tipo_vehiculo)")
      .order("fecha", { ascending: false })
      .limit(500);
    if (periodo) q = q.eq("periodo_pago", periodo);
    const { data } = await q;
    setJornadas(data || []);
    setLoading(false);
  };

  const cambiarEstado = async (id, estado, extra = {}) => {
    await sb.from("jornadas").update({
      estado,
      ...extra,
      ...(estado === "pagado" ? { pagado: true, pagado_at: new Date().toISOString() } : {}),
    }).eq("id", id);
    cargarJornadas();
  };

  const guardarMonto = async () => {
    await sb.from("jornadas").update({
      monto_base:  parseFloat(formMonto.monto_base) || 0,
      bonos:       parseFloat(formMonto.bonos) || 0,
      descuentos:  parseFloat(formMonto.descuentos) || 0,
      notas:       formMonto.notas,
      estado:      "revisado",
    }).eq("id", editando.id);
    setEditando(null);
    cargarJornadas();
  };

  const filtradas = filtro === "todas" ? jornadas
    : jornadas.filter(j => j.estado === filtro);

  const totalMonto    = filtradas.reduce((s, j) => s + (j.total || 0), 0);
  const totalAprobado = jornadas.filter(j => j.estado === "aprobado").length;
  const totalPagado   = jornadas.filter(j => j.estado === "pagado").length;

  if (loading) return (
    <div style={{ textAlign: "center", padding: 48, color: "#888" }}>
      Cargando jornadas...
    </div>
  );

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <KpiCardMaestro label="Jornadas" valor={fmtNumMaestro(filtradas.length)} />
        <KpiCardMaestro label="Total período"
          valor={`$${fmtNumMaestro(Math.round(totalMonto))}`} color="#16a34a" />
        <KpiCardMaestro label="Aprobadas" valor={fmtNumMaestro(totalAprobado)} color="#ca8a04" />
        <KpiCardMaestro label="Pagadas" valor={fmtNumMaestro(totalPagado)} color="#16a34a" />
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {["todas","borrador","revisado","aprobado","pagado"].map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            style={{ padding: "5px 14px", borderRadius: 20,
              border: `1px solid ${filtro === f ? "#3B82F6" : "#e4e7ec"}`,
              background: filtro === f ? "#3B82F6" : "#fff",
              color: filtro === f ? "#fff" : "#555",
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              textTransform: "capitalize" }}>
            {f === "todas" ? "Todas" : f}
          </button>
        ))}
      </div>

      {/* Tabla con scroll horizontal */}
      <div style={{ overflowX: "auto", borderRadius: 10,
        border: "1px solid #e4e7ec", background: "#fff",
        WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e4e7ec" }}>
              {["Driver","Patente","Fecha","Viajes","Cargados","Entregados",
                "Eficiencia","Monto base","Bonos","Desc.","Total","Estado","Acciones"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left",
                  fontWeight: 800, fontSize: 10, textTransform: "uppercase",
                  letterSpacing: 0.5, color: "#555", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr><td colSpan={13} style={{ padding: 40, textAlign: "center",
                color: "#888" }}>Sin jornadas para este período</td></tr>
            )}
            {filtradas.map((j, i) => (
              <tr key={j.id} style={{ borderBottom: "1px solid #f1f5f9",
                background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                <td style={{ padding: "9px 12px", fontWeight: 700 }}>
                  {j.drivers?.nombre || "—"}</td>
                <td style={{ padding: "9px 12px", fontFamily: "monospace",
                  fontSize: 11, color: "#555" }}>{j.drivers?.rut || "—"}</td>
                <td style={{ padding: "9px 12px", whiteSpace: "nowrap", fontSize: 11 }}>
                  {fmtFechaMaestro(j.fecha)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  {j.total_viajes}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  {fmtNumMaestro(j.total_paquetes_asignados)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right",
                  color: "#16a34a", fontWeight: 700 }}>
                  {fmtNumMaestro(j.total_paquetes_entregados)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right",
                  fontWeight: 800,
                  color: colorEfMaestro(j.eficiencia_pct != null ? j.eficiencia_pct / 100 : null) }}>
                  {j.eficiencia_pct != null ? j.eficiencia_pct.toFixed(1) + "%" : "—"}</td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  ${fmtNumMaestro(j.monto_base)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right",
                  color: "#16a34a" }}>+${fmtNumMaestro(j.bonos)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right",
                  color: "#dc2626" }}>-${fmtNumMaestro(j.descuentos)}</td>
                <td style={{ padding: "9px 12px", textAlign: "right",
                  fontWeight: 800, fontSize: 13 }}>
                  ${fmtNumMaestro(Math.round(j.total || 0))}</td>
                <td style={{ padding: "9px 12px" }}>
                  <BadgeEstadoMaestro estado={j.estado} /></td>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
                    {(j.estado === "borrador" || j.estado === "revisado") && (
                      <button onClick={() => {
                        setEditando(j);
                        setFormMonto({
                          monto_base: j.monto_base || 0,
                          bonos: j.bonos || 0,
                          descuentos: j.descuentos || 0,
                          notas: j.notas || "",
                        });
                      }} style={{ padding: "4px 10px", borderRadius: 6,
                        border: "1px solid #6366f1", background: "transparent",
                        color: "#6366f1", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Editar
                      </button>
                    )}
                    {j.estado === "revisado" && (
                      <button onClick={() => cambiarEstado(j.id, "aprobado",
                        { aprobado_por: "supervisor" })}
                        style={{ padding: "4px 10px", borderRadius: 6,
                          border: "1px solid #ca8a04", background: "transparent",
                          color: "#ca8a04", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Aprobar
                      </button>
                    )}
                    {j.estado === "aprobado" && (
                      <button onClick={() => cambiarEstado(j.id, "pagado")}
                        style={{ padding: "4px 10px", borderRadius: 6,
                          border: "1px solid #16a34a", background: "#16a34a",
                          color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        Pagar
                      </button>
                    )}
                    {j.estado === "pagado" && (
                      <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700 }}>
                        ✓ Pagado
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal editar montos */}
      {editando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24,
            width: 380, maxWidth: "90vw" }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
              Liquidación — {editando.drivers?.nombre}</div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 20 }}>
              {fmtFechaMaestro(editando.fecha)} · {editando.total_viajes} viajes</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <Label>Monto base ($)</Label>
                <Input type="number" value={formMonto.monto_base}
                  onChange={e => setFormMonto({...formMonto, monto_base: e.target.value})}
                  placeholder="0" />
              </div>
              <div>
                <Label>Bonos ($)</Label>
                <Input type="number" value={formMonto.bonos}
                  onChange={e => setFormMonto({...formMonto, bonos: e.target.value})}
                  placeholder="0" />
              </div>
              <div>
                <Label>Descuentos ($)</Label>
                <Input type="number" value={formMonto.descuentos}
                  onChange={e => setFormMonto({...formMonto, descuentos: e.target.value})}
                  placeholder="0" />
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 8, padding: 12,
                fontSize: 14, fontWeight: 800, textAlign: "right" }}>
                Total: ${fmtNumMaestro(
                  Math.round(
                    (parseFloat(formMonto.monto_base) || 0) +
                    (parseFloat(formMonto.bonos) || 0) -
                    (parseFloat(formMonto.descuentos) || 0)
                  )
                )}
              </div>
              <div>
                <Label>Notas</Label>
                <Textarea value={formMonto.notas} rows={2}
                  onChange={e => setFormMonto({...formMonto, notas: e.target.value})}
                  placeholder="Observaciones de la jornada..." />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20,
              justifyContent: "flex-end" }}>
              <Btn outline color="#475569" onClick={() => setEditando(null)}>
                Cancelar
              </Btn>
              <Btn onClick={guardarMonto}>Guardar</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Vista de drivers ──────────────────────────────────────────────────────────
const VistaDriversMaestro = () => {
  const [drivers, setDrivers]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modalAdd, setModalAdd] = useState(false);
  const [form, setForm] = useState({
    nombre: "", rut: "", telefono: "", email: "",
    tipo_vehiculo: "furgon", estado: "activo",
  });

  useEffect(() => { cargarDrivers(); }, []);

  const cargarDrivers = async () => {
    setLoading(true);
    const { data } = await sb.from("drivers").select("*").order("nombre");
    setDrivers(data || []);
    setLoading(false);
  };

  const guardarDriver = async () => {
    if (!form.nombre.trim()) return;
    await sb.from("drivers").insert(form);
    setModalAdd(false);
    setForm({ nombre: "", rut: "", telefono: "", email: "",
      tipo_vehiculo: "furgon", estado: "activo" });
    cargarDrivers();
  };

  const toggleEstado = async (d) => {
    await sb.from("drivers").update({
      estado: d.estado === "activo" ? "inactivo" : "activo"
    }).eq("id", d.id);
    cargarDrivers();
  };

  if (loading) return (
    <div style={{ textAlign: "center", padding: 48, color: "#888" }}>
      Cargando drivers...
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between",
        alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "#888" }}>
          {drivers.filter(d => d.estado === "activo").length} activos
          · {drivers.length} total
        </div>
        <Btn onClick={() => setModalAdd(true)} small>+ Nuevo driver</Btn>
      </div>

      <div style={{ display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {drivers.map(d => {
          const iniciales = (d.nombre || "").split(" ")
            .map(n => n[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={d.id} style={{ background: "#fff", border: "1px solid #e4e7ec",
              borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%",
                  background: d.estado === "activo" ? "#dbeafe" : "#f3f4f6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: 13,
                  color: d.estado === "activo" ? "#1e40af" : "#9ca3af" }}>
                  {iniciales}
                </div>
                <span style={{
                  background: d.estado === "activo" ? "#dcfce7" : "#f3f4f6",
                  color: d.estado === "activo" ? "#166534" : "#6b7280",
                  borderRadius: 20, padding: "2px 10px", fontSize: 10, fontWeight: 700 }}>
                  {d.estado}
                </span>
              </div>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 3 }}>
                {d.nombre}</div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 2,
                fontFamily: "monospace" }}>{d.rut || "Sin patente"}</div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>
                {d.tipo_vehiculo || "—"}{d.telefono ? ` · ${d.telefono}` : ""}</div>
              <button onClick={() => toggleEstado(d)}
                style={{ fontSize: 10, color: d.estado === "activo" ? "#dc2626" : "#16a34a",
                  background: "none", border: "none", cursor: "pointer",
                  padding: 0, fontWeight: 700 }}>
                {d.estado === "activo" ? "Desactivar" : "Activar"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Modal nuevo driver */}
      {modalAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24,
            width: 400, maxWidth: "90vw" }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 20 }}>
              Nuevo driver</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div><Label>Nombre completo *</Label>
                <Input value={form.nombre}
                  onChange={e => setForm({...form, nombre: e.target.value})}
                  placeholder="Arturo Romero" /></div>
              <div><Label>Patente / RUT</Label>
                <Input value={form.rut}
                  onChange={e => setForm({...form, rut: e.target.value})}
                  placeholder="P35AXV" /></div>
              <div><Label>Teléfono</Label>
                <Input value={form.telefono}
                  onChange={e => setForm({...form, telefono: e.target.value})}
                  placeholder="+52 55 1234 5678" /></div>
              <div><Label>Email</Label>
                <Input type="email" value={form.email}
                  onChange={e => setForm({...form, email: e.target.value})}
                  placeholder="driver@email.com" /></div>
              <div><Label>Tipo vehículo</Label>
                <Select value={form.tipo_vehiculo}
                  onChange={e => setForm({...form, tipo_vehiculo: e.target.value})}>
                  <option value="moto">Moto</option>
                  <option value="furgon">Furgón</option>
                  <option value="camion">Camión</option>
                  <option value="van">Van</option>
                </Select></div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20,
              justifyContent: "flex-end" }}>
              <Btn outline color="#475569" onClick={() => setModalAdd(false)}>
                Cancelar
              </Btn>
              <Btn onClick={guardarDriver}>Guardar</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── MÓDULO DRIVERS MX ─────────────────────────────────────────
function ModuloDriversMX() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroSC, setFiltroSC] = useState("todos");
  const [tabActiva, setTabActiva] = useState("lista");
  const [driverSel, setDriverSel] = useState(null);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({
    nombre:"", apellido_paterno:"", apellido_materno:"",
    email:"", telefono:"", curp:"", rfc:"", nss:"",
    tipo_vehiculo:"SMALL VAN", zonificacion:"L1",
    service_center:"", tms_driver_id:"", placa:"",
    estado:"pendiente", fecha_inicio:"",
  });

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    const { data } = await sb.from("drivers_mx").select("*").order("created_at", { ascending: false });
    setDrivers(data || []);
    setLoading(false);
  };

  const guardar = async () => {
    if (!form.nombre || !form.email) return alert("Nombre y email son obligatorios");
    setGuardando(true);
    const payload = { ...form, updated_at: new Date().toISOString() };
    let error;
    if (driverSel) {
      ({ error } = await sb.from("drivers_mx").update(payload).eq("id", driverSel.id));
    } else {
      ({ error } = await sb.from("drivers_mx").insert(payload));
    }
    setGuardando(false);
    if (error) return alert("Error: " + error.message);
    setModalNuevo(false);
    setDriverSel(null);
    setForm({ nombre:"", apellido_paterno:"", apellido_materno:"", email:"", telefono:"", curp:"", rfc:"", nss:"", tipo_vehiculo:"SMALL VAN", zonificacion:"L1", service_center:"", tms_driver_id:"", placa:"", estado:"pendiente", fecha_inicio:"" });
    cargar();
  };

  const validarDocs = async (id, aprobado) => {
    await sb.from("drivers_mx").update({
      docs_validados: aprobado,
      docs_validado_at: new Date().toISOString(),
      estado: aprobado ? "activo" : "pendiente",
    }).eq("id", id);
    cargar();
  };

  const estadoColor = {
    pendiente:  { bg: "#fef3c7", color: "#92400e" },
    activo:     { bg: "#dcfce7", color: "#166534" },
    inactivo:   { bg: "#f1f5f9", color: "#475569" },
    suspendido: { bg: "#fee2e2", color: "#c0392b" },
  };

  const filtrados = drivers.filter(d => {
    const matchEstado = filtroEstado === "todos" || d.estado === filtroEstado;
    const matchSC = filtroSC === "todos" || d.service_center === filtroSC;
    const matchBusqueda = !busqueda ||
      `${d.nombre} ${d.apellido_paterno} ${d.email} ${d.curp || ""} ${d.placa || ""}`.toLowerCase().includes(busqueda.toLowerCase());
    return matchEstado && matchSC && matchBusqueda;
  });

  const scsUnicas = [...new Set(drivers.map(d => d.service_center).filter(Boolean))];

  const abrirEditar = (d) => {
    setDriverSel(d);
    setForm({ ...d });
    setModalNuevo(true);
  };

  const abrirNuevo = () => {
    setDriverSel(null);
    setForm({ nombre:"", apellido_paterno:"", apellido_materno:"", email:"", telefono:"", curp:"", rfc:"", nss:"", tipo_vehiculo:"SMALL VAN", zonificacion:"L1", service_center:"", tms_driver_id:"", placa:"", estado:"pendiente", fecha_inicio:"" });
    setModalNuevo(true);
  };

  // KPIs
  const total = drivers.length;
  const activos = drivers.filter(d => d.estado === "activo").length;
  const pendientes = drivers.filter(d => d.estado === "pendiente").length;
  const docsValidos = drivers.filter(d => d.docs_validados).length;

  if (loading) return (
    <div className="pg" style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🚗</div>
        <div style={{ fontSize:14, color:"#888" }}>Cargando drivers...</div>
      </div>
    </div>
  );

  return (
    <div className="pg">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:"#002E5D" }}>🚗 Drivers México</div>
          <div style={{ fontSize:12, color:"#888", marginTop:2 }}>Gestión de choferes y documentación</div>
        </div>
        <button onClick={abrirNuevo}
          style={{ background:"#002E5D", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
          + Nuevo Driver
        </button>
      </div>

      {/* KPIs */}
      <div className="three-col" style={{ gridTemplateColumns:"repeat(4,1fr)", marginBottom:20 }}>
        {[
          { label:"Total Drivers", val:total, icon:"👥", color:"#002E5D" },
          { label:"Activos", val:activos, icon:"✅", color:"#166534" },
          { label:"Pendientes", val:pendientes, icon:"⏳", color:"#92400e" },
          { label:"Docs Validados", val:docsValidos, icon:"📋", color:"#1d4ed8" },
        ].map((k, i) => (
          <div key={i} className="form-card" style={{ textAlign:"center", padding:"14px 10px" }}>
            <div style={{ fontSize:28 }}>{k.icon}</div>
            <div style={{ fontSize:28, fontWeight:800, color:k.color }}>{k.val}</div>
            <div style={{ fontSize:11, color:"#888", fontWeight:600, textTransform:"uppercase", letterSpacing:1 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, borderBottom:"2px solid #e4e7ec", marginBottom:16 }}>
        {[{id:"lista",label:"📋 Lista"},{id:"docs",label:"📄 Documentación Pendiente"}].map(t => (
          <button key={t.id} onClick={() => setTabActiva(t.id)}
            style={{ padding:"10px 20px", background:"none", border:"none",
              borderBottom:tabActiva===t.id?"2px solid #3B82F6":"2px solid transparent",
              color:tabActiva===t.id?"#3B82F6":"#555",
              fontSize:12, fontWeight:800, cursor:"pointer", marginBottom:-2, fontFamily:"'Outfit', sans-serif" }}>
            {t.label}
            {t.id === "docs" && pendientes > 0 && (
              <span style={{ background:"#c0392b", color:"#fff", borderRadius:20, fontSize:10, fontWeight:700, padding:"1px 7px", marginLeft:6 }}>{pendientes}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Lista */}
      {tabActiva === "lista" && (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
            <input placeholder="🔍 Buscar nombre, email, CURP, placa..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              style={{ fontSize:12, padding:"6px 12px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif", minWidth:260 }} />
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
              style={{ fontSize:12, padding:"6px 10px", borderRadius:8, border:"1px solid #e4e7ec" }}>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
              <option value="suspendido">Suspendido</option>
            </select>
            <select value={filtroSC} onChange={e => setFiltroSC(e.target.value)}
              style={{ fontSize:12, padding:"6px 10px", borderRadius:8, border:"1px solid #e4e7ec" }}>
              <option value="todos">Todos los SC</option>
              {scsUnicas.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ fontSize:12, color:"#888" }}>{filtrados.length} drivers</span>
          </div>

          <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", overflow:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8f9fa" }}>
                  {["Nombre","Email","Vehículo","Zona","SC","Placa","Estado","Docs","Acciones"].map(h => (
                    <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:700, color:"#555", borderBottom:"1px solid #e4e7ec", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding:"30px", textAlign:"center", color:"#888" }}>Sin drivers con los filtros aplicados</td></tr>
                ) : filtrados.map((d, i) => {
                  const est = estadoColor[d.estado] || { bg:"#f1f5f9", color:"#475569" };
                  return (
                    <tr key={d.id} style={{ borderBottom:"1px solid #f4f5f7" }}>
                      <td style={{ padding:"9px 12px", fontWeight:600, color:"#002E5D" }}>
                        {d.nombre} {d.apellido_paterno}
                      </td>
                      <td style={{ padding:"9px 12px", color:"#555" }}>{d.email}</td>
                      <td style={{ padding:"9px 12px", color:"#555" }}>{d.tipo_vehiculo || "—"}</td>
                      <td style={{ padding:"9px 12px", color:"#555" }}>{d.zonificacion || "—"}</td>
                      <td style={{ padding:"9px 12px", color:"#555" }}>{d.service_center || "—"}</td>
                      <td style={{ padding:"9px 12px", color:"#555" }}>{d.placa || "—"}</td>
                      <td style={{ padding:"9px 12px" }}>
                        <span style={{ ...est, padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>{d.estado}</span>
                      </td>
                      <td style={{ padding:"9px 12px" }}>
                        {d.docs_validados
                          ? <span style={{ background:"#dcfce7", color:"#166534", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>✅ OK</span>
                          : <span style={{ background:"#fef3c7", color:"#92400e", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>⏳ Pendiente</span>
                        }
                      </td>
                      <td style={{ padding:"9px 12px" }}>
                        <button onClick={() => abrirEditar(d)}
                          style={{ background:"#002E5D", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab Documentación Pendiente */}
      {tabActiva === "docs" && (
        <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", overflow:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#f8f9fa" }}>
                {["Driver","Email","SC","Docs subidos","Estado","Validar"].map(h => (
                  <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontWeight:700, color:"#555", borderBottom:"1px solid #e4e7ec" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.filter(d => !d.docs_validados).length === 0 ? (
                <tr><td colSpan={6} style={{ padding:"30px", textAlign:"center", color:"#888" }}>✅ Todos los drivers tienen documentación validada</td></tr>
              ) : drivers.filter(d => !d.docs_validados).map((d, i) => {
                const docsSubidos = [d.doc_licencia_url, d.doc_no_antecedentes_url, d.doc_historial_url, d.doc_permiso_url, d.doc_ine_url].filter(Boolean).length;
                return (
                  <tr key={d.id} style={{ borderBottom:"1px solid #f4f5f7" }}>
                    <td style={{ padding:"9px 12px", fontWeight:600, color:"#002E5D" }}>{d.nombre} {d.apellido_paterno}</td>
                    <td style={{ padding:"9px 12px", color:"#555" }}>{d.email}</td>
                    <td style={{ padding:"9px 12px", color:"#555" }}>{d.service_center || "—"}</td>
                    <td style={{ padding:"9px 12px" }}>
                      <span style={{ background:"#dbeafe", color:"#1e40af", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>{docsSubidos}/5 docs</span>
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <span style={{ background:"#fef3c7", color:"#92400e", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>⏳ Pendiente</span>
                    </td>
                    <td style={{ padding:"9px 12px", display:"flex", gap:6 }}>
                      <button onClick={() => validarDocs(d.id, true)}
                        style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                        ✅ Aprobar
                      </button>
                      <button onClick={() => validarDocs(d.id, false)}
                        style={{ background:"#c0392b", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                        ❌ Rechazar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Nuevo/Editar Driver */}
      {modalNuevo && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:600, maxHeight:"90vh", overflowY:"auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontSize:16, fontWeight:800, color:"#002E5D" }}>{driverSel ? "✏️ Editar Driver" : "➕ Nuevo Driver"}</div>
              <button onClick={() => setModalNuevo(false)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#888" }}>✕</button>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              {[
                { k:"nombre", label:"Nombre *" },
                { k:"apellido_paterno", label:"Apellido Paterno *" },
                { k:"apellido_materno", label:"Apellido Materno" },
                { k:"email", label:"Email *", type:"email" },
                { k:"telefono", label:"Teléfono" },
                { k:"curp", label:"CURP" },
                { k:"rfc", label:"RFC" },
                { k:"nss", label:"NSS (IMSS)" },
                { k:"placa", label:"Placa Vehículo" },
                { k:"tms_driver_id", label:"ID en TMS" },
                { k:"service_center", label:"Service Center" },
                { k:"fecha_inicio", label:"Fecha Inicio", type:"date" },
              ].map(({ k, label, type }) => (
                <div key={k}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:4 }}>{label}</div>
                  <input type={type || "text"} value={form[k] || ""} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                    style={{ width:"100%", fontSize:12, padding:"7px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif", boxSizing:"border-box" }} />
                </div>
              ))}

              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:4 }}>Tipo Vehículo</div>
                <select value={form.tipo_vehiculo || ""} onChange={e => setForm(f => ({ ...f, tipo_vehiculo: e.target.value }))}
                  style={{ width:"100%", fontSize:12, padding:"7px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif" }}>
                  <option value="SMALL VAN">SMALL VAN</option>
                  <option value="LARGE VAN">LARGE VAN</option>
                  <option value="CAR">CAR</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:4 }}>Zonificación</div>
                <select value={form.zonificacion || ""} onChange={e => setForm(f => ({ ...f, zonificacion: e.target.value }))}
                  style={{ width:"100%", fontSize:12, padding:"7px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif" }}>
                  <option value="L1">L1</option>
                  <option value="L2">L2</option>
                  <option value="L3">L3</option>
                  <option value="L4">L4</option>
                </select>
              </div>

              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:4 }}>Estado</div>
                <select value={form.estado || "pendiente"} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}
                  style={{ width:"100%", fontSize:12, padding:"7px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif" }}>
                  <option value="pendiente">Pendiente</option>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                  <option value="suspendido">Suspendido</option>
                </select>
              </div>
            </div>

            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button onClick={() => setModalNuevo(false)}
                style={{ background:"#f1f5f9", color:"#555", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                Cancelar
              </button>
              <button onClick={guardar} disabled={guardando}
                style={{ background:"#002E5D", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                {guardando ? "Guardando..." : driverSel ? "Actualizar" : "Crear Driver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MÓDULO CONFIGURACIÓN DE PAGOS ──────────────────────────────
function ModuloConfigPagos() {
  const [matriz, setMatriz] = useState([]);
  const [matrizNS, setMatrizNS] = useState([]);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [tabActiva, setTabActiva] = useState("matriz");
  const [editando, setEditando] = useState(null);
  const [valEdit, setValEdit] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [formNuevo, setFormNuevo] = useState({ tipo_vehiculo:"SMALL VAN", zonificacion:"L1", tramo_km:"", km_min:"", km_max:"", tarifa_mxn:"" });
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroZona, setFiltroZona] = useState("todos");

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    const [{ data: m }, { data: ns }, { data: c }] = await Promise.all([
      sb.from("matriz_precios").select("*").order("zonificacion").order("tipo_vehiculo").order("km_min"),
      sb.from("matriz_ns").select("*").order("ns_min", { ascending: false }),
      sb.from("config_operacional").select("*"),
    ]);
    setMatriz(m || []);
    setMatrizNS(ns || []);
    const cfg = {};
    (c || []).forEach(r => { cfg[r.clave] = r; });
    setConfig(cfg);
    setLoading(false);
  };

  const guardarTarifa = async (id, nuevaTarifa) => {
    setGuardando(true);
    await sb.from("matriz_precios").update({
      tarifa_mxn: parseFloat(nuevaTarifa),
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    setEditando(null);
    setGuardando(false);
    cargar();
  };

  const guardarNS = async (id, pct) => {
    await sb.from("matriz_ns").update({ porcentaje: parseFloat(pct), updated_at: new Date().toISOString() }).eq("id", id);
    setEditando(null);
    cargar();
  };

  const guardarConfig = async (clave, valor) => {
    await sb.from("config_operacional").update({ valor, updated_at: new Date().toISOString() }).eq("clave", clave);
    setEditando(null);
    cargar();
  };

  const agregarFila = async () => {
    if (!formNuevo.tramo_km || !formNuevo.tarifa_mxn || !formNuevo.km_min) return alert("Completa todos los campos obligatorios");
    setGuardando(true);
    const { error } = await sb.from("matriz_precios").insert({
      ...formNuevo,
      km_min: parseInt(formNuevo.km_min),
      km_max: formNuevo.km_max ? parseInt(formNuevo.km_max) : null,
      tarifa_mxn: parseFloat(formNuevo.tarifa_mxn),
    });
    setGuardando(false);
    if (error) return alert("Error: " + error.message);
    setModalNuevo(false);
    setFormNuevo({ tipo_vehiculo:"SMALL VAN", zonificacion:"L1", tramo_km:"", km_min:"", km_max:"", tarifa_mxn:"" });
    cargar();
  };

  const toggleActivo = async (id, activo) => {
    await sb.from("matriz_precios").update({ activo: !activo }).eq("id", id);
    cargar();
  };

  const nsColor = { premio:"#dcfce7", neutro:"#f1f5f9", multa:"#fee2e2" };
  const nsTextColor = { premio:"#166534", neutro:"#475569", multa:"#c0392b" };

  const matrizFiltrada = matriz.filter(r => {
    const matchTipo = filtroTipo === "todos" || r.tipo_vehiculo === filtroTipo;
    const matchZona = filtroZona === "todos" || r.zonificacion === filtroZona;
    return matchTipo && matchZona;
  });

  // Agrupar por zona para vista de tabla
  const zonas = ["L1","L2","L3","L4"];
  const tipos = ["LARGE VAN","SMALL VAN","CAR"];
  const tramos = ["0-100","101-150","151-200","201-250","251+"];

  if (loading) return (
    <div className="pg" style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"60vh" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>💰</div>
        <div style={{ fontSize:14, color:"#888" }}>Cargando configuración...</div>
      </div>
    </div>
  );

  return (
    <div className="pg">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:"#002E5D" }}>💰 Configuración de Pagos</div>
          <div style={{ fontSize:12, color:"#888", marginTop:2 }}>Matriz de tarifas, premios/penalizaciones y parámetros operacionales</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:0, borderBottom:"2px solid #e4e7ec", marginBottom:20 }}>
        {[
          { id:"matriz", label:"📊 Matriz de Tarifas" },
          { id:"ns", label:"🏆 Premios / Penalizaciones" },
          { id:"config", label:"⚙️ Parámetros Generales" },
        ].map(t => (
          <button key={t.id} onClick={() => setTabActiva(t.id)}
            style={{ padding:"10px 20px", background:"none", border:"none",
              borderBottom:tabActiva===t.id?"2px solid #FF6600":"2px solid transparent",
              color:tabActiva===t.id?"#FF6600":"#555",
              fontSize:12, fontWeight:800, cursor:"pointer", marginBottom:-2, fontFamily:"'Outfit', sans-serif" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Matriz de Tarifas ── */}
      {tabActiva === "matriz" && (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", gap:8 }}>
              <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
                style={{ fontSize:12, padding:"6px 10px", borderRadius:8, border:"1px solid #e4e7ec" }}>
                <option value="todos">Todos los vehículos</option>
                {tipos.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={filtroZona} onChange={e => setFiltroZona(e.target.value)}
                style={{ fontSize:12, padding:"6px 10px", borderRadius:8, border:"1px solid #e4e7ec" }}>
                <option value="todos">Todas las zonas</option>
                {zonas.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <span style={{ fontSize:12, color:"#888", alignSelf:"center" }}>{matrizFiltrada.length} tarifas</span>
            </div>
            <button onClick={() => setModalNuevo(true)}
              style={{ background:"#FF6600", color:"#fff", border:"none", borderRadius:8, padding:"7px 16px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
              + Agregar Tarifa
            </button>
          </div>

          <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", overflow:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#002E5D" }}>
                  {["Vehículo","Zona","Tramo km","Tarifa MXN","Estado","Acción"].map(h => (
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:"#fff", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrizFiltrada.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom:"1px solid #f4f5f7", background: i % 2 === 0 ? "#fff" : "#f8f9fa", opacity: r.activo ? 1 : 0.5 }}>
                    <td style={{ padding:"9px 14px", fontWeight:600, color:"#002E5D" }}>{r.tipo_vehiculo}</td>
                    <td style={{ padding:"9px 14px" }}>
                      <span style={{ background:"#dbeafe", color:"#1e40af", padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>{r.zonificacion}</span>
                    </td>
                    <td style={{ padding:"9px 14px", color:"#555" }}>{r.tramo_km} km</td>
                    <td style={{ padding:"9px 14px" }}>
                      {editando === r.id ? (
                        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                          <span style={{ color:"#888", fontSize:11 }}>$</span>
                          <input type="number" value={valEdit} onChange={e => setValEdit(e.target.value)}
                            style={{ width:90, fontSize:12, padding:"4px 8px", borderRadius:6, border:"1px solid #FF6600", fontFamily:"'Outfit', sans-serif" }}
                            autoFocus onKeyDown={e => { if (e.key === "Enter") guardarTarifa(r.id, valEdit); if (e.key === "Escape") setEditando(null); }} />
                          <button onClick={() => guardarTarifa(r.id, valEdit)}
                            style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer" }}>✓</button>
                          <button onClick={() => setEditando(null)}
                            style={{ background:"#e4e7ec", color:"#555", border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer" }}>✕</button>
                        </div>
                      ) : (
                        <span style={{ fontSize:14, fontWeight:700, color:"#002E5D" }}>
                          ${Number(r.tarifa_mxn).toLocaleString("es-MX")} MXN
                        </span>
                      )}
                    </td>
                    <td style={{ padding:"9px 14px" }}>
                      <span style={{ background: r.activo ? "#dcfce7":"#fee2e2", color: r.activo ? "#166534":"#c0392b", padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>
                        {r.activo ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                    <td style={{ padding:"9px 14px", display:"flex", gap:6 }}>
                      <button onClick={() => { setEditando(r.id); setValEdit(r.tarifa_mxn); }}
                        style={{ background:"#002E5D", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                        ✏️ Editar
                      </button>
                      <button onClick={() => toggleActivo(r.id, r.activo)}
                        style={{ background: r.activo ? "#fee2e2":"#dcfce7", color: r.activo ? "#c0392b":"#166534", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                        {r.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop:12, fontSize:11, color:"#888" }}>
            💡 Haz click en <strong>✏️ Editar</strong> para modificar una tarifa. El cambio se refleja inmediatamente en los cálculos de pago.
          </div>
        </div>
      )}

      {/* ── Tab Premios/Penalizaciones NS ── */}
      {tabActiva === "ns" && (
        <div>
          <div style={{ marginBottom:16, fontSize:13, color:"#555" }}>
            El pago diario se ajusta automáticamente según el Nivel de Servicio (NS) del chofer.
          </div>
          <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", overflow:"hidden", marginBottom:20 }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:"#002E5D" }}>
                  {["Categoría","Rango NS","Tipo","Ajuste %","Acción"].map(h => (
                    <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontWeight:700, color:"#fff" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrizNS.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom:"1px solid #f4f5f7", background: i % 2 === 0 ? "#fff" : "#f8f9fa" }}>
                    <td style={{ padding:"12px 16px" }}>
                      <span style={{ background: nsColor[r.tipo], color: nsTextColor[r.tipo], padding:"4px 14px", borderRadius:20, fontSize:12, fontWeight:700 }}>
                        {r.label}
                      </span>
                    </td>
                    <td style={{ padding:"12px 16px", color:"#555", fontWeight:600 }}>
                      {r.ns_max ? `${r.ns_min}% – ${r.ns_max}%` : `< ${r.ns_min}%`}
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      <span style={{ color: nsTextColor[r.tipo], fontWeight:700, textTransform:"capitalize" }}>{r.tipo}</span>
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      {editando === `ns-${r.id}` ? (
                        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                          <input type="number" value={valEdit} onChange={e => setValEdit(e.target.value)}
                            style={{ width:70, fontSize:12, padding:"4px 8px", borderRadius:6, border:"1px solid #FF6600", fontFamily:"'Outfit', sans-serif" }}
                            autoFocus onKeyDown={e => { if (e.key === "Enter") guardarNS(r.id, valEdit); if (e.key === "Escape") setEditando(null); }} />
                          <span style={{ fontSize:12, color:"#888" }}>%</span>
                          <button onClick={() => guardarNS(r.id, valEdit)}
                            style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer" }}>✓</button>
                          <button onClick={() => setEditando(null)}
                            style={{ background:"#e4e7ec", color:"#555", border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer" }}>✕</button>
                        </div>
                      ) : (
                        <span style={{ fontSize:16, fontWeight:800, color: nsTextColor[r.tipo] }}>
                          {r.porcentaje > 0 ? "+" : ""}{r.porcentaje}%
                        </span>
                      )}
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      <button onClick={() => { setEditando(`ns-${r.id}`); setValEdit(r.porcentaje); }}
                        style={{ background:"#002E5D", color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                        ✏️ Editar %
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", padding:20 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#002E5D", marginBottom:12 }}>📖 Ejemplo de cálculo</div>
            <div style={{ fontSize:12, color:"#555", lineHeight:1.8 }}>
              <div>• Tarifa base del día: <strong>$1,920 MXN</strong></div>
              <div>• NS del chofer: <strong>99.8%</strong> → Categoría <strong>Excelente</strong> → Premio <strong>+5%</strong></div>
              <div>• Pago final: $1,920 × 1.05 = <strong style={{ color:"#166534" }}>$2,016 MXN</strong></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab Parámetros Generales ── */}
      {tabActiva === "config" && (
        <div style={{ maxWidth:500 }}>
          <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", overflow:"hidden" }}>
            <div style={{ background:"#002E5D", padding:"12px 18px" }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#fff" }}>⚙️ Parámetros Operacionales</div>
            </div>
            {Object.values(config).map((c, i) => (
              <div key={c.clave} style={{ padding:"16px 18px", borderBottom:"1px solid #f4f5f7", display:"flex", justifyContent:"space-between", alignItems:"center", background: i % 2 === 0 ? "#fff" : "#f8f9fa" }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#333" }}>{c.label}</div>
                  <div style={{ fontSize:11, color:"#888", marginTop:2 }}>clave: {c.clave}</div>
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  {editando === `cfg-${c.clave}` ? (
                    <>
                      <input value={valEdit} onChange={e => setValEdit(e.target.value)}
                        style={{ width:100, fontSize:12, padding:"5px 8px", borderRadius:6, border:"1px solid #FF6600", fontFamily:"'Outfit', sans-serif" }}
                        autoFocus onKeyDown={e => { if (e.key === "Enter") guardarConfig(c.clave, valEdit); if (e.key === "Escape") setEditando(null); }} />
                      <button onClick={() => guardarConfig(c.clave, valEdit)}
                        style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer" }}>✓</button>
                      <button onClick={() => setEditando(null)}
                        style={{ background:"#e4e7ec", color:"#555", border:"none", borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer" }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize:16, fontWeight:800, color:"#002E5D" }}>{c.valor}</span>
                      <button onClick={() => { setEditando(`cfg-${c.clave}`); setValEdit(c.valor); }}
                        style={{ background:"#002E5D", color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                        ✏️ Editar
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal Nueva Tarifa */}
      {modalNuevo && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:480 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={{ fontSize:16, fontWeight:800, color:"#002E5D" }}>➕ Nueva Tarifa</div>
              <button onClick={() => setModalNuevo(false)} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#888" }}>✕</button>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:4 }}>Tipo Vehículo *</div>
                <select value={formNuevo.tipo_vehiculo} onChange={e => setFormNuevo(f => ({ ...f, tipo_vehiculo: e.target.value }))}
                  style={{ width:"100%", fontSize:12, padding:"7px 10px", borderRadius:8, border:"1px solid #e4e7ec" }}>
                  <option value="SMALL VAN">SMALL VAN</option>
                  <option value="LARGE VAN">LARGE VAN</option>
                  <option value="CAR">CAR</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:4 }}>Zona *</div>
                <select value={formNuevo.zonificacion} onChange={e => setFormNuevo(f => ({ ...f, zonificacion: e.target.value }))}
                  style={{ width:"100%", fontSize:12, padding:"7px 10px", borderRadius:8, border:"1px solid #e4e7ec" }}>
                  {["L1","L2","L3","L4"].map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              {[
                { k:"tramo_km", label:"Tramo (ej: 301-350) *" },
                { k:"km_min", label:"Km Mínimo *", type:"number" },
                { k:"km_max", label:"Km Máximo (vacío=sin límite)", type:"number" },
                { k:"tarifa_mxn", label:"Tarifa MXN *", type:"number" },
              ].map(({ k, label, type }) => (
                <div key={k}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#555", marginBottom:4 }}>{label}</div>
                  <input type={type || "text"} value={formNuevo[k]} onChange={e => setFormNuevo(f => ({ ...f, [k]: e.target.value }))}
                    style={{ width:"100%", fontSize:12, padding:"7px 10px", borderRadius:8, border:"1px solid #e4e7ec", fontFamily:"'Outfit', sans-serif", boxSizing:"border-box" }} />
                </div>
              ))}
            </div>

            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button onClick={() => setModalNuevo(false)}
                style={{ background:"#f1f5f9", color:"#555", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                Cancelar
              </button>
              <button onClick={agregarFila} disabled={guardando}
                style={{ background:"#FF6600", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                {guardando ? "Guardando..." : "Agregar Tarifa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Certronic · Chile ───────────────────────────────────────────────────────
// El módulo de certificación documental de Chile (Certronic) vive ahora en
// cl/certronic/ y lo carga directamente cl/CertificacionesCL.jsx.

// Tarjeta KPI (la usan otros módulos del Brain)
function KPI({ label, valor, sub, color = "#002E5D" }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10,
      padding: 12, borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VISTA PENALIZACIONES — calculadas desde tabla viajes (tms_raw)
// ═══════════════════════════════════════════════════════════════════════════
function VistaPenalizaciones({ fecha, fechaFin, pais }) {
  const [viajes, setViajes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { cargar(); }, [fecha, fechaFin, pais]);

  const cargar = async () => {
    setLoading(true);
    try {
      let q = sb.from("viajes")
        .select("*, drivers(nombre, rut)")
        .order("fecha_salida", { ascending: false })
        .limit(2000);
      if (fecha) {
        q = q.gte("fecha_salida", fecha + "T00:00:00Z").lte("fecha_salida", (fechaFin || fecha) + "T23:59:59Z");
      }
      if (pais) q = q.eq("pais", pais);
      const { data } = await q;
      setViajes(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Filtrar viajes con NS bajo (deficiente o crítico)
  const penalizados = useMemo(() => {
    return viajes.map(v => {
      const raw = v.tms_raw || {};
      const ns = parseFloat(raw["Entrega exitosa"] || raw["entrega_exitosa"] || 0);
      const noVisitado = parseFloat(raw["No visitado"] || raw["no_visitado"] || 0);
      let categoria = null, factor = 0;
      if (noVisitado > 10) { categoria = "Crítico"; factor = -1.0; }
      else if (ns < 95) { categoria = "Deficiente"; factor = -0.03; }
      if (!categoria) return null;
      return {
        ...v,
        raw,
        ns_pct: ns,
        no_visitado: noVisitado,
        categoria,
        factor,
      };
    }).filter(Boolean);
  }, [viajes]);

  const totalCriticos = penalizados.filter(p => p.categoria === "Crítico").length;
  const totalDeficientes = penalizados.filter(p => p.categoria === "Deficiente").length;

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #c0392b", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Críticos (no se pagan)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#c0392b", marginTop: 2 }}>{totalCriticos}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>No visitado &gt; 10%</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #FF6600", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Deficientes (-3%)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#FF6600", marginTop: 2 }}>{totalDeficientes}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>NS &lt; 95%</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Total viajes</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>{viajes.length}</div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#002E5D" }}>Viajes con Penalización ({penalizados.length})</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Calculado desde NS y % No visitado del informe Logistic</div>
        </div>
        {penalizados.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#16a34a", fontSize: 13 }}>
            Sin penalizaciones en este período. Todos los viajes con NS aceptable o mejor.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Fecha</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Driver</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>SC</th>
                <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>NS%</th>
                <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>No vis%</th>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Categoría</th>
                <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Ajuste</th>
              </tr>
            </thead>
            <tbody>
              {penalizados.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 10px" }}>{(p.fecha_salida || "").substring(0, 10)}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 500 }}>{p.drivers?.nombre || p.raw["Nombre del transportista"] || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.raw["Service center"] || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{p.ns_pct.toFixed(2)}%</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>{p.no_visitado.toFixed(2)}%</td>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: p.categoria === "Crítico" ? "#fee2e2" : "#fed7aa", color: p.categoria === "Crítico" ? "#991b1b" : "#9a3412", fontWeight: 600 }}>
                      {p.categoria}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#c0392b" }}>
                    {p.factor === -1 ? "NO PAGO" : `${(p.factor * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VISTA PREMIOS — viajes con NS Excelente (+5%)
// ═══════════════════════════════════════════════════════════════════════════
function VistaPremios({ fecha, fechaFin, pais }) {
  const [viajes, setViajes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { cargar(); }, [fecha, fechaFin, pais]);

  const cargar = async () => {
    setLoading(true);
    try {
      let q = sb.from("viajes")
        .select("*, drivers(nombre, rut)")
        .order("fecha_salida", { ascending: false })
        .limit(2000);
      if (fecha) {
        q = q.gte("fecha_salida", fecha + "T00:00:00Z").lte("fecha_salida", (fechaFin || fecha) + "T23:59:59Z");
      }
      if (pais) q = q.eq("pais", pais);
      const { data } = await q;
      setViajes(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const premiados = useMemo(() => {
    return viajes.map(v => {
      const raw = v.tms_raw || {};
      const ns = parseFloat(raw["Entrega exitosa"] || raw["entrega_exitosa"] || 0);
      const noVisitado = parseFloat(raw["No visitado"] || raw["no_visitado"] || 0);
      // Excelente: NS >= 99.5% Y no visitado >= 99.5% (es decir, no_visitado <= 0.5%)
      if (ns >= 99.5 && noVisitado < 0.5) {
        return { ...v, raw, ns_pct: ns, no_visitado: noVisitado, categoria: "Excelente", factor: 0.05 };
      }
      return null;
    }).filter(Boolean);
  }, [viajes]);

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #16a34a", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Excelente (+5%)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>{premiados.length}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>NS ≥ 99.5%</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Total viajes</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>{viajes.length}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>% Premiado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>
            {viajes.length > 0 ? ((premiados.length / viajes.length) * 100).toFixed(1) : 0}%
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#002E5D" }}>Viajes con Premio ({premiados.length})</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>NS ≥ 99.5% · suman 5% sobre la tarifa base</div>
        </div>
        {premiados.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
            Sin viajes con NS Excelente en este período.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Fecha</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Driver</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>SC</th>
                <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>NS%</th>
                <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Bonus</th>
              </tr>
            </thead>
            <tbody>
              {premiados.map((p, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "8px 10px" }}>{(p.fecha_salida || "").substring(0, 10)}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 500 }}>{p.drivers?.nombre || p.raw["Nombre del transportista"] || "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{p.raw["Service center"] || "—"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: "#16a34a", fontWeight: 600 }}>{p.ns_pct.toFixed(2)}%</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#16a34a" }}>+5%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VISTA AYUDANTES — desde logistic_ayudantes_snapshots
// ═══════════════════════════════════════════════════════════════════════════
function VistaAyudantes({ fecha, fechaFin }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { cargar(); }, [fecha, fechaFin]);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("logistic_ayudantes_snapshots")
        .select("*")
        .gte("fecha", fecha)
        .lte("fecha", fechaFin || fecha)
        .order("hora_snapshot", { ascending: false })
        .limit(5000);
      setSnapshots(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Consolidar por ruta+fecha (5 snapshots → 1 fila)
  const consolidados = useMemo(() => {
    const m = {};
    for (const s of snapshots) {
      const k = `${s.fecha}|${s.id_ruta}`;
      if (!m[k]) m[k] = {
        fecha: s.fecha,
        id_ruta: s.id_ruta,
        cluster: s.cluster,
        service_center_id: s.service_center_id,
        driver_name: s.driver_name,
        vehiculo_descripcion: s.vehiculo_descripcion,
        placa: s.placa,
        snapshots: { inicio: null, media_manana: null, tarde: null, fin_tarde: null, pre_cierre: null },
        total_snapshots: 0,
        snapshots_con_helper: 0,
      };
      m[k].snapshots[s.momento_dia] = s.has_helper;
      m[k].total_snapshots++;
      if (s.has_helper) m[k].snapshots_con_helper++;
    }
    return Object.values(m).sort((a, b) => {
      if (a.fecha !== b.fecha) return b.fecha.localeCompare(a.fecha);
      return b.snapshots_con_helper - a.snapshots_con_helper;
    });
  }, [snapshots]);

  const totalConHelper = consolidados.filter(c => c.snapshots_con_helper >= 3).length;
  const totalSospechosos = consolidados.filter(c => c.snapshots_con_helper >= 1 && c.snapshots_con_helper < 3).length;

  const renderEstado = (h) => {
    if (h === true) return <span style={{ color: "#16a34a" }}>✓</span>;
    if (h === false) return <span style={{ color: "#94a3b8" }}>—</span>;
    return <span style={{ color: "#cbd5e1" }}>·</span>;
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #002E5D", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Total rutas</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>{consolidados.length}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #16a34a", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Confirmados</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>{totalConHelper}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>≥3 snapshots con helper</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #FF6600", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Sospechosos</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#FF6600", marginTop: 2 }}>{totalSospechosos}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>1-2 snapshots con helper</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #002E5D", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Pago auxiliares</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>${(totalConHelper * 300).toLocaleString("es-MX")}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>${300} × {totalConHelper} rutas</div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#002E5D" }}>Detalle de Ayudantes ({consolidados.length})</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Estado en cada uno de los 5 snapshots del día (✓ = con ayudante)</div>
        </div>
        {consolidados.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
            Sin datos de ayudantes para este período.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Fecha</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>SC</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Cluster</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Driver</th>
                <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Placa</th>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>9am</th>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>13h</th>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>17h</th>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>21h</th>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>1am</th>
                <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Estado</th>
                <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Pago</th>
              </tr>
            </thead>
            <tbody>
              {consolidados.map((c, i) => {
                const estado = c.snapshots_con_helper >= 3 ? "OK" : c.snapshots_con_helper >= 1 ? "SOSPECHOSO" : "SIN_HELPER";
                const colorEstado = estado === "OK" ? "#16a34a" : estado === "SOSPECHOSO" ? "#FF6600" : "#94a3b8";
                const bgEstado = estado === "OK" ? "#dcfce7" : estado === "SOSPECHOSO" ? "#fed7aa" : "#f1f5f9";
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 10px", color: "#64748b" }}>{c.fecha}</td>
                    <td style={{ padding: "8px 10px", fontWeight: 500 }}>{c.service_center_id}</td>
                    <td style={{ padding: "8px 10px" }}>{c.cluster}</td>
                    <td style={{ padding: "8px 10px" }}>{c.driver_name || "—"}</td>
                    <td style={{ padding: "8px 10px", color: "#64748b", fontSize: 11 }}>{c.placa || "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>{renderEstado(c.snapshots.inicio)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>{renderEstado(c.snapshots.media_manana)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>{renderEstado(c.snapshots.tarde)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>{renderEstado(c.snapshots.fin_tarde)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>{renderEstado(c.snapshots.pre_cierre)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: bgEstado, color: colorEstado, fontWeight: 600 }}>
                        {estado}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: estado === "OK" ? "#16a34a" : "#94a3b8" }}>
                      {estado === "OK" ? "$300" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PANTALLA POST-LOGIN: la antigua vista "BrainCentral" (neurona) fue reemplazada
// por el Selector de Operación (país), definido junto a la App principal.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// CERTIFICACIONES MADRE — wrapper con sub-tabs
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// VARIACIONES DIARIAS CERTRONIC — comparación día a día
// ═══════════════════════════════════════════════════════════════════════════
function VariacionesDiarias() {
  const [fechaHoy, setFechaHoy] = useState(null);
  const [fechaAyer, setFechaAyer] = useState(null);
  const [fechasDisponibles, setFechasDisponibles] = useState([]);
  const [datos, setDatos] = useState({ hoy: [], ayer: [] });
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroOperacion, setFiltroOperacion] = useState("todas");
  const [expandido, setExpandido] = useState(null);

  // Cargar fechas disponibles al montar
  useEffect(() => {
    (async () => {
      try {
        // Paginamos en chunks de 1000 para sacar todas las fechas únicas.
        // Tope: 30 chunks (= 30K filas, suficiente para ~4 días con 7.5K filas c/u).
        const fechasSet = new Set();
        let from = 0;
        const limite = 1000;
        const maxChunks = 30;

        for (let c = 0; c < maxChunks; c++) {
          const { data, error } = await sb.from("certronic_estados_documentos")
            .select("fecha_snapshot")
            .order("fecha_snapshot", { ascending: false })
            .range(from, from + limite - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          for (const r of data) fechasSet.add(r.fecha_snapshot);
          if (data.length < limite) break;
          from += limite;
        }

        const unicas = Array.from(fechasSet).sort().reverse();
        console.log(`[Variaciones] Fechas disponibles: ${unicas.length}`, unicas);
        setFechasDisponibles(unicas);
        if (unicas.length >= 2) {
          setFechaHoy(unicas[0]);
          setFechaAyer(unicas[1]);
        } else if (unicas.length === 1) {
          setFechaHoy(unicas[0]);
          setFechaAyer(null);
        }
      } catch (e) {
        console.error("[Variaciones] Error cargando fechas:", e);
      }
    })();
  }, []);

  // Cargar datos cuando cambian las fechas
  useEffect(() => {
    if (!fechaHoy) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const promesas = [
          sb.from("certronic_estados_documentos")
            .select("contratista, planta, entidad, detalle, documento, periodo, impide_acceso, impide_pago, estado, cumple")
            .eq("fecha_snapshot", fechaHoy)
            .limit(20000),
        ];
        if (fechaAyer) {
          promesas.push(
            sb.from("certronic_estados_documentos")
              .select("contratista, planta, entidad, detalle, documento, periodo, impide_acceso, impide_pago, estado, cumple")
              .eq("fecha_snapshot", fechaAyer)
              .limit(20000)
          );
        }
        const [hoyRes, ayerRes] = await Promise.all(promesas);
        if (cancel) return;
        if (hoyRes.error) throw hoyRes.error;
        if (ayerRes && ayerRes.error) throw ayerRes.error;
        setDatos({
          hoy: hoyRes.data || [],
          ayer: ayerRes ? (ayerRes.data || []) : [],
        });
      } catch (e) {
        console.error(e);
        if (!cancel) setDatos({ hoy: [], ayer: [] });
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [fechaHoy, fechaAyer]);

  // Comparación: agrupar por contratista y calcular cambios
  const analisis = useMemo(() => {
    if (!datos.hoy.length) return { porContratista: [], totales: {} };

    // Indexar por (contratista, documento, detalle, periodo) — clave única
    const claveDoc = (r) =>
      `${(r.contratista || "").toUpperCase().trim()}|${r.documento || ""}|${r.detalle || ""}|${r.periodo || ""}`;

    const ayerMap = new Map();
    for (const r of datos.ayer) ayerMap.set(claveDoc(r), r);

    const hoyMap = new Map();
    for (const r of datos.hoy) hoyMap.set(claveDoc(r), r);

    // Construir lista de cambios por documento
    const cambiosDocs = [];
    const contratistasHoy = new Set();
    const contratistasAyer = new Set();

    for (const r of datos.hoy) {
      contratistasHoy.add(r.contratista);
      const ayer = ayerMap.get(claveDoc(r));
      let tipo = "SIN_CAMBIO";
      if (!ayer) {
        tipo = "DOC_NUEVO";
      } else if (ayer.cumple === "N" && r.cumple === "S") {
        tipo = "MEJORA";
      } else if (ayer.cumple === "S" && r.cumple === "N") {
        tipo = "EMPEORO";
      } else if (ayer.impide_pago !== r.impide_pago) {
        tipo = "CAMBIO_IMPIDE_PAGO";
      } else if (ayer.impide_acceso !== r.impide_acceso) {
        tipo = "CAMBIO_IMPIDE_ACCESO";
      }
      if (tipo !== "SIN_CAMBIO") {
        cambiosDocs.push({
          contratista: r.contratista,
          planta: r.planta,
          entidad: r.entidad,
          detalle: r.detalle,
          documento: r.documento,
          periodo: r.periodo,
          tipo,
          cumple_ayer: ayer?.cumple || null,
          cumple_hoy: r.cumple,
          impide_pago_ayer: ayer?.impide_pago || null,
          impide_pago_hoy: r.impide_pago,
          impide_acceso_ayer: ayer?.impide_acceso || null,
          impide_acceso_hoy: r.impide_acceso,
          estado_hoy: r.estado,
        });
      }
    }
    // Detectar docs que existían ayer y no hoy (eliminados)
    for (const r of datos.ayer) {
      contratistasAyer.add(r.contratista);
      if (!hoyMap.has(claveDoc(r))) {
        cambiosDocs.push({
          contratista: r.contratista,
          planta: r.planta,
          entidad: r.entidad,
          detalle: r.detalle,
          documento: r.documento,
          periodo: r.periodo,
          tipo: "DOC_ELIMINADO",
          cumple_ayer: r.cumple,
          cumple_hoy: null,
          impide_pago_ayer: r.impide_pago,
          impide_pago_hoy: null,
          impide_acceso_ayer: r.impide_acceso,
          impide_acceso_hoy: null,
          estado_hoy: null,
        });
      }
    }

    // Agrupar por contratista
    const porContratistaMap = new Map();
    for (const c of cambiosDocs) {
      if (!porContratistaMap.has(c.contratista)) {
        porContratistaMap.set(c.contratista, {
          contratista: c.contratista,
          planta: c.planta,
          esContratistaNuevo: !contratistasAyer.has(c.contratista),
          esContratistaEliminado: !contratistasHoy.has(c.contratista),
          cambios: [],
          mejoras: 0,
          empeoraron: 0,
          impidePago: 0,
          impideAcceso: 0,
          docsNuevos: 0,
          docsEliminados: 0,
        });
      }
      const grp = porContratistaMap.get(c.contratista);
      grp.cambios.push(c);
      if (c.tipo === "MEJORA") grp.mejoras++;
      else if (c.tipo === "EMPEORO") grp.empeoraron++;
      else if (c.tipo === "CAMBIO_IMPIDE_PAGO") grp.impidePago++;
      else if (c.tipo === "CAMBIO_IMPIDE_ACCESO") grp.impideAcceso++;
      else if (c.tipo === "DOC_NUEVO") grp.docsNuevos++;
      else if (c.tipo === "DOC_ELIMINADO") grp.docsEliminados++;
    }
    const porContratista = Array.from(porContratistaMap.values());

    // Calcular cumple por contratista hoy y ayer (cuántos S vs total)
    const calcularResumen = (filas) => {
      const m = new Map();
      for (const r of filas) {
        if (!m.has(r.contratista)) m.set(r.contratista, { total: 0, ok: 0 });
        const g = m.get(r.contratista);
        g.total++;
        if (r.cumple === "S") g.ok++;
      }
      return m;
    };
    const resumenHoy = calcularResumen(datos.hoy);
    const resumenAyer = calcularResumen(datos.ayer);

    for (const grp of porContratista) {
      const h = resumenHoy.get(grp.contratista);
      const a = resumenAyer.get(grp.contratista);
      grp.docs_ok_hoy = h ? h.ok : 0;
      grp.docs_total_hoy = h ? h.total : 0;
      grp.docs_ok_ayer = a ? a.ok : 0;
      grp.docs_total_ayer = a ? a.total : 0;
      grp.cambio_neto = grp.docs_ok_hoy - grp.docs_ok_ayer;
    }

    // Totales globales
    const totales = {
      contratistasNuevos: porContratista.filter(c => c.esContratistaNuevo).length,
      contratistasEliminados: porContratista.filter(c => c.esContratistaEliminado).length,
      mejoras: cambiosDocs.filter(c => c.tipo === "MEJORA").length,
      empeoraron: cambiosDocs.filter(c => c.tipo === "EMPEORO").length,
      impidePago: cambiosDocs.filter(c => c.tipo === "CAMBIO_IMPIDE_PAGO").length,
      impideAcceso: cambiosDocs.filter(c => c.tipo === "CAMBIO_IMPIDE_ACCESO").length,
      docsNuevos: cambiosDocs.filter(c => c.tipo === "DOC_NUEVO").length,
      docsEliminados: cambiosDocs.filter(c => c.tipo === "DOC_ELIMINADO").length,
      contratistasConCambios: porContratista.length,
      totalContratistasHoy: contratistasHoy.size,
      totalContratistasAyer: contratistasAyer.size,
    };

    return { porContratista, totales, cambiosDocs };
  }, [datos]);

  // Aplicar filtros
  const filtrados = useMemo(() => {
    let res = analisis.porContratista || [];
    if (busqueda) {
      const q = busqueda.toLowerCase();
      res = res.filter(c =>
        (c.contratista || "").toLowerCase().includes(q) ||
        (c.planta || "").toLowerCase().includes(q)
      );
    }
    if (filtroOperacion !== "todas") {
      res = res.filter(c => (c.planta || "").toLowerCase().includes(filtroOperacion.toLowerCase()));
    }
    if (filtroTipo === "criticos")        res = res.filter(c => c.impidePago > 0 || c.impideAcceso > 0);
    else if (filtroTipo === "mejoraron")  res = res.filter(c => c.cambio_neto > 0);
    else if (filtroTipo === "empeoraron") res = res.filter(c => c.cambio_neto < 0);
    else if (filtroTipo === "nuevos")     res = res.filter(c => c.esContratistaNuevo);
    else if (filtroTipo === "eliminados") res = res.filter(c => c.esContratistaEliminado);

    return res.sort((a, b) => {
      // Críticos primero, después por magnitud de cambio
      const aCritico = (a.impidePago + a.impideAcceso) > 0 ? 1 : 0;
      const bCritico = (b.impidePago + b.impideAcceso) > 0 ? 1 : 0;
      if (aCritico !== bCritico) return bCritico - aCritico;
      return Math.abs(b.cambio_neto) - Math.abs(a.cambio_neto);
    });
  }, [analisis, busqueda, filtroTipo, filtroOperacion]);

  // Operaciones únicas para el filtro
  const operacionesUnicas = useMemo(() => {
    const set = new Set();
    for (const c of (analisis.porContratista || [])) {
      if (c.planta) set.add(c.planta);
    }
    return Array.from(set).sort();
  }, [analisis]);

  // Export CSV
  const exportarCSV = () => {
    const filas = [];
    for (const c of filtrados) {
      for (const cb of c.cambios) {
        filas.push({
          contratista: c.contratista,
          operacion: c.planta,
          tipo_cambio: cb.tipo,
          documento: cb.documento,
          recurso: cb.detalle,
          periodo: cb.periodo,
          cumple_ayer: cb.cumple_ayer,
          cumple_hoy: cb.cumple_hoy,
          impide_pago_ayer: cb.impide_pago_ayer,
          impide_pago_hoy: cb.impide_pago_hoy,
          impide_acceso_ayer: cb.impide_acceso_ayer,
          impide_acceso_hoy: cb.impide_acceso_hoy,
          estado_hoy: cb.estado_hoy,
        });
      }
    }
    if (filas.length === 0) { alert("No hay datos para exportar"); return; }
    const headers = Object.keys(filas[0]);
    const csv = [headers.join(",")].concat(
      filas.map(r => headers.map(h => {
        const v = r[h];
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
    ).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `variaciones_${fechaHoy}_vs_${fechaAyer || "ninguna"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pg" style={{ maxWidth: 1500 }}>
      <div style={{ marginBottom: 16 }}>
        <div className="sec-title">Variaciones Diarias</div>
        <div className="sec-sub">Cambios en estados de documentos día a día (Certronic liviano)</div>
      </div>

      {/* Selector de fechas */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Comparación</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 4 }}>Snapshot HOY</div>
            <select value={fechaHoy || ""} onChange={e => setFechaHoy(e.target.value)}
              style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12, minWidth: 160 }}>
              {fechasDisponibles.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 18, color: "#94a3b8", marginTop: 18 }}>vs</div>
          <div>
            <div style={{ fontSize: 11, color: "#475569", fontWeight: 600, marginBottom: 4 }}>Snapshot AYER (referencia)</div>
            <select value={fechaAyer || ""} onChange={e => setFechaAyer(e.target.value || null)}
              style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12, minWidth: 160 }}>
              <option value="">— ninguno —</option>
              {fechasDisponibles.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <input type="text" placeholder="Buscar contratista..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12, minWidth: 200 }} />
            <select value={filtroOperacion} onChange={e => setFiltroOperacion(e.target.value)}
              style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, padding: "6px 10px", fontSize: 12 }}>
              <option value="todas">Todas las operaciones</option>
              {operacionesUnicas.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <button onClick={exportarCSV} disabled={!filtrados.length}
              style={{ padding: "8px 14px", borderRadius: 4, border: "1px solid #e4e7ec", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: filtrados.length === 0 ? "not-allowed" : "pointer", opacity: filtrados.length === 0 ? 0.5 : 1 }}>
              Exportar CSV
            </button>
          </div>
        </div>
        {fechasDisponibles.length < 2 && (
          <div style={{ marginTop: 10, padding: 10, background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 4, fontSize: 11, color: "#92400e" }}>
            ⚠ Solo hay {fechasDisponibles.length} snapshot disponible. Se necesitan al menos 2 para comparar. Esperá al cron diario de mañana 06:00 Chile.
          </div>
        )}
      </div>

      {/* Resumen de cambios */}
      {!loading && analisis.totales && fechaAyer && (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>
            Resumen de cambios entre {fechaAyer} y {fechaHoy}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            {[
              { id: "criticos",    label: "Cambios en impide_pago",   count: analisis.totales.impidePago,         col: "#dc2626", desc: "Afecta retenciones" },
              { id: "criticos2",   label: "Cambios en impide_acceso", count: analisis.totales.impideAcceso,       col: "#7c3aed", desc: "No pueden ingresar" },
              { id: "mejoraron",   label: "Mejoras (cumple N→S)",     count: analisis.totales.mejoras,            col: "#16a34a", desc: "Docs aprobados" },
              { id: "empeoraron",  label: "Empeoraron (cumple S→N)",  count: analisis.totales.empeoraron,         col: "#dc2626", desc: "Docs rechazados/vencidos" },
              { id: "nuevos_doc",  label: "Documentos nuevos",        count: analisis.totales.docsNuevos,         col: "#0891b2", desc: "Aparecen hoy" },
              { id: "elim_doc",    label: "Documentos eliminados",    count: analisis.totales.docsEliminados,     col: "#94a3b8", desc: "Ya no aparecen" },
              { id: "nuevos",      label: "Contratistas nuevos",      count: analisis.totales.contratistasNuevos, col: "#0891b2", desc: "No estaban ayer" },
              { id: "eliminados",  label: "Contratistas sin docs hoy",  count: analisis.totales.contratistasEliminados, col: "#d97706", desc: "Estaban ayer pero no aparecen hoy" },
            ].map(item => (
              <div key={item.id} style={{
                background: item.count > 0 ? "#fff" : "#fafafa",
                border: `1px solid ${item.count > 0 ? item.col + "44" : "#e4e7ec"}`,
                borderLeft: `3px solid ${item.col}`,
                borderRadius: 4, padding: "8px 12px",
                opacity: item.count === 0 ? 0.6 : 1,
              }}>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{item.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: item.col, marginTop: 2 }}>{item.count}</div>
                <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>{item.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "#64748b" }}>
            <strong>{analisis.totales.contratistasConCambios}</strong> contratistas con cambios
            de un total de <strong>{analisis.totales.totalContratistasHoy}</strong> registrados hoy
            ({analisis.totales.totalContratistasAyer} estaban ayer).
          </div>
        </div>
      )}

      {/* Filtros de tipo */}
      {!loading && fechaAyer && analisis.porContratista.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { id: "todos",      label: "Todos" },
            { id: "criticos",   label: "Críticos (impide_pago / acceso)" },
            { id: "mejoraron",  label: "Mejoraron" },
            { id: "empeoraron", label: "Empeoraron" },
            { id: "nuevos",     label: "Nuevos" },
            { id: "eliminados", label: "Sin docs hoy" },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltroTipo(f.id)}
              style={{
                padding: "6px 12px", borderRadius: 4,
                border: "1px solid " + (filtroTipo === f.id ? "#002E5D" : "#e4e7ec"),
                background: filtroTipo === f.id ? "#002E5D" : "#fff",
                color: filtroTipo === f.id ? "#fff" : "#475569",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Tabla de contratistas con cambios */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando snapshots...</div>
        ) : !fechaAyer ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: "#475569" }}>Seleccioná un snapshot de comparación</div>
            <div style={{ fontSize: 11 }}>Necesitamos 2 snapshots para mostrar variaciones. Si solo hay uno, esperá al próximo cron diario.</div>
          </div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: "#16a34a" }}>✓ Sin cambios para mostrar</div>
            <div style={{ fontSize: 11 }}>
              {analisis.porContratista.length === 0
                ? "Los snapshots son idénticos."
                : "Ningún contratista coincide con los filtros aplicados."}
            </div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <Th>Contratista</Th>
                <Th>Operación</Th>
                <Th right>Docs OK<br/>{fechaAyer?.slice(5)}</Th>
                <Th right>Docs OK<br/>{fechaHoy?.slice(5)}</Th>
                <Th right>Δ Neto</Th>
                <Th center>✅ Mej.</Th>
                <Th center>❌ Emp.</Th>
                <Th center>💰 Pago</Th>
                <Th center>🚫 Acc.</Th>
                <Th center>🆕 Nuevos</Th>
                <Th center>🗑 Elim.</Th>
                <Th center>Detalle</Th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c, i) => {
                const expandedThis = expandido === c.contratista;
                const esCritico = (c.impidePago + c.impideAcceso) > 0;
                return (
                  <Fragment key={c.contratista + i}>
                    <tr style={{
                      borderBottom: "1px solid #f0f0f0",
                      background: c.esContratistaNuevo ? "#ecfdf5" : esCritico ? "#fef2f2" : undefined,
                    }}>
                      <td style={tdStyle(true)}>
                        {c.contratista}
                        {c.esContratistaNuevo && (
                          <span title="Aparece en este snapshot pero no en el de comparación" 
                            style={{ marginLeft: 6, fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>NUEVO</span>
                        )}
                        {c.esContratistaEliminado && (
                          <span title="Aparecía en el snapshot anterior pero no en el de hoy. Puede ser que: (1) fue dado de baja en Certronic, o (2) sigue existiendo pero sin docs cargados este mes. Verificar manualmente." 
                            style={{ marginLeft: 6, fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#fef3c7", color: "#92400e", fontWeight: 700 }}>SIN DOCS HOY</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle(), fontSize: 10, color: "#64748b" }}>{c.planta || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "right", color: "#94a3b8", fontSize: 10 }}>
                        {c.docs_ok_ayer} / {c.docs_total_ayer}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "right", fontWeight: 600, color: "#002E5D" }}>
                        {c.docs_ok_hoy} / {c.docs_total_hoy}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "right", fontWeight: 700,
                        color: c.cambio_neto > 0 ? "#16a34a" : c.cambio_neto < 0 ? "#dc2626" : "#94a3b8" }}>
                        {c.cambio_neto > 0 ? "+" : ""}{c.cambio_neto}
                      </td>
                      <td style={{ ...tdStyle(), textAlign: "center", color: c.mejoras > 0 ? "#16a34a" : "#cbd5e1", fontWeight: c.mejoras > 0 ? 700 : 400 }}>{c.mejoras || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "center", color: c.empeoraron > 0 ? "#dc2626" : "#cbd5e1", fontWeight: c.empeoraron > 0 ? 700 : 400 }}>{c.empeoraron || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "center", color: c.impidePago > 0 ? "#dc2626" : "#cbd5e1", fontWeight: c.impidePago > 0 ? 700 : 400 }}>{c.impidePago || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "center", color: c.impideAcceso > 0 ? "#7c3aed" : "#cbd5e1", fontWeight: c.impideAcceso > 0 ? 700 : 400 }}>{c.impideAcceso || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "center", color: c.docsNuevos > 0 ? "#0891b2" : "#cbd5e1", fontWeight: c.docsNuevos > 0 ? 700 : 400 }}>{c.docsNuevos || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "center", color: c.docsEliminados > 0 ? "#94a3b8" : "#cbd5e1", fontWeight: c.docsEliminados > 0 ? 700 : 400 }}>{c.docsEliminados || "—"}</td>
                      <td style={{ ...tdStyle(), textAlign: "center" }}>
                        <button onClick={() => setExpandido(expandedThis ? null : c.contratista)}
                          style={{
                            padding: "4px 10px", borderRadius: 4, border: "1px solid #e4e7ec",
                            background: expandedThis ? "#002E5D" : "#fff",
                            color: expandedThis ? "#fff" : "#475569",
                            fontSize: 11, fontWeight: 600, cursor: "pointer",
                          }}>
                          {expandedThis ? "Cerrar" : "Ver"}
                        </button>
                      </td>
                    </tr>
                    {expandedThis && (
                      <tr>
                        <td colSpan={12} style={{ padding: 0, background: "#f8fafc" }}>
                          <DetalleVariacionContratista contratista={c} fechaHoy={fechaHoy} fechaAyer={fechaAyer} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Componente del detalle de variaciones por contratista
function DetalleVariacionContratista({ contratista, fechaHoy, fechaAyer }) {
  const cambios = contratista.cambios || [];
  const sinCambioCount = (contratista.docs_total_hoy || 0) - cambios.filter(c => c.tipo !== "DOC_ELIMINADO" && c.tipo !== "DOC_NUEVO").length;

  // Color y label por tipo de cambio
  const tipoConfig = {
    MEJORA:               { col: "#16a34a", bg: "#dcfce7", label: "Mejoró", icono: "✅" },
    EMPEORO:              { col: "#dc2626", bg: "#fee2e2", label: "Empeoró", icono: "❌" },
    CAMBIO_IMPIDE_PAGO:   { col: "#dc2626", bg: "#fee2e2", label: "Cambió impide_pago", icono: "💰" },
    CAMBIO_IMPIDE_ACCESO: { col: "#7c3aed", bg: "#f3e8ff", label: "Cambió impide_acceso", icono: "🚫" },
    DOC_NUEVO:            { col: "#0891b2", bg: "#cffafe", label: "Documento nuevo", icono: "🆕" },
    DOC_ELIMINADO:        { col: "#94a3b8", bg: "#f1f5f9", label: "Documento eliminado", icono: "🗑" },
  };

  // Agrupar por tipo
  const porTipo = {};
  for (const c of cambios) {
    if (!porTipo[c.tipo]) porTipo[c.tipo] = [];
    porTipo[c.tipo].push(c);
  }
  const ordenTipos = ["CAMBIO_IMPIDE_PAGO", "CAMBIO_IMPIDE_ACCESO", "EMPEORO", "MEJORA", "DOC_NUEVO", "DOC_ELIMINADO"];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 4 }}>
        {contratista.contratista}
      </div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
        Cambios entre {fechaAyer} y {fechaHoy} · {cambios.length} documento{cambios.length !== 1 ? "s" : ""} con cambios · {sinCambioCount} sin cambios
      </div>

      {ordenTipos.filter(t => porTipo[t]).map(tipo => {
        const config = tipoConfig[tipo];
        return (
          <div key={tipo} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: config.col, textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.5 }}>
              {config.icono} {config.label} ({porTipo[tipo].length})
            </div>
            <div style={{ background: "#fff", border: `1px solid ${config.col}33`, borderRadius: 4, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ background: config.bg }}>
                    <th style={{ padding: "5px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: config.col }}>Recurso</th>
                    <th style={{ padding: "5px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: config.col }}>Documento</th>
                    <th style={{ padding: "5px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: config.col }}>Periodo</th>
                    <th style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: config.col }}>Ayer</th>
                    <th style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: config.col }}>Hoy</th>
                    <th style={{ padding: "5px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: config.col }}>Estado actual</th>
                  </tr>
                </thead>
                <tbody>
                  {porTipo[tipo].map((c, i) => {
                    let ayerCol = "—", hoyCol = "—";
                    if (tipo === "CAMBIO_IMPIDE_PAGO") {
                      ayerCol = `pago: ${c.impide_pago_ayer}`;
                      hoyCol = `pago: ${c.impide_pago_hoy}`;
                    } else if (tipo === "CAMBIO_IMPIDE_ACCESO") {
                      ayerCol = `acc: ${c.impide_acceso_ayer}`;
                      hoyCol = `acc: ${c.impide_acceso_hoy}`;
                    } else {
                      ayerCol = c.cumple_ayer || "—";
                      hoyCol = c.cumple_hoy || "—";
                    }
                    return (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "6px 10px", fontSize: 10 }}>
                          <div>{c.detalle || "—"}</div>
                          <div style={{ fontSize: 9, color: "#94a3b8" }}>{c.entidad}</div>
                        </td>
                        <td style={{ padding: "6px 10px", fontSize: 10 }}>{c.documento}</td>
                        <td style={{ padding: "6px 10px", fontSize: 10, color: "#64748b" }}>{c.periodo || "—"}</td>
                        <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontFamily: "monospace" }}>{ayerCol}</td>
                        <td style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: config.col }}>{hoyCol}</td>
                        <td style={{ padding: "6px 10px", fontSize: 10, color: "#64748b" }}>{c.estado_hoy || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TABS_CERT_MX = [
  { id: "ingresos",    label: "Proceso de Certificaciones MX", desc: "Drivers MX (Mercado Libre)" },
];
registrarSubtabs("certificaciones", TABS_CERT_MX, "ingresos");

function ModuloCertificacionesMadre() {
  const [subtab] = useSubtab("certificaciones");
  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>Certificaciones</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#FF6600", fontFamily: "Poppins, 'Open Sans', sans-serif", marginTop: 2 }}>{(TABS_CERT_MX.find((t) => t.id === subtab) || {}).label}</div>
      </div>
      {subtab === "ingresos"    && <ModuloCertificaciones />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TORRE DE CONTROL DE PAGOS · 3 PILARES
// Brain Control Helper MX · v1.0 · 27-may-2026
// Fuente: vw_torre_3_pilares · get_torre_3_pilares · get_torre_resumen
// ═══════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// PANEL DE CONTROL · SUPERVISORES   (vista: "panel_supervisores")
// ════════════════════════════════════════════════════════════════════════════
// Para el jefe de supervisores. Muestra, por SC, el estado de cumplimiento:
//   - HOY: cuántos de los 5 ítems declaró el supervisor en la bitácora
//   - D-1: estado de la conciliación del día anterior (confirmada/parcial/pendiente)
//   - Difs sin justificar: diferencias detectadas sin justificación
//
// Tabla con filas expandibles (click en un SC = detalle de qué falta) + selector
// de fecha para revisar días pasados. SOLO LECTURA (WhatsApp se agrega después).
//
// Fuentes (sin SQL nuevo):
//   - supervisores_bt   (scs_asignados, nombre, telefono)
//   - bitacora_diaria_sc (declarado_*, conciliacion_d1_confirmada_at, *_estado_justif)
// ════════════════════════════════════════════════════════════════════════════

// ── Subcomponente: rutas con helper del SC/fecha + aprobar/rechazar ──────────
// El jefe aprueba o rechaza cada helper. La decisión se guarda en
// aprobaciones_helper y luego el sistema de pagos la cruza por SC+fecha+travel_id.
// ── Torre de Control del SC (resumen + detalle ruta por ruta del D-1) ────────

// ── Patentes nuevas del SC (operaron HOY y no están en la flota) ─────────────
// Replica la lógica del portal del supervisor: detecta desde el último snapshot,
// normaliza prefijos, y permite al jefe registrarlas a flota_vehiculos_bt.

// ── Ambulancias del SC (del D-1) ─────────────────────────────────────────────

// SCs foráneos: en estos, helper en Small Van se considera bloqueado.
const SCS_FORANEOS_BRAIN = new Set(["SCY1","SCQ1","SQR1","SHP1","STL1","STX1","SVH1","SPB1","SPY1"]);

// Formatea un ISO timestamp a fecha y hora en zona México

// ── Detalle de paquetes entregados por un helper (vw_entregas_por_helper) ────

// ── Formulario inicial del supervisor (contenido completo, del día elegido) ──

// ── Item 6 · Confirmación de Terceros (vista analista, solo lectura) ──
// HOY: usa get_terceros_confirmacion_sc (rostering del día, X/Y en vivo).
// FECHAS PASADAS (desde 2026-07-01): usa get_terceros_confirmacion_historico,
// que lee el log diario terceros_confirmaciones_dia (se listan las placas
// confirmadas ese día; las que quedaron sin confirmar no se historizan).
// En ambos casos se muestran los WARNINGS de get_terceros_cambios_dia:
// empresa nueva ("Otros"), cambio Empresa A → Empresa B y traslados de SC.

const BUCKET_BITACORA = "bitacora-cancelaciones-meli";
function FotoLink({ path }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data, error } = await sb.storage.from(BUCKET_BITACORA).createSignedUrl(path, 3600);
        if (cancel) return;
        if (error || !data?.signedUrl) setErr(true);
        else setUrl(data.signedUrl);
      } catch { if (!cancel) setErr(true); }
    })();
    return () => { cancel = true; };
  }, [path]);

  const nombre = String(path).split("/").pop();
  const esPdf = /\.pdf$/i.test(nombre);
  if (err) return <span style={{ fontSize: 11, color: "#dc2626" }}>⚠ {nombre} (no disponible)</span>;
  if (!url) return <span style={{ fontSize: 11, color: "#9ca3af" }}>Cargando {nombre}…</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#1e3a5f", textDecoration: "none", border: "1px solid #d1d5db", borderRadius: 5, padding: "3px 8px", marginRight: 6, marginBottom: 4, background: "#fff" }}>
      {esPdf ? "📄" : "🖼"} {nombre.length > 22 ? nombre.slice(0, 22) + "…" : nombre}
    </a>
  );
}

function DetalleD1Completo({ row }) {
  // Recolectar todos los adjuntos por ítem
  const adj = (row.justificaciones_adjuntos && typeof row.justificaciones_adjuntos === "object") ? row.justificaciones_adjuntos : {};
  const fotosCancel = Array.isArray(row.declarado_cancelaciones_fotos) ? row.declarado_cancelaciones_fotos : [];

  const items = [
    { key: "ayudantes", nombre: "Ayudantes", justif: row.ayudantes_justificacion, estado: row.ayudantes_estado_justif },
    { key: "ambulancias", nombre: "Ambulancias", justif: row.ambulancias_justificacion, estado: row.ambulancias_estado_justif },
    { key: "cancelaciones", nombre: "Cancelaciones", justif: row.cancelaciones_justificacion, estado: row.cancelaciones_estado_justif },
    { key: "noshow", nombre: "No Show", justif: row.noshow_justificacion, estado: row.noshow_estado_justif },
    { key: "pnr", nombre: "PNR", justif: row.pnr_justificacion, estado: row.pnr_estado_justif },
  ];

  // Helper: arma la lista de adjuntos de un ítem
  function adjuntosDe(key) {
    const arr = [];
    if (Array.isArray(adj[key])) for (const a of adj[key]) if (a?.path) arr.push(a.path);
    if (key === "cancelaciones") for (const f of fotosCancel) if (f?.path) arr.push(f.path);
    return arr;
  }

  // ¿Hay algo que mostrar?
  const hayContenido = items.some((it) => (it.justif && it.justif.trim()) || adjuntosDe(it.key).length > 0);

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>
        📋 Justificaciones y adjuntos cargados (D-1)
      </div>
      {!hayContenido ? (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>El supervisor no cargó justificaciones ni adjuntos para este día.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => {
            const fotos = adjuntosDe(it.key);
            const tieneTexto = it.justif && it.justif.trim();
            if (!tieneTexto && fotos.length === 0) return null;
            return (
              <div key={it.key} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#1f2937", marginBottom: 4 }}>{it.nombre}</div>
                {tieneTexto && (
                  <div style={{ fontSize: 12, color: "#4b5563", whiteSpace: "pre-wrap", marginBottom: fotos.length ? 6 : 0 }}>
                    💬 {it.justif}
                  </div>
                )}
                {fotos.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap" }}>
                    {fotos.map((p, i) => <FotoLink key={i} path={p} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Helpers de estilo del panel

function fmtHora(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" });
  } catch { return "—"; }
}

// ═══════════════════════════════════════════════════════════════════════════
// PESTAÑA "AMBULANCIAS" · dentro de Pagos
// ───────────────────────────────────────────────────────────────────────────
// Traspasos internos de paquetes ruta→ruta (rescates). Por defecto muestra el
// día anterior. Calendario para elegir fecha, filtro por SC y export a Excel.
// Lee la vista vw_ambulancias_diario (creada con base_ambulancias.sql).
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// PAGOS MADRE — wrapper con sub-tabs (Listado / Drivers / Ayudantes / Config)
// ═══════════════════════════════════════════════════════════════════════════
// === Modelo de semanas de inventario de flota (Terceros) ===
// Ancla: semana 24 = lunes 2026-06-01 a domingo 2026-06-07. 25 = 8-14 jun, etc.

// ═══════════════════════════════════════════════════════════════════════════
// CONCILIACIÓN SEMANAL TERCEROS — agrupa los viajes pagados de la semana
// (maestro_jornada_mx) por empresa tercero (flota_terceros_mx de esa semana)
// y, dentro de cada empresa, POR SERVICE CENTER. Cada combinación empresa+SC
// genera su propia prefactura PDF y su propio cierre de conciliación.
// Fuente de empresas: prefacturas_transportistas_mx (RFC + correos TO/CC/BCC),
// la MISMA que usa el envío masivo de prefacturas.
// Supervisor del PDF: prefacturas_parametros_mx (por CECO/SC).
// RPCs: get_conciliacion_terceros_resumen(p_semana)
//       get_conciliacion_terceros_detalle(p_semana, p_empresa, p_sc)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// LISTADO DE PAGOS DIARIOS — con motor de cálculo (Bloque D)
// Lee de maestro_jornada_mx; si no hay datos del día, ofrece calcularlos
// cruzando viajes + logistic_ayudantes_snapshots + matriz_precios + matriz_ns
// ═══════════════════════════════════════════════════════════════════════════

// ─── Helpers de cálculo ────────────────────────────────────────────────────

// Parsea el campo "Vehículo" del tms_raw a una de: LARGE VAN | SMALL VAN | CAR

// Normaliza la patente: sin espacios, mayúsculas y sin prefijo SDD-

// Convierte tipología a la forma usada en tarifas_especiales_mx (Title Case)

// Determina el tramo de km

// Aplica matriz_ns para obtener categoría y porcentaje
function aplicarMatrizNS(nsPct, matrizNS) {
  const ns = Number(nsPct) || 0;
  for (const r of matrizNS) {
    const min = Number(r.ns_min);
    const max = Number(r.ns_max);
    if (ns >= min && ns <= max) {
      return { categoria: r.label, porcentaje: Number(r.porcentaje), tipo: r.tipo };
    }
  }
  return { categoria: "Sin categoría", porcentaje: 0, tipo: "neutro" };
}

// Normaliza nombre de empresa para cruzar tarifa especial (mayúsculas, sin acentos)

// Busca tarifa: primero ESPECIAL por EMPRESA (patente->empresa), sino matriz general.
// Cruza por empresa + tipología + zona + tramo + vigencia (fecha de la ruta).

// Determina estado consolidado del auxiliar (replica vw_ayudantes_dia_actual)
function consolidarAuxiliar(snapshots) {
  if (!snapshots || snapshots.length === 0) {
    return { estado: "SIN_HELPER", total: 0, conHelper: 0, helperInicio: false };
  }
  const conHelper = snapshots.filter(s => s.has_helper).length;
  const helperInicio = snapshots.some(s => s.momento_dia === "inicio" && s.has_helper);

  let estado;
  if (conHelper >= 3 && helperInicio) estado = "OK";
  else if (conHelper >= 3) estado = "MID_ROUTE";
  else if (conHelper >= 1) estado = "SOSPECHOSO";
  else estado = "SIN_HELPER";

  return { estado, total: snapshots.length, conHelper, helperInicio };
}

// Aplica matriz_ayudantes_autorizados — devuelve si paga y cuánto
function aplicarMatrizAyudantes(scId, vehiculoTipo, zona, matriz) {
  // Buscar la regla más específica primero (mayor prioridad gana)
  const ordenadas = [...matriz].sort((a, b) => (b.prioridad || 0) - (a.prioridad || 0));
  for (const r of ordenadas) {
    const matchSC = r.service_center_id == null || r.service_center_id === scId;
    const matchVeh = r.vehiculo_tipo == null || r.vehiculo_tipo === vehiculoTipo;
    const matchZona = r.zona == null || r.zona === zona;
    if (matchSC && matchVeh && matchZona) {
      return { autorizado: r.autorizado, monto: Number(r.monto || 0) };
    }
  }
  return { autorizado: false, monto: 0 };
}

// Calcula la semana_pago en formato "YYYY-Www" (ISO)

// SC foráneos: helper en small van bloqueado por defecto (no se paga)

// Auxiliar que MELI nos paga por ruta con helper (al chofer le pagamos 300)

// Matriz de ajuste por % visitado × NS (reemplaza a matriz_ns)
// visitado < 90% → no paga | visitado 99.5–100% premia +5% solo si NS > 99.5%
// visitado 90–99.49% castiga -3% solo si NS < 95% | resto neutro

// ─── Motor de cálculo principal ────────────────────────────────────────────
// Toma todos los inputs y devuelve los registros listos para INSERT en
// maestro_jornada_mx

// ─── Componente principal: Vista por RUTA ─────────────────────────────────
function tipoRutaPorVehiculo(vehiculoRaw) {
  // SDD/SPOT se determina por el TIPO DE VEHÍCULO MELI:
  // si el tipo contiene "SDD" (ej. "Large Van MLP SDD") => SDD; si no (ej. "Small Van MLP") => SPOT.
  if (!vehiculoRaw) return null;
  return String(vehiculoRaw).toUpperCase().includes("SDD") ? "SDD" : "SPOT";
}

// Helpers de estilo de la tabla (declarados fuera del componente para no recrear cada render)
const tdStyle = (bold) => ({
  padding: "8px 10px",
  fontWeight: bold ? 600 : 400,
  verticalAlign: "top",
});

const Th = ({ children, onClick, right, center }) => (
  <th onClick={onClick}
    style={{
      padding: "10px 10px",
      textAlign: right ? "right" : center ? "center" : "left",
      fontSize: 10,
      fontWeight: 700,
      color: "#475569",
      cursor: onClick ? "pointer" : "default",
      userSelect: "none",
      background: "#f8fafc",
      whiteSpace: "nowrap",
    }}>
    {children}
  </th>
);

// ═══════════════════════════════════════════════════════════════════════════
// INFORMACIÓN DE RUTA — análisis operacional (lee de maestro_jornada_mx)
// ═══════════════════════════════════════════════════════════════════════════

// Componente para mostrar el detalle expandido (raw_json del último snapshot + timeline)

// ═══════════════════════════════════════════════════════════════════════════
// DRIVERS MAESTRO MX — con carga masiva Excel
// ═══════════════════════════════════════════════════════════════════════════
function DriversMaestroMX() {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [showCarga, setShowCarga] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("drivers_mx")
        .select("*")
        .order("nombre_completo");
      setDrivers(data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Procesar archivo Excel subido
  const handleFile = async (file) => {
    if (!file) return;
    setUploadResult(null);
    setPreviewData(null);
    
    try {
      const data = await file.arrayBuffer();
      const wb = window.XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // Saltamos las primeras 2 filas (header + REQ/OPT)
      const json = window.XLSX.utils.sheet_to_json(ws, { range: 1, defval: null });
      
      // Filtrar filas vacías y la fila REQ/OPT
      const filas = json.filter(r => 
        r.driver_id && 
        String(r.driver_id).toUpperCase() !== "REQ" && 
        String(r.driver_id).toUpperCase() !== "OPT"
      );
      
      // Validar campos obligatorios
      const errores = [];
      const validas = [];
      filas.forEach((r, i) => {
        const fila = i + 3; // fila real en Excel (saltamos 2 + base 1)
        if (!r.driver_id || isNaN(parseInt(r.driver_id))) {
          errores.push(`Fila ${fila}: driver_id inválido o vacío`);
          return;
        }
        if (!r.nombre_completo || String(r.nombre_completo).trim() === "") {
          errores.push(`Fila ${fila}: nombre_completo vacío`);
          return;
        }
        // Limpiar fila
        const limpia = {};
        Object.keys(r).forEach(k => {
          const v = r[k];
          if (v !== null && v !== undefined && String(v).trim() !== "") {
            // Convertir fecha de Excel a YYYY-MM-DD
            if (k === "fecha_alta" && v instanceof Date) {
              limpia[k] = v.toISOString().slice(0, 10);
            } else {
              limpia[k] = typeof v === "string" ? v.trim() : v;
            }
          }
        });
        limpia.driver_id = parseInt(limpia.driver_id);
        validas.push(limpia);
      });
      
      setPreviewData({ validas, errores, total: filas.length });
    } catch (e) {
      console.error(e);
      setUploadResult({ ok: false, msg: "Error leyendo Excel: " + e.message });
    }
  };

  // Confirmar carga (upsert por driver_id)
  const confirmarCarga = async () => {
    if (!previewData || previewData.validas.length === 0) return;
    setUploading(true);
    try {
      // Upsert por driver_id
      const { error, count } = await sb.from("drivers_mx")
        .upsert(previewData.validas, { onConflict: "driver_id", count: "exact" });
      if (error) throw error;
      
      setUploadResult({ ok: true, msg: `${previewData.validas.length} drivers cargados/actualizados` });
      setPreviewData(null);
      setShowCarga(false);
      cargar();
    } catch (e) {
      setUploadResult({ ok: false, msg: "Error: " + e.message });
    }
    setUploading(false);
  };

  // Descargar template
  const descargarTemplate = () => {
    const headers = [
      "driver_id", "nombre_completo", "rfc", "curp", "placa_principal",
      "vehiculo_tipo", "service_center_principal", "zona", "tipo_contrato",
      "metodo_pago", "banco", "clabe", "email", "telefono",
      "fecha_alta", "estado", "observaciones"
    ];
    const reqRow = ["REQ", "REQ", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT", "OPT"];
    const ej1 = [3828508, "Jose Julian Rivera", "", "", "SDD-TJ8576H", "Large Van", "SCY1", "L3", "Subcontratista", "Transferencia", "BBVA", "", "", "", "2025-01-15", "Activo", ""];
    const ej2 = [3797281, "Said Alberto Astorga", "", "", "SDD-TJ5417H", "Large Van", "SCY1", "L3", "Subcontratista", "Transferencia", "Banamex", "", "", "", "", "Activo", "Driver Platino"];
    
    const ws = window.XLSX.utils.aoa_to_sheet([headers, reqRow, ej1, ej2]);
    ws["!cols"] = headers.map(h => ({ wch: h.length + 6 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Drivers MX");
    window.XLSX.writeFile(wb, "Plantilla_Drivers_MX.xlsx");
  };

  const filtrados = useMemo(() => {
    return drivers.filter(d => {
      if (filtroEstado !== "todos" && d.estado !== filtroEstado) return false;
      if (!busqueda) return true;
      const b = busqueda.toLowerCase();
      return (
        (d.nombre_completo || "").toLowerCase().includes(b) ||
        String(d.driver_id || "").includes(b) ||
        (d.rfc || "").toLowerCase().includes(b) ||
        (d.placa_principal || "").toLowerCase().includes(b) ||
        (d.service_center_principal || "").toLowerCase().includes(b)
      );
    });
  }, [drivers, busqueda, filtroEstado]);

  const conteoPorEstado = drivers.reduce((acc, d) => {
    acc[d.estado] = (acc[d.estado] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="pg" style={{ maxWidth: 1200 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Drivers MX</div>
          <div className="sec-sub">Maestro de choferes Mercado Libre · {drivers.length} registros</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={descargarTemplate}
            style={{ padding: "8px 14px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer" }}>
            Descargar plantilla
          </button>
          <button onClick={() => setShowCarga(s => !s)}
            style={{ padding: "8px 14px", background: "#002E5D", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer" }}>
            {showCarga ? "Cerrar" : "Subir Excel"}
          </button>
        </div>
      </div>

      {/* Carga Excel */}
      {showCarga && (
        <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 6, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#002E5D", marginBottom: 8 }}>Carga Masiva desde Excel</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
            Subí el Excel con los drivers. Si un driver_id ya existe, se actualiza (no se duplica).
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => handleFile(e.target.files[0])}
            style={{ fontSize: 12 }}
          />
          
          {uploadResult && (
            <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 4, background: uploadResult.ok ? "#dcfce7" : "#fee2e2", color: uploadResult.ok ? "#166534" : "#991b1b", fontSize: 12, fontWeight: 600 }}>
              {uploadResult.msg}
            </div>
          )}
          
          {previewData && (
            <div style={{ marginTop: 14, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#002E5D" }}>Preview</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {previewData.validas.length} válidas · {previewData.errores.length} con error · {previewData.total} totales
                  </div>
                </div>
                <button onClick={confirmarCarga}
                  disabled={uploading || previewData.validas.length === 0}
                  style={{ padding: "8px 16px", background: "#16a34a", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, color: "#fff", cursor: uploading ? "wait" : "pointer", opacity: uploading || previewData.validas.length === 0 ? 0.5 : 1 }}>
                  {uploading ? "Cargando..." : `Cargar ${previewData.validas.length} drivers`}
                </button>
              </div>
              
              {previewData.errores.length > 0 && (
                <div style={{ background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 4, padding: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#991b1b", marginBottom: 4 }}>Errores:</div>
                  {previewData.errores.slice(0, 5).map((e, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#991b1b" }}>• {e}</div>
                  ))}
                  {previewData.errores.length > 5 && <div style={{ fontSize: 11, color: "#991b1b" }}>... y {previewData.errores.length - 5} más</div>}
                </div>
              )}
              
              {previewData.validas.slice(0, 5).map((d, i) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0", fontSize: 11 }}>
                  <span style={{ fontWeight: 600 }}>{d.nombre_completo}</span>
                  <span style={{ color: "#64748b" }}> · ID: {d.driver_id} · {d.placa_principal || "—"} · {d.service_center_principal || "—"}</span>
                </div>
              ))}
              {previewData.validas.length > 5 && (
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>... y {previewData.validas.length - 5} más</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input type="text" placeholder="Buscar por nombre, ID, RFC, placa..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
          style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "7px 10px", fontSize: 12, flex: 1, minWidth: 240 }} />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "7px 10px", fontSize: 12, fontWeight: 600 }}>
          <option value="todos">Todos los estados ({drivers.length})</option>
          <option value="Activo">Activos ({conteoPorEstado.Activo || 0})</option>
          <option value="Inactivo">Inactivos ({conteoPorEstado.Inactivo || 0})</option>
          <option value="Vacaciones">Vacaciones ({conteoPorEstado.Vacaciones || 0})</option>
          <option value="Suspendido">Suspendidos ({conteoPorEstado.Suspendido || 0})</option>
        </select>
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Cargando...</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: "#475569" }}>Sin drivers cargados</div>
            <div style={{ fontSize: 11 }}>Descarga la plantilla, llénala y súbela con "Subir Excel"</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>ID ML</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>Nombre</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>Placa</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>Vehículo</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>SC</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>Zona</th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#475569" }}>Contrato</th>
                <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#475569" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(d => (
                <tr key={d.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#64748b" }}>{d.driver_id}</td>
                  <td style={{ padding: "10px 14px", fontWeight: 500 }}>{d.nombre_completo}</td>
                  <td style={{ padding: "10px 14px" }}>{d.placa_principal || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "#64748b" }}>{d.vehiculo_tipo || "—"}</td>
                  <td style={{ padding: "10px 14px" }}>{d.service_center_principal || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "#64748b" }}>{d.zona || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "#64748b" }}>{d.tipo_contrato || "—"}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                      background: d.estado === "Activo" ? "#dcfce7" : d.estado === "Inactivo" ? "#fee2e2" : "#fef3c7",
                      color: d.estado === "Activo" ? "#166534" : d.estado === "Inactivo" ? "#991b1b" : "#854d0e"
                    }}>
                      {d.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// AYUDANTES — DETALLE DEL DÍA con tickets, hora exacta y descarga Excel
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ REEMPLAZAR con la URL real del webhook n8n (workflow "Helpers MX · RERUN webhook")

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE PAGOS — sub-tabs
// ═══════════════════════════════════════════════════════════════════════════

// ─── Config: Tarifario por Pagar (editable, tabla viva matriz_precios) ──────

// ─── Config: Tarifas por Cobrar a MELI (editable) ──────────────────────────

// ─── Config: Tarifario Base ────────────────────────────────────────────────
function ConfigTarifario() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { cargar(); }, []);
  const cargar = async () => {
    setLoading(true);
    try {
      const { data: d } = await sb.from("tarifario_mx").select("*").order("zona").order("tipologia").order("tramo_km");
      setData(d || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  if (loading) return <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Cargando...</div>;

  const zonas = ["L1", "L2", "L3", "L4"];
  const tipologias = ["Large Van", "Small Van", "Car"];
  const tramos = ["0-100", "101-150", "151-200", "201-250", "251+"];

  return (
    <div>
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#002E5D", marginBottom: 4 }}>Tarifario Base MELI MX</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{data.length} tarifas · 4 zonas × 3 tipologías × 5 tramos · MXN</div>
      </div>
      {zonas.map(z => (
        <div key={z} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>Zona {z}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e4e7ec" }}>
                <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, color: "#64748b", fontWeight: 600 }}>Tipología</th>
                {tramos.map(t => <th key={t} style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>{t} km</th>)}
              </tr>
            </thead>
            <tbody>
              {tipologias.map(tipo => {
                const filas = data.filter(d => d.zona === z && d.tipologia === tipo);
                if (filas.length === 0) return null;
                return (
                  <tr key={tipo} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>{tipo}</td>
                    {tramos.map(tr => {
                      const f = filas.find(x => x.tramo_km === tr);
                      return (
                        <td key={tr} style={{ padding: "6px 10px", textAlign: "right", color: f ? "#1f2937" : "#cbd5e1" }}>
                          {f ? `$${f.monto.toLocaleString("es-MX")}` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── Config: Tarifas Especiales ────────────────────────────────────────────

// ─── Config: Mapeo SC ↔ Zonas (CRUD + detector de huérfanos) ───────────────

// ─── Config: Matriz Auxiliares ─────────────────────────────────────────────

// ─── Config: Reglas NS ─────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// INDICADORES OPERACIONALES MX — Pool Mercado Libre
// ═══════════════════════════════════════════════════════════════════════════

// SheetJS lazy-load para descarga Excel

// Helper para nombres de meses en español
const NOMBRES_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
                     "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function diasDelMes(anio, mes) {
  return new Date(anio, mes, 0).getDate();
}

// Calcula el rango {desde, hasta} de un mes seleccionado.
// Regla: si el mes ya terminó → mes completo. Si es el actual → hasta ayer (CURRENT_DATE - 1).
function rangoMesGlobal(mesGlobal) {
  const yyyy = mesGlobal.anio;
  const mm = String(mesGlobal.mes).padStart(2, '0');
  const desde = `${yyyy}-${mm}-01`;
  
  const hoy = new Date();
  const esMesActual = mesGlobal.anio === hoy.getFullYear() && mesGlobal.mes === (hoy.getMonth() + 1);
  
  let hasta;
  if (esMesActual) {
    // Mes en curso: hasta ayer
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);
    hasta = ayer.toISOString().slice(0, 10);
  } else {
    // Mes pasado: mes completo
    const ultDia = diasDelMes(mesGlobal.anio, mesGlobal.mes);
    hasta = `${yyyy}-${mm}-${String(ultDia).padStart(2, '0')}`;
  }
  return { desde, hasta };
}

// ════════════════════════════════════════════════════════════════════════════
// TORRE CONTROL ROSTERING HOY · Pool MELI MX
// Sub-tab dentro de IndicadoresOperacionalesMX
//
// Lee de:
//  - get_torre_rostering_hoy_resumen() · RPC con totales + por_sc + duplicados
//  - vw_torre_rostering_hoy · listado detallado por travel
//  - vw_torre_rostering_duplicados · drivers/placas repetidos
//
// Lógica visual:
//  - Sección crítica SDD al inicio (siempre visible si hay SDD)
//  - KPIs en franja
//  - Lista de SCs ordenadas por urgencia (vencido + en riesgo)
//  - Cada SC: alertas de duplicados arriba + tabla de rutas
//  - Cronómetro en vivo hacia lockDate (se actualiza cada minuto)
//  - Botón refrescar manual + auto-refresh cada 5 min
// ════════════════════════════════════════════════════════════════════════════

// ─── Componentes auxiliares ─────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// CONTROL HELPER · Subpestaña dentro de IndicadoresOperacionalesMX
// Estructura visual: HTML Control_Helpers_Mexico_8.html
// Colores + fuente: Brain (Geist · #002E5D · #FF6600 · #f0f2f5)
// Datos: vw_control_helper_diario (Supabase)
// ════════════════════════════════════════════════════════════════════════════

// Paleta Brain

const CH_BORDER = "#e4e7ec";

// Tonos de gravedad (manteniendo lógica HTML pero con colores más coherentes Brain)

const CH_GRAY = "#9ca3af";

// ════════════════════════════════════════════════════════════════════════════
// PANEL U0 · RESUMEN EJECUTIVO
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// PANEL U1 · NO AUTORIZADAS (mapa SC × vehículo)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// PANEL U2 · CERTIFICACIÓN
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// PANEL U3 · PROCESO
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// DRILL-DOWNS
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// AUXILIARES
// ════════════════════════════════════════════════════════════════════════════

// Cells

function TdNa({ children }) {
  return <td style={{ padding: '9px 10px', border: `0.5px solid ${CH_BORDER}`, textAlign: 'center', background: '#f8fafc', color: '#d1d5db', fontSize: 11 }}>{children}</td>;
}

// ── Helper: expandir filas disparadoras a tripulación completa de las rutas ──
// ⭐ v9: cuando hacés click en una celda del heatmap, querés ver no solo a las
// personas que cumplen el filtro, sino a TODA la tripulación de esas rutas
// (driver + helpers), marcando cuáles fueron las disparadoras.

// ── Componente: fila de drilldown con resaltado de disparadora ──
// ⭐ v9.2: con rowSpan en Driver/Ruta/SC, el border-left no se ve bien.
// El resaltado se hace con fondo + indicador ⭐ en la celda Persona (ver NombreHelper)

// ── Componente: celda Driver (chofer) con nombre + user_id ──

// ── Componente: nombre limpio del Maestro + raw debajo si difiere ──

// ── Componente: pills inline con alertas del Maestro Supervisores ──

// ── Componente: celda Match Padrón MELI (independiente) ──

// ── Componente: celda Match BBDD BT (independiente) ──

// ── Componente: celda % Helper con color según severidad ──

// ════════════════════════════════════════════════════════════════════════════
// VALIDACIÓN BT · Subpestaña dentro de IndicadoresOperacionalesMX
// ════════════════════════════════════════════════════════════════════════════

const VBT_YELLOW = "#fef3c7";

// Modal Multi-Driver_ID: muestra personas BT con más de un driver_id activo en MELI.
// Incluye sección secundaria con personas multi-ID que NO están en BT (huérfanos).

// ════════════════════════════════════════════════════════════════════════════
// AUDITORÍA PADRÓN MELI · Subpestaña dentro de IndicadoresOperacionalesMX
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// AUDITORÍA PADRÓN MELI · v2 · lee de meli_drivers_master
// El padrón se actualiza solo · cron diario 08:00 MX (14:00 UTC)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// PADRÓN MELI · Administración
// Conductores y vehículos · data completa, altas/bajas diarias, placas SDD
// repetidas y cambios por día. Fuente: meli_drivers_master / meli_vehicles_master
// (snapshot diario 08:00 MX · 14:00 UTC). Diffs vía RPC get_*_padron_diff.
// ════════════════════════════════════════════════════════════════════════════

// CSV genérico

// ── Helper de etiqueta de infracción para el padrón de conductores ──────────
// Rol del conductor (desde is_only_helper del detalle MELI)

// ── DATA COMPLETA · Conductores (cruza master del día con meli_drivers_detalle)

// ── SUB-MUNDO CURSOS · lee vw_cursos_actividad ──────────────────────────────

// ── SUB-MUNDO RECHAZADOS · carga Excel -> Supabase -> vw_rechazados_actividad ─

// ── SUB-MUNDO LIMPIEZA · embudo de actividad (vw_padron_embudo) + alertas ────

// Tabla genérica para resultados de diff (altas / bajas / cambios)

function TablaAltasBajas({ data, tipo, formatCarrier }) {
  const exportar = () => {
    const headers = ['Driver ID', 'Nombre', 'CURP', 'Status', 'Carrier'];
    const rows = data.map(d => [d.driver_id, d.nombre || '', d.document_value || '', d.status || '', formatCarrier(d.carrier_id)]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `padron_${tipo}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (data.length === 0) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
      Sin {tipo === 'alta' ? 'altas' : 'bajas'} entre las fechas seleccionadas
    </div>
  );

  return (
    <>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #e4e7ec', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
        <div style={{ fontSize: 11, color: '#64748b' }}>{data.length} {tipo === 'alta' ? 'altas' : 'bajas'}</div>
        <button onClick={exportar} style={{
          fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
          border: 'none', background: '#002E5D', color: '#fff', cursor: 'pointer',
          fontFamily: "'Open Sans', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <i className="ti ti-download" style={{ fontSize: 12 }} />Exportar CSV
        </button>
      </div>
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc' }}>
            <tr>
              <ApTh>Driver ID</ApTh><ApTh>Nombre</ApTh><ApTh>CURP</ApTh>
              <ApTh>Status</ApTh><ApTh>Carrier</ApTh>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} style={{ borderBottom: '0.5px solid #f4f5f7' }}>
                <ApTd mono>{d.driver_id}</ApTd>
                <ApTd bold>{d.nombre || '—'}</ApTd>
                <ApTd mono small>{d.document_value || '—'}</ApTd>
                <ApTd>
                  <span style={{
                    background: d.status === 'active' ? '#d1fae5' : '#fef3c7',
                    color: d.status === 'active' ? '#065f46' : '#92400e',
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                  }}>{d.status || '—'}</span>
                </ApTd>
                <ApTd mono small>{formatCarrier(d.carrier_id)}</ApTd>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TablaCambiosCarrier({ data, formatCarrier }) {
  const exportar = () => {
    const headers = ['Driver ID', 'Nombre', 'CURP', 'Carrier anterior', 'Carrier nuevo', 'Status'];
    const rows = data.map(d => [d.driver_id, d.nombre || '', d.curp || '', formatCarrier(d.carrier_anterior), formatCarrier(d.carrier_actual), d.status]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `padron_cambios_carrier_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (data.length === 0) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
      Sin cambios de carrier entre las fechas seleccionadas
    </div>
  );

  return (
    <>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #e4e7ec', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
        <div style={{ fontSize: 11, color: '#64748b' }}>{data.length} cambios de carrier</div>
        <button onClick={exportar} style={{
          fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 6,
          border: 'none', background: '#002E5D', color: '#fff', cursor: 'pointer',
          fontFamily: "'Open Sans', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <i className="ti ti-download" style={{ fontSize: 12 }} />Exportar CSV
        </button>
      </div>
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8fafc' }}>
            <tr>
              <ApTh>Driver ID</ApTh><ApTh>Nombre</ApTh><ApTh>CURP</ApTh>
              <ApTh>Carrier anterior</ApTh><ApTh>→</ApTh><ApTh>Carrier nuevo</ApTh>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i} style={{ borderBottom: '0.5px solid #f4f5f7' }}>
                <ApTd mono>{d.driver_id}</ApTd>
                <ApTd bold>{d.nombre || '—'}</ApTd>
                <ApTd mono small>{d.curp || '—'}</ApTd>
                <ApTd mono small muted>{formatCarrier(d.carrier_anterior)}</ApTd>
                <ApTd center>→</ApTd>
                <ApTd mono small bold>{formatCarrier(d.carrier_actual)}</ApTd>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ApTh({ children }) {
  return <th style={{ padding: '8px 10px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', textAlign: 'left', borderBottom: '1px solid #e4e7ec', whiteSpace: 'nowrap' }}>{children}</th>;
}

function ApTd({ children, bold, muted, mono, center, small }) {
  return <td style={{ padding: '8px 10px', fontSize: small ? 11 : 12, fontFamily: mono ? 'monospace' : "'Open Sans', sans-serif", color: muted ? '#64748b' : '#1a1a1a', fontWeight: bold ? 600 : 'normal', textAlign: center ? 'center' : 'left' }}>{children}</td>;
}

// ── MODAL ──────────────────────────────────────────────────────────────────

// ── HELPERS visuales ───────────────────────────────────────────────────────

function PerfilBadgeMX({ perfil }) {
  const styles = {
    IDEAL:         { bg: "#ecfdf5", color: "#047857", label: "IDEAL" },
    INCONSISTENTE: { bg: "#fef3c7", color: "#92400e", label: "INCONSISTENTE" },
    PROBLEMATICO:  { bg: "#fee2e2", color: "#991b1b", label: "PROBLEMÁTICO" },
    RIGUROSO:      { bg: "#dbeafe", color: "#1e40af", label: "RIGUROSO" },
    sin_datos:     { bg: "#f1f5f9", color: "#64748b", label: "S/D" },
  };
  const s = styles[perfil] || styles.sin_datos;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, backgroundColor: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

function ScoreBadgeMX({ cat }) {
  const styles = {
    A: { bg: "#047857", color: "#fff" },
    B: { bg: "#0891b2", color: "#fff" },
    C: { bg: "#ca8a04", color: "#fff" },
    D: { bg: "#b91c1c", color: "#fff" },
  };
  const s = styles[cat] || styles.B;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 4, fontSize: 12, fontWeight: 700, backgroundColor: s.bg, color: s.color }}>
      {cat}
    </span>
  );
}

// ── RESUMEN KPI · Día anterior (D-1) ────────────────────────────────────
function PoolMeliResumenKPI() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Helpers de fecha
  const restarDias = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };
  const formatearISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  
  // ─── Selector de período ───────────────────────────────────────────────
  // modo: 'dia' (un día específico) | 'rango' (período acumulado)
  const [modo, setModo] = useState('dia');
  
  // Estado del día (default: ayer)
  const [fechaSeleccionada, setFechaSeleccionada] = useState(() => formatearISO(restarDias(1)));
  
  // Estado del rango (default: últimos 7 días)
  const [rangoSel, setRangoSel] = useState(() => ({
    desde: formatearISO(restarDias(7)),
    hasta: formatearISO(restarDias(1)),
  }));
  
  // Fechas de referencia para los botones (calculadas una vez al montar)
  const fechasReferencia = useMemo(() => ({
    d1: formatearISO(restarDias(1)),
    d7: formatearISO(restarDias(7)),
    d30: formatearISO(restarDias(30)),
  }), []);
  
  // Display formateado
  const formatearDisplay = (yyyymmdd) => {
    if (!yyyymmdd) return '';
    const [y, m, d] = yyyymmdd.split('-');
    return `${d}-${m}-${y}`;
  };
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const fechaTextoLargo = (yyyymmdd) => {
    if (!yyyymmdd) return '';
    const [y, m, d] = yyyymmdd.split('-').map(Number);
    return `${d} de ${meses[m-1]} de ${y}`;
  };
  
  // Cargar datos según modo
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let rpc, error;
        if (modo === 'dia') {
          ({ data: rpc, error } = await sb.rpc("get_resumen_kpi_dia", { p_fecha: fechaSeleccionada }));
        } else {
          ({ data: rpc, error } = await sb.rpc("get_resumen_kpi_rango", { 
            p_fecha_desde: rangoSel.desde, 
            p_fecha_hasta: rangoSel.hasta 
          }));
        }
        if (!alive) return;
        if (error) throw error;
        setData(rpc);
      } catch (e) {
        if (alive) setError(e.message || "Error cargando datos");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [modo, fechaSeleccionada, rangoSel.desde, rangoSel.hasta]);

  // Modal de detalle drilldown
  const [modal, setModal] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  
  const abrirDetalle = async (tipo, filtros = {}, titulo = "") => {
    setModalLoading(true);
    setModal({ titulo: titulo || `Cargando...`, filas: [], tipo });
    try {
      let filas, err;
      if (modo === 'dia') {
        ({ data: filas, error: err } = await sb.rpc("get_kpi_detalle", {
          p_fecha: fechaSeleccionada,
          p_tipo: tipo,
          p_filtro_sc: filtros.sc || null,
          p_filtro_fleet: filtros.fleet || null,
          p_filtro_tipo_ruta: filtros.tipo_ruta || null,
          p_filtro_caracteristica: filtros.caracteristica || null,
          p_filtro_pnr_estado: filtros.pnr_estado || null,
        }));
      } else {
        ({ data: filas, error: err } = await sb.rpc("get_kpi_detalle_rango", {
          p_fecha_desde: rangoSel.desde,
          p_fecha_hasta: rangoSel.hasta,
          p_tipo: tipo,
          p_filtro_sc: filtros.sc || null,
          p_filtro_fleet: filtros.fleet || null,
          p_filtro_tipo_ruta: filtros.tipo_ruta || null,
          p_filtro_caracteristica: filtros.caracteristica || null,
          p_filtro_pnr_estado: filtros.pnr_estado || null,
        }));
      }
      if (err) throw err;
      const arr = Array.isArray(filas) ? filas : [];
      const sufijoArchivo = modo === 'dia' ? fechaSeleccionada : `${rangoSel.desde}_a_${rangoSel.hasta}`;
      setModal({ 
        titulo: `${titulo} (${arr.length})`, 
        filas: arr, 
        tipo,
        nombreArchivo: `kpi_${tipo}_${sufijoArchivo}${filtros.sc ? '_' + filtros.sc : ''}${filtros.fleet ? '_' + filtros.fleet : ''}`
      });
    } catch (e) {
      setModal({ titulo: "Error", filas: [{ error: e.message }], tipo });
    } finally {
      setModalLoading(false);
    }
  };

  // Drilldown del Embudo de Aceptación
  const abrirDetalleEmbudo = async (status, filtros = {}, titulo = "") => {
    setModalLoading(true);
    setModal({ titulo: titulo || `Cargando...`, filas: [], tipo: 'embudo' });
    try {
      let filas, err;
      if (modo === 'dia') {
        ({ data: filas, error: err } = await sb.rpc("get_embudo_detalle_dia", {
          p_fecha: fechaSeleccionada,
          p_status: status || null,
          p_sc: filtros.sc || null,
          p_es_sdd: typeof filtros.es_sdd === 'boolean' ? filtros.es_sdd : null,
          p_tipo_flota: filtros.tipo_flota || null,
        }));
      } else {
        ({ data: filas, error: err } = await sb.rpc("get_embudo_detalle_rango", {
          p_fecha_desde: rangoSel.desde,
          p_fecha_hasta: rangoSel.hasta,
          p_status: status || null,
          p_sc: filtros.sc || null,
          p_es_sdd: typeof filtros.es_sdd === 'boolean' ? filtros.es_sdd : null,
          p_tipo_flota: filtros.tipo_flota || null,
        }));
      }
      if (err) throw err;
      const arr = Array.isArray(filas) ? filas : [];
      const sufijoArchivo = modo === 'dia' ? fechaSeleccionada : `${rangoSel.desde}_a_${rangoSel.hasta}`;
      setModal({ 
        titulo: `${titulo} (${arr.length})`, 
        filas: arr, 
        tipo: 'embudo',
        nombreArchivo: `embudo_${status || 'todos'}_${sufijoArchivo}${filtros.sc ? '_' + filtros.sc : ''}`
      });
    } catch (e) {
      setModal({ titulo: "Error", filas: [{ error: e.message }], tipo: 'embudo' });
    } finally {
      setModalLoading(false);
    }
  };

  // Helper: tooltip "i" inline
  const TooltipInfo = ({ texto }) => (
    <span 
      title={texto}
      style={{ 
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, borderRadius: '50%', 
        background: '#cbd5e1', color: '#475569', 
        fontSize: 9, fontWeight: 700, marginLeft: 6, cursor: 'help',
        verticalAlign: 'middle'
      }}>
      i
    </span>
  );

  // Helper: top 3 SCs por métrica
  const top3SCs = (porSc, campo, orden = 'desc') => {
    if (!Array.isArray(porSc) || porSc.length === 0) return { peores: [], mejores: [] };
    const conValor = porSc.filter(s => s[campo] !== null && s[campo] !== undefined);
    const sorted = [...conValor].sort((a, b) => orden === 'desc' ? b[campo] - a[campo] : a[campo] - b[campo]);
    return {
      peores: sorted.slice(0, 3),
      mejores: sorted.slice(-3).reverse()
    };
  };
  
  
  if (loading) return <div className="pg" style={{ textAlign: "center", padding: 60, color: "#888" }}>Cargando resumen...</div>;
  if (error) return <div className="pg" style={{ padding: 40, color: "#c0392b" }}>Error: {error}</div>;
  if (!data) return <div className="pg" style={{ padding: 40, color: "#888" }}>Sin datos</div>;
  
  const cp = data.cumplimiento_promesa || {};
  const cno = data.capacidad_no_operable || { total: 0, walker: 0, crowd: 0, moto: 0, detalle: [] };
  const dtv = data.delta_tr_vs_panel || { tr_aceptadas: 0, logistic_operables: 0, delta: 0, detalle_tr_por_sc: [] };
  const rsm = data.reporte_sdd_meli || { tiene_reporte: false, totales: null, por_sc: [], no_ejecutadas_detalle: [] };
  const ccon = data.cumplimiento_contractual || { sdd_solicitadas: 0, sdd_ejecutadas: 0, sdd_no_cumplidas: 0, sdd_pct: 0, var_solicitadas: 0, var_ejecutadas: 0, var_no_cumplidas: 0, var_pct: 0, total_solicitadas: 0, total_ejecutadas: 0, total_no_cumplidas: 0, pct_total: 0, usa_reporte_oficial_sdd: false };
  const ns = data.nivel_servicio || {};
  const nv = data.nivel_visitados || {};
  const pnr = data.pnr || {};
  const ea = data.embudo_aceptacion || {};
  const eaT = ea.totales || {};
  
  const cumple = (pct, umbral) => Number(pct) >= Number(umbral);
  const colorPct = (pct, umbral) => cumple(pct, umbral) ? "#16a34a" : "#dc2626";
  const colorBg = (pct, umbral) => cumple(pct, umbral) ? "#f0fdf4" : "#fef2f2";
  
  // Texto principal del header según modo
  const tituloModo = modo === 'dia' ? 'Resumen del día' : 'Resumen del período';
  const fechaTexto = modo === 'dia' 
    ? fechaTextoLargo(fechaSeleccionada)
    : `${fechaTextoLargo(rangoSel.desde)} → ${fechaTextoLargo(rangoSel.hasta)}`;
  const fechaCorta = modo === 'dia'
    ? formatearDisplay(fechaSeleccionada)
    : `${formatearDisplay(rangoSel.desde)} → ${formatearDisplay(rangoSel.hasta)}`;
  
  // Cantidad de días del rango (cálculo simple, sin useMemo para evitar el error de hooks)
  let diasRango = 1;
  if (modo === 'rango') {
    const d1 = new Date(rangoSel.desde);
    const d2 = new Date(rangoSel.hasta);
    diasRango = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
  }
  
  // Detectar botón activo (día)
  const botonDiaActivo = fechaSeleccionada === fechasReferencia.d1 ? 'd1'
                     : fechaSeleccionada === fechasReferencia.d7 ? 'd7'
                     : fechaSeleccionada === fechasReferencia.d30 ? 'd30'
                     : 'custom';
  
  // Detectar botón activo (rango)
  const esRango7 = rangoSel.desde === fechasReferencia.d7 && rangoSel.hasta === fechasReferencia.d1;
  const esRango30 = rangoSel.desde === fechasReferencia.d30 && rangoSel.hasta === fechasReferencia.d1;
  const botonRangoActivo = esRango7 ? '7d' : esRango30 ? '30d' : 'custom';
  
  const estiloBoton = (activo) => ({
    padding: "8px 14px",
    background: activo ? "#fff" : "transparent",
    color: activo ? "#002E5D" : "#fff",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
  });
  
  const estiloToggle = (activo) => ({
    padding: "6px 14px",
    background: activo ? "#fff" : "rgba(255,255,255,0.1)",
    color: activo ? "#002E5D" : "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
  });
  
  return (
    <div className="pg">
      {/* Header con selector de fecha */}
      <div style={{
        background: "linear-gradient(135deg, #002E5D 0%, #2d4f8e 100%)",
        borderRadius: 12, padding: "16px 20px", marginBottom: 20,
        color: "#fff"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "#aac3e8", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
              {tituloModo}
              {modo === 'rango' && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {diasRango} días</span>}
            </div>
            <div style={{ fontSize: modo === 'rango' ? 16 : 22, fontWeight: 700, marginTop: 2 }}>{fechaTexto}</div>
          </div>
          <div style={{ fontSize: 12, color: "#aac3e8" }}>
            {fechaCorta}
          </div>
        </div>
        
        {/* Toggle Día / Rango */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 10, background: "rgba(0,0,0,0.15)", padding: 4, borderRadius: 8, width: "fit-content" }}>
          <button onClick={() => setModo('dia')} style={estiloToggle(modo === 'dia')}>
            📅 Día exacto
          </button>
          <button onClick={() => setModo('rango')} style={estiloToggle(modo === 'rango')}>
            📊 Rango acumulado
          </button>
        </div>
        
        {/* Botones contextuales según modo */}
        {modo === 'dia' ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setFechaSeleccionada(fechasReferencia.d1)}
                    style={estiloBoton(botonDiaActivo === 'd1')}>
              Ayer (D-1)
            </button>
            <button onClick={() => setFechaSeleccionada(fechasReferencia.d7)}
                    style={estiloBoton(botonDiaActivo === 'd7')}>
              D-7
            </button>
            <button onClick={() => setFechaSeleccionada(fechasReferencia.d30)}
                    style={estiloBoton(botonDiaActivo === 'd30')}>
              D-30
            </button>
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.3)", margin: "0 4px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#aac3e8", fontWeight: 600 }}>📅 Día específico:</span>
              <input type="date"
                     value={fechaSeleccionada}
                     max={fechasReferencia.d1}
                     onChange={(e) => e.target.value && setFechaSeleccionada(e.target.value)}
                     style={{
                       padding: "7px 10px",
                       background: botonDiaActivo === 'custom' ? "#fff" : "rgba(255,255,255,0.15)",
                       color: botonDiaActivo === 'custom' ? "#002E5D" : "#fff",
                       border: "1px solid rgba(255,255,255,0.3)",
                       borderRadius: 6,
                       fontSize: 12,
                       fontWeight: 600,
                       cursor: "pointer",
                       fontFamily: "'Open Sans', sans-serif",
                       colorScheme: botonDiaActivo === 'custom' ? "light" : "dark",
                     }} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setRangoSel({ desde: fechasReferencia.d7, hasta: fechasReferencia.d1 })}
                    style={estiloBoton(botonRangoActivo === '7d')}>
              Últimos 7 días
            </button>
            <button onClick={() => setRangoSel({ desde: fechasReferencia.d30, hasta: fechasReferencia.d1 })}
                    style={estiloBoton(botonRangoActivo === '30d')}>
              Últimos 30 días
            </button>
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.3)", margin: "0 4px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "#aac3e8", fontWeight: 600 }}>📅 Rango personalizado:</span>
              <input type="date"
                     value={rangoSel.desde}
                     max={rangoSel.hasta}
                     onChange={(e) => e.target.value && setRangoSel(r => ({ ...r, desde: e.target.value }))}
                     style={{
                       padding: "7px 10px",
                       background: botonRangoActivo === 'custom' ? "#fff" : "rgba(255,255,255,0.15)",
                       color: botonRangoActivo === 'custom' ? "#002E5D" : "#fff",
                       border: "1px solid rgba(255,255,255,0.3)",
                       borderRadius: 6,
                       fontSize: 12,
                       fontWeight: 600,
                       cursor: "pointer",
                       fontFamily: "'Open Sans', sans-serif",
                       colorScheme: botonRangoActivo === 'custom' ? "light" : "dark",
                     }} />
              <span style={{ fontSize: 12, color: "#aac3e8" }}>→</span>
              <input type="date"
                     value={rangoSel.hasta}
                     min={rangoSel.desde}
                     max={fechasReferencia.d1}
                     onChange={(e) => e.target.value && setRangoSel(r => ({ ...r, hasta: e.target.value }))}
                     style={{
                       padding: "7px 10px",
                       background: botonRangoActivo === 'custom' ? "#fff" : "rgba(255,255,255,0.15)",
                       color: botonRangoActivo === 'custom' ? "#002E5D" : "#fff",
                       border: "1px solid rgba(255,255,255,0.3)",
                       borderRadius: 6,
                       fontSize: 12,
                       fontWeight: 600,
                       cursor: "pointer",
                       fontFamily: "'Open Sans', sans-serif",
                       colorScheme: botonRangoActivo === 'custom' ? "light" : "dark",
                     }} />
            </div>
          </div>
        )}
      </div>

      {/* BLOQUE 1: CUMPLIMIENTO DE PROMESA (Operativo + Contractual) */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, border: "1px solid #e4e7ec" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>Cumplimiento de Promesa</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Dos visiones complementarias del cumplimiento</div>
          </div>
        </div>

        {/* CABECERA DUAL: Operativo vs Contractual */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {/* OPERATIVO (Brain) */}
          <div style={{ background: "#f0fdf4", borderRadius: 10, padding: 14, border: "1px solid #bbf7d0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", textTransform: "uppercase", letterSpacing: 0.5 }}>Operativo (Brain)</div>
                <div style={{ fontSize: 10, color: "#166534", opacity: 0.7, marginTop: 2 }}>Lo que efectivamente operamos</div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: cp.pct_cumplimiento >= 95 ? "#16a34a" : cp.pct_cumplimiento >= 85 ? "#f59e0b" : "#dc2626" }}>
                {cp.pct_cumplimiento || 0}%
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#166534" }}>
              <strong>{cp.ejecutadas || 0}</strong> ejecutadas / <strong>{cp.aceptadas || 0}</strong> prometidas
            </div>
            <div style={{ fontSize: 10, color: "#166534", opacity: 0.7, marginTop: 4, fontStyle: "italic" }}>
              Fuente: Logistic Monitoring + Maestro Jornada
            </div>
          </div>

          {/* CONTRACTUAL (MELI) */}
          {ccon.total_solicitadas > 0 && (
            <div style={{ background: "#fef3c7", borderRadius: 10, padding: 14, border: "1px solid #fcd34d" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: 0.5 }}>Contractual (MELI)</div>
                  <div style={{ fontSize: 10, color: "#854d0e", opacity: 0.7, marginTop: 2 }}>Lo que MELI nos pidió cumplir</div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: ccon.pct_total >= 95 ? "#16a34a" : ccon.pct_total >= 85 ? "#f59e0b" : "#dc2626" }}>
                  {ccon.pct_total || 0}%
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#854d0e" }}>
                <strong>{ccon.total_ejecutadas || 0}</strong> ejecutadas / <strong>{ccon.total_solicitadas || 0}</strong> solicitadas
              </div>
              <div style={{ fontSize: 10, color: "#854d0e", opacity: 0.7, marginTop: 4, fontStyle: "italic" }}>
                Fuente: {ccon.usa_reporte_oficial_sdd ? "Reporte oficial MELI (SDD)" : "TR (SDD)"} + TR (Variables)
              </div>
            </div>
          )}
        </div>

        {/* Línea principal Operativo: Aceptadas / Ejecutadas / No realizadas */}
        <div style={{ fontSize: 10, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          Detalle operativo
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
          <div onClick={() => abrirDetalle("aceptadas", {}, "Ofertas aceptadas")}
            style={{ background: "#f0f9ff", borderRadius: 8, padding: "12px 14px", cursor: "pointer", transition: "transform 0.1s", border: "1px solid transparent" }}
            onMouseOver={e => { e.currentTarget.style.borderColor = "#1e40af"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; }}>
            <div style={{ fontSize: 10, color: "#1e40af", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>Aceptadas</span><span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#1e40af", marginTop: 2 }}>{cp.aceptadas || 0}</div>
          </div>
          <div onClick={() => abrirDetalle("ejecutadas", {}, "Viajes ejecutados")}
            style={{ background: "#f0fdf4", borderRadius: 8, padding: "12px 14px", cursor: "pointer", border: "1px solid transparent" }}
            onMouseOver={e => { e.currentTarget.style.borderColor = "#166534"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; }}>
            <div style={{ fontSize: 10, color: "#166534", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>Ejecutadas</span><span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#166534", marginTop: 2 }}>{cp.ejecutadas || 0}</div>
          </div>
          <div onClick={() => cp.no_realizadas > 0 && abrirDetalle("no_realizadas", {}, "Aceptadas no realizadas")}
            style={{ 
              background: cp.no_realizadas > 0 ? "#fef2f2" : "#f9fafb", 
              borderRadius: 8, padding: "12px 14px", 
              cursor: cp.no_realizadas > 0 ? "pointer" : "default",
              border: "1px solid transparent"
            }}
            onMouseOver={e => { if (cp.no_realizadas > 0) e.currentTarget.style.borderColor = "#991b1b"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; }}>
            <div style={{ fontSize: 10, color: cp.no_realizadas > 0 ? "#991b1b" : "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>No realizadas</span>
              {cp.no_realizadas > 0 && <span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: cp.no_realizadas > 0 ? "#991b1b" : "#666", marginTop: 2 }}>{cp.no_realizadas || 0}</div>
          </div>
        </div>
        
        {/* Split SDD vs Variable - Operativo */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 14 }}>
          <div onClick={() => abrirDetalle("ejecutadas", { fleet: "SDD" }, "Viajes ejecutados · SDD")}
            style={{ background: "#fff7ed", borderRadius: 8, padding: 14, border: "1px solid #fed7aa", cursor: "pointer" }}>
            <div style={{ fontSize: 11, color: "#9a3412", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
              <span>SDD (Súper Dedicada)</span><span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div><span style={{ color: "#888" }}>Aceptadas:</span> <strong>{cp.sdd?.aceptadas || 0}</strong></div>
              <div><span style={{ color: "#888" }}>Ejecutadas:</span> <strong>{cp.sdd?.ejecutadas || 0}</strong></div>
              <div style={{ color: cp.sdd?.no_realizadas > 0 ? "#991b1b" : "#666" }}>
                <span style={{ color: "#888" }}>No realiz.:</span> <strong>{cp.sdd?.no_realizadas || 0}</strong>
              </div>
            </div>
          </div>
          <div onClick={() => abrirDetalle("ejecutadas", { fleet: "Variable" }, "Viajes ejecutados · Variable")}
            style={{ background: "#eef2ff", borderRadius: 8, padding: 14, border: "1px solid #c7d2fe", cursor: "pointer" }}>
            <div style={{ fontSize: 11, color: "#3730a3", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
              <span>Variable (Flota libre)</span><span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div><span style={{ color: "#888" }}>Aceptadas:</span> <strong>{cp.variable?.aceptadas || 0}</strong></div>
              <div><span style={{ color: "#888" }}>Ejecutadas:</span> <strong>{cp.variable?.ejecutadas || 0}</strong></div>
              <div style={{ color: cp.variable?.no_realizadas > 0 ? "#991b1b" : "#666" }}>
                <span style={{ color: "#888" }}>No realiz.:</span> <strong>{cp.variable?.no_realizadas || 0}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* DETALLE CONTRACTUAL: SDD vs Variable con etiquetas de fuente */}
        {ccon.total_solicitadas > 0 && (
          <>
            <div style={{ fontSize: 10, color: "#854d0e", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginTop: 4 }}>
              Detalle contractual MELI
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {/* SDD Contractual */}
              <div style={{ background: "#fffbeb", borderRadius: 8, padding: 14, border: "1px solid #fde68a", position: "relative" }}>
                <div style={{ position: "absolute", top: 8, right: 10, fontSize: 9, color: ccon.usa_reporte_oficial_sdd ? "#16a34a" : "#9333ea", fontWeight: 700 }}>
                  {ccon.usa_reporte_oficial_sdd ? "✅ VALIDADO" : "⚠️ FALLBACK TR"}
                </div>
                <div style={{ fontSize: 11, color: "#854d0e", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  SDD (Súper Dedicada)
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{ccon.sdd_ejecutadas || 0}</strong>
                    <span style={{ color: "#888" }}> / </span>
                    <strong>{ccon.sdd_solicitadas || 0}</strong>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: ccon.sdd_pct >= 95 ? "#16a34a" : ccon.sdd_pct >= 85 ? "#f59e0b" : "#dc2626" }}>
                    {ccon.sdd_pct || 0}%
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#854d0e" }}>
                  No cumplidas: <strong style={{ color: ccon.sdd_no_cumplidas > 0 ? "#991b1b" : "#16a34a" }}>{ccon.sdd_no_cumplidas || 0}</strong>
                </div>
                <div style={{ fontSize: 9, color: "#a16207", marginTop: 4, fontStyle: "italic" }}>
                  Fuente: {ccon.usa_reporte_oficial_sdd ? "Reporte oficial MELI" : "TR (no hay reporte hoy)"}
                </div>
              </div>

              {/* Variable Contractual */}
              <div style={{ background: "#fffbeb", borderRadius: 8, padding: 14, border: "1px solid #fde68a", position: "relative" }}>
                <div style={{ position: "absolute", top: 8, right: 10, fontSize: 9, color: "#9333ea", fontWeight: 700 }}>
                  ⚠️ EN INVESTIGACIÓN
                </div>
                <div style={{ fontSize: 11, color: "#854d0e", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                  Variable (Flota libre)
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <div style={{ fontSize: 13 }}>
                    <strong>{ccon.var_ejecutadas || 0}</strong>
                    <span style={{ color: "#888" }}> / </span>
                    <strong>{ccon.var_solicitadas || 0}</strong>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: ccon.var_pct >= 95 ? "#16a34a" : ccon.var_pct >= 85 ? "#f59e0b" : "#dc2626" }}>
                    {ccon.var_pct || 0}%
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#854d0e" }}>
                  No cumplidas: <strong style={{ color: ccon.var_no_cumplidas > 0 ? "#991b1b" : "#16a34a" }}>{ccon.var_no_cumplidas || 0}</strong>
                </div>
                <div style={{ fontSize: 9, color: "#a16207", marginTop: 4, fontStyle: "italic" }}>
                  Fuente: TR (no existe reporte oficial Variables · contiene incertidumbre del delta)
                </div>
              </div>
            </div>

            {/* Caja explicativa */}
            <div style={{ marginTop: 12, padding: 10, background: "rgba(254, 243, 199, 0.5)", borderRadius: 6, fontSize: 10, color: "#92400e", lineHeight: 1.5, borderLeft: "3px solid #fcd34d" }}>
              <strong>📌 Sobre las dos visiones:</strong>
              <br />
              • <strong>Operativo</strong>: mide rutas que efectivamente operamos vs las que llegaron al panel Logistic.
              <br />
              • <strong>Contractual</strong>: mide rutas que MELI nos pidió cumplir vs las que efectivamente operamos.
              <br />
              • <strong>SDD</strong> tiene fuente oficial confiable (reporte MELI). <strong>Variables</strong> usa TR mientras se valida el delta de aceptadas vs panel.
            </div>
          </>
        )}
      </div>

      {/* BLOQUE 1.B: CAPACIDAD NO OPERABLE (Walker / Car 8h Crowd / Moto MLP) */}
      {cno.total > 0 && (
        <div style={{ 
          background: "linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)", 
          borderRadius: 12, 
          padding: 16, 
          marginBottom: 16, 
          border: "1px solid #fde68a" 
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#854d0e", display: "flex", alignItems: "center", gap: 6 }}>
                🟡 Capacidad asignada no operable
              </div>
              <div style={{ fontSize: 11, color: "#92400e", marginTop: 4, lineHeight: 1.5 }}>
                Rutas que MELI nos asignó en el panel TMS para modalidades que <strong>no operamos</strong> (Walker, Car 8h Crowd, Moto MLP).
                <br/>
                <span style={{ color: "#a16207" }}>No son leakage: aparecen una sola vez y MELI las rota a otro operador. No afectan el cumplimiento.</span>
              </div>
            </div>
            <div style={{ textAlign: "right", marginLeft: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#854d0e", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {cno.total}
              </div>
              <div style={{ fontSize: 9, color: "#a16207", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>rutas</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
            <div style={{ background: "#fffbeb", borderRadius: 6, padding: "8px 10px", border: "1px solid #fde68a" }}>
              <div style={{ fontSize: 10, color: "#a16207", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>🚗 Car 8h Crowd</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#854d0e", fontVariantNumeric: "tabular-nums" }}>{cno.crowd || 0}</div>
            </div>
            <div style={{ background: "#fffbeb", borderRadius: 6, padding: "8px 10px", border: "1px solid #fde68a" }}>
              <div style={{ fontSize: 10, color: "#a16207", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>🚶 Walker</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#854d0e", fontVariantNumeric: "tabular-nums" }}>{cno.walker || 0}</div>
            </div>
            <div style={{ background: "#fffbeb", borderRadius: 6, padding: "8px 10px", border: "1px solid #fde68a" }}>
              <div style={{ fontSize: 10, color: "#a16207", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>🏍️ Moto MLP</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#854d0e", fontVariantNumeric: "tabular-nums" }}>{cno.moto || 0}</div>
            </div>
          </div>
          {Array.isArray(cno.detalle) && cno.detalle.length > 0 && (() => {
            // Detectar si los datos tienen fecha (modo rango) o no (modo día)
            const tieneFecha = cno.detalle.some(r => r.fecha);
            return (
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 11, color: "#854d0e", cursor: "pointer", fontWeight: 600 }}>
                  Ver detalle por SC ({cno.detalle.length} rutas)
                </summary>
                <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: 8 }}>
                  <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #fde68a", color: "#92400e" }}>
                        {tieneFecha && <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Fecha</th>}
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>SC</th>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>ID Ruta</th>
                        <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Vehículo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cno.detalle.map((r, i) => (
                        <tr key={i} style={{ borderBottom: "1px dashed #fde68a" }}>
                          {tieneFecha && <td style={{ padding: "4px 8px", color: "#475569" }}>{r.fecha}</td>}
                          <td style={{ padding: "4px 8px", fontWeight: 600, color: "#0f172a" }}>{r.sc}</td>
                          <td style={{ padding: "4px 8px", color: "#475569", fontFamily: "monospace" }}>{r.id_ruta}</td>
                          <td style={{ padding: "4px 8px", color: "#475569" }}>{r.vehiculo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })()}
        </div>
      )}

      {/* BLOQUE 1.C: DELTA TR vs PANEL OPERATIVO (a investigar) */}
      {dtv.delta > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          border: "1px solid #d8b4fe"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#6b21a8", display: "flex", alignItems: "center", gap: 6 }}>
                🔬 A investigar: delta de {dtv.delta} ofertas
              </div>
              <div style={{ fontSize: 11, color: "#7e22ce", marginTop: 4, lineHeight: 1.5 }}>
                Travel Requests dice <strong>{dtv.tr_aceptadas} aceptadas</strong>, panel operativo (Logistic Monitoring) dice <strong>{dtv.logistic_operables} rutas</strong>.
                <br/>
                <span style={{ color: "#9333ea" }}>
                  La diferencia es trackeable día a día. Causa por validar con MELI tras observación de patrón en ~2 semanas con captura completa.
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right", marginLeft: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#6b21a8", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {dtv.delta}
              </div>
              <div style={{ fontSize: 9, color: "#9333ea", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>delta</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
            <div style={{ background: "#faf5ff", borderRadius: 6, padding: "8px 10px", border: "1px solid #e9d5ff" }}>
              <div style={{ fontSize: 10, color: "#7e22ce", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>📋 TR aceptadas</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#6b21a8", fontVariantNumeric: "tabular-nums" }}>{dtv.tr_aceptadas}</div>
            </div>
            <div style={{ background: "#faf5ff", borderRadius: 6, padding: "8px 10px", border: "1px solid #e9d5ff" }}>
              <div style={{ fontSize: 10, color: "#7e22ce", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>🚚 En panel</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#6b21a8", fontVariantNumeric: "tabular-nums" }}>{dtv.logistic_operables}</div>
            </div>
            <div style={{ background: "#faf5ff", borderRadius: 6, padding: "8px 10px", border: "1px solid #e9d5ff" }}>
              <div style={{ fontSize: 10, color: "#7e22ce", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>🔬 Sin trazabilidad</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#6b21a8", fontVariantNumeric: "tabular-nums" }}>{dtv.delta}</div>
            </div>
          </div>

          {Array.isArray(dtv.detalle_tr_por_sc) && dtv.detalle_tr_por_sc.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 11, color: "#6b21a8", cursor: "pointer", fontWeight: 600 }}>
                Ver detalle de TR aceptadas por SC y vehículo
              </summary>
              <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto", background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: 6, padding: 8 }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e9d5ff", color: "#7e22ce" }}>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>SC</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Vehículo</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Tipo</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700 }}>Aceptadas TR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dtv.detalle_tr_por_sc.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px dashed #e9d5ff" }}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "#0f172a" }}>{r.sc}</td>
                        <td style={{ padding: "4px 8px", color: "#475569" }}>{r.vehicle_type}</td>
                        <td style={{ padding: "4px 8px", color: r.es_sdd ? "#9a3412" : "#3730a3", fontWeight: 600 }}>
                          {r.es_sdd ? "SDD" : "VAR"}
                        </td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{r.aceptadas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div style={{ marginTop: 10, padding: 8, background: "rgba(255, 255, 255, 0.6)", borderRadius: 6, fontSize: 10, color: "#6b21a8", lineHeight: 1.5 }}>
            <strong>Hipótesis a validar:</strong> Ofertas marcadas como aceptadas en TR que no llegaron al panel operativo del día.
            Los dos sistemas de MELI (TR y Logistic Monitoring) están desacoplados — no comparten ID directo,
            por lo que el cruce solo es posible a nivel agregado (SC + vehículo + fecha).
          </div>
        </div>
      )}

      {/* BLOQUE 1.D: REPORTE SDD OFICIAL MELI (información complementaria) */}
      {rsm.tiene_reporte && rsm.totales && (
        <div style={{
          background: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          border: "1px solid #a5b4fc"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#3730a3", display: "flex", alignItems: "center", gap: 6 }}>
                📑 Reporte SDD oficial MELI
              </div>
              <div style={{ fontSize: 11, color: "#4338ca", marginTop: 4, lineHeight: 1.5 }}>
                Información complementaria descargada del panel TMS oficial de MELI.
                Solo cubre rutas SDD (Súper Dedicadas).
                <br/>
                <span style={{ color: "#6366f1" }}>
                  Esta información no modifica el cumplimiento principal del Brain.
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right", marginLeft: 16 }}>
              <div style={{ 
                fontSize: 28, 
                fontWeight: 800, 
                color: rsm.totales.pct_cumplimiento >= 95 ? "#16a34a" : rsm.totales.pct_cumplimiento >= 85 ? "#f59e0b" : "#dc2626",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1
              }}>
                {rsm.totales.pct_cumplimiento}%
              </div>
              <div style={{ fontSize: 9, color: "#4338ca", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>
                cumplimiento SDD
              </div>
            </div>
          </div>

          {/* 3 sub-tarjetas: Solicitadas / Ejecutadas / No ejecutadas */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
            <div style={{ background: "#eef2ff", borderRadius: 6, padding: "8px 10px", border: "1px solid #c7d2fe" }}>
              <div style={{ fontSize: 10, color: "#4338ca", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>📋 Solicitadas</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#3730a3", fontVariantNumeric: "tabular-nums" }}>{rsm.totales.solicitadas}</div>
            </div>
            <div style={{ background: "#eef2ff", borderRadius: 6, padding: "8px 10px", border: "1px solid #c7d2fe" }}>
              <div style={{ fontSize: 10, color: "#4338ca", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>✅ Ejecutadas</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>{rsm.totales.ejecutadas}</div>
            </div>
            <div style={{ background: "#eef2ff", borderRadius: 6, padding: "8px 10px", border: "1px solid #c7d2fe" }}>
              <div style={{ fontSize: 10, color: "#4338ca", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>❌ No ejecutadas</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: rsm.totales.no_ejecutadas > 0 ? "#dc2626" : "#3730a3", fontVariantNumeric: "tabular-nums" }}>{rsm.totales.no_ejecutadas}</div>
            </div>
          </div>

          {/* Detalle por SC (solo SCs con problemas) */}
          {Array.isArray(rsm.por_sc) && rsm.por_sc.filter(s => s.no_ejecutadas > 0).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: "#3730a3", fontWeight: 600, marginBottom: 6 }}>
                ⚠️ SCs con SDD no ejecutadas:
              </div>
              <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 6, padding: 8, border: "1px solid #c7d2fe" }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #c7d2fe", color: "#4338ca" }}>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>SC</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700 }}>Solicitadas</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700 }}>Ejecutadas</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700 }}>No ejec.</th>
                      <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700 }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rsm.por_sc.filter(s => s.no_ejecutadas > 0).map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px dashed #c7d2fe" }}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "#0f172a" }}>{s.sc}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>{s.solicitadas}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", color: "#16a34a", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.ejecutadas}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", color: "#dc2626", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.no_ejecutadas}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 700, color: s.pct_cumplimiento >= 95 ? "#16a34a" : s.pct_cumplimiento >= 85 ? "#f59e0b" : "#dc2626", fontVariantNumeric: "tabular-nums" }}>{s.pct_cumplimiento}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Detalle desplegable de las no ejecutadas */}
          {Array.isArray(rsm.no_ejecutadas_detalle) && rsm.no_ejecutadas_detalle.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 11, color: "#3730a3", cursor: "pointer", fontWeight: 600 }}>
                Ver detalle de {rsm.no_ejecutadas_detalle.length} rutas SDD no ejecutadas
              </summary>
              <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto", background: "rgba(255,255,255,0.6)", border: "1px solid #c7d2fe", borderRadius: 6, padding: 8 }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #c7d2fe", color: "#4338ca" }}>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>SC</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Vehículo</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>ID Ruta</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Driver</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Etapa caída</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rsm.no_ejecutadas_detalle.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px dashed #c7d2fe" }}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "#0f172a" }}>{r.sc}</td>
                        <td style={{ padding: "4px 8px", color: "#475569", fontSize: 10 }}>{r.vehiculo}</td>
                        <td style={{ padding: "4px 8px", color: "#475569", fontFamily: "monospace", fontSize: 10 }}>
                          {r.id_ruta || <span style={{ color: "#94a3b8", fontStyle: "italic" }}>sin asignar</span>}
                        </td>
                        <td style={{ padding: "4px 8px", color: "#475569" }}>
                          {r.driver_name || <span style={{ color: "#94a3b8", fontStyle: "italic" }}>sin driver</span>}
                        </td>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: r.etapa_caida.includes("última hora") ? "#dc2626" : "#9333ea" }}>
                          {r.etapa_caida}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      {/* BLOQUE 1.5: EMBUDO DE ACEPTACIÓN */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, border: "1px solid #e4e7ec" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>
              📊 Embudo de Aceptación
              <TooltipInfo texto="Trazabilidad del ciclo de oferta MELI: cuántas rutas nos ofreció MELI y qué pasó con cada una (aceptamos / rechazamos / MELI canceló / quedaron pending)." />
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>De macro a micro: ofertas → respuestas → ranking por SC</div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: (eaT.pct_aceptacion || 0) >= 90 ? "#16a34a" : (eaT.pct_aceptacion || 0) >= 75 ? "#f59e0b" : "#dc2626" }}>
            {eaT.pct_aceptacion || 0}% <span style={{ fontSize: 12, fontWeight: 600, color: "#888" }}>aceptación</span>
          </div>
        </div>
        
        {/* Línea 1: Ofrecidas (tarjeta grande) */}
        <div onClick={() => abrirDetalleEmbudo(null, {}, "Todas las ofertas MELI")}
          style={{ 
            background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)", 
            borderRadius: 10, padding: "14px 18px", marginBottom: 14, 
            cursor: "pointer", border: "1px solid #bae6fd" 
          }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "#0369a1", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                📥 Ofrecidas
                <TooltipInfo texto="Total de ofertas de viaje que MELI puso a disposición del carrier en este período. Es el universo total del embudo." />
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#0c4a6e", marginTop: 2 }}>{eaT.ofrecidas || 0}</div>
            </div>
            <div style={{ fontSize: 11, color: "#0369a1", textAlign: "right" }}>
              {(() => {
                const top = top3SCs(ea.por_sc || [], 'ofrecidas', 'desc');
                return (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Más activos:</div>
                    {top.peores.map(s => (
                      <div key={s.sc} style={{ fontSize: 10, color: "#0369a1" }}>
                        {s.sc}: <strong>{s.ofrecidas}</strong>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
        
        {/* Línea 2: 4 tarjetas de status */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
          {/* Aceptadas */}
          <div onClick={() => abrirDetalleEmbudo("accepted", {}, "Ofertas aceptadas")}
            style={{ background: "#f0fdf4", borderRadius: 8, padding: "12px 14px", cursor: "pointer", border: "1px solid transparent" }}
            onMouseOver={e => { e.currentTarget.style.borderColor = "#166534"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; }}>
            <div style={{ fontSize: 10, color: "#166534", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>
                ✅ Aceptadas
                <TooltipInfo texto="Ofertas que aceptamos para operar. Pasan al embudo operativo (logistic + maestro)." />
              </span>
              <span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#166534", marginTop: 2 }}>{eaT.aceptadas || 0}</div>
            <div style={{ fontSize: 11, color: "#888" }}>{eaT.pct_aceptacion || 0}%</div>
            {(() => {
              const top = top3SCs(ea.por_sc || [], 'pct_aceptacion', 'asc');
              if (top.peores.length === 0) return null;
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #d1fae5", fontSize: 10 }}>
                  <div style={{ color: "#991b1b", fontWeight: 600, marginBottom: 2 }}>Peores:</div>
                  {top.peores.map(s => (
                    <div key={s.sc} style={{ color: "#666", fontSize: 10 }}>
                      {s.sc}: <strong>{s.pct_aceptacion || 0}%</strong>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          
          {/* Rechazadas */}
          <div onClick={() => (eaT.rechazadas || 0) > 0 && abrirDetalleEmbudo("rejected", {}, "Ofertas rechazadas (rechazo propio)")}
            style={{ 
              background: (eaT.rechazadas || 0) > 0 ? "#fef2f2" : "#f9fafb", 
              borderRadius: 8, padding: "12px 14px", 
              cursor: (eaT.rechazadas || 0) > 0 ? "pointer" : "default",
              border: "1px solid transparent"
            }}
            onMouseOver={e => { if ((eaT.rechazadas || 0) > 0) e.currentTarget.style.borderColor = "#991b1b"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; }}>
            <div style={{ fontSize: 10, color: (eaT.rechazadas || 0) > 0 ? "#991b1b" : "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>
                ❌ Rechazadas
                <TooltipInfo texto="Ofertas que rechazamos antes del día de operación. Indicador de eficiencia operacional: idealmente bajo (<5%)." />
              </span>
              {(eaT.rechazadas || 0) > 0 && <span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: (eaT.rechazadas || 0) > 0 ? "#991b1b" : "#666", marginTop: 2 }}>
              {eaT.rechazadas || 0}
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>{eaT.pct_rechazo_propio || 0}%</div>
            {(() => {
              const top = top3SCs((ea.por_sc || []).filter(s => (s.rechazadas || 0) > 0), 'pct_rechazo', 'desc');
              if (top.peores.length === 0) return null;
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #fee2e2", fontSize: 10 }}>
                  <div style={{ color: "#991b1b", fontWeight: 600, marginBottom: 2 }}>Top problemas:</div>
                  {top.peores.map(s => (
                    <div key={s.sc} style={{ color: "#666", fontSize: 10 }}>
                      {s.sc}: <strong>{s.pct_rechazo}%</strong>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          
          {/* Canceladas MELI */}
          <div onClick={() => (eaT.canceladas_meli || 0) > 0 && abrirDetalleEmbudo("canceled", {}, "Canceladas por MELI")}
            style={{ 
              background: (eaT.canceladas_meli || 0) > 0 ? "#fffbeb" : "#f9fafb", 
              borderRadius: 8, padding: "12px 14px", 
              cursor: (eaT.canceladas_meli || 0) > 0 ? "pointer" : "default",
              border: "1px solid transparent"
            }}
            onMouseOver={e => { if ((eaT.canceladas_meli || 0) > 0) e.currentTarget.style.borderColor = "#b45309"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; }}>
            <div style={{ fontSize: 10, color: (eaT.canceladas_meli || 0) > 0 ? "#b45309" : "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>
                🚫 Cancel. MELI
                <TooltipInfo texto="Ofertas que aceptamos pero MELI canceló después. % calculado sobre (aceptadas + canceladas). No es responsabilidad propia, pero ayuda a planificar oferta de drivers." />
              </span>
              {(eaT.canceladas_meli || 0) > 0 && <span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: (eaT.canceladas_meli || 0) > 0 ? "#b45309" : "#666", marginTop: 2 }}>
              {eaT.canceladas_meli || 0}
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>{eaT.pct_cancelacion_meli || 0}%</div>
            {(() => {
              const top = top3SCs((ea.por_sc || []).filter(s => (s.canceladas_meli || 0) > 0), 'pct_cancelacion_meli', 'desc');
              if (top.peores.length === 0) return null;
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #fef3c7", fontSize: 10 }}>
                  <div style={{ color: "#b45309", fontWeight: 600, marginBottom: 2 }}>Top afectados:</div>
                  {top.peores.map(s => (
                    <div key={s.sc} style={{ color: "#666", fontSize: 10 }}>
                      {s.sc}: <strong>{s.pct_cancelacion_meli}%</strong>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          
          {/* Pending */}
          <div onClick={() => (eaT.pendientes || 0) > 0 && abrirDetalleEmbudo("pending", {}, "Ofertas pending")}
            style={{ 
              background: (eaT.pendientes || 0) > 0 ? "#f5f3ff" : "#f9fafb", 
              borderRadius: 8, padding: "12px 14px", 
              cursor: (eaT.pendientes || 0) > 0 ? "pointer" : "default",
              border: "1px solid transparent"
            }}
            onMouseOver={e => { if ((eaT.pendientes || 0) > 0) e.currentTarget.style.borderColor = "#6d28d9"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "transparent"; }}>
            <div style={{ fontSize: 10, color: (eaT.pendientes || 0) > 0 ? "#6d28d9" : "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>
                ⏳ Pending
                <TooltipInfo texto="Ofertas pendientes de respuesta. Si quedan viejas (más de 1 día) son SLA crítico: MELI las rota a otro carrier y perdemos negocio." />
              </span>
              {(eaT.pendientes || 0) > 0 && <span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: (eaT.pendientes || 0) > 0 ? "#6d28d9" : "#666", marginTop: 2 }}>
              {eaT.pendientes || 0}
            </div>
            {(() => {
              const top = top3SCs((ea.por_sc || []).filter(s => (s.pendientes || 0) > 0), 'pendientes', 'desc');
              if (top.peores.length === 0) return null;
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #ede9fe", fontSize: 10 }}>
                  <div style={{ color: "#6d28d9", fontWeight: 600, marginBottom: 2 }}>Por SC:</div>
                  {top.peores.map(s => (
                    <div key={s.sc} style={{ color: "#666", fontSize: 10 }}>
                      {s.sc}: <strong>{s.pendientes}</strong>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
        
        {/* Línea 3: Split por Servicio + por Flota */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 14 }}>
          {/* Por Servicio (SDD vs Variable) */}
          <div style={{ background: "#fff7ed", borderRadius: 8, padding: 14, border: "1px solid #fed7aa" }}>
            <div style={{ fontSize: 11, color: "#9a3412", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              Por Servicio
              <TooltipInfo texto="SDD = Same Day Delivery (compromiso entrega rápida, alta prioridad). Variable = sin compromiso temporal." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div onClick={() => abrirDetalleEmbudo(null, { es_sdd: true }, "Ofertas SDD")}
                style={{ cursor: "pointer", padding: 8, borderRadius: 6, background: "#fff" }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>SDD</div>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: "#888" }}>Ofrecidas:</span> <strong>{ea.por_servicio?.sdd?.ofrecidas || 0}</strong>
                  <br/>
                  <span style={{ color: "#888" }}>Aceptadas:</span> <strong>{ea.por_servicio?.sdd?.aceptadas || 0}</strong>
                  {(ea.por_servicio?.sdd?.rechazadas || 0) > 0 && (
                    <><br/><span style={{ color: "#991b1b" }}>Rechaz.: {ea.por_servicio.sdd.rechazadas}</span></>
                  )}
                </div>
              </div>
              <div onClick={() => abrirDetalleEmbudo(null, { es_sdd: false }, "Ofertas Variable")}
                style={{ cursor: "pointer", padding: 8, borderRadius: 6, background: "#fff" }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>Variable</div>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: "#888" }}>Ofrecidas:</span> <strong>{ea.por_servicio?.variable?.ofrecidas || 0}</strong>
                  <br/>
                  <span style={{ color: "#888" }}>Aceptadas:</span> <strong>{ea.por_servicio?.variable?.aceptadas || 0}</strong>
                  {(ea.por_servicio?.variable?.rechazadas || 0) > 0 && (
                    <><br/><span style={{ color: "#991b1b" }}>Rechaz.: {ea.por_servicio.variable.rechazadas}</span></>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Por Flota (Fija vs Variable) */}
          <div style={{ background: "#eef2ff", borderRadius: 8, padding: 14, border: "1px solid #c7d2fe" }}>
            <div style={{ fontSize: 11, color: "#3730a3", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              Por Flota
              <TooltipInfo texto="Fija = drivers propios contratados (más estables). Variable = drivers temporales/crowd (más cancelaciones MELI)." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div onClick={() => abrirDetalleEmbudo(null, { tipo_flota: 'fija' }, "Ofertas · Flota Fija")}
                style={{ cursor: "pointer", padding: 8, borderRadius: 6, background: "#fff" }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>Fija</div>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: "#888" }}>Ofrecidas:</span> <strong>{ea.por_flota?.fija?.ofrecidas || 0}</strong>
                  <br/>
                  <span style={{ color: "#888" }}>Aceptadas:</span> <strong>{ea.por_flota?.fija?.aceptadas || 0}</strong>
                </div>
              </div>
              <div onClick={() => abrirDetalleEmbudo(null, { tipo_flota: 'variable' }, "Ofertas · Flota Variable")}
                style={{ cursor: "pointer", padding: 8, borderRadius: 6, background: "#fff" }}>
                <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>Variable</div>
                <div style={{ fontSize: 13 }}>
                  <span style={{ color: "#888" }}>Ofrecidas:</span> <strong>{ea.por_flota?.variable?.ofrecidas || 0}</strong>
                  <br/>
                  <span style={{ color: "#888" }}>Aceptadas:</span> <strong>{ea.por_flota?.variable?.aceptadas || 0}</strong>
                  {(ea.por_flota?.variable?.canceladas || 0) > 0 && (
                    <><br/><span style={{ color: "#b45309" }}>Cancel MELI: {ea.por_flota.variable.canceladas}</span></>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Alerta crítica: Pending viejos */}
        {ea.pending_viejos?.total > 0 && (
          <div onClick={() => abrirDetalleEmbudo("pending_viejos", {}, "⚠️ Pending viejos sin responder")}
            style={{ 
              background: "#fef2f2", borderRadius: 8, padding: "12px 16px", 
              border: "2px solid #fecaca", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>
                ⚠️ ALERTA: {ea.pending_viejos.total} pending {ea.pending_viejos.total === 1 ? 'viejo' : 'viejos'} sin responder
                <TooltipInfo texto="Ofertas que aceptamos hace varios días y siguen pending. MELI puede rotarlas a otro carrier en cualquier momento. Responder con urgencia." />
              </div>
              <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 2 }}>
                Click para ver detalle (request_id, SC, días pendiente)
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#991b1b", fontWeight: 600 }}>VER →</div>
          </div>
        )}
      </div>

      {/* BLOQUE 2: NIVEL DE SERVICIO */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, border: "1px solid #e4e7ec" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>Nivel de Servicio</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Umbral mínimo: {ns.umbral}%</div>
          </div>
        </div>
        
        {/* NS dual: ponderado vs promedio */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
          <div onClick={() => abrirDetalle("ejecutadas", {}, "Rutas ejecutadas (peor a mejor NS)")}
            style={{ 
              background: colorBg(ns.pct_ponderado, ns.umbral), 
              borderRadius: 8, padding: 16, cursor: "pointer",
              border: `2px solid ${colorPct(ns.pct_ponderado, ns.umbral)}` 
            }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#002E5D", textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>NS Ponderado (oficial MELI)</span><span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: colorPct(ns.pct_ponderado, ns.umbral), marginTop: 4 }}>
              {ns.pct_ponderado || 0}% {!cumple(ns.pct_ponderado, ns.umbral) ? "🔴" : "✅"}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
              {Number(ns.ent_total || 0).toLocaleString()} entregados de {Number(ns.desp_total || 0).toLocaleString()} despachados
            </div>
          </div>
          <div onClick={() => abrirDetalle("ejecutadas", {}, "Rutas ejecutadas (NS por ruta)")}
            style={{ 
              background: colorBg(ns.pct_promedio, ns.umbral), 
              borderRadius: 8, padding: 16, cursor: "pointer",
              border: `2px solid ${colorPct(ns.pct_promedio, ns.umbral)}` 
            }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#002E5D", textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
              <span>NS Promedio por ruta</span><span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: colorPct(ns.pct_promedio, ns.umbral), marginTop: 4 }}>
              {ns.pct_promedio || 0}% {!cumple(ns.pct_promedio, ns.umbral) ? "🔴" : "✅"}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
              Promedio simple del % de cada ruta
            </div>
          </div>
        </div>
        
        {/* NS por SC */}
        {(ns.por_sc || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              Por Service Center (peor → mejor)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              {(ns.por_sc || []).map(s => (
                <div key={s.sc} 
                  onClick={() => abrirDetalle("ejecutadas", { sc: s.sc }, `Rutas de ${s.sc}`)}
                  style={{ 
                  background: colorBg(s.ns_pct, ns.umbral), 
                  borderRadius: 6, padding: "8px 10px", cursor: "pointer",
                  border: `1px solid ${colorPct(s.ns_pct, ns.umbral)}33` 
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#002E5D", display: "flex", justifyContent: "space-between" }}>
                    <span>{s.sc}</span><span style={{ fontSize: 8, opacity: 0.5 }}>→</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: colorPct(s.ns_pct, ns.umbral) }}>
                    {s.ns_pct}%
                  </div>
                  <div style={{ fontSize: 9, color: "#888" }}>
                    {s.rutas} rutas · {Number(s.ent || 0).toLocaleString()}/{Number(s.desp || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* NS por tipo de ruta */}
        {(ns.por_tipo || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              Por tipo de ruta
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
              {(ns.por_tipo || []).map(t => (
                <div key={t.tipo} 
                  onClick={() => abrirDetalle("ejecutadas", { tipo_ruta: t.tipo }, `Rutas tipo ${t.tipo}`)}
                  style={{ 
                  background: colorBg(t.ns_pct, ns.umbral), 
                  borderRadius: 6, padding: "10px 12px", cursor: "pointer",
                  border: `1px solid ${colorPct(t.ns_pct, ns.umbral)}33` 
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#002E5D", display: "flex", justifyContent: "space-between" }}>
                    <span>{t.tipo}</span><span style={{ fontSize: 9, opacity: 0.5 }}>→</span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: colorPct(t.ns_pct, ns.umbral) }}>
                    {t.ns_pct}%
                  </div>
                  <div style={{ fontSize: 10, color: "#888" }}>
                    {t.rutas} rutas
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Características especiales (overlap permitido) */}
        {ns.caracteristicas && (
          (ns.caracteristicas.bulky?.rutas || 0) + (ns.caracteristicas.bags?.rutas || 0) + 
          (ns.caracteristicas.ambulancia?.rutas || 0) + (ns.caracteristicas.pickup_node?.rutas || 0) > 0
        ) && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
              Características especiales (puede haber overlap)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
              {(ns.caracteristicas.bulky?.rutas || 0) > 0 && (
                <div onClick={() => abrirDetalle("ejecutadas", { caracteristica: "bulky" }, "Rutas con Bulky")}
                  style={{ background: "#fef3c7", borderRadius: 6, padding: "10px 12px", border: "1px solid #fde68a", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.3, display: "flex", justifyContent: "space-between" }}>
                    <span>📦 Bulky</span><span style={{ fontSize: 9, opacity: 0.5 }}>→</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#92400e" }}>{ns.caracteristicas.bulky.rutas}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cumple(ns.caracteristicas.bulky.ns_pct, ns.umbral) ? "#16a34a" : "#dc2626", marginTop: 2 }}>
                    NS {ns.caracteristicas.bulky.ns_pct || 0}%
                  </div>
                  <div style={{ fontSize: 10, color: "#888" }}>paquetes voluminosos</div>
                </div>
              )}
              {(ns.caracteristicas.bags?.rutas || 0) > 0 && (
                <div onClick={() => abrirDetalle("ejecutadas", { caracteristica: "bags" }, "Rutas con Bags")}
                  style={{ background: "#dbeafe", borderRadius: 6, padding: "10px 12px", border: "1px solid #bfdbfe", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.3, display: "flex", justifyContent: "space-between" }}>
                    <span>👜 Bags</span><span style={{ fontSize: 9, opacity: 0.5 }}>→</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#1e40af" }}>{ns.caracteristicas.bags.rutas}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cumple(ns.caracteristicas.bags.ns_pct, ns.umbral) ? "#16a34a" : "#dc2626", marginTop: 2 }}>
                    NS {ns.caracteristicas.bags.ns_pct || 0}%
                  </div>
                  <div style={{ fontSize: 10, color: "#888" }}>envíos consolidados</div>
                </div>
              )}
              {(ns.caracteristicas.ambulancia?.rutas || 0) > 0 && (
                <div onClick={() => abrirDetalle("ejecutadas", { caracteristica: "ambulancia" }, "Rutas Ambulancia")}
                  style={{ background: "#fee2e2", borderRadius: 6, padding: "10px 12px", border: "1px solid #fecaca", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.3, display: "flex", justifyContent: "space-between" }}>
                    <span>🚑 Ambulancia</span><span style={{ fontSize: 9, opacity: 0.5 }}>→</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#991b1b" }}>{ns.caracteristicas.ambulancia.rutas}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cumple(ns.caracteristicas.ambulancia.ns_pct, ns.umbral) ? "#16a34a" : "#dc2626", marginTop: 2 }}>
                    NS {ns.caracteristicas.ambulancia.ns_pct || 0}%
                  </div>
                  <div style={{ fontSize: 10, color: "#888" }}>ruta de urgencia</div>
                </div>
              )}
              {(ns.caracteristicas.pickup_node?.rutas || 0) > 0 && (
                <div onClick={() => abrirDetalle("ejecutadas", { caracteristica: "pickup_node" }, "Rutas con Pickup Node")}
                  style={{ background: "#e0e7ff", borderRadius: 6, padding: "10px 12px", border: "1px solid #c7d2fe", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#3730a3", textTransform: "uppercase", letterSpacing: 0.3, display: "flex", justifyContent: "space-between" }}>
                    <span>📍 Pickup Node</span><span style={{ fontSize: 9, opacity: 0.5 }}>→</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#3730a3" }}>{ns.caracteristicas.pickup_node.rutas}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: cumple(ns.caracteristicas.pickup_node.ns_pct, ns.umbral) ? "#16a34a" : "#dc2626", marginTop: 2 }}>
                    NS {ns.caracteristicas.pickup_node.ns_pct || 0}%
                  </div>
                  <div style={{ fontSize: 10, color: "#888" }}>punto de recolección</div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {(ns.por_tipo || []).length === 0 && (
          <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginTop: 8 }}>
            Tipos de ruta no disponibles (cruce con scraper de ayudantes pendiente)
          </div>
        )}
      </div>

      {/* BLOQUE 3: NIVEL DE VISITADOS */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 16, border: "1px solid #e4e7ec" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>Nivel de Visitados</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Umbral mínimo: {nv.umbral}%</div>
          </div>
          <div onClick={() => (nv.no_visitados || 0) > 0 && abrirDetalle("no_visitados", {}, "Rutas con paquetes no visitados")}
            style={{ 
            background: colorBg(nv.pct_general, nv.umbral), 
            borderRadius: 8, padding: "10px 18px", 
            border: `2px solid ${colorPct(nv.pct_general, nv.umbral)}`,
            cursor: (nv.no_visitados || 0) > 0 ? "pointer" : "default"
          }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: colorPct(nv.pct_general, nv.umbral) }}>
              {nv.pct_general || 0}% {!cumple(nv.pct_general, nv.umbral) ? "🔴" : "✅"}
            </div>
            <div style={{ fontSize: 11, color: "#666", textAlign: "right" }}>
              {Math.round(nv.no_visitados || 0)} no visitados de {Number(nv.desp_total || 0).toLocaleString()}
              {(nv.no_visitados || 0) > 0 && <span style={{ marginLeft: 8, opacity: 0.6 }}>VER →</span>}
            </div>
          </div>
        </div>
      </div>

      {/* BLOQUE 4: PNR */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, border: "1px solid #e4e7ec" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>PNR del día anterior</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Casos creados el {fechaTexto}</div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#002E5D" }}>
            {pnr.total || 0}
          </div>
        </div>
        
        {(pnr.por_estado || []).length === 0 ? (
          <div style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic", textAlign: "center", padding: 16 }}>
            No hay casos PNR registrados para este día
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
            {(pnr.por_estado || []).map(e => {
              const esCerrado = e.estado === "Anulado" || e.estado === "Enviado a facturacion";
              const bg = esCerrado ? "#f0fdf4" : "#fff7ed";
              const colorTxt = esCerrado ? "#166534" : "#9a3412";
              const colorVal = esCerrado ? "#16a34a" : "#ea580c";
              return (
                <div key={e.estado} 
                  onClick={() => abrirDetalle("pnr", { pnr_estado: e.estado }, `PNR · ${e.estado}`)}
                  style={{ background: bg, borderRadius: 8, padding: "10px 14px", border: "1px solid #e4e7ec", cursor: "pointer" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: colorTxt, textTransform: "uppercase", letterSpacing: 0.3, display: "flex", justifyContent: "space-between" }}>
                    <span>{e.estado}</span><span style={{ fontSize: 9, opacity: 0.6 }}>VER →</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: colorVal, marginTop: 2 }}>
                    {e.cantidad}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* MODAL DE DETALLE */}
      {modal && (
        <div onClick={() => setModal(null)}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20
          }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, maxWidth: "95vw", maxHeight: "90vh",
              width: 1200, display: "flex", flexDirection: "column", overflow: "hidden"
            }}>
            {/* Header */}
            <div style={{
              padding: "16px 20px", borderBottom: "1px solid #e4e7ec",
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>{modal.titulo}</div>
              <div style={{ display: "flex", gap: 8 }}>
                {modal.filas && modal.filas.length > 0 && !modal.filas[0]?.error && (
                  <button onClick={() => descargarExcelMeli(modal.filas, modal.nombreArchivo || "kpi_detalle", "Detalle")}
                    style={{
                      background: "#16a34a", color: "#fff", border: "none", borderRadius: 6,
                      padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer"
                    }}>
                    📥 Descargar Excel
                  </button>
                )}
                <button onClick={() => setModal(null)}
                  style={{
                    background: "#f1f5f9", border: "none", borderRadius: 6,
                    padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#475569"
                  }}>
                  Cerrar
                </button>
              </div>
            </div>
            
            {/* Contenido tabla */}
            <div style={{ overflow: "auto", flex: 1, padding: 0 }}>
              {modalLoading ? (
                <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando...</div>
              ) : modal.filas && modal.filas.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
                  Sin datos para mostrar
                </div>
              ) : modal.filas && modal.filas[0]?.error ? (
                <div style={{ padding: 40, textAlign: "center", color: "#c0392b" }}>
                  Error: {modal.filas[0].error}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead style={{ background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 }}>
                    <tr>
                      {Object.keys(modal.filas[0] || {}).map(col => {
                        const labels = {
                          'request_id': 'Request ID',
                          'service_center': 'SC',
                          'fecha_operacion': 'Fecha Op.',
                          'vehiculo': 'Vehículo',
                          'fleet': 'Fleet',
                          'estado': 'Estado',
                          'motivo': 'Motivo',
                          'id_ruta': 'ID Ruta',
                          'driver': 'Driver',
                          'patente': 'Patente',
                          'tipo_ruta': 'Tipo Ruta',
                          'despachados': 'Despachados',
                          'entregados': 'Entregados',
                          'no_visitado': 'No Visitado',
                          'ns_ruta_pct': 'NS Ruta %',
                          'id_caso': 'ID Caso',
                          'tipo_pnr': 'Tipo PNR',
                          'fecha_caso': 'Fecha Caso',
                          'ruta': 'Ruta',
                          'conductor': 'Conductor',
                          'valor_compra': 'Valor Compra',
                          'productos': 'Productos',
                          'comentario_cierre': 'Comentario',
                        };
                        return (
                          <th key={col} style={{
                            padding: "10px 12px", textAlign: "left", fontWeight: 700,
                            color: "#475569", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.5,
                            borderBottom: "2px solid #e4e7ec", whiteSpace: "nowrap"
                          }}>
                            {labels[col] || col.replace(/_/g, " ")}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {modal.filas.map((fila, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        {Object.keys(modal.filas[0] || {}).map(col => {
                          const val = fila[col];
                          const display = val === null || val === undefined ? "—" : 
                                         typeof val === "boolean" ? (val ? "Sí" : "No") :
                                         typeof val === "number" ? val.toLocaleString() : 
                                         String(val);
                          return (
                            <td key={col} style={{ 
                              padding: "8px 12px", color: "#475569", whiteSpace: "nowrap",
                              maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis"
                            }}>
                              {display}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Footer */}
            <div style={{
              padding: "10px 20px", borderTop: "1px solid #e4e7ec",
              fontSize: 11, color: "#888", background: "#f8fafc"
            }}>
              {modal.filas && !modal.filas[0]?.error ? `${modal.filas.length} fila${modal.filas.length === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPROMISO MELI — Vista de la operativa de mañana
// ═══════════════════════════════════════════════════════════════════════════

// ── Tarjeta de conteo por status (con desglose SDD/SPOT) ───────────────────

// ── Bloque de ranking (lista de SCs con barra) ─────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// KPI DE OPERACIÓN — Comparativa NS Informe MELI vs Snapshots (día anterior)
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// KPI DE OPERACIÓN — DASHBOARD STYLE (reemplazo completo)
// Ubicación original: líneas ~21675 a ~22206 en App.jsx
// Reemplaza la function PoolMeliKPIOperacion() entera por esta versión.
//
// FUENTES DE DATOS:
//   • get_kpi_operacion_comparativo(p_fecha)         — actual (KPIs del día)
//   • get_compromiso_meli_manana()                   — actual (Servicios ofertados)
//   • get_kpi_operacion_historico(p_desde, p_hasta)  — PENDIENTE (sparklines + deltas + rankings)
//                                                       Debe devolver un array de filas
//                                                       { fecha, ns_pond_meli, ns_pond_snap,
//                                                         ns_prom_sc_meli, ns_prom_sc_snap,
//                                                         pct_visitados, rutas, cargados,
//                                                         entregados, devueltos, ambulancias,
//                                                         no_visitados, pnr_del_dia,
//                                                         rankings: {sc, ns_pond, vs, r, carg, ent, dev, pnr, amb}[] }
//
// Si get_kpi_operacion_historico no existe aún, todo el dashboard funciona:
// los sparklines quedan vacíos y los rankings ▲/▼ usan únicamente los datos del día.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SUBCOMPONENTES
// ═══════════════════════════════════════════════════════════════════════════

// ─── CARD GENÉRICA (estructura visual común) ──────────────────────────────

// ─── ZOOM BAR (barra de meta) ─────────────────────────────────────────────

// ─── SPARKLINE SVG (Catmull-Rom) ──────────────────────────────────────────

// ─── DELTA TEXT ───────────────────────────────────────────────────────────

// ─── RANKING ▲▼ ───────────────────────────────────────────────────────────

// ─── DIVISOR ──────────────────────────────────────────────────────────────

// ─── CARD NS (dos valores apilados: MELI + SNAPSHOTS) ─────────────────────

// ─── CARD SINGLE (un solo valor + zoom bar opcional) ──────────────────────

// ─── CARD VOLUMEN (sin borde lateral, sparkline 52px) ─────────────────────

// ─── CARD FOCO OPERATIVO (badge + sparkline lower=true) ───────────────────

// ─── CARD COMPROMISO (sin sparkline ni ranking, footer pequeño) ───────────

// ═══════════════════════════════════════════════════════════════════════════
// DIFERENCIAS MAESTROS — Auditoría ruta por ruta MELI vs Snapshots
// ═══════════════════════════════════════════════════════════════════════════

// ── INVENTARIO con calendario diario ───────────────────────────────────────

// ── CALENDARIO de actividad por día ────────────────────────────────────────

// ── DETALLE in-place de un Driver o Vehículo ───────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// PESTAÑA: VENTANA DE DECISIONES
// Muestra trayectorias de estado en TR: aceptadas tarde, arrepentimientos,
// cancelaciones MELI, recuperaciones, pending rechazadas
// 3 niveles de drill-down: Tipos → SCs → Rutas individuales
// ═══════════════════════════════════════════════════════════════════════════
function PoolMeliVentanaDecisiones({ mesGlobal }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modo, setModo] = useState("dia"); // "dia" o "rango"
  const [fechaDia, setFechaDia] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [fechaDesde, setFechaDesde] = useState(() => {
    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return inicioMes.toISOString().slice(0, 10);
  });
  const [fechaHasta, setFechaHasta] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  
  // Drill-down state
  const [tipoExpandido, setTipoExpandido] = useState(null);
  const [scExpandido, setScExpandido] = useState(null);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setLoading(true);
      setError(null);
      setTipoExpandido(null);
      setScExpandido(null);
      try {
        const params = modo === "dia"
          ? { p_fecha_desde: fechaDia }
          : { p_fecha_desde: fechaDesde, p_fecha_hasta: fechaHasta };
        const { data: result, error: err } = await sb.rpc("get_ventana_decisiones", params);
        if (cancelado) return;
        if (err) throw err;
        setData(result);
      } catch (e) {
        if (!cancelado) setError(e.message || String(e));
      } finally {
        if (!cancelado) setLoading(false);
      }
    }
    cargar();
    return () => { cancelado = true; };
  }, [modo, fechaDia, fechaDesde, fechaHasta]);

  if (loading) return <div className="pg" style={{ padding: 40, color: "#888" }}>Cargando ventana de decisiones...</div>;
  if (error) return <div className="pg" style={{ padding: 40, color: "#c0392b" }}>Error: {error}</div>;
  if (!data) return <div className="pg" style={{ padding: 40, color: "#888" }}>Sin datos</div>;

  const totales = data.totales_por_tipo || {};
  const desglose = data.desglose_por_sc || {};
  const detalles = data.detalle_completo || {};
  const totalCambios = data.total_cambios || 0;

  // Definición de los 5 tipos con sus metadatos
  const tiposConfig = [
    {
      id: "aceptadas_tarde",
      label: "Aceptadas tarde",
      icon: "⏱️",
      desc: "Pending → Accepted",
      explicacion: "Ofertas que estaban en pending y terminamos aceptando, posiblemente después del ETD",
      color: "#9333ea",
      bg: "#faf5ff",
      border: "#e9d5ff"
    },
    {
      id: "arrepentimientos",
      label: "Arrepentimientos",
      icon: "↩️",
      desc: "Accepted → Rejected",
      explicacion: "Ofertas que aceptamos y luego rechazamos. Indican cambio de criterio operativo.",
      color: "#dc2626",
      bg: "#fef2f2",
      border: "#fecaca"
    },
    {
      id: "canceladas_meli",
      label: "Canceladas MELI",
      icon: "❌",
      desc: "Accepted → Canceled",
      explicacion: "Aceptamos y MELI canceló. No es responsabilidad nuestra pero impacta capacidad.",
      color: "#b45309",
      bg: "#fffbeb",
      border: "#fde68a"
    },
    {
      id: "recuperaciones",
      label: "Recuperaciones",
      icon: "♻️",
      desc: "Rejected → Accepted",
      explicacion: "Rechazamos y luego aceptamos. Probablemente tras revisión operativa.",
      color: "#16a34a",
      bg: "#f0fdf4",
      border: "#bbf7d0"
    },
    {
      id: "pending_rechazadas",
      label: "Pending rechazadas",
      icon: "⛔",
      desc: "Pending → Rejected",
      explicacion: "Ofertas que ignoramos hasta el final y terminamos rechazando.",
      color: "#64748b",
      bg: "#f1f5f9",
      border: "#cbd5e1"
    },
  ];

  const periodoTexto = data.es_rango
    ? `${data.fecha_desde} a ${data.fecha_hasta}`
    : data.fecha_desde;

  return (
    <div className="pg">
      <div className="sec-title">Ventana de Decisiones</div>
      <div className="sec-sub">
        Cambios de estado en Travel Requests · período {periodoTexto}
      </div>

      {/* Selector de modo y fechas */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 20, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8 }}>
          <button onClick={() => setModo("dia")} style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: "none", cursor: "pointer",
            background: modo === "dia" ? "#002E5D" : "transparent",
            color: modo === "dia" ? "#fff" : "#475569"
          }}>Día</button>
          <button onClick={() => setModo("rango")} style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: "none", cursor: "pointer",
            background: modo === "rango" ? "#002E5D" : "transparent",
            color: modo === "rango" ? "#fff" : "#475569"
          }}>Rango</button>
        </div>
        {modo === "dia" ? (
          <input type="date" value={fechaDia} onChange={(e) => setFechaDia(e.target.value)} style={{
            padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1"
          }} />
        ) : (
          <>
            <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} style={{
              padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1"
            }} />
            <span style={{ color: "#64748b" }}>→</span>
            <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} style={{
              padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1"
            }} />
          </>
        )}
      </div>

      {/* Cabecera con total */}
      <div style={{
        background: "linear-gradient(135deg, #002E5D 0%, #0f1e3d 100%)",
        borderRadius: 12, padding: 20, marginBottom: 16, color: "#fff"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.9 }}>🔄 Total de cambios detectados</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Ofertas TR cuyo estado cambió durante el período</div>
          </div>
          <div style={{ fontSize: 48, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            {totalCambios}
          </div>
        </div>
      </div>

      {/* Tarjetas de tipos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
        {tiposConfig.map(t => {
          const cantidad = totales[t.id] || 0;
          const expandida = tipoExpandido === t.id;
          return (
            <div key={t.id}
              onClick={() => {
                if (cantidad === 0) return;
                setTipoExpandido(expandida ? null : t.id);
                setScExpandido(null);
              }}
              style={{
                background: t.bg,
                borderRadius: 10,
                padding: 14,
                border: `1px solid ${expandida ? t.color : t.border}`,
                borderWidth: expandida ? 2 : 1,
                cursor: cantidad > 0 ? "pointer" : "default",
                opacity: cantidad === 0 ? 0.6 : 1,
                transition: "all 0.15s",
                position: "relative"
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.color, textTransform: "uppercase", letterSpacing: 0.3 }}>
                  {t.label}
                </span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: t.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                {cantidad}
              </div>
              <div style={{ fontSize: 10, color: t.color, opacity: 0.7, marginTop: 4 }}>
                {t.desc}
              </div>
              {cantidad > 0 && (
                <div style={{ fontSize: 9, color: t.color, opacity: 0.6, marginTop: 6, fontWeight: 600 }}>
                  {expandida ? "▲ Cerrar" : "▼ Click para ver SCs"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Drill-down: SCs del tipo expandido */}
      {tipoExpandido && (() => {
        const tipo = tiposConfig.find(t => t.id === tipoExpandido);
        const scs = desglose[tipoExpandido] || [];
        const rutas = detalles[tipoExpandido] || [];
        return (
          <div style={{
            background: "#fff",
            borderRadius: 12,
            padding: 20,
            marginBottom: 16,
            border: `2px solid ${tipo.color}`
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: tipo.color }}>
                  {tipo.icon} {tipo.label}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {tipo.explicacion}
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: tipo.color }}>
                {totales[tipoExpandido]}
              </div>
            </div>

            {/* Tabla de SCs */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Desglose por Service Center
              </div>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700 }}>SC</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700 }}>Total</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700 }}>SDD</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700 }}>Variable</th>
                    <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700 }}>Vehículos</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", fontWeight: 700 }}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {scs.map((sc, i) => {
                    const expSc = scExpandido === sc.sc;
                    return (
                      <tr key={i}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: expSc ? tipo.bg : (i % 2 === 0 ? "#fafbfc" : "#fff"),
                          cursor: "pointer"
                        }}
                        onClick={() => setScExpandido(expSc ? null : sc.sc)}>
                        <td style={{ padding: "8px 10px", fontWeight: 600, color: "#0f172a" }}>{sc.sc}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: tipo.color, fontVariantNumeric: "tabular-nums" }}>{sc.cantidad}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#9a3412", fontVariantNumeric: "tabular-nums" }}>{sc.sdd || 0}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#3730a3", fontVariantNumeric: "tabular-nums" }}>{sc.variable || 0}</td>
                        <td style={{ padding: "8px 10px", color: "#64748b", fontSize: 11 }}>{sc.vehiculos}</td>
                        <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 11, color: tipo.color, fontWeight: 600 }}>
                          {expSc ? "▲" : "▼"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Drill-down nivel 3: rutas individuales del SC */}
            {scExpandido && (() => {
              const rutasSc = rutas.filter(r => r.sc === scExpandido);
              return (
                <div style={{ background: tipo.bg, borderRadius: 8, padding: 12, marginTop: 8, border: `1px solid ${tipo.border}` }}>
                  <div style={{ fontSize: 11, color: tipo.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                    Rutas individuales · {scExpandido} ({rutasSc.length})
                  </div>
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                      <thead style={{ position: "sticky", top: 0, background: tipo.bg, zIndex: 1 }}>
                        <tr style={{ borderBottom: `1px solid ${tipo.border}`, color: tipo.color }}>
                          {data.es_rango && <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Fecha op.</th>}
                          <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Request ID</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Travel ID</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Vehículo</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Tipo</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Trayectoria</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 700 }}>Último cambio</th>
                          <th style={{ textAlign: "right", padding: "4px 8px", fontWeight: 700 }}>Hs vs ETD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rutasSc.map((r, i) => (
                          <tr key={i} style={{ borderBottom: `1px dashed ${tipo.border}` }}>
                            {data.es_rango && <td style={{ padding: "4px 8px", color: "#475569" }}>{r.fecha}</td>}
                            <td style={{ padding: "4px 8px", color: "#475569", fontFamily: "monospace" }}>{r.request_id}</td>
                            <td style={{ padding: "4px 8px", color: "#475569", fontFamily: "monospace" }}>{r.travel_id || "—"}</td>
                            <td style={{ padding: "4px 8px", color: "#475569" }}>{r.vehiculo}</td>
                            <td style={{ padding: "4px 8px", fontWeight: 600, color: r.es_sdd ? "#9a3412" : "#3730a3" }}>
                              {r.es_sdd ? "SDD" : "VAR"}
                            </td>
                            <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 10, color: tipo.color, fontWeight: 600 }}>
                              {r.estado_inicial} → {r.estado_final}
                            </td>
                            <td style={{ padding: "4px 8px", color: "#64748b", fontSize: 10 }}>
                              {r.momento_cambio ? new Date(r.momento_cambio).toLocaleString('es-MX', {
                                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                              }) : "—"}
                            </td>
                            <td style={{ padding: "4px 8px", textAlign: "right", color: r.horas_vs_etd > 0 ? "#dc2626" : "#16a34a", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                              {r.horas_vs_etd != null ? `${r.horas_vs_etd > 0 ? '+' : ''}${r.horas_vs_etd}h` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10, color: tipo.color, opacity: 0.7, marginTop: 8, fontStyle: "italic" }}>
                    💡 "Hs vs ETD" en positivo: el cambio ocurrió DESPUÉS del horario de salida planeado.
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Mensaje cuando no hay datos */}
      {totalCambios === 0 && (
        <div style={{
          background: "#f0fdf4",
          borderRadius: 12,
          padding: 24,
          textAlign: "center",
          border: "1px solid #bbf7d0"
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#166534" }}>Sin cambios de estado en este período</div>
          <div style={{ fontSize: 11, color: "#166534", marginTop: 4, opacity: 0.8 }}>
            Todas las ofertas TR mantuvieron su estado inicial.
          </div>
        </div>
      )}
    </div>
  );
}

// ── CICLO con embudo moderno + filtros mejorados ──────────────────────────
function PoolMeliCiclo({ scs, resumen, setModal, mesGlobal }) {
  const [perfilFiltro, setPerfilFiltro] = useState("TODOS");
  const r = resumen || {};

  // Helper de estilo para enlaces clickeables (números con underline al hover)
  const linkStyle = (color, bold = false) => ({
    background: "transparent",
    border: "none",
    color,
    cursor: "pointer",
    fontWeight: bold ? 700 : 600,
    fontSize: "inherit",
    fontVariantNumeric: "tabular-nums",
    padding: 0,
    textDecoration: "underline",
    textDecorationColor: "transparent",
    textUnderlineOffset: 3,
    transition: "text-decoration-color 0.15s",
  });

  // Split de no presentadas por fleet (SDD vs VARIABLE)
  const [splitFleet, setSplitFleet] = useState({ sdd: null, variable: null });

  // Trayectorias de Estado y Matrix Embudo↔Cumplimiento
  const [trayectorias, setTrayectorias] = useState([]);
  const [matrixData, setMatrixData] = useState([]);

  // Recargar split fleet cuando cambia el mes global
  useEffect(() => {
    if (!mesGlobal) return;
    let alive = true;
    (async () => {
      try {
        const { desde, hasta } = rangoMesGlobal(mesGlobal);
        
        const { data: fleetData, error: fleetError } = await sb.rpc("get_no_presentadas_por_fleet", {
          fecha_desde: desde,
          fecha_hasta: hasta,
        });
        if (!alive) return;
        if (fleetError) {
          console.error("Error cargando split fleet:", fleetError);
          setSplitFleet({ sdd: null, variable: null });
        } else {
          const sddRow = (fleetData || []).find(r => r.fleet_type === 'SDD');
          const varRow = (fleetData || []).find(r => r.fleet_type === 'VARIABLE');
          setSplitFleet({
            sdd: sddRow ? { 
              aceptadas: Number(sddRow.aceptadas), 
              ejecutadas: Number(sddRow.ejecutadas), 
              no_presentadas: Number(sddRow.no_presentadas) 
            } : null,
            variable: varRow ? { 
              aceptadas: Number(varRow.aceptadas), 
              ejecutadas: Number(varRow.ejecutadas), 
              no_presentadas: Number(varRow.no_presentadas) 
            } : null,
          });
        }

        // Trayectorias de estado
        const { data: trayData, error: trayError } = await sb.rpc("get_trayectorias_estado", {
          p_desde: desde,
          p_hasta: hasta,
        });
        if (!alive) return;
        if (trayError) {
          console.error("Error cargando trayectorias:", trayError);
          setTrayectorias([]);
        } else {
          setTrayectorias(trayData || []);
        }

        // Matrix Embudo ↔ Cumplimiento
        const { data: mData, error: mError } = await sb.rpc("get_matrix_embudo_cumplimiento", {
          p_desde: desde,
          p_hasta: hasta,
        });
        if (!alive) return;
        if (mError) {
          console.error("Error cargando matrix:", mError);
          setMatrixData([]);
        } else {
          setMatrixData(mData || []);
        }
      } catch (e) {
        console.error("Error cargando ciclo del mes:", e);
        if (alive) {
          setSplitFleet({ sdd: null, variable: null });
          setTrayectorias([]);
          setMatrixData([]);
        }
      }
    })();
    return () => { alive = false; };
  }, [mesGlobal?.anio, mesGlobal?.mes]);

  const filtrados = perfilFiltro === "TODOS" ? scs : scs.filter(s => s.perfil === perfilFiltro);
  const totOfr = scs.reduce((a, s) => a + (s.ofrecidas || 0), 0);
  const totAcc = scs.reduce((a, s) => a + (s.aceptadas || 0), 0);
  const totEjec = scs.reduce((a, s) => a + (s.ejecutadas || 0), 0);
  const totNoPres = scs.reduce((a, s) => a + (s.no_presentadas || 0), 0);
  const totRech = scs.reduce((a, s) => a + (s.rechazadas || 0), 0);
  const totCanc = scs.reduce((a, s) => a + (s.canceladas || 0), 0);
  const totPend = scs.reduce((a, s) => a + (s.pendientes || 0), 0);
  const conteoPorPerfil = (p) => scs.filter(s => s.perfil === p).length;
  const problematicos = scs.filter(s => s.perfil === "PROBLEMATICO");

  // Modales con datos
  const abrirRechazadas = async (filtroSC = null) => {
    const tituloSC = filtroSC ? ` · ${filtroSC}` : "";
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "rechazadas" });
    try {
      let q = sb.from("vw_meli_tr_rechazadas").select("*").order("fecha", { ascending: false });
      if (filtroSC) q = q.eq("service_center", filtroSC);
      const { data, error } = await q;
      if (error) throw error;
      setModal({
        titulo: `Viajes RECHAZADOS${tituloSC} (${(data || []).length})`,
        filas: data || [],
        nombreArchivo: filtroSC ? `rechazadas_${filtroSC}` : "rechazadas"
      });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  const abrirCanceladas = async (filtroSC = null) => {
    const tituloSC = filtroSC ? ` · ${filtroSC}` : "";
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "canceladas" });
    try {
      let q = sb.from("vw_meli_tr_canceladas").select("*").order("fecha", { ascending: false });
      if (filtroSC) q = q.eq("service_center", filtroSC);
      const { data, error } = await q;
      if (error) throw error;
      setModal({
        titulo: `Viajes CANCELADOS${tituloSC} (${(data || []).length})`,
        filas: data || [],
        nombreArchivo: filtroSC ? `canceladas_${filtroSC}` : "canceladas"
      });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  // Pendientes (último snapshot, sin respuesta del carrier)
  const abrirPendientes = async (filtroSC = null) => {
    if (!mesGlobal) return;
    const tituloSC = filtroSC ? ` · ${filtroSC}` : "";
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "pendientes" });
    try {
      const { desde, hasta } = rangoMesGlobal(mesGlobal);
      // Traemos los pending del último snapshot por request_id
      const { data: rawData, error } = await sb
        .from("meli_travel_requests")
        .select("request_id, facility_id, fecha, status, vehicle_type, fecha_snapshot, hora_snapshot, attributes")
        .eq("status", "pending")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha_snapshot", { ascending: false })
        .order("hora_snapshot", { ascending: false });
      if (error) throw error;
      // Dedup por request_id (último snapshot)
      const seen = new Set();
      let dedup = (rawData || []).filter(r => {
        if (seen.has(r.request_id)) return false;
        seen.add(r.request_id);
        return true;
      });
      if (filtroSC) dedup = dedup.filter(r => r.facility_id === filtroSC);
      // Calcular días pasados desde la fecha de operación
      const hoy = new Date();
      const filas = dedup.map(r => {
        const fechaOp = new Date(r.fecha);
        const diasPasados = Math.floor((hoy - fechaOp) / (1000 * 60 * 60 * 24));
        const fleet = r.attributes && Array.isArray(r.attributes) && r.attributes.some(a => a.id === 'sdd') ? 'SDD' : 'VARIABLE';
        return {
          request_id: r.request_id,
          service_center: r.facility_id,
          fecha_operacion: r.fecha,
          dias_desde_operacion: diasPasados,
          vehicle_type: r.vehicle_type,
          fleet,
          ultimo_snapshot: `${r.fecha_snapshot} ${r.hora_snapshot || ''}`,
          critico: diasPasados > 0 ? 'SÍ' : 'NO'
        };
      });
      setModal({
        titulo: `Viajes PENDIENTES sin respuesta${tituloSC} (${filas.length})`,
        filas,
        nombreArchivo: filtroSC ? `pendientes_${filtroSC}` : "pendientes"
      });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  // No presentadas con filtros completos (SC, fecha, % min)
  const abrirNoPresentadas = async (filtroSC = null) => {
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "no_presentadas" });
    try {
      let q = sb.from("vw_meli_no_presentadas").select("*").order("fecha", { ascending: false });
      if (filtroSC) q = q.eq("service_center", filtroSC);
      const { data, error } = await q;
      if (error) throw error;
      const filas = data || [];
      setModal({
        titulo: filtroSC ? `Viajes NO PRESENTADOS · ${filtroSC} (${filas.length})` : `Viajes NO PRESENTADOS · todos los SCs (${filas.length})`,
        filas,
        nombreArchivo: filtroSC ? `no_presentadas_${filtroSC}` : "no_presentadas",
        // Componente con UI de filtros propios
        renderFiltrosUI: true,
      });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  const abrirEjecutadas = async (filtroSC = null) => {
    const tituloSC = filtroSC ? ` · ${filtroSC}` : "";
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "ejecutadas" });
    try {
      let q = sb.from("vw_meli_tr_ejecutadas_detalle").select("*").order("fecha", { ascending: false });
      if (filtroSC) q = q.eq("service_center", filtroSC);
      const { data, error } = await q;
      if (error) throw error;
      setModal({
        titulo: `Viajes EJECUTADOS${tituloSC} (${(data || []).length})`,
        filas: data || [],
        nombreArchivo: filtroSC ? `ejecutadas_${filtroSC}` : "ejecutadas"
      });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  const abrirAceptadas = async (filtroSC = null) => {
    const tituloSC = filtroSC ? ` · ${filtroSC}` : "";
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "aceptadas" });
    try {
      let q = sb.from("meli_travel_requests")
        .select("request_id, facility_id, fecha, destination, travel_id, vehicle_type, mel_service_description, etd, eta, status")
        .eq("status", "accepted")
        .order("fecha", { ascending: false });
      if (filtroSC) q = q.eq("facility_id", filtroSC);
      const { data, error } = await q.limit(5000);
      if (error) throw error;
      setModal({
        titulo: `Viajes ACEPTADOS${tituloSC} (${(data || []).length})`,
        filas: data || [],
        nombreArchivo: filtroSC ? `aceptadas_${filtroSC}` : "aceptadas"
      });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  const abrirOfrecidas = async (filtroSC = null) => {
    const tituloSC = filtroSC ? ` · ${filtroSC}` : "";
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "ofrecidas" });
    try {
      let q = sb.from("meli_travel_requests")
        .select("request_id, facility_id, fecha, destination, travel_id, vehicle_type, mel_service_description, etd, eta, status")
        .order("fecha", { ascending: false });
      if (filtroSC) q = q.eq("facility_id", filtroSC);
      const { data, error } = await q.limit(5000);
      if (error) throw error;
      setModal({
        titulo: `Viajes OFRECIDOS${tituloSC} (${(data || []).length})`,
        filas: data || [],
        nombreArchivo: filtroSC ? `ofrecidas_${filtroSC}` : "ofrecidas"
      });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  // Drilldown: Trayectoria de estado
  const abrirTrayectoria = async (trayectoria) => {
    if (!mesGlobal) return;
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "trayectoria" });
    try {
      const { desde, hasta } = rangoMesGlobal(mesGlobal);
      const { data, error } = await sb.rpc("get_trayectorias_detalle", {
        p_desde: desde,
        p_hasta: hasta,
        p_trayectoria: trayectoria,
      });
      if (error) throw error;
      // Mapear nombres amigables
      const filas = (data || []).map(d => ({
        "Request ID": d.request_id,
        "SC": d.facility_id,
        "Fecha Op.": d.fecha_operacion,
        "Estado Inicial": d.estado_inicial,
        "Estado Final": d.estado_final,
        "Snapshots": d.cantidad_snapshots,
        "Momento del cambio": d.momento_cambio,
        "Horas antes ETD": d.horas_antes_etd,
        "Tipo flota": d.fleet_type,
        "Servicio": d.service_description,
        "Vehículo": d.vehicle_type,
        "ETD": d.etd_date,
      }));
      setModal({
        titulo: `Trayectoria: ${trayectoria} (${filas.length})`,
        filas,
        nombreArchivo: `trayectoria_${trayectoria.replace(/\s|→/g, "_")}`,
      });
    } catch (e) {
      setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" });
    }
  };

  // Drilldown: Matrix (aceptadas o ejecutadas por SC+fecha)
  const abrirMatrixDetalle = async (fecha, sc, tipo) => {
    setModal({ titulo: `Cargando…`, filas: [], nombreArchivo: "matrix" });
    try {
      const { data, error } = await sb.rpc("get_matrix_detalle", {
        p_fecha: fecha,
        p_sc: sc,
        p_tipo: tipo,
      });
      if (error) throw error;
      const filas = (data || []).map(d => {
        if (tipo === "aceptadas") {
          return {
            "Request ID": d.identificador,
            "Origen": d.origen,
            "Tipo flota": d.fleet_type,
            "Servicio": d.service_description,
            "Vehículo": d.vehicle_type,
            "Estado": d.estado_o_ns,
            "ETD": d.driver_o_etd,
          };
        } else {
          return {
            "ID Ruta": d.identificador,
            "Origen": d.origen,
            "Tipo flota": d.fleet_type,
            "Servicio": d.service_description,
            "Vehículo": d.vehicle_type,
            "NS %": d.estado_o_ns,
            "Conductor": d.driver_o_etd,
            "Despachados": d.envios_despachados,
            "Entregados": d.envios_entregados,
          };
        }
      });
      const tituloTipo = tipo === "aceptadas" ? "Aceptadas (TR)" : "Ejecutadas (Maestro)";
      setModal({
        titulo: `${tituloTipo} · ${sc} · ${fecha} (${filas.length})`,
        filas,
        nombreArchivo: `matrix_${tipo}_${sc}_${fecha}`,
      });
    } catch (e) {
      setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" });
    }
  };

  // EMBUDO MODERNO: pirámide horizontal con conexiones
  const pctAcc = totOfr > 0 ? (totAcc / totOfr * 100) : 0;
  const pctEjec = totOfr > 0 ? (totEjec / totOfr * 100) : 0;

  return (
    <div className="pg">
      {/* Embudo moderno */}
      <div className="form-card" style={{ background: "linear-gradient(180deg, #fff 0%, #f8fafc 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div className="form-title" style={{ marginBottom: 4 }}>Embudo del ciclo</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Trayectoria: ofrecidas → aceptadas → ejecutadas
              <span style={{ marginLeft: 8, color: "#94a3b8" }}>· click en cualquier número para ver detalle</span>
            </div>
          </div>
        </div>

        {/* Pirámide moderna */}
        <div style={{ position: "relative", padding: "0 20px" }}>
          {[
            { label: "Ofrecidas por Meli", valor: totOfr, color: "#002E5D", colorLight: "#3b5fa3", pct: 100, onClick: () => abrirOfrecidas(), sublabel: "Total recibido" },
            { label: "Aceptadas por Bigticket", valor: totAcc, color: "#0891b2", colorLight: "#22d3ee", pct: pctAcc, onClick: () => abrirAceptadas(), sublabel: `${pctAcc.toFixed(1)}% del total` },
            { label: "Ejecutadas en operación", valor: totEjec, color: "#10b981", colorLight: "#34d399", pct: pctEjec, onClick: () => abrirEjecutadas(), sublabel: `${pctEjec.toFixed(1)}% del total · ${totAcc > 0 ? (totEjec/totAcc*100).toFixed(0) : 0}% de las aceptadas` },
          ].map((stage, i) => {
            const widthPct = stage.pct;
            const isLast = i === 2;
            return (
              <div key={stage.label}>
                <div onClick={stage.onClick}
                  style={{
                    cursor: "pointer",
                    background: `linear-gradient(135deg, ${stage.color} 0%, ${stage.colorLight} 100%)`,
                    width: `${widthPct}%`,
                    margin: "0 auto",
                    padding: "18px 24px",
                    borderRadius: 12,
                    color: "#fff",
                    boxShadow: `0 4px 12px ${stage.color}33, inset 0 1px 0 rgba(255,255,255,0.15)`,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    transition: "transform 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.01)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.85, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontWeight: 600 }}>
                      Etapa {i + 1}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{stage.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{stage.sublabel}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {stage.valor.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 9, opacity: 0.7, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>VER DETALLE →</div>
                  </div>
                </div>
                
                {/* Conexión visual entre etapas */}
                {!isLast && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
                    <div style={{ width: 0, height: 16, borderLeft: "2px dashed #cbd5e1" }}></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pérdidas */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 24, paddingTop: 16, borderTop: "1px dashed #e4e7ec" }}>
          <div onClick={() => abrirRechazadas()}
            style={{ background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)", borderRadius: 8, padding: 14, cursor: "pointer", border: "1px solid #fecaca" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
              <span>Rechazadas</span><span style={{ fontSize: 9, opacity: 0.7 }}>VER →</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#991b1b" }}>{totRech.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: "#7f1d1d", marginTop: 2 }}>{totOfr > 0 ? Math.round(totRech / totOfr * 100) : 0}% de ofrecidas</div>
          </div>
          <div onClick={() => abrirCanceladas()}
            style={{ background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)", borderRadius: 8, padding: 14, cursor: "pointer", border: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
              <span>Canceladas</span><span style={{ fontSize: 9, opacity: 0.7 }}>VER →</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#475569" }}>{totCanc.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{totOfr > 0 ? Math.round(totCanc / totOfr * 100) : 0}% de ofrecidas</div>
          </div>
          <div onClick={() => abrirPendientes()}
            style={{ background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)", borderRadius: 8, padding: 14, cursor: "pointer", border: "1px solid #e9d5ff" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#6b21a8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
              <span>Pendientes</span><span style={{ fontSize: 9, opacity: 0.7 }}>VER →</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#6b21a8" }}>{totPend.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: "#7e22ce", marginTop: 2 }}>sin respuesta del carrier</div>
          </div>
          <div onClick={() => abrirNoPresentadas()}
            style={{ background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", borderRadius: 8, padding: 14, cursor: "pointer", border: "1px solid #fde68a" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
              <span>No presentadas</span><span style={{ fontSize: 9, opacity: 0.7 }}>FILTROS →</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#92400e" }}>{totNoPres.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: "#92400e", marginTop: 2 }}>aceptadas - ejecutadas</div>
            
            {/* Split SDD vs Variable */}
            {splitFleet.sdd && splitFleet.variable && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #fde68a", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {/* SDD */}
                <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                    SDD <span style={{ color: "#94a3b8", fontWeight: 500 }}>(Súper Dedicada)</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#92400e", lineHeight: 1 }}>
                    {splitFleet.sdd.no_presentadas.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 9, color: "#92400e", marginTop: 3 }}>
                    {splitFleet.sdd.aceptadas} acept · {splitFleet.sdd.ejecutadas} ejec
                  </div>
                  <div style={{ fontSize: 9, color: splitFleet.sdd.aceptadas > 0 && (splitFleet.sdd.no_presentadas / splitFleet.sdd.aceptadas) < 0.10 ? "#047857" : "#92400e", fontWeight: 600, marginTop: 1 }}>
                    {splitFleet.sdd.aceptadas > 0 ? ((splitFleet.sdd.no_presentadas / splitFleet.sdd.aceptadas) * 100).toFixed(1) : "0.0"}% no-show
                  </div>
                </div>
                {/* Variable */}
                <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                    Variable <span style={{ color: "#94a3b8", fontWeight: 500 }}>(Flota libre)</span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#92400e", lineHeight: 1 }}>
                    {splitFleet.variable.no_presentadas.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 9, color: "#92400e", marginTop: 3 }}>
                    {splitFleet.variable.aceptadas} acept · {splitFleet.variable.ejecutadas} ejec
                  </div>
                  <div style={{ fontSize: 9, color: splitFleet.variable.aceptadas > 0 && (splitFleet.variable.no_presentadas / splitFleet.variable.aceptadas) < 0.10 ? "#047857" : "#92400e", fontWeight: 600, marginTop: 1 }}>
                    {splitFleet.variable.aceptadas > 0 ? ((splitFleet.variable.no_presentadas / splitFleet.variable.aceptadas) * 100).toFixed(1) : "0.0"}% no-show
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filtros perfil */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "16px 0" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginRight: 4 }}>Filtrar:</span>
        {["TODOS", "IDEAL", "INCONSISTENTE", "PROBLEMATICO"].map(p => {
          const c = p === "TODOS" ? scs.length : conteoPorPerfil(p);
          const active = perfilFiltro === p;
          return (
            <button key={p} onClick={() => setPerfilFiltro(p)}
              style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 4,
                border: active ? "none" : "1px solid #e4e7ec",
                background: active ? "#0f172a" : "#fff",
                color: active ? "#fff" : "#475569",
                cursor: "pointer", fontFamily: "'Open Sans', sans-serif" }}>
              {p === "TODOS" ? "Todos" : p}
              <span style={{ marginLeft: 6, opacity: 0.6 }}>({c})</span>
            </button>
          );
        })}
      </div>

      {/* Tabla por SC */}
      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
          <div style={{ fontSize: 11, color: "#64748b" }}>Hacé click en cualquier número para ver el detalle de ese SC</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={pm_thStyle}>SC</th>
                <th style={pm_thStyleR}>Ofrecidas</th>
                <th style={pm_thStyleR}>Aceptadas</th>
                <th style={pm_thStyleR}>Rechazadas</th>
                <th style={pm_thStyleR}>Ejecutadas</th>
                <th style={pm_thStyleR}>No present.</th>
                <th style={pm_thStyleR}>Cumpl.</th>
                <th style={{ ...pm_thStyle, textAlign: "center" }}>Perfil</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(s => {
                const cumpl = s.aceptadas > 0 ? (s.ejecutadas / s.aceptadas * 100).toFixed(0) : 0;
                const cumplColor = cumpl >= 90 ? "#047857" : cumpl >= 70 ? "#92400e" : "#991b1b";
                const linkStyle = (color, bold = false) => ({
                  background: "transparent", border: "none", cursor: "pointer",
                  color, fontWeight: bold ? 700 : 400, padding: 0,
                  fontFamily: "inherit", fontSize: 12, fontVariantNumeric: "tabular-nums",
                  textDecoration: "underline", textDecorationColor: "transparent",
                });
                return (
                  <tr key={s.service_center} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ ...pm_tdStyle, fontFamily: "monospace", fontWeight: 700 }}>{s.service_center}</td>
                    <td style={pm_tdStyleR}>
                      <button onClick={() => abrirOfrecidas(s.service_center)} style={linkStyle("#0f172a")}
                        onMouseEnter={e => e.currentTarget.style.textDecorationColor = "#0f172a"}
                        onMouseLeave={e => e.currentTarget.style.textDecorationColor = "transparent"}>{s.ofrecidas}</button>
                    </td>
                    <td style={pm_tdStyleR}>
                      <button onClick={() => abrirAceptadas(s.service_center)} style={linkStyle("#0891b2")}
                        onMouseEnter={e => e.currentTarget.style.textDecorationColor = "#0891b2"}
                        onMouseLeave={e => e.currentTarget.style.textDecorationColor = "transparent"}>{s.aceptadas}</button>
                    </td>
                    <td style={pm_tdStyleR}>
                      <button onClick={() => abrirRechazadas(s.service_center)} style={linkStyle(s.rechazadas > 50 ? "#991b1b" : "#64748b")}
                        onMouseEnter={e => e.currentTarget.style.textDecorationColor = s.rechazadas > 50 ? "#991b1b" : "#64748b"}
                        onMouseLeave={e => e.currentTarget.style.textDecorationColor = "transparent"}>{s.rechazadas}</button>
                    </td>
                    <td style={pm_tdStyleR}>
                      <button onClick={() => abrirEjecutadas(s.service_center)} style={linkStyle("#047857")}
                        onMouseEnter={e => e.currentTarget.style.textDecorationColor = "#047857"}
                        onMouseLeave={e => e.currentTarget.style.textDecorationColor = "transparent"}>{s.ejecutadas}</button>
                    </td>
                    <td style={pm_tdStyleR}>
                      <button onClick={() => abrirNoPresentadas(s.service_center)} style={linkStyle(s.no_presentadas > 20 ? "#991b1b" : "#92400e", true)}
                        onMouseEnter={e => e.currentTarget.style.textDecorationColor = s.no_presentadas > 20 ? "#991b1b" : "#92400e"}
                        onMouseLeave={e => e.currentTarget.style.textDecorationColor = "transparent"}>{s.no_presentadas}</button>
                    </td>
                    <td style={{ ...pm_tdStyleR, fontWeight: 700, color: cumplColor }}>{cumpl}%</td>
                    <td style={{ ...pm_tdStyle, textAlign: "center" }}><PerfilBadgeMX perfil={s.perfil} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alertas */}
      {problematicos.length > 0 && (
        <div style={{ background: "#fef2f2", borderLeft: "4px solid #b91c1c", borderRadius: 8, padding: 16, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>⚠ SCs críticos requieren acción inmediata</div>
          <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.7 }}>
            {problematicos.map(s => {
              const cumpl = s.aceptadas > 0 ? Math.round(s.ejecutadas / s.aceptadas * 100) : 0;
              return (
                <div key={s.service_center} style={{ marginBottom: 6 }}>
                  <strong>{s.service_center}:</strong> {s.ofrecidas} ofrecidas, aceptó {s.aceptadas}, ejecutó {s.ejecutadas} ({cumpl}% cumplimiento). {s.no_presentadas} no presentadas.
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* BLOQUE: Trayectorias de Estado                                      */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {trayectorias.length > 0 && (() => {
        const conCambio = trayectorias.filter(t => t.tipo === "Con cambio" && Number(t.cantidad_ofertas) > 0);
        const sinCambio = trayectorias.filter(t => t.tipo === "Sin cambio");
        const totalCambios = conCambio.reduce((a, t) => a + Number(t.cantidad_ofertas), 0);
        const totalSinCambio = sinCambio.reduce((a, t) => a + Number(t.cantidad_ofertas), 0);
        const totalOfertas = totalCambios + totalSinCambio;
        const pctEstable = totalOfertas > 0 ? ((totalSinCambio / totalOfertas) * 100).toFixed(1) : "0.0";

        // Mapeo de etiquetas amigables
        const etiquetasTray = {
          "accepted → rejected": { 
            label: "Aceptada → Rechazada", 
            emoji: "🔴", 
            color: "#991b1b", 
            bg: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)", 
            border: "#fecaca",
            descripcion: "Echarse atrás" 
          },
          "accepted → canceled": { 
            label: "Aceptada → Cancelada", 
            emoji: "🟠", 
            color: "#9a3412", 
            bg: "linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%)", 
            border: "#fdba74",
            descripcion: "MELI canceló" 
          },
          "pending → accepted": { 
            label: "Pending → Aceptada", 
            emoji: "🟢", 
            color: "#166534", 
            bg: "linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)", 
            border: "#86efac",
            descripcion: "Recuperación tardía" 
          },
          "pending → rejected": { 
            label: "Pending → Rechazada", 
            emoji: "🟡", 
            color: "#854d0e", 
            bg: "linear-gradient(135deg, #fefce8 0%, #fef08a 100%)", 
            border: "#fde047",
            descripcion: "Decisión consciente" 
          },
        };
        const pendingPending = sinCambio.find(t => t.trayectoria === "pending → pending");

        return (
          <div className="form-card" style={{ marginTop: 20, background: "linear-gradient(180deg, #fff 0%, #f8fafc 100%)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div className="form-title" style={{ marginBottom: 4 }}>🔄 Trayectorias de Estado</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Cómo evolucionan las ofertas entre snapshots
                  <span style={{ marginLeft: 8, color: "#94a3b8" }}>· click en cualquier card para ver detalle</span>
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#64748b" }}>
                <div><strong style={{ color: "#10b981" }}>{pctEstable}%</strong> estables</div>
                <div><strong style={{ color: "#dc2626" }}>{totalCambios}</strong> con cambio</div>
              </div>
            </div>

            {/* Cards de cambios */}
            {conCambio.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                  ⚠️ Atención · Cambios de estado
                </div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(conCambio.length, 4)}, 1fr)`, gap: 12, marginBottom: 16 }}>
                  {conCambio.map(t => {
                    const meta = etiquetasTray[t.trayectoria] || { 
                      label: t.trayectoria, emoji: "❓", color: "#475569", 
                      bg: "#f8fafc", border: "#e2e8f0", descripcion: "" 
                    };
                    return (
                      <div key={t.trayectoria}
                        onClick={() => abrirTrayectoria(t.trayectoria)}
                        style={{ 
                          background: meta.bg, 
                          borderRadius: 10, 
                          padding: 14, 
                          cursor: "pointer", 
                          border: `1px solid ${meta.border}`,
                          transition: "transform 0.15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"}
                        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
                          <span>{meta.emoji} {meta.label}</span>
                          <span style={{ fontSize: 9, opacity: 0.7 }}>VER →</span>
                        </div>
                        <div style={{ fontSize: 26, fontWeight: 800, color: meta.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                          {Number(t.cantidad_ofertas).toLocaleString()}
                        </div>
                        <div style={{ fontSize: 11, color: meta.color, opacity: 0.85, marginTop: 4, fontStyle: "italic" }}>
                          {meta.descripcion}
                        </div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${meta.border}` }}>
                          {t.cantidad_scs} SC{t.cantidad_scs === 1 ? "" : "s"}: <strong>{t.scs_involucrados}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Card de oportunidades perdidas (pending → pending) */}
            {pendingPending && Number(pendingPending.cantidad_ofertas) > 0 && (
              <div
                onClick={() => abrirTrayectoria("pending → pending")}
                style={{ 
                  background: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)", 
                  borderLeft: "4px solid #ca8a04", 
                  borderRadius: 8, 
                  padding: 14, 
                  marginBottom: 16,
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transition: "transform 0.15s",
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "scale(1.005)"}
                onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                    🟡 Oportunidades perdidas
                  </div>
                  <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>
                    Pending sin respuesta
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    MELI las rota a otro carrier = negocio perdido directo · SCs: <strong>{pendingPending.scs_involucrados}</strong>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: "#854d0e", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                    {Number(pendingPending.cantidad_ofertas).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 9, color: "#854d0e", opacity: 0.7, marginTop: 2 }}>VER DETALLE →</div>
                </div>
              </div>
            )}

            {/* Resumen de estables */}
            {sinCambio.length > 0 && (
              <div style={{ 
                background: "#f0fdf4", 
                border: "1px solid #bbf7d0", 
                borderRadius: 8, 
                padding: 12, 
                fontSize: 12, 
                color: "#166534" 
              }}>
                ✅ <strong>Comportamiento estable:</strong> {totalSinCambio.toLocaleString()} ofertas mantuvieron su estado ({pctEstable}% del total)
                <span style={{ marginLeft: 6, color: "#64748b", fontSize: 11 }}>
                  · {sinCambio.filter(t => t.trayectoria !== "pending → pending").map(t => 
                      `${t.trayectoria.split(" → ")[0]}: ${Number(t.cantidad_ofertas).toLocaleString()}`
                    ).join(" · ")}
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* BLOQUE: Matrix Embudo ↔ Cumplimiento                                */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      {matrixData.length > 0 && (() => {
        // Totales agregados del período
        const totAceptadas = matrixData.reduce((a, r) => a + Number(r.tr_aceptadas || 0), 0);
        const totEjecutadas = matrixData.reduce((a, r) => a + Number(r.rutas_ejecutadas || 0), 0);
        const totLeakage = matrixData.reduce((a, r) => a + Number(r.aceptadas_no_ejecutadas || 0), 0);
        const totSDDPre = matrixData.reduce((a, r) => a + Number(r.ejecutadas_sin_aceptar || 0), 0);
        const cumplGlobal = totAceptadas > 0 ? ((totAceptadas - totLeakage) / totAceptadas * 100) : 0;

        // Casos críticos: leakage > 20% y al menos 3 ofertas perdidas
        const criticos = matrixData
          .filter(r => Number(r.aceptadas_no_ejecutadas) >= 3 && Number(r.cumplimiento_pct) < 80)
          .sort((a, b) => Number(a.cumplimiento_pct) - Number(b.cumplimiento_pct))
          .slice(0, 10);

        return (
          <div className="form-card" style={{ marginTop: 20, background: "linear-gradient(180deg, #fff 0%, #f8fafc 100%)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div className="form-title" style={{ marginBottom: 4 }}>🎯 Matrix Embudo ↔ Cumplimiento</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  De las que aceptamos, ¿cuáles realmente se ejecutaron? Vinculación agregada por SC + fecha
                  <span style={{ marginLeft: 8, color: "#94a3b8" }}>· click en cualquier celda para ver detalle</span>
                </div>
              </div>
            </div>

            {/* Resumen de KPIs del período */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)", borderRadius: 8, padding: 12, border: "1px solid #a5f3fc" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#155e75", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Aceptadas (TR)</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#0e7490", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{totAceptadas.toLocaleString()}</div>
              </div>
              <div style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #bbf7d0 100%)", borderRadius: 8, padding: 12, border: "1px solid #86efac" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#14532d", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Ejecutadas (Maestro)</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#166534", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{totEjecutadas.toLocaleString()}</div>
              </div>
              <div style={{ background: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)", borderRadius: 8, padding: 12, border: "1px solid #fecaca" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#7f1d1d", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>🔴 Leakage</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#991b1b", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{totLeakage.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "#991b1b", opacity: 0.85, marginTop: 4 }}>aceptadas no ejecutadas</div>
              </div>
              <div style={{ background: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)", borderRadius: 8, padding: 12, border: "1px solid #fde047" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#713f12", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>🟡 SDD pre-asignadas</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#854d0e", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{totSDDPre.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "#854d0e", opacity: 0.85, marginTop: 4 }}>sin pasar por TR</div>
              </div>
            </div>

            {/* Cumplimiento global */}
            <div style={{
              background: cumplGlobal >= 95 ? "#f0fdf4" : cumplGlobal >= 85 ? "#fefce8" : "#fef2f2",
              border: `1px solid ${cumplGlobal >= 95 ? "#bbf7d0" : cumplGlobal >= 85 ? "#fde047" : "#fecaca"}`,
              borderRadius: 8,
              padding: 14,
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                  Cumplimiento global del período
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  De cada 100 aceptadas, {Math.round(cumplGlobal)} llegaron a operar
                </div>
              </div>
              <div style={{ 
                fontSize: 36, 
                fontWeight: 800, 
                color: cumplGlobal >= 95 ? "#166534" : cumplGlobal >= 85 ? "#854d0e" : "#991b1b",
                fontVariantNumeric: "tabular-nums", 
                lineHeight: 1 
              }}>
                {cumplGlobal.toFixed(1)}%
              </div>
            </div>

            {/* Casos críticos */}
            {criticos.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                  🚨 Top {criticos.length} casos críticos · click para ver detalle
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
                        <th style={{ ...pm_thStyle, textAlign: "left" }}>SC</th>
                        <th style={pm_thStyle}>Fecha</th>
                        <th style={{ ...pm_thStyle, textAlign: "right" }}>Aceptadas</th>
                        <th style={{ ...pm_thStyle, textAlign: "right" }}>Ejecutadas</th>
                        <th style={{ ...pm_thStyle, textAlign: "right" }}>No ejec.</th>
                        <th style={{ ...pm_thStyle, textAlign: "right" }}>Cumpl.%</th>
                        <th style={{ ...pm_thStyle, textAlign: "left" }}>Interpretación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {criticos.map((row, idx) => {
                        const cumpl = Number(row.cumplimiento_pct);
                        const cumplColor = cumpl >= 95 ? "#166534" : cumpl >= 85 ? "#854d0e" : "#991b1b";
                        return (
                          <tr key={`${row.sc}-${row.fecha}-${idx}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ ...pm_tdStyle, fontWeight: 700 }}>{row.sc}</td>
                            <td style={{ ...pm_tdStyle, textAlign: "center" }}>{row.fecha}</td>
                            <td style={pm_tdStyleR}>
                              <button onClick={() => abrirMatrixDetalle(row.fecha, row.sc, "aceptadas")}
                                style={linkStyle("#0e7490", true)}
                                onMouseEnter={e => e.currentTarget.style.textDecorationColor = "#0e7490"}
                                onMouseLeave={e => e.currentTarget.style.textDecorationColor = "transparent"}>
                                {row.tr_aceptadas}
                              </button>
                            </td>
                            <td style={pm_tdStyleR}>
                              <button onClick={() => abrirMatrixDetalle(row.fecha, row.sc, "ejecutadas")}
                                style={linkStyle("#166534", true)}
                                onMouseEnter={e => e.currentTarget.style.textDecorationColor = "#166534"}
                                onMouseLeave={e => e.currentTarget.style.textDecorationColor = "transparent"}>
                                {row.rutas_ejecutadas}
                              </button>
                            </td>
                            <td style={{ ...pm_tdStyleR, color: "#991b1b", fontWeight: 700 }}>{row.aceptadas_no_ejecutadas}</td>
                            <td style={{ ...pm_tdStyleR, fontWeight: 700, color: cumplColor }}>{cumpl.toFixed(1)}%</td>
                            <td style={{ ...pm_tdStyle, fontSize: 11, color: "#475569" }}>{row.interpretacion}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {criticos.length === 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 14, fontSize: 12, color: "#166534", textAlign: "center" }}>
                ✅ Sin casos críticos en el período. Todas las SCs cumplieron por encima del 80% o tuvieron pocas ofertas no ejecutadas.
              </div>
            )}
          </div>
        );
      })()}

    </div>
  );
}

// ── SCORE (sin cambios) ────────────────────────────────────────────────────
function PoolMeliScore({ scores, resumen }) {
  const r = resumen || {};
  const totalEvaluados = scores.length;
  const top = scores.slice(0, 7);
  const cuentas = {
    A: r.score_a ?? scores.filter(s => s.categoria_score === "A").length,
    B: r.score_b ?? scores.filter(s => s.categoria_score === "B").length,
    C: r.score_c ?? scores.filter(s => s.categoria_score === "C").length,
    D: r.score_d ?? scores.filter(s => s.categoria_score === "D").length,
  };

  const cats = [
    { cat: "A", label: "Élite",    range: "80-100", color: "#047857", desc: "Driver A+ - alta performance" },
    { cat: "B", label: "Sólido",   range: "60-79",  color: "#0891b2", desc: "Confiable y consistente" },
    { cat: "C", label: "Promedio", range: "40-59",  color: "#ca8a04", desc: "Espacio para mejorar" },
    { cat: "D", label: "Riesgo",   range: "0-39",   color: "#b91c1c", desc: "Requiere atención" },
  ];

  const dimensiones = [
    { label: "Volumen",       pts: 30, desc: "Días trabajados",   color: "#002E5D" },
    { label: "Performance",   pts: 25, desc: "DPPH (paq/hora)",   color: "#0891b2" },
    { label: "Confiabilidad", pts: 20, desc: "% entrega exitosa", color: "#FF6600" },
    { label: "Compliance",    pts: 15, desc: "Master + CURP",     color: "#ca8a04" },
    { label: "Estabilidad",   pts: 10, desc: "Mismo SC",          color: "#94a3b8" },
  ];

  return (
    <div className="pg">
      <div style={{ background: "linear-gradient(135deg, #002E5D 0%, #0f2647 100%)", borderRadius: 12, padding: 24, color: "#fff", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6 }}>Innovación Brain</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Score de Compromiso por Driver</div>
            <div style={{ fontSize: 13, opacity: 0.9, maxWidth: 600, lineHeight: 1.5 }}>
              Calificación 0-100 que combina volumen, performance, confiabilidad, compliance y estabilidad.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{totalEvaluados}</div>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>drivers evaluados</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {cats.map(c => {
          const pct = totalEvaluados > 0 ? Math.round(cuentas[c.cat] / totalEvaluados * 100) : 0;
          return (
            <div key={c.cat} className="form-card" style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: c.color, lineHeight: 1 }}>{c.cat}</div>
                <div style={{ fontSize: 10, fontFamily: "monospace", color: "#94a3b8" }}>{c.range} pts</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", lineHeight: 1, marginBottom: 4 }}>{cuentas[c.cat]}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 10 }}>{c.desc}</div>
              <div style={{ height: 4, background: "#f1f5f9", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: c.color }}></div>
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{pct}% del total</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <div className="form-card" style={{ marginBottom: 0 }}>
          <div className="form-title" style={{ marginBottom: 4 }}>Top 7 Drivers Élite</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>Score 90+ — los pilares de la operación</div>
          {top.map((d, i) => (
            <div key={d.driver_id || d.nombre} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i === top.length - 1 ? "none" : "1px solid #f1f5f9" }}>
              <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: "monospace", width: 24 }}>#{i + 1}</div>
              <ScoreBadgeMX cat={d.categoria_score} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{d.nombre}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {d.scs_operados || "—"} · {d.dias_trabajados} días · DPPH {d.dpph_promedio?.toFixed?.(1) ?? "—"} · {d.entrega_exitosa_pct?.toFixed?.(1) ?? "—"}% entrega
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#047857", lineHeight: 1 }}>{d.score_total?.toFixed?.(1) ?? "—"}</div>
                <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>score</div>
              </div>
            </div>
          ))}
        </div>

        <div className="form-card" style={{ marginBottom: 0 }}>
          <div className="form-title" style={{ marginBottom: 4 }}>Composición del score</div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 16 }}>5 dimensiones · 100 pts total</div>
          {dimensiones.map(d => (
            <div key={d.label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{d.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: d.color }}>
                  {d.pts}<span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 2 }}>pts</span>
                </span>
              </div>
              <div style={{ height: 5, background: "#f1f5f9", borderRadius: 3, overflow: "hidden", marginBottom: 4 }}>
                <div style={{ height: "100%", width: `${d.pts / 30 * 100}%`, background: d.color }}></div>
              </div>
              <div style={{ fontSize: 10, color: "#64748b" }}>{d.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── HALLAZGOS ──────────────────────────────────────────────────────────────
function PoolMeliHallazgos({ drivers, vehiculos, scs, scores, resumen, setModal, setVista, mesGlobal }) {
  const r = resumen || {};
  const driversFantasma = drivers.filter(d => d.categoria === "fantasma");
  const vehiculosFantasma = vehiculos.filter(v => v.categoria === "fantasma");
  const scsProblematicos = scs.filter(s => s.perfil === "PROBLEMATICO");
  const driversIzombi = drivers.filter(d => d.en_master && (!d.curp || d.curp === "") && (!d.viajes_total || d.viajes_total === 0));
  const driversElite = scores.filter(s => s.categoria_score === "A").slice(0, 7);
  const peorSC = [...scsProblematicos].sort((a, b) => (a.pct_cumplimiento || 0) - (b.pct_cumplimiento || 0))[0];
  const scsBajaEntrega = scs.filter(s => s.ejecutadas > 50 && s.pct_cumplimiento < 90 && s.perfil !== "PROBLEMATICO");
  const topFantasma = driversFantasma.sort((a, b) => (b.viajes_total || 0) - (a.viajes_total || 0))[0];
  const fantasmaMultiSC = driversFantasma.find(d => (d.cantidad_scs || 0) >= 2);

  // SDD no realizados por SC (se carga según el mes global)
  const [sddNoRealizados, setSddNoRealizados] = useState([]);
  // Pending viejos (sin respuesta del carrier en fechas pasadas)
  const [pendientesViejos, setPendientesViejos] = useState([]);
  useEffect(() => {
    if (!mesGlobal) return;
    let alive = true;
    (async () => {
      try {
        const { desde, hasta } = rangoMesGlobal(mesGlobal);
        const [rsdd, rpend] = await Promise.all([
          sb.rpc("get_hallazgo_sdd_no_realizados", { fecha_desde: desde, fecha_hasta: hasta }),
          sb.rpc("get_hallazgo_pendientes_viejos", { fecha_desde: desde, fecha_hasta: hasta }),
        ]);
        if (!alive) return;
        if (rsdd.error) {
          console.error("Error cargando SDD no realizados:", rsdd.error);
          setSddNoRealizados([]);
        } else {
          setSddNoRealizados(rsdd.data || []);
        }
        if (rpend.error) {
          console.error("Error cargando pendientes viejos:", rpend.error);
          setPendientesViejos([]);
        } else {
          setPendientesViejos(rpend.data || []);
        }
      } catch (e) {
        console.error("Error cargando hallazgos del mes:", e);
        if (alive) {
          setSddNoRealizados([]);
          setPendientesViejos([]);
        }
      }
    })();
    return () => { alive = false; };
  }, [mesGlobal?.anio, mesGlobal?.mes]);

  const totalSDDNoRealizadas = sddNoRealizados.reduce((a, s) => a + Number(s.sdd_no_realizadas || 0), 0);
  const peorSCsdd = sddNoRealizados[0];
  
  // Pendientes con fecha de operación pasada (críticos)
  const pendientesPasados = pendientesViejos.filter(p => Number(p.dias_pasados) > 0);
  const totalPendPasados = pendientesPasados.length;
  // Agrupar por SC para detectar concentración
  const pendPorSC = {};
  pendientesPasados.forEach(p => {
    pendPorSC[p.service_center] = (pendPorSC[p.service_center] || 0) + 1;
  });
  const peorSCpend = Object.entries(pendPorSC).sort((a, b) => b[1] - a[1])[0];

  const verSDDNoRealizados = () => setModal({
    titulo: `SDD no realizadas por SC · ${NOMBRES_MES[mesGlobal.mes - 1]} ${mesGlobal.anio}`,
    filas: sddNoRealizados,
    nombreArchivo: `sdd_no_realizados_${mesGlobal.anio}_${mesGlobal.mes}`,
  });
  
  const verPendientesViejos = () => setModal({
    titulo: `Pending sin respuesta · ${NOMBRES_MES[mesGlobal.mes - 1]} ${mesGlobal.anio}`,
    filas: pendientesViejos,
    nombreArchivo: `pendientes_${mesGlobal.anio}_${mesGlobal.mes}`,
  });

  const verSCsProblematicos = () => setModal({ titulo: `SCs Problemáticos (${scsProblematicos.length})`, filas: scsProblematicos, nombreArchivo: "scs_problematicos" });
  const verDriversFantasma = () => setModal({ titulo: `Drivers Fantasma (${driversFantasma.length})`, filas: driversFantasma, nombreArchivo: "drivers_fantasma" });
  const verVehFantasma = () => setModal({ titulo: `Vehículos Fantasma (${vehiculosFantasma.length})`, filas: vehiculosFantasma, nombreArchivo: "vehiculos_fantasma" });
  const verIzombi = () => setModal({ titulo: `IDs Zombi en Master (${driversIzombi.length})`, filas: driversIzombi, nombreArchivo: "ids_zombi" });
  const verElite = () => setModal({ titulo: `Top Drivers Élite (${driversElite.length})`, filas: driversElite, nombreArchivo: "drivers_elite" });
  const verPlanifSinMaster = async () => {
    setModal({ titulo: "Cargando…", filas: [], nombreArchivo: "planif" });
    try {
      const { data, error } = await sb.from("vw_meli_hallazgo_planif_sin_master").select("*");
      if (error) throw error;
      setModal({ titulo: `Drivers planificados sin master (${(data || []).length})`, filas: data || [], nombreArchivo: "planif_sin_master" });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };
  const verSMX6Diario = async () => {
    setModal({ titulo: "Cargando…", filas: [], nombreArchivo: "smx6" });
    try {
      const { data, error } = await sb.from("vw_meli_hallazgo_smx6_diario").select("*").order("fecha");
      if (error) throw error;
      setModal({ titulo: `SMX6 día por día (${(data || []).length})`, filas: data || [], nombreArchivo: "smx6_no_pres_diario" });
    } catch (e) { setModal({ titulo: "Error", filas: [{ error: e.message }], nombreArchivo: "error" }); }
  };

  const hallazgos = [];

  // ─── HALLAZGO CRÍTICO: SDD no realizadas (compromiso obligatorio con MELI) ──
  if (peorSCsdd && Number(peorSCsdd.sdd_no_realizadas) > 0) {
    hallazgos.push({
      sev: "CRITICO", categoria: "Compromiso SDD",
      titulo: `${peorSCsdd.service_center} — ${peorSCsdd.sdd_no_realizadas} viajes SDD no ejecutados`,
      desc: `La flota fija (Súper Dedicada) es un compromiso obligatorio con MELI. ` +
            `${peorSCsdd.service_center} aceptó ${peorSCsdd.sdd_aceptadas} SDD pero solo ejecutó ${peorSCsdd.sdd_ejecutadas} ` +
            `(${peorSCsdd.pct_no_presentado}% no-show, en ${peorSCsdd.dias_con_no_show} días distintos). ` +
            `Total mensual MX: ${totalSDDNoRealizadas} SDD comprometidas no realizadas.`,
      metricas: [
        { l: "SDD no realizadas", v: peorSCsdd.sdd_no_realizadas, color: "#991b1b" },
        { l: "% no-show", v: `${peorSCsdd.pct_no_presentado}%`, color: "#991b1b" },
        { l: "Días con incidencia", v: peorSCsdd.dias_con_no_show, color: "#991b1b" },
        { l: "Total MX", v: totalSDDNoRealizadas, color: "#92400e" },
      ],
      accion: { label: "Ver todos los SCs", onClick: verSDDNoRealizados },
    });
  }

  // ─── HALLAZGO CRÍTICO: Pendientes con fecha pasada (sin respuesta del carrier) ──
  if (totalPendPasados > 0) {
    const fechasMasViejas = [...pendientesPasados].sort((a, b) => Number(b.dias_pasados) - Number(a.dias_pasados));
    const masVieja = fechasMasViejas[0];
    hallazgos.push({
      sev: "CRITICO", categoria: "SLA Carrier",
      titulo: `${totalPendPasados} viajes pending sin respuesta · fecha de operación ya pasó`,
      desc: `MELI ofreció ${totalPendPasados} viajes que Bigticket NUNCA respondió (ni aceptó ni rechazó). ` +
            `Las fechas de operación ya pasaron — son ofertas perdidas y posible incumplimiento de SLA. ` +
            (peorSCpend ? `Concentración: ${peorSCpend[0]} (${peorSCpend[1]} viajes). ` : '') +
            `El más viejo es del ${masVieja.fecha_operacion} (${masVieja.dias_pasados} días sin respuesta).`,
      metricas: [
        { l: "Pending vencidos", v: totalPendPasados, color: "#991b1b" },
        { l: "SC con más casos", v: peorSCpend ? peorSCpend[0] : "—", color: "#991b1b" },
        { l: "Días más antiguo", v: masVieja.dias_pasados, color: "#991b1b" },
      ],
      accion: { label: "Ver lista completa", onClick: verPendientesViejos },
    });
  }

  if (peorSC) {
    hallazgos.push({
      sev: "CRITICO", categoria: "Operación",
      titulo: `${peorSC.service_center} — Operación crónicamente disfuncional`,
      desc: `${peorSC.aceptadas} aceptadas, solo ${peorSC.ejecutadas} ejecutadas (${peorSC.pct_cumplimiento}% cumplimiento). ${peorSC.no_presentadas} viajes comprometidos sin entregar — patrón sostenido.`,
      metricas: [
        { l: "Cumplimiento", v: `${peorSC.pct_cumplimiento}%`, color: "#991b1b" },
        { l: "No presentadas", v: peorSC.no_presentadas, color: "#991b1b" },
        { l: "Días con incidencia", v: "19", color: "#991b1b" },
      ],
      accion: { label: "Ver día por día", onClick: verSMX6Diario },
      accion2: { label: "Ir a Ciclo", onClick: () => setVista("ciclo") },
    });
  }

  const spy = scs.find(s => s.service_center === "SPY1");
  if (spy && spy.ejecutadas === 0 && spy.ofrecidas > 0) {
    hallazgos.push({
      sev: "CRITICO", categoria: "Operación",
      titulo: `SPY1 (Playa del Carmen) — 0 ejecutados, posible cierre`,
      desc: `Meli ofreció ${spy.ofrecidas} viajes a SPY1 pero no se ejecutó NINGUNO. ${spy.rechazadas} fueron rechazados directamente.`,
      metricas: [
        { l: "Ofrecidas", v: spy.ofrecidas, color: "#991b1b" },
        { l: "Ejecutadas", v: spy.ejecutadas, color: "#991b1b" },
        { l: "% Rechazo", v: `${spy.pct_rechazo}%`, color: "#991b1b" },
      ],
      accion: { label: "Ver SCs problemáticos", onClick: verSCsProblematicos },
    });
  }

  if (fantasmaMultiSC) {
    hallazgos.push({
      sev: "CRITICO", categoria: "Compliance",
      titulo: `${fantasmaMultiSC.nombre} — Driver fantasma multi-SC`,
      desc: `Operó ${fantasmaMultiSC.viajes_total} viajes en ${fantasmaMultiSC.cantidad_scs} SCs (${fantasmaMultiSC.scs_operados}) sin estar en master oficial. Riesgo legal en caso de siniestro.`,
      metricas: [
        { l: "Viajes", v: fantasmaMultiSC.viajes_total, color: "#991b1b" },
        { l: "SCs", v: fantasmaMultiSC.cantidad_scs, color: "#991b1b" },
        { l: "DPPH", v: fantasmaMultiSC.dpph_promedio?.toFixed?.(1) ?? "—", color: "#0f172a" },
      ],
      accion: { label: "Ver fantasmas", onClick: verDriversFantasma },
      accion2: { label: "Planificados sin master", onClick: verPlanifSinMaster },
    });
  }

  scsBajaEntrega.forEach(sc => {
    hallazgos.push({
      sev: "ALTO", categoria: "Performance",
      titulo: `${sc.service_center} — Problema de ejecución`,
      desc: `Acepta ${sc.aceptadas} viajes pero ejecuta ${sc.ejecutadas} (${sc.pct_cumplimiento}%). Es problema operativo de campo.`,
      metricas: [
        { l: "% Cumplimiento", v: `${sc.pct_cumplimiento}%`, color: "#92400e" },
        { l: "No presentadas", v: sc.no_presentadas, color: "#92400e" },
        { l: "Aceptadas", v: sc.aceptadas, color: "#0f172a" },
      ],
      accion: { label: "Ir a Ciclo", onClick: () => setVista("ciclo") },
    });
  });

  if (driversFantasma.length > 0) {
    hallazgos.push({
      sev: "ALTO", categoria: "Compliance",
      titulo: `${driversFantasma.length} drivers fantasma activos`,
      desc: `Personas operando viajes a nombre de Bigticket sin estar en master oficial de Meli. ${topFantasma ? `Top: ${topFantasma.nombre} (${topFantasma.viajes_total} viajes).` : ""}`,
      metricas: [
        { l: "Total fantasmas", v: driversFantasma.length, color: "#92400e" },
        { l: "Viajes acumulados", v: driversFantasma.reduce((a, d) => a + (d.viajes_total || 0), 0), color: "#92400e" },
      ],
      accion: { label: "Ver listado", onClick: verDriversFantasma },
    });
  }

  if (vehiculosFantasma.length > 0) {
    hallazgos.push({
      sev: "ALTO", categoria: "Compliance",
      titulo: `${vehiculosFantasma.length} placas fantasma operando`,
      desc: `Vehículos circulando sin estar en master oficial. Mismo riesgo legal que drivers fantasma.`,
      metricas: [
        { l: "Total placas", v: vehiculosFantasma.length, color: "#92400e" },
        { l: "Viajes", v: vehiculosFantasma.reduce((a, v) => a + (v.viajes_total || 0), 0), color: "#92400e" },
      ],
      accion: { label: "Ver listado", onClick: verVehFantasma },
    });
  }

  if (driversIzombi.length > 0) {
    hallazgos.push({
      sev: "MEDIO", categoria: "Limpieza de datos",
      titulo: `${driversIzombi.length} IDs zombi en master Meli`,
      desc: `Drivers en master con CURP vacío y 0 viajes. IDs creados pero no completados del lado de Meli.`,
      metricas: [{ l: "IDs zombi", v: driversIzombi.length, color: "#92400e" }],
      accion: { label: "Ver listado", onClick: verIzombi },
    });
  }

  const totNoPres = r.total_no_presentadas || 0;
  if (totNoPres > 0) {
    hallazgos.push({
      sev: "MEDIO", categoria: "Cumplimiento",
      titulo: `${totNoPres} viajes no presentados`,
      desc: `Bigticket aceptó pero no ejecutó. "No-show silencioso" del sistema.`,
      metricas: [
        { l: "No presentadas", v: totNoPres, color: "#92400e" },
        { l: "% del aceptado", v: `${r.total_aceptadas > 0 ? Math.round(totNoPres / r.total_aceptadas * 100) : 0}%`, color: "#92400e" },
      ],
      accion: { label: "Ver detalle", onClick: () => setVista("ciclo") },
    });
  }

  if (driversElite.length > 0) {
    const topElite = driversElite[0];
    hallazgos.push({
      sev: "INFO", categoria: "Oportunidad",
      titulo: `Top ${driversElite.length} drivers élite — modelo a replicar`,
      desc: `Drivers con score ≥90. ${topElite ? `${topElite.nombre} lidera con ${topElite.score_total} pts.` : ""}`,
      metricas: [
        { l: "Drivers élite", v: driversElite.length, color: "#047857" },
        { l: "Score top", v: topElite?.score_total ?? "—", color: "#047857" },
      ],
      accion: { label: "Ver lista", onClick: verElite },
      accion2: { label: "Ir a Score", onClick: () => setVista("score") },
    });
  }

  const conteoSev = {
    CRITICO: hallazgos.filter(h => h.sev === "CRITICO").length,
    ALTO: hallazgos.filter(h => h.sev === "ALTO").length,
    MEDIO: hallazgos.filter(h => h.sev === "MEDIO").length,
    INFO: hallazgos.filter(h => h.sev === "INFO").length,
  };

  return (
    <div className="pg">
      <div style={{ background: "linear-gradient(135deg, #002E5D 0%, #0f2647 100%)", borderRadius: 12, padding: 20, color: "#fff", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 4 }}>Resumen ejecutivo</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{hallazgos.length} hallazgos detectados</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>Cruce automático de las 6 fuentes operativas · ordenados por severidad</div>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {[
              { label: "Crítico", val: conteoSev.CRITICO, bg: "#fee2e2", text: "#7f1d1d" },
              { label: "Alto", val: conteoSev.ALTO, bg: "#fef3c7", text: "#78350f" },
              { label: "Medio", val: conteoSev.MEDIO, bg: "#fef9c3", text: "#713f12" },
              { label: "Info", val: conteoSev.INFO, bg: "#dcfce7", text: "#14532d" },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, borderRadius: 8, padding: "8px 14px", textAlign: "center", minWidth: 70 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.text, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: s.text, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {hallazgos.map((h, i) => <PoolMeliHallazgoCard key={i} hallazgo={h} index={i + 1} />)}
      </div>
    </div>
  );
}

function PoolMeliHallazgoCard({ hallazgo, index }) {
  const sevStyles = {
    CRITICO: { bg: "#fef2f2", border: "#fecaca", labelBg: "#b91c1c" },
    ALTO:    { bg: "#fffbeb", border: "#fde68a", labelBg: "#d97706" },
    MEDIO:   { bg: "#fefce8", border: "#fde047", labelBg: "#ca8a04" },
    INFO:    { bg: "#f0fdf4", border: "#bbf7d0", labelBg: "#15803d" },
  };
  const s = sevStyles[hallazgo.sev] || sevStyles.INFO;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: 16,
      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "start" }}>
      <div style={{ textAlign: "center", minWidth: 50 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginBottom: 4 }}>#{index}</div>
        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 4, fontSize: 9,
          fontWeight: 800, letterSpacing: 0.8, background: s.labelBg, color: "#fff" }}>{hallazgo.sev}</span>
      </div>
      <div>
        <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>{hallazgo.categoria}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{hallazgo.titulo}</div>
        <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5, marginBottom: 10 }}>{hallazgo.desc}</div>
        {hallazgo.metricas && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {hallazgo.metricas.map((m, i) => (
              <div key={i}>
                <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 2 }}>{m.l}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.v}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {hallazgo.accion && (
          <button onClick={hallazgo.accion.onClick}
            style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, border: "1px solid #cbd5e1",
              borderRadius: 6, background: "#fff", color: "#002E5D", cursor: "pointer",
              fontFamily: "'Open Sans', sans-serif", whiteSpace: "nowrap" }}>{hallazgo.accion.label} →</button>
        )}
        {hallazgo.accion2 && (
          <button onClick={hallazgo.accion2.onClick}
            style={{ padding: "6px 12px", fontSize: 11, fontWeight: 500, border: "none",
              background: "transparent", color: "#64748b", cursor: "pointer",
              fontFamily: "'Open Sans', sans-serif", whiteSpace: "nowrap" }}>{hallazgo.accion2.label}</button>
        )}
      </div>
    </div>
  );
}

const pm_thStyle  = { textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, padding: "10px 12px" };
const pm_thStyleR = { ...pm_thStyle, textAlign: "right" };
const pm_tdStyle  = { fontSize: 12, color: "#0f172a", padding: "10px 12px" };
const pm_tdStyleR = { ...pm_tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

// ═══════════════════════════════════════════════════════════════════════════════════════
// MÓDULO HELPERS · MX (Control de Ayudantes Mercado Libre)
// ───────────────────────────────────────────────────────────────────────────────────────
// Cruza el flag has_helper de logistic_ayudantes_snapshots contra quién realmente
// entregó los paquetes en meli_paquetes_entregados para detectar:
//   • CORRECTO   → helper flag activo + ambos entregaron
//   • FANTASMA   → flag activo pero solo el chofer entregó (BT paga $350 inútilmente)
//   • RARO       → flag activo pero solo el helper entregó (chofer no entregó nada)
//   • NO_MARCADO → helper trabajó sin flag (recuperable de MELI si es SC autorizado)
//
// 4 universos (U0 Resumen, U1 No autorizadas, U2 Certificación, U3 Proceso).
// Funciona con queries directas (no requiere la vista v_helpers_clasificacion_diaria).
// ═══════════════════════════════════════════════════════════════════════════════════════

const HMX_SCS_AUTORIZADOS = ["SMX1", "SMX6", "SMX7", "SMX8", "SMX9", "SMX10", "SQR1"];
const HMX_COSTO_HELPER = 350; // MXN por ruta

function hmx_clasificar({ helper_flag, pkgs_chofer, pkgs_otro }) {
  if (helper_flag && pkgs_otro > 0 && pkgs_chofer > 0) return "CORRECTO";
  if (helper_flag && pkgs_otro === 0) return "FANTASMA";
  if (helper_flag && pkgs_chofer === 0) return "RARO";
  if (!helper_flag && pkgs_otro > 0) return "NO_MARCADO";
  return "NORMAL";
}

function hmx_esAutorizado(sc) {
  return HMX_SCS_AUTORIZADOS.includes(sc);
}

function ModuloHelpersMX({ usuario }) {
  const [vista, setVista] = useState("u0");
  const [fecha, setFecha] = useState(fechaHoyOperativa());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rutas, setRutas] = useState([]);
  const [detalle, setDetalle] = useState(null);

  const cargarDatos = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1) Flag de helper por ruta (logistic_ayudantes_snapshots)
      const { data: snaps, error: e1 } = await sb
        .from("logistic_ayudantes_snapshots")
        .select("id_ruta, has_helper, service_center_id")
        .eq("fecha", fecha);
      if (e1) throw e1;

      // Mapa id_ruta -> { helper_flag, sc }
      const flagMap = new Map();
      (snaps || []).forEach(r => {
        const prev = flagMap.get(r.id_ruta) || { helper_flag: false, sc: r.service_center_id };
        flagMap.set(r.id_ruta, {
          helper_flag: prev.helper_flag || !!r.has_helper,
          sc: r.service_center_id || prev.sc,
        });
      });

      // 2) Entregas del día (meli_paquetes_entregados)
      const { data: pkgs, error: e2 } = await sb
        .from("meli_paquetes_entregados")
        .select("id_ruta, service_center_id, driver_id, driver_name, user_id_real, user_name_real")
        .eq("fecha", fecha)
        .not("user_id_real", "is", null);
      if (e2) throw e2;

      // Agregar por ruta
      const rutaMap = new Map();
      (pkgs || []).forEach(p => {
        const id = p.id_ruta;
        let row = rutaMap.get(id);
        if (!row) {
          row = {
            id_ruta: id,
            sc: p.service_center_id,
            chofer: p.driver_name,
            chofer_id: p.driver_id,
            pkgs_chofer: 0,
            pkgs_otro: 0,
            ayudantes: new Set(),
          };
          rutaMap.set(id, row);
        }
        const mismoChofer = p.user_id_real === p.driver_id;
        if (mismoChofer) row.pkgs_chofer++;
        else {
          row.pkgs_otro++;
          if (p.user_name_real) row.ayudantes.add(p.user_name_real);
        }
      });

      // 3) Unir flag + entregas
      const todasLasRutas = new Set([...flagMap.keys(), ...rutaMap.keys()]);
      const result = [];
      todasLasRutas.forEach(id => {
        const flag = flagMap.get(id) || { helper_flag: false, sc: null };
        const entrega = rutaMap.get(id) || {
          id_ruta: id, sc: flag.sc, chofer: null, chofer_id: null,
          pkgs_chofer: 0, pkgs_otro: 0, ayudantes: new Set(),
        };
        const sc = entrega.sc || flag.sc;
        const helper_flag = flag.helper_flag;
        const pkgs_chofer = entrega.pkgs_chofer;
        const pkgs_otro = entrega.pkgs_otro;
        const clasificacion = hmx_clasificar({ helper_flag, pkgs_chofer, pkgs_otro });
        const autorizado = hmx_esAutorizado(sc);
        result.push({
          id_ruta: id,
          sc,
          autorizado,
          chofer: entrega.chofer,
          chofer_id: entrega.chofer_id,
          helper_flag,
          pkgs_chofer,
          pkgs_otro,
          pkgs_total: pkgs_chofer + pkgs_otro,
          ayudante_nombre: [...entrega.ayudantes].join(" | "),
          clasificacion,
          monto_recuperable_meli: (!helper_flag && pkgs_otro > 0 && autorizado) ? HMX_COSTO_HELPER : 0,
          costo_bt_cuestionable: (helper_flag && pkgs_otro === 0) ? HMX_COSTO_HELPER : 0,
        });
      });

      setRutas(result);
    } catch (e) {
      setError(e.message || "Error cargando datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargarDatos(); /* eslint-disable-next-line */ }, [fecha]);

  const stats = useMemo(() => {
    const conFlag = rutas.filter(r => r.helper_flag);
    const correctas = conFlag.filter(r => r.clasificacion === "CORRECTO");
    const fantasma = conFlag.filter(r => r.clasificacion === "FANTASMA");
    const raras = conFlag.filter(r => r.clasificacion === "RARO");
    const noMarcadas = rutas.filter(r => r.clasificacion === "NO_MARCADO");
    const fantasmaNoAutoriz = fantasma.filter(r => !r.autorizado);
    const fantasmaAutoriz = fantasma.filter(r => r.autorizado);
    const recuperable = rutas.reduce((s, r) => s + r.monto_recuperable_meli, 0);
    const costoCuestionable = rutas.reduce((s, r) => s + r.costo_bt_cuestionable, 0);
    return {
      total_con_flag: conFlag.length,
      correctas: correctas.length,
      fantasma: fantasma.length,
      raras: raras.length,
      no_marcadas: noMarcadas.length,
      fantasma_no_autoriz: fantasmaNoAutoriz.length,
      fantasma_autoriz: fantasmaAutoriz.length,
      recuperable_meli: recuperable,
      costo_bt_cuestionable: costoCuestionable,
      list_correctas: correctas,
      list_fantasma: fantasma,
      list_raras: raras,
      list_no_marcadas: noMarcadas,
    };
  }, [rutas]);

  const porSC = useMemo(() => {
    const map = new Map();
    rutas.filter(r => r.helper_flag).forEach(r => {
      const k = r.sc || "—";
      let row = map.get(k);
      if (!row) {
        row = { sc: k, autorizado: r.autorizado, correctas: 0, fantasma: 0, raras: 0, total: 0, costo_bt: 0 };
        map.set(k, row);
      }
      row.total++;
      if (r.clasificacion === "CORRECTO") row.correctas++;
      else if (r.clasificacion === "FANTASMA") row.fantasma++;
      else if (r.clasificacion === "RARO") row.raras++;
      row.costo_bt += r.costo_bt_cuestionable;
    });
    return [...map.values()].sort((a, b) => {
      if (a.autorizado !== b.autorizado) return a.autorizado ? 1 : -1;
      return b.total - a.total;
    });
  }, [rutas]);

  const tabs = [
    { id: "u0", label: "U0 · Resumen", desc: "Vista ejecutiva del día" },
    { id: "u1", label: "U1 · No autorizadas", desc: "Helper en SC sin tarifa MELI" },
    { id: "u2", label: "U2 · Desviaciones", desc: "Fantasmas en SC autorizados" },
    { id: "u3", label: "U3 · Detalle", desc: "Listado completo de rutas" },
  ];

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#002E5D", marginBottom: 4 }}>
          Control Helpers MX
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
          Cruce de helpers declarados (logistic) vs entregadores reales (MELI) · operación Mercado Libre
        </div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginLeft: -8, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => { setVista(t.id); setDetalle(null); }}
                style={{
                  background: "transparent", border: "none", padding: "10px 16px",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", color: vista === t.id ? "#002E5D" : "#64748b",
                  borderBottom: vista === t.id ? "2px solid #002E5D" : "2px solid transparent",
                  marginBottom: -2, textAlign: "left",
                }}>
                <div>{t.label}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Fecha:
            </span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              style={{
                padding: "6px 10px", fontSize: 13, fontWeight: 600, borderRadius: 6,
                border: "1px solid #cbd5e1", background: "#fff", color: "#002E5D",
                cursor: "pointer", fontFamily: "'Open Sans', sans-serif", outline: "none",
                width: "auto",
              }} />
            <button onClick={cargarDatos} disabled={loading}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: "1px solid #cbd5e1", background: "#fff", color: "#475569",
                cursor: loading ? "wait" : "pointer", fontFamily: "'Open Sans', sans-serif",
              }}>
              {loading ? "Cargando…" : "Refrescar"}
            </button>
          </div>
        </div>
      </div>

      <div className="pg" style={{ paddingTop: 16 }}>
        {error && (
          <div className="form-card" style={{ background: "#fef2f2", border: "1px solid #fecaca", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#991b1b", marginBottom: 4 }}>
              No se pudo cargar la información
            </div>
            <div style={{ fontSize: 12, color: "#7f1d1d" }}>{error}</div>
          </div>
        )}

        {loading && (
          <div className="form-card" style={{ textAlign: "center", padding: 40, color: "#666" }}>
            Cargando datos del {fecha}…
          </div>
        )}

        {!loading && !error && rutas.length === 0 && (
          <div className="form-card" style={{ textAlign: "center", padding: 40, color: "#666" }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              No hay rutas registradas para {fecha}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              El scraper puede no haber capturado información todavía. Probá con otra fecha o esperá al cierre del día.
            </div>
          </div>
        )}

        {!loading && !error && rutas.length > 0 && (
          <>
            {vista === "u0" && <HelpersU0 stats={stats} porSC={porSC} fecha={fecha} onIr={setVista} />}
            {vista === "u1" && <HelpersU1 porSC={porSC} stats={stats} rutas={rutas} setDetalle={setDetalle} detalle={detalle} />}
            {vista === "u2" && <HelpersU2 porSC={porSC} stats={stats} rutas={rutas} setDetalle={setDetalle} detalle={detalle} />}
            {vista === "u3" && <HelpersU3 rutas={rutas} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── U0 · Resumen ejecutivo ──────────────────────────────────────────────────
function HelpersU0({ stats, porSC, fecha, onIr }) {
  const { total_con_flag, correctas, fantasma, raras, fantasma_no_autoriz, fantasma_autoriz, recuperable_meli, costo_bt_cuestionable } = stats;

  const kpis = [
    { label: "Rutas con helper flag", valor: total_con_flag, sub: "declarados en MELI hoy", color: "#002E5D" },
    { label: "Correctas", valor: correctas, sub: "helper trabajó realmente", color: "#16a34a" },
    { label: "Fantasma", valor: fantasma, sub: `BT paga $${(costo_bt_cuestionable).toLocaleString("es-MX")} sin entrega`, color: "#c0392b" },
    { label: "Raras", valor: raras, sub: "solo el helper entregó", color: "#FF6600" },
  ];

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
        {kpis.map((k, i) => (
          <div key={i} className="form-card" style={{ padding: 16, marginBottom: 0, borderLeft: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
              {k.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.color, letterSpacing: -0.5, lineHeight: 1 }}>
              {k.valor}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {total_con_flag > 0 && (
        <div className="form-card" style={{ marginBottom: 16 }}>
          <div className="form-title">Distribución del día · {fecha}</div>
          <div style={{ height: 32, display: "flex", borderRadius: 8, overflow: "hidden", marginBottom: 12, fontSize: 11, fontWeight: 700, color: "#fff" }}>
            {correctas > 0 && (
              <div style={{ flex: correctas, background: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {correctas} OK
              </div>
            )}
            {fantasma > 0 && (
              <div style={{ flex: fantasma, background: "#c0392b", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {fantasma} fantasma
              </div>
            )}
            {raras > 0 && (
              <div style={{ flex: raras, background: "#FF6600", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {raras} raras
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "#6b7280" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#16a34a" }}></div>
              <span><strong style={{ color: "#16a34a" }}>Correcto</strong> — helper y chofer entregaron</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#c0392b" }}></div>
              <span><strong style={{ color: "#c0392b" }}>Fantasma</strong> — solo el chofer entregó · BT paga sin servicio</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#FF6600" }}></div>
              <span><strong style={{ color: "#FF6600" }}>Raro</strong> — solo el helper entregó · investigar</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div className="form-card" style={{ padding: 16, marginBottom: 0, cursor: "pointer" }} onClick={() => onIr("u1")}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            U1 · No autorizadas
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#c0392b", marginBottom: 4 }}>
            {porSC.filter(s => !s.autorizado).reduce((a, b) => a + b.total, 0)}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
            rutas con helper en SC sin tarifa MELI
          </div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#002E5D" }}>Ver universo →</div>
        </div>

        <div className="form-card" style={{ padding: 16, marginBottom: 0, cursor: "pointer" }} onClick={() => onIr("u2")}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            U2 · Desviaciones autorizados
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#FF6600", marginBottom: 4 }}>
            {fantasma_autoriz}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
            fantasmas en SC con tarifa activa
          </div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#002E5D" }}>Ver universo →</div>
        </div>

        <div className="form-card" style={{ padding: 16, marginBottom: 0, cursor: "pointer" }} onClick={() => onIr("u3")}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            U3 · Detalle completo
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#002E5D", marginBottom: 4 }}>
            {stats.total_con_flag}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
            rutas listadas con filtros
          </div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#002E5D" }}>Ver detalle →</div>
        </div>
      </div>

      <div className="form-card">
        <div className="form-title">Impacto financiero estimado · {fecha}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.4, marginBottom: 4 }}>
              Costo BT cuestionable
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#c0392b" }}>
              ${costo_bt_cuestionable.toLocaleString("es-MX")} MXN
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              {fantasma} fantasmas × ${HMX_COSTO_HELPER}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.4, marginBottom: 4 }}>
              Recuperable de MELI
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>
              ${recuperable_meli.toLocaleString("es-MX")} MXN
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
              {stats.no_marcadas} no marcadas en SC autorizado
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── U1 · No autorizadas (PRIORIDAD) ──────────────────────────────────────────
function HelpersU1({ porSC, stats, rutas, setDetalle, detalle }) {
  const scsNoAut = porSC.filter(s => !s.autorizado);
  const totalRutas = scsNoAut.reduce((a, s) => a + s.total, 0);
  const totalFantasma = scsNoAut.reduce((a, s) => a + s.fantasma, 0);
  const totalCosto = scsNoAut.reduce((a, s) => a + s.costo_bt, 0);

  const onClickSC = (sc) => {
    const filtradas = rutas.filter(r => r.sc === sc && r.helper_flag);
    setDetalle({ tipo: "sc", filtro: sc, datos: filtradas });
  };

  return (
    <>
      <div className="form-card" style={{ background: "#fef2f2", border: "1px solid #fecaca", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>
          ⚠ Universo crítico · Acción inmediata
        </div>
        <div style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.6 }}>
          Estas rutas tienen helper declarado en SC <strong>sin tarifa activa en MELI</strong>. BT está pagando el costo
          completo sin posibilidad de recuperarlo. La acción no es operativa: bloquear el flag en estos SC y
          negociar activación de tarifa con MELI.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div className="form-card" style={{ padding: 14, marginBottom: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>SC no autorizados con flag</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#c0392b" }}>{scsNoAut.length}</div>
        </div>
        <div className="form-card" style={{ padding: 14, marginBottom: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Rutas afectadas</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#c0392b" }}>{totalRutas}</div>
        </div>
        <div className="form-card" style={{ padding: 14, marginBottom: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>De las cuales fantasma</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#c0392b" }}>{totalFantasma}</div>
        </div>
        <div className="form-card" style={{ padding: 14, marginBottom: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Costo BT del día</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#c0392b" }}>${totalCosto.toLocaleString("es-MX")}</div>
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e4e7ec", fontSize: 13, fontWeight: 600, color: "#002E5D" }}>
          SCs no autorizados con helper declarado
        </div>
        {scsNoAut.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            No hay SCs no autorizados con helper declarado hoy
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={hmxTh}>SC</th>
                <th style={hmxThR}>Rutas con flag</th>
                <th style={hmxThR}>Correctas</th>
                <th style={hmxThR}>Fantasma</th>
                <th style={hmxThR}>Raras</th>
                <th style={hmxThR}>Costo BT</th>
                <th style={hmxThR}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {scsNoAut.map(s => (
                <tr key={s.sc} style={{ borderBottom: "1px solid #f4f5f7", cursor: "pointer" }}
                  onClick={() => onClickSC(s.sc)}>
                  <td style={{ ...hmxTd, fontWeight: 700, color: "#002E5D" }}>{s.sc}</td>
                  <td style={hmxTdR}>{s.total}</td>
                  <td style={{ ...hmxTdR, color: s.correctas > 0 ? "#16a34a" : "#cbd5e1" }}>{s.correctas}</td>
                  <td style={{ ...hmxTdR, color: s.fantasma > 0 ? "#c0392b" : "#cbd5e1", fontWeight: s.fantasma > 0 ? 700 : 400 }}>{s.fantasma}</td>
                  <td style={{ ...hmxTdR, color: s.raras > 0 ? "#FF6600" : "#cbd5e1" }}>{s.raras}</td>
                  <td style={{ ...hmxTdR, fontWeight: 700, color: "#c0392b" }}>${s.costo_bt.toLocaleString("es-MX")}</td>
                  <td style={{ ...hmxTdR, fontSize: 11, color: "#002E5D", fontWeight: 600 }}>Ver detalle →</td>
                </tr>
              ))}
              <tr style={{ background: "#f9fafb", borderTop: "1px solid #e5e7eb", fontWeight: 700 }}>
                <td style={{ ...hmxTd, fontWeight: 700, color: "#002E5D" }}>Total</td>
                <td style={hmxTdR}>{totalRutas}</td>
                <td style={hmxTdR}>{scsNoAut.reduce((a, s) => a + s.correctas, 0)}</td>
                <td style={{ ...hmxTdR, color: "#c0392b" }}>{totalFantasma}</td>
                <td style={{ ...hmxTdR, color: "#FF6600" }}>{scsNoAut.reduce((a, s) => a + s.raras, 0)}</td>
                <td style={{ ...hmxTdR, color: "#c0392b" }}>${totalCosto.toLocaleString("es-MX")}</td>
                <td style={hmxTdR}>—</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {detalle && detalle.tipo === "sc" && (
        <DetalleRutasHelpers detalle={detalle} onClose={() => setDetalle(null)} />
      )}
    </>
  );
}

// ─── U2 · Desviaciones en SC autorizados ────────────────────────────────────
function HelpersU2({ porSC, stats, rutas, setDetalle, detalle }) {
  const scsAut = porSC.filter(s => s.autorizado);

  const onClickSC = (sc) => {
    const filtradas = rutas.filter(r => r.sc === sc && r.helper_flag);
    setDetalle({ tipo: "sc", filtro: sc, datos: filtradas });
  };

  return (
    <>
      <div className="form-card" style={{ background: "#fffbeb", border: "1px solid #fde68a", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", marginBottom: 4 }}>
          ⚠ Desviaciones en SC autorizados
        </div>
        <div style={{ fontSize: 12, color: "#78350f", lineHeight: 1.6 }}>
          Rutas en SC con tarifa MELI activa donde el helper fue declarado pero solo el chofer entregó.
          MELI sí paga la tarifa, pero el helper podría no haber operado realmente. Validar con supervisor.
        </div>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e4e7ec", fontSize: 13, fontWeight: 600, color: "#002E5D" }}>
          SCs autorizados con helper declarado
        </div>
        {scsAut.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            No hay SCs autorizados con helper declarado hoy
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={hmxTh}>SC</th>
                <th style={hmxThR}>Rutas con flag</th>
                <th style={hmxThR}>Correctas</th>
                <th style={hmxThR}>Fantasma</th>
                <th style={hmxThR}>Raras</th>
                <th style={hmxThR}>% Sano</th>
                <th style={hmxThR}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {scsAut.map(s => {
                const pct = s.total > 0 ? Math.round((s.correctas / s.total) * 100) : 0;
                return (
                  <tr key={s.sc} style={{ borderBottom: "1px solid #f4f5f7", cursor: "pointer" }}
                    onClick={() => onClickSC(s.sc)}>
                    <td style={{ ...hmxTd, fontWeight: 700, color: "#002E5D" }}>{s.sc}</td>
                    <td style={hmxTdR}>{s.total}</td>
                    <td style={{ ...hmxTdR, color: s.correctas > 0 ? "#16a34a" : "#cbd5e1" }}>{s.correctas}</td>
                    <td style={{ ...hmxTdR, color: s.fantasma > 0 ? "#c0392b" : "#cbd5e1", fontWeight: s.fantasma > 0 ? 700 : 400 }}>{s.fantasma}</td>
                    <td style={{ ...hmxTdR, color: s.raras > 0 ? "#FF6600" : "#cbd5e1" }}>{s.raras}</td>
                    <td style={{ ...hmxTdR, fontWeight: 700, color: pct >= 75 ? "#16a34a" : pct >= 50 ? "#FF6600" : "#c0392b" }}>{pct}%</td>
                    <td style={{ ...hmxTdR, fontSize: 11, color: "#002E5D", fontWeight: 600 }}>Ver detalle →</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detalle && detalle.tipo === "sc" && (
        <DetalleRutasHelpers detalle={detalle} onClose={() => setDetalle(null)} />
      )}
    </>
  );
}

// ─── U3 · Detalle completo (tabla con filtros) ────────────────────────────
function HelpersU3({ rutas }) {
  const [filtroClas, setFiltroClas] = useState("ALL");
  const [filtroSC, setFiltroSC] = useState("ALL");
  const [busqueda, setBusqueda] = useState("");

  const scs = useMemo(() => [...new Set(rutas.map(r => r.sc).filter(Boolean))].sort(), [rutas]);

  const filtradas = useMemo(() => {
    let res = rutas.filter(r => r.helper_flag || r.clasificacion === "NO_MARCADO");
    if (filtroClas !== "ALL") res = res.filter(r => r.clasificacion === filtroClas);
    if (filtroSC !== "ALL") res = res.filter(r => r.sc === filtroSC);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      res = res.filter(r =>
        (r.id_ruta || "").toString().toLowerCase().includes(q) ||
        (r.chofer || "").toLowerCase().includes(q) ||
        (r.ayudante_nombre || "").toLowerCase().includes(q) ||
        (r.sc || "").toLowerCase().includes(q)
      );
    }
    return res.sort((a, b) => {
      if (a.autorizado !== b.autorizado) return a.autorizado ? 1 : -1;
      if (a.sc !== b.sc) return (a.sc || "").localeCompare(b.sc || "");
      return (a.clasificacion || "").localeCompare(b.clasificacion || "");
    });
  }, [rutas, filtroClas, filtroSC, busqueda]);

  const exportarCSV = () => {
    const header = ["SC", "Tipo SC", "ID Ruta", "Chofer", "Clasificación", "Flag", "Pkgs Chofer", "Pkgs Helper", "Helper", "Recuperable MELI", "Costo BT"];
    const rows = [header, ...filtradas.map(r => [
      r.sc, r.autorizado ? "AUTORIZADO" : "NO_AUTORIZADO", r.id_ruta, r.chofer, r.clasificacion,
      r.helper_flag ? "SI" : "NO", r.pkgs_chofer, r.pkgs_otro, r.ayudante_nombre || "",
      r.monto_recuperable_meli, r.costo_bt_cuestionable,
    ])];
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `helpers_mx_${fechaHoyOperativa()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="form-card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Clasificación:</span>
          <select value={filtroClas} onChange={e => setFiltroClas(e.target.value)}
            style={{ width: "auto", padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            <option value="ALL">Todas</option>
            <option value="CORRECTO">Correctas</option>
            <option value="FANTASMA">Fantasma</option>
            <option value="RARO">Raras</option>
            <option value="NO_MARCADO">No marcadas</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>SC:</span>
          <select value={filtroSC} onChange={e => setFiltroSC(e.target.value)}
            style={{ width: "auto", padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
            <option value="ALL">Todos</option>
            {scs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar ruta, chofer, helper…"
          style={{ width: 240, padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }} />
        <div style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
          <strong>{filtradas.length}</strong> rutas
        </div>
        <button onClick={exportarCSV} className="btn-blue" style={{ padding: "6px 14px", fontSize: 12 }}>
          Exportar CSV
        </button>
      </div>

      <div className="form-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={hmxTh}>SC</th>
                <th style={hmxTh}>Tipo</th>
                <th style={hmxTh}>ID Ruta</th>
                <th style={hmxTh}>Chofer</th>
                <th style={hmxTh}>Helper</th>
                <th style={hmxTh}>Clasificación</th>
                <th style={hmxThR}>Pkgs ch.</th>
                <th style={hmxThR}>Pkgs h.</th>
                <th style={hmxThR}>Recup.</th>
                <th style={hmxThR}>Costo BT</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((r, i) => (
                <tr key={r.id_ruta + "_" + i} style={{ borderBottom: "1px solid #f4f5f7" }}>
                  <td style={{ ...hmxTd, fontWeight: 700, color: "#002E5D" }}>{r.sc || "—"}</td>
                  <td style={hmxTd}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                      background: r.autorizado ? "#dcfce7" : "#fee2e2",
                      color: r.autorizado ? "#166534" : "#991b1b",
                    }}>
                      {r.autorizado ? "AUT" : "NO AUT"}
                    </span>
                  </td>
                  <td style={{ ...hmxTd, fontFamily: "monospace", fontSize: 11 }}>{r.id_ruta}</td>
                  <td style={{ ...hmxTd, fontSize: 11 }}>{r.chofer || "—"}</td>
                  <td style={{ ...hmxTd, fontSize: 11 }}>{r.ayudante_nombre || "—"}</td>
                  <td style={hmxTd}>
                    <HelpersBadge clasificacion={r.clasificacion} />
                  </td>
                  <td style={hmxTdR}>{r.pkgs_chofer}</td>
                  <td style={hmxTdR}>{r.pkgs_otro}</td>
                  <td style={{ ...hmxTdR, color: r.monto_recuperable_meli > 0 ? "#16a34a" : "#cbd5e1", fontWeight: r.monto_recuperable_meli > 0 ? 700 : 400 }}>
                    {r.monto_recuperable_meli > 0 ? `$${r.monto_recuperable_meli}` : "—"}
                  </td>
                  <td style={{ ...hmxTdR, color: r.costo_bt_cuestionable > 0 ? "#c0392b" : "#cbd5e1", fontWeight: r.costo_bt_cuestionable > 0 ? 700 : 400 }}>
                    {r.costo_bt_cuestionable > 0 ? `$${r.costo_bt_cuestionable}` : "—"}
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                    No hay rutas que coincidan con los filtros
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── Detalle de rutas por SC (drill-down) ────────────────────────────────
function DetalleRutasHelpers({ detalle, onClose }) {
  return (
    <div className="form-card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e4e7ec", background: "#f9fafb", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#002E5D" }}>{detalle.filtro}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>·</span>
        <span style={{ fontSize: 12, color: "#64748b" }}>{detalle.datos.length} rutas</span>
        <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "'Open Sans', sans-serif" }}>
          Cerrar ✕
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={hmxTh}>ID Ruta</th>
              <th style={hmxTh}>Chofer</th>
              <th style={hmxTh}>Helper detectado</th>
              <th style={hmxTh}>Clasificación</th>
              <th style={hmxThR}>Pkgs ch.</th>
              <th style={hmxThR}>Pkgs h.</th>
              <th style={hmxTh}>Acción sugerida</th>
            </tr>
          </thead>
          <tbody>
            {detalle.datos.map((r, i) => (
              <tr key={r.id_ruta + "_" + i} style={{ borderBottom: "1px solid #f4f5f7" }}>
                <td style={{ ...hmxTd, fontFamily: "monospace", fontSize: 11 }}>{r.id_ruta}</td>
                <td style={{ ...hmxTd, fontSize: 11 }}>{r.chofer || "—"}</td>
                <td style={{ ...hmxTd, fontSize: 11 }}>{r.ayudante_nombre || "—"}</td>
                <td style={hmxTd}><HelpersBadge clasificacion={r.clasificacion} /></td>
                <td style={hmxTdR}>{r.pkgs_chofer}</td>
                <td style={hmxTdR}>{r.pkgs_otro}</td>
                <td style={{ ...hmxTd, fontSize: 11, color: "#64748b" }}>
                  {r.clasificacion === "FANTASMA" && (r.autorizado ? "Validar con supervisor si el helper realmente operó" : "Bloquear flag en este SC")}
                  {r.clasificacion === "CORRECTO" && "OK · sin acción"}
                  {r.clasificacion === "RARO" && "Investigar: ¿chofer inhabilitado?"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Badge de clasificación ─────────────────────────────────────────────
function HelpersBadge({ clasificacion }) {
  const cfg = {
    CORRECTO:   { bg: "#dcfce7", color: "#166534", label: "Correcto" },
    FANTASMA:   { bg: "#fee2e2", color: "#991b1b", label: "Fantasma" },
    RARO:       { bg: "#ffedd5", color: "#9a3412", label: "Raro" },
    NO_MARCADO: { bg: "#dbeafe", color: "#1e40af", label: "No marcado" },
    NORMAL:     { bg: "#f3f4f6", color: "#6b7280", label: "Normal" },
  }[clasificacion] || { bg: "#f3f4f6", color: "#6b7280", label: clasificacion };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: cfg.bg, color: cfg.color, whiteSpace: "nowrap" }}>
      {cfg.label}
    </span>
  );
}

// ─── Estilos de tabla compartidos del módulo helpers ───────────────────
const hmxTh  = { textAlign: "left", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, padding: "10px 12px", borderBottom: "1px solid #e4e7ec", background: "#f9fafb" };
const hmxThR = { ...hmxTh, textAlign: "right" };
const hmxTd  = { fontSize: 12, color: "#0f172a", padding: "10px 12px" };
const hmxTdR = { ...hmxTd, textAlign: "right", fontVariantNumeric: "tabular-nums" };

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO MANTENCIONES · Cuidado de Activo
// Pestaña madre con sub-tabs. v1: Verificador de neumáticos (emula la imagen).
// ───────────────────────────────────────────────────────────────────────────
function FormRegistrarEvento({ patente, onGuardado, onCerrar, usuario }) {
  const [tipo, setTipo] = useState("reparacion");
  const [componente, setComponente] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0,10));
  const [descripcion, setDescripcion] = useState("");
  const [item, setItem] = useState("");
  const [taller, setTaller] = useState("");
  const [odometro, setOdometro] = useState("");
  const [costo, setCosto] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");

  const tipos = [["reparacion","Reparación / Compra"],["mantencion","Mantención"],["siniestro","Siniestro"],["otro","Otro"]];
  const comps = [["","(ninguno)"],["neumatico","Neumáticos"],["frenos","Frenos"],["amortiguadores","Amortiguadores"],["direccion","Dirección"],["embrague","Embrague"]];

  async function guardar() {
    if (!fecha) { setErr("La fecha es obligatoria."); return; }
    if (!descripcion && !item) { setErr("Poné una descripción o ítem."); return; }
    setGuardando(true); setErr("");
    try {
      let adjunto_url = null;
      if (archivo) {
        const ext = (archivo.name.split(".").pop() || "pdf").toLowerCase();
        const path = `${patente}/${Date.now()}.${ext}`;
        const { error: upErr } = await sb.storage.from("ca-adjuntos").upload(path, archivo, { upsert: false });
        if (upErr) throw new Error("Subida PDF: " + upErr.message);
        const { data: pub } = sb.storage.from("ca-adjuntos").getPublicUrl(path);
        adjunto_url = pub?.publicUrl || null;
      }
      const { error } = await sb.from("ca_eventos").insert({
        patente, tipo, componente: componente || null, fecha_servicio: fecha,
        descripcion: descripcion || null, item: item || null, taller: taller || null,
        odometro: odometro ? Number(odometro) : null, costo: costo ? Number(costo) : null,
        adjunto_url, registrado_por: usuario?.nombre || null,
      });
      if (error) throw error;
      onGuardado && onGuardado();
    } catch (e) { setErr(e.message); }
    setGuardando(false);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
      <div style={{ background:"#fff", borderRadius:14, padding:24, maxWidth:560, width:"100%", maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <div style={{ fontSize:16, fontWeight:700, color:"#002E5D" }}>Registrar evento · {patente}</div>
          <button onClick={onCerrar} style={{ background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#94a3b8" }}>×</button>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><Label>Tipo de evento</Label><Select value={tipo} onChange={e=>setTipo(e.target.value)}>{tipos.map(([k,v])=><option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label>Componente (resetea contador)</Label><Select value={componente} onChange={e=>setComponente(e.target.value)}>{comps.map(([k,v])=><option key={k} value={k}>{v}</option>)}</Select></div>
          <div><Label>Fecha</Label><Input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></div>
          <div><Label>Odómetro (km)</Label><Input type="number" value={odometro} onChange={e=>setOdometro(e.target.value)} placeholder="Ej: 70010" /></div>
          <div><Label>Taller</Label><Input value={taller} onChange={e=>setTaller(e.target.value)} placeholder="Taller" /></div>
          <div><Label>Costo ($)</Label><Input type="number" value={costo} onChange={e=>setCosto(e.target.value)} placeholder="Ej: 350000" /></div>
        </div>
        <div style={{ marginTop:12 }}><Label>Ítem</Label><Input value={item} onChange={e=>setItem(e.target.value)} placeholder="Ej: Compra de neumáticos traseros" /></div>
        <div style={{ marginTop:12 }}><Label>Descripción</Label><Textarea value={descripcion} onChange={e=>setDescripcion(e.target.value)} rows={2} placeholder="Detalle del trabajo / compra" /></div>
        <div style={{ marginTop:12 }}>
          <Label>Adjunto PDF (factura/orden)</Label>
          <input type="file" accept="application/pdf,image/*" onChange={e=>setArchivo(e.target.files?.[0]||null)} style={{ fontSize:12 }} />
          {archivo && <span style={{ fontSize:11, color:"#666", marginLeft:8 }}>{archivo.name}</span>}
        </div>

        {err && <div style={{ marginTop:12, padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13 }}>{err}</div>}

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:18 }}>
          <Btn onClick={onCerrar} color="#94a3b8" outline>Cancelar</Btn>
          <Btn onClick={guardar} color="#002E5D">{guardando?"Guardando…":"Guardar evento"}</Btn>
        </div>
      </div>
    </div>
  );
}

function FichaVehiculo({ usuario }) {
  const [patente, setPatente] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  async function buscar() {
    const p = patente.trim().toUpperCase();
    if (!p) { setError("Ingresá una patente."); return; }
    setCargando(true); setError(""); setData(null);
    try {
      const { data: veh } = await sb.from("ca_vehiculos")
        .select("patente,ceco,tipo_vehiculo,modelo,marca,anio,soap,rev_tecnica,permiso_circulacion,status,supervisor").eq("patente", p).maybeSingle();
      if (!veh) { setError(`La patente ${p} no está en la flota.`); setCargando(false); return; }

      const { data: odo } = await sb.from("ca_odometros")
        .select("odometro,fecha_lectura").eq("patente", p)
        .order("fecha_lectura", { ascending:false }).limit(1).maybeSingle();

      const [mant, rep, sin, otr, eve] = await Promise.all([
        sb.from("ca_mantenciones").select("fecha_servicio,servicio_efectuado,item,taller,odometro,costo").eq("patente", p),
        sb.from("ca_reparaciones").select("fecha_servicio,servicio_efectuado,item,taller,odometro,costo").eq("patente", p),
        sb.from("ca_siniestros").select("fecha_servicio,item,taller,odometro,costo,precio_reparacion_total").eq("patente", p),
        sb.from("ca_otros").select("fecha_servicio,servicio_efectuado,item,taller,km_al_momento,costo").eq("patente", p),
        sb.from("ca_eventos").select("fecha_servicio,tipo,componente,descripcion,item,taller,odometro,costo,adjunto_url").eq("patente", p),
      ]);

      const ev = [];
      (mant.data||[]).forEach(r => ev.push({ tipo:"Mantención", color:"#002E5D", bg:"#eef2ff", fecha:r.fecha_servicio, desc:r.servicio_efectuado||r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.costo)||0 }));
      (rep.data||[]).forEach(r => ev.push({ tipo:"Reparación", color:"#0369a1", bg:"#e0f2fe", fecha:r.fecha_servicio, desc:r.servicio_efectuado||r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.costo)||0 }));
      (sin.data||[]).forEach(r => ev.push({ tipo:"Siniestro", color:"#c0392b", bg:"#fee2e2", fecha:r.fecha_servicio, desc:r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.precio_reparacion_total)||Number(r.costo)||0 }));
      (otr.data||[]).forEach(r => ev.push({ tipo:"Otro", color:"#92400e", bg:"#fef3c7", fecha:r.fecha_servicio, desc:r.servicio_efectuado||r.item, taller:r.taller, odometro:r.km_al_momento, costo:Number(r.costo)||0 }));
      (eve.data||[]).forEach(r => { const tc=({mantencion:["Mantención","#002E5D","#eef2ff"],reparacion:["Reparación","#0369a1","#e0f2fe"],siniestro:["Siniestro","#c0392b","#fee2e2"],otro:["Otro","#92400e","#fef3c7"]})[r.tipo]||["Evento","#475569","#f1f5f9"]; ev.push({ tipo:tc[0]+(r.componente?` · ${r.componente}`:""), color:tc[1], bg:tc[2], fecha:r.fecha_servicio, desc:r.descripcion||r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.costo)||0, adjunto:r.adjunto_url }); });
      ev.sort((a,b) => new Date(b.fecha||0) - new Date(a.fecha||0));

      const tot = (arr) => arr.reduce((s,e)=>s+e.costo,0);
      const resumen = {
        total: tot(ev), n: ev.length,
        mant: tot(ev.filter(e=>e.tipo==="Mantención")),
        rep: tot(ev.filter(e=>e.tipo==="Reparación")),
        sin: tot(ev.filter(e=>e.tipo==="Siniestro")),
      };
      setData({ veh, km: odo ? Number(odo.odometro) : null, fechaOdo: odo?.fecha_lectura, ev, resumen });
    } catch (e) { setError("Error: " + e.message); }
    setCargando(false);
  }

  const clp = (n) => "$" + (Number(n)||0).toLocaleString("es-CL");
  const fch = (f) => f ? new Date(f).toLocaleDateString("es-CL") : "—";
  const venc = (f) => {
    if (!f) return { txt:"—", color:"#94a3b8" };
    const dias = Math.floor((new Date(f) - Date.now())/86400000);
    if (dias < 0) return { txt:`Vencida (${fch(f)})`, color:"#c0392b" };
    if (dias < 30) return { txt:`Vence en ${dias}d (${fch(f)})`, color:"#d97706" };
    return { txt:fch(f), color:"#166534" };
  };

  return (
    <div style={{ maxWidth:900 }}>
      <div className="form-card">
        <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 220px" }}>
            <Label>Patente</Label>
            <Input value={patente} onChange={e=>setPatente(e.target.value.toUpperCase())} placeholder="Ej: SLCY14" />
          </div>
          <Btn onClick={buscar} color="#002E5D">{cargando ? "Buscando…" : "Buscar"}</Btn>
        </div>
        {error && <div style={{ marginTop:14, padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13 }}>{error}</div>}
      </div>

      {data && (() => {
        const soap = venc(data.veh.soap), rt = venc(data.veh.rev_tecnica);
        return (
        <>
          <div className="form-card">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:10 }}>
              <div>
                <div style={{ fontSize:18, fontWeight:700, color:"#1a1a1a" }}>{data.veh.patente}</div>
                <div style={{ fontSize:13, color:"#666" }}>{data.veh.marca} {data.veh.modelo} · {data.veh.anio || "—"} · CECO: {data.veh.ceco} · Supervisor: {data.veh.supervisor||"—"}</div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:20, background:data.veh.status==="ACTIVO"?"#dcfce7":"#f1f5f9", color:data.veh.status==="ACTIVO"?"#166534":"#64748b" }}>{data.veh.status}</span>
                <Btn onClick={()=>setMostrarForm(true)} color="#002E5D" small>+ Registrar evento</Btn>
              </div>
              {mostrarForm && <FormRegistrarEvento patente={data.veh.patente} usuario={usuario} onCerrar={()=>setMostrarForm(false)} onGuardado={()=>{ setMostrarForm(false); buscar(); }} />}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginTop:16 }}>
              <div><Label>KM actual</Label><div style={{ fontSize:15, fontWeight:700 }}>{data.km!=null?data.km.toLocaleString("es-CL")+" km":"—"}</div></div>
              <div><Label>SOAP</Label><div style={{ fontSize:13, fontWeight:600, color:soap.color }}>{soap.txt}</div></div>
              <div><Label>Revisión técnica</Label><div style={{ fontSize:13, fontWeight:600, color:rt.color }}>{rt.txt}</div></div>
              <div><Label>Tipo</Label><div style={{ fontSize:13, fontWeight:600 }}>{data.veh.tipo_vehiculo}</div></div>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:16 }}>
            <KPI label="Gasto total" valor={clp(data.resumen.total)} color="#002E5D" />
            <KPI label="Eventos" valor={data.resumen.n} sub="en el historial" color="#0369a1" />
            <KPI label="Mantenciones" valor={clp(data.resumen.mant)} color="#002E5D" />
            <KPI label="Reparaciones" valor={clp(data.resumen.rep)} color="#0369a1" />
            <KPI label="Siniestros" valor={clp(data.resumen.sin)} color="#c0392b" />
          </div>

          <div className="form-card">
            <div className="form-title">Historial unificado ({data.ev.length})</div>
            {data.ev.length===0 ? (
              <div style={{ fontSize:13, color:"#94a3b8", padding:"10px 0" }}>Sin eventos registrados.</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {data.ev.map((e,i) => (
                  <div key={i} style={{ display:"flex", gap:12, alignItems:"center", padding:"10px 12px", border:"1px solid #f1f5f9", borderRadius:8, borderLeft:`3px solid ${e.color}` }}>
                    <div style={{ minWidth:90 }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:6, background:e.bg, color:e.color }}>{e.tipo}</span>
                    </div>
                    <div style={{ minWidth:80, fontSize:12, color:"#666" }}>{fch(e.fecha)}</div>
                    <div style={{ flex:1, fontSize:13, color:"#1a1a1a" }}>
                      {e.desc || "—"}
                      <span style={{ color:"#94a3b8", fontSize:11 }}>{e.taller?` · ${e.taller}`:""}{e.odometro?` · ${Number(e.odometro).toLocaleString("es-CL")} km`:""}</span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2, whiteSpace:"nowrap" }}>
                      <span style={{ fontWeight:700, fontSize:13, color:"#1a1a1a" }}>{clp(e.costo)}</span>
                      {e.adjunto && <a href={e.adjunto} target="_blank" rel="noreferrer" style={{ fontSize:10, color:"#0369a1" }}>📎 PDF</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
        );
      })()}
    </div>
  );
}

function TableroAlertas() {
  const [rows, setRows] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [fComp, setFComp] = useState("todos");
  const [fEstado, setFEstado] = useState("criticos");

  async function cargar() {
    setCargando(true); setError("");
    try {
      const { data, error } = await sb.from("vw_ca_alertas").select("*");
      if (error) throw error;
      setRows(data || []);
    } catch (e) { setError("Error: " + e.message); }
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  const cfg = {
    supera_limite: { txt:"Supera límite", color:"#c0392b", bg:"#fee2e2", ico:"🔴", ord:0 },
    alerta:        { txt:"Alerta",        color:"#92400e", bg:"#fef3c7", ico:"🟡", ord:1 },
    ok:            { txt:"OK",            color:"#166534", bg:"#dcfce7", ico:"🟢", ord:2 },
    sin_dato:      { txt:"Sin dato",      color:"#64748b", bg:"#f1f5f9", ico:"⚪", ord:3 },
  };
  const comps = ["todos","neumatico","frenos","amortiguadores","direccion","embrague"];
  const all = rows || [];
  const resumen = {
    supera: all.filter(r=>r.estado==="supera_limite").length,
    alerta: all.filter(r=>r.estado==="alerta").length,
    ok:     all.filter(r=>r.estado==="ok").length,
    sin:    all.filter(r=>r.estado==="sin_dato").length,
  };

  let vis = all.filter(r => fComp==="todos" || r.componente===fComp);
  if (fEstado==="criticos") vis = vis.filter(r=>r.estado==="supera_limite"||r.estado==="alerta");
  else if (fEstado!=="todos") vis = vis.filter(r=>r.estado===fEstado);
  vis = [...vis].sort((a,b) => {
    const oa=cfg[a.estado]?.ord??9, ob=cfg[b.estado]?.ord??9;
    if (oa!==ob) return oa-ob;
    const da=a.dias_al_limite==null?1e9:Number(a.dias_al_limite), db=b.dias_al_limite==null?1e9:Number(b.dias_al_limite);
    return da-db;
  });

  const cl = (n)=> n==null?"—":Number(n).toLocaleString("es-CL");

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:16 }}>
        <KPI label="🔴 Supera límite" valor={resumen.supera} color="#c0392b" />
        <KPI label="🟡 En alerta"     valor={resumen.alerta} color="#d97706" />
        <KPI label="🟢 En protocolo"  valor={resumen.ok} color="#166534" />
        <KPI label="⚪ Sin dato"       valor={resumen.sin} sub="sin servicio registrado" color="#64748b" />
      </div>

      <div className="form-card">
        <div style={{ display:"flex", gap:16, flexWrap:"wrap", alignItems:"flex-end", marginBottom:14 }}>
          <div style={{ minWidth:170 }}>
            <Label>Componente</Label>
            <Select value={fComp} onChange={e=>setFComp(e.target.value)}>
              {comps.map(c => <option key={c} value={c}>{c==="todos"?"Todos":c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </Select>
          </div>
          <div style={{ minWidth:170 }}>
            <Label>Estado</Label>
            <Select value={fEstado} onChange={e=>setFEstado(e.target.value)}>
              <option value="criticos">Solo críticos (🔴+🟡)</option>
              <option value="supera_limite">🔴 Supera límite</option>
              <option value="alerta">🟡 Alerta</option>
              <option value="ok">🟢 OK</option>
              <option value="todos">Todos</option>
            </Select>
          </div>
          <Btn onClick={cargar} color="#002E5D" outline>{cargando?"Cargando…":"Refrescar"}</Btn>
          <div style={{ fontSize:12, color:"#94a3b8", marginLeft:"auto" }}>{vis.length} resultado(s)</div>
        </div>

        {error && <div style={{ padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13 }}>{error}</div>}

        {!error && (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #e4e7ec", textAlign:"left", color:"#64748b", fontSize:11, textTransform:"uppercase", letterSpacing:.4 }}>
                  <th style={{ padding:"8px 6px" }}>Estado</th>
                  <th style={{ padding:"8px 6px" }}>Patente</th>
                  <th style={{ padding:"8px 6px" }}>Modelo</th>
                  <th style={{ padding:"8px 6px" }}>Componente</th>
                  <th style={{ padding:"8px 6px", textAlign:"right" }}>Recorrido / Límite</th>
                  <th style={{ padding:"8px 6px", textAlign:"right" }}>km/día (30d)</th>
                  <th style={{ padding:"8px 6px", textAlign:"right" }}>Días al límite</th>
                </tr>
              </thead>
              <tbody>
                {vis.map((r,i) => {
                  const c = cfg[r.estado] || cfg.sin_dato;
                  const dias = r.dias_al_limite;
                  const diasTxt = r.estado==="supera_limite" ? "Vencido" : dias==null ? "—" : `${cl(dias)} días`;
                  const diasColor = r.estado==="supera_limite" ? "#c0392b" : (dias!=null && Number(dias)<=30) ? "#d97706" : "#475569";
                  return (
                    <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                      <td style={{ padding:"8px 6px" }}><span style={{ fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:6, background:c.bg, color:c.color, whiteSpace:"nowrap" }}>{c.ico} {c.txt}</span></td>
                      <td style={{ padding:"8px 6px", fontWeight:700 }}>{r.patente}</td>
                      <td style={{ padding:"8px 6px", color:"#666" }}>{r.modelo}</td>
                      <td style={{ padding:"8px 6px", textTransform:"capitalize" }}>{r.componente}</td>
                      <td style={{ padding:"8px 6px", textAlign:"right" }}>{cl(r.recorrido)} / {cl(r.limite)}</td>
                      <td style={{ padding:"8px 6px", textAlign:"right", color:"#666" }}>{cl(r.km_dia_30)}</td>
                      <td style={{ padding:"8px 6px", textAlign:"right", fontWeight:700, color:diasColor }}>{diasTxt}</td>
                    </tr>
                  );
                })}
                {vis.length===0 && <tr><td colSpan={7} style={{ padding:"20px", textAlign:"center", color:"#94a3b8" }}>Sin resultados con estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function VerificadorComponentes({ usuario }) {
  const [componente, setComponente] = useState("neumatico");
  const [patente, setPatente] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [msg, setMsg] = useState("");

  const compLabels = { neumatico:"Neumáticos", frenos:"Frenos", amortiguadores:"Amortiguadores", direccion:"Dirección", embrague:"Embrague" };

  async function verificar() {
    const p = patente.trim().toUpperCase();
    if (!p) { setError("Ingresá una patente."); return; }
    setCargando(true); setError(""); setInfo(null); setMsg("");
    try {
      const { data: veh } = await sb.from("ca_vehiculos").select("patente,ceco,tipo_vehiculo,modelo,supervisor").eq("patente", p).maybeSingle();
      if (!veh) { setError(`La patente ${p} no está en la flota.`); setCargando(false); return; }
      const { data: row } = await sb.from("vw_ca_alertas").select("*").eq("patente", p).eq("componente", componente).maybeSingle();
      if (!row) { setError(`No hay protocolo de ${compLabels[componente]} para el modelo ${veh.modelo}.`); setCargando(false); return; }
      setInfo({ veh, row });
    } catch (e) { setError("Error: " + e.message); }
    setCargando(false);
  }

  async function generarSolicitud() {
    if (!info) return;
    setGenerando(true); setMsg("");
    const { veh, row } = info;
    const num = (x) => x == null ? null : Number(x);
    const kmActual = num(row.km_actual), kmServ = num(row.km_ultimo_servicio), recorrido = num(row.recorrido);
    const alerta = num(row.alerta), limite = num(row.limite);
    const kmAlerta = kmServ!=null?kmServ+alerta:null, kmLimite = kmServ!=null?kmServ+limite:null;
    const kmRest = kmLimite!=null?kmLimite-kmActual:null;
    const cl = (n) => n==null?"—":Number(n).toLocaleString("es-CL");
    const just = `Vehículo ${veh.patente} (${veh.modelo}, ${veh.ceco}) · ${compLabels[componente]}: recorrió ${cl(recorrido)} km desde el último servicio (odómetro ${cl(kmServ)} km). Umbral de alerta: ${cl(alerta)} km; límite: ${cl(limite)} km. Km actual: ${cl(kmActual)} km. Se solicita autorización de cambio/compra.`;
    try {
      const { error } = await sb.from("ca_solicitudes").insert({
        patente:veh.patente, ceco:veh.ceco, tipo_vehiculo:veh.tipo_vehiculo, modelo:veh.modelo,
        componente, km_ultima_compra:kmServ, km_actual:kmActual, km_recorridos:recorrido,
        km_alerta:kmAlerta, km_limite:kmLimite, km_restantes:kmRest, estado_protocolo:row.estado,
        justificacion:just, solicitante: usuario?.nombre||null, status:"pendiente",
      });
      if (error) throw error;
      setMsg("✅ Solicitud generada y enviada a Finanzas.");
    } catch (e) { setMsg("❌ Error: " + e.message); }
    setGenerando(false);
  }

  const fmt = (n) => n==null?"—":Number(n).toLocaleString("es-CL")+" km";
  const estadoCfg = {
    ok:            { txt:"En protocolo",     color:"#166534", bg:"#dcfce7", ico:"✓" },
    alerta:        { txt:"En alerta",         color:"#92400e", bg:"#fef3c7", ico:"⚠" },
    supera_limite: { txt:"Supera límite",     color:"#c0392b", bg:"#fee2e2", ico:"⚠" },
    sin_dato:      { txt:"Sin servicio previo",color:"#475569", bg:"#f1f5f9", ico:"•" },
  };

  return (
    <div>
      <div style={{ maxWidth:760, marginBottom:28 }}>
        <div style={{ background:"#002E5D", color:"#fff", borderRadius:"14px 14px 0 0", padding:"16px 20px", display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18 }}>🔧</span>
          <span style={{ fontSize:15, fontWeight:700 }}>Verificador de Componentes — Bigticket</span>
        </div>
        <div style={{ background:"#fff", border:"1px solid #e4e7ec", borderTop:"none", borderRadius:"0 0 14px 14px", padding:20 }}>
          <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap" }}>
            <div style={{ flex:"1 1 180px" }}>
              <Label>Componente</Label>
              <Select value={componente} onChange={e=>{ setComponente(e.target.value); setInfo(null); }}>
                {Object.entries(compLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div style={{ flex:"1 1 180px" }}>
              <Label>Patente</Label>
              <Input value={patente} onChange={e=>setPatente(e.target.value.toUpperCase())} placeholder="Ej: SLCY14" />
            </div>
            <Btn onClick={verificar} color="#002E5D">{cargando?"Verificando…":"Verificar"}</Btn>
          </div>

          {error && <div style={{ marginTop:14, padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13 }}>{error}</div>}

          {info && (() => {
            const r = info.row;
            const recorrido = r.recorrido!=null?Number(r.recorrido):null;
            const alerta = Number(r.alerta), limite = Number(r.limite);
            const kmActual = Number(r.km_actual), kmServ = r.km_ultimo_servicio!=null?Number(r.km_ultimo_servicio):null;
            const kmAlerta = kmServ!=null?kmServ+alerta:null, kmLimite = kmServ!=null?kmServ+limite:null;
            const kmRest = kmLimite!=null?kmLimite-kmActual:null;
            const cfg = estadoCfg[r.estado] || estadoCfg.sin_dato;
            const pct = recorrido!=null?Math.min(100,Math.max(0,(recorrido/limite)*100)):0;
            const pctAl = Math.min(100,(alerta/limite)*100);
            const barColor = r.estado==="supera_limite"?"#dc2626":r.estado==="alerta"?"#d97706":"#16a34a";
            return (
            <div style={{ marginTop:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700 }}>{compLabels[componente]} · {info.veh.modelo} {info.veh.patente}</div>
                  <div style={{ fontSize:12, color:"#666", marginTop:2 }}>CECO: {info.veh.ceco||"—"} · Supervisor: {info.veh.supervisor||"—"}</div>
                </div>
                <span style={{ fontSize:12, fontWeight:700, padding:"5px 12px", borderRadius:20, background:cfg.bg, color:cfg.color }}>{cfg.ico} {cfg.txt}</span>
              </div>
              <div style={{ fontSize:12, color:"#666", marginBottom:10 }}>Último servicio: {kmServ!=null?kmServ.toLocaleString("es-CL"):"—"} → KM actual: {kmActual.toLocaleString("es-CL")}{r.dias_al_limite!=null?` · ~${Number(r.dias_al_limite).toLocaleString("es-CL")} días al límite`:""}</div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#94a3b8", marginBottom:4 }}>
                <span>0 km</span><span>Alerta: {alerta.toLocaleString("es-CL")}</span><span>Límite: {limite.toLocaleString("es-CL")}</span>
              </div>
              <div style={{ position:"relative", height:14, background:"#f1f5f9", borderRadius:8, overflow:"hidden", marginBottom:4 }}>
                <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${pct}%`, background:barColor, transition:"width .4s" }} />
                <div style={{ position:"absolute", left:`${pctAl}%`, top:0, height:"100%", width:2, background:"#64748b" }} />
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:18 }}>
                <span style={{ color:"#666" }}>Recorrido desde último servicio:</span>
                <span style={{ fontWeight:700 }}>{recorrido!=null?recorrido.toLocaleString("es-CL"):"—"} km</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:18 }}>
                <KPI label="KM de alerta" valor={fmt(kmAlerta)} color="#d97706" />
                <KPI label="KM límite máximo" valor={fmt(kmLimite)} color="#dc2626" />
                <KPI label="KM restantes al límite" valor={fmt(kmRest)} color={kmRest!=null&&kmRest<0?"#dc2626":"#002E5D"} />
              </div>
              <div style={{ borderTop:"1px solid #e4e7ec", paddingTop:16 }}>
                {(r.estado==="alerta"||r.estado==="supera_limite") ? (
                  <Btn onClick={generarSolicitud} color="#002E5D">{generando?"Generando…":"Generar solicitud para finanzas"}</Btn>
                ) : r.estado==="sin_dato" ? (
                  <div style={{ fontSize:13, color:"#92400e" }}>Sin servicio previo registrado de {compLabels[componente].toLowerCase()} — no se puede calcular recorrido.</div>
                ) : (
                  <div style={{ fontSize:13, color:"#166534" }}>✓ Dentro de protocolo — no corresponde cambio. Consulta registrada.</div>
                )}
                {msg && <div style={{ marginTop:12, fontSize:13, fontWeight:600 }}>{msg}</div>}
              </div>
            </div>
            );
          })()}
        </div>
      </div>

      <div style={{ fontSize:15, fontWeight:700, color:"#002E5D", marginBottom:4 }}>Panorama de la flota</div>
      <div style={{ fontSize:12, color:"#666", marginBottom:14 }}>Estado de todos los componentes de la flota</div>
      <TableroAlertas />
    </div>
  );
}

function FlujoCaja() {
  const [rows, setRows] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [horizonte, setHorizonte] = useState(30);
  const [precios, setPrecios] = useState({});

  async function cargar() {
    setCargando(true); setError("");
    try {
      const { data, error } = await sb.from("vw_ca_flujo").select("*");
      if (error) throw error;
      setRows(data || []);
      const { data: pm } = await sb.from("ca_precios_mercado").select("componente,modelo,precio_clp");
      const mapa = {}; (pm||[]).forEach(p => { mapa[`${p.componente}|${p.modelo}`] = p.precio_clp!=null?Number(p.precio_clp):null; });
      setPrecios(mapa);
    } catch (e) { setError("Error: " + e.message); }
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  const all = rows || [];
  const compLabel = { neumatico:"Neumáticos", frenos:"Frenos", amortiguadores:"Amortiguadores", direccion:"Dirección", embrague:"Embrague" };

  // clasificar cada par vehículo-componente según el horizonte
  const items = [];
  for (const r of all) {
    const recorrido = r.recorrido!=null?Number(r.recorrido):null;
    const limite = Number(r.limite);
    const kmDia = r.km_dia_30!=null?Number(r.km_dia_30):null;
    let costo = r.costo_estimado!=null?Number(r.costo_estimado):null;
    let costoFuente = r.costo_fuente;
    if (costo==null) { const pm = precios[`${r.componente}|${r.modelo}`]; if (pm!=null) { costo = pm; costoFuente = "mercado"; } }
    if (recorrido==null) continue;
    let clase = null, diasCruce = null;
    if (r.estado==="supera_limite") { clase="inmediato"; diasCruce=0; }
    else if (kmDia && kmDia>0) {
      const proyectado = recorrido + kmDia*horizonte;
      if (proyectado >= limite) {
        clase="proyectado";
        diasCruce = Math.max(0, Math.round((limite - recorrido)/kmDia));
      }
    }
    if (clase) items.push({ ...r, costo, costo_fuente: costoFuente, clase, diasCruce });
  }
  items.sort((a,b) => (a.clase===b.clase ? (a.diasCruce-b.diasCruce) : (a.clase==="inmediato"?-1:1)));

  const sum = (arr) => arr.reduce((s,e)=>s+(e.costo||0),0);
  const inmediatos = items.filter(i=>i.clase==="inmediato");
  const proyectados = items.filter(i=>i.clase==="proyectado");
  const sinCosto = items.filter(i=>i.costo==null).length;
  const clp = (n)=> n==null?"s/d":"$"+Number(n).toLocaleString("es-CL");

  return (
    <div>
      <div className="form-card" style={{ display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap" }}>
        <div style={{ minWidth:160 }}>
          <Label>Horizonte</Label>
          <Select value={horizonte} onChange={e=>setHorizonte(Number(e.target.value))}>
            <option value={30}>Próximos 30 días</option>
            <option value={60}>Próximos 60 días</option>
            <option value={90}>Próximos 90 días</option>
          </Select>
        </div>
        <Btn onClick={cargar} color="#002E5D" outline>{cargando?"Cargando…":"Refrescar"}</Btn>
        <div style={{ fontSize:11, color:"#94a3b8", marginLeft:"auto", maxWidth:280 }}>
          Costo por componente×modelo (fallback global). "s/d" = sin historial de precio.
        </div>
      </div>

      {error && <div style={{ padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13, marginBottom:16 }}>{error}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:16 }}>
        <KPI label="Caja total estimada" valor={clp(sum(items))} sub={`${items.length} cambios`} color="#002E5D" />
        <KPI label="🔴 Gasto inmediato" valor={clp(sum(inmediatos))} sub={`${inmediatos.length} ya vencidos`} color="#c0392b" />
        <KPI label="🟡 Proyectado" valor={clp(sum(proyectados))} sub={`en ${horizonte} días`} color="#d97706" />
        {sinCosto>0 && <KPI label="Sin costo histórico" valor={sinCosto} sub="usar precio de mercado" color="#64748b" />}
      </div>

      <div className="form-card">
        <div className="form-title">Detalle de cambios — {horizonte} días</div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:"2px solid #e4e7ec", textAlign:"left", color:"#64748b", fontSize:11, textTransform:"uppercase", letterSpacing:.4 }}>
                <th style={{ padding:"8px 6px" }}>Cuándo</th>
                <th style={{ padding:"8px 6px" }}>Patente</th>
                <th style={{ padding:"8px 6px" }}>Modelo</th>
                <th style={{ padding:"8px 6px" }}>Componente</th>
                <th style={{ padding:"8px 6px", textAlign:"right" }}>Días al cruce</th>
                <th style={{ padding:"8px 6px", textAlign:"right" }}>Costo estimado</th>
                <th style={{ padding:"8px 6px" }}>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r,i) => (
                <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"8px 6px" }}>
                    <span style={{ fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:6, background:r.clase==="inmediato"?"#fee2e2":"#fef3c7", color:r.clase==="inmediato"?"#c0392b":"#92400e" }}>
                      {r.clase==="inmediato"?"🔴 Ya":"🟡 Proyectado"}
                    </span>
                  </td>
                  <td style={{ padding:"8px 6px", fontWeight:700 }}>{r.patente}</td>
                  <td style={{ padding:"8px 6px", color:"#666" }}>{r.modelo}</td>
                  <td style={{ padding:"8px 6px" }}>{compLabel[r.componente]||r.componente}</td>
                  <td style={{ padding:"8px 6px", textAlign:"right" }}>{r.clase==="inmediato"?"Vencido":`${r.diasCruce} d`}</td>
                  <td style={{ padding:"8px 6px", textAlign:"right", fontWeight:700, color:r.costo==null?"#94a3b8":"#1a1a1a" }}>{clp(r.costo)}</td>
                  <td style={{ padding:"8px 6px", fontSize:11, color:"#94a3b8" }}>{r.costo_fuente||"—"}</td>
                </tr>
              ))}
              {items.length===0 && <tr><td colSpan={7} style={{ padding:"20px", textAlign:"center", color:"#94a3b8" }}>Sin cambios proyectados en este horizonte.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Bitacora({ usuario }) {
  const [sols, setSols] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [fEstado, setFEstado] = useState("pendiente");
  const [accion, setAccion] = useState(null);
  const [hist, setHist] = useState(null);
  const [verHist, setVerHist] = useState(false);

  async function cargar() {
    setCargando(true); setError("");
    try {
      const { data, error } = await sb.from("ca_solicitudes").select("*").order("creado_en", { ascending:false });
      if (error) throw error;
      setSols(data || []);
    } catch (e) { setError("Error: " + e.message); }
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  async function cambiarEstado(id, nuevo) {
    setAccion(id);
    try {
      const { error } = await sb.from("ca_solicitudes").update({ status: nuevo }).eq("id", id);
      if (error) throw error;
      await cargar();
    } catch (e) { setError("Error al actualizar: " + e.message); }
    setAccion(null);
  }

  async function toggleHist() {
    if (hist) { setVerHist(!verHist); return; }
    try {
      const { data } = await sb.from("ca_bitacora").select("*").order("fecha_solicitud", { ascending:false });
      setHist(data || []); setVerHist(true);
    } catch (e) { setError("Error histórico: " + e.message); }
  }

  const all = sols || [];
  const cfg = {
    pendiente: { txt:"Pendiente", color:"#92400e", bg:"#fef3c7" },
    aprobada:  { txt:"Aprobada",  color:"#166534", bg:"#dcfce7" },
    rechazada: { txt:"Rechazada", color:"#c0392b", bg:"#fee2e2" },
  };
  const resumen = {
    pendiente: all.filter(s=>s.status==="pendiente").length,
    aprobada:  all.filter(s=>s.status==="aprobada").length,
    rechazada: all.filter(s=>s.status==="rechazada").length,
  };
  const vis = fEstado==="todas" ? all : all.filter(s=>s.status===fEstado);
  const compLabel = { neumaticos:"Neumáticos", neumatico:"Neumáticos", frenos:"Frenos", amortiguadores:"Amortiguadores", direccion:"Dirección", embrague:"Embrague" };
  const cl = (n)=> n==null?"—":Number(n).toLocaleString("es-CL");
  const fch = (f)=> f?new Date(f).toLocaleDateString("es-CL"):"—";

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:16 }}>
        <KPI label="🟡 Pendientes" valor={resumen.pendiente} color="#d97706" />
        <KPI label="🟢 Aprobadas"  valor={resumen.aprobada} color="#166534" />
        <KPI label="🔴 Rechazadas" valor={resumen.rechazada} color="#c0392b" />
      </div>

      <div className="form-card">
        <div style={{ display:"flex", gap:16, alignItems:"flex-end", marginBottom:14, flexWrap:"wrap" }}>
          <div style={{ minWidth:180 }}>
            <Label>Estado</Label>
            <Select value={fEstado} onChange={e=>setFEstado(e.target.value)}>
              <option value="pendiente">Pendientes</option>
              <option value="aprobada">Aprobadas</option>
              <option value="rechazada">Rechazadas</option>
              <option value="todas">Todas</option>
            </Select>
          </div>
          <Btn onClick={cargar} color="#002E5D" outline>{cargando?"Cargando…":"Refrescar"}</Btn>
          <div style={{ fontSize:12, color:"#94a3b8", marginLeft:"auto" }}>{vis.length} solicitud(es)</div>
        </div>

        {error && <div style={{ padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13, marginBottom:10 }}>{error}</div>}

        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:"2px solid #e4e7ec", textAlign:"left", color:"#64748b", fontSize:11, textTransform:"uppercase", letterSpacing:.4 }}>
                <th style={{ padding:"8px 6px" }}>Fecha</th>
                <th style={{ padding:"8px 6px" }}>Patente</th>
                <th style={{ padding:"8px 6px" }}>Componente</th>
                <th style={{ padding:"8px 6px", textAlign:"right" }}>Recorrido / Límite</th>
                <th style={{ padding:"8px 6px" }}>Solicitante</th>
                <th style={{ padding:"8px 6px" }}>Estado</th>
                <th style={{ padding:"8px 6px" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {vis.map((s) => {
                const c = cfg[s.status] || cfg.pendiente;
                return (
                  <tr key={s.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={{ padding:"8px 6px", whiteSpace:"nowrap" }}>{fch(s.creado_en)}</td>
                    <td style={{ padding:"8px 6px", fontWeight:700 }}>{s.patente} <span style={{ fontSize:11, color:"#94a3b8" }}>{s.ceco}</span></td>
                    <td style={{ padding:"8px 6px" }} title={s.justificacion||""}>{compLabel[s.componente]||s.componente} <span style={{ cursor:"help", color:"#0369a1", fontSize:11 }}>ⓘ</span></td>
                    <td style={{ padding:"8px 6px", textAlign:"right" }}>{cl(s.km_recorridos)} / {cl(s.km_limite!=null && s.km_ultima_compra!=null ? s.km_limite - s.km_ultima_compra : null)}</td>
                    <td style={{ padding:"8px 6px", color:"#666" }}>{s.solicitante||"—"}</td>
                    <td style={{ padding:"8px 6px" }}><span style={{ fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:6, background:c.bg, color:c.color }}>{c.txt}</span></td>
                    <td style={{ padding:"8px 6px" }}>
                      {s.status==="pendiente" ? (
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={()=>cambiarEstado(s.id,"aprobada")} disabled={accion===s.id} style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:6, border:"none", background:"#166534", color:"#fff", cursor:"pointer" }}>{accion===s.id?"…":"Aprobar"}</button>
                          <button onClick={()=>cambiarEstado(s.id,"rechazada")} disabled={accion===s.id} style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:6, border:"1px solid #c0392b", background:"#fff", color:"#c0392b", cursor:"pointer" }}>Rechazar</button>
                        </div>
                      ) : (
                        <button onClick={()=>cambiarEstado(s.id,"pendiente")} style={{ fontSize:11, padding:"4px 10px", borderRadius:6, border:"1px solid #d0d5dd", background:"#fff", color:"#666", cursor:"pointer" }}>Reabrir</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {vis.length===0 && <tr><td colSpan={7} style={{ padding:"20px", textAlign:"center", color:"#94a3b8" }}>Sin solicitudes con este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop:8 }}>
        <Btn onClick={toggleHist} color="#64748b" outline small>{verHist?"Ocultar":"Ver"} histórico Excel (bitácora)</Btn>
      </div>
      {verHist && hist && (
        <div className="form-card" style={{ marginTop:12 }}>
          <div className="form-title">Histórico bitácora (Excel) — {hist.length}</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead><tr style={{ borderBottom:"2px solid #e4e7ec", textAlign:"left", color:"#64748b", fontSize:10, textTransform:"uppercase" }}>
                <th style={{ padding:"6px" }}>Patente</th><th style={{ padding:"6px" }}>Solicitud</th><th style={{ padding:"6px" }}>Necesidad</th><th style={{ padding:"6px", textAlign:"right" }}>Monto</th><th style={{ padding:"6px" }}>Status</th>
              </tr></thead>
              <tbody>
                {hist.map((h,i)=>(
                  <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={{ padding:"6px", fontWeight:600 }}>{h.patente}</td>
                    <td style={{ padding:"6px" }}>{fch(h.fecha_solicitud)}</td>
                    <td style={{ padding:"6px", color:"#666" }}>{h.necesidad_operativa||"—"}</td>
                    <td style={{ padding:"6px", textAlign:"right" }}>{h.monto_presupuesto?("$"+cl(h.monto_presupuesto)):"—"}</td>
                    <td style={{ padding:"6px" }}>{h.status_solicitud||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MantenedorSupervisores() {
  const [veh, setVeh] = useState(null);
  const [sup, setSup] = useState(null);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [vEd, setVEd] = useState({});
  const [sEd, setSEd] = useState({});
  const [guardando, setGuardando] = useState(null);
  const [nuevo, setNuevo] = useState({ nombre:"", correo:"", telefono:"", cargo:"", recibe_global:false });

  async function cargar() {
    setCargando(true); setError(""); setOkMsg("");
    try {
      const [{ data: v, error: ev }, { data: s, error: es }] = await Promise.all([
        sb.from("ca_vehiculos").select("patente,modelo,ceco,supervisor,status").order("patente"),
        sb.from("ca_supervisores").select("nombre,correo,telefono,cargo,recibe_global").order("recibe_global").order("nombre"),
      ]);
      if (ev) throw ev; if (es) throw es;
      setVeh(v||[]); setSup(s||[]);
      const ve={}; (v||[]).forEach(r=>{ ve[r.patente]={ ceco:r.ceco||"", supervisor:r.supervisor||"" }; }); setVEd(ve);
      const se={}; (s||[]).forEach(r=>{ se[r.nombre]={ correo:r.correo||"", telefono:r.telefono||"", cargo:r.cargo||"", recibe_global:!!r.recibe_global }; }); setSEd(se);
    } catch(e){ setError("Error: "+e.message); }
    setCargando(false);
  }
  useEffect(()=>{ cargar(); }, []);

  async function guardarVeh(patente) {
    setGuardando("v:"+patente); setOkMsg(""); setError("");
    try {
      const e = vEd[patente];
      const { error } = await sb.from("ca_vehiculos").update({ ceco:e.ceco||null, supervisor:e.supervisor||null }).eq("patente", patente);
      if (error) throw error;
      setOkMsg(`✅ ${patente} actualizado`);
    } catch(e){ setError("Error: "+e.message); }
    setGuardando(null);
  }
  async function guardarSup(nombre) {
    setGuardando("s:"+nombre); setOkMsg(""); setError("");
    try {
      const e = sEd[nombre];
      const { error } = await sb.from("ca_supervisores").update({ correo:e.correo||null, telefono:e.telefono||null, cargo:e.cargo||null, recibe_global:!!e.recibe_global }).eq("nombre", nombre);
      if (error) throw error;
      setOkMsg(`✅ ${nombre} actualizado`);
    } catch(e){ setError("Error: "+e.message); }
    setGuardando(null);
  }
  async function agregarSup() {
    if (!nuevo.nombre.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando("nuevo"); setOkMsg(""); setError("");
    try {
      const { error } = await sb.from("ca_supervisores").insert({ nombre:nuevo.nombre.trim().toUpperCase(), correo:nuevo.correo||null, telefono:nuevo.telefono||null, cargo:nuevo.cargo||null, recibe_global:!!nuevo.recibe_global });
      if (error) throw error;
      setNuevo({ nombre:"", correo:"", telefono:"", cargo:"", recibe_global:false });
      await cargar(); setOkMsg("✅ Supervisor agregado");
    } catch(e){ setError("Error: "+e.message); }
    setGuardando(null);
  }

  const F = (filtro||"").toUpperCase();
  const vehs = (veh||[]).filter(r => !F || r.patente.includes(F) || (r.supervisor||"").toUpperCase().includes(F) || (r.ceco||"").toUpperCase().includes(F));
  const supOptions = (sup||[]).map(s=>s.nombre);
  const th = { padding:"8px 6px", textAlign:"left", color:"#64748b", fontSize:11, textTransform:"uppercase", letterSpacing:.4 };
  const td = { padding:"6px", borderBottom:"1px solid #f1f5f9" };
  const inp = { width:"100%", padding:"5px 8px", border:"1px solid #d0d5dd", borderRadius:6, fontSize:13, boxSizing:"border-box" };

  return (
    <div>
      {error && <div style={{ padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13, marginBottom:12 }}>{error}</div>}
      {okMsg && <div style={{ padding:"10px 14px", background:"#dcfce7", color:"#166534", borderRadius:8, fontSize:13, marginBottom:12 }}>{okMsg}</div>}

      <div className="form-card">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:12 }}>
          <div className="form-title" style={{ margin:0 }}>Asignación por patente — Supervisor y CECO</div>
          <Input value={filtro} onChange={e=>setFiltro(e.target.value)} placeholder="Filtrar patente / supervisor / CECO" style={{ maxWidth:280 }} />
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ borderBottom:"2px solid #e4e7ec" }}>
              <th style={th}>Patente</th><th style={th}>Modelo</th><th style={{...th, minWidth:150}}>CECO</th><th style={{...th, minWidth:220}}>Supervisor</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {vehs.map(r => {
                const e = vEd[r.patente] || { ceco:"", supervisor:"" };
                return (
                  <tr key={r.patente}>
                    <td style={{...td, fontWeight:700}}>{r.patente}</td>
                    <td style={{...td, color:"#666"}}>{r.modelo}</td>
                    <td style={td}><input style={inp} value={e.ceco} onChange={ev=>setVEd(p=>({...p,[r.patente]:{...p[r.patente],ceco:ev.target.value}}))} /></td>
                    <td style={td}>
                      <select style={inp} value={e.supervisor} onChange={ev=>setVEd(p=>({...p,[r.patente]:{...p[r.patente],supervisor:ev.target.value}}))}>
                        <option value="">(sin asignar)</option>
                        {supOptions.map(n=><option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td style={td}><button onClick={()=>guardarVeh(r.patente)} disabled={guardando==="v:"+r.patente} style={{ fontSize:11, fontWeight:700, padding:"5px 12px", borderRadius:6, border:"none", background:"#002E5D", color:"#fff", cursor:"pointer" }}>{guardando==="v:"+r.patente?"…":"Guardar"}</button></td>
                  </tr>
                );
              })}
              {vehs.length===0 && <tr><td colSpan={5} style={{ padding:20, textAlign:"center", color:"#94a3b8" }}>{cargando?"Cargando…":"Sin resultados."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize:12, color:"#94a3b8", marginTop:8 }}>{vehs.length} vehículo(s)</div>
      </div>

      <div className="form-card" style={{ marginTop:16 }}>
        <div className="form-title">Supervisores — correo, teléfono y rol</div>
        <div style={{ fontSize:12, color:"#666", marginBottom:10 }}>El teléfono se usa para WhatsApp. "Recibe todas" = gerencia/finanzas que recibe todas las alertas (escalamiento).</div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead><tr style={{ borderBottom:"2px solid #e4e7ec" }}>
              <th style={th}>Nombre</th><th style={th}>Cargo</th><th style={th}>Correo</th><th style={th}>Teléfono</th><th style={{...th, textAlign:"center"}}>Recibe todas</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {(sup||[]).map(r => {
                const e = sEd[r.nombre] || { correo:"", telefono:"", cargo:"", recibe_global:false };
                return (
                  <tr key={r.nombre} style={{ background: e.recibe_global ? "#f0f9ff" : "transparent" }}>
                    <td style={{...td, fontWeight:600}}>{r.nombre}</td>
                    <td style={td}><input style={inp} value={e.cargo} onChange={ev=>setSEd(p=>({...p,[r.nombre]:{...p[r.nombre],cargo:ev.target.value}}))} /></td>
                    <td style={td}><input style={inp} value={e.correo} onChange={ev=>setSEd(p=>({...p,[r.nombre]:{...p[r.nombre],correo:ev.target.value}}))} /></td>
                    <td style={td}><input style={inp} value={e.telefono} onChange={ev=>setSEd(p=>({...p,[r.nombre]:{...p[r.nombre],telefono:ev.target.value}}))} placeholder="+569..." /></td>
                    <td style={{...td, textAlign:"center"}}><input type="checkbox" checked={!!e.recibe_global} onChange={ev=>setSEd(p=>({...p,[r.nombre]:{...p[r.nombre],recibe_global:ev.target.checked}}))} /></td>
                    <td style={td}><button onClick={()=>guardarSup(r.nombre)} disabled={guardando==="s:"+r.nombre} style={{ fontSize:11, fontWeight:700, padding:"5px 12px", borderRadius:6, border:"none", background:"#002E5D", color:"#fff", cursor:"pointer" }}>{guardando==="s:"+r.nombre?"…":"Guardar"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ borderTop:"1px solid #e4e7ec", marginTop:14, paddingTop:14 }}>
          <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>Agregar supervisor</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, alignItems:"end" }}>
            <div><Label>Nombre</Label><Input value={nuevo.nombre} onChange={e=>setNuevo({...nuevo,nombre:e.target.value})} /></div>
            <div><Label>Cargo</Label><Input value={nuevo.cargo} onChange={e=>setNuevo({...nuevo,cargo:e.target.value})} /></div>
            <div><Label>Correo</Label><Input value={nuevo.correo} onChange={e=>setNuevo({...nuevo,correo:e.target.value})} /></div>
            <div><Label>Teléfono</Label><Input value={nuevo.telefono} onChange={e=>setNuevo({...nuevo,telefono:e.target.value})} placeholder="+569..." /></div>
            <label style={{ fontSize:12, display:"flex", alignItems:"center", gap:6 }}><input type="checkbox" checked={nuevo.recibe_global} onChange={e=>setNuevo({...nuevo,recibe_global:e.target.checked})} /> Recibe todas</label>
            <Btn onClick={agregarSup} color="#166534">{guardando==="nuevo"?"…":"Agregar"}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS_CUIDADO_CL = [
  // Orden acordado con Adriana (pedido T-02) y, al final, las pestañas nuevas y las antiguas
  { id: "ca_ficha", label: "Ficha del activo", desc: "Todo de cada patente: datos, documentos, costos e historial" },
  { id: "ca_mantenciones", label: "Mantenciones", desc: "Próxima mantención por km (Geotab), vida útil, pautas y talleres" },
  { id: "ca_reparaciones", label: "Reparaciones", desc: "Solicitud, cotización, aprobación, taller y cierre con gasto" },
  { id: "ca_oc", label: "Órdenes de compra", desc: "OC desde la reparación aprobada, V°B° de Control y envío al taller" },
  { id: "ca_siniestros", label: "Siniestros", desc: "Registro, deducible al tercero, días en taller y pérdida en venta" },
  { id: "ca_flota", label: "Estado de flota", desc: "Qué pasa hoy con cada vehículo propio" },
  { id: "ca_documentos", label: "Documentación", desc: "Subir y confirmar padrón, SOAP, revisión técnica, gases, permiso, seguros y leasing" },
  { id: "ca_gps", label: "GPS y cámaras", desc: "Estado de cada GPS y cámara, equipos caídos, eventos de Fleetup y proveedores" },
  { id: "ca_uso", label: "Uso y detenciones", desc: "Paradas de Geotab cruzadas con entregas, interrupciones y cámaras" },
  { id: "ca_auditorias", label: "Auditorías", desc: "Revisión de auditorías de terceros con Biggy, quién lleva auditoría y devoluciones" },
  { id: "ca_combustible", label: "Combustible", desc: "Consumos de Copec contra la subvención y km de Geotab contra km de ruta" },
  { id: "ca_gastos", label: "Historial de gastos", desc: "Todo lo gastado en la flota: por año, tipo, patente y taller" },
  { id: "ca_alertas", label: "Centro de alertas", desc: "Todas las alertas de la flota en un solo lugar, envíos por correo y reglas" },
  { id: "ca_chat", label: "Chat WhatsApp", desc: "Conversaciones del +56 9 5858 1911: lo que responde Biggy, responder como analista y encender el bot" },
  // Mantenedores se mudó a la pestaña Mantenedor (cl/Mantenedor.jsx)
  { id: "ca_evaluacion", label: "Evaluación del ejecutivo", desc: "Solo jefatura: gestión a tiempo de lo que avisó el sistema" },
  { id: "ca_indicadores", label: "Indicadores", desc: "Evaluación del tercero: conducción Geotab, incumplimientos y multas" },
  { id: "ca_conc", label: "Conciliaciones", desc: "Cierre mensual de cobros al tercero, apelaciones e informe a Finanzas" },
  { id: "ca_tareas", label: "Tareas del supervisor", desc: "Detenciones, hallazgos y avisos al supervisor" },
  { id: "ca_nosalidas", label: "No salidas", desc: "Flota propia sin ruta y su motivo" },
  { id: "ca_incumplimientos", label: "Incumplimientos", desc: "Tareas vencidas por supervisor y mes" },
  { id: "ca_config", label: "Configuración", desc: "Plazos, reglas, justificaciones y correos" },
  { id: "ca_pedido", label: "Avance del pedido", desc: "Estado de cada ítem del pedido de Cuidado de Activo" },
];
registrarSubtabs("mantenciones_cl", TABS_CUIDADO_CL, "ca_ficha");

function ModuloMantencionesMadre({ usuario }) {
  const [sub] = useSubtab("mantenciones_cl");
  return (
    <div className="pg">
      <div className="sec-title">Cuidado de Activo</div>
      <div className="sec-sub">Flota propia Chile: tareas al supervisor, no salidas, mantenciones y protocolo de flota</div>
      <div style={{ marginBottom: 16 }}><div style={{ fontSize: 15, fontWeight: 700, color: "#FF6600", fontFamily: "Poppins, 'Open Sans', sans-serif", marginTop: 2 }}>{(TABS_CUIDADO_CL.find((t) => t.id === sub) || {}).label}</div></div>
      {sub.startsWith("ca_") && <CuidadoActivoCL usuario={usuario} sub={sub} />}
    </div>
  );
}

function MantPlaceholder({ titulo }) {
  return (
    <div className="form-card" style={{ textAlign:"center", padding:40, color:"#94a3b8" }}>
      <div style={{ fontSize:15, fontWeight:700, color:"#475569", marginBottom:6 }}>{titulo}</div>
      <div style={{ fontSize:13 }}>En construcción — próxima iteración.</div>
    </div>
  );
}

function VerificadorNeumaticos({ usuario }) {
  const [patente, setPatente] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [msg, setMsg] = useState("");

  async function verificar() {
    const p = patente.trim().toUpperCase();
    if (!p) { setError("Ingresá una patente."); return; }
    setCargando(true); setError(""); setInfo(null); setMsg("");
    try {
      const { data: veh } = await sb.from("ca_vehiculos")
        .select("patente,ceco,tipo_vehiculo,modelo").eq("patente", p).maybeSingle();
      if (!veh) { setError(`La patente ${p} no está en la flota.`); setCargando(false); return; }

      const { data: prot } = await sb.from("ca_protocolo_vida_util")
        .select("neumatico,neumatico_alerta").eq("modelo", veh.modelo).maybeSingle();
      if (!prot || !prot.neumatico) { setError(`No hay protocolo de neumáticos para el modelo ${veh.modelo}.`); setCargando(false); return; }

      const { data: odo } = await sb.from("ca_odometros")
        .select("odometro,fecha_lectura").eq("patente", p)
        .order("fecha_lectura", { ascending:false }).limit(1).maybeSingle();
      const kmActual = odo ? Number(odo.odometro) : null;
      if (kmActual == null) { setError(`No hay lectura de odómetro para ${p}.`); setCargando(false); return; }

      const { data: reps } = await sb.from("ca_reparaciones")
        .select("odometro,fecha_servicio").eq("patente", p)
        .ilike("servicio_efectuado", "%neumat%")
        .order("odometro", { ascending:false }).limit(1);
      const ultima = reps && reps.length ? reps[0] : null;
      const kmUltima = ultima ? Number(ultima.odometro) : null;

      const limiteOffset = Number(prot.neumatico);
      const alertaOffset = prot.neumatico_alerta != null ? Number(prot.neumatico_alerta) : Math.round(limiteOffset * 0.8);

      const recorrido = kmUltima != null ? kmActual - kmUltima : null;
      const kmAlerta  = kmUltima != null ? kmUltima + alertaOffset : null;
      const kmLimite  = kmUltima != null ? kmUltima + limiteOffset : null;
      const kmRestantes = kmLimite != null ? kmLimite - kmActual : null;
      let estado = "sin_compra";
      if (recorrido != null) {
        estado = recorrido >= limiteOffset ? "supera_limite" : recorrido >= alertaOffset ? "alerta" : "ok";
      }

      setInfo({ veh, kmActual, kmUltima, limiteOffset, alertaOffset, recorrido, kmAlerta, kmLimite, kmRestantes, estado });
    } catch (e) {
      setError("Error consultando: " + e.message);
    }
    setCargando(false);
  }

  async function generarSolicitud() {
    if (!info) return;
    setGenerando(true); setMsg("");
    const { veh, kmActual, kmUltima, limiteOffset, alertaOffset, recorrido, kmAlerta, kmLimite, kmRestantes, estado } = info;
    const cl = (n) => n == null ? "—" : Number(n).toLocaleString("es-CL");
    const just = `Vehículo ${veh.patente} (${veh.modelo}, ${veh.ceco}): recorrió ${cl(recorrido)} km desde la última compra de neumáticos (odómetro ${cl(kmUltima)} km). Umbral de alerta del protocolo: ${cl(alertaOffset)} km; límite máximo: ${cl(limiteOffset)} km. Km actual: ${cl(kmActual)} km. Se solicita autorización de compra de neumáticos.`;
    try {
      const { error } = await sb.from("ca_solicitudes").insert({
        patente: veh.patente, ceco: veh.ceco, tipo_vehiculo: veh.tipo_vehiculo, modelo: veh.modelo,
        componente: "neumaticos", km_ultima_compra: kmUltima, km_actual: kmActual, km_recorridos: recorrido,
        km_alerta: kmAlerta, km_limite: kmLimite, km_restantes: kmRestantes, estado_protocolo: estado,
        justificacion: just, solicitante: usuario?.nombre || null, status: "pendiente",
      });
      if (error) throw error;
      setMsg("✅ Solicitud generada y enviada a Finanzas.");
    } catch (e) {
      setMsg("❌ Error al generar: " + e.message);
    }
    setGenerando(false);
  }

  const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("es-CL") + " km";
  const estadoCfg = {
    ok:            { txt:"En protocolo",      color:"#166534", bg:"#dcfce7", ico:"✓" },
    alerta:        { txt:"En alerta",          color:"#92400e", bg:"#fef3c7", ico:"⚠" },
    supera_limite: { txt:"Supera límite",      color:"#c0392b", bg:"#fee2e2", ico:"⚠" },
    sin_compra:    { txt:"Sin compra previa",  color:"#475569", bg:"#f1f5f9", ico:"•" },
  };
  const tipos = ["AUTO","CAMIONETA","CAMION"];

  return (
    <div style={{ maxWidth:760 }}>
      <div style={{ background:"#002E5D", color:"#fff", borderRadius:"14px 14px 0 0", padding:"16px 20px", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:18 }}>🚚</span>
        <span style={{ fontSize:15, fontWeight:700 }}>Verificador de estado de neumáticos — Bigticket</span>
      </div>
      <div style={{ background:"#fff", border:"1px solid #e4e7ec", borderTop:"none", borderRadius:"0 0 14px 14px", padding:20, marginBottom:16 }}>
        <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 220px" }}>
            <Label>Patente</Label>
            <Input value={patente} onChange={e=>setPatente(e.target.value.toUpperCase())} placeholder="Ej: SLCY14" />
          </div>
          <Btn onClick={verificar} color="#002E5D">{cargando ? "Verificando…" : "Verificar"}</Btn>
        </div>

        {error && <div style={{ marginTop:14, padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13 }}>{error}</div>}

        {info && (() => {
          const cfg = estadoCfg[info.estado];
          const pct = info.recorrido != null ? Math.min(100, Math.max(0, (info.recorrido / info.limiteOffset) * 100)) : 0;
          const pctAlerta = Math.min(100, (info.alertaOffset / info.limiteOffset) * 100);
          const barColor = info.estado==="supera_limite" ? "#dc2626" : info.estado==="alerta" ? "#d97706" : "#16a34a";
          return (
          <div style={{ marginTop:18 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12, marginBottom:18 }}>
              <div><Label>Centro de costo</Label><div style={{ fontSize:14, fontWeight:600 }}>{info.veh.ceco || "—"}</div></div>
              <div><Label>Modelo</Label><div style={{ fontSize:14, fontWeight:600 }}>{info.veh.modelo}</div></div>
              <div>
                <Label>Tipo de vehículo</Label>
                <div style={{ display:"flex", gap:4 }}>
                  {tipos.map(t => {
                    const on = (info.veh.tipo_vehiculo||"").toUpperCase() === t;
                    return <span key={t} style={{ fontSize:11, fontWeight:700, padding:"4px 8px", borderRadius:6, background:on?"#002E5D":"#f1f5f9", color:on?"#fff":"#94a3b8" }}>{t}</span>;
                  })}
                </div>
              </div>
            </div>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={{ fontSize:14, fontWeight:700, color:"#1a1a1a" }}>{info.veh.modelo} {info.veh.patente} — {info.veh.ceco}</div>
              <span style={{ fontSize:12, fontWeight:700, padding:"5px 12px", borderRadius:20, background:cfg.bg, color:cfg.color }}>{cfg.ico} {cfg.txt}</span>
            </div>
            <div style={{ fontSize:12, color:"#666", marginBottom:10 }}>
              KM última compra: {info.kmUltima!=null?info.kmUltima.toLocaleString("es-CL"):"—"} → KM actual: {info.kmActual.toLocaleString("es-CL")}
            </div>

            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"#94a3b8", marginBottom:4 }}>
              <span>0 km</span><span>Alerta: {info.alertaOffset.toLocaleString("es-CL")}</span><span>Límite: {info.limiteOffset.toLocaleString("es-CL")}</span>
            </div>
            <div style={{ position:"relative", height:14, background:"#f1f5f9", borderRadius:8, overflow:"hidden", marginBottom:4 }}>
              <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${pct}%`, background:barColor, transition:"width .4s" }} />
              <div style={{ position:"absolute", left:`${pctAlerta}%`, top:0, height:"100%", width:2, background:"#64748b" }} />
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:18 }}>
              <span style={{ color:"#666" }}>Recorrido desde última compra:</span>
              <span style={{ fontWeight:700, color:"#1a1a1a" }}>{info.recorrido!=null?info.recorrido.toLocaleString("es-CL"):"—"} km recorridos</span>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:18 }}>
              <KPI label="KM de alerta" valor={fmt(info.kmAlerta)} color="#d97706" />
              <KPI label="KM límite máximo" valor={fmt(info.kmLimite)} color="#dc2626" />
              <KPI label="KM restantes al límite" valor={fmt(info.kmRestantes)} color={info.kmRestantes!=null && info.kmRestantes<0 ? "#dc2626" : "#002E5D"} />
            </div>

            <div style={{ borderTop:"1px solid #e4e7ec", paddingTop:16 }}>
              {(info.estado==="alerta" || info.estado==="supera_limite") ? (
                <Btn onClick={generarSolicitud} color="#002E5D">{generando ? "Generando…" : "Generar solicitud para finanzas"}</Btn>
              ) : info.estado==="sin_compra" ? (
                <div style={{ fontSize:13, color:"#92400e" }}>Sin compra de neumáticos registrada — no se puede calcular recorrido. Cargá la última compra en reparaciones.</div>
              ) : (
                <div style={{ fontSize:13, color:"#166534" }}>✓ Dentro de protocolo — no corresponde compra. Consulta registrada.</div>
              )}
              {msg && <div style={{ marginTop:12, fontSize:13, fontWeight:600 }}>{msg}</div>}
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SELECTOR DE OPERACIÓN (PAÍS) — pantalla post-login
// ═══════════════════════════════════════════════════════════════════════════
function SelectorPais({ usuario, onSelect, onLogout }) {
  const disponibles = (usuario?.paises || PAISES_DISPONIBLES).filter(p => PAIS_SELECT_CFG[p]);
  return (
    <div className="selpais-wrap">
      <style>{`
        .selpais-wrap{position:fixed;inset:0;display:flex;flex-direction:column;background:#eef1f5;font-family:'Open Sans',system-ui,-apple-system,sans-serif;overflow:auto;}
        .selpais-top{display:flex;align-items:center;justify-content:space-between;padding:16px 26px;border-top:3px solid #002E5D;}
        .selpais-brand{font-size:18px;font-weight:800;letter-spacing:-.3px;}
        .selpais-exit{background:none;border:none;color:#8a94a6;font-size:13px;cursor:pointer;}
        .selpais-exit:hover{color:#002E5D;}
        .selpais-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 24px 60px;}
        .selpais-title{font-size:26px;font-weight:800;color:#002E5D;text-align:center;letter-spacing:-.4px;}
        .selpais-sub{font-size:14px;color:#8a94a6;margin-top:6px;text-align:center;}
        .selpais-grid{display:flex;flex-wrap:wrap;gap:22px;justify-content:center;margin-top:34px;}
        .selpais-card{width:200px;background:#fff;border:1px solid #e6e9ef;border-radius:16px;padding:30px 24px;display:flex;flex-direction:column;align-items:center;gap:16px;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease;box-shadow:0 1px 2px rgba(16,32,64,.04);}
        .selpais-card:hover{transform:translateY(-4px);box-shadow:0 14px 30px -12px rgba(16,32,64,.28);border-color:#FF6600;}
        .selpais-flag{width:78px;height:52px;object-fit:cover;border-radius:6px;box-shadow:0 2px 8px rgba(16,32,64,.18);}
        .selpais-label{font-size:16px;font-weight:700;color:#002E5D;}
      `}</style>
      <div className="selpais-top">
        <div className="selpais-brand"><span style={{ color: "#002E5D" }}>Big</span><span style={{ color: "#FF6600" }}>ticket</span></div>
        <button className="selpais-exit" onClick={onLogout}>Salir</button>
      </div>
      <div className="selpais-body">
        <div className="selpais-title">Selecciona tu operación</div>
        <div className="selpais-sub">¿En qué país trabajarás?</div>
        <div className="selpais-grid">
          {disponibles.map(p => {
            const cfg = PAIS_SELECT_CFG[p];
            return (
              <div key={p} className="selpais-card" onClick={() => onSelect(p)}>
                <img className="selpais-flag" src={`https://flagcdn.com/w320/${cfg.code}.png`} alt={cfg.label} />
                <div className="selpais-label">{cfg.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Identidad de quien está usando el Brain. Varios módulos escriben el autor de
// lo que hacen (movimientos_etapa.movido_por, subido_por, enviado_por) leyendo
// window.__PERFIL_EMAIL. Si no se llena, todo queda registrado como
// "analista_brain" y el historial no sirve para saber quién hizo qué.
function fijarPerfilGlobal(u) {
  try {
    window.__PERFIL_EMAIL  = u?.email || "";
    window.__PERFIL_NOMBRE = u?.nombre || "";
    window.__PERFIL_ROL    = u?.rol || "";
  } catch {}
}

export default function App() {
  const [usuario, setUsuario] = useState(() => {
    try {
      const guardado = localStorage.getItem("bt_usuario");
      return guardado ? JSON.parse(guardado) : null;
    } catch { return null; }
  });
  const [tab, setTabState] = useState(() => {
    try { return localStorage.getItem("bt_nav_tab") || "brain"; } catch { return "brain"; }
  });
  const setTab = (t) => { try { localStorage.setItem("bt_nav_tab", t); } catch {} setTabState(t); };
  const [pais, setPaisState] = useState(() => {
    try { return localStorage.getItem("bt_pais") || null; } catch { return null; }
  });

  // Se fija también al montar: si la persona recarga la página con la sesión
  // ya iniciada, handleLogin no vuelve a correr y el perfil quedaría vacío.
  useEffect(() => { fijarPerfilGlobal(usuario); }, [usuario]);

  // B-06 (pedido 25-11): en Chile, qué módulos y subpestañas ve cada usuario sale del mantenedor de accesos.
  const accesosCL = useAccesosCL(usuario, pais);
  const handleLogin = (u) => {
    localStorage.setItem("bt_usuario", JSON.stringify(u));
    fijarPerfilGlobal(u);
    setUsuario(u);
  };
  const handleLogout = () => {
    localStorage.removeItem("bt_usuario");
    try { localStorage.removeItem("bt_nav_tab"); localStorage.removeItem("bt_nav_subtab_pagos"); localStorage.removeItem("bt_pais"); } catch {}
    setPaisState(null);
    fijarPerfilGlobal(null);
    setUsuario(null);
  };
  // Elegir operación (país): fija el país y salta al primer módulo disponible.
  const handleSelectPais = (p) => {
    try { localStorage.setItem("bt_pais", p); } catch {}
    setPaisState(p);
    const modsP = modulosVisibles(p, usuario?.rol);
    setTab(modsP[0] || "");
  };
  // Volver al selector de operación (cambiar de país).
  const cambiarPais = () => {
    try { localStorage.removeItem("bt_pais"); } catch {}
    setPaisState(null);
  };

  if (!usuario) return <><style>{css}</style><Login onLogin={handleLogin} /></>;
  if (!pais) return <><style>{css}</style><SelectorPais usuario={usuario} onSelect={handleSelectPais} onLogout={handleLogout} /></>;

  const modsCodigo = modulosVisibles(pais, usuario.rol);
  // Chile: si el usuario tiene filas en el mantenedor, manda el mantenedor (solo módulos conocidos de Chile); si no, el código
  const mods = pais === "Chile" && accesosCL && Array.isArray(accesosCL.modulos)
    ? MODULOS_POR_PAIS.Chile.superadmin.filter((k) => accesosCL.modulos.includes(k))
    : modsCodigo;
  const tabActivo = mods.includes(tab) ? tab : (mods[0] || null);
  const paisCfg = PAIS_SELECT_CFG[pais] || null;
  return (
    <>
      <style>{css}</style>
      <ShellBrain pais={pais} paisCode={paisCfg?.code} usuario={usuario} mods={mods} labels={MODULOS_LABELS}
        tab={tabActivo} onTab={setTab} onCambiarPais={cambiarPais} onLogout={handleLogout}
        ocultas={pais === "Chile" && accesosCL ? accesosCL.ocultas : null}
        extra={pais === "Chile" ? <CampanaAvisosCL usuario={usuario} onIr={(m) => { if (mods.includes(m)) setTab(m); }} /> : null}>
        {tabActivo === "pool_meli_mx" && <ModuloPoolMeliMX usuario={usuario} />}
        {tabActivo === "certificaciones" && <ModuloCertificacionesMadre />}
        {tabActivo === "empresas" && <ModuloEmpresas />}
        {tabActivo === "certificaciones_cl" && <ModuloCertificacionesCL usuario={usuario} />}
        {tabActivo === "mantenciones_cl" && <ModuloMantencionesMadre usuario={usuario} />}
        {tabActivo === "maestro_cl" && <ModuloMaestroCL usuario={usuario} />}
        {tabActivo === "gps_seguros_cl" && <ModuloGpsSegurosCL />}
        {tabActivo === "pnr_cl" && <ModuloPnrCL usuario={usuario} />}
        {tabActivo === "aceptacion_cl" && <ModuloAceptacionCL />}
        {tabActivo === "mantenedor_cl" && (
          <div className="pg">
            <div className="sec-title">Mantenedor</div>
            <div className="sec-sub">Supervisores, sus CECO, reemplazos por vacaciones o feriados y centros de colecta</div>
            <ModuloMantenedorCL usuario={usuario} />
          </div>
        )}
        {tabActivo === "configuracion" && (
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
                <div>✅ Biggy (Claude Vision) — Análisis automático de documentos</div>
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
                  <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 20, background: u.rol === "superadmin" ? "#eef2ff" : "#f0fdf4", color: u.rol === "superadmin" ? "#002E5D" : "#166534", fontWeight: 600 }}>
                    {u.rol}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tabActivo === "maestro" && <ModuloMaestro usuario={usuario} />}
        {tabActivo === "alertas_portal" && <ModuloAlertasPortal usuario={usuario} />}
        {tabActivo === "referidos" && <ModuloReferidos usuario={usuario} />}
        {tabActivo === "auditoria_meli" && <ModuloAuditoriaMeli />}
        {tabActivo === "pagos" && <ModuloPagosMadre usuario={usuario} />}
        {tabActivo === "contabilidad" && <ModuloContabilidad usuario={usuario} />}
        {tabActivo === "salud" && (
          <div className="pg">
            <div className="sec-title">Salud del sistema</div>
            <div className="sec-sub">Datos, servidores y consultas a MELI</div>
            <Salud />
          </div>
        )}
        {!tabActivo && (
          <div className="pg" style={{ maxWidth: 720 }}>
            <div className="sec-title">Operación {pais}</div>
            <div className="sec-sub">Estamos construyendo los módulos de {pais}</div>
            <div className="form-card">
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.9 }}>
                Todavía no hay módulos disponibles para esta operación. Se irán habilitando aquí a medida que se desarrollen.{" "}
                <button onClick={cambiarPais} style={{ background: "none", border: "none", color: "#FF6600", cursor: "pointer", padding: 0, fontWeight: 600 }}>Cambiar de operación</button>.
              </div>
            </div>
          </div>
        )}
      </ShellBrain>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// MÓDULO PREFACTURAS · MX (v3 · lectura directa del PDF, sin planilla intermedia)
// ───────────────────────────────────────────────────────────────────────────────────────
// 4 sub-tabs:
//   • Envío masivo (default): drag-and-drop de PDFs · el Brain extrae datos del PDF
//     (EMPRESA TRANSPORTE, OPERACIÓN→CECO, PERIODO PREFACTURADO) y los cruza con
//     Supabase (transportistas + parámetros por CECO) para armar cada correo.
//   • Transportistas: CRUD de transportistas (nombre, RFC, correos TO/CC/BCC).
//   • Parámetros: CRUD de CECOs (supervisor, asunto, cuerpo plantilla, cuenta envío).
//   • Historial: log de envíos pasados (Supabase).
//
// Webhook n8n: https://bigticket2026.app.n8n.cloud/webhook/prefacturas-enviar-mx
//
// Variables en plantillas: {TRANSPORTISTA} {CECO} {PERIODO} {RFC} {OPERACION} {SUPERVISOR}
// ═══════════════════════════════════════════════════════════════════════════════════════

// Regex de CECO: S + 1-3 letras + 1-2 dígitos. Sin \b para que detecte SMX7 dentro de ML_MXSMX7
// Ejemplos válidos: SMX7, SMX10, SCY1, SHP1, SPY1, SQR1, STL1, STX1, SVH1

// PDF.js desde CDN

// localStorage keys (se persiste el último asunto/cuerpo entre sesiones)

// Defaults iniciales (se usan solo si nunca se editó el cuerpo)

// ─── HELPERS ─────────────────────────────────────────────────────────────────────────

// ─── CARGA DINÁMICA DE PDF.JS ───────────────────────────────────────────────────────

// ─── EXTRACCIÓN DE TEXTO DE UN PDF ──────────────────────────────────────────────────

// ─── PARSING DE LOS CAMPOS DEL PDF ──────────────────────────────────────────────────
// Los regex están diseñados para tolerar que el PDF tenga "ruido" de la columna de la
// derecha (RESUMEN POR PATENTE) que PDF.js suele mezclar con la columna principal.

// ═══════════════════════════════════════════════════════════════════════════════════════
// COMPONENTE ROOT: Modulo Prefacturas (4 sub-tabs)
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// SUB-TAB 1: ENVÍO MASIVO — solo PDFs, lectura directa
// ═══════════════════════════════════════════════════════════════════════════════════════

// ─── Helpers de estilo de tabla ─────────────────────────────────────────────────

// ─── Fila individual ────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════════════
// SUB-TAB 2: TRANSPORTISTAS (CRUD)
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// SUB-TAB 3: PARÁMETROS / CECOs (simplificado: sin plantillas, esas viven en el envío)
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// SUB-TAB 4: HISTORIAL DE ENVÍOS
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// WRAPPER: ModuloPrefacturasEnvio — Selector de país (MX / CL)
// Renderiza ModuloPrefacturasMX o ModuloPrefacturasCL según selección
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// MÓDULO PREFACTURAS · CL
// ═══════════════════════════════════════════════════════════════════════════════════════
// Webhook n8n: https://bigticket2026.app.n8n.cloud/webhook/prefacturas-enviar-cl
//
// Diferencias clave vs MX:
//   • Tablas: prefacturas_transportistas_cl, prefacturas_parametros_cl
//   • Identificador del PDF: nombre transportista (ej "ISISLINE_SPA.pdf")
//   • Solo 1 correo TO por transportista (no hay CC/BCC separados en nómina)
//   • CC del envío = correo_supervisor + lideres de la operación del CECO
//   • OPERACIÓN tiene formato "CLIENTE - CENTRO_COSTO" (ej "MERCADO LIBRE - RM")
//   • Estado "Bloqueado" → no se permite envío (NO ENVIAR)
// ═══════════════════════════════════════════════════════════════════════════════════════

// Regex para detectar OPERACIÓN en formato "CLIENTE - CECO" en el PDF Chile
// Por ejemplo: "MERCADO LIBRE - RM", "SODIMAC - SERENA", "ROSEN - VIÑA"

// ─── PARSING DE LOS CAMPOS DEL PDF CHILE ────────────────────────────────────────────
// El PDF Chile tiene la misma estructura que MX pero con campos extras (VALOR UF, MES FACTURA)
// y OPERACIÓN con formato "CLIENTE - CECO" en vez de "ML_MXSMX7"

// ═══════════════════════════════════════════════════════════════════════════════════════
// COMPONENTE ROOT CHILE: ModuloPrefacturasCL (4 sub-tabs)
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// SUB-TAB 1 CHILE: ENVÍO MASIVO
// ═══════════════════════════════════════════════════════════════════════════════════════

// ─── Fila individual Chile ──────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════════════
// SUB-TAB 2 CHILE: TRANSPORTISTAS (CRUD)
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// SUB-TAB 3 CHILE: OPERACIONES / CECOs
// ═══════════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════════
// IMPORTADOR MASIVO DE TRANSPORTISTAS — Modal genérico para MX y CL
// ───────────────────────────────────────────────────────────────────────────────────────
// Recibe configuración del esquema (columnas, tabla, lookup de duplicados) y maneja:
//   1. Descarga de plantilla Excel vacía con encabezados correctos
//   2. Drag-and-drop de Excel con datos
//   3. Preview con 3 estados: nuevos (insertar) / duplicados (saltar) / con errores
//   4. Inserción masiva en Supabase
// ═══════════════════════════════════════════════════════════════════════════════════════

// ─── Configuraciones de esquema para MX y CL ────────────────────────────────
