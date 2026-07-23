import { useState } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// CERTIFICACIONES · CHILE
// Estructura:
//   Certificaciones
//     └─ Certificación para Pagos
//          ├─ Contratistas Chile (Certronic)   (certronicSlot)
//          └─ Mantenciones                     (mantencionesSlot)
//
// Las dos vistas reales (Certronic y Mantenciones) viven en App.jsx y se
// inyectan por prop (slot). Si no se pasan, se muestra un placeholder.
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

// Sub-pestaña "Certificación para Pagos": alterna entre Certronic y Mantenciones.
function CertificacionParaPagos({ certronicSlot, mantencionesSlot }) {
  const [seccion, setSeccion] = useState("certronic");
  const secciones = [
    { id: "certronic",    label: "Contratistas Chile (Certronic)" },
    { id: "mantenciones", label: "Mantenciones" },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: "16px 24px 0", flexWrap: "wrap" }}>
        {secciones.map(s => (
          <button key={s.id} onClick={() => setSeccion(s.id)}
            style={{
              background: seccion === s.id ? "#1a3a6b" : "#fff",
              color: seccion === s.id ? "#fff" : "#1a3a6b",
              border: "1.5px solid #1a3a6b", borderRadius: 20,
              padding: "6px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              fontFamily: "'Geist',sans-serif", transition: "all .15s",
            }}>
            {s.label}
          </button>
        ))}
      </div>
      {seccion === "certronic" && (
        certronicSlot || (
          <SeccionEnConstruccion
            titulo="Contratistas Chile (Certronic)"
            descripcion="Estado de certificación de los contratistas chilenos para habilitar sus pagos (fuente: Certronic)." />
        )
      )}
      {seccion === "mantenciones" && (
        mantencionesSlot || (
          <SeccionEnConstruccion
            titulo="Mantenciones"
            descripcion="Control de protocolo de flota y cuidado de activo." />
        )
      )}
    </div>
  );
}

// Componente raíz del módulo (madre con sub-pestañas).
function ModuloCertificacionesCL({ certronicSlot, mantencionesSlot }) {
  const [subtab, setSubtab] = useState("pagos");
  const tabs = [
    { id: "pagos", label: "Certificación para Pagos", desc: "Contratistas Chile (Certronic) · Mantenciones" },
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
      {subtab === "pagos" && <CertificacionParaPagos certronicSlot={certronicSlot} mantencionesSlot={mantencionesSlot} />}
    </div>
  );
}

export default ModuloCertificacionesCL;
