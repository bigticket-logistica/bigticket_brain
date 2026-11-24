import { descargarExcelMultihoja } from "../../shared";
import { BotonDescargarExcel, tdE2, thE2 } from "./comun";

// ─── Sub-componente: Activos Críticos ────────────────────────────────
export function ActivosCriticos({ activosCriticos, renderEstadoFinal, operacionAMandante }) {
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
                    <td style={tdE2}><span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#002E5D", color: "#fff", fontWeight: 700 }}>{d.categoria}</span></td>
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
