// Contabilidad.jsx — Pestaña madre Contabilidad (México).
// Agrupa lo contable que antes vivía en Administración. Por ahora tiene una
// sola subpestaña, Facturación Terceros; las próximas se suman a `tabs`.
import { useState } from "react";
import FacturacionTerceros from "./FacturacionTerceros";

const tabs = [
  { id: "facturacion_terceros", label: "Facturación Terceros", desc: "Facturas que suben los terceros contra cada prefactura" },
];

export default function ModuloContabilidad({ usuario }) {
  const [subtab, setSubtabState] = useState(() => {
    try {
      const guardada = localStorage.getItem("bt_nav_subtab_contabilidad");
      return tabs.some(t => t.id === guardada) ? guardada : tabs[0].id;
    } catch { return tabs[0].id; }
  });
  const setSubtab = (t) => { try { localStorage.setItem("bt_nav_subtab_contabilidad", t); } catch {} setSubtabState(t); };

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>Contabilidad</div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginLeft: -8, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                background: "transparent", border: "none", padding: "10px 16px",
                fontSize: 13, fontWeight: 600, cursor: "pointer", color: subtab === t.id ? "#1a3a6b" : "#64748b",
                borderBottom: subtab === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
                marginBottom: -2,
              }}>
              <div>{t.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
      {subtab === "facturacion_terceros" && <FacturacionTerceros usuario={usuario} />}
    </div>
  );
}
