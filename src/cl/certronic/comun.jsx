// ═══════════════════════════════════════════════════════════════════════════
// CERTRONIC · CHILE — Elementos comunes del módulo
// Estilos de tabla, KPI, botón de descarga y la consulta paginada traerTodo.
// ═══════════════════════════════════════════════════════════════════════════



// Botón de descarga estandarizado
export function BotonDescargarExcel({ onClick, disabled, label = "Descargar Excel" }) {
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

export function KPI({ label, valor, sub, color = "#002E5D" }) {
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

export const thE = {
  padding: "10px 8px", textAlign: "center", fontSize: 10,
  fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
  cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  borderRight: "1px solid rgba(255,255,255,0.1)",
};
export const thE2 = {
  padding: "8px 10px", textAlign: "center", fontSize: 10,
  fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
  whiteSpace: "nowrap",
};
export const thE2L = { ...thE2, textAlign: "left" };
export const tdE = {
  padding: "8px 6px", textAlign: "center", verticalAlign: "middle",
  borderRight: "1px solid #f4f5f7",
};
export const tdE2 = {
  padding: "8px 10px", textAlign: "center", verticalAlign: "middle",
};
export const btnIcon = {
  border: "none", background: "transparent", cursor: "pointer",
  fontSize: 14, padding: "4px 6px", margin: "0 2px",
};
export const inputMini = {
  fontSize: 11, padding: "4px 6px", borderRadius: 4, border: "1px solid #cbd5e1",
  width: "100%",
};
export const lbl = {
  display: "block", fontSize: 10, fontWeight: 600,
  color: "#64748b", textTransform: "uppercase", marginBottom: 3, letterSpacing: 0.3,
};


// ─── Consultas a Supabase ──────────────────────────────────────────────────
// Supabase entrega como máximo 1.000 filas por consulta. traerTodo pide la
// información por páginas hasta completarla. Recibe una función que arma la
// consulta (sin .range) para poder repetirla en cada página. La consulta debe
// llevar un .order() estable (por ejemplo "id") para no saltar ni repetir filas.
export async function traerTodo(armarConsulta, tamPagina = 1000) {
  let filas = [];
  let desde = 0;
  while (true) {
    const { data, error } = await armarConsulta().range(desde, desde + tamPagina - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    filas = filas.concat(data);
    if (data.length < tamPagina) break;
    desde += tamPagina;
  }
  return filas;
}
