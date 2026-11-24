import { Fragment, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "../../shared";
import { BotonDescargarExcel, traerTodo } from "./comun";

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD EMPLEADOS — vista detallada de los 376 empleados
// ═══════════════════════════════════════════════════════════════
export function DashboardEmpleados() {
  const [empleados, setEmpleados] = useState([]);
  const [docs, setDocs] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  
  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [filtroContratista, setFiltroContratista] = useState("todos");
  const [filtroSemaforo, setFiltroSemaforo] = useState("todos");
  const [soloIngresoEsteMes, setSoloIngresoEsteMes] = useState(false);
  
  // Expansión
  const [expandidoToken, setExpandidoToken] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Snapshot más reciente
        const { data: snap } = await sb.from("certronic_empleados_detalle")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snap || snap.length === 0) {
          if (!cancel) { setEmpleados([]); setLoading(false); }
          return;
        }
        const fechaSnap = snap[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnap);

        // 2. Cargar empleados detalle (paginado)
        let dets = [];
        let from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_empleados_detalle")
            .select("token_certronic, nombre_completo, apellido, nombre, cuil, fecha_ingreso, contratista, planta, categoria, funcion, tipo_contrato, tipo_trabajador, email, celular, telefono, ficha_completa")
            .eq("fecha_snapshot", fechaSnap)
            .range(from, from + 999);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          dets = dets.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        if (!cancel) setEmpleados(dets);

        // 3. Cargar docs (paginado)
        let docsArr = [];
        from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_empleados_docs")
            .select("token_certronic, origen, documento, cumple, vencimiento, vencimiento_raw, impide_pago, impide_acceso, entidad, periodos_pendientes, estado")
            .eq("fecha_snapshot", fechaSnap)
            .range(from, from + 999);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          docsArr = docsArr.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        if (!cancel) setDocs(docsArr);

        // 4. Cargar contratos
        const contrs = await traerTodo(() => sb.from("certronic_empleados_contratos_indiv")
          .select("token_certronic, contrato_titular, planta, principal, desde, desde_raw, hasta, hasta_raw, estado")
          .eq("fecha_snapshot", fechaSnap)
          .order("id"));
        if (!cancel) setContratos(contrs);

      } catch (e) {
        console.error("[DashboardEmpleados] Error:", e);
        if (!cancel) setEmpleados([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Indexar docs por token (para cada empleado encontrar sus docs rápido)
  const docsPorEmpleado = useMemo(() => {
    const m = new Map();
    for (const d of docs) {
      if (!m.has(d.token_certronic)) m.set(d.token_certronic, []);
      m.get(d.token_certronic).push(d);
    }
    return m;
  }, [docs]);

  const contratosPorEmpleado = useMemo(() => {
    const m = new Map();
    for (const c of contratos) {
      if (!m.has(c.token_certronic)) m.set(c.token_certronic, []);
      m.get(c.token_certronic).push(c);
    }
    return m;
  }, [contratos]);

  // Calcular stats por empleado (% cumplimiento, pendientes, etc)
  const empleadosConStats = useMemo(() => {
    return empleados.map(e => {
      const sus_docs = docsPorEmpleado.get(e.token_certronic) || [];
      const docEmpl = sus_docs.filter(d => d.origen === "DOC_EMPLEADO");
      const docCont = sus_docs.filter(d => d.origen === "DOC_CONTRATISTA");
      const pendientes = sus_docs.filter(d => d.origen === "MIS_PENDIENTES");
      
      // Cumplimiento de docs personales (DOC_EMPLEADO)
      const totalPersonales = docEmpl.length;
      const cumplenPersonales = docEmpl.filter(d => d.cumple === true).length;
      const pctPersonales = totalPersonales > 0 ? Math.round((cumplenPersonales * 100) / totalPersonales) : 0;
      
      let semaforo = "rojo";
      if (totalPersonales === 0) semaforo = "gris";
      else if (pctPersonales === 100) semaforo = "verde";
      else if (pctPersonales >= 50) semaforo = "amarillo";
      
      // Vencimientos próximos
      const hoy = new Date();
      const en30Dias = new Date(); en30Dias.setDate(hoy.getDate() + 30);
      const docsPorVencer = docEmpl.filter(d => {
        if (!d.vencimiento) return false;
        const v = new Date(d.vencimiento);
        return v >= hoy && v <= en30Dias;
      });
      const docsVencidos = docEmpl.filter(d => {
        if (!d.vencimiento) return false;
        return new Date(d.vencimiento) < hoy;
      });
      
      return {
        ...e,
        sus_docs,
        docEmpl,
        docCont,
        pendientes,
        totalPersonales,
        cumplenPersonales,
        pctPersonales,
        semaforo,
        docsPorVencer,
        docsVencidos,
      };
    });
  }, [empleados, docsPorEmpleado]);

  // Detectar mes actual
  const mesActualStr = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const ingresoEsteMes = (fecha) => fecha && fecha.startsWith(mesActualStr);
  const nombreMesActual = () => {
    const meses = ["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];
    return meses[new Date().getMonth()];
  };

  // Filtros
  const empleadosFiltrados = useMemo(() => {
    let r = empleadosConStats;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(e =>
        (e.nombre_completo || "").toLowerCase().includes(q) ||
        (e.cuil || "").includes(q) ||
        (e.contratista || "").toLowerCase().includes(q) ||
        (e.email || "").toLowerCase().includes(q)
      );
    }
    if (filtroContratista !== "todos") {
      r = r.filter(e => e.contratista === filtroContratista);
    }
    if (filtroSemaforo !== "todos") {
      r = r.filter(e => e.semaforo === filtroSemaforo);
    }
    if (soloIngresoEsteMes) {
      r = r.filter(e => ingresoEsteMes(e.fecha_ingreso));
    }
    return r;
  }, [empleadosConStats, busqueda, filtroContratista, filtroSemaforo, soloIngresoEsteMes, mesActualStr]);

  // Contratistas únicos para filtro
  const contratistasUnicos = useMemo(() => {
    const s = new Set();
    for (const e of empleados) if (e.contratista) s.add(e.contratista);
    return Array.from(s).sort();
  }, [empleados]);

  // Stats globales
  const statsGlobales = useMemo(() => ({
    total: empleadosConStats.length,
    verdes: empleadosConStats.filter(e => e.semaforo === "verde").length,
    amarillos: empleadosConStats.filter(e => e.semaforo === "amarillo").length,
    rojos: empleadosConStats.filter(e => e.semaforo === "rojo").length,
    grises: empleadosConStats.filter(e => e.semaforo === "gris").length,
    ingresaronEsteMes: empleadosConStats.filter(e => ingresoEsteMes(e.fecha_ingreso)).length,
    conPendientes: empleadosConStats.filter(e => e.pendientes.length > 0).length,
    totalPendientes: empleadosConStats.reduce((s, e) => s + e.pendientes.length, 0),
  }), [empleadosConStats, mesActualStr]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Cargando empleados...</div>;
  if (!empleados.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos de empleados en certronic_empleados_detalle.
    </div>
  );

  // Helpers de UI
  const colorSemaforo = (s) => s === "verde" ? "#16a34a" : s === "amarillo" ? "#f59e0b" : s === "rojo" ? "#dc2626" : "#94a3b8";
  const bgSemaforo = (s) => s === "verde" ? "#dcfce7" : s === "amarillo" ? "#fef3c7" : s === "rojo" ? "#fee2e2" : "#f1f5f9";

  const fmtFecha = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    return `${parseInt(d)}-${meses[parseInt(m)-1]}-${y.slice(2)}`;
  };

  const renderCumple = (cumple) => {
    if (cumple === true) return <span style={{ color: "#16a34a", fontSize: 14, fontWeight: 700 }}>✓</span>;
    if (cumple === false) return <span style={{ color: "#dc2626", fontSize: 14, fontWeight: 700 }}>✗</span>;
    return <span style={{ color: "#cbd5e1" }}>—</span>;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#002E5D" }}>
            👷 Empleados — Vista detallada
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {empleados.length} empleados · Snapshot: {snapshotUsado || "—"}
          </div>
        </div>
        <BotonDescargarExcel onClick={() => {
          // Hoja Resumen
          const headersRes = ["Apellido", "Nombre", "CUIL/Cédula", "Email", "Celular", "Contratista", "Planta", "Categoría", "Función", "Tipo Contrato", "Tipo Trabajador", "Fecha Ingreso", "Cumple", "Total Docs", "% Cumplim.", "Semáforo", "Pendientes", "Por Vencer ≤30d", "Vencidos", "Ficha Completa"];
          const filasRes = empleadosConStats.map(e => [
            e.apellido || "",
            e.nombre || "",
            e.cuil || "",
            e.email || "",
            e.celular || "",
            e.contratista || "",
            e.planta || "",
            e.categoria || "",
            e.funcion || "",
            e.tipo_contrato || "",
            e.tipo_trabajador || "",
            e.fecha_ingreso || "",
            e.cumplenPersonales,
            e.totalPersonales,
            e.pctPersonales + "%",
            e.semaforo.toUpperCase(),
            e.pendientes.length,
            e.docsPorVencer.length,
            e.docsVencidos.length,
            e.ficha_completa ? "Sí" : "No",
          ]);
          
          // Hoja Docs detalle
          const headersDoc = ["Empleado", "CUIL", "Contratista", "Origen", "Documento", "Cumple", "Vencimiento", "Impide Pago", "Impide Acceso"];
          const filasDoc = [];
          for (const e of empleadosConStats) {
            for (const d of e.sus_docs) {
              filasDoc.push([
                e.nombre_completo || "",
                e.cuil || "",
                e.contratista || "",
                d.origen,
                d.documento,
                d.cumple === true ? "Sí" : d.cumple === false ? "No" : "?",
                d.vencimiento || d.vencimiento_raw || "",
                d.impide_pago ? "Sí" : "No",
                d.impide_acceso ? "Sí" : "No",
              ]);
            }
          }
          
          // Hoja Pendientes
          const headersPend = ["Empleado", "CUIL", "Contratista", "Documento", "Períodos Adeudados", "Estado", "Impide Pago"];
          const filasPend = [];
          for (const e of empleadosConStats) {
            for (const p of e.pendientes) {
              filasPend.push([
                e.nombre_completo || "",
                e.cuil || "",
                e.contratista || "",
                p.documento,
                p.periodos_pendientes || "",
                p.estado || "",
                p.impide_pago ? "Sí" : "No",
              ]);
            }
          }
          
          // Hoja Vencidos
          const headersVenc = ["Empleado", "CUIL", "Contratista", "Documento", "Vencimiento", "Días vencido"];
          const filasVenc = [];
          const hoy = new Date();
          for (const e of empleadosConStats) {
            for (const d of e.docsVencidos) {
              const dias = Math.floor((hoy - new Date(d.vencimiento)) / (1000 * 60 * 60 * 24));
              filasVenc.push([
                e.nombre_completo || "",
                e.cuil || "",
                e.contratista || "",
                d.documento,
                d.vencimiento,
                dias,
              ]);
            }
          }
          
          descargarExcelMultihoja([
            { nombre: "Resumen", datos: [headersRes, ...filasRes] },
            { nombre: "Docs Detalle", datos: [headersDoc, ...filasDoc] },
            { nombre: "Pendientes", datos: [headersPend, ...filasPend] },
            { nombre: "Vencidos", datos: [headersVenc, ...filasVenc] },
          ], "Empleados");
        }} disabled={empleados.length === 0} />
      </div>

      {/* KPIs filtrables */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setFiltroSemaforo("todos")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "todos" ? "#002E5D" : "#fff",
          color: filtroSemaforo === "todos" ? "#fff" : "#002E5D",
          border: "1px solid #002E5D",
        }}>Todos ({statsGlobales.total})</button>
        <button onClick={() => setFiltroSemaforo("verde")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "verde" ? "#16a34a" : "#dcfce7",
          color: filtroSemaforo === "verde" ? "#fff" : "#166534",
          border: "1px solid #16a34a",
        }}>✓ 100% ({statsGlobales.verdes})</button>
        <button onClick={() => setFiltroSemaforo("amarillo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "amarillo" ? "#f59e0b" : "#fef3c7",
          color: filtroSemaforo === "amarillo" ? "#fff" : "#92400e",
          border: "1px solid #f59e0b",
        }}>⚠ 50-99% ({statsGlobales.amarillos})</button>
        <button onClick={() => setFiltroSemaforo("rojo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroSemaforo === "rojo" ? "#dc2626" : "#fee2e2",
          color: filtroSemaforo === "rojo" ? "#fff" : "#991b1b",
          border: "1px solid #dc2626",
        }}>✗ &lt;50% ({statsGlobales.rojos})</button>
        {statsGlobales.grises > 0 && (
          <button onClick={() => setFiltroSemaforo("gris")} style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: filtroSemaforo === "gris" ? "#94a3b8" : "#f1f5f9",
            color: filtroSemaforo === "gris" ? "#fff" : "#475569",
            border: "1px solid #cbd5e1",
          }}>Sin docs ({statsGlobales.grises})</button>
        )}
        <button onClick={() => setSoloIngresoEsteMes(!soloIngresoEsteMes)} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: soloIngresoEsteMes ? "#16a34a" : "#fff",
          color: soloIngresoEsteMes ? "#fff" : "#16a34a",
          border: "1px solid #16a34a",
        }}>🆕 Ingresaron este mes ({statsGlobales.ingresaronEsteMes})</button>
        {statsGlobales.totalPendientes > 0 && (
          <div style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5",
          }}>
            ⚠ {statsGlobales.totalPendientes} pendientes en {statsGlobales.conPendientes} empleados
          </div>
        )}
      </div>

      {/* Filtros adicionales */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Buscar nombre, CUIL, email, contratista..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, flex: 1, minWidth: 250 }}
        />
        <select
          value={filtroContratista}
          onChange={e => setFiltroContratista(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, minWidth: 200 }}
        >
          <option value="todos">Todos los contratistas ({contratistasUnicos.length})</option>
          {contratistasUnicos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Mostrando: <strong>{empleadosFiltrados.length}</strong> / {empleados.length}
        </span>
      </div>

      {/* Tabla principal */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#002E5D", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, width: 30 }}></th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Empleado</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Contratista / Planta</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Fecha Ingreso</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Cumplim.</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Pendientes</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Vencen ≤30d</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Vencidos</th>
            </tr>
          </thead>
          <tbody>
            {empleadosFiltrados.map((e, i) => {
              const expandido = expandidoToken === e.token_certronic;
              const esIngresoMes = ingresoEsteMes(e.fecha_ingreso);
              return (
                <Fragment key={e.token_certronic}>
                  <tr 
                    onClick={() => setExpandidoToken(expandido ? null : e.token_certronic)}
                    style={{ 
                      borderTop: "1px solid #f1f5f9", 
                      background: expandido ? "#eff6ff" : (esIngresoMes ? "#ecfdf5" : (i % 2 === 0 ? "#fff" : "#fafbfc")),
                      cursor: "pointer",
                    }}>
                    <td style={{ padding: "8px", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
                      {expandido ? "▼" : "▶"}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontWeight: 600, color: "#1f2937" }}>
                        {e.nombre_completo || `${e.apellido || ""} ${e.nombre || ""}`.trim() || "(sin nombre)"}
                        {esIngresoMes && (
                          <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "#16a34a", color: "#fff", fontWeight: 700 }}>
                            🆕 {nombreMesActual()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                        {e.cuil && <span>{e.cuil}</span>}
                        {e.email && <span> · {e.email}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontSize: 11 }}>{e.contratista || "—"}</div>
                      {e.planta && <div style={{ fontSize: 9, color: "#94a3b8" }}>{e.planta}</div>}
                    </td>
                    <td style={{ padding: "8px", color: e.fecha_ingreso ? "#475569" : "#cbd5e1" }}>
                      {fmtFecha(e.fecha_ingreso)}
                      {e.fecha_ingreso && (
                        <span title="Fecha real de la ficha" style={{ marginLeft: 4, fontSize: 9, color: "#16a34a", fontWeight: 700 }}>✓</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <span style={{
                        padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: bgSemaforo(e.semaforo), color: colorSemaforo(e.semaforo),
                        whiteSpace: "nowrap", display: "inline-block",
                      }}>
                        {e.cumplenPersonales}/{e.totalPersonales} ({e.pctPersonales}%)
                      </span>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {e.pendientes.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                          {e.pendientes.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {e.docsPorVencer.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                          {e.docsPorVencer.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {e.docsVencidos.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                          {e.docsVencidos.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                  </tr>
                  {/* Fila expandida con detalle */}
                  {expandido && (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, background: "#f8fafc", borderTop: "1px solid #e4e7ec" }}>
                        <DetalleEmpleado 
                          empleado={e}
                          contratos={contratosPorEmpleado.get(e.token_certronic) || []}
                          fmtFecha={fmtFecha}
                          renderCumple={renderCumple}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {empleadosFiltrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún empleado coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
        💡 Click en cualquier fila para ver el detalle completo del empleado (docs, vencimientos, contratos).
      </div>
    </div>
  );
}

// ─── Sub-componente: detalle expandido del empleado ───────────────
function DetalleEmpleado({ empleado, contratos, fmtFecha, renderCumple }) {
  const e = empleado;
  
  return (
    <div>
      {/* Info personal extra */}
      {e.ficha_completa && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: 10, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6 }}>
          {e.celular && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Celular:</strong> {e.celular}</div>}
          {e.telefono && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Teléfono:</strong> {e.telefono}</div>}
          {e.categoria && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Categoría:</strong> {e.categoria}</div>}
          {e.funcion && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Función:</strong> {e.funcion}</div>}
          {e.tipo_contrato && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Tipo Contrato:</strong> {e.tipo_contrato}</div>}
          {e.tipo_trabajador && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Tipo Trabajador:</strong> {e.tipo_trabajador}</div>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Columna izquierda: Doc.Empleado */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
            📄 Documentos del Empleado ({e.docEmpl.length})
          </h4>
          {e.docEmpl.length === 0 ? (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin documentos personales registrados</div>
          ) : (
            <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Documento</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Cumple</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Vence</th>
                  <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Pago</th>
                </tr>
              </thead>
              <tbody>
                {e.docEmpl.map((d, j) => (
                  <tr key={j} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "4px 6px", fontWeight: 500 }}>{d.documento}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{renderCumple(d.cumple)}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center", color: d.vencimiento ? "#475569" : "#cbd5e1" }}>
                      {d.vencimiento ? fmtFecha(d.vencimiento) : (d.vencimiento_raw || "—")}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                      {d.impide_pago && <span title="Impide Pago" style={{ color: "#f59e0b", fontSize: 14 }}>🟡</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Columna derecha: Doc.Contratista + Pendientes + Contratos */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Pendientes (lo más importante visual) */}
          {e.pendientes.length > 0 && (
            <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, padding: 10 }}>
              <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
                ⚠ Pendientes ({e.pendientes.length})
              </h4>
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #fcd34d" }}>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Documento</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Períodos</th>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#78350f", fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {e.pendientes.map((p, j) => (
                    <tr key={j} style={{ borderTop: "1px solid #fcd34d" }}>
                      <td style={{ padding: "3px 6px", color: "#78350f" }}>{p.documento}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#92400e", fontWeight: 700 }}>{p.periodos_pendientes || "—"}</td>
                      <td style={{ padding: "3px 6px", color: "#78350f" }}>{p.estado || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Contratos */}
          <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
              📑 Contratos ({contratos.length})
            </h4>
            {contratos.length === 0 ? (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin contratos individuales</div>
            ) : (
              <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Titular / Planta</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Desde</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Hasta</th>
                    <th style={{ textAlign: "center", padding: "3px 6px", color: "#64748b", fontWeight: 600 }}>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {contratos.map((c, j) => (
                    <tr key={j} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "3px 6px" }}>
                        <div>{c.contrato_titular}</div>
                        {c.planta && <div style={{ color: "#94a3b8", fontSize: 9 }}>{c.planta}</div>}
                      </td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#64748b" }}>{c.desde_raw || "—"}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center", color: "#64748b" }}>{c.hasta_raw || "—"}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center" }}>
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 10, fontWeight: 600,
                          background: c.estado === "Activo" ? "#dcfce7" : "#f1f5f9",
                          color: c.estado === "Activo" ? "#166534" : "#64748b",
                        }}>
                          {c.estado || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Doc.Contratista (debajo, compacto) */}
      {e.docCont.length > 0 && (
        <div style={{ marginTop: 14, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
            🏢 Documentos del Contratista ({e.docCont.length})
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {e.docCont.map((d, j) => (
              <span key={j} title={d.vencimiento_raw || ""} style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 6, fontWeight: 500,
                background: d.cumple === true ? "#dcfce7" : d.cumple === false ? "#fee2e2" : "#f1f5f9",
                color: d.cumple === true ? "#166534" : d.cumple === false ? "#991b1b" : "#64748b",
                border: d.impide_pago ? "1px solid #f59e0b" : "1px solid transparent",
              }}>
                {d.cumple === true ? "✓" : d.cumple === false ? "✗" : "?"} {d.documento}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
