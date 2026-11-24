import { Fragment, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "../../shared";
import { BotonDescargarExcel, KPI, tdE, thE } from "./comun";

// ─── Sub-componente: Dashboard (vista normal de PC/RyC/SUB) ─────────
export function DashboardCertificacion({
  datos, kpis, empresasActivasUnicas, empresasInhabilitadasUnicas,
  tabCategoria, setTabCategoria,
  busqueda, setBusqueda,
  filtroEstado, setFiltroEstado, filtroMandante, setFiltroMandante,
  filtroActivo, setFiltroActivo,
  operacionesUnicas, datosCategoriaActual,
  docsPorCategoria, renderIconoDoc, renderEstadoFinal,
  toggleOrden, flecha, operacionAMandante,
  cumplInicial = new Map(),  // 🆕 cumplimiento de docs iniciales por contratista
}) {
  // 🆕 datosTab: muestra TODO siempre, los inhabilitados son ciudadanos completos
  const datosTab = (cat) => datos[cat] || [];

  // 🆕 Modal de detalle: contiene la fila completa o null si está cerrado
  const [modalDetalle, setModalDetalle] = useState(null);
  // Cerrar modal con tecla ESC
  useEffect(() => {
    if (!modalDetalle) return;
    const onKey = (e) => { if (e.key === "Escape") setModalDetalle(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalDetalle]);

  return (
    <>
      {/* KPIs (incluyen TODO: activos + inhabilitados) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KPI 
          label="Total registros" 
          valor={kpis.total} 
          sub={`${(empresasActivasUnicas + empresasInhabilitadasUnicas)} empresas · ${operacionesUnicas.length} mandantes`}
          color="#002E5D" />
        <KPI label="% Avance certificación" valor={`${kpis.pctAvance}%`} sub={`${kpis.certificados} certificados`} color="#16a34a" />
        <KPI label="Pendientes" valor={kpis.parciales + kpis.sinCert} sub={`${kpis.parciales} parcial · ${kpis.sinCert} sin cert.`} color="#FF6600" />
        <KPI label="Anomalías" valor={kpis.anomalias} sub={kpis.anomalias > 0 ? "Requieren revisión" : "Todo OK"} color={kpis.anomalias > 0 ? "#c0392b" : "#16a34a"} />
        <KPI 
          label="Inhabilitados" 
          valor={kpis.inhabilitados} 
          sub={`${empresasInhabilitadasUnicas} empresas · resaltadas en tabla`} 
          color="#dc2626" />
      </div>

      {/* Tabs categoría + botón Excel */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, borderBottom: "1px solid #e4e7ec", gap: 12 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "pc", label: "Personal Contratado", n: datosTab("pc").length },
            { id: "ryc", label: "Representante y Conductor", n: datosTab("ryc").length },
            { id: "sub", label: "Subcontratista", n: datosTab("sub").length },
          ].map(t => (
            <button key={t.id} onClick={() => setTabCategoria(t.id)}
              style={{
                padding: "8px 14px", border: "none", cursor: "pointer",
                borderBottom: tabCategoria === t.id ? "2px solid #002E5D" : "2px solid transparent",
                background: "transparent", color: tabCategoria === t.id ? "#002E5D" : "#666",
                fontWeight: tabCategoria === t.id ? 700 : 500,
                fontSize: 12, fontFamily: "'Open Sans', sans-serif", marginBottom: -1,
              }}>
              {t.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>({t.n})</span>
            </button>
          ))}
        </div>
        <div style={{ paddingBottom: 6 }}>
          <BotonDescargarExcel onClick={() => {
            const labelCat = tabCategoria === "pc" ? "Personal Contratado"
                           : tabCategoria === "ryc" ? "Representante y Conductor"
                           : "Subcontratista";
            const docsDeLaCategoria = docsPorCategoria[tabCategoria] || [];
            const headers = [
              "Operación",
              "Mandante",
              "Transporte",
              ...(tabCategoria === "sub" ? ["Subcontratista"] : []),
              "Empleados Activos",
              "Vehículos Activos",
              ...docsDeLaCategoria.map(d => d.label),
              "% Retención",
              "% Avance",
              "Estado",
              "Inhabilitado",
              "Anomalía",
            ];
            const filas = datosCategoriaActual.map(d => {
              const fila = [
                d.operacion || "",
                operacionAMandante(d.operacion) || "",
                d.transporte || "",
                ...(tabCategoria === "sub" ? [d.subcontratista_nombre || ""] : []),
                d.empleados_activos || 0,
                d.vehiculos_activos || 0,
              ];
              for (const doc of docsDeLaCategoria) {
                const val = d[doc.key];
                fila.push(val || "");
              }
              fila.push(
                d.pct_retencion != null ? d.pct_retencion + "%" : "",
                d.pct_avance != null ? d.pct_avance + "%" : "",
                d.estado_final || "",
                d.recurso_inhabilitado ? "Sí" : "No",
                d.anomalia_descripcion || "",
              );
              return fila;
            });
            
            descargarExcelMultihoja([
              { nombre: labelCat, datos: [headers, ...filas] },
            ], `Dashboard_Mensual_${tabCategoria.toUpperCase()}`);
          }} disabled={datosCategoriaActual.length === 0} />
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px 160px", gap: 8, marginBottom: 12 }}>
        <input 
          placeholder="🔎 Buscar (nombre, RUT, email · sin acentos · busca cualquier parte)" 
          value={busqueda} 
          onChange={(e) => setBusqueda(e.target.value)} 
          title="Buscador inteligente: tolerante a acentos y mayúsculas. Acepta múltiples palabras: 'bastian diaz' encuentra 'Bastian Andres Diaz'."
        />
        <select value={filtroMandante} onChange={(e) => setFiltroMandante(e.target.value)}>
          <option value="todos">Todos los mandantes</option>
          <option value="Mercado Libre">Mercado Libre</option>
          <option value="Falabella">Falabella</option>
          <option value="Rosen">Rosen</option>
          <option value="Canon">Canon</option>
          <option value="Esporádicos">Esporádicos</option>
        </select>
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="todos">Todos estados</option>
          <option value="CERTIFICADO">✓ Certificado</option>
          <option value="PENDIENTE">⏳ Parcial</option>
          <option value="NO_CERTIFICADO">✗ Sin certificación</option>
        </select>
        <select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)}>
          <option value="todos">Activos + inhabilitados</option>
          <option value="solo_activos">Solo activos</option>
          <option value="solo_inhabilitados">Solo inhabilitados</option>
        </select>
      </div>

      {datos.pc.length === 0 && datos.ryc.length === 0 && datos.sub.length === 0 ? (
        <div className="empty">
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#64748b" }}>Sin datos para este período</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            Los datos se actualizan automáticamente los lunes y jueves a las 04:00 UTC.
          </div>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: "calc(100vh - 420px)", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, minWidth: tabCategoria === "pc" ? 1300 : 1000 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "#002E5D", color: "#fff" }}>
                  <th style={thE} onClick={() => toggleOrden("operacion")}>Operación{flecha("operacion")}</th>
                  <th style={{...thE, textAlign: "left", paddingLeft: 12}} onClick={() => toggleOrden("transporte")}>Transporte{flecha("transporte")}</th>
                  {tabCategoria === "sub" && (
                    <th style={{...thE, textAlign: "left"}} onClick={() => toggleOrden("subcontratista_nombre")}>Subcontratista{flecha("subcontratista_nombre")}</th>
                  )}
                  <th style={thE} onClick={() => toggleOrden("recurso_inhabilitado")} title="Inhabilitado: distintivo de Certronic — el contratista debe documentación. NO significa que no esté operando.">Estado{flecha("recurso_inhabilitado")}</th>
                  <th style={thE}>Activos</th>
                  {docsPorCategoria[tabCategoria].map(d => (
                    <th key={d.key} style={thE} title={d.label}>{d.label}</th>
                  ))}
                  <th style={thE} onClick={() => toggleOrden("pct_retencion")}>% Reten.{flecha("pct_retencion")}</th>
                  <th style={thE} onClick={() => toggleOrden("pct_avance")}>% Avance{flecha("pct_avance")}</th>
                  <th style={thE} onClick={() => toggleOrden("estado_final")}>Cert.{flecha("estado_final")}</th>
                  <th style={thE}>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {datosCategoriaActual.map((d, i) => {
                  const mandante = operacionAMandante(d.operacion);
                  const colorOp = {
                    "Mercado Libre": "#fef3c7",
                    "Falabella": "#dcfce7",
                    "Rosen": "#fce7f3",
                    "Canon": "#dbeafe",
                    "Esporádicos": "#f3e8ff",
                  }[mandante] || "#f1f5f9";
                  const isInhabilitado = d.recurso_inhabilitado;
                  const filaId = d.id || `${d.transporte}|${d.categoria}|${d.subcontratista_nombre || ""}`;
                  return (
                    <tr key={filaId + "_" + i} style={{
                      borderBottom: "1px solid #f0f0f0",
                      background: isInhabilitado 
                        ? "#FCEBEB"
                        : (d.tiene_anomalia ? "#fff7ed" : (i % 2 === 0 ? "#fafbfc" : "#fff")),
                      borderLeft: isInhabilitado ? "3px solid #A32D2D" : "3px solid transparent",
                    }}>
                      <td style={tdE}>
                        <span title={mandante} style={{
                          fontSize: 9.5, padding: "2px 6px", borderRadius: 4,
                          background: colorOp, color: "#002E5D", fontWeight: 700, whiteSpace: "nowrap",
                        }}>
                          {d.operacion || "—"}
                        </span>
                      </td>
                      <td style={{...tdE, textAlign: "left", paddingLeft: 12, fontWeight: 500, color: isInhabilitado ? "#791F1F" : undefined}}>
                        {d.transporte}
                        {(() => {
                          // 🆕 Triángulo de cumplimiento de docs iniciales (a la derecha, grande)
                          const ci = cumplInicial.get(d.transporte);
                          if (!ci) return null;
                          const colorTri = ci.semaforo === "verde" ? "#16a34a" 
                                         : ci.semaforo === "amarillo" ? "#f59e0b" 
                                         : "#dc2626";
                          const tooltipTri = `Documentación inicial del contratista: ${ci.cumplen}/${ci.total} (${ci.porcentaje}%)\n${ci.semaforo === "verde" ? "✓ Cumple 100%" : ci.semaforo === "amarillo" ? "⚠ Parcial 50-99%" : "✗ Crítico <50%"}`;
                          return (
                            <span 
                              title={tooltipTri}
                              style={{ 
                                display: "inline-block", marginLeft: 8, fontSize: 22, color: colorTri,
                                cursor: "help", verticalAlign: "middle", lineHeight: 1,
                                textShadow: ci.semaforo === "rojo" ? "0 0 4px rgba(220, 38, 38, 0.4)" : undefined,
                              }}>
                              ⚠
                            </span>
                          );
                        })()}
                        {isInhabilitado && (
                          <span 
                            title="Distintivo de Certronic: el contratista debe documentación. NO significa que no esté operando."
                            style={{ 
                              fontSize: 9, marginLeft: 8, padding: "2px 7px", borderRadius: 3, 
                              background: "#A32D2D", color: "#fff", fontWeight: 600, 
                              letterSpacing: 0.3, verticalAlign: "middle",
                            }}>
                            INHABILITADO
                          </span>
                        )}
                        {d.tiene_anomalia && (
                          <div style={{ fontSize: 9.5, color: "#c0392b", marginTop: 2, fontStyle: "italic" }}>
                            ⚠ {d.anomalia_descripcion}
                          </div>
                        )}
                      </td>
                      {tabCategoria === "sub" && (
                        <td style={{...tdE, textAlign: "left", color: isInhabilitado ? "#791F1F" : "#374151"}}>{d.subcontratista_nombre || "—"}</td>
                      )}
                      {/* 🆕 Columna Estado: pill Activo/Inhabilitado */}
                      <td style={tdE}>
                        {isInhabilitado ? (
                          <span 
                            title="Distintivo de Certronic. El contratista debe documentación pero puede seguir operando."
                            style={{
                              fontSize: 10, padding: "2px 8px", borderRadius: 4,
                              background: "#FCEBEB", color: "#A32D2D", 
                              fontWeight: 600, border: "0.5px solid #F09595",
                              whiteSpace: "nowrap",
                            }}>
                            Inhabilitado
                          </span>
                        ) : (
                          <span style={{
                            fontSize: 10, padding: "2px 8px", borderRadius: 4,
                            background: "#EAF3DE", color: "#3B6D11",
                            fontWeight: 600, whiteSpace: "nowrap",
                          }}>
                            Activo
                          </span>
                        )}
                      </td>
                      <td style={tdE}>
                        <div style={{ fontSize: 10, color: isInhabilitado ? "#791F1F" : "#64748b" }}>
                          {d.empleados_activos || 0} emp · {d.vehiculos_activos || 0} veh
                        </div>
                      </td>
                      {docsPorCategoria[tabCategoria].map(doc => (
                        <td key={doc.key} style={tdE}>{renderIconoDoc(d[doc.key], {
                          contratista: d.transporte,
                          categoria: d.categoria,
                          subcontratista: d.subcontratista_nombre,
                          docCampo: doc.key,
                          docLabel: doc.label,
                          fechaSnapshot: d.fecha_snapshot_ultimo,
                        })}</td>
                      ))}
                      <td style={{...tdE, fontWeight: 700, color: d.pct_retencion > 0 ? "#c0392b" : "#94a3b8"}}>
                        {d.pct_retencion ? `${d.pct_retencion}%` : "—"}
                      </td>
                      <td style={tdE}>
                        {d.pct_avance != null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                            <div style={{ width: 50, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{
                                width: `${d.pct_avance}%`, height: "100%",
                                background: d.pct_avance >= 100 ? "#16a34a" : d.pct_avance >= 60 ? "#FF6600" : "#c0392b",
                              }} />
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, minWidth: 28 }}>{Math.round(d.pct_avance)}%</span>
                          </div>
                        ) : "—"}
                      </td>
                      <td style={tdE}>{renderEstadoFinal(d.estado_final)}</td>
                      <td style={tdE}>
                        <button 
                          onClick={() => setModalDetalle(d)}
                          title="Ver detalle completo del contratista"
                          style={{
                            padding: "4px 12px", borderRadius: 4, border: "1px solid #002E5D",
                            background: "#002E5D", color: "#fff",
                            fontSize: 10, fontWeight: 600, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", gap: 4,
                          }}>
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {datosCategoriaActual.length === 0 && (
              <div style={{ padding: 30, textAlign: "center", color: "#888", fontSize: 12 }}>
                No hay registros que coincidan con los filtros.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10.5, color: "#64748b" }}>
        <div>Mostrando {datosCategoriaActual.length} registros · {tabCategoria.toUpperCase()}</div>
        <div style={{ display: "flex", gap: 12 }}>
          <span>✓ Validado</span><span>◐ Recepcionado</span>
          <span>↗ Enviado</span><span>⏳ Pendiente</span><span>— No aplica</span>
        </div>
      </div>

      {/* 🆕 Modal de detalle del contratista */}
      {modalDetalle && (
        <ModalDetalleContratista 
          fila={modalDetalle}
          onCerrar={() => setModalDetalle(null)}
          docsPorCategoria={docsPorCategoria}
          renderIconoDoc={renderIconoDoc}
          operacionAMandante={operacionAMandante}
        />
      )}
    </>
  );
}

// ─── 🆕 Modal de detalle completo del contratista ────────────────────
// Reemplaza la vista expandida. Adaptativo según categoría (RYC vs SUB):
// - RYC/PC: empleados + vehículos del contratista
// - SUB: foco en el subcontratista específico (boletero)
function ModalDetalleContratista({ fila, onCerrar, docsPorCategoria, renderIconoDoc, operacionAMandante }) {
  const [tabActivo, setTabActivo] = useState("documentos");
  const [recursos, setRecursos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);

  // 🆕 Sprint 3 — Histórico
  const [deudasHistoricas, setDeudasHistoricas] = useState(null);  // {total_deudas, meses_con_deuda, ...} | null = loading | {total:0} = sin deudas
  const [deudasDetalle, setDeudasDetalle] = useState([]);          // lista de docs específicos para tab Histórico
  const [evolucionHistorica, setEvolucionHistorica] = useState([]); // [{periodo, pct_cumplimiento, ...}]
  const [desaparecidosHist, setDesaparecidosHist] = useState([]);   // gente que estaba en histórico y ya no
  const [loadingHistorico, setLoadingHistorico] = useState(true);

  const esSub = fila.categoria === "SUB";
  const mandante = operacionAMandante(fila.operacion);
  const isInhabilitado = fila.recurso_inhabilitado;

  // 🆕 Normalización del nombre del contratista para hacer match con histórico
  const normalizarContratistaParaHist = (s) => {
    if (!s) return "";
    return String(s).trim().toUpperCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/Ñ/g, "N").replace(/[^A-Z0-9 ]/g, " ")
      .replace(/\s+/g, " ").trim();
  };
  const contratistaNorm = normalizarContratistaParaHist(esSub && fila.subcontratista_nombre ? fila.subcontratista_nombre : fila.transporte);

  // Carga de recursos del contratista (similar a RecursosContratista pero más simple)
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const { data: snapData } = await sb.from("certronic_documentos")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snapData || !snapData.length) {
          if (!cancel) { setRecursos([]); setLoading(false); }
          return;
        }
        const fechaSnapshot = snapData[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnapshot);

        let resultado = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          const { data, error } = await sb.from("certronic_documentos")
            .select("contratista, recurso_nombre, recurso_identificador, tipo_recurso, fecha_inicio, acceso, planta, documento")
            .eq("fecha_snapshot", fechaSnapshot)
            .ilike("contratista", `%${fila.transporte}%`)
            .range(from, from + limite - 1);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          resultado = resultado.concat(data);
          if (data.length < limite) break;
          from += limite;
        }

        // Deduplicar por recurso, juntar todos los documentos de cada uno
        const recursosMap = new Map();
        for (const r of resultado) {
          const key = `${r.recurso_nombre || ""}|${r.tipo_recurso || ""}`;
          if (!recursosMap.has(key)) {
            recursosMap.set(key, {
              recurso_nombre: r.recurso_nombre,
              recurso_identificador: r.recurso_identificador,
              tipo_recurso: r.tipo_recurso,
              fecha_inicio: r.fecha_inicio,
              acceso: r.acceso,
              planta: r.planta,
              documentos: [],
            });
          }
          const existing = recursosMap.get(key);
          if (r.documento && !existing.documentos.find(d => d.documento === r.documento)) {
            existing.documentos.push({ documento: r.documento });
          }
          if (!existing.recurso_identificador && r.recurso_identificador) {
            existing.recurso_identificador = r.recurso_identificador;
          }
        }

        let recursosFinales = Array.from(recursosMap.values());
        // Si es SUB, filtrar solo el subcontratista específico
        if (esSub && fila.subcontratista_nombre) {
          const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
          const target = norm(fila.subcontratista_nombre);
          recursosFinales = recursosFinales.filter(r => norm(r.recurso_nombre).includes(target) || target.includes(norm(r.recurso_nombre)));
        }

        recursosFinales.sort((a, b) => (a.recurso_nombre || "").localeCompare(b.recurso_nombre || ""));
        if (!cancel) setRecursos(recursosFinales);
      } catch (e) {
        console.error("[ModalDetalle]", e);
        if (!cancel) setRecursos([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [fila.transporte, fila.categoria, fila.subcontratista_nombre, esSub]);

  // 🆕 Sprint 3 — Cargar datos históricos del contratista
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoadingHistorico(true);
      try {
        // 1. Resumen de deudas históricas (para badge en header)
        // Una persona puede aparecer múltiples veces si trabaja para varios contratistas.
        // Sumamos todas las deudas de este contratista_norm.
        const { data: resumenData, error: errResumen } = await sb
          .from("vw_deudores_historicos_actuales_resumen")
          .select("identificador, total_deudas, meses_con_deuda, docs_distintos_adeudados, deuda_mas_antigua, deuda_mas_reciente, detalle")
          .eq("contratista_norm", contratistaNorm);

        if (cancel) return;

        if (errResumen) {
          console.warn("[Histórico] Error resumen:", errResumen.message);
          if (!cancel) setDeudasHistoricas({ total: 0, error: errResumen.message });
        } else {
          const agg = (resumenData || []).reduce((acc, r) => {
            acc.total += r.total_deudas;
            acc.personas += 1;
            acc.docs.add(...(r.docs_distintos_adeudados ? [r.docs_distintos_adeudados] : []));
            if (!acc.masAntigua || r.deuda_mas_antigua < acc.masAntigua) acc.masAntigua = r.deuda_mas_antigua;
            if (!acc.masReciente || r.deuda_mas_reciente > acc.masReciente) acc.masReciente = r.deuda_mas_reciente;
            return acc;
          }, { total: 0, personas: 0, docs: new Set(), masAntigua: null, masReciente: null });
          if (!cancel) setDeudasHistoricas({
            total: agg.total,
            personas: agg.personas,
            masAntigua: agg.masAntigua,
            masReciente: agg.masReciente,
          });
        }

        // 2. Detalle de deudas (para tab Histórico)
        const { data: detalleData } = await sb
          .from("vw_deudores_historicos_actuales")
          .select("identificador, detalle, documento, periodo_deuda, estado_en_ese_periodo")
          .eq("contratista_norm", contratistaNorm)
          .order("periodo_deuda", { ascending: true })
          .limit(500);
        if (!cancel) setDeudasDetalle(detalleData || []);

        // 3. Evolución mensual del contratista
        const { data: evolData } = await sb
          .from("vw_historico_evolucion_contratista")
          .select("periodo, total_docs, docs_cumplidos, docs_pendientes, pct_cumplimiento, delta_pct_vs_mes_anterior, identificadores_unicos")
          .eq("contratista_norm", contratistaNorm)
          .order("periodo", { ascending: true });
        if (!cancel) setEvolucionHistorica(evolData || []);

        // 4. Desaparecidos de este contratista (gente que estaba y ya no)
        const { data: desapData } = await sb
          .from("vw_historico_desaparecidos")
          .select("identificador, detalle, entidad, ultimo_periodo_visto, docs_pendientes_al_irse, meses_presentes")
          .eq("contratista_norm", contratistaNorm)
          .order("docs_pendientes_al_irse", { ascending: false })
          .limit(100);
        if (!cancel) setDesaparecidosHist(desapData || []);

      } catch (e) {
        console.error("[Histórico] Error general:", e);
        if (!cancel) setDeudasHistoricas({ total: 0, error: e.message });
      }
      if (!cancel) setLoadingHistorico(false);
    })();
    return () => { cancel = true; };
  }, [contratistaNorm]);

  // Particiones de recursos
  const empleados = useMemo(() => recursos.filter(r => r.tipo_recurso === "empleado"), [recursos]);
  const vehiculos = useMemo(() => recursos.filter(r => r.tipo_recurso === "vehiculo"), [recursos]);
  const empleadosInhab = empleados.filter(e => e.acceso === "Inhabilitado").length;
  const vehiculosInhab = vehiculos.filter(v => v.acceso === "Inhabilitado").length;

  // Documentos exigidos por categoría (matriz)
  const docsCategoria = docsPorCategoria[fila.categoria.toLowerCase()] || [];

  // Click en overlay (fuera del modal) cierra
  const onOverlayClick = (e) => {
    if (e.target === e.currentTarget) onCerrar();
  };

  // Color mandante
  const colorOp = {
    "Mercado Libre": "#fef3c7",
    "Falabella": "#dcfce7",
    "Rosen": "#fce7f3",
    "Canon": "#dbeafe",
    "Esporádicos": "#f3e8ff",
  }[mandante] || "#f1f5f9";

  // Estilo común de tab
  const tabStyle = (activo) => ({
    padding: "8px 16px", cursor: "pointer", fontSize: 12, fontWeight: activo ? 700 : 500,
    color: activo ? "#002E5D" : "#64748b",
    borderBottom: activo ? "2px solid #002E5D" : "2px solid transparent",
    background: "transparent", border: "none", borderRadius: 0,
    transition: "all 0.15s",
  });

  const tituloModal = esSub 
    ? (fila.subcontratista_nombre || fila.transporte)
    : fila.transporte;
  const subtituloModal = esSub
    ? `Subcontratista de ${fila.transporte} · ${mandante}`
    : `${mandante} · ${fila.categoria}${fila.email ? " · " + fila.email : ""}`;

  return (
    <div onClick={onOverlayClick}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(15, 23, 42, 0.55)", zIndex: 9999,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 20px", overflow: "auto",
      }}>
      <div style={{
        background: "#fff", borderRadius: 8, width: "100%", maxWidth: 980,
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 80px)",
        overflow: "hidden",
      }}>

        {/* HEADER */}
        <div style={{
          padding: "16px 20px", borderBottom: "1px solid #e4e7ec",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
          background: isInhabilitado ? "#FCEBEB" : "#fff",
          borderLeft: isInhabilitado ? "4px solid #A32D2D" : "4px solid transparent",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                background: colorOp, color: "#002E5D", fontWeight: 700,
              }}>{fila.operacion || mandante}</span>
              {isInhabilitado && (
                <span style={{ 
                  fontSize: 9.5, padding: "2px 8px", borderRadius: 3,
                  background: "#A32D2D", color: "#fff", fontWeight: 700, letterSpacing: 0.3,
                }}>INHABILITADO</span>
              )}
              <span style={{ fontSize: 10, color: "#64748b" }}>{fila.categoria}</span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: isInhabilitado ? "#791F1F" : "#002E5D", marginBottom: 2 }}>
              {tituloModal}
            </div>
            <div style={{ fontSize: 11, color: isInhabilitado ? "#791F1F" : "#64748b" }}>
              {subtituloModal}
              {esSub && (
                <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 3, background: "#f3e8ff", color: "#6b21a8", fontWeight: 600 }}>
                  Boletero
                </span>
              )}
            </div>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar"
            style={{
              border: "1px solid #e4e7ec", background: "#fff", cursor: "pointer",
              padding: "4px 10px", borderRadius: 4, fontSize: 16, color: "#64748b",
              lineHeight: 1, fontWeight: 700,
            }}>✕</button>
        </div>

        {/* KPIs */}
        <div style={{ padding: "12px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Estado</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: isInhabilitado ? "#A32D2D" : "#16a34a", marginTop: 2 }}>
              {isInhabilitado ? "Inhabilitado" : "Activo"}
            </div>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Avance</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>
              {fila.pct_avance != null ? `${Math.round(fila.pct_avance)}%` : "—"}
            </div>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Retención</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: fila.pct_retencion > 0 ? "#c0392b" : "#94a3b8", marginTop: 2 }}>
              {fila.pct_retencion ? `${fila.pct_retencion}%` : "—"}
            </div>
          </div>
          {!esSub && (
            <>
              <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Empleados</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>
                  {fila.empleados_activos || 0}
                  {empleadosInhab > 0 && <span style={{ fontSize: 10, color: "#A32D2D", marginLeft: 4 }}>({empleadosInhab} inh.)</span>}
                </div>
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Vehículos</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#002E5D", marginTop: 2 }}>
                  {fila.vehiculos_activos || 0}
                  {vehiculosInhab > 0 && <span style={{ fontSize: 10, color: "#A32D2D", marginLeft: 4 }}>({vehiculosInhab} inh.)</span>}
                </div>
              </div>
            </>
          )}
          {/* 🆕 Sprint 3 — KPI Deudas Históricas (clickeable, lleva al tab Histórico) */}
          <div
            onClick={() => setTabActivo("historico")}
            title="Click para ver detalle en el tab Histórico"
            style={{
              background: loadingHistorico
                ? "#f8fafc"
                : (deudasHistoricas && deudasHistoricas.total > 0)
                  ? "#fef3c7"
                  : "#f0fdf4",
              border: loadingHistorico
                ? "1px solid #e4e7ec"
                : (deudasHistoricas && deudasHistoricas.total > 0)
                  ? "1px solid #fbbf24"
                  : "1px solid #86efac",
              borderRadius: 6,
              padding: "8px 12px",
              cursor: "pointer",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ fontSize: 9.5, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              Deudas históricas
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2,
              color: loadingHistorico ? "#94a3b8" : (deudasHistoricas && deudasHistoricas.total > 0) ? "#92400e" : "#166534"
            }}>
              {loadingHistorico ? (
                <span style={{ fontSize: 11, fontWeight: 500 }}>cargando...</span>
              ) : deudasHistoricas && deudasHistoricas.total > 0 ? (
                <>🚨 {deudasHistoricas.total}</>
              ) : (
                <>✓ 0</>
              )}
            </div>
            {!loadingHistorico && deudasHistoricas && deudasHistoricas.total > 0 && (
              <div style={{ fontSize: 9.5, color: "#92400e", marginTop: 1 }}>
                {deudasHistoricas.personas} {deudasHistoricas.personas === 1 ? "persona" : "personas"}
              </div>
            )}
          </div>
        </div>

        {/* TABS */}
        <div style={{ borderBottom: "1px solid #e4e7ec", padding: "0 20px", display: "flex", gap: 4 }}>
          <button onClick={() => setTabActivo("documentos")} style={tabStyle(tabActivo === "documentos")}>
            Documentos {docsCategoria.length > 0 && `(${docsCategoria.length})`}
          </button>
          {!esSub && (
            <>
              <button onClick={() => setTabActivo("empleados")} style={tabStyle(tabActivo === "empleados")}>
                Empleados {empleados.length > 0 && `(${empleados.length})`}
              </button>
              <button onClick={() => setTabActivo("vehiculos")} style={tabStyle(tabActivo === "vehiculos")}>
                Vehículos {vehiculos.length > 0 && `(${vehiculos.length})`}
              </button>
            </>
          )}
          <button onClick={() => setTabActivo("historico")} style={tabStyle(tabActivo === "historico")}>
            Histórico
          </button>
        </div>

        {/* CONTENIDO TAB */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", background: "#fafbfc" }}>
          {loading && tabActivo !== "documentos" && tabActivo !== "historico" ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Cargando...</div>
          ) : (
            <>
              {/* TAB DOCUMENTOS */}
              {tabActivo === "documentos" && (
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
                    Estado de los {docsCategoria.length} documentos exigidos por mandante para esta categoría
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead style={{ background: "#f1f5f9" }}>
                        <tr>
                          <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#475569" }}>Documento</th>
                          <th style={{ padding: "8px 12px", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#475569", width: 100 }}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {docsCategoria.map((doc) => (
                          <tr key={doc.key} style={{ borderTop: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 12px", fontWeight: 500 }}>{doc.label}</td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              {renderIconoDoc(fila[doc.key], {
                                contratista: fila.transporte,
                                categoria: fila.categoria,
                                subcontratista: fila.subcontratista_nombre,
                                docCampo: doc.key,
                                docLabel: doc.label,
                                fechaSnapshot: fila.fecha_snapshot_ultimo,
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span>✓ Validado</span><span>◐ Recepcionado</span>
                    <span>↗ Enviado</span><span>⏳ Pendiente</span><span>— No aplica</span>
                  </div>
                </div>
              )}

              {/* TAB EMPLEADOS */}
              {tabActivo === "empleados" && !esSub && (
                <div>
                  {empleados.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                      Sin empleados registrados en el snapshot {snapshotUsado || "—"}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
                        {empleados.length} empleado{empleados.length !== 1 ? "s" : ""} en Certronic 
                        {empleadosInhab > 0 && <span style={{ color: "#A32D2D", fontWeight: 600 }}> · {empleadosInhab} con acceso Inhabilitado individualmente</span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {empleados.map((e, i) => {
                          const inhab = e.acceso === "Inhabilitado";
                          return (
                            <div key={i} style={{
                              padding: "10px 12px", borderRadius: 6,
                              background: inhab ? "#FCEBEB" : "#fff",
                              border: "1px solid " + (inhab ? "#F09595" : "#e4e7ec"),
                              borderLeft: inhab ? "3px solid #A32D2D" : "3px solid transparent",
                              display: "flex", alignItems: "center", gap: 12,
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: inhab ? "#791F1F" : "#002E5D" }}>
                                  {e.recurso_nombre || "—"}
                                </div>
                                {e.recurso_identificador && (
                                  <div style={{ fontSize: 10, color: inhab ? "#791F1F" : "#64748b", marginTop: 2 }}>
                                    RUT {e.recurso_identificador}
                                    {e.documentos && e.documentos.length > 0 && (
                                      <span style={{ marginLeft: 8 }}>· {e.documentos.length} doc{e.documentos.length !== 1 ? "s" : ""}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <span style={{
                                fontSize: 10, padding: "3px 10px", borderRadius: 4, fontWeight: 700,
                                background: inhab ? "#A32D2D" : "#EAF3DE",
                                color: inhab ? "#fff" : "#3B6D11",
                                whiteSpace: "nowrap",
                              }}>
                                {e.acceso || "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB VEHÍCULOS */}
              {tabActivo === "vehiculos" && !esSub && (
                <div>
                  {vehiculos.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                      Sin vehículos registrados en el snapshot {snapshotUsado || "—"}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
                        {vehiculos.length} vehículo{vehiculos.length !== 1 ? "s" : ""} en Certronic
                        {vehiculosInhab > 0 && <span style={{ color: "#A32D2D", fontWeight: 600 }}> · {vehiculosInhab} con acceso Inhabilitado</span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {vehiculos.map((v, i) => {
                          const inhab = v.acceso === "Inhabilitado";
                          return (
                            <div key={i} style={{
                              padding: "10px 12px", borderRadius: 6,
                              background: inhab ? "#FCEBEB" : "#fff",
                              border: "1px solid " + (inhab ? "#F09595" : "#e4e7ec"),
                              borderLeft: inhab ? "3px solid #A32D2D" : "3px solid transparent",
                              display: "flex", alignItems: "center", gap: 12,
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: inhab ? "#791F1F" : "#002E5D" }}>
                                  {v.recurso_nombre || "—"}
                                </div>
                                {v.documentos && v.documentos.length > 0 && (
                                  <div style={{ fontSize: 10, color: inhab ? "#791F1F" : "#64748b", marginTop: 2 }}>
                                    {v.documentos.length} doc{v.documentos.length !== 1 ? "s" : ""} asociado{v.documentos.length !== 1 ? "s" : ""}
                                  </div>
                                )}
                              </div>
                              <span style={{
                                fontSize: 10, padding: "3px 10px", borderRadius: 4, fontWeight: 700,
                                background: inhab ? "#A32D2D" : "#EAF3DE",
                                color: inhab ? "#fff" : "#3B6D11",
                                whiteSpace: "nowrap",
                              }}>
                                {v.acceso || "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* TAB HISTÓRICO — Sprint 3 Fase B */}
              {tabActivo === "historico" && (
                <div style={{ padding: 14 }}>
                  {loadingHistorico ? (
                    <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                      Cargando datos históricos...
                    </div>
                  ) : (
                    <>
                      {/* INTRO + AVISO */}
                      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#0c4a6e" }}>
                        <strong>Histórico Q1 2026</strong> · Datos capturados el 2026-05-08 · Períodos: Enero, Febrero, Marzo, Abril 2026
                        <div style={{ marginTop: 3, fontSize: 10.5, color: "#075985" }}>
                          Recuerda: el "Período" en Certronic refleja el mes que se está certificando (mes calendario anterior).
                        </div>
                      </div>

                      {/* ─── BLOQUE 1: EVOLUCIÓN DE CUMPLIMIENTO ─── */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 6 }}>
                          📊 Evolución del cumplimiento
                        </div>
                        {evolucionHistorica.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#94a3b8", padding: 8, background: "#f8fafc", borderRadius: 4 }}>
                            Sin datos históricos para este contratista. Posible que sea nuevo (post-abril) o que el nombre no matchee con el histórico.
                          </div>
                        ) : (
                          <>
                            {/* Sparkline ASCII / CSS */}
                            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: 12 }}>
                              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80, marginBottom: 6 }}>
                                {evolucionHistorica.map((e, i) => {
                                  const pct = parseFloat(e.pct_cumplimiento) || 0;
                                  const altura = Math.max(4, (pct / 100) * 72);
                                  const color = pct >= 85 ? "#16a34a" : pct >= 70 ? "#f59e0b" : "#dc2626";
                                  const delta = e.delta_pct_vs_mes_anterior != null ? parseFloat(e.delta_pct_vs_mes_anterior) : null;
                                  const periodoCorto = e.periodo ? e.periodo.substring(0, 7) : "—";
                                  return (
                                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                      <div style={{ fontSize: 10, fontWeight: 700, color }}>{pct.toFixed(1)}%</div>
                                      <div style={{ width: "100%", height: altura, background: color, borderRadius: "3px 3px 0 0", transition: "height 0.3s" }} />
                                      <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>{periodoCorto}</div>
                                      {delta != null && (
                                        <div style={{
                                          fontSize: 9, fontWeight: 700,
                                          color: delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#94a3b8",
                                        }}>
                                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, display: "flex", gap: 12, justifyContent: "center" }}>
                                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#16a34a", borderRadius: 2, marginRight: 3 }} />≥85%</span>
                                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#f59e0b", borderRadius: 2, marginRight: 3 }} />70-85%</span>
                                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#dc2626", borderRadius: 2, marginRight: 3 }} />&lt;70%</span>
                              </div>
                            </div>
                            {/* Tabla detalle por mes */}
                            <div style={{ marginTop: 8, overflow: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                <thead style={{ background: "#f1f5f9" }}>
                                  <tr>
                                    <th style={{ padding: "5px 8px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Período</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Total docs</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Cumplidos</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Pendientes</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>% Cumple</th>
                                    <th style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Δ vs mes ant.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {evolucionHistorica.map((e, i) => {
                                    const pct = parseFloat(e.pct_cumplimiento) || 0;
                                    const delta = e.delta_pct_vs_mes_anterior != null ? parseFloat(e.delta_pct_vs_mes_anterior) : null;
                                    return (
                                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "5px 8px", fontWeight: 500 }}>{e.periodo}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", color: "#475569" }}>{e.total_docs}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", color: "#166534" }}>{e.docs_cumplidos}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", color: e.docs_pendientes > 0 ? "#991b1b" : "#94a3b8" }}>{e.docs_pendientes}</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 700, color: pct >= 85 ? "#16a34a" : pct >= 70 ? "#92400e" : "#dc2626" }}>{pct.toFixed(1)}%</td>
                                        <td style={{ padding: "5px 8px", textAlign: "right", fontSize: 10, fontWeight: 600, color: delta == null ? "#cbd5e1" : delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#94a3b8" }}>
                                          {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>

                      {/* ─── BLOQUE 2: DEUDAS HISTÓRICAS PUNTUALES ─── */}
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                          🚨 Deudas históricas
                          {deudasDetalle.length > 0 && (
                            <span style={{ fontSize: 10, padding: "1px 6px", background: "#fef3c7", color: "#92400e", borderRadius: 3, fontWeight: 700 }}>
                              {deudasDetalle.length} docs adeudados
                            </span>
                          )}
                        </div>
                        {deudasDetalle.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#166534", padding: 8, background: "#f0fdf4", borderRadius: 4, border: "1px solid #86efac" }}>
                            ✓ Sin deudas históricas. Los empleados/vehículos activos de este contratista no tienen documentos puntuales pendientes de meses anteriores.
                          </div>
                        ) : (
                          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, overflow: "auto", maxHeight: 320 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead style={{ position: "sticky", top: 0, background: "#f1f5f9", zIndex: 1 }}>
                                <tr>
                                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Persona / Recurso</th>
                                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Documento</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Período</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Estado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deudasDetalle.map((d, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                                    <td style={{ padding: "5px 10px", color: "#475569", fontSize: 10.5 }}>{d.documento}</td>
                                    <td style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, color: "#64748b", fontFamily: "monospace" }}>
                                      {d.periodo_deuda ? d.periodo_deuda.substring(0, 7) : "—"}
                                    </td>
                                    <td style={{ padding: "5px 10px", textAlign: "center" }}>
                                      <span style={{
                                        fontSize: 9.5, padding: "1px 6px", borderRadius: 3, fontWeight: 600,
                                        background: "#fef3c7", color: "#92400e",
                                      }}>
                                        {d.estado_en_ese_periodo || "—"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* ─── BLOQUE 3: DESAPARECIDOS (gente que estuvo y ya no) ─── */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                          👻 Empleados/vehículos que ya no están
                          {desaparecidosHist.length > 0 && (
                            <span style={{ fontSize: 10, padding: "1px 6px", background: "#f3e8ff", color: "#6b21a8", borderRadius: 3, fontWeight: 700 }}>
                              {desaparecidosHist.length}
                            </span>
                          )}
                        </div>
                        {desaparecidosHist.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#64748b", padding: 8, background: "#f8fafc", borderRadius: 4 }}>
                            Sin desapariciones detectadas. Todos los empleados/vehículos que aparecieron en Q1 siguen presentes en el último período histórico (abril).
                          </div>
                        ) : (
                          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, overflow: "auto", maxHeight: 240 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead style={{ background: "#f1f5f9" }}>
                                <tr>
                                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Quién</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Tipo</th>
                                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Último mes visto</th>
                                  <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Meses presente</th>
                                  <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Docs pendientes al irse</th>
                                </tr>
                              </thead>
                              <tbody>
                                {desaparecidosHist.map((d, i) => (
                                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                                    <td style={{ padding: "5px 10px", textAlign: "center" }}>
                                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: d.entidad === "empleado" ? "#dbeafe" : d.entidad === "vehiculo" ? "#fef3c7" : "#f3e8ff", color: d.entidad === "empleado" ? "#1e40af" : d.entidad === "vehiculo" ? "#92400e" : "#6b21a8", fontWeight: 600, textTransform: "uppercase" }}>
                                        {d.entidad || "—"}
                                      </span>
                                    </td>
                                    <td style={{ padding: "5px 10px", textAlign: "center", color: "#64748b", fontFamily: "monospace", fontSize: 10 }}>
                                      {d.ultimo_periodo_visto ? d.ultimo_periodo_visto.substring(0, 7) : "—"}
                                    </td>
                                    <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.meses_presentes}</td>
                                    <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: d.docs_pendientes_al_irse > 0 ? "#991b1b" : "#94a3b8" }}>
                                      {d.docs_pendientes_al_irse}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ padding: "10px 20px", borderTop: "1px solid #e4e7ec", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc" }}>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {snapshotUsado && `Snapshot: ${snapshotUsado}`}
            {fila.fecha_calculo && ` · Calculado: ${fila.fecha_calculo}`}
          </div>
          <button onClick={onCerrar} style={{
            padding: "6px 16px", borderRadius: 4, border: "1px solid #002E5D",
            background: "#002E5D", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>Cerrar</button>
        </div>

      </div>
    </div>
  );
}

// ─── Componente: Lista de recursos del contratista ────────────────────
// Lee de certronic_documentos para mostrar empleados y vehículos con
// fecha_inicio. Marca los ingresados en el mes en curso con badge.
function RecursosContratista({ transporte, categoria, subcontratistaNombre }) {
  const [recursos, setRecursos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEntidad, setFiltroEntidad] = useState("todas");
  // 🆕 Sprint 3 — Mapa de deudas históricas por identificador
  const [deudasPorRecurso, setDeudasPorRecurso] = useState({}); // { "identificador": {total, meses, docs} }

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Obtener el último snapshot disponible de certronic_documentos
        console.log(`[Recursos] Buscando snapshot para "${transporte}"...`);
        const { data: snapData, error: snapErr } = await sb.from("certronic_documentos")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        
        if (snapErr) {
          console.error(`[Recursos] Error consultando snapshot:`, snapErr);
          if (!cancel) { setRecursos([]); setLoading(false); }
          return;
        }
        if (!snapData || !snapData.length) {
          console.warn(`[Recursos] certronic_documentos está vacía (sin snapshots)`);
          if (!cancel) { setRecursos([]); setLoading(false); }
          return;
        }
        const fechaSnapshot = snapData[0].fecha_snapshot;
        console.log(`[Recursos] Snapshot encontrado: ${fechaSnapshot}`);
        if (!cancel) setSnapshotUsado(fechaSnapshot);

        // 2. Cargar recursos (con paginación por si hay muchos)
        // Tomamos solo distintos: contratista + recurso_nombre + tipo + fecha_inicio + acceso
        let resultado = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          let query = sb.from("certronic_documentos")
            .select("contratista, recurso_nombre, recurso_identificador, tipo_recurso, fecha_inicio, acceso, planta, documento")
            .eq("fecha_snapshot", fechaSnapshot)
            .ilike("contratista", `%${transporte}%`)
            .range(from, from + limite - 1);
          const { data, error } = await query;
          if (cancel) return;
          if (error) {
            console.error(`[Recursos] Error consultando documentos:`, error);
            throw error;
          }
          if (!data || data.length === 0) break;
          resultado = resultado.concat(data);
          if (data.length < limite) break;
          from += limite;
        }
        console.log(`[Recursos] "${transporte}" en snapshot ${fechaSnapshot}: ${resultado.length} filas crudas`);

        // 3. Deduplicar por recurso, juntar todos los documentos de cada uno
        const recursosMap = new Map();
        for (const r of resultado) {
          const key = `${r.recurso_nombre || ""}|${r.tipo_recurso || ""}`;
          if (!recursosMap.has(key)) {
            recursosMap.set(key, {
              recurso_nombre: r.recurso_nombre,
              recurso_identificador: r.recurso_identificador,
              tipo_recurso: r.tipo_recurso,
              fecha_inicio: r.fecha_inicio,
              acceso: r.acceso,
              planta: r.planta,
              documentos: [],  // 🆕 lista de docs del recurso
              fecha_ingreso_real: null,  // 🆕 vendrá de certronic_empleados_detalle
            });
          }
          const existing = recursosMap.get(key);
          // Conservar fecha más antigua si la nueva es menor
          if (r.fecha_inicio && (!existing.fecha_inicio || r.fecha_inicio < existing.fecha_inicio)) {
            existing.fecha_inicio = r.fecha_inicio;
          }
          // Acumular documento (si no se duplica)
          if (r.documento && !existing.documentos.find(d => d.documento === r.documento)) {
            existing.documentos.push({ documento: r.documento });
          }
          // Conservar el primer identificador no-vacío
          if (!existing.recurso_identificador && r.recurso_identificador) {
            existing.recurso_identificador = r.recurso_identificador;
          }
        }

        // 4. Para SUB, filtrar solo el subcontratista específico (si está dado)
        let recursosFinales = Array.from(recursosMap.values());
        if (categoria === "SUB" && subcontratistaNombre) {
          // Match flexible: ignorar mayúsculas/acentos
          const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
          const target = norm(subcontratistaNombre);
          recursosFinales = recursosFinales.filter(r => norm(r.recurso_nombre).includes(target) || target.includes(norm(r.recurso_nombre)));
        }

        // 5. 🆕 ENRIQUECER con certronic_empleados_detalle (fecha_ingreso real)
        // Buscamos por CUIL (recurso_identificador en docs == cuil en detalle)
        const cuils = recursosFinales
          .filter(r => r.tipo_recurso === "empleado" && r.recurso_identificador)
          .map(r => r.recurso_identificador.replace(/[^0-9kK]/g, ""));  // limpiar formato

        if (cuils.length > 0) {
          try {
            // Snapshot más reciente de empleados detalle
            const { data: empSnap } = await sb.from("certronic_empleados_detalle")
              .select("fecha_snapshot")
              .order("fecha_snapshot", { ascending: false })
              .limit(1);

            if (empSnap && empSnap.length > 0) {
              const fechaSnapEmp = empSnap[0].fecha_snapshot;
              // Cargar todos los empleados de ese snapshot que matchen los cuils
              const { data: empleados } = await sb.from("certronic_empleados_detalle")
                .select("cuil, fecha_ingreso, email, celular, telefono, ficha_completa, categoria, funcion, tipo_contrato, tipo_trabajador")
                .eq("fecha_snapshot", fechaSnapEmp)
                .in("cuil", cuils);

              if (empleados && empleados.length > 0) {
                console.log(`[Recursos] Match con certronic_empleados_detalle: ${empleados.length}/${cuils.length}`);
                const empMap = new Map();
                for (const e of empleados) empMap.set(e.cuil, e);

                for (const r of recursosFinales) {
                  if (r.tipo_recurso === "empleado" && r.recurso_identificador) {
                    const cuilLimpio = r.recurso_identificador.replace(/[^0-9kK]/g, "");
                    const detalle = empMap.get(cuilLimpio);
                    if (detalle) {
                      r.fecha_ingreso_real = detalle.fecha_ingreso;
                      r.email = detalle.email;
                      r.celular = detalle.celular;
                      r.telefono = detalle.telefono;
                      r.ficha_completa = detalle.ficha_completa;
                      r.categoria = detalle.categoria;
                      r.funcion = detalle.funcion;
                      r.tipo_contrato = detalle.tipo_contrato;
                      r.tipo_trabajador = detalle.tipo_trabajador;
                    }
                  }
                }
              }
            }
          } catch (eEnrich) {
            console.warn("[Recursos] No se pudo enriquecer con detalle:", eEnrich.message);
          }
        }

        // 6. Ordenar: nuevos primero (más recientes), después por nombre
        recursosFinales.sort((a, b) => {
          const fa = a.fecha_ingreso_real || a.fecha_inicio;
          const fb = b.fecha_ingreso_real || b.fecha_inicio;
          if (fa && !fb) return -1;
          if (!fa && fb) return 1;
          if (fa && fb) {
            const cmp = fb.localeCompare(fa);
            if (cmp !== 0) return cmp;
          }
          return (a.recurso_nombre || "").localeCompare(b.recurso_nombre || "");
        });

        if (!cancel) setRecursos(recursosFinales);
      } catch (e) {
        console.error(e);
        if (!cancel) setRecursos([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, [transporte, categoria, subcontratistaNombre]);

  // 🆕 Sprint 3 — Cargar deudas históricas para cruzar con los recursos
  useEffect(() => {
    let cancel = false;
    if (recursos.length === 0) {
      setDeudasPorRecurso({});
      return;
    }
    (async () => {
      try {
        // Tomar todos los identificadores únicos de los recursos cargados
        const identificadores = [...new Set(recursos.map(r => r.recurso_identificador).filter(Boolean))];
        if (identificadores.length === 0) {
          if (!cancel) setDeudasPorRecurso({});
          return;
        }
        const { data, error } = await sb
          .from("vw_deudores_historicos_actuales_resumen")
          .select("identificador, total_deudas, meses_con_deuda, docs_distintos_adeudados, deuda_mas_antigua")
          .in("identificador", identificadores);
        if (cancel) return;
        if (error) {
          console.warn("[Recursos] Error cargando deudas históricas:", error.message);
          return;
        }
        const mapa = {};
        for (const d of (data || [])) {
          mapa[d.identificador] = d;
        }
        if (!cancel) setDeudasPorRecurso(mapa);
      } catch (e) {
        console.warn("[Recursos] No se pudieron cargar deudas históricas:", e.message);
      }
    })();
    return () => { cancel = true; };
  }, [recursos]);

  // Formato de fecha
  const fmtFecha = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return iso; }
  };

  // Determinar si la fecha es del mes en curso
  const esEsteMes = (iso) => {
    if (!iso) return false;
    const hoy = new Date();
    const fecha = new Date(iso + "T00:00:00");
    return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth();
  };
  // Días desde el ingreso
  const diasDesde = (iso) => {
    if (!iso) return null;
    const hoy = new Date();
    const fecha = new Date(iso + "T00:00:00");
    return Math.floor((hoy - fecha) / (1000 * 60 * 60 * 24));
  };
  // Mes en castellano
  const nombreMesActual = () => {
    return new Date().toLocaleDateString("es-CL", { month: "long" }).toUpperCase();
  };

  // Filtros aplicados
  const recursosFiltrados = useMemo(() => {
    let res = recursos;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      res = res.filter(r => (r.recurso_nombre || "").toLowerCase().includes(q));
    }
    if (filtroEntidad !== "todas") {
      res = res.filter(r => r.tipo_recurso === filtroEntidad);
    }
    return res;
  }, [recursos, busqueda, filtroEntidad]);

  // Stats
  const stats = useMemo(() => {
    const fechaParaUsar = (r) => r.fecha_ingreso_real || r.fecha_inicio;
    return {
      total: recursos.length,
      empleados: recursos.filter(r => r.tipo_recurso === "empleado").length,
      vehiculos: recursos.filter(r => r.tipo_recurso === "vehiculo").length,
      contratistas: recursos.filter(r => r.tipo_recurso === "contratista").length,
      nuevosEsteMes: recursos.filter(r => esEsteMes(fechaParaUsar(r))).length,
      inhabilitados: recursos.filter(r => r.acceso === "Inhabilitado").length,
      sinFecha: recursos.filter(r => !fechaParaUsar(r)).length,
      conFechaReal: recursos.filter(r => r.fecha_ingreso_real).length,
    };
  }, [recursos]);

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#002E5D" }}>
            Recursos del contratista — {transporte}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {snapshotUsado && `Snapshot: ${snapshotUsado}`}
            {categoria === "SUB" && subcontratistaNombre && ` · Filtrado: ${subcontratistaNombre}`}
          </div>
        </div>
        {!loading && recursos.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="text" placeholder="Buscar recurso..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
              style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 10px", fontSize: 11, minWidth: 160 }} />
            <select value={filtroEntidad} onChange={e => setFiltroEntidad(e.target.value)}
              style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 10px", fontSize: 11 }}>
              <option value="todas">Todos los tipos</option>
              <option value="empleado">Empleados</option>
              <option value="vehiculo">Vehículos</option>
              <option value="contratista">Contratista</option>
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Cargando recursos...</div>
      ) : recursos.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#475569" }}>Sin recursos para este contratista</div>
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            Buscamos en <code>certronic_documentos</code> con snapshot <strong>{snapshotUsado || "sin snapshot"}</strong>
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>
            Posibles causas:
          </div>
          <ul style={{ fontSize: 10, color: "#64748b", textAlign: "left", display: "inline-block", margin: "4px 0" }}>
            <li>El reporte completo (lunes/jueves 04:00) no incluyó a este contratista</li>
            <li>El nombre "<strong>{transporte}</strong>" no coincide exacto con la BD</li>
            <li>La tabla certronic_documentos está vacía o desactualizada</li>
          </ul>
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
            Abrir consola (F12) para ver detalle de la consulta
          </div>
        </div>
      ) : (
        <>
          {/* Mini KPIs */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, padding: "5px 10px", fontSize: 11 }}>
              <strong>{stats.total}</strong> recursos
              {stats.empleados > 0 && <span style={{ color: "#64748b" }}> · {stats.empleados} empl.</span>}
              {stats.vehiculos > 0 && <span style={{ color: "#64748b" }}> · {stats.vehiculos} veh.</span>}
            </div>
            {stats.conFechaReal > 0 && (
              <div title="Empleados con fecha real extraída de su ficha en Certronic" 
                style={{ background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#1e40af", fontWeight: 600 }}>
                ✓ {stats.conFechaReal} con fecha real
              </div>
            )}
            {stats.nuevosEsteMes > 0 && (
              <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#166534", fontWeight: 600 }}>
                🆕 {stats.nuevosEsteMes} ingresaron en {nombreMesActual()}
              </div>
            )}
            {stats.inhabilitados > 0 && (
              <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#991b1b", fontWeight: 600 }}>
                🚫 {stats.inhabilitados} inhabilitados
              </div>
            )}
            {stats.sinFecha > 0 && (
              <div style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, padding: "5px 10px", fontSize: 11, color: "#64748b" }}>
                ? {stats.sinFecha} sin fecha de ingreso
              </div>
            )}
          </div>

          {/* Tabla de recursos */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 4, overflow: "auto", maxHeight: 500 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead style={{ position: "sticky", top: 0, background: "#f1f5f9", zIndex: 1 }}>
                <tr>
                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Tipo</th>
                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Recurso</th>
                  <th style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Fecha de ingreso</th>
                  <th style={{ padding: "6px 10px", textAlign: "right", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Días</th>
                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Indicador</th>
                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }} title="Deudas históricas: documentos puntuales de meses pasados que nunca se presentaron">Deudas hist.</th>
                  <th style={{ padding: "6px 10px", textAlign: "center", fontSize: 10, fontWeight: 600, color: "#64748b" }}>Acceso</th>
                </tr>
              </thead>
              <tbody>
                {recursosFiltrados.map((r, i) => {
                  // Usar fecha_ingreso_real si existe, sino fecha_inicio (de docs)
                  const fechaIngreso = r.fecha_ingreso_real || r.fecha_inicio;
                  const esteMes = esEsteMes(fechaIngreso);
                  const dias = diasDesde(fechaIngreso);
                  const tipoColor = {
                    "empleado": "#dbeafe",
                    "vehiculo": "#fef3c7",
                    "contratista": "#f3e8ff",
                  }[r.tipo_recurso] || "#f1f5f9";
                  const tipoTextColor = {
                    "empleado": "#1e40af",
                    "vehiculo": "#92400e",
                    "contratista": "#6b21a8",
                  }[r.tipo_recurso] || "#64748b";
                  const fuenteFecha = r.fecha_ingreso_real ? "REAL" : (r.fecha_inicio ? "CONTRATO" : null);
                  
                  // Documentos problemáticos: si ingresó este mes, los del periodo anterior no aplican
                  const DOCS_NO_APLICAN_ANTES = [
                    "F30", "F30-1", "Liquidación de Sueldo", "Liquidacion de Sueldo",
                    "Cotizaciones", "Cotizaciones PREVIRED", "Mutualidad",
                  ];
                  const docsProblematicos = esteMes && r.documentos
                    ? r.documentos.filter(d => DOCS_NO_APLICAN_ANTES.some(t => (d.documento || "").toLowerCase().includes(t.toLowerCase())))
                    : [];

                  return (
                    <Fragment key={i}>
                      <tr style={{
                        borderTop: "1px solid #f1f5f9",
                        background: esteMes ? "#ecfdf5" : undefined,
                      }}>
                        <td style={{ padding: "6px 10px" }}>
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: tipoColor, color: tipoTextColor, fontWeight: 600, textTransform: "uppercase" }}>
                            {r.tipo_recurso || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "6px 10px", fontWeight: 500 }}>
                          {r.recurso_nombre || "—"}
                          {r.email && <div style={{ fontSize: 9, color: "#64748b", marginTop: 1 }}>{r.email}</div>}
                        </td>
                        <td style={{ padding: "6px 10px", color: fechaIngreso ? "#475569" : "#cbd5e1", fontFamily: fechaIngreso ? "inherit" : "monospace", fontSize: fechaIngreso ? 11 : 10 }}>
                          {fmtFecha(fechaIngreso)}
                          {fuenteFecha === "REAL" && (
                            <span title="Fecha extraída de la ficha del empleado en Certronic" style={{ marginLeft: 4, fontSize: 9, color: "#16a34a", fontWeight: 700 }}>✓</span>
                          )}
                          {fuenteFecha === "CONTRATO" && (
                            <span title="Fecha del contrato comercial (no del recurso individual)" style={{ marginLeft: 4, fontSize: 9, color: "#94a3b8" }}>~</span>
                          )}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: "#64748b", fontSize: 10 }}>
                          {dias != null ? `${dias} días` : "—"}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          {esteMes && (
                            <span style={{
                              fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 700,
                              background: "#16a34a", color: "#fff",
                            }}>
                              🆕 INGRESÓ {nombreMesActual()}
                            </span>
                          )}
                          {!esteMes && dias != null && dias <= 90 && (
                            <span style={{
                              fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 600,
                              background: "#fef3c7", color: "#92400e",
                            }}>
                              ≤ 90d
                            </span>
                          )}
                        </td>
                        {/* 🆕 Sprint 3 — Columna Deudas históricas */}
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          {(() => {
                            const deuda = r.recurso_identificador ? deudasPorRecurso[r.recurso_identificador] : null;
                            if (!deuda || !deuda.total_deudas) {
                              return <span style={{ fontSize: 10, color: "#cbd5e1" }}>—</span>;
                            }
                            return (
                              <span
                                title={`${deuda.total_deudas} documentos adeudados en ${deuda.meses_con_deuda} mes(es). Deuda más antigua: ${deuda.deuda_mas_antigua ? deuda.deuda_mas_antigua.substring(0,7) : "—"}`}
                                style={{
                                  fontSize: 10, padding: "2px 7px", borderRadius: 10, fontWeight: 700,
                                  background: "#fef3c7", color: "#92400e", border: "1px solid #fbbf24",
                                  cursor: "help",
                                }}
                              >
                                ⚠ {deuda.total_deudas}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          <span style={{
                            fontSize: 10, padding: "2px 6px", borderRadius: 3, fontWeight: 600,
                            background: r.acceso === "Habilitado" ? "#dcfce7" : r.acceso === "Inhabilitado" ? "#fee2e2" : "#f1f5f9",
                            color: r.acceso === "Habilitado" ? "#166534" : r.acceso === "Inhabilitado" ? "#991b1b" : "#64748b",
                          }}>
                            {r.acceso || "—"}
                          </span>
                        </td>
                      </tr>
                      {/* Fila de alerta cuando ingresó este mes y tiene docs problemáticos */}
                      {esteMes && docsProblematicos.length > 0 && (
                        <tr style={{ background: "#fffbeb" }}>
                          <td colSpan={7} style={{ padding: "6px 12px 8px 32px", borderTop: "none" }}>
                            <div style={{ fontSize: 10, color: "#92400e", display: "flex", alignItems: "flex-start", gap: 6 }}>
                              <span style={{ fontWeight: 700 }}>⚠️ Atención:</span>
                              <div>
                                <div>Ingresó este mes — los siguientes documentos del periodo anterior NO deberían aplicar:</div>
                                <div style={{ marginTop: 3 }}>
                                  {docsProblematicos.map((d, j) => (
                                    <span key={j} style={{ display: "inline-block", marginRight: 6, marginTop: 2, fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#fed7aa", color: "#9a3412", fontWeight: 600 }}>
                                      {d.documento}
                                    </span>
                                  ))}
                                </div>
                                <div style={{ marginTop: 3, fontStyle: "italic", color: "#a16207" }}>
                                  El analista debe revisar manualmente y marcar como NO_APLICA si corresponde.
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {recursosFiltrados.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: "#94a3b8", fontSize: 11 }}>
                Ningún recurso coincide con los filtros
              </div>
            )}
          </div>

          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
            💡 Símbolos en la columna fecha: <strong style={{ color: "#16a34a" }}>✓</strong> = fecha real del empleado (de su ficha); <strong style={{ color: "#94a3b8" }}>~</strong> = fecha del contrato comercial (aproximada).
            Recursos con badge <strong style={{ color: "#16a34a" }}>INGRESÓ {nombreMesActual()}</strong> requieren revisión manual de docs anteriores.
          </div>
        </>
      )}
    </div>
  );
}
