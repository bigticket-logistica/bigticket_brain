import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import ModuloMaestro from "./maestro";
import { fechaHoyOperativa, fechaOperativaOffset, pct, Input, KpiCardMaestro, BadgeEstadoMaestro } from "./shared";
import ModuloPNR from "./PNR";
import ModuloCertificaciones from "./Certificaciones";
import ModuloAuditoriaMeli from "./AuditoriaMeli";
import { sb, BIGGY_IMG } from "./shared";
import ModuloPoolMeliMX from "./Pool";
import { descargarExcelMeli, descargarExcelMultihoja } from "./shared";
import ModuloPagosMadre from "./Pagos";
import ModuloCertificacionesCL from "./cl/Certificaciones";
import ModuloMaestroCL from "./cl/Maestro";
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
        background: "#1a3a6b", color: "#fff", border: "none",
        borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, fontFamily: "Geist, sans-serif",
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
    superadmin: ["pool_meli_mx", "pagos", "maestro", "certificaciones", "pnr", "auditoria_meli", "configuracion"],
    certificacion: ["certificaciones"],
    prefacturas: ["pagos"],
  },
  "Chile": {
    superadmin: ["certificaciones_cl", "mantenciones_cl", "maestro_cl"],
    certificacion: [],
    prefacturas: [],
  },
};
const modulosVisibles = (pais, rol) => (MODULOS_POR_PAIS[pais] && MODULOS_POR_PAIS[pais][rol]) || [];
const MODULOS_LABELS = {
  brain: "Brain Central",
  pool_meli_mx: "Indicadores Operacionales MX",
  certificaciones: "Certificaciones",
  certificaciones_cl: "Certificaciones",
  mantenciones_cl: "Mantenciones",
  maestro_cl: "Maestro Operaciones",
  maestro: "Maestro Operaciones",
  mantenciones: "Mantenciones",
  pnr: "PNR",
  auditoria_meli: "Auditoría MELI",
  pagos: "Administración",
  configuracion: "Configuración",
};
const USUARIOS = {
  // Opcional por usuario: paises: ["Chile"] o ["México"] para restringir qué operación ve.
  // Si se omite, el usuario ve todas las operaciones disponibles (PAISES_DISPONIBLES).
  "esteban.dussaut@bigticket.cl": { pass: "esteban.2026", rol: "superadmin", nombre: "Super Admin" },
  "cert@bigticket.mx":  { pass: "Cert2026!", rol: "certificacion", nombre: "Equipo Certificación" },
  "adriana.giummarra@bigticket.cl": { pass: "adriana.2026", rol: "superadmin", nombre: "Adriana Giummarra" },
  "nicole.vargas@bigticket.cl":     { pass: "nicole.2026",  rol: "superadmin", nombre: "Nicole Vargas" },
  "roberto.rayon@bigticket.mx":     { pass: "roberto.2026", rol: "superadmin", nombre: "Roberto Rayón" },
  "alejandra.degollada@bigticket.cl":     { pass: "alejandra.2026", rol: "superadmin", nombre: "Alejandra Degollada" },
  "eduardo.stine@bigticket.cl":     { pass: "eduardo.2026", rol: "superadmin", nombre: "Eduardo Stine" },
  "danny.calas@bigticket.cl":       { pass: "danny.2026",   rol: "prefacturas", nombre: "Danny Calas" },
  "roberto.sanmartin@bigticket.cl":       { pass: "robertosn.2026",   rol: "prefacturas", nombre: "Roberto San Martin" },
};

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
  @keyframes biggypulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .biggy-bubble{animation:fadeIn 0.4s ease;}
  .biggy-typing span{display:inline-block;width:7px;height:7px;border-radius:50%;background:#F47B20;margin:0 2px;animation:biggypulse 0.9s infinite;}
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
    <div style={{width:32,height:32,border:"3px solid #e4e7ec",borderTopColor:"#1a3a6b",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
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
          <div style={{ fontSize:20, fontWeight:800, color:"#1a3a6b" }}>🚗 Drivers México</div>
          <div style={{ fontSize:12, color:"#888", marginTop:2 }}>Gestión de choferes y documentación</div>
        </div>
        <button onClick={abrirNuevo}
          style={{ background:"#1a3a6b", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
          + Nuevo Driver
        </button>
      </div>

      {/* KPIs */}
      <div className="three-col" style={{ gridTemplateColumns:"repeat(4,1fr)", marginBottom:20 }}>
        {[
          { label:"Total Drivers", val:total, icon:"👥", color:"#1a3a6b" },
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
                      <td style={{ padding:"9px 12px", fontWeight:600, color:"#1a3a6b" }}>
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
                          style={{ background:"#1a3a6b", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
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
                    <td style={{ padding:"9px 12px", fontWeight:600, color:"#1a3a6b" }}>{d.nombre} {d.apellido_paterno}</td>
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
              <div style={{ fontSize:16, fontWeight:800, color:"#1a3a6b" }}>{driverSel ? "✏️ Editar Driver" : "➕ Nuevo Driver"}</div>
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
                style={{ background:"#1a3a6b", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
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
          <div style={{ fontSize:20, fontWeight:800, color:"#1a3a6b" }}>💰 Configuración de Pagos</div>
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
              borderBottom:tabActiva===t.id?"2px solid #F47B20":"2px solid transparent",
              color:tabActiva===t.id?"#F47B20":"#555",
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
              style={{ background:"#F47B20", color:"#fff", border:"none", borderRadius:8, padding:"7px 16px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
              + Agregar Tarifa
            </button>
          </div>

          <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", overflow:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#1a3a6b" }}>
                  {["Vehículo","Zona","Tramo km","Tarifa MXN","Estado","Acción"].map(h => (
                    <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontWeight:700, color:"#fff", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrizFiltrada.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom:"1px solid #f4f5f7", background: i % 2 === 0 ? "#fff" : "#f8f9fa", opacity: r.activo ? 1 : 0.5 }}>
                    <td style={{ padding:"9px 14px", fontWeight:600, color:"#1a3a6b" }}>{r.tipo_vehiculo}</td>
                    <td style={{ padding:"9px 14px" }}>
                      <span style={{ background:"#dbeafe", color:"#1e40af", padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:700 }}>{r.zonificacion}</span>
                    </td>
                    <td style={{ padding:"9px 14px", color:"#555" }}>{r.tramo_km} km</td>
                    <td style={{ padding:"9px 14px" }}>
                      {editando === r.id ? (
                        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                          <span style={{ color:"#888", fontSize:11 }}>$</span>
                          <input type="number" value={valEdit} onChange={e => setValEdit(e.target.value)}
                            style={{ width:90, fontSize:12, padding:"4px 8px", borderRadius:6, border:"1px solid #F47B20", fontFamily:"'Outfit', sans-serif" }}
                            autoFocus onKeyDown={e => { if (e.key === "Enter") guardarTarifa(r.id, valEdit); if (e.key === "Escape") setEditando(null); }} />
                          <button onClick={() => guardarTarifa(r.id, valEdit)}
                            style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer" }}>✓</button>
                          <button onClick={() => setEditando(null)}
                            style={{ background:"#e4e7ec", color:"#555", border:"none", borderRadius:6, padding:"3px 8px", fontSize:11, cursor:"pointer" }}>✕</button>
                        </div>
                      ) : (
                        <span style={{ fontSize:14, fontWeight:700, color:"#1a3a6b" }}>
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
                        style={{ background:"#1a3a6b", color:"#fff", border:"none", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
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
                <tr style={{ background:"#1a3a6b" }}>
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
                            style={{ width:70, fontSize:12, padding:"4px 8px", borderRadius:6, border:"1px solid #F47B20", fontFamily:"'Outfit', sans-serif" }}
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
                        style={{ background:"#1a3a6b", color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                        ✏️ Editar %
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background:"#fff", borderRadius:10, border:"1px solid #e4e7ec", padding:20 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#1a3a6b", marginBottom:12 }}>📖 Ejemplo de cálculo</div>
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
            <div style={{ background:"#1a3a6b", padding:"12px 18px" }}>
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
                        style={{ width:100, fontSize:12, padding:"5px 8px", borderRadius:6, border:"1px solid #F47B20", fontFamily:"'Outfit', sans-serif" }}
                        autoFocus onKeyDown={e => { if (e.key === "Enter") guardarConfig(c.clave, valEdit); if (e.key === "Escape") setEditando(null); }} />
                      <button onClick={() => guardarConfig(c.clave, valEdit)}
                        style={{ background:"#16a34a", color:"#fff", border:"none", borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer" }}>✓</button>
                      <button onClick={() => setEditando(null)}
                        style={{ background:"#e4e7ec", color:"#555", border:"none", borderRadius:6, padding:"5px 10px", fontSize:12, cursor:"pointer" }}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize:16, fontWeight:800, color:"#1a3a6b" }}>{c.valor}</span>
                      <button onClick={() => { setEditando(`cfg-${c.clave}`); setValEdit(c.valor); }}
                        style={{ background:"#1a3a6b", color:"#fff", border:"none", borderRadius:6, padding:"5px 12px", fontSize:11, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
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
              <div style={{ fontSize:16, fontWeight:800, color:"#1a3a6b" }}>➕ Nueva Tarifa</div>
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
                style={{ background:"#F47B20", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Outfit', sans-serif" }}>
                {guardando ? "Guardando..." : "Agregar Tarifa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MÓDULO PAGOS · CERTIFICACIÓN DOCUMENTAL CHILE (V2 con Opción B + Editor) ──
// Conectado a tablas Supabase:
//   - certronic_certificacion_mensual (datos calculados por el calculador V7)
//   - certronic_matriz_documentos (reglas por mandante, editables)
//   - certronic_estados_documentos (snapshot del scraper liviano)
//   - certronic_ejecuciones_log (log de jobs)
function ModuloPagos() {
  const [datos, setDatos] = useState({ pc: [], ryc: [], sub: [] });
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState(""); // YYYY-MM
  const [periodos, setPeriodos] = useState([]);
  const [vistaActiva, setVistaActiva] = useState("dashboard"); // dashboard | criticos | matriz | hallazgos | rse | empleados | vehiculos | inicial | historico
  const [tabCategoria, setTabCategoria] = useState("pc");
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroMandante, setFiltroMandante] = useState("todos");
  const [filtroActivo, setFiltroActivo] = useState("todos"); // todos | solo_activos | solo_inhabilitados
  const [ultimaEjecucion, setUltimaEjecucion] = useState(null);
  const [ordenCol, setOrdenCol] = useState("transporte");
  const [ordenAsc, setOrdenAsc] = useState(true);
  
  // ─── 🆕 OVERRIDES DEL ANALISTA ────────────────────────────────
  // Map de overrides activos: key = "contratista|categoria|subcontratista|doc_campo"
  const [overrides, setOverrides] = useState(new Map());
  // Modal de edición
  const [modalOverride, setModalOverride] = useState(null);  // { contratista, categoria, subcontratista, docCampo, docLabel, estadoCertronic, fechaSnapshot, overrideExistente }
  // 🆕 Cumplimiento de docs iniciales por contratista (para el triángulo)
  // Map: contratista → { porcentaje, semaforo, cumplen, total }
  const [cumplInicial, setCumplInicial] = useState(new Map());
  // 🆕 Último run del pipeline (para banner de alerta)
  const [ultimoRun, setUltimoRun] = useState(null);

  useEffect(() => { cargarPeriodos(); cargarUltimoRun(); }, []);
  useEffect(() => { 
    if (periodo) {
      cargarDatos();
      cargarOverrides();
      cargarCumplInicial();
    }
  }, [periodo]);

  const cargarPeriodos = async () => {
    try {
      // Usar vw_certificacion_periodos en lugar de la tabla directamente
      // para evitar el límite de 1000 filas de la REST API de Supabase.
      // La vista devuelve solo los períodos únicos (1 fila por anio+mes).
      const { data } = await sb.from("vw_certificacion_periodos")
        .select("anio, mes")
        .order("anio", { ascending: false })
        .order("mes", { ascending: false });
      const unicos = data && data.length
        ? [...new Set(data.map(r => `${r.anio}-${String(r.mes).padStart(2,"0")}`))]
        : [`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`];
      setPeriodos(unicos);
      setPeriodo(unicos[0]);
      const { data: log } = await sb.from("certronic_ejecuciones_log")
        .select("*").order("fecha_ejecucion", { ascending: false }).limit(1);
      if (log && log[0]) setUltimaEjecucion(log[0]);
    } catch(e) {
      console.error("Error cargar periodos:", e);
      const p = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
      setPeriodos([p]); setPeriodo(p);
    }
  };

  const cargarDatos = async () => {
    setLoading(true);
    const [anio, mes] = periodo.split("-").map(Number);
    try {
      const { data } = await sb.from("certronic_certificacion_mensual")
        .select("*")
        .eq("anio", anio).eq("mes", mes);
      const todos = data || [];
      setDatos({
        pc: todos.filter(d => d.categoria === "PC"),
        ryc: todos.filter(d => d.categoria === "RYC"),
        sub: todos.filter(d => d.categoria === "SUB"),
      });
    } catch(e) {
      console.error("Error cargar datos:", e);
      setDatos({ pc: [], ryc: [], sub: [] });
    }
    setLoading(false);
  };

  // ─── 🆕 OVERRIDES ────────────────────────────────────────────
  // Construye la key única de un override
  const overrideKey = (contratista, categoria, subcontratista, docCampo) => {
    return `${contratista || ""}|${categoria || ""}|${subcontratista || ""}|${docCampo || ""}`;
  };

  // 🆕 Carga el último run del pipeline para mostrar banner si hubo errores
  const cargarUltimoRun = async () => {
    try {
      const { data, error } = await sb.from("certronic_pipeline_runs")
        .select("*")
        .order("fecha_run", { ascending: false })
        .limit(1);
      if (error) { console.warn("[UltimoRun] Error:", error.message); return; }
      if (data && data.length > 0) {
        setUltimoRun(data[0]);
      }
    } catch (e) {
      console.warn("[UltimoRun] Error:", e.message);
    }
  };

  // 🆕 Carga el cumplimiento de docs iniciales por contratista (para el triángulo en Dashboard Mensual)
  const cargarCumplInicial = async () => {
    try {
      // 1. Snapshot más reciente
      const { data: snap } = await sb.from("certronic_empleados_docs")
        .select("fecha_snapshot")
        .order("fecha_snapshot", { ascending: false })
        .limit(1);
      if (!snap || snap.length === 0) return;
      const fechaSnap = snap[0].fecha_snapshot;

      // 2. Cargar todos los DOC_CONTRATISTA del snapshot (paginado)
      let todos = [];
      let from = 0;
      const lim = 1000;
      while (true) {
        const { data, error } = await sb.from("certronic_empleados_docs")
          .select("token_certronic, documento, cumple")
          .eq("fecha_snapshot", fechaSnap)
          .eq("origen", "DOC_CONTRATISTA")
          .range(from, from + lim - 1);
        if (error) break;
        if (!data || data.length === 0) break;
        todos = todos.concat(data);
        if (data.length < lim) break;
        from += lim;
      }

      // 3. Mapping token → contratista
      const { data: detalles } = await sb.from("certronic_empleados_detalle")
        .select("token_certronic, contratista")
        .eq("fecha_snapshot", fechaSnap);
      const tokenAContr = new Map();
      for (const d of detalles || []) {
        if (d.contratista) tokenAContr.set(d.token_certronic, d.contratista);
      }

      // 4. Agrupar por contratista (1 doc único por contratista, sin duplicar entre empleados)
      const porContratista = new Map();
      for (const d of todos) {
        const c = tokenAContr.get(d.token_certronic);
        if (!c) continue;
        if (!porContratista.has(c)) porContratista.set(c, new Map());
        const m = porContratista.get(c);
        if (!m.has(d.documento)) m.set(d.documento, d.cumple);
      }

      // 5. Calcular % cumplimiento + semáforo
      const resultado = new Map();
      for (const [contratista, docsMap] of porContratista.entries()) {
        const total = docsMap.size;
        const cumplen = Array.from(docsMap.values()).filter(v => v === true).length;
        const porcentaje = total > 0 ? Math.round((cumplen * 100) / total) : 0;
        let semaforo = "rojo";
        if (porcentaje === 100) semaforo = "verde";
        else if (porcentaje >= 50) semaforo = "amarillo";
        resultado.set(contratista, { porcentaje, semaforo, cumplen, total });
      }
      console.log(`[CumplInicial] Cargados ${resultado.size} contratistas`);
      setCumplInicial(resultado);
    } catch (e) {
      console.warn("[CumplInicial] Error:", e.message);
    }
  };

  const cargarOverrides = async () => {    try {
      const { data, error } = await sb.from("certronic_overrides_analista")
        .select("*")
        .eq("activo", true);
      if (error) {
        if (error.message && error.message.includes("does not exist")) {
          console.log("[Overrides] Tabla aún no existe, saltando");
          return;
        }
        throw error;
      }
      const map = new Map();
      for (const o of data || []) {
        const k = overrideKey(o.contratista, o.categoria, o.subcontratista_nombre, o.doc_campo);
        map.set(k, o);
      }
      console.log(`[Overrides] Cargados ${map.size} overrides activos`);
      setOverrides(map);
    } catch (e) {
      console.warn("[Overrides] Error cargando:", e.message);
    }
  };

  const guardarOverride = async ({ contratista, categoria, subcontratista, docCampo, estadoCertronic, fechaSnapshot, estadoOverride, motivo, fechaCambio }) => {
    if (!motivo || !motivo.trim()) {
      alert("El motivo es obligatorio");
      return false;
    }
    if (!fechaCambio) {
      alert("La fecha del cambio es obligatoria");
      return false;
    }
    try {
      // Si ya existe un override activo para esta tupla, lo invalidamos primero
      const k = overrideKey(contratista, categoria, subcontratista, docCampo);
      const existente = overrides.get(k);
      if (existente) {
        await sb.from("certronic_overrides_analista")
          .update({ activo: false, invalidado_at: new Date().toISOString(), invalidado_motivo: "Reemplazado por nuevo override" })
          .eq("id", existente.id);
      }
      // Insertar el nuevo
      const { data, error } = await sb.from("certronic_overrides_analista")
        .insert({
          contratista,
          categoria,
          subcontratista_nombre: subcontratista || null,
          doc_campo: docCampo,
          estado_certronic_original: estadoCertronic || null,
          fecha_snapshot_original: fechaSnapshot || null,
          estado_override: estadoOverride,
          motivo: motivo.trim(),
          fecha_cambio: fechaCambio,
          editado_por: "analista",
          activo: true,
        })
        .select()
        .single();
      if (error) throw error;
      // Actualizar el map local
      const nuevoMap = new Map(overrides);
      nuevoMap.set(k, data);
      setOverrides(nuevoMap);
      return true;
    } catch (e) {
      console.error("[Overrides] Error guardando:", e);
      alert("Error guardando el override: " + (e.message || e));
      return false;
    }
  };

  const quitarOverride = async (override) => {
    if (!confirm(`¿Quitar este override?\n\nEstado override: ${override.estado_override}\nMotivo: ${override.motivo}\n\nVuelve a mostrarse el estado de Certronic.`)) return;
    try {
      const { error } = await sb.from("certronic_overrides_analista")
        .update({ activo: false, invalidado_at: new Date().toISOString(), invalidado_motivo: "Eliminado manualmente por analista" })
        .eq("id", override.id);
      if (error) throw error;
      const k = overrideKey(override.contratista, override.categoria, override.subcontratista_nombre, override.doc_campo);
      const nuevoMap = new Map(overrides);
      nuevoMap.delete(k);
      setOverrides(nuevoMap);
    } catch (e) {
      console.error("[Overrides] Error quitando:", e);
      alert("Error quitando el override: " + (e.message || e));
    }
  };

  // Auto-invalidar overrides cuando Certronic cambió el campo
  // Se ejecuta cuando llegan datos nuevos
  useEffect(() => {
    if (overrides.size === 0) return;
    if (!datos.pc.length && !datos.ryc.length && !datos.sub.length) return;
    
    const aInvalidar = [];
    for (const [k, o] of overrides.entries()) {
      // Buscar la fila correspondiente en los datos actuales
      let dataset = [];
      if (o.categoria === "PC") dataset = datos.pc;
      else if (o.categoria === "RYC") dataset = datos.ryc;
      else if (o.categoria === "SUB") dataset = datos.sub;
      
      const fila = dataset.find(d => 
        d.transporte === o.contratista && 
        (!o.subcontratista_nombre || d.subcontratista_nombre === o.subcontratista_nombre)
      );
      if (!fila) continue;  // ya no existe esa fila, dejarlo igual
      
      const valorActual = fila[o.doc_campo];
      // Si Certronic cambió el valor (a algo distinto del original que tenía cuando se hizo el override)
      if (valorActual && o.estado_certronic_original && valorActual !== o.estado_certronic_original) {
        aInvalidar.push(o);
      }
    }
    
    if (aInvalidar.length > 0) {
      console.log(`[Overrides] Invalidando ${aInvalidar.length} overrides porque Certronic actualizó esos campos`);
      (async () => {
        for (const o of aInvalidar) {
          await sb.from("certronic_overrides_analista")
            .update({ 
              activo: false, 
              invalidado_at: new Date().toISOString(), 
              invalidado_motivo: "Certronic actualizó el campo" 
            })
            .eq("id", o.id);
        }
        // Recargar overrides
        cargarOverrides();
      })();
    }
  }, [datos]);

  // ── Helpers ──
  const operacionAMandante = (op) => {
    if (!op) return "Mercado Libre";
    const u = String(op).toUpperCase();
    if (u.includes("F_") || u.includes("FALABELLA")) return "Falabella";
    if (u.includes("R_") || u.includes("ROSEN")) return "Rosen";
    if (u.includes("C_") || u.includes("CANNON")) return "Cannon";
    if (u.includes("ESPORADIC")) return "Esporádicos";
    return "Mercado Libre";
  };

  const fmt$ = (n) => "$" + Math.round(n || 0).toLocaleString("es-CL");

  // ── Datos derivados ──
  const todosActivos = useMemo(() => {
    const todos = [...datos.pc, ...datos.ryc, ...datos.sub];
    return todos.filter(d => !d.recurso_inhabilitado);
  }, [datos]);

  const todosInhabilitados = useMemo(() => {
    const todos = [...datos.pc, ...datos.ryc, ...datos.sub];
    return todos.filter(d => d.recurso_inhabilitado);
  }, [datos]);

  // Empresas únicas inhabilitadas (cada empresa puede aparecer en PC + RyC + SUB)
  const empresasInhabilitadasUnicas = useMemo(() => {
    return new Set(todosInhabilitados.map(d => d.transporte)).size;
  }, [todosInhabilitados]);

  // Empresas únicas activas
  const empresasActivasUnicas = useMemo(() => {
    return new Set([...datos.pc, ...datos.ryc, ...datos.sub]
      .filter(d => !d.recurso_inhabilitado)
      .map(d => d.transporte)).size;
  }, [datos]);

  // KPIs (cuentan TODO: activos + inhabilitados, los inhabilitados son ciudadanos completos)
  const kpis = useMemo(() => {
    const base = [...datos.pc, ...datos.ryc, ...datos.sub];
    const certificados = base.filter(d => d.estado_final === "CERTIFICADO").length;
    const parciales = base.filter(d => d.estado_final === "PENDIENTE").length;
    const sinCert = base.filter(d => d.estado_final === "NO_CERTIFICADO").length;
    return {
      total: base.length,
      certificados, parciales, sinCert,
      pctAvance: base.length ? Math.round(certificados / base.length * 100) : 0,
      anomalias: base.filter(d => d.tiene_anomalia).length,
      inhabilitados: todosInhabilitados.length,
    };
  }, [datos, todosActivos, todosInhabilitados]);

  // ─── ACTIVOS CRÍTICOS (Opción B): empresas activas con retención ───
  const activosCriticos = useMemo(() => {
    // Empresas que NO están inhabilitadas, tienen empleados/vehículos activos
    // y tienen retención > 0
    return [...datos.pc, ...datos.ryc, ...datos.sub]
      .filter(d => !d.recurso_inhabilitado)
      .filter(d => Number(d.pct_retencion) > 0)
      .filter(d => (d.empleados_activos || 0) > 0 || (d.vehiculos_activos || 0) > 0)
      .sort((a, b) => Number(b.pct_retencion) - Number(a.pct_retencion));
  }, [datos]);

  // Operaciones únicas (para filtro) — siempre incluye todo
  const operacionesUnicas = useMemo(() => {
    const todos = [...datos.pc, ...datos.ryc, ...datos.sub];
    return [...new Set(todos.map(d => d.operacion).filter(Boolean))].sort();
  }, [datos]);

  // Documentos por categoría
  const docsPorCategoria = {
    pc: [
      { key: "doc_f30", label: "F30" },
      { key: "doc_f30_1", label: "F30-1" },
      { key: "doc_liquidaciones", label: "LIQUIDACIONES" },
      { key: "doc_cotizaciones", label: "COTIZACIONES" },
      { key: "doc_mutualidad", label: "MUTUALIDAD" },
    ],
    ryc: [
      { key: "doc_f30", label: "F30" },
      { key: "doc_mutualidad", label: "MUTUALIDAD" },
    ],
    sub: [
      { key: "doc_boleta_honorarios", label: "BOLETA HON." },
      { key: "doc_comprobante_pago", label: "COMP. PAGO" },
    ],
  };

  // 🆕 Helper: normaliza texto (sin acentos, sin tildes, lowercase) para búsqueda inteligente
  const normalizar = (s) => (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Filtrado para tabla por categoría
  const datosCategoriaActual = useMemo(() => {
    let arr = datos[tabCategoria] || [];
    
    // 🆕 Filtro de estado activo/inhabilitado
    if (filtroActivo === "solo_activos") arr = arr.filter(d => !d.recurso_inhabilitado);
    if (filtroActivo === "solo_inhabilitados") arr = arr.filter(d => d.recurso_inhabilitado);
    
    // 🆕 Búsqueda inteligente: tolerante a acentos, mayúsculas, parciales
    // Soporta múltiples palabras: "bastian diaz" encuentra "Bastian Andres Diaz"
    if (busqueda) {
      const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
      arr = arr.filter(d => {
        const camposBusqueda = [
          d.transporte,
          d.subcontratista_nombre,
          d.email,
          d.operacion,
          d.rut,
        ].map(normalizar).join(" ");
        // TODAS las palabras deben aparecer (AND lógico)
        return palabras.every(p => camposBusqueda.includes(p));
      });
    }
    
    if (filtroEstado !== "todos") arr = arr.filter(d => d.estado_final === filtroEstado);
    if (filtroMandante !== "todos") arr = arr.filter(d => operacionAMandante(d.operacion) === filtroMandante);
    
    arr = [...arr].sort((a, b) => {
      const va = a[ordenCol], vb = b[ordenCol];
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number") return ordenAsc ? va - vb : vb - va;
      return ordenAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return arr;
  }, [datos, tabCategoria, busqueda, filtroEstado, filtroMandante, filtroActivo, ordenCol, ordenAsc]);

  // ─── Descargar Excel multi-hoja ───
  const descargarExcel = async () => {
    if (!window.XLSX) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    const XLSX = window.XLSX;
    if (!XLSX) { alert("No se pudo cargar la librería de Excel."); return; }

    const meses = ["","ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
    const [anioStr, mesStr] = periodo.split("-");
    const nombreMes = meses[parseInt(mesStr)] || mesStr;
    const anio = parseInt(anioStr);

    const wb = window.XLSX.utils.book_new();
    // 🆕 Excel ahora incluye TODOS los registros (activos + inhabilitados)
    const todosPC = datos.pc;
    const todosRYC = datos.ryc;
    const todosSUB = datos.sub;
    const totalTodos = todosPC.length + todosRYC.length + todosSUB.length;

    // RESUMEN
    const resumen = [
      [`BIGTICKET — CERTIFICACIÓN DOCUMENTAL ${nombreMes} ${anio}`],
      [`Generado: ${new Date().toLocaleString("es-CL")}`],
      [`Total registros: ${totalTodos} (incluye activos + inhabilitados)`],
      [`Inhabilitados: ${todosInhabilitados.length} · resaltados con columna ESTADO`],
      [],
      ["MÉTRICA", "TOTAL", "PERSONAL CONTRATADO", "REP. Y CONDUCTOR", "SUBCONTRATISTA"],
      ["Total registros", kpis.total, todosPC.length, todosRYC.length, todosSUB.length],
      ["Certificados", kpis.certificados,
        todosPC.filter(d => d.estado_final === "CERTIFICADO").length,
        todosRYC.filter(d => d.estado_final === "CERTIFICADO").length,
        todosSUB.filter(d => d.estado_final === "CERTIFICADO").length],
      ["Pendientes (parcial)", kpis.parciales,
        todosPC.filter(d => d.estado_final === "PENDIENTE").length,
        todosRYC.filter(d => d.estado_final === "PENDIENTE").length,
        todosSUB.filter(d => d.estado_final === "PENDIENTE").length],
      ["Sin certificar", kpis.sinCert,
        todosPC.filter(d => d.estado_final === "NO_CERTIFICADO").length,
        todosRYC.filter(d => d.estado_final === "NO_CERTIFICADO").length,
        todosSUB.filter(d => d.estado_final === "NO_CERTIFICADO").length],
      ["Inhabilitados", kpis.inhabilitados,
        todosPC.filter(d => d.recurso_inhabilitado).length,
        todosRYC.filter(d => d.recurso_inhabilitado).length,
        todosSUB.filter(d => d.recurso_inhabilitado).length],
      ["% Avance",
        `${kpis.pctAvance}%`,
        `${todosPC.length ? Math.round(todosPC.filter(d => d.estado_final === "CERTIFICADO").length / todosPC.length * 100) : 0}%`,
        `${todosRYC.length ? Math.round(todosRYC.filter(d => d.estado_final === "CERTIFICADO").length / todosRYC.length * 100) : 0}%`,
        `${todosSUB.length ? Math.round(todosSUB.filter(d => d.estado_final === "CERTIFICADO").length / todosSUB.length * 100) : 0}%`],
      [],
      ["🚨 ACTIVOS CRÍTICOS (con retención)", activosCriticos.length],
    ];
    const wsResumen = window.XLSX.utils.aoa_to_sheet(resumen);
    wsResumen["!cols"] = [{ wch: 30 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "RESUMEN");

    // Helper
    const construirHoja = (filas, headers, mapFn) => {
      const datos2D = [headers, ...filas.map(mapFn)];
      const ws = window.XLSX.utils.aoa_to_sheet(datos2D);
      ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
      return ws;
    };

    const headersPC = ["AÑO","MES","CERTIFICACIÓN","OPERACIÓN","TRANSPORTE","E-MAIL","ESTADO CONTRATISTA",
                       "F30","F30-1","LIQUIDACIONES","COTIZACIONES","MUTUALIDAD",
                       "% RETENCIÓN","% AVANCE","ESTADO CERT.","EMPLEADOS ACTIVOS","VEHÍCULOS ACTIVOS","OBSERVACIONES"];
    const wsPC = construirHoja(todosPC, headersPC, d => [
      d.anio, d.mes, nombreMes, d.operacion || "", d.transporte || "", d.email || "",
      d.recurso_inhabilitado ? "INHABILITADO" : "Activo",
      d.doc_f30 || "—", d.doc_f30_1 || "—", d.doc_liquidaciones || "—",
      d.doc_cotizaciones || "—", d.doc_mutualidad || "—",
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—", d.empleados_activos || 0, d.vehiculos_activos || 0,
      d.anomalia_descripcion || "",
    ]);
    XLSX.utils.book_append_sheet(wb, wsPC, "Personal Contratado");

    const headersRYC = ["AÑO","MES","CERTIFICACIÓN","OPERACIÓN","TRANSPORTE","E-MAIL","ESTADO CONTRATISTA",
                        "F30","MUTUALIDAD","% RETENCIÓN","% AVANCE","ESTADO CERT.","EMPLEADOS ACTIVOS","VEHÍCULOS ACTIVOS"];
    const wsRYC = construirHoja(todosRYC, headersRYC, d => [
      d.anio, d.mes, nombreMes, d.operacion || "", d.transporte || "", d.email || "",
      d.recurso_inhabilitado ? "INHABILITADO" : "Activo",
      d.doc_f30 || "—", d.doc_mutualidad || "—",
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—", d.empleados_activos || 0, d.vehiculos_activos || 0,
    ]);
    XLSX.utils.book_append_sheet(wb, wsRYC, "Representante y Conductor");

    const headersSUB = ["AÑO","MES","CERTIFICACIÓN","OPERACIÓN","TRANSPORTE","SUBCONTRATISTA","ESTADO CONTRATISTA",
                        "FECHA INGRESO","BOLETA HON.","COMP. PAGO",
                        "% RETENCIÓN","% AVANCE","ESTADO CERT.","OBSERVACIONES"];
    const wsSUB = construirHoja(todosSUB, headersSUB, d => [
      d.anio, d.mes, nombreMes, d.operacion || "", d.transporte || "", d.subcontratista_nombre || "",
      d.recurso_inhabilitado ? "INHABILITADO" : "Activo",
      d.fecha_ingreso || "—", d.doc_boleta_honorarios || "—", d.doc_comprobante_pago || "—",
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—", d.anomalia_descripcion || "",
    ]);
    XLSX.utils.book_append_sheet(wb, wsSUB, "Subcontratista");

    // ACTIVOS CRÍTICOS
    const headersCrit = ["TRANSPORTE","CATEGORÍA","OPERACIÓN","SUBCONTRATISTA","E-MAIL",
                         "EMPLEADOS","VEHÍCULOS","% RETENCIÓN","% AVANCE","ESTADO"];
    const wsCrit = construirHoja(activosCriticos, headersCrit, d => [
      d.transporte || "", d.categoria, d.operacion || "", d.subcontratista_nombre || "", d.email || "",
      d.empleados_activos || 0, d.vehiculos_activos || 0,
      d.pct_retencion ? `${d.pct_retencion}%` : "—",
      d.pct_avance != null ? `${d.pct_avance}%` : "—",
      d.estado_final || "—",
    ]);
    XLSX.utils.book_append_sheet(wb, wsCrit, "🚨 ACTIVOS CRÍTICOS");

    window.XLSX.writeFile(wb, `Certificacion_Bigticket_${nombreMes}_${anio}.xlsx`);
  };

  // ─── Helpers de UI ───
  // 🆕 Versión modificada que acepta contexto para click→modal y muestra indicador de override
  const renderIconoDoc = (estado, ctx = null) => {
    // ctx: { contratista, categoria, subcontratista, docCampo, docLabel, fechaSnapshot }
    const conf = {
      VALIDADO: { ico: "✓", color: "#16a34a", bg: "#dcfce7", titulo: "Validado" },
      RECEPCIONADO: { ico: "◐", color: "#1e40af", bg: "#dbeafe", titulo: "Recepcionado" },
      ENVIADO: { ico: "↗", color: "#3730a3", bg: "#e0e7ff", titulo: "Enviado" },
      PENDIENTE: { ico: "⏳", color: "#92400e", bg: "#fef3c7", titulo: "Pendiente" },
      NO_APLICA: { ico: "—", color: "#94a3b8", bg: "#f1f5f9", titulo: "No aplica" },
    };
    
    // ¿Hay override activo para este doc?
    let override = null;
    let estadoMostrar = estado;
    if (ctx) {
      const k = overrideKey(ctx.contratista, ctx.categoria, ctx.subcontratista, ctx.docCampo);
      override = overrides.get(k);
      if (override) {
        estadoMostrar = override.estado_override;
      }
    }
    
    const c = conf[estadoMostrar] || { ico: "?", color: "#64748b", bg: "#f1f5f9", titulo: estadoMostrar || "Sin dato" };
    
    // Tooltip con info del override
    let tooltip = c.titulo;
    if (override) {
      tooltip = `OVERRIDE ANALISTA\nEstado Certronic: ${conf[estado]?.titulo || estado || "—"}\nEstado override: ${c.titulo}\nMotivo: ${override.motivo}\nEditado: ${override.fecha_cambio}`;
    }
    
    const clickeable = !!ctx;
    
    return (
      <div 
        title={tooltip} 
        onClick={clickeable ? (e) => {
          e.stopPropagation();
          setModalOverride({
            contratista: ctx.contratista,
            categoria: ctx.categoria,
            subcontratista: ctx.subcontratista,
            docCampo: ctx.docCampo,
            docLabel: ctx.docLabel,
            estadoCertronic: estado,
            fechaSnapshot: ctx.fechaSnapshot,
            overrideExistente: override || null,
          });
        } : undefined}
        style={{
          width: 28, height: 28, borderRadius: 6,
          background: c.bg, color: c.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, margin: "0 auto",
          cursor: clickeable ? "pointer" : "default",
          position: "relative",
          border: override ? "2px solid #f59e0b" : undefined,
        }}>
        {c.ico}
        {override && (
          <span style={{
            position: "absolute", top: -3, right: -3,
            width: 10, height: 10, borderRadius: "50%",
            background: "#f59e0b", border: "2px solid #fff",
          }} title="Editado por analista" />
        )}
      </div>
    );
  };

  const renderEstadoFinal = (estado) => {
    const conf = {
      CERTIFICADO: { label: "✓ Certificado", bg: "#dcfce7", color: "#166534" },
      PENDIENTE: { label: "⏳ Parcial", bg: "#fef3c7", color: "#92400e" },
      NO_CERTIFICADO: { label: "✗ Sin cert.", bg: "#fee2e2", color: "#c0392b" },
    };
    const c = conf[estado] || { label: estado || "—", bg: "#f1f5f9", color: "#64748b" };
    return (
      <span style={{
        display: "inline-block", padding: "3px 10px", borderRadius: 12,
        fontSize: 11, fontWeight: 600, background: c.bg, color: c.color, whiteSpace: "nowrap",
      }}>{c.label}</span>
    );
  };

  const toggleOrden = (col) => {
    if (ordenCol === col) setOrdenAsc(!ordenAsc);
    else { setOrdenCol(col); setOrdenAsc(true); }
  };
  const flecha = (col) => ordenCol === col ? (ordenAsc ? " ▲" : " ▼") : "";

  // ── RENDER ──
  return (
    <div className="pg" style={{ paddingBottom: 40 }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="sec-title">Pagos · Certificación Documental</div>
          <div className="sec-sub">
            {empresasActivasUnicas} empresas activas · {empresasInhabilitadasUnicas} inhabilitadas · {operacionesUnicas.length} operaciones
            {ultimaEjecucion && (
              <> · Última: {new Date(ultimaEjecucion.fecha_ejecucion).toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ width: "auto", minWidth: 150 }}>
            {periodos.map((p, idx) => {
              const [a, m] = p.split("-");
              const nm = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][parseInt(m)];
              // El primero (más reciente) se marca como vigente
              const esVigente = idx === 0;
              const label = esVigente ? `🟢 ${nm} ${a} (vigente)` : `${nm} ${a}`;
              return <option key={p} value={p}>{label}</option>;
            })}
          </select>
        </div>
      </div>

      {/* 🆕 Banner alerta del último run del pipeline */}
      {ultimoRun && ultimoRun.tiene_errores && (() => {
        const fecha = new Date(ultimoRun.fecha_run);
        const fechaStr = fecha.toLocaleString("es-CL", { 
          day: "2-digit", month: "2-digit", year: "numeric", 
          hour: "2-digit", minute: "2-digit" 
        });
        const pasosConError = (ultimoRun.pasos || []).filter(p => p.status === "warn" || p.status === "error");
        return (
          <div style={{
            background: "#fef3c7", border: "1px solid #fbbf24", borderLeft: "4px solid #f59e0b",
            borderRadius: 6, padding: "10px 14px", marginBottom: 12, fontSize: 11.5, color: "#78350f",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12, color: "#92400e" }}>
                  ⚠ Última actualización ({fechaStr}) tuvo {pasosConError.length} {pasosConError.length === 1 ? "advertencia" : "advertencias"}
                </div>
                <div style={{ marginBottom: 6 }}>
                  Algunos datos en Brain pueden estar desactualizados. Pasos con error:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginLeft: 6 }}>
                  {pasosConError.map((p, i) => (
                    <div key={i} style={{ fontSize: 11 }}>
                      <strong>[{p.paso}] {p.label}:</strong> {p.mensaje || "(sin mensaje)"}
                      {p.errores > 0 && <span style={{ color: "#dc2626", fontWeight: 700, marginLeft: 6 }}>{p.errores} fichas</span>}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#92400e", marginTop: 6, fontStyle: "italic" }}>
                  💡 Si tenés acceso al servidor: <code style={{ background: "#fff", padding: "1px 4px", borderRadius: 3 }}>ssh root@162.243.90.161</code> y ejecutar <code style={{ background: "#fff", padding: "1px 4px", borderRadius: 3 }}>node /opt/certronic-scraper/rescatar-fichas.cjs</code> (o vehículos)
                </div>
              </div>
              <button onClick={() => setUltimoRun(null)}
                style={{ padding: "4px 10px", border: "1px solid #fbbf24", background: "#fff", borderRadius: 4, fontSize: 11, color: "#92400e", cursor: "pointer", whiteSpace: "nowrap", height: "fit-content" }}>
                Ocultar
              </button>
            </div>
          </div>
        );
      })()}

      {/* TABS de vista principal */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "2px solid #e4e7ec", flexWrap: "wrap" }}>
        {[
          { id: "inicial", label: "Dashboard Inicial", n: null },
          { id: "dashboard", label: "Dashboard Mensual", n: kpis.total },
          { id: "empleados", label: "Empleados", n: null },
          { id: "vehiculos", label: "Vehículos", n: null },
          { id: "criticos", label: "Activos Críticos", n: activosCriticos.length, alert: activosCriticos.length > 0 },
          { id: "hallazgos", label: "Hallazgos", n: null },
          { id: "rse", label: "🛡️ Riesgo RSE", n: null },
          { id: "historico", label: "📊 Histórico", n: null },
          { id: "matriz", label: "Matriz Documentos", n: null },
        ].map(t => (
          <button key={t.id} onClick={() => setVistaActiva(t.id)}
            style={{
              padding: "10px 14px", border: "none", cursor: "pointer",
              borderBottom: vistaActiva === t.id ? "3px solid #1a3a6b" : "3px solid transparent",
              background: "transparent",
              color: vistaActiva === t.id ? "#1a3a6b" : (t.alert ? "#c0392b" : t.warn ? "#92400e" : "#666"),
              fontWeight: vistaActiva === t.id ? 700 : 500,
              fontSize: 13, fontFamily: "Geist, sans-serif",
              marginBottom: -2,
            }}>
            {t.label}
            {t.n != null && <span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 600 }}>({t.n})</span>}
          </button>
        ))}
      </div>

      {loading && <div className="loading">Cargando datos…</div>}

      {!loading && (
        <>
          {/* ─── VISTA: DASHBOARD ─── */}
          {vistaActiva === "dashboard" && (
            <DashboardCertificacion
              datos={datos}
              kpis={kpis}
              empresasActivasUnicas={empresasActivasUnicas}
              empresasInhabilitadasUnicas={empresasInhabilitadasUnicas}
              tabCategoria={tabCategoria} setTabCategoria={setTabCategoria}
              busqueda={busqueda} setBusqueda={setBusqueda}
              filtroEstado={filtroEstado} setFiltroEstado={setFiltroEstado}
              filtroMandante={filtroMandante} setFiltroMandante={setFiltroMandante}
              filtroActivo={filtroActivo} setFiltroActivo={setFiltroActivo}
              operacionesUnicas={operacionesUnicas}
              datosCategoriaActual={datosCategoriaActual}
              docsPorCategoria={docsPorCategoria}
              renderIconoDoc={renderIconoDoc} renderEstadoFinal={renderEstadoFinal}
              toggleOrden={toggleOrden} flecha={flecha}
              operacionAMandante={operacionAMandante}
              cumplInicial={cumplInicial}
            />
          )}

          {/* ─── VISTA: DASHBOARD INICIAL (NUEVO) ─── */}
          {vistaActiva === "inicial" && <DashboardInicial />}

          {/* ─── VISTA: EMPLEADOS (NUEVO) ─── */}
          {vistaActiva === "empleados" && <DashboardEmpleados />}

          {/* ─── VISTA: VEHÍCULOS (NUEVO) ─── */}
          {vistaActiva === "vehiculos" && <DashboardVehiculos />}

          {/* ─── VISTA: ACTIVOS CRÍTICOS ─── */}
          {vistaActiva === "criticos" && (
            <ActivosCriticos
              activosCriticos={activosCriticos}
              renderEstadoFinal={renderEstadoFinal}
              operacionAMandante={operacionAMandante}
            />
          )}

          {/* ─── VISTA: HALLAZGOS ─── */}
          {vistaActiva === "hallazgos" && (
            <HallazgosAutomaticos
              datos={datos}
              activosCriticos={activosCriticos}
              todosInhabilitados={todosInhabilitados}
              empresasInhabilitadasUnicas={empresasInhabilitadasUnicas}
              operacionAMandante={operacionAMandante}
            />
          )}

          {/* ─── VISTA: RIESGO RSE (NUEVO) ─── */}
          {vistaActiva === "rse" && <DashboardRiesgoRSE />}

          {/* ─── VISTA: HISTÓRICO (NUEVO - Sprint 3 Fase B.2) ─── */}
          {vistaActiva === "historico" && <DashboardHistorico operacionAMandante={operacionAMandante} />}

          {/* ─── VISTA: MATRIZ ─── */}
          {vistaActiva === "matriz" && <EditorMatriz />}
        </>
      )}
      
      {/* 🆕 MODAL DE OVERRIDE DEL ANALISTA */}
      {modalOverride && (
        <ModalOverride
          contexto={modalOverride}
          onClose={() => setModalOverride(null)}
          onGuardar={async (datos) => {
            const ok = await guardarOverride({
              contratista: modalOverride.contratista,
              categoria: modalOverride.categoria,
              subcontratista: modalOverride.subcontratista,
              docCampo: modalOverride.docCampo,
              estadoCertronic: modalOverride.estadoCertronic,
              fechaSnapshot: modalOverride.fechaSnapshot,
              estadoOverride: datos.estado,
              motivo: datos.motivo,
              fechaCambio: datos.fecha,
            });
            if (ok) setModalOverride(null);
          }}
          onQuitar={async () => {
            if (modalOverride.overrideExistente) {
              await quitarOverride(modalOverride.overrideExistente);
              setModalOverride(null);
            }
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD INICIAL — Una fila por contratista, columnas por doc
// ═══════════════════════════════════════════════════════════════
function DashboardInicial() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  const [snapshotDetalle, setSnapshotDetalle] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos"); // todos | verde | amarillo | rojo

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Snapshot más reciente de empleados_docs (la fuente de los DOC_CONTRATISTA)
        const { data: snap } = await sb.from("certronic_empleados_docs")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snap || snap.length === 0) {
          if (!cancel) { setDocs([]); setLoading(false); }
          return;
        }
        const fechaSnap = snap[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnap);

        // 2. Cargar todos los DOC_CONTRATISTA del snapshot (paginado)
        let resultado = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          const { data, error } = await sb.from("certronic_empleados_docs")
            .select("token_certronic, documento, cumple, vencimiento, impide_pago")
            .eq("fecha_snapshot", fechaSnap)
            .eq("origen", "DOC_CONTRATISTA")
            .range(from, from + limite - 1);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          resultado = resultado.concat(data);
          if (data.length < limite) break;
          from += limite;
        }

        // 3. 🆕 Buscar el snapshot MÁS RECIENTE de empleados_detalle INDEPENDIENTEMENTE
        //    No asumir que tiene la misma fecha que empleados_docs.
        //    El scraper de detalle puede fallar/atrasarse mientras docs sí se actualiza.
        const { data: snapDet } = await sb.from("certronic_empleados_detalle")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        const fechaSnapDet = snapDet && snapDet[0] ? snapDet[0].fecha_snapshot : null;
        if (!cancel) setSnapshotDetalle(fechaSnapDet);

        // Cargar mapping token → contratista (de empleados_detalle, con su snapshot independiente)
        const tokenAContratista = new Map();
        const tokenAPlanta = new Map();
        if (fechaSnapDet) {
          const { data: detalles } = await sb.from("certronic_empleados_detalle")
            .select("token_certronic, contratista, planta")
            .eq("fecha_snapshot", fechaSnapDet);
          for (const d of detalles || []) {
            if (d.contratista) tokenAContratista.set(d.token_certronic, d.contratista);
            if (d.planta) tokenAPlanta.set(d.token_certronic, d.planta);
          }
        }

        if (!cancel) setDocs(resultado.map(r => ({
          ...r,
          contratista: tokenAContratista.get(r.token_certronic) || "(sin contratista)",
          planta: tokenAPlanta.get(r.token_certronic) || null,
        })));
      } catch (e) {
        console.error("[DashboardInicial] Error:", e);
        if (!cancel) setDocs([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Procesar: agrupar por contratista
  const { contratistas, todosDocsUnicos } = useMemo(() => {
    if (!docs.length) return { contratistas: [], todosDocsUnicos: [] };
    
    // 1. Lista única de docs (columnas dinámicas, ordenadas por frecuencia)
    const cuentaDocs = {};
    for (const d of docs) {
      cuentaDocs[d.documento] = (cuentaDocs[d.documento] || 0) + 1;
    }
    const todosDocsUnicos = Object.entries(cuentaDocs)
      .sort((a, b) => b[1] - a[1])
      .map(([nombre]) => nombre);
    
    // 2. Agrupar por contratista
    const porContratista = new Map();
    for (const d of docs) {
      const c = d.contratista;
      if (!porContratista.has(c)) {
        porContratista.set(c, { contratista: c, planta: d.planta, docs: new Map() });
      }
      const grupo = porContratista.get(c);
      // Tomar el primer cumple que aparezca (todos los empleados del mismo contratista
      // deberían tener el mismo estado del doc del contratista)
      if (!grupo.docs.has(d.documento)) {
        grupo.docs.set(d.documento, {
          cumple: d.cumple,
          vencimiento: d.vencimiento,
          impide_pago: d.impide_pago,
        });
      }
    }
    
    // 3. Calcular % cumplimiento por contratista
    const lista = [];
    for (const [contratista, grupo] of porContratista.entries()) {
      const totalDocs = grupo.docs.size;
      const cumplen = Array.from(grupo.docs.values()).filter(d => d.cumple === true).length;
      const porcentaje = totalDocs > 0 ? Math.round((cumplen * 100) / totalDocs) : 0;
      let semaforo = "rojo";
      if (porcentaje === 100) semaforo = "verde";
      else if (porcentaje >= 50) semaforo = "amarillo";
      
      lista.push({
        contratista,
        planta: grupo.planta,
        totalDocs,
        cumplen,
        porcentaje,
        semaforo,
        docs: grupo.docs,
      });
    }
    
    // Ordenar: rojos primero (peores), después amarillos, después verdes
    lista.sort((a, b) => {
      const orden = { rojo: 0, amarillo: 1, verde: 2 };
      if (orden[a.semaforo] !== orden[b.semaforo]) return orden[a.semaforo] - orden[b.semaforo];
      return a.contratista.localeCompare(b.contratista);
    });
    
    return { contratistas: lista, todosDocsUnicos };
  }, [docs]);

  // Filtrar
  const contratistasFiltrados = useMemo(() => {
    let r = contratistas;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(c => c.contratista.toLowerCase().includes(q));
    }
    if (filtroEstado !== "todos") {
      r = r.filter(c => c.semaforo === filtroEstado);
    }
    return r;
  }, [contratistas, busqueda, filtroEstado]);

  const stats = useMemo(() => ({
    total: contratistas.length,
    verdes: contratistas.filter(c => c.semaforo === "verde").length,
    amarillos: contratistas.filter(c => c.semaforo === "amarillo").length,
    rojos: contratistas.filter(c => c.semaforo === "rojo").length,
  }), [contratistas]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Cargando docs iniciales...</div>;
  if (!contratistas.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos de docs iniciales en certronic_empleados_docs.
      <br />Verificá que el scraper de empleados haya corrido.
    </div>
  );

  // Render del ícono de cumplimiento
  const renderCumple = (cumple) => {
    if (cumple === true) return <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 14 }}>✓</span>;
    if (cumple === false) return <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 14 }}>✗</span>;
    return <span style={{ color: "#cbd5e1", fontSize: 11 }}>—</span>;
  };

  // Render del semáforo
  const colorSemaforo = (s) => s === "verde" ? "#16a34a" : s === "amarillo" ? "#f59e0b" : "#dc2626";
  const bgSemaforo = (s) => s === "verde" ? "#dcfce7" : s === "amarillo" ? "#fef3c7" : "#fee2e2";

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>
            📋 Dashboard Inicial — Documentación del Contratista
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {contratistas.length} contratistas · Snapshot: {snapshotUsado || "—"} · 
            {todosDocsUnicos.length} tipos de documento detectados
          </div>
          {/* 🆕 Warning si los dos snapshots están desincronizados */}
          {snapshotDetalle && snapshotUsado && snapshotDetalle !== snapshotUsado && (
            <div style={{
              marginTop: 6, padding: "6px 10px", fontSize: 10.5,
              background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4,
              color: "#92400e", display: "inline-block",
            }}>
              ⚠️ <strong>Desincronización detectada:</strong> documentos del <strong>{snapshotUsado}</strong> pero mapping de contratistas del <strong>{snapshotDetalle}</strong>. Algunos contratistas nuevos pueden aparecer como "(sin contratista)" hasta que el próximo scraper completo se ejecute.
            </div>
          )}
        </div>
        <BotonDescargarExcel onClick={() => {
          // Hoja 1: matriz contratista x doc
          const headers = ["Contratista", "Planta", "Cumple", "Total", "% Cumplimiento", "Semáforo", ...todosDocsUnicos];
          const filas = contratistas.map(c => {
            const row = [
              c.contratista,
              c.planta || "",
              c.cumplen,
              c.totalDocs,
              c.porcentaje + "%",
              c.semaforo === "verde" ? "VERDE 100%" : c.semaforo === "amarillo" ? "AMARILLO 50-99%" : "ROJO <50%",
            ];
            for (const doc of todosDocsUnicos) {
              const dato = c.docs.get(doc);
              if (!dato) row.push("N/A");
              else if (dato.cumple === true) row.push("CUMPLE");
              else if (dato.cumple === false) row.push("NO CUMPLE");
              else row.push("?");
            }
            return row;
          });
          
          // Hoja 2: detalle por documento
          const headersDet = ["Contratista", "Documento", "Cumple", "Vencimiento", "Impide Pago"];
          const filasDet = [];
          for (const c of contratistas) {
            for (const [doc, dato] of c.docs.entries()) {
              filasDet.push([
                c.contratista,
                doc,
                dato.cumple === true ? "Sí" : dato.cumple === false ? "No" : "?",
                dato.vencimiento || "",
                dato.impide_pago ? "Sí" : "No",
              ]);
            }
          }
          
          descargarExcelMultihoja([
            { nombre: "Matriz", datos: [headers, ...filas] },
            { nombre: "Detalle", datos: [headersDet, ...filasDet] },
          ], "Dashboard_Inicial");
        }} disabled={contratistas.length === 0} />
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => setFiltroEstado("todos")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "todos" ? "#1a3a6b" : "#fff",
          color: filtroEstado === "todos" ? "#fff" : "#1a3a6b",
          border: "1px solid #1a3a6b",
        }}>Todos ({stats.total})</button>
        <button onClick={() => setFiltroEstado("verde")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "verde" ? "#16a34a" : "#dcfce7",
          color: filtroEstado === "verde" ? "#fff" : "#166534",
          border: "1px solid #16a34a",
        }}>✓ Cumple 100% ({stats.verdes})</button>
        <button onClick={() => setFiltroEstado("amarillo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "amarillo" ? "#f59e0b" : "#fef3c7",
          color: filtroEstado === "amarillo" ? "#fff" : "#92400e",
          border: "1px solid #f59e0b",
        }}>⚠ Parcial 50-99% ({stats.amarillos})</button>
        <button onClick={() => setFiltroEstado("rojo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "rojo" ? "#dc2626" : "#fee2e2",
          color: filtroEstado === "rojo" ? "#fff" : "#991b1b",
          border: "1px solid #dc2626",
        }}>✗ Crítico &lt;50% ({stats.rojos})</button>
        <input
          type="text"
          placeholder="Buscar contratista..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, width: 200, marginLeft: "auto" }}
        />
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#1a3a6b", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, position: "sticky", left: 0, background: "#1a3a6b", zIndex: 3, minWidth: 220 }}>Contratista</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, minWidth: 110, whiteSpace: "nowrap" }}>Cumplimiento</th>
              {todosDocsUnicos.map(doc => {
                // Generar abreviación corta del documento (3-4 palabras max)
                const abrev = doc
                  .replace(/Recepción /i, "Recep. ")
                  .replace(/Actualización /i, "Act. ")
                  .replace(/Certificado de /i, "Cert. ")
                  .replace(/Declaración Jurada /i, "Decl.J. ")
                  .replace(/Aceptación de términos y condiciones del /i, "Acept. ")
                  .replace(/Pago Cotizaciones Previsionales /i, "Cotiz. ")
                  .replace(/Procedimiento de /i, "Proc. ");
                return (
                  <th key={doc} style={{ 
                    padding: "10px 6px", textAlign: "center", fontSize: 9, fontWeight: 600,
                    minWidth: 90, maxWidth: 130, lineHeight: 1.25, verticalAlign: "middle",
                  }} title={doc}>
                    {abrev}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {contratistasFiltrados.map((c, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                <td style={{ padding: "8px", fontWeight: 600, color: "#1f2937", position: "sticky", left: 0, background: i % 2 === 0 ? "#fff" : "#fafbfc", zIndex: 1, borderRight: "1px solid #e4e7ec" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorSemaforo(c.semaforo), flexShrink: 0 }} />
                    <span>{c.contratista}</span>
                  </div>
                  {c.planta && <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{c.planta}</div>}
                </td>
                <td style={{ padding: "8px", textAlign: "center" }}>
                  <span style={{
                    padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                    background: bgSemaforo(c.semaforo), color: colorSemaforo(c.semaforo),
                    whiteSpace: "nowrap", display: "inline-block",
                  }}>
                    {c.cumplen}/{c.totalDocs} ({c.porcentaje}%)
                  </span>
                </td>
                {todosDocsUnicos.map(doc => {
                  const dato = c.docs.get(doc);
                  return (
                    <td key={doc} style={{ padding: "8px 4px", textAlign: "center" }}>
                      {dato ? renderCumple(dato.cumple) : <span style={{ color: "#e2e8f0", fontSize: 10 }}>n/a</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {contratistasFiltrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún contratista coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
        💡 Cada fila es 1 contratista. <strong style={{ color: "#16a34a" }}>✓</strong> = cumple · <strong style={{ color: "#dc2626" }}>✗</strong> = no cumple · <span style={{ color: "#94a3b8" }}>n/a</span> = no aplica para ese contratista.
        <br />
        Tooltip en encabezados: pasá el mouse para ver el nombre completo del documento.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD EMPLEADOS — vista detallada de los 376 empleados
// ═══════════════════════════════════════════════════════════════
function DashboardEmpleados() {
  const [empleados, setEmpleados] = useState([]);
  const [docs, setDocs] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  
  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [filtroContratista, setFiltroContratista] = useState("todos");
  const [filtroSemaforo, setFiltroSemaforo] = useState("todos");
  const [soloIngresoEsteMes, setSoloIngresoEsteMes] = useState(false);
  
  // Expansión
  const [expandidoToken, setExpandidoToken] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Snapshot más reciente
        const { data: snap } = await sb.from("certronic_empleados_detalle")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snap || snap.length === 0) {
          if (!cancel) { setEmpleados([]); setLoading(false); }
          return;
        }
        const fechaSnap = snap[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnap);

        // 2. Cargar empleados detalle (paginado)
        let dets = [];
        let from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_empleados_detalle")
            .select("token_certronic, nombre_completo, apellido, nombre, cuil, fecha_ingreso, contratista, planta, categoria, funcion, tipo_contrato, tipo_trabajador, email, celular, telefono, ficha_completa")
            .eq("fecha_snapshot", fechaSnap)
            .range(from, from + 999);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          dets = dets.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        if (!cancel) setEmpleados(dets);

        // 3. Cargar docs (paginado)
        let docsArr = [];
        from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_empleados_docs")
            .select("token_certronic, origen, documento, cumple, vencimiento, vencimiento_raw, impide_pago, impide_acceso, entidad, periodos_pendientes, estado")
            .eq("fecha_snapshot", fechaSnap)
            .range(from, from + 999);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          docsArr = docsArr.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        if (!cancel) setDocs(docsArr);

        // 4. Cargar contratos
        const { data: contrs } = await sb.from("certronic_empleados_contratos_indiv")
          .select("token_certronic, contrato_titular, planta, principal, desde, desde_raw, hasta, hasta_raw, estado")
          .eq("fecha_snapshot", fechaSnap);
        if (!cancel) setContratos(contrs || []);

      } catch (e) {
        console.error("[DashboardEmpleados] Error:", e);
        if (!cancel) setEmpleados([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Indexar docs por token (para cada empleado encontrar sus docs rápido)
  const docsPorEmpleado = useMemo(() => {
    const m = new Map();
    for (const d of docs) {
      if (!m.has(d.token_certronic)) m.set(d.token_certronic, []);
      m.get(d.token_certronic).push(d);
    }
    return m;
  }, [docs]);

  const contratosPorEmpleado = useMemo(() => {
    const m = new Map();
    for (const c of contratos) {
      if (!m.has(c.token_certronic)) m.set(c.token_certronic, []);
      m.get(c.token_certronic).push(c);
    }
    return m;
  }, [contratos]);

  // Calcular stats por empleado (% cumplimiento, pendientes, etc)
  const empleadosConStats = useMemo(() => {
    return empleados.map(e => {
      const sus_docs = docsPorEmpleado.get(e.token_certronic) || [];
      const docEmpl = sus_docs.filter(d => d.origen === "DOC_EMPLEADO");
      const docCont = sus_docs.filter(d => d.origen === "DOC_CONTRATISTA");
      const pendientes = sus_docs.filter(d => d.origen === "MIS_PENDIENTES");
      
      // Cumplimiento de docs personales (DOC_EMPLEADO)
      const totalPersonales = docEmpl.length;
      const cumplenPersonales = docEmpl.filter(d => d.cumple === true).length;
      const pctPersonales = totalPersonales > 0 ? Math.round((cumplenPersonales * 100) / totalPersonales) : 0;
      
      let semaforo = "rojo";
      if (totalPersonales === 0) semaforo = "gris";
      else if (pctPersonales === 100) semaforo = "verde";
      else if (pctPersonales >= 50) semaforo = "amarillo";
      
      // Vencimientos próximos
      const hoy = new Date();
      const en30Dias = new Date(); en30Dias.setDate(hoy.getDate() + 30);
      const docsPorVencer = docEmpl.filter(d => {
        if (!d.vencimiento) return false;
        const v = new Date(d.vencimiento);
        return v >= hoy && v <= en30Dias;
      });
      const docsVencidos = docEmpl.filter(d => {
        if (!d.vencimiento) return false;
        return new Date(d.vencimiento) < hoy;
      });
      
      return {
        ...e,
        sus_docs,
        docEmpl,
        docCont,
        pendientes,
        totalPersonales,
        cumplenPersonales,
        pctPersonales,
        semaforo,
        docsPorVencer,
        docsVencidos,
      };
    });
  }, [empleados, docsPorEmpleado]);

  // Detectar mes actual
  const mesActualStr = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const ingresoEsteMes = (fecha) => fecha && fecha.startsWith(mesActualStr);
  const nombreMesActual = () => {
    const meses = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
    return meses[new Date().getMonth()];
  };

  // Filtros
  const empleadosFiltrados = useMemo(() => {
    let r = empleadosConStats;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(e =>
        (e.nombre_completo || "").toLowerCase().includes(q) ||
        (e.cuil || "").includes(q) ||
        (e.contratista || "").toLowerCase().includes(q) ||
        (e.email || "").toLowerCase().includes(q)
      );
    }
    if (filtroContratista !== "todos") {
      r = r.filter(e => e.contratista === filtroContratista);
    }
    if (filtroSemaforo !== "todos") {
      r = r.filter(e => e.semaforo === filtroSemaforo);
    }
    if (soloIngresoEsteMes) {
      r = r.filter(e => ingresoEsteMes(e.fecha_ingreso));
    }
    return r;
  }, [empleadosConStats, busqueda, filtroContratista, filtroSemaforo, soloIngresoEsteMes, mesActualStr]);

  // Contratistas únicos para filtro
  const contratistasUnicos = useMemo(() => {
    const s = new Set();
    for (const e of empleados) if (e.contratista) s.add(e.contratista);
    return Array.from(s).sort();
  }, [empleados]);

  // Stats globales
  const statsGlobales = useMemo(() => ({
    total: empleadosConStats.length,
    verdes: empleadosConStats.filter(e => e.semaforo === "verde").length,
    amarillos: empleadosConStats.filter(e => e.semaforo === "amarillo").length,
    rojos: empleadosConStats.filter(e => e.semaforo === "rojo").length,
    grises: empleadosConStats.filter(e => e.semaforo === "gris").length,
    ingresaronEsteMes: empleadosConStats.filter(e => ingresoEsteMes(e.fecha_ingreso)).length,
    conPendientes: empleadosConStats.filter(e => e.pendientes.length > 0).length,
    totalPendientes: empleadosConStats.reduce((s, e) => s + e.pendientes.length, 0),
  }), [empleadosConStats, mesActualStr]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Cargando empleados...</div>;
  if (!empleados.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos de empleados en certronic_empleados_detalle.
    </div>
  );

  // Helpers de UI
  const colorSemaforo = (s) => s === "verde" ? "#16a34a" : s === "amarillo" ? "#f59e0b" : s === "rojo" ? "#dc2626" : "#94a3b8";
  const bgSemaforo = (s) => s === "verde" ? "#dcfce7" : s === "amarillo" ? "#fef3c7" : s === "rojo" ? "#fee2e2" : "#f1f5f9";

  const fmtFecha = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    return `${parseInt(d)}-${meses[parseInt(m)-1]}-${y.slice(2)}`;
  };

  const renderCumple = (cumple) => {
    if (cumple === true) return <span style={{ color: "#16a34a", fontSize: 14, fontWeight: 700 }}>✓</span>;
    if (cumple === false) return <span style={{ color: "#dc2626", fontSize: 14, fontWeight: 700 }}>✗</span>;
    return <span style={{ color: "#cbd5e1" }}>—</span>;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>
            👷 Empleados — Vista detallada
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {empleados.length} empleados · Snapshot: {snapshotUsado || "—"}
          </div>
        </div>
        <BotonDescargarExcel onClick={() => {
          // Hoja Resumen
          const headersRes = ["Apellido", "Nombre", "CUIL/Cédula", "Email", "Celular", "Contratista", "Planta", "Categoría", "Función", "Tipo Contrato", "Tipo Trabajador", "Fecha Ingreso", "Cumple", "Total Docs", "% Cumplim.", "Semáforo", "Pendientes", "Por Vencer ≤30d", "Vencidos", "Ficha Completa"];
          const filasRes = empleadosConStats.map(e => [
            e.apellido || "",
            e.nombre || "",
            e.cuil || "",
            e.email || "",
            e.celular || "",
            e.contratista || "",
            e.planta || "",
            e.categoria || "",
            e.funcion || "",
            e.tipo_contrato || "",
            e.tipo_trabajador || "",
            e.fecha_ingreso || "",
            e.cumplenPersonales,
            e.totalPersonales,
            e.pctPersonales + "%",
            e.semaforo.toUpperCase(),
            e.pendientes.length,
            e.docsPorVencer.length,
            e.docsVencidos.length,
            e.ficha_completa ? "Sí" : "No",
          ]);
          
          // Hoja Docs detalle
          const headersDoc = ["Empleado", "CUIL", "Contratista", "Origen", "Documento", "Cumple", "Vencimiento", "Impide Pago", "Impide Acceso"];
          const filasDoc = [];
          for (const e of empleadosConStats) {
            for (const d of e.sus_docs) {
              filasDoc.push([
                e.nombre_completo || "",
                e.cuil || "",
                e.contratista || "",
                d.origen,
                d.documento,
                d.cumple === true ? "Sí" : d.cumple === false ? "No" : "?",
                d.vencimiento || d.vencimiento_raw || "",
                d.impide_pago ? "Sí" : "No",
                d.impide_acceso ? "Sí" : "No",
              ]);
            }
          }
          
          // Hoja Pendientes
          const headersPend = ["Empleado", "CUIL", "Contratista", "Documento", "Períodos Adeudados", "Estado", "Impide Pago"];
          const filasPend = [];
          for (const e of empleadosConStats) {
            for (const p of e.pendientes) {
              filasPend.push([
                e.nombre_completo || "",
                e.cuil || "",
                e.contratista || "",
                p.documento,
                p.periodos_pendientes || "",
                p.estado || "",
                p.impide_pago ? "Sí" : "No",
              ]);
            }
          }
          
          // Hoja Vencidos
          const headersVenc = ["Empleado", "CUIL", "Contratista", "Documento", "Vencimiento", "Días vencido"];
          const filasVenc = [];
          const hoy = new Date();
          for (const e of empleadosConStats) {
            for (const d of e.docsVencidos) {
              const dias = Math.floor((hoy - new Date(d.vencimiento)) / (1000 * 60 * 60 * 24));
              filasVenc.push([
                e.nombre_completo || "",
                e.cuil || "",
                e.contratista || "",
                d.documento,
                d.vencimiento,
                dias,
              ]);
            }
          }
          
          descargarExcelMultihoja([
            { nombre: "Resumen", datos: [headersRes, ...filasRes] },
            { nombre: "Docs Detalle", datos: [headersDoc, ...filasDoc] },
            { nombre: "Pendientes", datos: [headersPend, ...filasPend] },
            { nombre: "Vencidos", datos: [headersVenc, ...filasVenc] },
          ], "Empleados");
        }} disabled={empleados.length === 0} />
      </div>

      {/* KPIs filtrables */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setFiltroSemaforo("todos")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "todos" ? "#1a3a6b" : "#fff",
          color: filtroSemaforo === "todos" ? "#fff" : "#1a3a6b",
          border: "1px solid #1a3a6b",
        }}>Todos ({statsGlobales.total})</button>
        <button onClick={() => setFiltroSemaforo("verde")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "verde" ? "#16a34a" : "#dcfce7",
          color: filtroSemaforo === "verde" ? "#fff" : "#166534",
          border: "1px solid #16a34a",
        }}>✓ 100% ({statsGlobales.verdes})</button>
        <button onClick={() => setFiltroSemaforo("amarillo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "amarillo" ? "#f59e0b" : "#fef3c7",
          color: filtroSemaforo === "amarillo" ? "#fff" : "#92400e",
          border: "1px solid #f59e0b",
        }}>⚠ 50-99% ({statsGlobales.amarillos})</button>
        <button onClick={() => setFiltroSemaforo("rojo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "rojo" ? "#dc2626" : "#fee2e2",
          color: filtroSemaforo === "rojo" ? "#fff" : "#991b1b",
          border: "1px solid #dc2626",
        }}>✗ &lt;50% ({statsGlobales.rojos})</button>
        {statsGlobales.grises > 0 && (
          <button onClick={() => setFiltroSemaforo("gris")} style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: filtroSemaforo === "gris" ? "#94a3b8" : "#f1f5f9",
            color: filtroSemaforo === "gris" ? "#fff" : "#475569",
            border: "1px solid #cbd5e1",
          }}>Sin docs ({statsGlobales.grises})</button>
        )}
        <button onClick={() => setSoloIngresoEsteMes(!soloIngresoEsteMes)} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: soloIngresoEsteMes ? "#16a34a" : "#fff",
          color: soloIngresoEsteMes ? "#fff" : "#16a34a",
          border: "1px solid #16a34a",
        }}>🆕 Ingresaron este mes ({statsGlobales.ingresaronEsteMes})</button>
        {statsGlobales.totalPendientes > 0 && (
          <div style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5",
          }}>
            ⚠ {statsGlobales.totalPendientes} pendientes en {statsGlobales.conPendientes} empleados
          </div>
        )}
      </div>

      {/* Filtros adicionales */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Buscar nombre, CUIL, email, contratista..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, flex: 1, minWidth: 250 }}
        />
        <select
          value={filtroContratista}
          onChange={e => setFiltroContratista(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, minWidth: 200 }}
        >
          <option value="todos">Todos los contratistas ({contratistasUnicos.length})</option>
          {contratistasUnicos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Mostrando: <strong>{empleadosFiltrados.length}</strong> / {empleados.length}
        </span>
      </div>

      {/* Tabla principal */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#1a3a6b", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, width: 30 }}></th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Empleado</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Contratista / Planta</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Fecha Ingreso</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Cumplim.</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Pendientes</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Vencen ≤30d</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Vencidos</th>
            </tr>
          </thead>
          <tbody>
            {empleadosFiltrados.map((e, i) => {
              const expandido = expandidoToken === e.token_certronic;
              const esIngresoMes = ingresoEsteMes(e.fecha_ingreso);
              return (
                <Fragment key={e.token_certronic}>
                  <tr 
                    onClick={() => setExpandidoToken(expandido ? null : e.token_certronic)}
                    style={{ 
                      borderTop: "1px solid #f1f5f9", 
                      background: expandido ? "#eff6ff" : (esIngresoMes ? "#ecfdf5" : (i % 2 === 0 ? "#fff" : "#fafbfc")),
                      cursor: "pointer",
                    }}>
                    <td style={{ padding: "8px", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
                      {expandido ? "▼" : "▶"}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontWeight: 600, color: "#1f2937" }}>
                        {e.nombre_completo || `${e.apellido || ""} ${e.nombre || ""}`.trim() || "(sin nombre)"}
                        {esIngresoMes && (
                          <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "#16a34a", color: "#fff", fontWeight: 700 }}>
                            🆕 {nombreMesActual()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                        {e.cuil && <span>{e.cuil}</span>}
                        {e.email && <span> · {e.email}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontSize: 11 }}>{e.contratista || "—"}</div>
                      {e.planta && <div style={{ fontSize: 9, color: "#94a3b8" }}>{e.planta}</div>}
                    </td>
                    <td style={{ padding: "8px", color: e.fecha_ingreso ? "#475569" : "#cbd5e1" }}>
                      {fmtFecha(e.fecha_ingreso)}
                      {e.fecha_ingreso && (
                        <span title="Fecha real de la ficha" style={{ marginLeft: 4, fontSize: 9, color: "#16a34a", fontWeight: 700 }}>✓</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <span style={{
                        padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: bgSemaforo(e.semaforo), color: colorSemaforo(e.semaforo),
                        whiteSpace: "nowrap", display: "inline-block",
                      }}>
                        {e.cumplenPersonales}/{e.totalPersonales} ({e.pctPersonales}%)
                      </span>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {e.pendientes.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                          {e.pendientes.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {e.docsPorVencer.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                          {e.docsPorVencer.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {e.docsVencidos.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                          {e.docsVencidos.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                  </tr>
                  {/* Fila expandida con detalle */}
                  {expandido && (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, background: "#f8fafc", borderTop: "1px solid #e4e7ec" }}>
                        <DetalleEmpleado 
                          empleado={e}
                          contratos={contratosPorEmpleado.get(e.token_certronic) || []}
                          fmtFecha={fmtFecha}
                          renderCumple={renderCumple}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {empleadosFiltrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún empleado coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
        💡 Click en cualquier fila para ver el detalle completo del empleado (docs, vencimientos, contratos).
      </div>
    </div>
  );
}

// ─── Sub-componente: detalle expandido del empleado ───────────────
function DetalleEmpleado({ empleado, contratos, fmtFecha, renderCumple }) {
  const e = empleado;
  
  return (
    <div>
      {/* Info personal extra */}
      {e.ficha_completa && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: 10, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6 }}>
          {e.celular && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Celular:</strong> {e.celular}</div>}
          {e.telefono && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Teléfono:</strong> {e.telefono}</div>}
          {e.categoria && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Categoría:</strong> {e.categoria}</div>}
          {e.funcion && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Función:</strong> {e.funcion}</div>}
          {e.tipo_contrato && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Tipo Contrato:</strong> {e.tipo_contrato}</div>}
          {e.tipo_trabajador && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Tipo Trabajador:</strong> {e.tipo_trabajador}</div>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Columna izquierda: Doc.Empleado */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            📄 Documentos del Empleado ({e.docEmpl.length})
          </h4>
          {e.docEmpl.length === 0 ? (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin documentos personales registrados</div>
          ) : (
            <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Documento</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Cumple</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Vence</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Pago</th>
                </tr>
              </thead>
              <tbody>
                {e.docEmpl.map((d, j) => (
                  <tr key={j} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "4px 6px", fontWeight: 500 }}>{d.documento}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{renderCumple(d.cumple)}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center", color: d.vencimiento ? "#475569" : "#cbd5e1" }}>
                      {d.vencimiento ? fmtFecha(d.vencimiento) : (d.vencimiento_raw || "—")}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                      {d.impide_pago && <span title="Impide Pago" style={{ color: "#f59e0b", fontSize: 14 }}>🟡</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Columna derecha: Doc.Contratista + Pendientes + Contratos */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Pendientes (lo más importante visual) */}
          {e.pendientes.length > 0 && (
            <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, padding: 10 }}>
              <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
                ⚠ Pendientes ({e.pendientes.length})
              </h4>
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #fcd34d" }}>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Documento</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Períodos</th>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {e.pendientes.map((p, j) => (
                    <tr key={j} style={{ borderTop: "1px solid #fcd34d" }}>
                      <td style={{ padding: "3px 6px", color: "#78350f" }}>{p.documento}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#92400e", fontWeight: 700 }}>{p.periodos_pendientes || "—"}</td>
                      <td style={{ padding: "3px 6px", color: "#78350f" }}>{p.estado || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Contratos */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
              📑 Contratos ({contratos.length})
            </h4>
            {contratos.length === 0 ? (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin contratos individuales</div>
            ) : (
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Titular / Planta</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Desde</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Hasta</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {contratos.map((c, j) => (
                    <tr key={j} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "3px 6px" }}>
                        <div>{c.contrato_titular}</div>
                        {c.planta && <div style={{ color: "#94a3b8", fontSize: 9 }}>{c.planta}</div>}
                      </td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#64748b" }}>{c.desde_raw || "—"}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#64748b" }}>{c.hasta_raw || "—"}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center" }}>
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 10, fontWeight: 600,
                          background: c.estado === "Activo" ? "#dcfce7" : "#f1f5f9",
                          color: c.estado === "Activo" ? "#166534" : "#64748b",
                        }}>
                          {c.estado || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Doc.Contratista (debajo, compacto) */}
      {e.docCont.length > 0 && (
        <div style={{ marginTop: 14, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            🏢 Documentos del Contratista ({e.docCont.length})
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {e.docCont.map((d, j) => (
              <span key={j} title={d.vencimiento_raw || ""} style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 500,
                background: d.cumple === true ? "#dcfce7" : d.cumple === false ? "#fee2e2" : "#f1f5f9",
                color: d.cumple === true ? "#166534" : d.cumple === false ? "#991b1b" : "#64748b",
                border: d.impide_pago ? "1px solid #f59e0b" : "1px solid transparent",
              }}>
                {d.cumple === true ? "✓" : d.cumple === false ? "✗" : "?"} {d.documento}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD VEHÍCULOS — vista detallada de los 342 vehículos
// ═══════════════════════════════════════════════════════════════
function DashboardVehiculos() {
  const [vehiculos, setVehiculos] = useState([]);
  const [docs, setDocs] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  
  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [filtroContratista, setFiltroContratista] = useState("todos");
  const [filtroSemaforo, setFiltroSemaforo] = useState("todos");
  const [filtroEnergia, setFiltroEnergia] = useState("todos");
  
  // Expansión
  const [expandidoToken, setExpandidoToken] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Snapshot más reciente
        const { data: snap } = await sb.from("certronic_vehiculos_detalle")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snap || snap.length === 0) {
          if (!cancel) { setVehiculos([]); setLoading(false); }
          return;
        }
        const fechaSnap = snap[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnap);

        // 2. Cargar vehículos detalle (paginado)
        let dets = [];
        let from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_vehiculos_detalle")
            .select("token_certronic, dominio, marca, modelo, tipo, numero_motor, numero_chasis, cia_seguros, categoria, anio_vehiculo, operacion, servicio, tipo_certificacion, tipo_energia, contratista, planta, ficha_completa")
            .eq("fecha_snapshot", fechaSnap)
            .range(from, from + 999);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          dets = dets.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        if (!cancel) setVehiculos(dets);

        // 3. Cargar docs (paginado)
        let docsArr = [];
        from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_vehiculos_docs")
            .select("token_certronic, origen, documento, cumple, vencimiento, vencimiento_raw, impide_pago, impide_acceso, entidad, periodos_pendientes, estado")
            .eq("fecha_snapshot", fechaSnap)
            .range(from, from + 999);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          docsArr = docsArr.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        if (!cancel) setDocs(docsArr);

        // 4. Cargar contratos
        const { data: contrs } = await sb.from("certronic_vehiculos_contratos_indiv")
          .select("token_certronic, contrato_titular, planta, principal, desde, desde_raw, hasta, hasta_raw, estado")
          .eq("fecha_snapshot", fechaSnap);
        if (!cancel) setContratos(contrs || []);

      } catch (e) {
        console.error("[DashboardVehiculos] Error:", e);
        if (!cancel) setVehiculos([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Indexar
  const docsPorVehiculo = useMemo(() => {
    const m = new Map();
    for (const d of docs) {
      if (!m.has(d.token_certronic)) m.set(d.token_certronic, []);
      m.get(d.token_certronic).push(d);
    }
    return m;
  }, [docs]);

  const contratosPorVehiculo = useMemo(() => {
    const m = new Map();
    for (const c of contratos) {
      if (!m.has(c.token_certronic)) m.set(c.token_certronic, []);
      m.get(c.token_certronic).push(c);
    }
    return m;
  }, [contratos]);

  // Calcular stats
  const vehiculosConStats = useMemo(() => {
    return vehiculos.map(v => {
      const sus_docs = docsPorVehiculo.get(v.token_certronic) || [];
      const docVeh = sus_docs.filter(d => d.origen === "DOC_VEHICULO");
      const docCont = sus_docs.filter(d => d.origen === "DOC_CONTRATISTA");
      const pendientes = sus_docs.filter(d => d.origen === "MIS_PENDIENTES");
      
      const totalDocs = docVeh.length;
      const cumplenDocs = docVeh.filter(d => d.cumple === true).length;
      const pctDocs = totalDocs > 0 ? Math.round((cumplenDocs * 100) / totalDocs) : 0;
      
      let semaforo = "rojo";
      if (totalDocs === 0) semaforo = "gris";
      else if (pctDocs === 100) semaforo = "verde";
      else if (pctDocs >= 50) semaforo = "amarillo";
      
      // Vencimientos
      const hoy = new Date();
      const en30Dias = new Date(); en30Dias.setDate(hoy.getDate() + 30);
      const docsPorVencer = docVeh.filter(d => {
        if (!d.vencimiento) return false;
        const vDate = new Date(d.vencimiento);
        return vDate >= hoy && vDate <= en30Dias;
      });
      const docsVencidos = docVeh.filter(d => {
        if (!d.vencimiento) return false;
        return new Date(d.vencimiento) < hoy;
      });
      
      return {
        ...v,
        sus_docs, docVeh, docCont, pendientes,
        totalDocs, cumplenDocs, pctDocs, semaforo,
        docsPorVencer, docsVencidos,
      };
    });
  }, [vehiculos, docsPorVehiculo]);

  // Filtros
  const vehiculosFiltrados = useMemo(() => {
    let r = vehiculosConStats;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(v =>
        (v.dominio || "").toLowerCase().includes(q) ||
        (v.marca || "").toLowerCase().includes(q) ||
        (v.modelo || "").toLowerCase().includes(q) ||
        (v.contratista || "").toLowerCase().includes(q) ||
        (v.numero_motor || "").toLowerCase().includes(q) ||
        (v.numero_chasis || "").toLowerCase().includes(q)
      );
    }
    if (filtroContratista !== "todos") r = r.filter(v => v.contratista === filtroContratista);
    if (filtroSemaforo !== "todos") r = r.filter(v => v.semaforo === filtroSemaforo);
    if (filtroEnergia !== "todos") r = r.filter(v => (v.tipo_energia || "").toUpperCase() === filtroEnergia);
    return r;
  }, [vehiculosConStats, busqueda, filtroContratista, filtroSemaforo, filtroEnergia]);

  // Únicos para filtros
  const contratistasUnicos = useMemo(() => {
    const s = new Set();
    for (const v of vehiculos) if (v.contratista) s.add(v.contratista);
    return Array.from(s).sort();
  }, [vehiculos]);

  const energiasUnicas = useMemo(() => {
    const s = new Set();
    for (const v of vehiculos) if (v.tipo_energia) s.add(v.tipo_energia.toUpperCase());
    return Array.from(s).sort();
  }, [vehiculos]);

  // Stats globales
  const statsGlobales = useMemo(() => ({
    total: vehiculosConStats.length,
    verdes: vehiculosConStats.filter(v => v.semaforo === "verde").length,
    amarillos: vehiculosConStats.filter(v => v.semaforo === "amarillo").length,
    rojos: vehiculosConStats.filter(v => v.semaforo === "rojo").length,
    grises: vehiculosConStats.filter(v => v.semaforo === "gris").length,
    conPendientes: vehiculosConStats.filter(v => v.pendientes.length > 0).length,
    totalPendientes: vehiculosConStats.reduce((s, v) => s + v.pendientes.length, 0),
    conVencidos: vehiculosConStats.filter(v => v.docsVencidos.length > 0).length,
  }), [vehiculosConStats]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Cargando vehículos...</div>;
  if (!vehiculos.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos de vehículos en certronic_vehiculos_detalle.
    </div>
  );

  // Helpers
  const colorSemaforo = (s) => s === "verde" ? "#16a34a" : s === "amarillo" ? "#f59e0b" : s === "rojo" ? "#dc2626" : "#94a3b8";
  const bgSemaforo = (s) => s === "verde" ? "#dcfce7" : s === "amarillo" ? "#fef3c7" : s === "rojo" ? "#fee2e2" : "#f1f5f9";

  const fmtFecha = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    return `${parseInt(d)}-${meses[parseInt(m)-1]}-${y.slice(2)}`;
  };

  const renderCumple = (cumple) => {
    if (cumple === true) return <span style={{ color: "#16a34a", fontSize: 14, fontWeight: 700 }}>✓</span>;
    if (cumple === false) return <span style={{ color: "#dc2626", fontSize: 14, fontWeight: 700 }}>✗</span>;
    return <span style={{ color: "#cbd5e1" }}>—</span>;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>
            🚗 Vehículos — Vista detallada
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {vehiculos.length} vehículos · Snapshot: {snapshotUsado || "—"}
          </div>
        </div>
        <BotonDescargarExcel onClick={() => {
          // Hoja Resumen
          const headersRes = ["Dominio", "Marca", "Modelo", "Año", "Tipo", "Tipo Certificación", "Tipo Energía", "N° Motor", "N° Chasis", "Cía. Seguros", "Categoría", "Operación", "Servicio", "Contratista", "Planta", "Cumple", "Total Docs", "% Cumplim.", "Semáforo", "Pendientes", "Por Vencer ≤30d", "Vencidos"];
          const filasRes = vehiculosConStats.map(v => [
            v.dominio || "",
            v.marca || "",
            v.modelo || "",
            v.anio_vehiculo || "",
            v.tipo || "",
            v.tipo_certificacion || "",
            v.tipo_energia || "",
            v.numero_motor || "",
            v.numero_chasis || "",
            v.cia_seguros || "",
            v.categoria || "",
            v.operacion || "",
            v.servicio || "",
            v.contratista || "",
            v.planta || "",
            v.cumplenDocs,
            v.totalDocs,
            v.pctDocs + "%",
            v.semaforo.toUpperCase(),
            v.pendientes.length,
            v.docsPorVencer.length,
            v.docsVencidos.length,
          ]);
          
          // Hoja Docs detalle
          const headersDoc = ["Dominio", "Marca/Modelo", "Contratista", "Origen", "Documento", "Cumple", "Vencimiento", "Impide Pago", "Impide Acceso"];
          const filasDoc = [];
          for (const v of vehiculosConStats) {
            for (const d of v.sus_docs) {
              filasDoc.push([
                v.dominio || "",
                `${v.marca || ""} ${v.modelo || ""}`.trim(),
                v.contratista || "",
                d.origen,
                d.documento,
                d.cumple === true ? "Sí" : d.cumple === false ? "No" : "?",
                d.vencimiento || d.vencimiento_raw || "",
                d.impide_pago ? "Sí" : "No",
                d.impide_acceso ? "Sí" : "No",
              ]);
            }
          }
          
          // Hoja Vencidos
          const headersVenc = ["Dominio", "Marca/Modelo", "Contratista", "Documento", "Vencimiento", "Días vencido"];
          const filasVenc = [];
          const hoy = new Date();
          for (const v of vehiculosConStats) {
            for (const d of v.docsVencidos) {
              const dias = Math.floor((hoy - new Date(d.vencimiento)) / (1000 * 60 * 60 * 24));
              filasVenc.push([
                v.dominio || "",
                `${v.marca || ""} ${v.modelo || ""}`.trim(),
                v.contratista || "",
                d.documento,
                d.vencimiento,
                dias,
              ]);
            }
          }
          
          descargarExcelMultihoja([
            { nombre: "Resumen", datos: [headersRes, ...filasRes] },
            { nombre: "Docs Detalle", datos: [headersDoc, ...filasDoc] },
            { nombre: "Vencidos", datos: [headersVenc, ...filasVenc] },
          ], "Vehiculos");
        }} disabled={vehiculos.length === 0} />
      </div>

      {/* KPIs filtrables */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setFiltroSemaforo("todos")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "todos" ? "#1a3a6b" : "#fff",
          color: filtroSemaforo === "todos" ? "#fff" : "#1a3a6b",
          border: "1px solid #1a3a6b",
        }}>Todos ({statsGlobales.total})</button>
        <button onClick={() => setFiltroSemaforo("verde")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "verde" ? "#16a34a" : "#dcfce7",
          color: filtroSemaforo === "verde" ? "#fff" : "#166534",
          border: "1px solid #16a34a",
        }}>✓ 100% ({statsGlobales.verdes})</button>
        <button onClick={() => setFiltroSemaforo("amarillo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "amarillo" ? "#f59e0b" : "#fef3c7",
          color: filtroSemaforo === "amarillo" ? "#fff" : "#92400e",
          border: "1px solid #f59e0b",
        }}>⚠ 50-99% ({statsGlobales.amarillos})</button>
        <button onClick={() => setFiltroSemaforo("rojo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "rojo" ? "#dc2626" : "#fee2e2",
          color: filtroSemaforo === "rojo" ? "#fff" : "#991b1b",
          border: "1px solid #dc2626",
        }}>✗ &lt;50% ({statsGlobales.rojos})</button>
        {statsGlobales.grises > 0 && (
          <button onClick={() => setFiltroSemaforo("gris")} style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: filtroSemaforo === "gris" ? "#94a3b8" : "#f1f5f9",
            color: filtroSemaforo === "gris" ? "#fff" : "#475569",
            border: "1px solid #cbd5e1",
          }}>Sin docs ({statsGlobales.grises})</button>
        )}
        {statsGlobales.conVencidos > 0 && (
          <div style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5",
          }}>
            ⛔ {statsGlobales.conVencidos} vehículos con docs vencidos
          </div>
        )}
        {statsGlobales.totalPendientes > 0 && (
          <div style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "#fef3c7", color: "#92400e", border: "1px solid #fbbf24",
          }}>
            ⚠ {statsGlobales.totalPendientes} pendientes
          </div>
        )}
      </div>

      {/* Filtros adicionales */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Buscar dominio, marca, modelo, contratista, motor, chasis..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, flex: 1, minWidth: 250 }}
        />
        <select
          value={filtroContratista}
          onChange={e => setFiltroContratista(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, minWidth: 180 }}
        >
          <option value="todos">Todos los contratistas ({contratistasUnicos.length})</option>
          {contratistasUnicos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {energiasUnicas.length > 1 && (
          <select
            value={filtroEnergia}
            onChange={e => setFiltroEnergia(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11 }}
          >
            <option value="todos">Toda energía</option>
            {energiasUnicas.map(en => <option key={en} value={en}>{en}</option>)}
          </select>
        )}
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Mostrando: <strong>{vehiculosFiltrados.length}</strong> / {vehiculos.length}
        </span>
      </div>

      {/* Tabla principal */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#1a3a6b", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, width: 30 }}></th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Vehículo</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Contratista / Planta</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Tipo / Energía</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Cumplim.</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Pendientes</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Vencen ≤30d</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Vencidos</th>
            </tr>
          </thead>
          <tbody>
            {vehiculosFiltrados.map((v, i) => {
              const expandido = expandidoToken === v.token_certronic;
              return (
                <Fragment key={v.token_certronic}>
                  <tr 
                    onClick={() => setExpandidoToken(expandido ? null : v.token_certronic)}
                    style={{ 
                      borderTop: "1px solid #f1f5f9", 
                      background: expandido ? "#eff6ff" : (v.docsVencidos.length > 0 ? "#fef2f2" : (i % 2 === 0 ? "#fff" : "#fafbfc")),
                      cursor: "pointer",
                    }}>
                    <td style={{ padding: "8px", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
                      {expandido ? "▼" : "▶"}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontWeight: 700, color: "#1f2937", fontSize: 12 }}>
                        {v.dominio || "(sin dominio)"}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                        {v.marca || "—"} {v.modelo || ""}
                        {v.anio_vehiculo && <span> · {v.anio_vehiculo}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontSize: 11 }}>{v.contratista || "—"}</div>
                      {v.planta && <div style={{ fontSize: 9, color: "#94a3b8" }}>{v.planta}</div>}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.tipo_certificacion && (
                        <div style={{ fontSize: 10, color: "#475569" }}>
                          {v.tipo_certificacion}
                        </div>
                      )}
                      {v.tipo_energia && (
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>
                          {v.tipo_energia}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <span style={{
                        padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: bgSemaforo(v.semaforo), color: colorSemaforo(v.semaforo),
                        whiteSpace: "nowrap", display: "inline-block",
                      }}>
                        {v.cumplenDocs}/{v.totalDocs} ({v.pctDocs}%)
                      </span>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.pendientes.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                          {v.pendientes.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.docsPorVencer.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                          {v.docsPorVencer.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.docsVencidos.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#dc2626", color: "#fff", fontWeight: 700 }}>
                          {v.docsVencidos.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                  </tr>
                  {/* Fila expandida */}
                  {expandido && (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, background: "#f8fafc", borderTop: "1px solid #e4e7ec" }}>
                        <DetalleVehiculo 
                          vehiculo={v}
                          contratos={contratosPorVehiculo.get(v.token_certronic) || []}
                          fmtFecha={fmtFecha}
                          renderCumple={renderCumple}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {vehiculosFiltrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún vehículo coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
        💡 Click en cualquier fila para ver el detalle (docs, vencimientos, contratos). Vehículos con docs vencidos están resaltados en rojo.
      </div>
    </div>
  );
}

// ─── Sub-componente: detalle expandido del vehículo ───────────────
function DetalleVehiculo({ vehiculo, contratos, fmtFecha, renderCumple }) {
  const v = vehiculo;
  
  return (
    <div>
      {/* Datos generales del vehículo */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: 10, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6 }}>
        {v.numero_motor && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Motor:</strong> {v.numero_motor}</div>}
        {v.numero_chasis && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Chasis:</strong> {v.numero_chasis}</div>}
        {v.cia_seguros && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Seguros:</strong> {v.cia_seguros}</div>}
        {v.categoria && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Categoría:</strong> {v.categoria}</div>}
        {v.operacion && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Operación:</strong> {v.operacion}</div>}
        {v.servicio && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Servicio:</strong> {v.servicio}</div>}
        {v.tipo && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Tipo:</strong> {v.tipo}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Columna izquierda: Doc.Vehículo */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            🚗 Documentos del Vehículo ({v.docVeh.length})
          </h4>
          {v.docVeh.length === 0 ? (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin documentos del vehículo</div>
          ) : (
            <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Documento</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Cumple</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Vence</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Pago</th>
                </tr>
              </thead>
              <tbody>
                {v.docVeh.map((d, j) => {
                  const hoy = new Date();
                  const vencido = d.vencimiento && new Date(d.vencimiento) < hoy;
                  return (
                    <tr key={j} style={{ borderTop: "1px solid #f1f5f9", background: vencido ? "#fef2f2" : undefined }}>
                      <td style={{ padding: "4px 6px", fontWeight: 500 }}>
                        {d.documento}
                        {vencido && <span style={{ marginLeft: 4, color: "#dc2626", fontWeight: 700, fontSize: 9 }}>VENCIDO</span>}
                      </td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>{renderCumple(d.cumple)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "center", color: vencido ? "#991b1b" : (d.vencimiento ? "#475569" : "#cbd5e1"), fontWeight: vencido ? 700 : 400 }}>
                        {d.vencimiento ? fmtFecha(d.vencimiento) : (d.vencimiento_raw || "—")}
                      </td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                        {d.impide_pago && <span title="Impide Pago" style={{ color: "#f59e0b", fontSize: 14 }}>🟡</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Columna derecha */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Pendientes */}
          {v.pendientes.length > 0 && (
            <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, padding: 10 }}>
              <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
                ⚠ Pendientes ({v.pendientes.length})
              </h4>
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #fcd34d" }}>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Documento</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Períodos</th>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {v.pendientes.map((p, j) => (
                    <tr key={j} style={{ borderTop: "1px solid #fcd34d" }}>
                      <td style={{ padding: "3px 6px", color: "#78350f" }}>{p.documento}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#92400e", fontWeight: 700 }}>{p.periodos_pendientes || "—"}</td>
                      <td style={{ padding: "3px 6px", color: "#78350f" }}>{p.estado || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Contratos */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
              📑 Contratos ({contratos.length})
            </h4>
            {contratos.length === 0 ? (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin contratos individuales</div>
            ) : (
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Titular / Planta</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Desde</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Hasta</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {contratos.map((c, j) => (
                    <tr key={j} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "3px 6px" }}>
                        <div>{c.contrato_titular}</div>
                        {c.planta && <div style={{ color: "#94a3b8", fontSize: 9 }}>{c.planta}</div>}
                      </td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#64748b" }}>{c.desde_raw || "—"}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#64748b" }}>{c.hasta_raw || "—"}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center" }}>
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 10, fontWeight: 600,
                          background: c.estado === "Activo" ? "#dcfce7" : "#f1f5f9",
                          color: c.estado === "Activo" ? "#166534" : "#64748b",
                        }}>
                          {c.estado || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Doc.Contratista */}
      {v.docCont.length > 0 && (
        <div style={{ marginTop: 14, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            🏢 Documentos del Contratista ({v.docCont.length})
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {v.docCont.map((d, j) => (
              <span key={j} title={d.vencimiento_raw || ""} style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 500,
                background: d.cumple === true ? "#dcfce7" : d.cumple === false ? "#fee2e2" : "#f1f5f9",
                color: d.cumple === true ? "#166534" : d.cumple === false ? "#991b1b" : "#64748b",
                border: d.impide_pago ? "1px solid #f59e0b" : "1px solid transparent",
              }}>
                {d.cumple === true ? "✓" : d.cumple === false ? "✗" : "?"} {d.documento}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD RIESGO RSE — Score de responsabilidad subsidiaria
// ═══════════════════════════════════════════════════════════════
function DashboardRiesgoRSE() {
  const [config, setConfig] = useState(null);
  const [datos, setDatos] = useState({ docsContratista: [], detalles: [], cumplMensual: [], inhabilitados: new Set() });
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  const [editandoPesos, setEditandoPesos] = useState(false);
  const [pesosTemp, setPesosTemp] = useState(null);
  const [motivoEdicion, setMotivoEdicion] = useState("");
  const [guardando, setGuardando] = useState(false);
  
  const [busqueda, setBusqueda] = useState("");
  const [filtroNivel, setFiltroNivel] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("todos"); // todos | activo | inhabilitado
  const [expandidoContr, setExpandidoContr] = useState(null);

  useEffect(() => { cargarTodo(); }, []);

  const cargarTodo = async () => {
    setLoading(true);
    try {
      // 1. Config activa
      const { data: cfg } = await sb.from("certronic_rse_config")
        .select("*").eq("activo", true).limit(1);
      const configActiva = (cfg && cfg[0]) || {
        peso_docs_iniciales: 35, peso_cumpl_mensual: 25, peso_pendientes: 15,
        peso_atraso_f30: 10, peso_inhabilitado: 8, peso_recencia: 7,
        umbral_bajo: 30, umbral_medio: 60, umbral_alto: 80,
      };
      setConfig(configActiva);
      setPesosTemp(configActiva);

      // 2. Snapshot más reciente de docs
      const { data: snap } = await sb.from("certronic_empleados_docs")
        .select("fecha_snapshot")
        .order("fecha_snapshot", { ascending: false }).limit(1);
      const fechaSnap = snap && snap[0] ? snap[0].fecha_snapshot : null;
      setSnapshotUsado(fechaSnap);

      if (!fechaSnap) { setDatos({ docsContratista: [], detalles: [], cumplMensual: [], inhabilitados: new Set() }); setLoading(false); return; }

      // 3. Cargar DOC_CONTRATISTA + MIS_PENDIENTES (paginado)
      let docsContr = [];
      let from = 0;
      while (true) {
        const { data, error } = await sb.from("certronic_empleados_docs")
          .select("token_certronic, origen, documento, cumple, vencimiento, impide_pago")
          .eq("fecha_snapshot", fechaSnap)
          .in("origen", ["DOC_CONTRATISTA", "MIS_PENDIENTES"])
          .range(from, from + 999);
        if (error || !data || data.length === 0) break;
        docsContr = docsContr.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }

      // 4. Mapping token → contratista
      const { data: detalles } = await sb.from("certronic_empleados_detalle")
        .select("token_certronic, contratista, planta")
        .eq("fecha_snapshot", fechaSnap);

      // 5. Cumplimiento mensual histórico (últimos 6 meses)
      const { data: cumplMen } = await sb.from("certronic_certificacion_mensual")
        .select("transporte, anio, mes, pct_avance, pct_retencion, estado_final, recurso_inhabilitado")
        .order("anio", { ascending: false }).order("mes", { ascending: false });

      // 6. Inhabilitados
      const inhabilitadosSet = new Set();
      for (const c of cumplMen || []) {
        if (c.recurso_inhabilitado) inhabilitadosSet.add(c.transporte);
      }

      setDatos({
        docsContratista: docsContr,
        detalles: detalles || [],
        cumplMensual: cumplMen || [],
        inhabilitados: inhabilitadosSet,
      });
    } catch (e) {
      console.error("[RSE] Error cargando:", e);
    }
    setLoading(false);
  };

  // Calcular score por contratista (en base a config y datos)
  const contratistasConScore = useMemo(() => {
    if (!config) return [];
    // Si no hay datos de docs ni de cumpl mensual, no podemos calcular nada
    if (!datos.docsContratista.length && !datos.cumplMensual.length) return [];

    // Mapping token → contratista (de empleados detalle)
    const tokenAContr = new Map();
    const tokenAPlanta = new Map();
    for (const d of datos.detalles) {
      if (d.contratista) tokenAContr.set(d.token_certronic, d.contratista);
      if (d.planta) tokenAPlanta.set(d.token_certronic, d.planta);
    }

    // 🆕 Inicializar porContratista con TODOS los contratistas conocidos
    // (los que están en certificación mensual, aunque no tengan empleados)
    const porContratista = new Map();
    for (const c of datos.cumplMensual) {
      if (!c.transporte) continue;
      if (!porContratista.has(c.transporte)) {
        porContratista.set(c.transporte, {
          contratista: c.transporte,
          planta: null,
          docsIniciales: new Map(),
          pendientes: [],
          tieneEmpleadosScrapeados: false,
        });
      }
    }

    // Agregar los datos de docs cuando los haya
    for (const d of datos.docsContratista) {
      const c = tokenAContr.get(d.token_certronic);
      if (!c) continue;
      if (!porContratista.has(c)) {
        // Edge case: empleado existe pero contratista no figura en certif mensual
        porContratista.set(c, {
          contratista: c,
          planta: tokenAPlanta.get(d.token_certronic) || null,
          docsIniciales: new Map(),
          pendientes: [],
          tieneEmpleadosScrapeados: true,
        });
      }
      const grupo = porContratista.get(c);
      grupo.tieneEmpleadosScrapeados = true;
      if (!grupo.planta) grupo.planta = tokenAPlanta.get(d.token_certronic) || null;
      
      if (d.origen === "DOC_CONTRATISTA") {
        if (!grupo.docsIniciales.has(d.documento)) {
          grupo.docsIniciales.set(d.documento, { cumple: d.cumple, vencimiento: d.vencimiento });
        }
      } else if (d.origen === "MIS_PENDIENTES") {
        grupo.pendientes.push(d);
      }
    }

    // Mapping cumplimiento mensual
    const cumplPorContr = new Map();
    for (const c of datos.cumplMensual) {
      if (!cumplPorContr.has(c.transporte)) cumplPorContr.set(c.transporte, []);
      cumplPorContr.get(c.transporte).push(c);
    }

    // Calcular scores
    const lista = [];
    const totalPesos = config.peso_docs_iniciales + config.peso_cumpl_mensual + config.peso_pendientes 
                     + config.peso_atraso_f30 + config.peso_inhabilitado + config.peso_recencia;
    const factor = totalPesos > 0 ? 100 / totalPesos : 1;

    for (const [contratista, grupo] of porContratista.entries()) {
      // Determinar si el contratista tiene datos para calcular score
      const cumplMen = cumplPorContr.get(contratista) || [];
      
      // 🆕 Agrupar por (anio, mes) — un contratista puede tener varias filas por mes
      // (una por categoría: PC, RyC, SUB). Promediamos el pct_avance del mes.
      const porMes = new Map();
      for (const c of cumplMen) {
        const key = `${c.anio}-${String(c.mes).padStart(2, '0')}`;
        if (!porMes.has(key)) {
          porMes.set(key, { anio: c.anio, mes: c.mes, pcts: [] });
        }
        if (c.pct_avance != null) porMes.get(key).pcts.push(c.pct_avance);
      }
      const cumplMenAgrupado = Array.from(porMes.values())
        .map(g => ({
          anio: g.anio,
          mes: g.mes,
          pct_avance: g.pcts.length > 0 ? g.pcts.reduce((s, x) => s + x, 0) / g.pcts.length : 0,
        }))
        .sort((a, b) => (b.anio - a.anio) || (b.mes - a.mes));  // más reciente primero
      
      const tieneDocsIniciales = grupo.docsIniciales.size > 0;
      const tieneCumplMensual = cumplMenAgrupado.length > 0;
      const sinDatos = !tieneDocsIniciales && !tieneCumplMensual;

      // Factor 1: % docs iniciales (a más cumplimiento, menor riesgo)
      const totalDocs = grupo.docsIniciales.size;
      const cumplenDocs = Array.from(grupo.docsIniciales.values()).filter(v => v.cumple === true).length;
      const pctIniciales = totalDocs > 0 ? cumplenDocs / totalDocs : 0;
      const f1 = tieneDocsIniciales ? (1 - pctIniciales) * config.peso_docs_iniciales : 0;

      // Factor 2: cumplimiento mensual promedio últimos 6 meses
      const ultimos6 = cumplMenAgrupado.slice(0, 6);
      const promPctAvance = ultimos6.length > 0
        ? ultimos6.reduce((s, c) => s + (c.pct_avance || 0), 0) / ultimos6.length / 100
        : 0;
      const f2 = tieneCumplMensual ? (1 - promPctAvance) * config.peso_cumpl_mensual : 0;

      // Factor 3: cantidad de pendientes acumulados (max 10 = peso completo)
      const f3 = Math.min(1, grupo.pendientes.length / 10) * config.peso_pendientes;

      // Factor 4: atraso F30 (basado en pendientes que mencionan F30)
      const f30Pendientes = grupo.pendientes.filter(p => 
        (p.documento || "").includes("F30") || (p.documento || "").toLowerCase().includes("cotiz")
      ).reduce((s, p) => s + (p.periodos_pendientes || 1), 0);
      const f4 = Math.min(1, f30Pendientes / 6) * config.peso_atraso_f30;

      // Factor 5: estuvo inhabilitado en algún momento
      const estuvoInhabilitado = datos.inhabilitados.has(contratista);
      const f5 = (estuvoInhabilitado ? 1 : 0) * config.peso_inhabilitado;

      // Factor 6: recencia del último doc OK (si hay muchos docs vencidos hace tiempo, suma riesgo)
      const hoy = new Date();
      const docsVencidos = Array.from(grupo.docsIniciales.values())
        .filter(v => v.vencimiento && new Date(v.vencimiento) < hoy).length;
      const f6 = totalDocs > 0 ? (docsVencidos / totalDocs) * config.peso_recencia : 0;

      // Score final 0-100
      const sumaFactores = f1 + f2 + f3 + f4 + f5 + f6;
      const score = Math.min(100, Math.round(sumaFactores * factor));

      // Determinar nivel
      let nivel, colorNivel, bgNivel;
      if (sinDatos) { nivel = "SIN DATOS"; colorNivel = "#64748b"; bgNivel = "#f1f5f9"; }
      else if (score < config.umbral_bajo) { nivel = "BAJO"; colorNivel = "#16a34a"; bgNivel = "#dcfce7"; }
      else if (score < config.umbral_medio) { nivel = "MEDIO"; colorNivel = "#f59e0b"; bgNivel = "#fef3c7"; }
      else if (score < config.umbral_alto) { nivel = "ALTO"; colorNivel = "#dc2626"; bgNivel = "#fee2e2"; }
      else { nivel = "CRÍTICO"; colorNivel = "#7f1d1d"; bgNivel = "#fecaca"; }

      // Empleados activos del contratista (cuenta de los que tienen ficha)
      const empleadosActivos = datos.detalles.filter(d => d.contratista === contratista).length;

      lista.push({
        contratista,
        planta: grupo.planta,
        score: sinDatos ? null : score,
        nivel, colorNivel, bgNivel,
        sinDatos,
        tieneDocsIniciales,
        tieneCumplMensual,
        // Detalle de factores
        factores: {
          docsIniciales: { val: pctIniciales, peso: config.peso_docs_iniciales, contrib: Math.round(f1 * factor), label: "Docs iniciales" },
          cumplMensual: { val: promPctAvance, peso: config.peso_cumpl_mensual, contrib: Math.round(f2 * factor), label: "Cumplim. mensual 6m" },
          pendientes: { val: grupo.pendientes.length, peso: config.peso_pendientes, contrib: Math.round(f3 * factor), label: "Pendientes acumulados" },
          atrasoF30: { val: f30Pendientes, peso: config.peso_atraso_f30, contrib: Math.round(f4 * factor), label: "Atraso F30/cotizaciones" },
          inhabilitado: { val: estuvoInhabilitado, peso: config.peso_inhabilitado, contrib: Math.round(f5 * factor), label: "Inhabilitado histórico" },
          recencia: { val: docsVencidos, peso: config.peso_recencia, contrib: Math.round(f6 * factor), label: "Docs vencidos" },
        },
        empleadosActivos,
        estaInhabilitado: estuvoInhabilitado,
        pctIniciales: Math.round(pctIniciales * 100),
        pctMensual: Math.round(promPctAvance * 100),
        pendientes: grupo.pendientes.length,
        docsCriticosFaltantes: Array.from(grupo.docsIniciales.entries())
          .filter(([_, v]) => v.cumple === false)
          .map(([nombre]) => nombre),
        cumplMen6m: ultimos6,
      });
    }

    // Ordenar: con score primero (de mayor a menor), sin datos al final
    lista.sort((a, b) => {
      if (a.sinDatos && !b.sinDatos) return 1;
      if (!a.sinDatos && b.sinDatos) return -1;
      if (a.sinDatos && b.sinDatos) return a.contratista.localeCompare(b.contratista);
      return (b.score || 0) - (a.score || 0);
    });
    return lista;
  }, [datos, config]);

  // Filtros
  const filtrados = useMemo(() => {
    let r = contratistasConScore;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(c => c.contratista.toLowerCase().includes(q));
    }
    if (filtroNivel !== "todos") {
      r = r.filter(c => c.nivel === filtroNivel);
    }
    if (filtroEstado === "activo") {
      r = r.filter(c => !c.estaInhabilitado);
    } else if (filtroEstado === "inhabilitado") {
      r = r.filter(c => c.estaInhabilitado);
    }
    return r;
  }, [contratistasConScore, busqueda, filtroNivel, filtroEstado]);

  const stats = useMemo(() => ({
    total: contratistasConScore.length,
    bajo: contratistasConScore.filter(c => c.nivel === "BAJO").length,
    medio: contratistasConScore.filter(c => c.nivel === "MEDIO").length,
    alto: contratistasConScore.filter(c => c.nivel === "ALTO").length,
    critico: contratistasConScore.filter(c => c.nivel === "CRÍTICO").length,
    sinDatos: contratistasConScore.filter(c => c.sinDatos).length,
    activos: contratistasConScore.filter(c => !c.estaInhabilitado).length,
    inhab: contratistasConScore.filter(c => c.estaInhabilitado).length,
  }), [contratistasConScore]);

  // Validación de pesos editados
  const sumaPesos = pesosTemp ? (
    pesosTemp.peso_docs_iniciales + pesosTemp.peso_cumpl_mensual + pesosTemp.peso_pendientes +
    pesosTemp.peso_atraso_f30 + pesosTemp.peso_inhabilitado + pesosTemp.peso_recencia
  ) : 100;

  const guardarPesos = async () => {
    if (sumaPesos !== 100) { alert(`Los pesos deben sumar 100. Actualmente suman ${sumaPesos}.`); return; }
    if (!motivoEdicion.trim()) { alert("Indicá un motivo del cambio (para auditoría)"); return; }
    setGuardando(true);
    try {
      // Desactivar config anterior
      await sb.from("certronic_rse_config").update({ activo: false }).eq("activo", true);
      // Insertar nueva
      const { error } = await sb.from("certronic_rse_config").insert({
        peso_docs_iniciales: pesosTemp.peso_docs_iniciales,
        peso_cumpl_mensual: pesosTemp.peso_cumpl_mensual,
        peso_pendientes: pesosTemp.peso_pendientes,
        peso_atraso_f30: pesosTemp.peso_atraso_f30,
        peso_inhabilitado: pesosTemp.peso_inhabilitado,
        peso_recencia: pesosTemp.peso_recencia,
        umbral_bajo: pesosTemp.umbral_bajo,
        umbral_medio: pesosTemp.umbral_medio,
        umbral_alto: pesosTemp.umbral_alto,
        motivo_cambio: motivoEdicion,
        editado_por: 'analista',
        activo: true,
      });
      if (error) { alert("Error guardando: " + error.message); setGuardando(false); return; }
      setConfig(pesosTemp);
      setEditandoPesos(false);
      setMotivoEdicion("");
    } catch (e) {
      alert("Error: " + e.message);
    }
    setGuardando(false);
  };

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Calculando scores de riesgo...</div>;
  if (!contratistasConScore.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos para calcular riesgo. Esperá al próximo run del scraper.
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1a3a6b" }}>
            🛡️ Riesgo RSE — Responsabilidad Subsidiaria
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {contratistasConScore.length} contratistas evaluados · Snapshot: {snapshotUsado || "—"} · 
            Score 0-100 (mayor = más riesgo de generar pasivo legal)
          </div>
        </div>
        <button onClick={() => setEditandoPesos(!editandoPesos)} style={{
          padding: "7px 14px", background: editandoPesos ? "#dc2626" : "#1a3a6b", color: "#fff",
          border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
        }}>
          {editandoPesos ? "Cancelar" : "⚙ Ajustar pesos"}
        </button>
      </div>

      {/* Panel de edición de pesos */}
      {editandoPesos && pesosTemp && (
        <div style={{ background: "#f8fafc", border: "1px solid #1a3a6b", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>
            Pesos del algoritmo (deben sumar 100)
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
            {[
              { key: "peso_docs_iniciales", label: "Docs iniciales del contratista" },
              { key: "peso_cumpl_mensual", label: "Cumplimiento mensual 6m" },
              { key: "peso_pendientes", label: "Pendientes acumulados" },
              { key: "peso_atraso_f30", label: "Atraso F30/cotizaciones" },
              { key: "peso_inhabilitado", label: "Inhabilitado histórico" },
              { key: "peso_recencia", label: "Docs vencidos" },
            ].map(p => (
              <div key={p.key} style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{p.label}</div>
                <input type="number" min="0" max="100" value={pesosTemp[p.key]}
                  onChange={e => setPesosTemp({ ...pesosTemp, [p.key]: parseInt(e.target.value) || 0 })}
                  style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
                <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8" }}>%</span>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 10, padding: "6px 10px", background: sumaPesos === 100 ? "#dcfce7" : "#fee2e2", borderRadius: 4, fontSize: 11, fontWeight: 700, color: sumaPesos === 100 ? "#166534" : "#991b1b" }}>
            Suma actual: {sumaPesos} {sumaPesos === 100 ? "✓" : `(falta ${100 - sumaPesos > 0 ? (100 - sumaPesos) : ""}, sobra ${100 - sumaPesos < 0 ? (sumaPesos - 100) : ""})`}
          </div>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 10, marginTop: 14 }}>
            Umbrales del semáforo
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
            <div style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
              <div style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, marginBottom: 3 }}>BAJO  ≤  X</div>
              <input type="number" min="1" max="99" value={pesosTemp.umbral_bajo}
                onChange={e => setPesosTemp({ ...pesosTemp, umbral_bajo: parseInt(e.target.value) || 0 })}
                style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
            </div>
            <div style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
              <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 3 }}>MEDIO  ≤  X</div>
              <input type="number" min="1" max="99" value={pesosTemp.umbral_medio}
                onChange={e => setPesosTemp({ ...pesosTemp, umbral_medio: parseInt(e.target.value) || 0 })}
                style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
            </div>
            <div style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
              <div style={{ fontSize: 10, color: "#dc2626", fontWeight: 700, marginBottom: 3 }}>ALTO  ≤  X · CRÍTICO  &gt;  X</div>
              <input type="number" min="1" max="99" value={pesosTemp.umbral_alto}
                onChange={e => setPesosTemp({ ...pesosTemp, umbral_alto: parseInt(e.target.value) || 0 })}
                style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
            </div>
          </div>
          <textarea
            placeholder="Motivo del cambio (queda en auditoría)..."
            value={motivoEdicion}
            onChange={e => setMotivoEdicion(e.target.value)}
            style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11, fontFamily: "Geist", resize: "vertical", minHeight: 50, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={guardarPesos} disabled={guardando || sumaPesos !== 100 || !motivoEdicion.trim()} style={{
              padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6,
              fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: (guardando || sumaPesos !== 100 || !motivoEdicion.trim()) ? 0.5 : 1,
            }}>
              {guardando ? "Guardando..." : "✓ Guardar y recalcular"}
            </button>
            <button onClick={() => { setPesosTemp(config); setMotivoEdicion(""); }} style={{
              padding: "8px 16px", background: "#fff", color: "#64748b", border: "1px solid #cbd5e1", borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              Restaurar
            </button>
          </div>
        </div>
      )}

      {/* KPIs filtrables */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setFiltroNivel("todos")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "todos" ? "#1a3a6b" : "#fff",
          color: filtroNivel === "todos" ? "#fff" : "#1a3a6b",
          border: "1px solid #1a3a6b",
        }}>Todos ({stats.total})</button>
        <button onClick={() => setFiltroNivel("BAJO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "BAJO" ? "#16a34a" : "#dcfce7", color: filtroNivel === "BAJO" ? "#fff" : "#166534",
          border: "1px solid #16a34a",
        }}>🟢 Bajo ({stats.bajo})</button>
        <button onClick={() => setFiltroNivel("MEDIO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "MEDIO" ? "#f59e0b" : "#fef3c7", color: filtroNivel === "MEDIO" ? "#fff" : "#92400e",
          border: "1px solid #f59e0b",
        }}>🟡 Medio ({stats.medio})</button>
        <button onClick={() => setFiltroNivel("ALTO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "ALTO" ? "#dc2626" : "#fee2e2", color: filtroNivel === "ALTO" ? "#fff" : "#991b1b",
          border: "1px solid #dc2626",
        }}>🔴 Alto ({stats.alto})</button>
        <button onClick={() => setFiltroNivel("CRÍTICO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
          background: filtroNivel === "CRÍTICO" ? "#7f1d1d" : "#fecaca", color: filtroNivel === "CRÍTICO" ? "#fff" : "#7f1d1d",
          border: "1px solid #7f1d1d",
        }}>⚫ Crítico ({stats.critico})</button>
        {stats.sinDatos > 0 && (
          <button onClick={() => setFiltroNivel("SIN DATOS")} style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: filtroNivel === "SIN DATOS" ? "#64748b" : "#f1f5f9", color: filtroNivel === "SIN DATOS" ? "#fff" : "#475569",
            border: "1px solid #cbd5e1",
          }}>○ Sin datos ({stats.sinDatos})</button>
        )}
      </div>

      {/* Filtros adicionales */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Buscar contratista..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, flex: 1 }}
        />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11 }}>
          <option value="todos">Todos ({stats.total})</option>
          <option value="activo">Solo activos ({stats.activos})</option>
          <option value="inhabilitado">Solo inhabilitados ({stats.inhab})</option>
        </select>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Mostrando: <strong>{filtrados.length}</strong>
        </span>
        <BotonDescargarExcel onClick={() => {
          const headers = ["Contratista", "Score", "Nivel", "Estado", "Empleados Activos", "% Docs Iniciales", "% Cumpl. Mensual", "Pendientes", "F30 atrasado", "Inhabilitado", "Docs Vencidos", "Docs Críticos Faltantes"];
          const filas = contratistasConScore.map(c => [
            c.contratista,
            c.score,
            c.nivel,
            c.estaInhabilitado ? "Inhabilitado" : "Activo",
            c.empleadosActivos,
            c.pctIniciales + "%",
            c.pctMensual + "%",
            c.pendientes,
            c.factores.atrasoF30.val,
            c.factores.inhabilitado.val ? "Sí" : "No",
            c.factores.recencia.val,
            c.docsCriticosFaltantes.join(" | "),
          ]);
          descargarExcelMultihoja([
            { nombre: "Riesgo RSE", datos: [headers, ...filas] },
          ], "Riesgo_RSE");
        }} disabled={contratistasConScore.length === 0} />
      </div>

      {/* Tabla principal */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#1a3a6b", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "center", width: 30 }}></th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, width: 80 }}>Score</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Contratista</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Empleados</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>% Iniciales</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>% Mensual 6m</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Pendientes</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((c, i) => {
              const expandido = expandidoContr === c.contratista;
              return (
                <Fragment key={c.contratista}>
                  <tr 
                    onClick={() => setExpandidoContr(expandido ? null : c.contratista)}
                    style={{ 
                      borderTop: "1px solid #f1f5f9", 
                      background: c.bgNivel,
                      cursor: "pointer",
                    }}>
                    <td style={{ padding: "8px", textAlign: "center", color: "#64748b", fontSize: 14 }}>
                      {expandido ? "▼" : "▶"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <div style={{ 
                        display: "inline-block", padding: "6px 12px", borderRadius: 6,
                        background: c.colorNivel, color: "#fff", fontWeight: 800, fontSize: 14, minWidth: 50,
                      }}>
                        {c.sinDatos ? "—" : c.score}
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontWeight: 600, color: "#1f2937" }}>{c.contratista}</div>
                      <div style={{ fontSize: 9, marginTop: 2 }}>
                        <span style={{ padding: "1px 6px", borderRadius: 4, background: c.colorNivel, color: "#fff", fontWeight: 700 }}>
                          {c.nivel}
                        </span>
                        {c.planta && <span style={{ marginLeft: 6, color: "#64748b" }}>{c.planta}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", fontWeight: 600 }}>{c.empleadosActivos}</td>
                    <td style={{ padding: "8px", textAlign: "center", color: c.pctIniciales < 70 ? "#dc2626" : "#475569", fontWeight: c.pctIniciales < 70 ? 700 : 400 }}>
                      {c.pctIniciales}%
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", color: c.pctMensual < 80 ? "#dc2626" : "#475569" }}>
                      {c.pctMensual}%
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {c.pendientes > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 700 }}>
                          {c.pendientes}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {c.estaInhabilitado ? (
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#fee2e2", color: "#991b1b", fontWeight: 700 }}>
                          INHABILITADO
                        </span>
                      ) : (
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>
                          ACTIVO
                        </span>
                      )}
                    </td>
                  </tr>
                  {expandido && (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, background: "#f8fafc", borderTop: "1px solid #e4e7ec" }}>
                        <DetalleRiesgoRSE contratista={c} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filtrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún contratista coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 4, fontSize: 11, color: "#075985" }}>
        <strong>💡 ¿Qué significa cada nivel?</strong>
        <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
          <li><strong style={{ color: "#16a34a" }}>BAJO ({"<"}{config.umbral_bajo}):</strong> Cumple sus obligaciones. Riesgo legal mínimo para Bigticket.</li>
          <li><strong style={{ color: "#f59e0b" }}>MEDIO ({config.umbral_bajo}-{config.umbral_medio}):</strong> Algunas observaciones. Hacer seguimiento.</li>
          <li><strong style={{ color: "#dc2626" }}>ALTO ({config.umbral_medio}-{config.umbral_alto}):</strong> Genera retraso constante. Posible exposición legal. Reunión de gestión.</li>
          <li><strong style={{ color: "#7f1d1d" }}>CRÍTICO ({">"}{config.umbral_alto}):</strong> Alta probabilidad de generar pasivo legal. Escalar a gerencia.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Sub-componente: detalle del contratista en RSE ───────────────
function DetalleRiesgoRSE({ contratista }) {
  const c = contratista;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Desglose del score */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            🔍 Desglose del score ({c.score}/100)
          </h4>
          <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Factor</th>
                <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Peso</th>
                <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Aporta</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(c.factores).map(([k, f]) => (
                <tr key={k} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "4px 6px", fontWeight: 500 }}>{f.label}</td>
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#94a3b8" }}>{f.peso}%</td>
                  <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: f.contrib > 10 ? "#dc2626" : f.contrib > 5 ? "#f59e0b" : "#16a34a" }}>
                    +{f.contrib}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #1a3a6b" }}>
                <td colSpan={2} style={{ padding: "6px", fontWeight: 700, color: "#1a3a6b" }}>SCORE FINAL</td>
                <td style={{ padding: "6px", textAlign: "center", fontWeight: 800, color: c.colorNivel, fontSize: 14 }}>{c.score}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Histórico mensual */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
            📈 Cumplimiento mensual (últimos 6 meses)
          </h4>
          {c.cumplMen6m.length === 0 ? (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin histórico mensual</div>
          ) : (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80, marginTop: 10 }}>
              {[...c.cumplMen6m].reverse().map((m, i) => {
                const altura = Math.round(m.pct_avance || 0);
                const color = altura >= 80 ? "#16a34a" : altura >= 50 ? "#f59e0b" : "#dc2626";
                const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
                const mesIdx = (m.mes && m.mes >= 1 && m.mes <= 12) ? m.mes - 1 : null;
                const labelMes = mesIdx !== null ? `${meses[mesIdx]}-${String(m.anio).slice(2)}` : "?";
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div title={`${labelMes}: ${altura}%`} style={{ width: "100%", height: `${Math.max(altura * 0.6, 5)}px`, background: color, borderRadius: 3, transition: "height 0.3s" }} />
                    <div style={{ fontSize: 9, color: "#64748b", fontWeight: 600 }}>{labelMes}</div>
                    <div style={{ fontSize: 8, color: "#94a3b8" }}>{altura}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Docs críticos faltantes */}
      {c.docsCriticosFaltantes.length > 0 && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, padding: 10, marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 8 }}>
            ⚠ Documentos críticos faltantes ({c.docsCriticosFaltantes.length})
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {c.docsCriticosFaltantes.map((doc, i) => (
              <span key={i} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#fff", color: "#991b1b", border: "1px solid #fca5a5", fontWeight: 600 }}>
                ✗ {doc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recomendación */}
      <div style={{ background: c.bgNivel, border: `1px solid ${c.colorNivel}`, borderLeft: `4px solid ${c.colorNivel}`, borderRadius: 6, padding: 10 }}>
        <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: c.colorNivel, marginBottom: 6 }}>
          🎯 Recomendación de acción
        </h4>
        <div style={{ fontSize: 11, color: "#1f2937" }}>
          {c.nivel === "CRÍTICO" && (
            <>Escalar inmediatamente a gerencia. Considerar suspensión preventiva del contratista. {c.empleadosActivos > 0 ? `${c.empleadosActivos} empleados activos exponen a Bigticket a responsabilidad solidaria.` : ""}</>
          )}
          {c.nivel === "ALTO" && (
            <>Reunión urgente de gestión con el contratista. Plan de regularización con plazo de 30 días. Si no cumple, considerar inhabilitación.</>
          )}
          {c.nivel === "MEDIO" && (
            <>Hacer seguimiento mensual. Notificar al contratista los documentos pendientes. Reagendar revisión en 60 días.</>
          )}
          {c.nivel === "BAJO" && (
            <>Sin acción requerida. Monitoreo de rutina.</>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 DASHBOARD HISTÓRICO — Sprint 3 Fase B.2
// 4 sub-tabs: Resumen | Heatmap | Top Deudores | Desaparecidos
// Lee de las vistas: vw_historico_evolucion_contratista,
// vw_deudores_historicos_actuales_resumen, vw_historico_desaparecidos,
// vw_historico_morosos_arrastre
// ═══════════════════════════════════════════════════════════════════════════
function DashboardHistorico({ operacionAMandante }) {
  const [subtab, setSubtab] = useState("resumen");
  const [loading, setLoading] = useState(true);
  const [evolucion, setEvolucion] = useState([]);          // por contratista × período
  const [resumenGeneral, setResumenGeneral] = useState(null); // KPIs globales
  const [deudoresResumen, setDeudoresResumen] = useState([]); // top deudores activos
  const [desaparecidos, setDesaparecidos] = useState([]);
  const [arrastrados, setArrastrados] = useState([]);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Evolución por contratista (todos los registros) - paginado
        let allEvol = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          const { data, error } = await sb.from("vw_historico_evolucion_contratista")
            .select("contratista_norm, contratista, periodo, total_docs, docs_cumplidos, docs_pendientes, pct_cumplimiento, delta_pct_vs_mes_anterior, identificadores_unicos")
            .order("contratista_norm", { ascending: true })
            .order("periodo", { ascending: true })
            .range(from, from + limite - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          allEvol = allEvol.concat(data);
          if (data.length < limite) break;
          from += limite;
        }
        setEvolucion(allEvol);

        // 2) Resumen general del histórico
        const periodosUnicos = [...new Set(allEvol.map(e => e.periodo))].sort();
        const ultPeriodo = periodosUnicos[periodosUnicos.length - 1];
        const primPeriodo = periodosUnicos[0];

        // KPIs globales: total deudas y personas (de la vista resumen)
        const { count: totalDeudas } = await sb.from("vw_deudores_historicos_actuales")
          .select("*", { count: "exact", head: true });
        const { count: totalPersonas } = await sb.from("vw_deudores_historicos_actuales_resumen")
          .select("*", { count: "exact", head: true });

        // % cumplimiento promedio por período (de evolucion)
        const promedioPorPeriodo = {};
        for (const p of periodosUnicos) {
          const delPeriodo = allEvol.filter(e => e.periodo === p);
          const sumDocs = delPeriodo.reduce((a, b) => a + (b.total_docs || 0), 0);
          const sumCumple = delPeriodo.reduce((a, b) => a + (b.docs_cumplidos || 0), 0);
          promedioPorPeriodo[p] = sumDocs > 0 ? (sumCumple / sumDocs * 100) : 0;
        }

        setResumenGeneral({
          totalPeriodos: periodosUnicos.length,
          primerPeriodo: primPeriodo,
          ultimoPeriodo: ultPeriodo,
          totalDeudas: totalDeudas || 0,
          totalPersonas: totalPersonas || 0,
          contratistasUnicos: new Set(allEvol.map(e => e.contratista_norm)).size,
          promedioPorPeriodo,
        });

        // 3) Top deudores (resumen)
        let allDeudores = [];
        from = 0;
        while (true) {
          const { data } = await sb.from("vw_deudores_historicos_actuales_resumen")
            .select("identificador, rut, contratista, detalle, total_deudas, meses_con_deuda, docs_distintos_adeudados, deuda_mas_antigua, deuda_mas_reciente")
            .order("total_deudas", { ascending: false })
            .range(from, from + limite - 1);
          if (!data || data.length === 0) break;
          allDeudores = allDeudores.concat(data);
          if (data.length < limite) break;
          from += limite;
        }
        setDeudoresResumen(allDeudores);

        // 4) Desaparecidos
        const { data: desapData } = await sb.from("vw_historico_desaparecidos")
          .select("identificador, rut, contratista, detalle, entidad, ultimo_periodo_visto, docs_totales_ultimo_mes, docs_pendientes_al_irse, meses_presentes")
          .order("docs_pendientes_al_irse", { ascending: false })
          .limit(500);
        setDesaparecidos(desapData || []);

        // 5) Morosos arrastrados (los que llevan más meses)
        const { data: arrData } = await sb.from("vw_historico_morosos_arrastre")
          .select("contratista, detalle, documento, pendiente_desde, pendiente_hasta, meses_pendiente, sigue_pendiente_en_ultimo")
          .order("meses_pendiente", { ascending: false })
          .limit(500);
        setArrastrados(arrData || []);

      } catch (e) {
        console.error("[Historico] Error:", e);
      }
      setLoading(false);
    })();
  }, []);

  // Construir matriz para heatmap: contratista × período → pct
  const heatmapData = useMemo(() => {
    if (!evolucion.length) return { contratistas: [], periodos: [], celdas: {} };
    const periodos = [...new Set(evolucion.map(e => e.periodo))].sort();
    const contratistasMap = new Map();
    for (const e of evolucion) {
      const key = e.contratista_norm;
      if (!contratistasMap.has(key)) {
        contratistasMap.set(key, {
          contratista_norm: key,
          contratista: e.contratista,
          promedio: 0,
          totalDocs: 0,
          totalCumple: 0,
        });
      }
      const c = contratistasMap.get(key);
      c.totalDocs += (e.total_docs || 0);
      c.totalCumple += (e.docs_cumplidos || 0);
    }
    // Calcular promedio
    for (const [k, c] of contratistasMap.entries()) {
      c.promedio = c.totalDocs > 0 ? (c.totalCumple / c.totalDocs * 100) : 0;
    }
    // Celdas: { "contratista_norm|periodo": { pct, total, pendientes, delta } }
    const celdas = {};
    for (const e of evolucion) {
      celdas[`${e.contratista_norm}|${e.periodo}`] = {
        pct: parseFloat(e.pct_cumplimiento) || 0,
        total: e.total_docs || 0,
        pendientes: e.docs_pendientes || 0,
        delta: e.delta_pct_vs_mes_anterior != null ? parseFloat(e.delta_pct_vs_mes_anterior) : null,
      };
    }
    const contratistas = [...contratistasMap.values()].sort((a, b) => a.promedio - b.promedio);
    return { contratistas, periodos, celdas };
  }, [evolucion]);

  // Filtrar heatmap por búsqueda
  const heatmapFiltrado = useMemo(() => {
    if (!busqueda) return heatmapData.contratistas;
    const q = busqueda.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return heatmapData.contratistas.filter(c =>
      (c.contratista || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").includes(q)
    );
  }, [heatmapData.contratistas, busqueda]);

  // Top movers (mayor delta + y -) en el último período disponible
  const topMovers = useMemo(() => {
    if (!evolucion.length) return { mejoraron: [], empeoraron: [] };
    const periodos = [...new Set(evolucion.map(e => e.periodo))].sort();
    const ultimo = periodos[periodos.length - 1];
    const conDelta = evolucion.filter(e => e.periodo === ultimo && e.delta_pct_vs_mes_anterior != null);
    const mejoraron = [...conDelta].sort((a, b) =>
      parseFloat(b.delta_pct_vs_mes_anterior) - parseFloat(a.delta_pct_vs_mes_anterior)
    ).slice(0, 10);
    const empeoraron = [...conDelta].sort((a, b) =>
      parseFloat(a.delta_pct_vs_mes_anterior) - parseFloat(b.delta_pct_vs_mes_anterior)
    ).slice(0, 10);
    return { mejoraron, empeoraron, ultimo };
  }, [evolucion]);

  const fmtPeriodo = (p) => p ? p.substring(0, 7) : "—";

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando datos históricos...</div>;
  }

  const subTabs = [
    { id: "resumen", label: "📈 Resumen", desc: "KPIs globales + tendencia" },
    { id: "heatmap", label: "🔥 Heatmap", desc: "Contratistas × meses" },
    { id: "deudores", label: "🚨 Top Deudores", desc: "Activos con deudas históricas" },
    { id: "desaparecidos", label: "👻 Desaparecidos", desc: "Pasaron y ya no están" },
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b", marginBottom: 8 }}>
          📊 Análisis Histórico
        </div>
        <div style={{ display: "flex", gap: 0, flexWrap: "wrap", borderBottom: "1px solid #e4e7ec" }}>
          {subTabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                background: "transparent", border: "none", padding: "8px 14px",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                color: subtab === t.id ? "#1a3a6b" : "#64748b",
                borderBottom: subtab === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
                marginBottom: -1,
              }}>
              <div>{t.label}</div>
              <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 400, marginTop: 1 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 16px 20px" }}>

        {/* ───── SUB-TAB: RESUMEN ───── */}
        {subtab === "resumen" && resumenGeneral && (
          <div>
            {/* Bloque info */}
            <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#312e81" }}>
              <strong>Histórico de {resumenGeneral.primerPeriodo?.substring(0,7)} a {resumenGeneral.ultimoPeriodo?.substring(0,7)}</strong> ·
              Capturado el 2026-05-08 · {resumenGeneral.totalPeriodos} períodos cargados
            </div>

            {/* KPIs grandes */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Períodos cargados</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#1a3a6b", marginTop: 4 }}>{resumenGeneral.totalPeriodos}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Contratistas en histórico</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#1a3a6b", marginTop: 4 }}>{resumenGeneral.contratistasUnicos}</div>
              </div>
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#9a3412", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Deudas históricas activas</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#9a3412", marginTop: 4 }}>{resumenGeneral.totalDeudas.toLocaleString("es-CL")}</div>
              </div>
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#9a3412", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Personas con deuda</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#9a3412", marginTop: 4 }}>{resumenGeneral.totalPersonas.toLocaleString("es-CL")}</div>
              </div>
              <div style={{ background: "#f3e8ff", border: "1px solid #d8b4fe", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#6b21a8", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Desaparecidos en histórico</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#6b21a8", marginTop: 4 }}>{desaparecidos.length}</div>
              </div>
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Docs crónicamente pendientes</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#991b1b", marginTop: 4 }}>{arrastrados.filter(a => a.meses_pendiente >= 3).length}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>≥ 3 meses sin resolver</div>
              </div>
            </div>

            {/* Gráfico tendencia global */}
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>
                Evolución del cumplimiento global
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 140, padding: "0 20px" }}>
                {Object.entries(resumenGeneral.promedioPorPeriodo).map(([periodo, pct], i, arr) => {
                  const altura = Math.max(8, (pct / 100) * 120);
                  const color = pct >= 85 ? "#16a34a" : pct >= 70 ? "#f59e0b" : "#dc2626";
                  const prev = i > 0 ? arr[i-1][1] : null;
                  const delta = prev != null ? pct - prev : null;
                  return (
                    <div key={periodo} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color }}>{pct.toFixed(1)}%</div>
                      {delta != null && (
                        <div style={{ fontSize: 10, fontWeight: 600, color: delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#94a3b8" }}>
                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}
                        </div>
                      )}
                      <div style={{ width: "70%", height: altura, background: color, borderRadius: "4px 4px 0 0" }} />
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{periodo.substring(0,7)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top mejoraron / empeoraron */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 8 }}>
                  ▲ Top 10 mejoraron ({topMovers.ultimo?.substring(0,7) || "—"})
                </div>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>%</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMovers.mejoraron.map((m, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "3px 6px", fontWeight: 500 }}>{(m.contratista || "—").substring(0, 38)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right" }}>{parseFloat(m.pct_cumplimiento).toFixed(1)}%</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", color: "#16a34a", fontWeight: 700 }}>
                          +{parseFloat(m.delta_pct_vs_mes_anterior).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 8 }}>
                  ▼ Top 10 empeoraron ({topMovers.ultimo?.substring(0,7) || "—"})
                </div>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>%</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMovers.empeoraron.map((m, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "3px 6px", fontWeight: 500 }}>{(m.contratista || "—").substring(0, 38)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right" }}>{parseFloat(m.pct_cumplimiento).toFixed(1)}%</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", color: "#dc2626", fontWeight: 700 }}>
                          {parseFloat(m.delta_pct_vs_mes_anterior).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ───── SUB-TAB: HEATMAP ───── */}
        {subtab === "heatmap" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input type="text" placeholder="Buscar contratista..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ flex: 1, minWidth: 240, padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 4 }} />
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {heatmapFiltrado.length} contratista(s) · ordenados por peor cumplimiento promedio
              </div>
            </div>
            {/* Leyenda */}
            <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 11, color: "#64748b" }}>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#16a34a", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />≥85%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#84cc16", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />70-85%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#f59e0b", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />50-70%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#dc2626", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />&lt;50%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#f1f5f9", borderRadius: 2, marginRight: 4, verticalAlign: "middle", border: "1px solid #cbd5e1" }} />Sin datos</span>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: 600 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#1a3a6b", color: "#fff", zIndex: 2 }}>
                  <tr>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600 }}>Contratista</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Prom.</th>
                    {heatmapData.periodos.map(p => (
                      <th key={p} style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, fontWeight: 600, minWidth: 80 }}>
                        {p.substring(0, 7)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapFiltrado.slice(0, 250).map((c, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "4px 10px", fontWeight: 500, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={c.contratista}>
                        {c.contratista}
                      </td>
                      <td style={{ padding: "4px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                        {c.promedio.toFixed(1)}%
                      </td>
                      {heatmapData.periodos.map(p => {
                        const celda = heatmapData.celdas[`${c.contratista_norm}|${p}`];
                        if (!celda) {
                          return (
                            <td key={p} style={{ padding: 0, textAlign: "center", background: "#f1f5f9", color: "#cbd5e1", fontSize: 10 }}>
                              —
                            </td>
                          );
                        }
                        const color = celda.pct >= 85 ? "#16a34a" : celda.pct >= 70 ? "#84cc16" : celda.pct >= 50 ? "#f59e0b" : "#dc2626";
                        return (
                          <td key={p}
                            title={`${p.substring(0,7)} — ${celda.pct.toFixed(1)}% — ${celda.total} docs · ${celda.pendientes} pendientes${celda.delta != null ? ` · Δ ${celda.delta > 0 ? "+" : ""}${celda.delta.toFixed(1)}` : ""}`}
                            style={{
                              padding: "6px 4px", textAlign: "center",
                              background: color, color: "#fff", fontSize: 10, fontWeight: 700, cursor: "help",
                            }}>
                            {celda.pct.toFixed(0)}%
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {heatmapFiltrado.length > 250 && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, textAlign: "center" }}>
                Mostrando 250 de {heatmapFiltrado.length}. Usá el buscador para filtrar.
              </div>
            )}
          </div>
        )}

        {/* ───── SUB-TAB: TOP DEUDORES ───── */}
        {subtab === "deudores" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input type="text" placeholder="Buscar persona o contratista..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ flex: 1, minWidth: 240, padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 4 }} />
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {deudoresResumen.length} personas activas con deudas históricas
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: 640 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#1a3a6b", color: "#fff", zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Persona/Recurso</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Total deudas</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Meses</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Docs distintos</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Más antigua</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Más reciente</th>
                  </tr>
                </thead>
                <tbody>
                  {deudoresResumen
                    .filter(d => {
                      if (!busqueda) return true;
                      const q = busqueda.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const c = (d.contratista || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const dt = (d.detalle || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      return c.includes(q) || dt.includes(q);
                    })
                    .slice(0, 300)
                    .map((d, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 10px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.contratista}>
                          {(d.contratista || "—").substring(0, 35)}
                        </td>
                        <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right" }}>
                          <span style={{
                            background: d.total_deudas >= 30 ? "#fee2e2" : d.total_deudas >= 10 ? "#fef3c7" : "#f1f5f9",
                            color: d.total_deudas >= 30 ? "#991b1b" : d.total_deudas >= 10 ? "#92400e" : "#475569",
                            padding: "2px 8px", borderRadius: 10, fontWeight: 700, fontSize: 10,
                          }}>
                            {d.total_deudas}
                          </span>
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.meses_con_deuda}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.docs_distintos_adeudados || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, fontFamily: "monospace", color: "#64748b" }}>
                          {d.deuda_mas_antigua ? d.deuda_mas_antigua.substring(0,7) : "—"}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, fontFamily: "monospace", color: "#64748b" }}>
                          {d.deuda_mas_reciente ? d.deuda_mas_reciente.substring(0,7) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───── SUB-TAB: DESAPARECIDOS ───── */}
        {subtab === "desaparecidos" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input type="text" placeholder="Buscar persona o contratista..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ flex: 1, minWidth: 240, padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 4 }} />
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {desaparecidos.length} empleados/vehículos/contratistas que pasaron por el sistema y ya no están
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: 640 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#6b21a8", color: "#fff", zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Quién</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Tipo</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Último mes visto</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Meses presente</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Total docs</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Pendientes al irse</th>
                  </tr>
                </thead>
                <tbody>
                  {desaparecidos
                    .filter(d => {
                      if (!busqueda) return true;
                      const q = busqueda.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const c = (d.contratista || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const dt = (d.detalle || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      return c.includes(q) || dt.includes(q);
                    })
                    .slice(0, 400)
                    .map((d, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 10px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.contratista}>
                          {(d.contratista || "—").substring(0, 35)}
                        </td>
                        <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center" }}>
                          <span style={{
                            fontSize: 9, padding: "1px 6px", borderRadius: 3, fontWeight: 600, textTransform: "uppercase",
                            background: d.entidad === "empleado" ? "#dbeafe" : d.entidad === "vehiculo" ? "#fef3c7" : "#f3e8ff",
                            color: d.entidad === "empleado" ? "#1e40af" : d.entidad === "vehiculo" ? "#92400e" : "#6b21a8",
                          }}>{d.entidad || "—"}</span>
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "#64748b" }}>
                          {d.ultimo_periodo_visto ? d.ultimo_periodo_visto.substring(0,7) : "—"}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.meses_presentes}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.docs_totales_ultimo_mes}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: d.docs_pendientes_al_irse > 0 ? "#991b1b" : "#94a3b8" }}>
                          {d.docs_pendientes_al_irse}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── 🆕 MODAL: Editar override del analista ─────────────────────
function ModalOverride({ contexto, onClose, onGuardar, onQuitar }) {
  const ESTADOS = [
    { v: "VALIDADO", ico: "✓", label: "Validado", color: "#16a34a", bg: "#dcfce7" },
    { v: "RECEPCIONADO", ico: "◐", label: "Recepcionado", color: "#1e40af", bg: "#dbeafe" },
    { v: "ENVIADO", ico: "↗", label: "Enviado", color: "#3730a3", bg: "#e0e7ff" },
    { v: "PENDIENTE", ico: "⏳", label: "Pendiente", color: "#92400e", bg: "#fef3c7" },
    { v: "NO_APLICA", ico: "—", label: "No aplica", color: "#94a3b8", bg: "#f1f5f9" },
  ];
  const tieneOverride = !!contexto.overrideExistente;
  const estadoInicial = tieneOverride ? contexto.overrideExistente.estado_override : (contexto.estadoCertronic || "PENDIENTE");
  const motivoInicial = tieneOverride ? contexto.overrideExistente.motivo : "";
  const fechaInicial = tieneOverride ? contexto.overrideExistente.fecha_cambio : new Date().toISOString().slice(0, 10);
  
  const [estado, setEstado] = useState(estadoInicial);
  const [motivo, setMotivo] = useState(motivoInicial);
  const [fecha, setFecha] = useState(fechaInicial);
  const [guardando, setGuardando] = useState(false);
  
  const estadoCertronicConf = ESTADOS.find(e => e.v === contexto.estadoCertronic) || { ico: "?", label: contexto.estadoCertronic || "—", color: "#64748b", bg: "#f1f5f9" };
  
  const handleGuardar = async () => {
    if (!motivo.trim()) {
      alert("El motivo es obligatorio");
      return;
    }
    if (!fecha) {
      alert("La fecha es obligatoria");
      return;
    }
    setGuardando(true);
    await onGuardar({ estado, motivo, fecha });
    setGuardando(false);
  };
  
  return (
    <div onClick={onClose} style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 8, padding: 0, maxWidth: 520, width: "90%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", background: "#1a3a6b", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {tieneOverride ? "Editar override del analista" : "Editar estado de documento"}
            </div>
            <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>
              Override: NO modifica datos de Certronic
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        
        {/* Body */}
        <div style={{ padding: 18 }}>
          {/* Contexto */}
          <div style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 11 }}>
            <div><strong>Contratista:</strong> {contexto.contratista}</div>
            {contexto.subcontratista && <div><strong>Subcontratista:</strong> {contexto.subcontratista}</div>}
            <div><strong>Documento:</strong> {contexto.docLabel || contexto.docCampo}</div>
            <div><strong>Categoría:</strong> {contexto.categoria}</div>
          </div>
          
          {/* Estado actual de Certronic */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>
              Estado actual en Certronic
            </div>
            <div style={{ 
              padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: estadoCertronicConf.bg, color: estadoCertronicConf.color, display: "inline-block",
            }}>
              {estadoCertronicConf.ico} {estadoCertronicConf.label}
            </div>
            {contexto.fechaSnapshot && (
              <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 8 }}>
                Snapshot: {contexto.fechaSnapshot}
              </span>
            )}
          </div>
          
          {/* Si ya hay override, mostrarlo */}
          {tieneOverride && (
            <div style={{ marginBottom: 14, padding: 10, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "#92400e", fontWeight: 700, marginBottom: 4 }}>
                ● OVERRIDE ACTIVO (editado por analista)
              </div>
              <div style={{ fontSize: 11, color: "#78350f" }}>
                <strong>Motivo actual:</strong> {contexto.overrideExistente.motivo}<br />
                <strong>Fecha:</strong> {contexto.overrideExistente.fecha_cambio} · <strong>Por:</strong> {contexto.overrideExistente.editado_por}
              </div>
            </div>
          )}
          
          {/* Selector de nuevo estado */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, fontWeight: 600, textTransform: "uppercase" }}>
              Nuevo estado
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ESTADOS.map(e => (
                <button key={e.v} onClick={() => setEstado(e.v)} style={{
                  padding: "8px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  background: estado === e.v ? e.bg : "#fff",
                  color: estado === e.v ? e.color : "#475569",
                  border: estado === e.v ? `2px solid ${e.color}` : "1px solid #e4e7ec",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <span style={{ fontSize: 14 }}>{e.ico}</span> {e.label}
                </button>
              ))}
            </div>
          </div>
          
          {/* Motivo (obligatorio) */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>
              Motivo <span style={{ color: "#dc2626" }}>*</span>
            </div>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ej: Documento aprobado por mail el 26-abr, Certronic aún no actualizado"
              rows={3}
              style={{
                width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </div>
          
          {/* Fecha (obligatorio) */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>
              Fecha del cambio <span style={{ color: "#dc2626" }}>*</span>
            </div>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              style={{ padding: 6, borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11 }}
            />
          </div>
          
          {/* Botones */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {tieneOverride && (
              <button onClick={onQuitar} style={{
                padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", marginRight: "auto",
              }}>
                🗑 Quitar override
              </button>
            )}
            <button onClick={onClose} style={{
              padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              background: "#fff", color: "#64748b", border: "1px solid #e4e7ec",
            }}>
              Cancelar
            </button>
            <button onClick={handleGuardar} disabled={guardando} style={{
              padding: "8px 16px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: guardando ? "wait" : "pointer",
              background: "#1a3a6b", color: "#fff", border: "none", opacity: guardando ? 0.6 : 1,
            }}>
              {guardando ? "Guardando..." : (tieneOverride ? "Actualizar override" : "Guardar override")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componente: Dashboard (vista normal de PC/RyC/SUB) ─────────
function DashboardCertificacion({
  datos, kpis, empresasActivasUnicas, empresasInhabilitadasUnicas,
  tabCategoria, setTabCategoria,
  busqueda, setBusqueda,
  filtroEstado, setFiltroEstado, filtroMandante, setFiltroMandante,
  filtroActivo, setFiltroActivo,
  operacionesUnicas, datosCategoriaActual,
  docsPorCategoria, renderIconoDoc, renderEstadoFinal,
  toggleOrden, flecha, operacionAMandante,
  cumplInicial = new Map(),  // 🆕 cumplimiento de docs iniciales por contratista
}) {
  // 🆕 datosTab: muestra TODO siempre, los inhabilitados son ciudadanos completos
  const datosTab = (cat) => datos[cat] || [];

  // 🆕 Modal de detalle: contiene la fila completa o null si está cerrado
  const [modalDetalle, setModalDetalle] = useState(null);
  // Cerrar modal con tecla ESC
  useEffect(() => {
    if (!modalDetalle) return;
    const onKey = (e) => { if (e.key === "Escape") setModalDetalle(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalDetalle]);

  return (
    <>
      {/* KPIs (incluyen TODO: activos + inhabilitados) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KPI 
          label="Total registros" 
          valor={kpis.total} 
          sub={`${(empresasActivasUnicas + empresasInhabilitadasUnicas)} empresas · ${operacionesUnicas.length} mandantes`}
          color="#1a3a6b" />
        <KPI label="% Avance certificación" valor={`${kpis.pctAvance}%`} sub={`${kpis.certificados} certificados`} color="#16a34a" />
        <KPI label="Pendientes" valor={kpis.parciales + kpis.sinCert} sub={`${kpis.parciales} parcial · ${kpis.sinCert} sin cert.`} color="#F47B20" />
        <KPI label="Anomalías" valor={kpis.anomalias} sub={kpis.anomalias > 0 ? "Requieren revisión" : "Todo OK"} color={kpis.anomalias > 0 ? "#c0392b" : "#16a34a"} />
        <KPI 
          label="Inhabilitados" 
          valor={kpis.inhabilitados} 
          sub={`${empresasInhabilitadasUnicas} empresas · resaltadas en tabla`} 
          color="#dc2626" />
      </div>

      {/* Tabs categoría + botón Excel */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, borderBottom: "1px solid #e4e7ec", gap: 12 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "pc", label: "Personal Contratado", n: datosTab("pc").length },
            { id: "ryc", label: "Representante y Conductor", n: datosTab("ryc").length },
            { id: "sub", label: "Subcontratista", n: datosTab("sub").length },
          ].map(t => (
            <button key={t.id} onClick={() => setTabCategoria(t.id)}
              style={{
                padding: "8px 14px", border: "none", cursor: "pointer",
                borderBottom: tabCategoria === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
                background: "transparent", color: tabCategoria === t.id ? "#1a3a6b" : "#666",
                fontWeight: tabCategoria === t.id ? 700 : 500,
                fontSize: 12, fontFamily: "Geist, sans-serif", marginBottom: -1,
              }}>
              {t.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>({t.n})</span>
            </button>
          ))}
        </div>
        <div style={{ paddingBottom: 6 }}>
          <BotonDescargarExcel onClick={() => {
            const labelCat = tabCategoria === "pc" ? "Personal Contratado"
                           : tabCategoria === "ryc" ? "Representante y Conductor"
                           : "Subcontratista";
            const docsDeLaCategoria = docsPorCategoria[tabCategoria] || [];
            const headers = [
              "Operación",
              "Mandante",
              "Transporte",
              ...(tabCategoria === "sub" ? ["Subcontratista"] : []),
              "Empleados Activos",
              "Vehículos Activos",
              ...docsDeLaCategoria.map(d => d.label),
              "% Retención",
              "% Avance",
              "Estado",
              "Inhabilitado",
              "Anomalía",
            ];
            const filas = datosCategoriaActual.map(d => {
              const fila = [
                d.operacion || "",
                operacionAMandante(d.operacion) || "",
                d.transporte || "",
                ...(tabCategoria === "sub" ? [d.subcontratista_nombre || ""] : []),
                d.empleados_activos || 0,
                d.vehiculos_activos || 0,
              ];
              for (const doc of docsDeLaCategoria) {
                const val = d[doc.key];
                fila.push(val || "");
              }
              fila.push(
                d.pct_retencion != null ? d.pct_retencion + "%" : "",
                d.pct_avance != null ? d.pct_avance + "%" : "",
                d.estado_final || "",
                d.recurso_inhabilitado ? "Sí" : "No",
                d.anomalia_descripcion || "",
              );
              return fila;
            });
            
            descargarExcelMultihoja([
              { nombre: labelCat, datos: [headers, ...filas] },
            ], `Dashboard_Mensual_${tabCategoria.toUpperCase()}`);
          }} disabled={datosCategoriaActual.length === 0} />
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px 160px", gap: 8, marginBottom: 12 }}>
        <input 
          placeholder="🔎 Buscar (nombre, RUT, email · sin acentos · busca cualquier parte)" 
          value={busqueda} 
          onChange={(e) => setBusqueda(e.target.value)} 
          title="Buscador inteligente: tolerante a acentos y mayúsculas. Acepta múltiples palabras: 'bastian diaz' encuentra 'Bastian Andres Diaz'."
        />
        <select value={filtroMandante} onChange={(e) => setFiltroMandante(e.target.value)}>
          <option value="todos">Todos los mandantes</option>
          <option value="Mercado Libre">Mercado Libre</option>
          <option value="Falabella">Falabella</option>
          <option value="Rosen">Rosen</option>
          <option value="Cannon">Cannon</option>
          <option value="Esporádicos">Esporádicos</option>
        </select>
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="todos">Todos estados</option>
          <option value="CERTIFICADO">✓ Certificado</option>
          <option value="PENDIENTE">⏳ Parcial</option>
          <option value="NO_CERTIFICADO">✗ Sin certificación</option>
        </select>
        <select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)}>
          <option value="todos">Activos + inhabilitados</option>
          <option value="solo_activos">Solo activos</option>
          <option value="solo_inhabilitados">Solo inhabilitados</option>
        </select>
      </div>

      {datos.pc.length === 0 && datos.ryc.length === 0 && datos.sub.length === 0 ? (
        <div className="empty">
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#64748b" }}>Sin datos para este período</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            Los datos se actualizan automáticamente los lunes y jueves a las 04:00 UTC.
          </div>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 420px)", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, minWidth: tabCategoria === "pc" ? 1300 : 1000 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "#1a3a6b", color: "#fff" }}>
                  <th style={thE} onClick={() => toggleOrden("operacion")}>Operación{flecha("operacion")}</th>
                  <th style={{...thE, textAlign: "left", paddingLeft: 12}} onClick={() => toggleOrden("transporte")}>Transporte{flecha("transporte")}</th>
                  {tabCategoria === "sub" && (
                    <th style={{...thE, textAlign: "left"}} onClick={() => toggleOrden("subcontratista_nombre")}>Subcontratista{flecha("subcontratista_nombre")}</th>
                  )}
                  <th style={thE} onClick={() => toggleOrden("recurso_inhabilitado")} title="Inhabilitado: distintivo de Certronic — el contratista debe documentación. NO significa que no esté operando.">Estado{flecha("recurso_inhabilitado")}</th>
                  <th style={thE}>Activos</th>
                  {docsPorCategoria[tabCategoria].map(d => (
                    <th key={d.key} style={thE} title={d.label}>{d.label}</th>
                  ))}
                  <th style={thE} onClick={() => toggleOrden("pct_retencion")}>% Reten.{flecha("pct_retencion")}</th>
                  <th style={thE} onClick={() => toggleOrden("pct_avance")}>% Avance{flecha("pct_avance")}</th>
                  <th style={thE} onClick={() => toggleOrden("estado_final")}>Cert.{flecha("estado_final")}</th>
                  <th style={thE}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {datosCategoriaActual.map((d, i) => {
                  const mandante = operacionAMandante(d.operacion);
                  const colorOp = {
                    "Mercado Libre": "#fef3c7",
                    "Falabella": "#dcfce7",
                    "Rosen": "#fce7f3",
                    "Cannon": "#dbeafe",
                    "Esporádicos": "#f3e8ff",
                  }[mandante] || "#f1f5f9";
                  const isInhabilitado = d.recurso_inhabilitado;
                  const filaId = d.id || `${d.transporte}|${d.categoria}|${d.subcontratista_nombre || ""}`;
                  return (
                    <tr key={filaId + "_" + i} style={{
                      borderBottom: "1px solid #f0f0f0",
                      background: isInhabilitado 
                        ? "#FCEBEB"
                        : (d.tiene_anomalia ? "#fff7ed" : (i % 2 === 0 ? "#fafbfc" : "#fff")),
                      borderLeft: isInhabilitado ? "3px solid #A32D2D" : "3px solid transparent",
                    }}>
                      <td style={tdE}>
                        <span title={mandante} style={{
                          fontSize: 9.5, padding: "2px 6px", borderRadius: 4,
                          background: colorOp, color: "#1a3a6b", fontWeight: 700, whiteSpace: "nowrap",
                        }}>
                          {d.operacion || "—"}
                        </span>
                      </td>
                      <td style={{...tdE, textAlign: "left", paddingLeft: 12, fontWeight: 500, color: isInhabilitado ? "#791F1F" : undefined}}>
                        {d.transporte}
                        {(() => {
                          // 🆕 Triángulo de cumplimiento de docs iniciales (a la derecha, grande)
                          const ci = cumplInicial.get(d.transporte);
                          if (!ci) return null;
                          const colorTri = ci.semaforo === "verde" ? "#16a34a" 
                                         : ci.semaforo === "amarillo" ? "#f59e0b" 
                                         : "#dc2626";
                          const tooltipTri = `Documentación inicial del contratista: ${ci.cumplen}/${ci.total} (${ci.porcentaje}%)\n${ci.semaforo === "verde" ? "✓ Cumple 100%" : ci.semaforo === "amarillo" ? "⚠ Parcial 50-99%" : "✗ Crítico <50%"}`;
                          return (
                            <span 
                              title={tooltipTri}
                              style={{ 
                                display: "inline-block", marginLeft: 8, fontSize: 22, color: colorTri,
                                cursor: "help", verticalAlign: "middle", lineHeight: 1,
                                textShadow: ci.semaforo === "rojo" ? "0 0 4px rgba(220, 38, 38, 0.4)" : undefined,
                              }}>
                              ⚠
                            </span>
                          );
                        })()}
                        {isInhabilitado && (
                          <span 
                            title="Distintivo de Certronic: el contratista debe documentación. NO significa que no esté operando."
                            style={{ 
                              fontSize: 9, marginLeft: 8, padding: "2px 7px", borderRadius: 3, 
                              background: "#A32D2D", color: "#fff", fontWeight: 600, 
                              letterSpacing: 0.3, verticalAlign: "middle",
                            }}>
                            INHABILITADO
                          </span>
                        )}
                        {d.tiene_anomalia && (
                          <div style={{ fontSize: 9.5, color: "#c0392b", marginTop: 2, fontStyle: "italic" }}>
                            ⚠ {d.anomalia_descripcion}
                          </div>
                        )}
                      </td>
                      {tabCategoria === "sub" && (
                        <td style={{...tdE, textAlign: "left", color: isInhabilitado ? "#791F1F" : "#374151"}}>{d.subcontratista_nombre || "—"}</td>
                      )}
                      {/* 🆕 Columna Estado: pill Activo/Inhabilitado */}
                      <td style={tdE}>
                        {isInhabilitado ? (
                          <span 
                            title="Distintivo de Certronic. El contratista debe documentación pero puede seguir operando."
                            style={{
                              fontSize: 10, padding: "2px 8px", borderRadius: 4,
                              background: "#FCEBEB", color: "#A32D2D", 
                              fontWeight: 600, border: "0.5px solid #F09595",
                              whiteSpace: "nowrap",
                            }}>
                            Inhabilitado
                          </span>
                        ) : (
                          <span style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 4,
                            background: "#EAF3DE", color: "#3B6D11",
                            fontWeight: 600, whiteSpace: "nowrap",
                          }}>
                            Activo
                          </span>
                        )}
                      </td>
                      <td style={tdE}>
                        <div style={{ fontSize: 10, color: isInhabilitado ? "#791F1F" : "#64748b" }}>
                          {d.empleados_activos || 0} emp · {d.vehiculos_activos || 0} veh
                        </div>
                      </td>
                      {docsPorCategoria[tabCategoria].map(doc => (
                        <td key={doc.key} style={tdE}>{renderIconoDoc(d[doc.key], {
                          contratista: d.transporte,
                          categoria: d.categoria,
                          subcontratista: d.subcontratista_nombre,
                          docCampo: doc.key,
                          docLabel: doc.label,
                          fechaSnapshot: d.fecha_snapshot_ultimo,
                        })}</td>
                      ))}
                      <td style={{...tdE, fontWeight: 700, color: d.pct_retencion > 0 ? "#c0392b" : "#94a3b8"}}>
                        {d.pct_retencion ? `${d.pct_retencion}%` : "—"}
                      </td>
                      <td style={tdE}>
                        {d.pct_avance != null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                            <div style={{ width: 50, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{
                                width: `${d.pct_avance}%`, height: "100%",
                                background: d.pct_avance >= 100 ? "#16a34a" : d.pct_avance >= 60 ? "#F47B20" : "#c0392b",
                              }} />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, minWidth: 28 }}>{Math.round(d.pct_avance)}%</span>
                          </div>
                        ) : "—"}
                      </td>
                      <td style={tdE}>{renderEstadoFinal(d.estado_final)}</td>
                      <td style={tdE}>
                        <button 
                          onClick={() => setModalDetalle(d)}
                          title="Ver detalle completo del contratista"
                          style={{
                            padding: "4px 12px", borderRadius: 4, border: "1px solid #1a3a6b",
                            background: "#1a3a6b", color: "#fff",
                            fontSize: 10, fontWeight: 600, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", gap: 4,
                          }}>
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {datosCategoriaActual.length === 0 && (
              <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 12 }}>
                No hay registros que coincidan con los filtros.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10.5, color: "#64748b" }}>
        <div>Mostrando {datosCategoriaActual.length} registros · {tabCategoria.toUpperCase()}</div>
        <div style={{ display: "flex", gap: 12 }}>
          <span>✓ Validado</span><span>◐ Recepcionado</span>
          <span>↗ Enviado</span><span>⏳ Pendiente</span><span>— No aplica</span>
        </div>
      </div>

      {/* 🆕 Modal de detalle del contratista */}
      {modalDetalle && (
        <ModalDetalleContratista 
          fila={modalDetalle}
          onCerrar={() => setModalDetalle(null)}
          docsPorCategoria={docsPorCategoria}
          renderIconoDoc={renderIconoDoc}
          operacionAMandante={operacionAMandante}
        />
      )}
    </>
  );
}

// ─── 🆕 Modal de detalle completo del contratista ────────────────────
// Reemplaza la vista expandida. Adaptativo según categoría (RYC vs SUB):
// - RYC/PC: empleados + vehículos del contratista
// - SUB: foco en el subcontratista específico (boletero)
function ModalDetalleContratista({ fila, onCerrar, docsPorCategoria, renderIconoDoc, operacionAMandante }) {
  const [tabActivo, setTabActivo] = useState("documentos");
  const [recursos, setRecursos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);

  // 🆕 Sprint 3 — Histórico
  const [deudasHistoricas, setDeudasHistoricas] = useState(null);  // {total_deudas, meses_con_deuda, ...} | null = loading | {total:0} = sin deudas
  const [deudasDetalle, setDeudasDetalle] = useState([]);          // lista de docs específicos para tab Histórico
  const [evolucionHistorica, setEvolucionHistorica] = useState([]); // [{periodo, pct_cumplimiento, ...}]
  const [desaparecidosHist, setDesaparecidosHist] = useState([]);   // gente que estaba en histórico y ya no
  const [loadingHistorico, setLoadingHistorico] = useState(true);

  const esSub = fila.categoria === "SUB";
  const mandante = operacionAMandante(fila.operacion);
  const isInhabilitado = fila.recurso_inhabilitado;

  // 🆕 Normalización del nombre del contratista para hacer match con histórico
  const normalizarContratistaParaHist = (s) => {
    if (!s) return "";
    return String(s).trim().toUpperCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/Ñ/g, "N").replace(/[^A-Z0-9 ]/g, " ")
      .replace(/\s+/g, " ").trim();
  };
  const contratistaNorm = normalizarContratistaParaHist(esSub && fila.subcontratista_nombre ? fila.subcontratista_nombre : fila.transporte);

  // Carga de recursos del contratista (similar a RecursosContratista pero más simple)
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { data: snapData } = await sb.from("certronic_documentos")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snapData || !snapData.length) {
          if (!cancel) { setRecursos([]); setLoading(false); }
          return;
        }
        const fechaSnapshot = snapData[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnapshot);

        let resultado = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          const { data, error } = await sb.from("certronic_documentos")
            .select("contratista, recurso_nombre, recurso_identificador, tipo_recurso, fecha_inicio, acceso, planta, documento")
            .eq("fecha_snapshot", fechaSnapshot)
            .ilike("contratista", `%${fila.transporte}%`)
            .range(from, from + limite - 1);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          resultado = resultado.concat(data);
          if (data.length < limite) break;
          from += limite;
        }

        // Deduplicar por recurso, juntar todos los documentos de cada uno
        const recursosMap = new Map();
        for (const r of resultado) {
          const key = `${r.recurso_nombre || ""}|${r.tipo_recurso || ""}`;
          if (!recursosMap.has(key)) {
            recursosMap.set(key, {
              recurso_nombre: r.recurso_nombre,
              recurso_identificador: r.recurso_identificador,
              tipo_recurso: r.tipo_recurso,
              fecha_inicio: r.fecha_inicio,
              acceso: r.acceso,
              planta: r.planta,
              documentos: [],
            });
          }
          const existing = recursosMap.get(key);
          if (r.documento && !existing.documentos.find(d => d.documento === r.documento)) {
            existing.documentos.push({ documento: r.documento });
          }
          if (!existing.recurso_identificador && r.recurso_identificador) {
            existing.recurso_identificador = r.recurso_identificador;
          }
        }

        let recursosFinales = Array.from(recursosMap.values());
        // Si es SUB, filtrar solo el subcontratista específico
        if (esSub && fila.subcontratista_nombre) {
          const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
          const target = norm(fila.subcontratista_nombre);
          recursosFinales = recursosFinales.filter(r => norm(r.recurso_nombre).includes(target) || target.includes(norm(r.recurso_nombre)));
        }

        recursosFinales.sort((a, b) => (a.recurso_nombre || "").localeCompare(b.recurso_nombre || ""));
        if (!cancel) setRecursos(recursosFinales);
      } catch (e) {
        console.error("[ModalDetalle]", e);
        if (!cancel) setRecursos([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [fila.transporte, fila.categoria, fila.subcontratista_nombre, esSub]);

  // 🆕 Sprint 3 — Cargar datos históricos del contratista
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoadingHistorico(true);
      try {
        // 1. Resumen de deudas históricas (para badge en header)
        // Una persona puede aparecer múltiples veces si trabaja para varios contratistas.
        // Sumamos todas las deudas de este contratista_norm.
        const { data: resumenData, error: errResumen } = await sb
          .from("vw_deudores_historicos_actuales_resumen")
          .select("identificador, total_deudas, meses_con_deuda, docs_distintos_adeudados, deuda_mas_antigua, deuda_mas_reciente, detalle")
          .eq("contratista_norm", contratistaNorm);

        if (cancel) return;

        if (errResumen) {
          console.warn("[Histórico] Error resumen:", errResumen.message);
          if (!cancel) setDeudasHistoricas({ total: 0, error: errResumen.message });
        } else {
          const agg = (resumenData || []).reduce((acc, r) => {
            acc.total += r.total_deudas;
            acc.personas += 1;
            acc.docs.add(...(r.docs_distintos_adeudados ? [r.docs_distintos_adeudados] : []));
            if (!acc.masAntigua || r.deuda_mas_antigua < acc.masAntigua) acc.masAntigua = r.deuda_mas_antigua;
            if (!acc.masReciente || r.deuda_mas_reciente > acc.masReciente) acc.masReciente = r.deuda_mas_reciente;
            return acc;
          }, { total: 0, personas: 0, docs: new Set(), masAntigua: null, masReciente: null });
          if (!cancel) setDeudasHistoricas({
            total: agg.total,
            personas: agg.personas,
            masAntigua: agg.masAntigua,
            masReciente: agg.masReciente,
          });
        }

        // 2. Detalle de deudas (para tab Histórico)
        const { data: detalleData } = await sb
          .from("vw_deudores_historicos_actuales")
          .select("identificador, detalle, documento, periodo_deuda, estado_en_ese_periodo")
          .eq("contratista_norm", contratistaNorm)
          .order("periodo_deuda", { ascending: true })
          .limit(500);
        if (!cancel) setDeudasDetalle(detalleData || []);

        // 3. Evolución mensual del contratista
        const { data: evolData } = await sb
          .from("vw_historico_evolucion_contratista")
          .select("periodo, total_docs, docs_cumplidos, docs_pendientes, pct_cumplimiento, delta_pct_vs_mes_anterior, identificadores_unicos")
          .eq("contratista_norm", contratistaNorm)
          .order("periodo", { ascending: true });
        if (!cancel) setEvolucionHistorica(evolData || []);

        // 4. Desaparecidos de este contratista (gente que estaba y ya no)
        const { data: desapData } = await sb
          .from("vw_historico_desaparecidos")
          .select("identificador, detalle, entidad, ultimo_periodo_visto, docs_pendientes_al_irse, meses_presentes")
          .eq("contratista_norm", contratistaNorm)
          .order("docs_pendientes_al_irse", { ascending: false })
          .limit(100);
        if (!cancel) setDesaparecidosHist(desapData || []);

      } catch (e) {
        console.error("[Histórico] Error general:", e);
        if (!cancel) setDeudasHistoricas({ total: 0, error: e.message });
      }
      if (!cancel) setLoadingHistorico(false);
    })();
    return () => { cancel = true; };
  }, [contratistaNorm]);

  // Particiones de recursos
  const empleados = useMemo(() => recursos.filter(r => r.tipo_recurso === "empleado"), [recursos]);
  const vehiculos = useMemo(() => recursos.filter(r => r.tipo_recurso === "vehiculo"), [recursos]);
  const empleadosInhab = empleados.filter(e => e.acceso === "Inhabilitado").length;
  const vehiculosInhab = vehiculos.filter(v => v.acceso === "Inhabilitado").length;

  // Documentos exigidos por categoría (matriz)
  const docsCategoria = docsPorCategoria[fila.categoria.toLowerCase()] || [];

  // Click en overlay (fuera del modal) cierra
  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget) onCerrar();
  };

  // Color mandante
  const colorOp = {
    "Mercado Libre": "#fef3c7",
    "Falabella": "#dcfce7",
    "Rosen": "#fce7f3",
    "Cannon": "#dbeafe",
    "Esporádicos": "#f3e8ff",
  }[mandante] || "#f1f5f9";

  // Estilo común de tab
  const tabStyle = (activo) => ({
    padding: "8px 16px", cursor: "pointer", fontSize: 12, fontWeight: activo ? 700 : 500,
    color: activo ? "#1a3a6b" : "#64748b",
    borderBottom: activo ? "2px solid #1a3a6b" : "2px solid transparent",
    background: "transparent", border: "none", borderRadius: 0,
    transition: "all 0.15s",
  });

  const tituloModal = esSub 
    ? (fila.subcontratista_nombre || fila.transporte)
    : fila.transporte;
  const subtituloModal = esSub
    ? `Subcontratista de ${fila.transporte} · ${mandante}`
    : `${mandante} · ${fila.categoria}${fila.email ? " · " + fila.email : ""}`;

  return (
    <div onClick={onOverlayClick}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(15, 23, 42, 0.55)", zIndex: 9999,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 20px", overflow: "auto",
      }}>
      <div style={{
        background: "#fff", borderRadius: 8, width: "100%", maxWidth: 980,
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 80px)",
        overflow: "hidden",
      }}>

        {/* HEADER */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid #e4e7ec",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
          background: isInhabilitado ? "#FCEBEB" : "#fff",
          borderLeft: isInhabilitado ? "4px solid #A32D2D" : "4px solid transparent",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                background: colorOp, color: "#1a3a6b", fontWeight: 700,
              }}>{fila.operacion || mandante}</span>
              {isInhabilitado && (
                <span style={{ 
                  fontSize: 9.5, padding: "2px 8px", borderRadius: 3,
                  background: "#A32D2D", color: "#fff", fontWeight: 700, letterSpacing: 0.3,
                }}>INHABILITADO</span>
              )}
              <span style={{ fontSize: 10, color: "#64748b" }}>{fila.categoria}</span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: isInhabilitado ? "#791F1F" : "#1a3a6b", marginBottom: 2 }}>
              {tituloModal}
            </div>
            <div style={{ fontSize: 11, color: isInhabilitado ? "#791F1F" : "#64748b" }}>
              {subtituloModal}
              {esSub && (
                <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 3, background: "#f3e8ff", color: "#6b21a8", fontWeight: 600 }}>
                  Boletero
                </span>
              )}
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar"
            style={{
              border: "1px solid #e4e7ec", background: "#fff", cursor: "pointer",
              padding: "4px 10px", borderRadius: 4, fontSize: 16, color: "#64748b",
              lineHeight: 1, fontWeight: 700,
            }}>✕</button>
        </div>

        {/* KPIs */}
        <div style={{ padding: "12px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Estado</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isInhabilitado ? "#A32D2D" : "#16a34a", marginTop: 2 }}>
              {isInhabilitado ? "Inhabilitado" : "Activo"}
            </div>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Avance</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>
              {fila.pct_avance != null ? `${Math.round(fila.pct_avance)}%` : "—"}
            </div>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Retención</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: fila.pct_retencion > 0 ? "#c0392b" : "#94a3b8", marginTop: 2 }}>
              {fila.pct_retencion ? `${fila.pct_retencion}%` : "—"}
            </div>
          </div>
          {!esSub && (
            <>
              <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Empleados</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>
                  {fila.empleados_activos || 0}
                  {empleadosInhab > 0 && <span style={{ fontSize: 10, color: "#A32D2D", marginLeft: 4 }}>({empleadosInhab} inh.)</span>}
                </div>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Vehículos</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>
                  {fila.vehiculos_activos || 0}
                  {vehiculosInhab > 0 && <span style={{ fontSize: 10, color: "#A32D2D", marginLeft: 4 }}>({vehiculosInhab} inh.)</span>}
                </div>
              </div>
            </>
          )}
          {/* 🆕 Sprint 3 — KPI Deudas Históricas (clickeable, lleva al tab Histórico) */}
          <div
            onClick={() => setTabActivo("historico")}
            title="Click para ver detalle en el tab Histórico"
            style={{
              background: loadingHistorico
                ? "#f8fafc"
                : (deudasHistoricas && deudasHistoricas.total > 0)
                  ? "#fef3c7"
                  : "#f0fdf4",
              border: loadingHistorico
                ? "1px solid #e4e7ec"
                : (deudasHistoricas && deudasHistoricas.total > 0)
                  ? "1px solid #fbbf24"
                  : "1px solid #86efac",
              borderRadius: 6,
              padding: "8px 12px",
              cursor: "pointer",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              Deudas históricas
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2,
              color: loadingHistorico ? "#94a3b8" : (deudasHistoricas && deudasHistoricas.total > 0) ? "#92400e" : "#166534"
            }}>
              {loadingHistorico ? (
                <span style={{ fontSize: 11, fontWeight: 500 }}>cargando...</span>
              ) : deudasHistoricas && deudasHistoricas.total > 0 ? (
                <>🚨 {deudasHistoricas.total}</>
              ) : (
                <>✓ 0</>
              )}
            </div>
            {!loadingHistorico && deudasHistoricas && deudasHistoricas.total > 0 && (
              <div style={{ fontSize: 9.5, color: "#92400e", marginTop: 1 }}>
                {deudasHistoricas.personas} {deudasHistoricas.personas === 1 ? "persona" : "personas"}
              </div>
            )}
          </div>
        </div>

        {/* TABS */}
        <div style={{ borderBottom: "1px solid #e4e7ec", padding: "0 20px", display: "flex", gap: 4 }}>
          <button onClick={() => setTabActivo("documentos")} style={tabStyle(tabActivo === "documentos")}>
            Documentos {docsCategoria.length > 0 && `(${docsCategoria.length})`}
          </button>
          {!esSub && (
            <>
              <button onClick={() => setTabActivo("empleados")} style={tabStyle(tabActivo === "empleados")}>
                Empleados {empleados.length > 0 && `(${empleados.length})`}
              </button>
              <button onClick={() => setTabActivo("vehiculos")} style={tabStyle(tabActivo === "vehiculos")}>
                Vehículos {vehiculos.length > 0 && `(${vehiculos.length})`}
              </button>
            </>
          )}
          <button onClick={() => setTabActivo("historico")} style={tabStyle(tabActivo === "historico")}>
            Histórico
          </button>
        </div>

        {/* CONTENIDO TAB */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", background: "#fafbfc" }}>
          {loading && tabActivo !== "documentos" && tabActivo !== "historico" ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Cargando...</div>
          ) : (
            <>
              {/* TAB DOCUMENTOS */}
              {tabActivo === "documentos" && (
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
                    Estado de los {docsCategoria.length} documentos exigidos por mandante para esta categoría
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead style={{ background: "#f1f5f9" }}>
                        <tr>
                          <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#475569" }}>Documento</th>
                          <th style={{ padding: "8px 12px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#475569", width: 100 }}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docsCategoria.map((doc) => (
                          <tr key={doc.key} style={{ borderTop: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 12px", fontWeight: 500 }}>{doc.label}</td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              {renderIconoDoc(fila[doc.key], {
                                contratista: fila.transporte,
                                categoria: fila.categoria,
                                subcontratista: fila.subcontratista_nombre,
                                docCampo: doc.key,
                                docLabel: doc.label,
                                fechaSnapshot: fila.fecha_snapshot_ultimo,
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>✓ Validado</span><span>◐ Recepcionado</span>
                    <span>↗ Enviado</span><span>⏳ Pendiente</span><span>— No aplica</span>
                  </div>
                </div>
              )}

              {/* TAB EMPLEADOS */}
              {tabActivo === "empleados" && !esSub && (
                <div>
                  {empleados.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                      Sin empleados registrados en el snapshot {snapshotUsado || "—"}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
                        {empleados.length} empleado{empleados.length !== 1 ? "s" : ""} en Certronic 
                        {empleadosInhab > 0 && <span style={{ color: "#A32D2D", fontWeight: 600 }}> · {empleadosInhab} con acceso Inhabilitado individualmente</span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {empleados.map((e, i) => {
                          const inhab = e.acceso === "Inhabilitado";
                          return (
                            <div key={i} style={{
                              padding: "10px 12px", borderRadius: 6,
                              background: inhab ? "#FCEBEB" : "#fff",
                              border: "1px solid " + (inhab ? "#F09595" : "#e4e7ec"),
                              borderLeft: inhab ? "3px solid #A32D2D" : "3px solid transparent",
                              display: "flex", alignItems: "center", gap: 12,
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: inhab ? "#791F1F" : "#1a3a6b" }}>
                                  {e.recurso_nombre || "—"}
                                </div>
                                {e.recurso_identificador && (
                                  <div style={{ fontSize: 10, color: inhab ? "#791F1F" : "#64748b", marginTop: 2 }}>
                                    RUT {e.recurso_identificador}
                                    {e.documentos && e.documentos.length > 0 && (
                                      <span style={{ marginLeft: 8 }}>· {e.documentos.length} doc{e.documentos.length !== 1 ? "s" : ""}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <span style={{
                                fontSize: 10, padding: "3px 10px", borderRadius: 4, fontWeight: 700,
                                background: inhab ? "#A32D2D" : "#EAF3DE",
                                color: inhab ? "#fff" : "#3B6D11",
                                whiteSpace: "nowrap",
                              }}>
                                {e.acceso || "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB VEHÍCULOS */}
              {tabActivo === "vehiculos" && !esSub && (
                <div>
                  {vehiculos.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                      Sin vehículos registrados en el snapshot {snapshotUsado || "—"}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
                        {vehiculos.length} vehículo{vehiculos.length !== 1 ? "s" : ""} en Certronic
                        {vehiculosInhab > 0 && <span style={{ color: "#A32D2D", fontWeight: 600 }}> · {vehiculosInhab} con acceso Inhabilitado</span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {vehiculos.map((v, i) => {
                          const inhab = v.acceso === "Inhabilitado";
                          return (
                            <div key={i} style={{
                              padding: "10px 12px", borderRadius: 6,
                              background: inhab ? "#FCEBEB" : "#fff",
                              border: "1px solid " + (inhab ? "#F09595" : "#e4e7ec"),
                              borderLeft: inhab ? "3px solid #A32D2D" : "3px solid transparent",
                              display: "flex", alignItems: "center", gap: 12,
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: inhab ? "#791F1F" : "#1a3a6b" }}>
                                  {v.recurso_nombre || "—"}
                                </div>
                                {v.documentos && v.documentos.length > 0 && (
                                  <div style={{ fontSize: 10, color: inhab ? "#791F1F" : "#64748b", marginTop: 2 }}>
                                    {v.documentos.length} doc{v.documentos.length !== 1 ? "s" : ""} asociado{v.documentos.length !== 1 ? "s" : ""}
                                  </div>
                                )}
                              </div>
                              <span style={{
                                fontSize: 10, padding: "3px 10px", borderRadius: 4, fontWeight: 700,
                                background: inhab ? "#A32D2D" : "#EAF3DE",
                                color: inhab ? "#fff" : "#3B6D11",
                                whiteSpace: "nowrap",
                              }}>
                                {v.acceso || "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB HISTÓRICO — Sprint 3 Fase B */}
              {tabActivo === "historico" && (
                <div style={{ padding: 14 }}>
                  {loadingHistorico ? (
                    <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                      Cargando datos históricos...
                    </div>
                  ) : (
                    <>
                      {/* INTRO + AVISO */}
                      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#0c4a6e" }}>
                        <strong>Histórico Q1 2026</strong> · Datos capturados el 2026-05-08 · Períodos: Enero, Febrero, Marzo, Abril 2026
                        <div style={{ marginTop: 3, fontSize: 10.5, color: "#075985" }}>
                          Recordá: el "Período" en Certronic refleja el mes que se está certificando (mes calendario anterior).
                        </div>
                      </div>

                      {/* ─── BLOQUE 1: EVOLUCIÓN DE CUMPLIMIENTO ─── */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 6 }}>
                          📊 Evolución del cumplimiento
                        </div>
                        {evolucionHistorica.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#94a3b8", padding: 8, background: "#f8fafc", borderRadius: 4 }}>
                            Sin datos históricos para este contratista. Posible que sea nuevo (post-abril) o que el nombre no matchee con el histórico.
                          </div>
                        ) : (
                          <>
                            {/* Sparkline ASCII / CSS */}
                            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: 12 }}>
                              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80, marginBottom: 6 }}>
                                {evolucionHistorica.map((e, i) => {
                                  const pct = parseFloat(e.pct_cumplimiento) || 0;
                                  const altura = Math.max(4, (pct / 100) * 72);
                                  const color = pct >= 85 ? "#16a34a" : pct >= 70 ? "#f59e0b" : "#dc2626";
                                  const delta = e.delta_pct_vs_mes_anterior != null ? parseFloat(e.delta_pct_vs_mes_anterior) : null;
                                  const periodoCorto = e.periodo ? e.periodo.substring(0, 7) : "—";
                                  return (
                                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                      <div style={{ fontSize: 10, fontWeight: 700, color }}>{pct.toFixed(1)}%</div>
                                      <div style={{ width: "100%", height: altura, background: color, borderRadius: "3px 3px 0 0", transition: "height 0.3s" }} />
                                      <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{periodoCorto}</div>
                                      {delta != null && (
                                        <div style={{
                                          fontSize: 9, fontWeight: 700,
                                          color: delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#94a3b8",
                                        }}>
                                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, display: "flex", gap: 12, justifyContent: "center" }}>
                                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#16a34a", borderRadius: 2, marginRight: 3 }} />≥85%</span>
                                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#f59e0b", borderRadius: 2, marginRight: 3 }} />70-85%</span>
                                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#dc2626", borderRadius: 2, marginRight: 3 }} />&lt;70%</span>
                              </div>
                            </div>
                            {/* Tabla detalle por mes */}
                            <div style={{ marginTop: 8, overflow: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                <thead style={{ background: "#f1f5f9" }}>
                                  <tr>
                                    <th style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Período</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Total docs</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Cumplidos</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Pendientes</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>% Cumple</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Δ vs mes ant.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {evolucionHistorica.map((e, i) => {
                                    const pct = parseFloat(e.pct_cumplimiento) || 0;
                                    const delta = e.delta_pct_vs_mes_anterior != null ? parseFloat(e.delta_pct_vs_mes_anterior) : null;
                                    return (
                                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "5px 8px", fontWeight: 500 }}>{e.periodo}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", color: "#475569" }}>{e.total_docs}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", color: "#166534" }}>{e.docs_cumplidos}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", color: e.docs_pendientes > 0 ? "#991b1b" : "#94a3b8" }}>{e.docs_pendientes}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: pct >= 85 ? "#16a34a" : pct >= 70 ? "#92400e" : "#dc2626" }}>{pct.toFixed(1)}%</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: delta == null ? "#cbd5e1" : delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#94a3b8" }}>
                                          {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>

                      {/* ─── BLOQUE 2: DEUDAS HISTÓRICAS PUNTUALES ─── */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                          🚨 Deudas históricas
                          {deudasDetalle.length > 0 && (
                            <span style={{ fontSize: 10, padding: "1px 6px", background: "#fef3c7", color: "#92400e", borderRadius: 3, fontWeight: 700 }}>
                              {deudasDetalle.length} docs adeudados
                            </span>
                          )}
                        </div>
                        {deudasDetalle.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#166534", padding: 8, background: "#f0fdf4", borderRadius: 4, border: "1px solid #86efac" }}>
                            ✓ Sin deudas históricas. Los empleados/vehículos activos de este contratista no tienen documentos puntuales pendientes de meses anteriores.
                          </div>
                        ) : (
                          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, overflow: "auto", maxHeight: 320 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead style={{ position: "sticky", top: 0, background: "#f1f5f9", zIndex: 1 }}>
                                <tr>
                                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Persona / Recurso</th>
                                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Documento</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Período</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Estado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deudasDetalle.map((d, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                                    <td style={{ padding: "5px 10px", color: "#475569", fontSize: 10.5 }}>{d.documento}</td>
                                    <td style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>
                                      {d.periodo_deuda ? d.periodo_deuda.substring(0, 7) : "—"}
                                    </td>
                                    <td style={{ padding: "5px 10px", textAlign: "center" }}>
                                      <span style={{
                                        fontSize: 9.5, padding: "1px 6px", borderRadius: 3, fontWeight: 600,
                                        background: "#fef3c7", color: "#92400e",
                                      }}>
                                        {d.estado_en_ese_periodo || "—"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* ─── BLOQUE 3: DESAPARECIDOS (gente que estuvo y ya no) ─── */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                          👻 Empleados/vehículos que ya no están
                          {desaparecidosHist.length > 0 && (
                            <span style={{ fontSize: 10, padding: "1px 6px", background: "#f3e8ff", color: "#6b21a8", borderRadius: 3, fontWeight: 700 }}>
                              {desaparecidosHist.length}
                            </span>
                          )}
                        </div>
                        {desaparecidosHist.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#64748b", padding: 8, background: "#f8fafc", borderRadius: 4 }}>
                            Sin desapariciones detectadas. Todos los empleados/vehículos que aparecieron en Q1 siguen presentes en el último período histórico (abril).
                          </div>
                        ) : (
                          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, overflow: "auto", maxHeight: 240 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead style={{ background: "#f1f5f9" }}>
                                <tr>
                                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Quién</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Tipo</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Último mes visto</th>
                                  <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Meses presente</th>
                                  <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Docs pendientes al irse</th>
                                </tr>
                              </thead>
                              <tbody>
                                {desaparecidosHist.map((d, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                                    <td style={{ padding: "5px 10px", textAlign: "center" }}>
                                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: d.entidad === "empleado" ? "#dbeafe" : d.entidad === "vehiculo" ? "#fef3c7" : "#f3e8ff", color: d.entidad === "empleado" ? "#1e40af" : d.entidad === "vehiculo" ? "#92400e" : "#6b21a8", fontWeight: 600, textTransform: "uppercase" }}>
                                        {d.entidad || "—"}
                                      </span>
                                    </td>
                                    <td style={{ padding: "5px 10px", textAlign: "center", color: "#64748b", fontFamily: "monospace", fontSize: 10 }}>
                                      {d.ultimo_periodo_visto ? d.ultimo_periodo_visto.substring(0, 7) : "—"}
                                    </td>
                                    <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.meses_presentes}</td>
                                    <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: d.docs_pendientes_al_irse > 0 ? "#991b1b" : "#94a3b8" }}>
                                      {d.docs_pendientes_al_irse}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ padding: "10px 20px", borderTop: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {snapshotUsado && `Snapshot: ${snapshotUsado}`}
            {fila.fecha_calculo && ` · Calculado: ${fila.fecha_calculo}`}
          </div>
          <button onClick={onCerrar} style={{
            padding: "6px 16px", borderRadius: 4, border: "1px solid #1a3a6b",
            background: "#1a3a6b", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>Cerrar</button>
        </div>

      </div>
    </div>
  );
}

// ─── Componente: Lista de recursos del contratista ────────────────────
// Lee de certronic_documentos para mostrar empleados y vehículos con
// fecha_inicio. Marca los ingresados en el mes en curso con badge.
function RecursosContratista({ transporte, categoria, subcontratistaNombre }) {
  const [recursos, setRecursos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEntidad, setFiltroEntidad] = useState("todas");
  // 🆕 Sprint 3 — Mapa de deudas históricas por identificador
  const [deudasPorRecurso, setDeudasPorRecurso] = useState({}); // { "identificador": {total, meses, docs} }

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Obtener el último snapshot disponible de certronic_documentos
        console.log(`[Recursos] Buscando snapshot para "${transporte}"...`);
        const { data: snapData, error: snapErr } = await sb.from("certronic_documentos")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        
        if (snapErr) {
          console.error(`[Recursos] Error consultando snapshot:`, snapErr);
          if (!cancel) { setRecursos([]); setLoading(false); }
          return;
        }
        if (!snapData || !snapData.length) {
          console.warn(`[Recursos] certronic_documentos está vacía (sin snapshots)`);
          if (!cancel) { setRecursos([]); setLoading(false); }
          return;
        }
        const fechaSnapshot = snapData[0].fecha_snapshot;
        console.log(`[Recursos] Snapshot encontrado: ${fechaSnapshot}`);
        if (!cancel) setSnapshotUsado(fechaSnapshot);

        // 2. Cargar recursos (con paginación por si hay muchos)
        // Tomamos solo distintos: contratista + recurso_nombre + tipo + fecha_inicio + acceso
        let resultado = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          let query = sb.from("certronic_documentos")
            .select("contratista, recurso_nombre, recurso_identificador, tipo_recurso, fecha_inicio, acceso, planta, documento")
            .eq("fecha_snapshot", fechaSnapshot)
            .ilike("contratista", `%${transporte}%`)
            .range(from, from + limite - 1);
          const { data, error } = await query;
          if (cancel) return;
          if (error) {
            console.error(`[Recursos] Error consultando documentos:`, error);
            throw error;
          }
          if (!data || data.length === 0) break;
          resultado = resultado.concat(data);
          if (data.length < limite) break;
          from += limite;
        }
        console.log(`[Recursos] "${transporte}" en snapshot ${fechaSnapshot}: ${resultado.length} filas crudas`);

        // 3. Deduplicar por recurso, juntar todos los documentos de cada uno
        const recursosMap = new Map();
        for (const r of resultado) {
          const key = `${r.recurso_nombre || ""}|${r.tipo_recurso || ""}`;
          if (!recursosMap.has(key)) {
            recursosMap.set(key, {
              recurso_nombre: r.recurso_nombre,
              recurso_identificador: r.recurso_identificador,
              tipo_recurso: r.tipo_recurso,
              fecha_inicio: r.fecha_inicio,
              acceso: r.acceso,
              planta: r.planta,
              documentos: [],  // 🆕 lista de docs del recurso
              fecha_ingreso_real: null,  // 🆕 vendrá de certronic_empleados_detalle
            });
          }
          const existing = recursosMap.get(key);
          // Conservar fecha más antigua si la nueva es menor
          if (r.fecha_inicio && (!existing.fecha_inicio || r.fecha_inicio < existing.fecha_inicio)) {
            existing.fecha_inicio = r.fecha_inicio;
          }
          // Acumular documento (si no se duplica)
          if (r.documento && !existing.documentos.find(d => d.documento === r.documento)) {
            existing.documentos.push({ documento: r.documento });
          }
          // Conservar el primer identificador no-vacío
          if (!existing.recurso_identificador && r.recurso_identificador) {
            existing.recurso_identificador = r.recurso_identificador;
          }
        }

        // 4. Para SUB, filtrar solo el subcontratista específico (si está dado)
        let recursosFinales = Array.from(recursosMap.values());
        if (categoria === "SUB" && subcontratistaNombre) {
          // Match flexible: ignorar mayúsculas/acentos
          const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
          const target = norm(subcontratistaNombre);
          recursosFinales = recursosFinales.filter(r => norm(r.recurso_nombre).includes(target) || target.includes(norm(r.recurso_nombre)));
        }

        // 5. 🆕 ENRIQUECER con certronic_empleados_detalle (fecha_ingreso real)
        // Buscamos por CUIL (recurso_identificador en docs == cuil en detalle)
        const cuils = recursosFinales
          .filter(r => r.tipo_recurso === "empleado" && r.recurso_identificador)
          .map(r => r.recurso_identificador.replace(/[^0-9kK]/g, ""));  // limpiar formato

        if (cuils.length > 0) {
          try {
            // Snapshot más reciente de empleados detalle
            const { data: empSnap } = await sb.from("certronic_empleados_detalle")
              .select("fecha_snapshot")
              .order("fecha_snapshot", { ascending: false })
              .limit(1);

            if (empSnap && empSnap.length > 0) {
              const fechaSnapEmp = empSnap[0].fecha_snapshot;
              // Cargar todos los empleados de ese snapshot que matchen los cuils
              const { data: empleados } = await sb.from("certronic_empleados_detalle")
                .select("cuil, fecha_ingreso, email, celular, telefono, ficha_completa, categoria, funcion, tipo_contrato, tipo_trabajador")
                .eq("fecha_snapshot", fechaSnapEmp)
                .in("cuil", cuils);

              if (empleados && empleados.length > 0) {
                console.log(`[Recursos] Match con certronic_empleados_detalle: ${empleados.length}/${cuils.length}`);
                const empMap = new Map();
                for (const e of empleados) empMap.set(e.cuil, e);

                for (const r of recursosFinales) {
                  if (r.tipo_recurso === "empleado" && r.recurso_identificador) {
                    const cuilLimpio = r.recurso_identificador.replace(/[^0-9kK]/g, "");
                    const detalle = empMap.get(cuilLimpio);
                    if (detalle) {
                      r.fecha_ingreso_real = detalle.fecha_ingreso;
                      r.email = detalle.email;
                      r.celular = detalle.celular;
                      r.telefono = detalle.telefono;
                      r.ficha_completa = detalle.ficha_completa;
                      r.categoria = detalle.categoria;
                      r.funcion = detalle.funcion;
                      r.tipo_contrato = detalle.tipo_contrato;
                      r.tipo_trabajador = detalle.tipo_trabajador;
                    }
                  }
                }
              }
            }
          } catch (eEnrich) {
            console.warn("[Recursos] No se pudo enriquecer con detalle:", eEnrich.message);
          }
        }

        // 6. Ordenar: nuevos primero (más recientes), después por nombre
        recursosFinales.sort((a, b) => {
          const fa = a.fecha_ingreso_real || a.fecha_inicio;
          const fb = b.fecha_ingreso_real || b.fecha_inicio;
          if (fa && !fb) return -1;
          if (!fa && fb) return 1;
          if (fa && fb) {
            const cmp = fb.localeCompare(fa);
            if (cmp !== 0) return cmp;
          }
          return (a.recurso_nombre || "").localeCompare(b.recurso_nombre || "");
        });

        if (!cancel) setRecursos(recursosFinales);
      } catch (e) {
        console.error(e);
        if (!cancel) setRecursos([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [transporte, categoria, subcontratistaNombre]);

  // 🆕 Sprint 3 — Cargar deudas históricas para cruzar con los recursos
  useEffect(() => {
    let cancel = false;
    if (recursos.length === 0) {
      setDeudasPorRecurso({});
      return;
    }
    (async () => {
      try {
        // Tomar todos los identificadores únicos de los recursos cargados
        const identificadores = [...new Set(recursos.map(r => r.recurso_identificador).filter(Boolean))];
        if (identificadores.length === 0) {
          if (!cancel) setDeudasPorRecurso({});
          return;
        }
        const { data, error } = await sb
          .from("vw_deudores_historicos_actuales_resumen")
          .select("identificador, total_deudas, meses_con_deuda, docs_distintos_adeudados, deuda_mas_antigua")
          .in("identificador", identificadores);
        if (cancel) return;
        if (error) {
          console.warn("[Recursos] Error cargando deudas históricas:", error.message);
          return;
        }
        const mapa = {};
        for (const d of (data || [])) {
          mapa[d.identificador] = d;
        }
        if (!cancel) setDeudasPorRecurso(mapa);
      } catch (e) {
        console.warn("[Recursos] No se pudieron cargar deudas históricas:", e.message);
      }
    })();
    return () => { cancel = true; };
  }, [recursos]);

  // Formato de fecha
  const fmtFecha = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return iso; }
  };

  // Determinar si la fecha es del mes en curso
  const esEsteMes = (iso) => {
    if (!iso) return false;
    const hoy = new Date();
    const fecha = new Date(iso + "T00:00:00");
    return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth();
  };
  // Días desde el ingreso
  const diasDesde = (iso) => {
    if (!iso) return null;
    const hoy = new Date();
    const fecha = new Date(iso + "T00:00:00");
    return Math.floor((hoy - fecha) / (1000 * 60 * 60 * 24));
  };
  // Mes en castellano
  const nombreMesActual = () => {
    return new Date().toLocaleDateString("es-CL", { month: "long" }).toUpperCase();
  };

  // Filtros aplicados
  const recursosFiltrados = useMemo(() => {
    let res = recursos;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      res = res.filter(r => (r.recurso_nombre || "").toLowerCase().includes(q));
    }
    if (filtroEntidad !== "todas") {
      res = res.filter(r => r.tipo_recurso === filtroEntidad);
    }
    return res;
  }, [recursos, busqueda, filtroEntidad]);

  // Stats
  const stats = useMemo(() => {
    const fechaParaUsar = (r) => r.fecha_ingreso_real || r.fecha_inicio;
    return {
      total: recursos.length,
      empleados: recursos.filter(r => r.tipo_recurso === "empleado").length,
      vehiculos: recursos.filter(r => r.tipo_recurso === "vehiculo").length,
      contratistas: recursos.filter(r => r.tipo_recurso === "contratista").length,
      nuevosEsteMes: recursos.filter(r => esEsteMes(fechaParaUsar(r))).length,
      inhabilitados: recursos.filter(r => r.acceso === "Inhabilitado").length,
      sinFecha: recursos.filter(r => !fechaParaUsar(r)).length,
      conFechaReal: recursos.filter(r => r.fecha_ingreso_real).length,
    };
  }, [recursos]);

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b" }}>
            Recursos del contratista — {transporte}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {snapshotUsado && `Snapshot: ${snapshotUsado}`}
            {categoria === "SUB" && subcontratistaNombre && ` · Filtrado: ${subcontratistaNombre}`}
          </div>
        </div>
        {!loading && recursos.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="text" placeholder="Buscar recurso..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 10px", fontSize: 11, minWidth: 160 }} />
            <select value={filtroEntidad} onChange={e => setFiltroEntidad(e.target.value)}
              style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 10px", fontSize: 11 }}>
              <option value="todas">Todos los tipos</option>
              <option value="empleado">Empleados</option>
              <option value="vehiculo">Vehículos</option>
              <option value="contratista">Contratista</option>
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Cargando recursos...</div>
      ) : recursos.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#475569" }}>Sin recursos para este contratista</div>
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            Buscamos en <code>certronic_documentos</code> con snapshot <strong>{snapshotUsado || "sin snapshot"}</strong>
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            Posibles causas:
          </div>
          <ul style={{ fontSize: 10, color: "#64748b", textAlign: "left", display: "inline-block", margin: "4px 0" }}>
            <li>El reporte completo (lunes/jueves 04:00) no incluyó a este contratista</li>
            <li>El nombre "<strong>{transporte}</strong>" no coincide exacto con la BD</li>
            <li>La tabla certronic_documentos está vacía o desactualizada</li>
          </ul>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
            Abrir consola (F12) para ver detalle de la consulta
          </div>
        </div>
      ) : (
        <>
          {/* Mini KPIs */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 10px", fontSize: 11 }}>
              <strong>{stats.total}</strong> recursos
              {stats.empleados > 0 && <span style={{ color: "#64748b" }}> · {stats.empleados} empl.</span>}
              {stats.vehiculos > 0 && <span style={{ color: "#64748b" }}> · {stats.vehiculos} veh.</span>}
            </div>
            {stats.conFechaReal > 0 && (
              <div title="Empleados con fecha real extraída de su ficha en Certronic" 
                style={{ background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#1e40af", fontWeight: 600 }}>
                ✓ {stats.conFechaReal} con fecha real
              </div>
            )}
            {stats.nuevosEsteMes > 0 && (
              <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#166534", fontWeight: 600 }}>
                🆕 {stats.nuevosEsteMes} ingresaron en {nombreMesActual()}
              </div>
            )}
            {stats.inhabilitados > 0 && (
              <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#991b1b", fontWeight: 600 }}>
                🚫 {stats.inhabilitados} inhabilitados
              </div>
            )}
            {stats.sinFecha > 0 && (
              <div style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#64748b" }}>
                ? {stats.sinFecha} sin fecha de ingreso
              </div>
            )}
          </div>

          {/* Tabla de recursos */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, overflow: "auto", maxHeight: 500 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead style={{ position: "sticky", top: 0, background: "#f1f5f9", zIndex: 1 }}>
                <tr>
                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Tipo</th>
                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Recurso</th>
                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Fecha de ingreso</th>
                  <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Días</th>
                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Indicador</th>
                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }} title="Deudas históricas: documentos puntuales de meses pasados que nunca se presentaron">Deudas hist.</th>
                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Acceso</th>
                </tr>
              </thead>
              <tbody>
                {recursosFiltrados.map((r, i) => {
                  // Usar fecha_ingreso_real si existe, sino fecha_inicio (de docs)
                  const fechaIngreso = r.fecha_ingreso_real || r.fecha_inicio;
                  const esteMes = esEsteMes(fechaIngreso);
                  const dias = diasDesde(fechaIngreso);
                  const tipoColor = {
                    "empleado": "#dbeafe",
                    "vehiculo": "#fef3c7",
                    "contratista": "#f3e8ff",
                  }[r.tipo_recurso] || "#f1f5f9";
                  const tipoTextColor = {
                    "empleado": "#1e40af",
                    "vehiculo": "#92400e",
                    "contratista": "#6b21a8",
                  }[r.tipo_recurso] || "#64748b";
                  const fuenteFecha = r.fecha_ingreso_real ? "REAL" : (r.fecha_inicio ? "CONTRATO" : null);
                  
                  // Documentos problemáticos: si ingresó este mes, los del periodo anterior no aplican
                  const DOCS_NO_APLICAN_ANTES = [
                    "F30", "F30-1", "Liquidación de Sueldo", "Liquidacion de Sueldo",
                    "Cotizaciones", "Cotizaciones PREVIRED", "Mutualidad",
                  ];
                  const docsProblematicos = esteMes && r.documentos
                    ? r.documentos.filter(d => DOCS_NO_APLICAN_ANTES.some(t => (d.documento || "").toLowerCase().includes(t.toLowerCase())))
                    : [];

                  return (
                    <Fragment key={i}>
                      <tr style={{
                        borderTop: "1px solid #f1f5f9",
                        background: esteMes ? "#ecfdf5" : undefined,
                      }}>
                        <td style={{ padding: "6px 10px" }}>
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: tipoColor, color: tipoTextColor, fontWeight: 600, textTransform: "uppercase" }}>
                            {r.tipo_recurso || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "6px 10px", fontWeight: 500 }}>
                          {r.recurso_nombre || "—"}
                          {r.email && <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>{r.email}</div>}
                        </td>
                        <td style={{ padding: "6px 10px", color: fechaIngreso ? "#475569" : "#cbd5e1", fontFamily: fechaIngreso ? "inherit" : "monospace", fontSize: fechaIngreso ? 11 : 10 }}>
                          {fmtFecha(fechaIngreso)}
                          {fuenteFecha === "REAL" && (
                            <span title="Fecha extraída de la ficha del empleado en Certronic" style={{ marginLeft: 4, fontSize: 9, color: "#16a34a", fontWeight: 700 }}>✓</span>
                          )}
                          {fuenteFecha === "CONTRATO" && (
                            <span title="Fecha del contrato comercial (no del recurso individual)" style={{ marginLeft: 4, fontSize: 9, color: "#94a3b8" }}>~</span>
                          )}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: "#64748b", fontSize: 10 }}>
                          {dias != null ? `${dias} días` : "—"}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          {esteMes && (
                            <span style={{
                              fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 700,
                              background: "#16a34a", color: "#fff",
                            }}>
                              🆕 INGRESÓ {nombreMesActual()}
                            </span>
                          )}
                          {!esteMes && dias != null && dias <= 90 && (
                            <span style={{
                              fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 600,
                              background: "#fef3c7", color: "#92400e",
                            }}>
                              ≤ 90d
                            </span>
                          )}
                        </td>
                        {/* 🆕 Sprint 3 — Columna Deudas históricas */}
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          {(() => {
                            const deuda = r.recurso_identificador ? deudasPorRecurso[r.recurso_identificador] : null;
                            if (!deuda || !deuda.total_deudas) {
                              return <span style={{ fontSize: 10, color: "#cbd5e1" }}>—</span>;
                            }
                            return (
                              <span
                                title={`${deuda.total_deudas} documentos adeudados en ${deuda.meses_con_deuda} mes(es). Deuda más antigua: ${deuda.deuda_mas_antigua ? deuda.deuda_mas_antigua.substring(0,7) : "—"}`}
                                style={{
                                  fontSize: 10, padding: "2px 7px", borderRadius: 10, fontWeight: 700,
                                  background: "#fef3c7", color: "#92400e", border: "1px solid #fbbf24",
                                  cursor: "help",
                                }}
                              >
                                ⚠ {deuda.total_deudas}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          <span style={{
                            fontSize: 10, padding: "2px 6px", borderRadius: 3, fontWeight: 600,
                            background: r.acceso === "Habilitado" ? "#dcfce7" : r.acceso === "Inhabilitado" ? "#fee2e2" : "#f1f5f9",
                            color: r.acceso === "Habilitado" ? "#166534" : r.acceso === "Inhabilitado" ? "#991b1b" : "#64748b",
                          }}>
                            {r.acceso || "—"}
                          </span>
                        </td>
                      </tr>
                      {/* Fila de alerta cuando ingresó este mes y tiene docs problemáticos */}
                      {esteMes && docsProblematicos.length > 0 && (
                        <tr style={{ background: "#fffbeb" }}>
                          <td colSpan={7} style={{ padding: "6px 12px 8px 32px", borderTop: "none" }}>
                            <div style={{ fontSize: 10, color: "#92400e", display: "flex", alignItems: "flex-start", gap: 6 }}>
                              <span style={{ fontWeight: 700 }}>⚠️ Atención:</span>
                              <div>
                                <div>Ingresó este mes — los siguientes documentos del periodo anterior NO deberían aplicar:</div>
                                <div style={{ marginTop: 3 }}>
                                  {docsProblematicos.map((d, j) => (
                                    <span key={j} style={{ display: "inline-block", marginRight: 6, marginTop: 2, fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#fed7aa", color: "#9a3412", fontWeight: 600 }}>
                                      {d.documento}
                                    </span>
                                  ))}
                                </div>
                                <div style={{ marginTop: 3, fontStyle: "italic", color: "#a16207" }}>
                                  El analista debe revisar manualmente y marcar como NO_APLICA si corresponde.
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {recursosFiltrados.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: "#94a3b8", fontSize: 11 }}>
                Ningún recurso coincide con los filtros
              </div>
            )}
          </div>

          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
            💡 Símbolos en la columna fecha: <strong style={{ color: "#16a34a" }}>✓</strong> = fecha real del empleado (de su ficha); <strong style={{ color: "#94a3b8" }}>~</strong> = fecha del contrato comercial (aproximada).
            Recursos con badge <strong style={{ color: "#16a34a" }}>INGRESÓ {nombreMesActual()}</strong> requieren revisión manual de docs anteriores.
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-componente: Activos Críticos ────────────────────────────────
function ActivosCriticos({ activosCriticos, renderEstadoFinal, operacionAMandante }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#c0392b" }}>Activos Críticos</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Empresas operando hoy con retención de pagos. Requieren acción inmediata.
          </div>
        </div>
        {activosCriticos.length > 0 && (
          <BotonDescargarExcel onClick={() => {
            const headers = ["Transporte", "Categoría", "Operación", "Mandante", "Subcontratista", "Empleados Activos", "Vehículos Activos", "% Retención", "% Avance", "Estado", "Anomalía"];
            const filas = activosCriticos.map(d => [
              d.transporte || "",
              d.categoria || "",
              d.operacion || "",
              operacionAMandante ? operacionAMandante(d.operacion) || "" : "",
              d.subcontratista_nombre || "",
              d.empleados_activos || 0,
              d.vehiculos_activos || 0,
              d.porcentaje_retencion != null ? d.porcentaje_retencion + "%" : "",
              d.porcentaje_avance != null ? d.porcentaje_avance + "%" : "",
              d.estado_final || "",
              d.anomalia_descripcion || "",
            ]);
            descargarExcelMultihoja([
              { nombre: "Activos Críticos", datos: [headers, ...filas] },
            ], "Activos_Criticos");
          }} />
        )}
      </div>

      {activosCriticos.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#16a34a", fontSize: 14 }}>
          No hay empresas activas con retención. Todo en orden.
        </div>
      ) : (
        <>
          <div style={{ background: "#f8fafc", border: "1px solid #e4e7ec", borderLeft: "3px solid #c0392b", padding: "12px 14px", borderRadius: 4, fontSize: 12, marginTop: 12, marginBottom: 12, color: "#475569" }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "#1f2937" }}>
              {activosCriticos.length} empresas requieren acción inmediata
            </div>
            <div>
              Tienen empleados o vehículos operando y al mismo tiempo tienen documentación que retiene pagos. Es la lista de llamadas del día.
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
                  <th style={{...thE2, textAlign: "left", paddingLeft: 12, color: "#475569"}}>Transporte</th>
                  <th style={{...thE2, color: "#475569"}}>Cat.</th>
                  <th style={{...thE2, color: "#475569"}}>Operación</th>
                  <th style={{...thE2, color: "#475569"}}>Subcontratista</th>
                  <th style={{...thE2, color: "#475569"}}>Activos</th>
                  <th style={{...thE2, color: "#475569"}}>% Reten.</th>
                  <th style={{...thE2, color: "#475569"}}>% Avance</th>
                  <th style={{...thE2, color: "#475569"}}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {activosCriticos.map((d, i) => (
                  <tr key={d.id || i} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                    <td style={{...tdE2, textAlign: "left", paddingLeft: 12, fontWeight: 500}}>{d.transporte}</td>
                    <td style={tdE2}><span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#1a3a6b", color: "#fff", fontWeight: 700 }}>{d.categoria}</span></td>
                    <td style={tdE2}>{d.operacion || "—"}</td>
                    <td style={tdE2}>{d.subcontratista_nombre || "—"}</td>
                    <td style={{...tdE2, textAlign: "center"}}>
                      <div style={{ fontSize: 11 }}>{d.empleados_activos || 0} emp · {d.vehiculos_activos || 0} veh</div>
                    </td>
                    <td style={{...tdE2, fontWeight: 700, color: "#c0392b"}}>{d.pct_retencion}%</td>
                    <td style={tdE2}>{d.pct_avance != null ? `${d.pct_avance}%` : "—"}</td>
                    <td style={tdE2}>{renderEstadoFinal(d.estado_final)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-componente: Editor Matriz ───────────────────────────────────
// ─── Sub-componente: Hallazgos Automáticos ──────────────────────────
// Calcula hallazgos accionables comparando datos del mes con el historial.
// Cada hallazgo tiene un nivel (alto/medio/bajo) y una sugerencia de acción.
function HallazgosAutomaticos({ datos, activosCriticos, todosInhabilitados, empresasInhabilitadasUnicas, operacionAMandante }) {
  const [estadosCertronic, setEstadosCertronic] = useState([]);
  const [matriz, setMatriz] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generandoPDF, setGenerandoPDF] = useState(false);

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      // Último snapshot de estados
      const { data: snap } = await sb.from("certronic_estados_documentos")
        .select("fecha_snapshot")
        .order("fecha_snapshot", { ascending: false }).limit(1);
      if (snap && snap[0]) {
        // Cargar TODOS los estados (paginado)
        let todos = [];
        let from = 0;
        while (true) {
          const { data } = await sb.from("certronic_estados_documentos")
            .select("*")
            .eq("fecha_snapshot", snap[0].fecha_snapshot)
            .range(from, from + 999);
          if (!data || data.length === 0) break;
          todos = todos.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        setEstadosCertronic(todos);
      }
      const { data: m } = await sb.from("certronic_matriz_documentos")
        .select("*").is("fecha_fin_vigencia", null);
      setMatriz(m || []);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  // ─── Generar PDF de hallazgos on-demand ──────────────────────────
  const descargarPDF = async () => {
    setGenerandoPDF(true);
    try {
      // Cargar jsPDF dinámicamente
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = 210, pageH = 297;
      const margin = 15;
      let y = margin;

      // Header
      pdf.setFontSize(18);
      pdf.setTextColor(26, 58, 107); // azul
      pdf.setFont("helvetica", "bold");
      pdf.text("Hallazgos Automáticos · Certificación Documental", margin, y);
      y += 7;
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.setFont("helvetica", "italic");
      pdf.text(`Generado: ${new Date().toLocaleString("es-CL")} · ${hallazgos.length} hallazgos`, margin, y);
      y += 10;

      // Resumen rápido
      pdf.setDrawColor(228, 231, 236);
      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(margin, y, pageW - 2 * margin, 18, 2, 2, "FD");
      pdf.setFontSize(9);
      pdf.setTextColor(31, 41, 55);
      pdf.setFont("helvetica", "normal");
      const resumenText = `Empresas activas: ${[...datos.pc, ...datos.ryc, ...datos.sub].filter(d => !d.recurso_inhabilitado && d.categoria === "RYC").length}  ·  Inhabilitadas: ${empresasInhabilitadasUnicas}  ·  Críticas (con retención): ${activosCriticos.length}`;
      pdf.text(resumenText, margin + 4, y + 7);
      pdf.text(`Total registros calculados: ${[...datos.pc, ...datos.ryc, ...datos.sub].length}  ·  Período: ${new Date().toLocaleDateString("es-CL", { month: "long", year: "numeric" })}`, margin + 4, y + 13);
      y += 22;

      // Hallazgos
      const colorByNivel = {
        alto: [192, 57, 43],
        medio: [244, 123, 32],
        bajo: [59, 130, 246],
      };
      const nivelLabel = { alto: "ALTA", medio: "MEDIA", bajo: "BAJA" };

      hallazgos.forEach(h => {
        // Estimar altura del bloque
        const lineasDesc = pdf.splitTextToSize(h.descripcion, pageW - 2 * margin - 10);
        const lineasImpacto = pdf.splitTextToSize(h.impacto, pageW - 2 * margin - 10);
        const lineasAccion = pdf.splitTextToSize(h.accion, pageW - 2 * margin - 10);
        const altoBloque = 30 + (lineasDesc.length + lineasImpacto.length + lineasAccion.length) * 4 + (h.ejemplos.length > 0 ? h.ejemplos.length * 4 + 8 : 0);

        // Salto de página si no entra
        if (y + altoBloque > pageH - 20) {
          pdf.addPage();
          y = margin;
        }

        const [r, g, b] = colorByNivel[h.nivel] || [100, 100, 100];

        // Línea izquierda de color
        pdf.setDrawColor(r, g, b);
        pdf.setLineWidth(1);
        pdf.line(margin, y, margin, y + altoBloque - 4);

        // Badge de nivel
        pdf.setFillColor(r, g, b);
        pdf.roundedRect(margin + 3, y + 1, 14, 5, 1, 1, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.text(nivelLabel[h.nivel], margin + 4, y + 4.5);

        // ID hallazgo
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(7);
        pdf.text(`HALLAZGO ${h.id}`, margin + 20, y + 4.5);

        y += 8;

        // Título
        pdf.setTextColor(r, g, b);
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        const lineasTitulo = pdf.splitTextToSize(h.titulo, pageW - 2 * margin - 5);
        pdf.text(lineasTitulo, margin + 3, y);
        y += lineasTitulo.length * 5 + 1;

        // Descripción
        pdf.setTextColor(31, 41, 55);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(lineasDesc, margin + 3, y);
        y += lineasDesc.length * 4 + 3;

        // Impacto
        pdf.setTextColor(r, g, b);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("Impacto:", margin + 3, y);
        y += 3.5;
        pdf.setTextColor(31, 41, 55);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.text(lineasImpacto, margin + 3, y);
        y += lineasImpacto.length * 4 + 2;

        // Acción
        pdf.setTextColor(r, g, b);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("Acción sugerida:", margin + 3, y);
        y += 3.5;
        pdf.setTextColor(31, 41, 55);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.text(lineasAccion, margin + 3, y);
        y += lineasAccion.length * 4 + 2;

        // Ejemplos
        if (h.ejemplos.length > 0) {
          pdf.setTextColor(r, g, b);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8);
          pdf.text("Ejemplos:", margin + 3, y);
          y += 3.5;
          pdf.setTextColor(31, 41, 55);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8);
          h.ejemplos.forEach(e => {
            const linea = `• ${e.nombre} — ${e.dato}`;
            const lineasEj = pdf.splitTextToSize(linea, pageW - 2 * margin - 8);
            pdf.text(lineasEj, margin + 5, y);
            y += lineasEj.length * 3.5;
          });
          y += 2;
        }

        y += 5;
      });

      // Footer en cada página
      const totalPaginas = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= totalPaginas; i++) {
        pdf.setPage(i);
        pdf.setFontSize(7);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Bigticket · Hallazgos automáticos · Página ${i} de ${totalPaginas}`, margin, pageH - 8);
      }

      const fecha = new Date().toISOString().slice(0, 10);
      pdf.save(`Hallazgos_Bigticket_${fecha}.pdf`);
    } catch(e) {
      console.error(e);
      alert("Error generando PDF: " + e.message);
    }
    setGenerandoPDF(false);
  };

  // ─── Cálculo de los 8 hallazgos automáticos ─────────────────────
  const hallazgos = useMemo(() => {
    if (loading || estadosCertronic.length === 0) return [];

    const out = [];

    // H1: Empresas activas con retención (lo más urgente)
    if (activosCriticos.length > 0) {
      out.push({
        id: "H1",
        nivel: "alto",
        icono: "🚨",
        titulo: `${activosCriticos.length} empresas activas con retención de pagos`,
        descripcion: `Estas empresas tienen empleados o vehículos operando HOY pero su documentación retiene total o parcialmente sus pagos.`,
        impacto: `Riesgo de retraso en pagos a transportistas que sí están trabajando. ${activosCriticos.filter(a => Number(a.pct_retencion) >= 100).length} con retención total (100%).`,
        accion: "Llamar a estas empresas hoy. Lista priorizada en pestaña 🚨 Activos Críticos.",
        ejemplos: activosCriticos.slice(0, 5).map(a => ({
          nombre: a.transporte + (a.subcontratista_nombre ? ` / ${a.subcontratista_nombre}` : ""),
          dato: `${a.pct_retencion}% retención · ${a.empleados_activos} emp · ${a.vehiculos_activos} veh`,
        })),
      });
    }

    // H2: Empresas inhabilitadas — distintivo Certronic por docs pendientes
    if (empresasInhabilitadasUnicas > 0) {
      out.push({
        id: "H2",
        nivel: "medio",
        icono: "⚠️",
        titulo: `${empresasInhabilitadasUnicas} empresas marcadas como Inhabilitadas en Certronic`,
        descripcion: "El distintivo INHABILITADO indica documentación pendiente. La empresa puede seguir operando pero requiere regularizar documentos.",
        impacto: "Riesgo de retención de pagos. Estas empresas siguen apareciendo en el Dashboard Mensual destacadas en rojo.",
        accion: "Revisar las empresas marcadas en rojo en las pestañas PC/RyC/SUB. Coordinar con cada contratista la entrega de documentos pendientes.",
        ejemplos: [],
      });
    }

    // H3: Vehículos sin documentación legal para circular
    const vehiculosSinDocs = estadosCertronic.filter(e => 
      e.entidad === 'vehiculo' && e.cumple === 'N' && e.impide_acceso === 'S'
    );
    const vehiculosUnicosAfectados = new Set(vehiculosSinDocs.map(v => `${v.contratista}|${v.detalle}`));
    if (vehiculosUnicosAfectados.size > 0) {
      const docsCriticos = ["Permiso de Circulación", "Revisión Técnica", "Seguro Obligatorio Vehicular", "Certificado de Emisión de Contaminantes"];
      const totalCriticos = vehiculosSinDocs.filter(v => docsCriticos.some(d => v.documento.includes(d.split(" ")[0]))).length;
      out.push({
        id: "H3",
        nivel: "alto",
        icono: "🚛",
        titulo: `${vehiculosUnicosAfectados.size} vehículos con documentación legal vencida o pendiente`,
        descripcion: "Vehículos sin Permiso de Circulación, Revisión Técnica, Seguro Obligatorio o Certificado de Emisión.",
        impacto: "Riesgo de responsabilidad solidaria para Bigticket si circulan. No deberían operar legalmente.",
        accion: "Sacar de operación inmediata. Notificar a contratistas para regularización urgente.",
        ejemplos: [...vehiculosUnicosAfectados].slice(0, 5).map(v => {
          const [contratista, detalle] = v.split("|");
          return { nombre: detalle, dato: `de ${contratista}` };
        }),
      });
    }

    // H4: Documentos que más fallan sistémicamente
    const docFallas = {};
    for (const e of estadosCertronic) {
      if (!docFallas[e.documento]) docFallas[e.documento] = { total: 0, fallas: 0, contratistas: new Set() };
      docFallas[e.documento].total++;
      if (e.cumple === 'N') {
        docFallas[e.documento].fallas++;
        docFallas[e.documento].contratistas.add(e.contratista);
      }
    }
    const topFallas = Object.entries(docFallas)
      .filter(([_, v]) => v.total >= 10 && v.fallas / v.total >= 0.4)
      .map(([doc, v]) => ({ doc, pctFalla: Math.round(v.fallas / v.total * 100), contratistas: v.contratistas.size }))
      .sort((a, b) => b.pctFalla - a.pctFalla)
      .slice(0, 5);
    if (topFallas.length > 0) {
      out.push({
        id: "H4",
        nivel: "medio",
        icono: "📋",
        titulo: `${topFallas.length} documentos fallan en más del 40% de los casos`,
        descripcion: "Documentos con tasa de no-cumplimiento alta. Indica problema sistémico, no casos puntuales.",
        impacto: "Sugiere revisar el proceso de captura de estos documentos: ¿son innecesarios? ¿están mal explicados al transportista? ¿vencen muy seguido?",
        accion: "Analizar con el mandante si el documento sigue siendo necesario o si la captura puede simplificarse.",
        ejemplos: topFallas.map(t => ({ nombre: t.doc.substring(0, 60), dato: `${t.pctFalla}% falla · ${t.contratistas} empresas` })),
      });
    }

    // H5: Top contratistas problemáticos
    const contratistaProblemas = {};
    for (const e of estadosCertronic) {
      if (e.cumple !== 'N') continue;
      if (!contratistaProblemas[e.contratista]) {
        contratistaProblemas[e.contratista] = { total: 0, retentivos: 0, accesoNegado: 0 };
      }
      contratistaProblemas[e.contratista].total++;
      if (e.impide_pago === 'S') contratistaProblemas[e.contratista].retentivos++;
      if (e.impide_acceso === 'S') contratistaProblemas[e.contratista].accesoNegado++;
    }
    const topProblema = Object.entries(contratistaProblemas)
      .map(([c, v]) => ({ contratista: c, ...v }))
      .filter(x => x.retentivos >= 10)
      .sort((a, b) => b.retentivos - a.retentivos)
      .slice(0, 5);
    if (topProblema.length > 0) {
      out.push({
        id: "H5",
        nivel: "medio",
        icono: "🥇",
        titulo: `${topProblema.length} contratistas concentran problemas extremos`,
        descripcion: "Empresas con 10 o más documentos pendientes que generan retención.",
        impacto: "Estas empresas requieren atención individual o decisión sobre su continuidad.",
        accion: "Reunión 1:1 con cada uno: ¿quieren regularizar o ya no van a operar más?",
        ejemplos: topProblema.map(t => ({ nombre: t.contratista, dato: `${t.retentivos} docs retentivos · ${t.accesoNegado} sin acceso` })),
      });
    }

    // H6: Empresas Inhabilitadas que SIGUEN OPERANDO (prioridad de regularización)
    // Estas empresas tienen empleados/vehículos activos pero Certronic las marca como
    // Inhabilitadas por documentación pendiente. Son las que requieren acción urgente.
    const inhabPeroOperan = [...datos.pc, ...datos.ryc, ...datos.sub]
      .filter(d => d.recurso_inhabilitado && (d.empleados_activos > 0 || d.vehiculos_activos > 0));
    const inhabPeroOperanUnicas = [...new Set(inhabPeroOperan.map(d => d.transporte))];
    if (inhabPeroOperanUnicas.length > 0) {
      // Calcular empleados/vehículos totales involucrados para mostrar magnitud real
      const empleadosAfectados = inhabPeroOperan.reduce((sum, d) => sum + (d.empleados_activos || 0), 0);
      const vehiculosAfectados = inhabPeroOperan.reduce((sum, d) => sum + (d.vehiculos_activos || 0), 0);
      out.push({
        id: "H6",
        nivel: "alto",
        icono: "🚨",
        titulo: `${inhabPeroOperanUnicas.length} empresas inhabilitadas operando con personal activo`,
        descripcion: `Estas empresas están marcadas como Inhabilitadas en Certronic (documentación pendiente) pero siguen operando con ${empleadosAfectados} empleado(s) y ${vehiculosAfectados} vehículo(s) activo(s). Son la prioridad #1 de regularización: están generando servicio mientras tienen retención de pago activa.`,
        impacto: "Riesgo dual: contratista no cobra (retención por docs pendientes) + Bigticket expuesto a contingencia laboral/cumplimiento por personal sin cobertura documental al día.",
        accion: "Revisar caso a caso en pestañas PC/RyC/SUB (filas en rojo). Para cada una: identificar qué documento falta (matriz de docs), contactar al contratista con plazo concreto, y escalar si no responde en 48h. Considerar suspensión operativa si pasa 7 días sin regularizar.",
        ejemplos: inhabPeroOperanUnicas.slice(0, 5).map(c => {
          const filas = inhabPeroOperan.filter(d => d.transporte === c);
          const totalEmp = filas.reduce((s, d) => s + (d.empleados_activos || 0), 0);
          const totalVeh = filas.reduce((s, d) => s + (d.vehiculos_activos || 0), 0);
          return { nombre: c, dato: `${totalEmp} emp · ${totalVeh} veh activos` };
        }),
      });
    }

    // H7: Documentos por mandante - distribución
    const porMandante = {};
    for (const e of estadosCertronic) {
      const m = e.planta;
      if (!porMandante[m]) porMandante[m] = { total: 0, retentivos: 0 };
      porMandante[m].total++;
      if (e.cumple === 'N' && e.impide_pago === 'S') porMandante[m].retentivos++;
    }
    const distMandante = Object.entries(porMandante).map(([m, v]) => ({
      mandante: m, total: v.total, retentivos: v.retentivos,
      pctRetentivos: Math.round(v.retentivos / v.total * 100),
    })).sort((a, b) => b.retentivos - a.retentivos);
    if (distMandante.length > 0) {
      const peor = distMandante[0];
      out.push({
        id: "H7",
        nivel: "bajo",
        icono: "🏭",
        titulo: `${peor.mandante} concentra el ${Math.round(peor.retentivos / distMandante.reduce((s,x) => s+x.retentivos, 0) * 100)}% de retenciones`,
        descripcion: `De los ${distMandante.reduce((s,x) => s+x.retentivos, 0)} documentos retentivos totales, ${peor.retentivos} están en ${peor.mandante}.`,
        impacto: "Permite priorizar dónde concentrar los esfuerzos de gestión documental.",
        accion: `Considerar acciones específicas para mejorar la performance en ${peor.mandante}.`,
        ejemplos: distMandante.slice(0, 5).map(d => ({ nombre: d.mandante, dato: `${d.retentivos} retentivos · ${d.pctRetentivos}% del total mandante` })),
      });
    }

    return out;
  }, [estadosCertronic, datos, activosCriticos, todosInhabilitados, loading]);

  if (loading) return <div className="loading">Calculando hallazgos...</div>;

  const colorNivel = {
    alto: { bg: "#fee2e2", border: "#fca5a5", text: "#991b1b", label: "ALTA" },
    medio: { bg: "#fef3c7", border: "#fbbf24", text: "#92400e", label: "MEDIA" },
    bajo: { bg: "#dbeafe", border: "#93c5fd", text: "#1e40af", label: "BAJA" },
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>Hallazgos Automáticos del Mes</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            {hallazgos.length} hallazgos detectados al cruzar datos del scraper, matriz y reglas de negocio. Se recalculan automáticamente cada vez que el sistema se actualiza.
          </div>
        </div>
      </div>

      {hallazgos.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#16a34a", fontSize: 14 }}>
          ✅ No se detectaron hallazgos relevantes en este período.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {hallazgos.map(h => {
            const c = colorNivel[h.nivel];
            return (
              <div key={h.id} style={{
                background: "#fff", border: `1px solid ${c.border}`, borderLeft: `4px solid ${c.text}`, borderRadius: 6,
                padding: 14,
              }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 9.5, padding: "2px 8px", borderRadius: 4,
                      background: c.text, color: "#fff", fontWeight: 700, letterSpacing: 0.5,
                    }}>
                      {c.label}
                    </span>
                    <span style={{ fontSize: 9.5, color: "#64748b", fontWeight: 600 }}>HALLAZGO {h.id}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 4 }}>
                        {h.titulo}
                      </div>
                      <div style={{ fontSize: 12, color: "#1f2937", marginBottom: 6 }}>
                        {h.descripcion}
                      </div>
                    </div>
                    <BotonDescargarExcel onClick={() => {
                      // Hoja 1: descripción del hallazgo
                      const descripcion = [
                        ["Hallazgo", `${h.id} — ${h.titulo}`],
                        ["Nivel", c.label],
                        ["Descripción", h.descripcion],
                        ["Impacto", h.impacto],
                        ["Acción sugerida", h.accion],
                        ["Generado", new Date().toLocaleString("es-CL")],
                      ];
                      
                      // Hoja 2: ejemplos
                      const headersEj = ["Nombre / Item", "Dato"];
                      const filasEj = (h.ejemplos || []).map(e => [e.nombre || "", e.dato || ""]);
                      
                      const hojas = [
                        { nombre: "Descripción", datos: descripcion },
                      ];
                      if (filasEj.length > 0) {
                        hojas.push({ nombre: "Ejemplos", datos: [headersEj, ...filasEj] });
                      }
                      
                      const nombreLimpio = (h.titulo || "Hallazgo").replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 30).trim().replace(/\s+/g, "_");
                      descargarExcelMultihoja(hojas, `Hallazgo_${h.id}_${nombreLimpio}`);
                    }} label="Excel" />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
                  <div style={{ background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: c.text, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Impacto</div>
                    <div style={{ fontSize: 11, color: "#1f2937" }}>{h.impacto}</div>
                  </div>
                  <div style={{ background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: c.text, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Acción sugerida</div>
                    <div style={{ fontSize: 11, color: "#1f2937" }}>{h.accion}</div>
                  </div>
                </div>

                {h.ejemplos.length > 0 && (
                  <div style={{ background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: c.text, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Ejemplos (top {h.ejemplos.length})</div>
                    <div style={{ display: "grid", gap: 3 }}>
                      {h.ejemplos.map((e, i) => (
                        <div key={i} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontWeight: 500, color: "#1f2937" }}>• {e.nombre}</span>
                          <span style={{ color: c.text, fontWeight: 600, whiteSpace: "nowrap" }}>{e.dato}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16, padding: "10px 14px", background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, fontSize: 11, color: "#64748b" }}>
        <strong>¿Cómo se calculan estos hallazgos?</strong> El algoritmo cruza automáticamente los datos descargados de Certronic, las reglas de la matriz y el histórico de meses anteriores para detectar patrones. Cada vez que el sistema se actualiza, los hallazgos se recalculan.
      </div>
    </div>
  );
}

function EditorMatriz() {
  const [reglas, setReglas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroMandante, setFiltroMandante] = useState("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todos");
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState(null); // id de la regla en edición
  const [formNueva, setFormNueva] = useState(null); // datos del form para nueva regla
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      const { data } = await sb.from("certronic_matriz_documentos")
        .select("*")
        .is("fecha_fin_vigencia", null)
        .order("mandante")
        .order("categoria")
        .order("doc_nombre");
      setReglas(data || []);
    } catch(e) {
      console.error(e);
      alert("Error cargando matriz: " + e.message);
    }
    setLoading(false);
  };

  const mandantes = useMemo(() => {
    return [...new Set(reglas.map(r => r.mandante))].sort();
  }, [reglas]);

  const reglasFiltradas = useMemo(() => {
    let arr = reglas;
    if (filtroMandante !== "todos") arr = arr.filter(r => r.mandante === filtroMandante);
    if (filtroCategoria !== "todos") arr = arr.filter(r => r.categoria === filtroCategoria);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      arr = arr.filter(r =>
        (r.doc_nombre || "").toLowerCase().includes(q) ||
        (r.observaciones || "").toLowerCase().includes(q)
      );
    }
    return arr;
  }, [reglas, filtroMandante, filtroCategoria, busqueda]);

  const guardarEdicion = async (regla) => {
    setGuardando(true);
    try {
      const { error } = await sb.from("certronic_matriz_documentos")
        .update({
          pct_retencion: Number(regla.pct_retencion) || 0,
          impide_acceso: regla.impide_acceso,
          impide_pago: regla.impide_pago,
          criticidad: regla.criticidad,
          periodicidad: regla.periodicidad,
          observaciones: regla.observaciones,
        })
        .eq("id", regla.id);
      if (error) throw error;
      setEditando(null);
      await cargar();
    } catch(e) {
      alert("Error guardando: " + e.message);
    }
    setGuardando(false);
  };

  const eliminarRegla = async (id) => {
    if (!confirm("¿Marcar esta regla como no vigente? (no se borra, queda histórica)")) return;
    setGuardando(true);
    try {
      const { error } = await sb.from("certronic_matriz_documentos")
        .update({ fecha_fin_vigencia: new Date().toISOString().slice(0, 10) })
        .eq("id", id);
      if (error) throw error;
      await cargar();
    } catch(e) {
      alert("Error: " + e.message);
    }
    setGuardando(false);
  };

  const guardarNueva = async () => {
    if (!formNueva.mandante || !formNueva.doc_nombre || !formNueva.categoria) {
      alert("Mandante, categoría y nombre del documento son obligatorios.");
      return;
    }
    setGuardando(true);
    try {
      const { error } = await sb.from("certronic_matriz_documentos").insert([{
        mandante: formNueva.mandante,
        categoria: formNueva.categoria,
        doc_codigo: formNueva.doc_codigo || null,
        doc_nombre: formNueva.doc_nombre,
        doc_nombre_norm: (formNueva.doc_nombre || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(),
        periodicidad: formNueva.periodicidad,
        criticidad: formNueva.criticidad,
        impide_acceso: formNueva.impide_acceso,
        impide_pago: formNueva.impide_pago,
        pct_retencion: Number(formNueva.pct_retencion) || 0,
        observaciones: formNueva.observaciones || null,
        fecha_inicio_vigencia: new Date().toISOString().slice(0, 10),
      }]);
      if (error) throw error;
      setFormNueva(null);
      await cargar();
    } catch(e) {
      alert("Error: " + e.message);
    }
    setGuardando(false);
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>Matriz de Documentos por Mandante</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            Reglas de qué documentos exige cada mandante y % de retención. {reglas.length} reglas vigentes.
          </div>
        </div>
        <button className="btn-blue" onClick={() => setFormNueva({
          mandante: mandantes[0] || "",
          categoria: "Empresa",
          doc_codigo: "",
          doc_nombre: "",
          periodicidad: "Mensual",
          criticidad: "Alta",
          impide_acceso: "NO",
          impide_pago: "SI",
          pct_retencion: 0.10,
          observaciones: "",
        })}>
          + Nueva regla
        </button>
      </div>

      {/* Filtros */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 200px", gap: 8, marginBottom: 12 }}>
        <input placeholder="🔎 Buscar documento..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select value={filtroMandante} onChange={(e) => setFiltroMandante(e.target.value)}>
          <option value="todos">Todos los mandantes</option>
          {mandantes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
          <option value="todos">Todas las categorías</option>
          <option value="Empresa">Empresa</option>
          <option value="Trabajador">Trabajador</option>
          <option value="Vehiculo">Vehículo</option>
        </select>
      </div>

      {/* Form nueva regla (modal inline) */}
      {formNueva && (
        <FormNuevaRegla
          formNueva={formNueva}
          setFormNueva={setFormNueva}
          mandantes={mandantes}
          guardando={guardando}
          onGuardar={guardarNueva}
          onCancelar={() => setFormNueva(null)}
        />
      )}

      {loading ? (
        <div className="loading">Cargando matriz…</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
              <tr style={{ background: "#1a3a6b", color: "#fff" }}>
                <th style={thE2L}>Mandante</th>
                <th style={thE2L}>Categoría</th>
                <th style={thE2L}>Documento</th>
                <th style={thE2}>Periodicidad</th>
                <th style={thE2}>Criticidad</th>
                <th style={thE2}>Imp.Acc</th>
                <th style={thE2}>Imp.Pago</th>
                <th style={thE2}>% Reten.</th>
                <th style={thE2}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reglasFiltradas.map((r, i) => (
                <FilaRegla key={r.id} regla={r} index={i}
                  editando={editando === r.id}
                  onEditar={() => setEditando(r.id)}
                  onCancelar={() => setEditando(null)}
                  onGuardar={guardarEdicion}
                  onEliminar={() => eliminarRegla(r.id)}
                  guardando={guardando} />
              ))}
            </tbody>
          </table>
          {reglasFiltradas.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#888", fontSize: 12 }}>
              No hay reglas que coincidan con los filtros.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-componente: Fila de regla (con modo edición inline) ────────
function FilaRegla({ regla, index, editando, onEditar, onCancelar, onGuardar, onEliminar, guardando }) {
  const [edit, setEdit] = useState(regla);
  useEffect(() => { setEdit(regla); }, [regla, editando]);

  if (!editando) {
    return (
      <tr style={{ borderBottom: "1px solid #f0f0f0", background: index % 2 === 0 ? "#fff" : "#fafbfc" }}>
        <td style={{...tdE2, fontWeight: 600, color: "#1a3a6b"}}>{regla.mandante}</td>
        <td style={tdE2}>{regla.categoria}</td>
        <td style={{...tdE2, textAlign: "left"}}>
          {regla.doc_codigo && <span style={{ fontSize: 9, color: "#94a3b8", marginRight: 4 }}>{regla.doc_codigo}</span>}
          {regla.doc_nombre}
          {regla.observaciones && <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{regla.observaciones}</div>}
        </td>
        <td style={tdE2}>{regla.periodicidad || "—"}</td>
        <td style={tdE2}>{regla.criticidad || "—"}</td>
        <td style={tdE2}>{regla.impide_acceso === "SI" ? "✓" : "✗"}</td>
        <td style={tdE2}>{regla.impide_pago === "SI" ? "✓" : "✗"}</td>
        <td style={{...tdE2, fontWeight: 700, color: regla.pct_retencion > 0 ? "#c0392b" : "#94a3b8"}}>
          {regla.pct_retencion ? `${Math.round(regla.pct_retencion * 100)}%` : "—"}
        </td>
        <td style={tdE2}>
          <button onClick={onEditar} style={btnIcon}>✏️</button>
          <button onClick={onEliminar} style={{...btnIcon, color: "#c0392b"}}>🗑</button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ background: "#fef3c7", borderBottom: "2px solid #fbbf24" }}>
      <td style={tdE2}>{regla.mandante}</td>
      <td style={tdE2}>{regla.categoria}</td>
      <td style={{...tdE2, textAlign: "left", fontSize: 11}}>{regla.doc_nombre}</td>
      <td style={tdE2}>
        <select value={edit.periodicidad || ""} onChange={(e) => setEdit({...edit, periodicidad: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="Mensual">Mensual</option>
          <option value="Anual">Anual</option>
          <option value="Inicial">Inicial</option>
          <option value="Esporadico">Esporádico</option>
          <option value="Con Vencimiento">Con Vencimiento</option>
          <option value="Presentación Única">Presentación Única</option>
          <option value="Cese">Cese</option>
        </select>
      </td>
      <td style={tdE2}>
        <select value={edit.criticidad || ""} onChange={(e) => setEdit({...edit, criticidad: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="Alta">Alta</option>
          <option value="Media">Media</option>
          <option value="Baja">Baja</option>
        </select>
      </td>
      <td style={tdE2}>
        <select value={edit.impide_acceso || ""} onChange={(e) => setEdit({...edit, impide_acceso: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="SI">SI</option>
          <option value="NO">NO</option>
        </select>
      </td>
      <td style={tdE2}>
        <select value={edit.impide_pago || ""} onChange={(e) => setEdit({...edit, impide_pago: e.target.value})}
          style={inputMini}>
          <option value="">—</option>
          <option value="SI">SI</option>
          <option value="NO">NO</option>
        </select>
      </td>
      <td style={tdE2}>
        <input type="number" step="0.01" min="0" max="1"
          value={edit.pct_retencion || 0}
          onChange={(e) => setEdit({...edit, pct_retencion: e.target.value})}
          style={{...inputMini, width: 70}} />
        <div style={{ fontSize: 9, color: "#64748b" }}>0.10 = 10%</div>
      </td>
      <td style={tdE2}>
        <button onClick={() => onGuardar(edit)} disabled={guardando} style={{...btnIcon, color: "#16a34a"}}>💾</button>
        <button onClick={onCancelar} style={btnIcon}>✗</button>
      </td>
    </tr>
  );
}

// ─── Sub-componente: Form nueva regla ────────────────────────────────
function FormNuevaRegla({ formNueva, setFormNueva, mandantes, guardando, onGuardar, onCancelar }) {
  const [nuevoMandante, setNuevoMandante] = useState(false);
  return (
    <div style={{
      background: "#eef2ff", border: "2px solid #3b82f6", borderRadius: 8,
      padding: 14, marginBottom: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e40af", marginBottom: 10 }}>
        + Nueva regla en la matriz
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <div>
          <label style={lbl}>Mandante</label>
          {nuevoMandante ? (
            <div style={{ display: "flex", gap: 4 }}>
              <input value={formNueva.mandante} onChange={(e) => setFormNueva({...formNueva, mandante: e.target.value})}
                placeholder="Nombre del mandante" />
              <button onClick={() => setNuevoMandante(false)} style={btnIcon}>↩</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 4 }}>
              <select value={formNueva.mandante} onChange={(e) => setFormNueva({...formNueva, mandante: e.target.value})}>
                {mandantes.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={() => { setFormNueva({...formNueva, mandante: ""}); setNuevoMandante(true); }} 
                style={btnIcon} title="Crear nuevo mandante">+</button>
            </div>
          )}
        </div>
        <div>
          <label style={lbl}>Categoría</label>
          <select value={formNueva.categoria} onChange={(e) => setFormNueva({...formNueva, categoria: e.target.value})}>
            <option value="Empresa">Empresa</option>
            <option value="Trabajador">Trabajador</option>
            <option value="Vehiculo">Vehículo</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Código (opcional)</label>
          <input value={formNueva.doc_codigo || ""} onChange={(e) => setFormNueva({...formNueva, doc_codigo: e.target.value})}
            placeholder="ej: 1.1" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Nombre del documento *</label>
          <input value={formNueva.doc_nombre} onChange={(e) => setFormNueva({...formNueva, doc_nombre: e.target.value})}
            placeholder="ej: Certificado de Antecedentes" />
        </div>
        <div>
          <label style={lbl}>Periodicidad</label>
          <select value={formNueva.periodicidad} onChange={(e) => setFormNueva({...formNueva, periodicidad: e.target.value})}>
            <option value="Mensual">Mensual</option>
            <option value="Anual">Anual</option>
            <option value="Inicial">Inicial</option>
            <option value="Esporadico">Esporádico</option>
            <option value="Con Vencimiento">Con Vencimiento</option>
            <option value="Presentación Única">Presentación Única</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Criticidad</label>
          <select value={formNueva.criticidad} onChange={(e) => setFormNueva({...formNueva, criticidad: e.target.value})}>
            <option value="Alta">Alta</option>
            <option value="Media">Media</option>
            <option value="Baja">Baja</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Impide Acceso</label>
          <select value={formNueva.impide_acceso} onChange={(e) => setFormNueva({...formNueva, impide_acceso: e.target.value})}>
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Impide Pago</label>
          <select value={formNueva.impide_pago} onChange={(e) => setFormNueva({...formNueva, impide_pago: e.target.value})}>
            <option value="SI">SI</option>
            <option value="NO">NO</option>
          </select>
        </div>
        <div>
          <label style={lbl}>% Retención (0-1)</label>
          <input type="number" step="0.01" min="0" max="1"
            value={formNueva.pct_retencion}
            onChange={(e) => setFormNueva({...formNueva, pct_retencion: e.target.value})} />
          <div style={{ fontSize: 9, color: "#64748b" }}>0.10 = 10%</div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={lbl}>Observaciones</label>
          <input value={formNueva.observaciones || ""} onChange={(e) => setFormNueva({...formNueva, observaciones: e.target.value})}
            placeholder="opcional" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button onClick={onCancelar} className="btn-back">Cancelar</button>
        <button onClick={onGuardar} className="btn-blue" disabled={guardando}>
          {guardando ? "⏳..." : "💾 Crear regla"}
        </button>
      </div>
    </div>
  );
}

// Helpers visuales del módulo Pagos
function KPI({ label, valor, sub, color = "#1a3a6b" }) {
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

const thE = {
  padding: "10px 8px", textAlign: "center", fontSize: 10,
  fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
  cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  borderRight: "1px solid rgba(255,255,255,0.1)",
};
const thE2 = {
  padding: "8px 10px", textAlign: "center", fontSize: 10,
  fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
  whiteSpace: "nowrap",
};
const thE2L = { ...thE2, textAlign: "left" };
const tdE = {
  padding: "8px 6px", textAlign: "center", verticalAlign: "middle",
  borderRight: "1px solid #f4f5f7",
};
const tdE2 = {
  padding: "8px 10px", textAlign: "center", verticalAlign: "middle",
};
const btnIcon = {
  border: "none", background: "transparent", cursor: "pointer",
  fontSize: 14, padding: "4px 6px", margin: "0 2px",
};
const inputMini = {
  fontSize: 11, padding: "4px 6px", borderRadius: 4, border: "1px solid #cbd5e1",
  width: "100%",
};
const lbl = {
  display: "block", fontSize: 10, fontWeight: 600,
  color: "#64748b", textTransform: "uppercase", marginBottom: 3, letterSpacing: 0.3,
};

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
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #F47B20", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Deficientes (-3%)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#F47B20", marginTop: 2 }}>{totalDeficientes}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>NS &lt; 95%</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Total viajes</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{viajes.length}</div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>Viajes con Penalización ({penalizados.length})</div>
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
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{viajes.length}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>% Premiado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>
            {viajes.length > 0 ? ((premiados.length / viajes.length) * 100).toFixed(1) : 0}%
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>Viajes con Premio ({premiados.length})</div>
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
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #1a3a6b", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Total rutas</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>{consolidados.length}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #16a34a", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Confirmados</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>{totalConHelper}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>≥3 snapshots con helper</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #F47B20", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Sospechosos</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#F47B20", marginTop: 2 }}>{totalSospechosos}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>1-2 snapshots con helper</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderLeft: "3px solid #1a3a6b", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Pago auxiliares</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1a3a6b", marginTop: 2 }}>${(totalConHelper * 300).toLocaleString("es-MX")}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>${300} × {totalConHelper} rutas</div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b" }}>Detalle de Ayudantes ({consolidados.length})</div>
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
                const colorEstado = estado === "OK" ? "#16a34a" : estado === "SOSPECHOSO" ? "#F47B20" : "#94a3b8";
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
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>
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
                border: "1px solid " + (filtroTipo === f.id ? "#1a3a6b" : "#e4e7ec"),
                background: filtroTipo === f.id ? "#1a3a6b" : "#fff",
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
                      <td style={{ ...tdStyle(), textAlign: "right", fontWeight: 600, color: "#1a3a6b" }}>
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
                            background: expandedThis ? "#1a3a6b" : "#fff",
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
      <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>
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

function ModuloCertificacionesMadre() {
  const [subtab, setSubtab] = useState("ingresos");
  const tabs = [
    { id: "ingresos",    label: "Proceso de Certificaciones MX", desc: "Drivers MX (Mercado Libre)" },
  ];
  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>Certificaciones</div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginLeft: -8, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                background: "transparent", border: "none", padding: "10px 16px",
                fontSize: 13, fontWeight: 600, cursor: "pointer", color: subtab === t.id ? "#1a3a6b" : "#64748b",
                borderBottom: subtab === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
                marginBottom: -2,
                transition: "all 0.15s",
              }}>
              <div>{t.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
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
            style={{ padding: "8px 14px", background: "#1a3a6b", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer" }}>
            {showCarga ? "Cerrar" : "Subir Excel"}
          </button>
        </div>
      </div>

      {/* Carga Excel */}
      {showCarga && (
        <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 6, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a3a6b", marginBottom: 8 }}>Carga Masiva desde Excel</div>
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b" }}>Preview</div>
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
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>Tarifario Base MELI MX</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{data.length} tarifas · 4 zonas × 3 tipologías × 5 tramos · MXN</div>
      </div>
      {zonas.map(z => (
        <div key={z} style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>Zona {z}</div>
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
// Colores + fuente: Brain (Geist · #1a3a6b · #F47B20 · #f0f2f5)
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
          border: 'none', background: '#1a3a6b', color: '#fff', cursor: 'pointer',
          fontFamily: "'Geist', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5,
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
          border: 'none', background: '#1a3a6b', color: '#fff', cursor: 'pointer',
          fontFamily: "'Geist', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 5,
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
  return <td style={{ padding: '8px 10px', fontSize: small ? 11 : 12, fontFamily: mono ? 'monospace' : "'Geist', sans-serif", color: muted ? '#64748b' : '#1a1a1a', fontWeight: bold ? 600 : 'normal', textAlign: center ? 'center' : 'left' }}>{children}</td>;
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
    color: activo ? "#1a3a6b" : "#fff",
    border: "1px solid rgba(255,255,255,0.3)",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Geist', sans-serif",
    transition: "all 0.15s",
  });
  
  const estiloToggle = (activo) => ({
    padding: "6px 14px",
    background: activo ? "#fff" : "rgba(255,255,255,0.1)",
    color: activo ? "#1a3a6b" : "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Geist', sans-serif",
  });
  
  return (
    <div className="pg">
      {/* Header con selector de fecha */}
      <div style={{
        background: "linear-gradient(135deg, #1a3a6b 0%, #2d4f8e 100%)",
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
                       color: botonDiaActivo === 'custom' ? "#1a3a6b" : "#fff",
                       border: "1px solid rgba(255,255,255,0.3)",
                       borderRadius: 6,
                       fontSize: 12,
                       fontWeight: 600,
                       cursor: "pointer",
                       fontFamily: "'Geist', sans-serif",
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
                       color: botonRangoActivo === 'custom' ? "#1a3a6b" : "#fff",
                       border: "1px solid rgba(255,255,255,0.3)",
                       borderRadius: 6,
                       fontSize: 12,
                       fontWeight: 600,
                       cursor: "pointer",
                       fontFamily: "'Geist', sans-serif",
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
                       color: botonRangoActivo === 'custom' ? "#1a3a6b" : "#fff",
                       border: "1px solid rgba(255,255,255,0.3)",
                       borderRadius: 6,
                       fontSize: 12,
                       fontWeight: 600,
                       cursor: "pointer",
                       fontFamily: "'Geist', sans-serif",
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
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>Cumplimiento de Promesa</div>
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
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>
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
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>Nivel de Servicio</div>
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
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
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
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a6b", textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "space-between" }}>
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
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1a3a6b", display: "flex", justifyContent: "space-between" }}>
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
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1a3a6b", display: "flex", justifyContent: "space-between" }}>
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
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>Nivel de Visitados</div>
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
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>PNR del día anterior</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Casos creados el {fechaTexto}</div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#1a3a6b" }}>
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
              <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a6b" }}>{modal.titulo}</div>
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
            background: modo === "dia" ? "#1a3a6b" : "transparent",
            color: modo === "dia" ? "#fff" : "#475569"
          }}>Día</button>
          <button onClick={() => setModo("rango")} style={{
            padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
            border: "none", cursor: "pointer",
            background: modo === "rango" ? "#1a3a6b" : "transparent",
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
        background: "linear-gradient(135deg, #1a3a6b 0%, #0f1e3d 100%)",
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
            { label: "Ofrecidas por Meli", valor: totOfr, color: "#1a3a6b", colorLight: "#3b5fa3", pct: 100, onClick: () => abrirOfrecidas(), sublabel: "Total recibido" },
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
                cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
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
    { label: "Volumen",       pts: 30, desc: "Días trabajados",   color: "#1a3a6b" },
    { label: "Performance",   pts: 25, desc: "DPPH (paq/hora)",   color: "#0891b2" },
    { label: "Confiabilidad", pts: 20, desc: "% entrega exitosa", color: "#F47B20" },
    { label: "Compliance",    pts: 15, desc: "Master + CURP",     color: "#ca8a04" },
    { label: "Estabilidad",   pts: 10, desc: "Mismo SC",          color: "#94a3b8" },
  ];

  return (
    <div className="pg">
      <div style={{ background: "linear-gradient(135deg, #1a3a6b 0%, #0f2647 100%)", borderRadius: 12, padding: 24, color: "#fff", marginBottom: 16 }}>
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
      <div style={{ background: "linear-gradient(135deg, #1a3a6b 0%, #0f2647 100%)", borderRadius: 12, padding: 20, color: "#fff", marginBottom: 16 }}>
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
              borderRadius: 6, background: "#fff", color: "#1a3a6b", cursor: "pointer",
              fontFamily: "'Geist', sans-serif", whiteSpace: "nowrap" }}>{hallazgo.accion.label} →</button>
        )}
        {hallazgo.accion2 && (
          <button onClick={hallazgo.accion2.onClick}
            style={{ padding: "6px 12px", fontSize: 11, fontWeight: 500, border: "none",
              background: "transparent", color: "#64748b", cursor: "pointer",
              fontFamily: "'Geist', sans-serif", whiteSpace: "nowrap" }}>{hallazgo.accion2.label}</button>
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
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b", marginBottom: 4 }}>
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
                  fontSize: 13, fontWeight: 600, cursor: "pointer", color: vista === t.id ? "#1a3a6b" : "#64748b",
                  borderBottom: vista === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
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
                border: "1px solid #cbd5e1", background: "#fff", color: "#1a3a6b",
                cursor: "pointer", fontFamily: "'Geist', sans-serif", outline: "none",
                width: "auto",
              }} />
            <button onClick={cargarDatos} disabled={loading}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: "1px solid #cbd5e1", background: "#fff", color: "#475569",
                cursor: loading ? "wait" : "pointer", fontFamily: "'Geist', sans-serif",
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
    { label: "Rutas con helper flag", valor: total_con_flag, sub: "declarados en MELI hoy", color: "#1a3a6b" },
    { label: "Correctas", valor: correctas, sub: "helper trabajó realmente", color: "#16a34a" },
    { label: "Fantasma", valor: fantasma, sub: `BT paga $${(costo_bt_cuestionable).toLocaleString("es-MX")} sin entrega`, color: "#c0392b" },
    { label: "Raras", valor: raras, sub: "solo el helper entregó", color: "#F47B20" },
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
              <div style={{ flex: raras, background: "#F47B20", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#F47B20" }}></div>
              <span><strong style={{ color: "#F47B20" }}>Raro</strong> — solo el helper entregó · investigar</span>
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
          <div style={{ fontSize: 11, fontWeight: 500, color: "#1a3a6b" }}>Ver universo →</div>
        </div>

        <div className="form-card" style={{ padding: 16, marginBottom: 0, cursor: "pointer" }} onClick={() => onIr("u2")}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            U2 · Desviaciones autorizados
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#F47B20", marginBottom: 4 }}>
            {fantasma_autoriz}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
            fantasmas en SC con tarifa activa
          </div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#1a3a6b" }}>Ver universo →</div>
        </div>

        <div className="form-card" style={{ padding: 16, marginBottom: 0, cursor: "pointer" }} onClick={() => onIr("u3")}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
            U3 · Detalle completo
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#1a3a6b", marginBottom: 4 }}>
            {stats.total_con_flag}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 10 }}>
            rutas listadas con filtros
          </div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "#1a3a6b" }}>Ver detalle →</div>
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
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e4e7ec", fontSize: 13, fontWeight: 600, color: "#1a3a6b" }}>
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
                  <td style={{ ...hmxTd, fontWeight: 700, color: "#1a3a6b" }}>{s.sc}</td>
                  <td style={hmxTdR}>{s.total}</td>
                  <td style={{ ...hmxTdR, color: s.correctas > 0 ? "#16a34a" : "#cbd5e1" }}>{s.correctas}</td>
                  <td style={{ ...hmxTdR, color: s.fantasma > 0 ? "#c0392b" : "#cbd5e1", fontWeight: s.fantasma > 0 ? 700 : 400 }}>{s.fantasma}</td>
                  <td style={{ ...hmxTdR, color: s.raras > 0 ? "#F47B20" : "#cbd5e1" }}>{s.raras}</td>
                  <td style={{ ...hmxTdR, fontWeight: 700, color: "#c0392b" }}>${s.costo_bt.toLocaleString("es-MX")}</td>
                  <td style={{ ...hmxTdR, fontSize: 11, color: "#1a3a6b", fontWeight: 600 }}>Ver detalle →</td>
                </tr>
              ))}
              <tr style={{ background: "#f9fafb", borderTop: "1px solid #e5e7eb", fontWeight: 700 }}>
                <td style={{ ...hmxTd, fontWeight: 700, color: "#1a3a6b" }}>Total</td>
                <td style={hmxTdR}>{totalRutas}</td>
                <td style={hmxTdR}>{scsNoAut.reduce((a, s) => a + s.correctas, 0)}</td>
                <td style={{ ...hmxTdR, color: "#c0392b" }}>{totalFantasma}</td>
                <td style={{ ...hmxTdR, color: "#F47B20" }}>{scsNoAut.reduce((a, s) => a + s.raras, 0)}</td>
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
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e4e7ec", fontSize: 13, fontWeight: 600, color: "#1a3a6b" }}>
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
                    <td style={{ ...hmxTd, fontWeight: 700, color: "#1a3a6b" }}>{s.sc}</td>
                    <td style={hmxTdR}>{s.total}</td>
                    <td style={{ ...hmxTdR, color: s.correctas > 0 ? "#16a34a" : "#cbd5e1" }}>{s.correctas}</td>
                    <td style={{ ...hmxTdR, color: s.fantasma > 0 ? "#c0392b" : "#cbd5e1", fontWeight: s.fantasma > 0 ? 700 : 400 }}>{s.fantasma}</td>
                    <td style={{ ...hmxTdR, color: s.raras > 0 ? "#F47B20" : "#cbd5e1" }}>{s.raras}</td>
                    <td style={{ ...hmxTdR, fontWeight: 700, color: pct >= 75 ? "#16a34a" : pct >= 50 ? "#F47B20" : "#c0392b" }}>{pct}%</td>
                    <td style={{ ...hmxTdR, fontSize: 11, color: "#1a3a6b", fontWeight: 600 }}>Ver detalle →</td>
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
                  <td style={{ ...hmxTd, fontWeight: 700, color: "#1a3a6b" }}>{r.sc || "—"}</td>
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
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a6b" }}>{detalle.filtro}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>·</span>
        <span style={{ fontSize: 12, color: "#64748b" }}>{detalle.datos.length} rutas</span>
        <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "'Geist', sans-serif" }}>
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
          <div style={{ fontSize:16, fontWeight:700, color:"#1a3a6b" }}>Registrar evento · {patente}</div>
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
          <Btn onClick={guardar} color="#1a3a6b">{guardando?"Guardando…":"Guardar evento"}</Btn>
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
      (mant.data||[]).forEach(r => ev.push({ tipo:"Mantención", color:"#1a3a6b", bg:"#eef2ff", fecha:r.fecha_servicio, desc:r.servicio_efectuado||r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.costo)||0 }));
      (rep.data||[]).forEach(r => ev.push({ tipo:"Reparación", color:"#0369a1", bg:"#e0f2fe", fecha:r.fecha_servicio, desc:r.servicio_efectuado||r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.costo)||0 }));
      (sin.data||[]).forEach(r => ev.push({ tipo:"Siniestro", color:"#c0392b", bg:"#fee2e2", fecha:r.fecha_servicio, desc:r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.precio_reparacion_total)||Number(r.costo)||0 }));
      (otr.data||[]).forEach(r => ev.push({ tipo:"Otro", color:"#92400e", bg:"#fef3c7", fecha:r.fecha_servicio, desc:r.servicio_efectuado||r.item, taller:r.taller, odometro:r.km_al_momento, costo:Number(r.costo)||0 }));
      (eve.data||[]).forEach(r => { const tc=({mantencion:["Mantención","#1a3a6b","#eef2ff"],reparacion:["Reparación","#0369a1","#e0f2fe"],siniestro:["Siniestro","#c0392b","#fee2e2"],otro:["Otro","#92400e","#fef3c7"]})[r.tipo]||["Evento","#475569","#f1f5f9"]; ev.push({ tipo:tc[0]+(r.componente?` · ${r.componente}`:""), color:tc[1], bg:tc[2], fecha:r.fecha_servicio, desc:r.descripcion||r.item, taller:r.taller, odometro:r.odometro, costo:Number(r.costo)||0, adjunto:r.adjunto_url }); });
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
          <Btn onClick={buscar} color="#1a3a6b">{cargando ? "Buscando…" : "Buscar"}</Btn>
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
                <Btn onClick={()=>setMostrarForm(true)} color="#1a3a6b" small>+ Registrar evento</Btn>
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
            <KPI label="Gasto total" valor={clp(data.resumen.total)} color="#1a3a6b" />
            <KPI label="Eventos" valor={data.resumen.n} sub="en el historial" color="#0369a1" />
            <KPI label="Mantenciones" valor={clp(data.resumen.mant)} color="#1a3a6b" />
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
          <Btn onClick={cargar} color="#1a3a6b" outline>{cargando?"Cargando…":"Refrescar"}</Btn>
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
        <div style={{ background:"#1a3a6b", color:"#fff", borderRadius:"14px 14px 0 0", padding:"16px 20px", display:"flex", alignItems:"center", gap:10 }}>
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
            <Btn onClick={verificar} color="#1a3a6b">{cargando?"Verificando…":"Verificar"}</Btn>
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
                <KPI label="KM restantes al límite" valor={fmt(kmRest)} color={kmRest!=null&&kmRest<0?"#dc2626":"#1a3a6b"} />
              </div>
              <div style={{ borderTop:"1px solid #e4e7ec", paddingTop:16 }}>
                {(r.estado==="alerta"||r.estado==="supera_limite") ? (
                  <Btn onClick={generarSolicitud} color="#1a3a6b">{generando?"Generando…":"Generar solicitud para finanzas"}</Btn>
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

      <div style={{ fontSize:15, fontWeight:700, color:"#1a3a6b", marginBottom:4 }}>Panorama de la flota</div>
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
        <Btn onClick={cargar} color="#1a3a6b" outline>{cargando?"Cargando…":"Refrescar"}</Btn>
        <div style={{ fontSize:11, color:"#94a3b8", marginLeft:"auto", maxWidth:280 }}>
          Costo por componente×modelo (fallback global). "s/d" = sin historial de precio.
        </div>
      </div>

      {error && <div style={{ padding:"10px 14px", background:"#fee2e2", color:"#c0392b", borderRadius:8, fontSize:13, marginBottom:16 }}>{error}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:16 }}>
        <KPI label="Caja total estimada" valor={clp(sum(items))} sub={`${items.length} cambios`} color="#1a3a6b" />
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
          <Btn onClick={cargar} color="#1a3a6b" outline>{cargando?"Cargando…":"Refrescar"}</Btn>
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
                    <td style={td}><button onClick={()=>guardarVeh(r.patente)} disabled={guardando==="v:"+r.patente} style={{ fontSize:11, fontWeight:700, padding:"5px 12px", borderRadius:6, border:"none", background:"#1a3a6b", color:"#fff", cursor:"pointer" }}>{guardando==="v:"+r.patente?"…":"Guardar"}</button></td>
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
                    <td style={td}><button onClick={()=>guardarSup(r.nombre)} disabled={guardando==="s:"+r.nombre} style={{ fontSize:11, fontWeight:700, padding:"5px 12px", borderRadius:6, border:"none", background:"#1a3a6b", color:"#fff", cursor:"pointer" }}>{guardando==="s:"+r.nombre?"…":"Guardar"}</button></td>
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

function ModuloMantencionesMadre({ usuario }) {
  const [sub, setSub] = useState("verificador");
  const tabs = [
    { id: "verificador", label: "Verificador de Componentes" },
    { id: "ficha",       label: "Ficha Vehículo" },
    { id: "costos",      label: "Flujo de Caja" },
    { id: "bitacora",    label: "Bitácora" },
    { id: "supervisores", label: "Supervisores" },
  ];
  return (
    <div className="pg">
      <div className="sec-title">Mantenciones · Cuidado de Activo</div>
      <div className="sec-sub">Control de protocolo de flota — Bigticket</div>
      <div style={{ display:"flex", gap:4, borderBottom:"1px solid #e4e7ec", marginBottom:20, overflowX:"auto" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={()=>setSub(t.id)} style={{
            padding:"10px 16px", background:"none", border:"none",
            borderBottom: sub===t.id ? "2px solid #1a3a6b" : "2px solid transparent",
            color: sub===t.id ? "#1a3a6b" : "#64748b", fontSize:13, fontWeight:700,
            cursor:"pointer", whiteSpace:"nowrap", marginBottom:-1, fontFamily:"'Geist',sans-serif"
          }}>{t.label}</button>
        ))}
      </div>
      {sub === "verificador" && <VerificadorComponentes usuario={usuario} />}
      {sub === "ficha"       && <FichaVehiculo usuario={usuario} />}
      {sub === "costos"      && <FlujoCaja />}
      {sub === "bitacora"    && <Bitacora usuario={usuario} />}
      {sub === "supervisores" && <MantenedorSupervisores />}
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
      <div style={{ background:"#1a3a6b", color:"#fff", borderRadius:"14px 14px 0 0", padding:"16px 20px", display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:18 }}>🚚</span>
        <span style={{ fontSize:15, fontWeight:700 }}>Verificador de estado de neumáticos — Bigticket</span>
      </div>
      <div style={{ background:"#fff", border:"1px solid #e4e7ec", borderTop:"none", borderRadius:"0 0 14px 14px", padding:20, marginBottom:16 }}>
        <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 220px" }}>
            <Label>Patente</Label>
            <Input value={patente} onChange={e=>setPatente(e.target.value.toUpperCase())} placeholder="Ej: SLCY14" />
          </div>
          <Btn onClick={verificar} color="#1a3a6b">{cargando ? "Verificando…" : "Verificar"}</Btn>
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
                    return <span key={t} style={{ fontSize:11, fontWeight:700, padding:"4px 8px", borderRadius:6, background:on?"#1a3a6b":"#f1f5f9", color:on?"#fff":"#94a3b8" }}>{t}</span>;
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
              <KPI label="KM restantes al límite" valor={fmt(info.kmRestantes)} color={info.kmRestantes!=null && info.kmRestantes<0 ? "#dc2626" : "#1a3a6b"} />
            </div>

            <div style={{ borderTop:"1px solid #e4e7ec", paddingTop:16 }}>
              {(info.estado==="alerta" || info.estado==="supera_limite") ? (
                <Btn onClick={generarSolicitud} color="#1a3a6b">{generando ? "Generando…" : "Generar solicitud para finanzas"}</Btn>
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
        .selpais-wrap{position:fixed;inset:0;display:flex;flex-direction:column;background:#eef1f5;font-family:'Geist',system-ui,-apple-system,sans-serif;overflow:auto;}
        .selpais-top{display:flex;align-items:center;justify-content:space-between;padding:16px 26px;border-top:3px solid #1a3a6b;}
        .selpais-brand{font-size:18px;font-weight:800;letter-spacing:-.3px;}
        .selpais-exit{background:none;border:none;color:#8a94a6;font-size:13px;cursor:pointer;}
        .selpais-exit:hover{color:#1a3a6b;}
        .selpais-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 24px 60px;}
        .selpais-title{font-size:26px;font-weight:800;color:#1a3a6b;text-align:center;letter-spacing:-.4px;}
        .selpais-sub{font-size:14px;color:#8a94a6;margin-top:6px;text-align:center;}
        .selpais-grid{display:flex;flex-wrap:wrap;gap:22px;justify-content:center;margin-top:34px;}
        .selpais-card{width:200px;background:#fff;border:1px solid #e6e9ef;border-radius:16px;padding:30px 24px;display:flex;flex-direction:column;align-items:center;gap:16px;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease;box-shadow:0 1px 2px rgba(16,32,64,.04);}
        .selpais-card:hover{transform:translateY(-4px);box-shadow:0 14px 30px -12px rgba(16,32,64,.28);border-color:#F47B20;}
        .selpais-flag{width:78px;height:52px;object-fit:cover;border-radius:6px;box-shadow:0 2px 8px rgba(16,32,64,.18);}
        .selpais-label{font-size:16px;font-weight:700;color:#1a3a6b;}
      `}</style>
      <div className="selpais-top">
        <div className="selpais-brand"><span style={{ color: "#1a3a6b" }}>Big</span><span style={{ color: "#F47B20" }}>ticket</span></div>
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

  const handleLogin = (u) => {
    localStorage.setItem("bt_usuario", JSON.stringify(u));
    setUsuario(u);
  };
  const handleLogout = () => {
    localStorage.removeItem("bt_usuario");
    try { localStorage.removeItem("bt_nav_tab"); localStorage.removeItem("bt_nav_subtab_pagos"); localStorage.removeItem("bt_pais"); } catch {}
    setPaisState(null);
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

  const mods = modulosVisibles(pais, usuario.rol);
  const tabActivo = mods.includes(tab) ? tab : (mods[0] || null);
  const paisCfg = PAIS_SELECT_CFG[pais] || null;
  return (
    <>
      <style>{css}</style>
      <div>
        <div className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={BIGGY_IMG} alt="Biggy" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", border: "1.5px solid #F47B20" }} />
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              <span style={{ color: "#F47B20" }}>Big</span><span style={{ color: "#fff" }}>ticket</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={cambiarPais} title="Cambiar operación" style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 20, padding: "4px 10px", cursor: "pointer" }}>
              {paisCfg && <img src={`https://flagcdn.com/w40/${paisCfg.code}.png`} alt={pais} style={{ width: 18, height: 12, objectFit: "cover", borderRadius: 2 }} />}
              <span style={{ fontSize: 12, color: "#eaf2ff", fontWeight: 600 }}>{pais}</span>
              <span style={{ fontSize: 10, color: "#aac3e8" }}>▾</span>
            </button>
            <span style={{ fontSize: 12, color: "#aac3e8" }}>👤 {usuario.nombre}</span>
            <button className="btn-gw" onClick={handleLogout}>Salir</button>
          </div>
        </div>
        <div className="admin-nav">
          {mods.map(k => (
            <button key={k} className={`nav-btn ${tabActivo === k ? "active" : ""}`} onClick={() => setTab(k)}>
              {MODULOS_LABELS[k]}
            </button>
          ))}
        </div>
        {tabActivo === "pool_meli_mx" && <ModuloPoolMeliMX usuario={usuario} />}
        {tabActivo === "certificaciones" && <ModuloCertificacionesMadre />}
        {tabActivo === "certificaciones_cl" && <ModuloCertificacionesCL certronicSlot={<ModuloPagos />} />}
        {tabActivo === "mantenciones_cl" && <ModuloMantencionesMadre usuario={usuario} />}
        {tabActivo === "maestro_cl" && <ModuloMaestroCL />}
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
                  <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 20, background: u.rol === "superadmin" ? "#eef2ff" : "#f0fdf4", color: u.rol === "superadmin" ? "#1a3a6b" : "#166534", fontWeight: 600 }}>
                    {u.rol}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tabActivo === "maestro" && <ModuloMaestro usuario={usuario} />}
        {tabActivo === "pnr" && <ModuloPNR />}
        {tabActivo === "auditoria_meli" && <ModuloAuditoriaMeli />}
        {tabActivo === "pagos" && <ModuloPagosMadre usuario={usuario} />}
        {!tabActivo && (
          <div className="pg" style={{ maxWidth: 720 }}>
            <div className="sec-title">Operación {pais}</div>
            <div className="sec-sub">Estamos construyendo los módulos de {pais}</div>
            <div className="form-card">
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.9 }}>
                Todavía no hay módulos disponibles para esta operación. Se irán habilitando aquí a medida que se desarrollen.{" "}
                <button onClick={cambiarPais} style={{ background: "none", border: "none", color: "#F47B20", cursor: "pointer", padding: 0, fontWeight: 600 }}>Cambiar de operación</button>.
              </div>
            </div>
          </div>
        )}
      </div>
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
