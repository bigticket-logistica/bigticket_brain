// Contabilidad.jsx — Pestaña madre Contabilidad (México).
// Agrupa lo contable que antes vivía en Administración. Por ahora tiene una
// sola subpestaña, Facturación Terceros; las próximas se suman a `tabs`.
import { registrarSubtabs, useSubtab } from "./shared/subtabs";
import FacturacionTerceros from "./FacturacionTerceros";

const tabs = [
  { id: "facturacion_terceros", label: "Facturación Terceros", desc: "Facturas que suben los terceros contra cada prefactura" },
];

registrarSubtabs("contabilidad", tabs);

export default function ModuloContabilidad({ usuario }) {
  const [subtab] = useSubtab("contabilidad");

  return (
    <div style={{ padding: 0 }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 24px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>Contabilidad</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#FF6600", fontFamily: "Poppins, 'Open Sans', sans-serif", marginTop: 2 }}>{(tabs.find((t) => t.id === subtab) || {}).label}</div>
      </div>
      {subtab === "facturacion_terceros" && <FacturacionTerceros usuario={usuario} />}
    </div>
  );
}
