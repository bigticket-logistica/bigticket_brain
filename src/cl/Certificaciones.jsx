import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// CERTIFICACIONES · CHILE
// Estructura:
//   Certificaciones
//     └─ Certificación para Pagos → Contratistas Chile (Certronic)   (certronicSlot)
//
// La vista real de Certronic vive en App.jsx y se inyecta por prop (slot).
// (Mantenciones es una pestaña aparte, no va aquí dentro.)
// ═══════════════════════════════════════════════════════════════════════════

function SeccionEnConstruccion({ titulo, descripcion }) {
  return (
    <div className="pg" style={{ maxWidth: 760 }}>
      <div className="form-card" style={{ borderStyle: "dashed", background: "#fbfcfe" }}>
        <div className="form-title" style={{ color: "#1a3a6b" }}>{titulo}</div>
        <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.9, marginTop: 6 }}>
          {descripcion}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
          Sección en construcción — aquí definiremos los datos y la lógica.
        </div>
      </div>
    </div>
  );
}

// Componente raíz del módulo (madre con sub-pestañas).
function ModuloCertificacionesCL({ certronicSlot }) {
  const [subtab, setSubtab] = useState("pagos");
  const tabs = [
    { id: "pagos", label: "Certificación para Pagos", desc: "Contratistas Chile (Certronic)" },
  ];
  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a6b", marginBottom: 10 }}>Certificaciones · Chile</div>
        <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e4e7ec", marginLeft: -8, flexWrap: "wrap" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                background: "transparent", border: "none", padding: "10px 16px",
                fontSize: 13, fontWeight: 600, cursor: "pointer", color: subtab === t.id ? "#1a3a6b" : "#64748b",
                borderBottom: subtab === t.id ? "2px solid #1a3a6b" : "2px solid transparent",
                marginBottom: -2, transition: "all 0.15s",
              }}>
              <div>{t.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginTop: 2 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>
      {subtab === "pagos" && (
        certronicSlot || (
          <SeccionEnConstruccion
            titulo="Contratistas Chile (Certronic)"
            descripcion="Estado de certificación de los contratistas chilenos para habilitar sus pagos (fuente: Certronic)." />
        )
      )}
    </div>
  );
}

export default ModuloCertificacionesCL;
