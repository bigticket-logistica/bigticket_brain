import { registrarSubtabs, useSubtab } from "../shared/subtabs";
import AccesosPortalCL from "./AccesosPortal";
import CertronicPagos from "./certronic";

// ═══════════════════════════════════════════════════════════════════════════
// CERTIFICACIONES · CHILE
// Estructura:
//   Certificaciones
//     ├─ Certificación para Pagos → Contratistas Chile (Certronic)  (cl/certronic/)
//     └─ Accesos al portal        → Claves del Portal Transportista
//
// (Cuidado de Activo es una pestaña aparte, no va aquí dentro.)
// ═══════════════════════════════════════════════════════════════════════════

const TABS_CERT_CL = [
  { id: "pagos", label: "Certificación para Pagos", desc: "Contratistas Chile (Certronic)" },
  { id: "accesos", label: "Accesos al portal", desc: "Claves del Portal Transportista" },
];
registrarSubtabs("certificaciones_cl", TABS_CERT_CL, "pagos");

function ModuloCertificacionesCL({ usuario }) {
  const [subtab] = useSubtab("certificaciones_cl");
  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>Certificaciones · Chile</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#FF6600", fontFamily: "Poppins, 'Open Sans', sans-serif", marginTop: 2 }}>{(TABS_CERT_CL.find((t) => t.id === subtab) || {}).label}</div>
      </div>
      {subtab === "accesos" && <AccesosPortalCL usuario={usuario} />}
      {subtab === "pagos" && <CertronicPagos />}
    </div>
  );
}

export default ModuloCertificacionesCL;
