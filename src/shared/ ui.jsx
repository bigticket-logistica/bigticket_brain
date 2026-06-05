export function objetosATabla(objetos, columnas) {
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
export function BotonDescargarExcel({ onClick, disabled, label = "Descargar Excel" }) {
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

export const Btn = ({ children, onClick, color="#3B82F6", outline=false, small=false }) => (
  <button onClick={onClick} style={{
    background:outline?"transparent":color, color:outline?color:"white",
    border:`1px solid ${color}`, borderRadius:8,
    padding:small?"5px 12px":"9px 18px", fontSize:small?11:12,
    cursor:"pointer", fontWeight:700, fontFamily:"'Outfit',sans-serif", transition:"all .2s"
  }}>{children}</button>
);

export const Input = ({ value, onChange, placeholder, type="text", style={} }) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder}
    style={{width:"100%",background:"#f0f2f5",color:"#1a1a1a",border:"1px solid #e4e7ec",
      borderRadius:8,padding:"9px 12px",fontSize:12,...style}}/>
);

export const Textarea = ({ value, onChange, placeholder, rows=4 }) => (
  <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
    style={{width:"100%",background:"#f0f2f5",color:"#1a1a1a",border:"1px solid #e4e7ec",
      borderRadius:8,padding:"9px 12px",fontSize:12,resize:"vertical"}}/>
);

export const Select = ({ value, onChange, children, style={} }) => (
  <select value={value} onChange={onChange}
    style={{width:"100%",background:"#f0f2f5",color:"#1a1a1a",border:"1px solid #e4e7ec",
      borderRadius:8,padding:"9px 12px",fontSize:12,cursor:"pointer",...style}}>
    {children}
  </select>
);

export const Label = ({ children }) => (
  <div style={{fontSize:9,color:"#555555",fontWeight:800,letterSpacing:1,
    textTransform:"uppercase",marginBottom:6}}>{children}</div>
);
