import { useState } from "react";

// ─── 🆕 MODAL: Editar override del analista ─────────────────────
export function ModalOverride({ contexto, onClose, onGuardar, onQuitar }) {
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
        <div style={{ padding: "14px 18px", background: "#002E5D", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
              background: "#002E5D", color: "#fff", border: "none", opacity: guardando ? 0.6 : 1,
            }}>
              {guardando ? "Guardando..." : (tieneOverride ? "Actualizar override" : "Guardar override")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
