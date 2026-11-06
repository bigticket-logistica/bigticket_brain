import { registrarSubtabs, useSubtab } from "../shared/subtabs";
import AccesosPortalCL from "./AccesosPortal";

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
        <div className="form-title" style={{ color: "#002E5D" }}>{titulo}</div>
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
const TABS_CERT_CL = [
  { id: "pagos", label: "Certificación para Pagos", desc: "Contratistas Chile (Certronic)" },
  { id: "accesos", label: "Accesos al portal", desc: "Claves del Portal Transportista" },
];
registrarSubtabs("certificaciones_cl", TABS_CERT_CL, "pagos");

function ModuloCertificacionesCL({ certronicSlot, usuario }) {
  const [subtab] = useSubtab("certificaciones_cl");
  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>Certificaciones · Chile</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#FF6600", fontFamily: "Poppins, 'Open Sans', sans-serif", marginTop: 2 }}>{(TABS_CERT_CL.find((t) => t.id === subtab) || {}).label}</div>
      </div>
      {subtab === "accesos" && <AccesosPortalCL usuario={usuario} />}
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
