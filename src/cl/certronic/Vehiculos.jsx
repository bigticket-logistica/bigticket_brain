import { Fragment, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "../../shared";
import { BotonDescargarExcel, traerTodo } from "./comun";

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD VEHÍCULOS — vista detallada de los 342 vehículos
// ═══════════════════════════════════════════════════════════════
export function DashboardVehiculos() {
  const [vehiculos, setVehiculos] = useState([]);
  const [docs, setDocs] = useState([]);
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  
  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [filtroContratista, setFiltroContratista] = useState("todos");
  const [filtroSemaforo, setFiltroSemaforo] = useState("todos");
  const [filtroEnergia, setFiltroEnergia] = useState("todos");
  
  // Expansión
  const [expandidoToken, setExpandidoToken] = useState(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Snapshot más reciente
        const { data: snap } = await sb.from("certronic_vehiculos_detalle")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snap || snap.length === 0) {
          if (!cancel) { setVehiculos([]); setLoading(false); }
          return;
        }
        const fechaSnap = snap[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnap);

        // 2. Cargar vehículos detalle (paginado)
        let dets = [];
        let from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_vehiculos_detalle")
            .select("token_certronic, dominio, marca, modelo, tipo, numero_motor, numero_chasis, cia_seguros, categoria, anio_vehiculo, operacion, servicio, tipo_certificacion, tipo_energia, contratista, planta, ficha_completa")
            .eq("fecha_snapshot", fechaSnap)
            .range(from, from + 999);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          dets = dets.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        if (!cancel) setVehiculos(dets);

        // 3. Cargar docs (paginado)
        let docsArr = [];
        from = 0;
        while (true) {
          const { data, error } = await sb.from("certronic_vehiculos_docs")
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
        const contrs = await traerTodo(() => sb.from("certronic_vehiculos_contratos_indiv")
          .select("token_certronic, contrato_titular, planta, principal, desde, desde_raw, hasta, hasta_raw, estado")
          .eq("fecha_snapshot", fechaSnap)
          .order("id"));
        if (!cancel) setContratos(contrs);

      } catch (e) {
        console.error("[DashboardVehiculos] Error:", e);
        if (!cancel) setVehiculos([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Indexar
  const docsPorVehiculo = useMemo(() => {
    const m = new Map();
    for (const d of docs) {
      if (!m.has(d.token_certronic)) m.set(d.token_certronic, []);
      m.get(d.token_certronic).push(d);
    }
    return m;
  }, [docs]);

  const contratosPorVehiculo = useMemo(() => {
    const m = new Map();
    for (const c of contratos) {
      if (!m.has(c.token_certronic)) m.set(c.token_certronic, []);
      m.get(c.token_certronic).push(c);
    }
    return m;
  }, [contratos]);

  // Calcular stats
  const vehiculosConStats = useMemo(() => {
    return vehiculos.map(v => {
      const sus_docs = docsPorVehiculo.get(v.token_certronic) || [];
      const docVeh = sus_docs.filter(d => d.origen === "DOC_VEHICULO");
      const docCont = sus_docs.filter(d => d.origen === "DOC_CONTRATISTA");
      const pendientes = sus_docs.filter(d => d.origen === "MIS_PENDIENTES");
      
      const totalDocs = docVeh.length;
      const cumplenDocs = docVeh.filter(d => d.cumple === true).length;
      const pctDocs = totalDocs > 0 ? Math.round((cumplenDocs * 100) / totalDocs) : 0;
      
      let semaforo = "rojo";
      if (totalDocs === 0) semaforo = "gris";
      else if (pctDocs === 100) semaforo = "verde";
      else if (pctDocs >= 50) semaforo = "amarillo";
      
      // Vencimientos
      const hoy = new Date();
      const en30Dias = new Date(); en30Dias.setDate(hoy.getDate() + 30);
      const docsPorVencer = docVeh.filter(d => {
        if (!d.vencimiento) return false;
        const vDate = new Date(d.vencimiento);
        return vDate >= hoy && vDate <= en30Dias;
      });
      const docsVencidos = docVeh.filter(d => {
        if (!d.vencimiento) return false;
        return new Date(d.vencimiento) < hoy;
      });
      
      return {
        ...v,
        sus_docs, docVeh, docCont, pendientes,
        totalDocs, cumplenDocs, pctDocs, semaforo,
        docsPorVencer, docsVencidos,
      };
    });
  }, [vehiculos, docsPorVehiculo]);

  // Filtros
  const vehiculosFiltrados = useMemo(() => {
    let r = vehiculosConStats;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(v =>
        (v.dominio || "").toLowerCase().includes(q) ||
        (v.marca || "").toLowerCase().includes(q) ||
        (v.modelo || "").toLowerCase().includes(q) ||
        (v.contratista || "").toLowerCase().includes(q) ||
        (v.numero_motor || "").toLowerCase().includes(q) ||
        (v.numero_chasis || "").toLowerCase().includes(q)
      );
    }
    if (filtroContratista !== "todos") r = r.filter(v => v.contratista === filtroContratista);
    if (filtroSemaforo !== "todos") r = r.filter(v => v.semaforo === filtroSemaforo);
    if (filtroEnergia !== "todos") r = r.filter(v => (v.tipo_energia || "").toUpperCase() === filtroEnergia);
    return r;
  }, [vehiculosConStats, busqueda, filtroContratista, filtroSemaforo, filtroEnergia]);

  // Únicos para filtros
  const contratistasUnicos = useMemo(() => {
    const s = new Set();
    for (const v of vehiculos) if (v.contratista) s.add(v.contratista);
    return Array.from(s).sort();
  }, [vehiculos]);

  const energiasUnicas = useMemo(() => {
    const s = new Set();
    for (const v of vehiculos) if (v.tipo_energia) s.add(v.tipo_energia.toUpperCase());
    return Array.from(s).sort();
  }, [vehiculos]);

  // Stats globales
  const statsGlobales = useMemo(() => ({
    total: vehiculosConStats.length,
    verdes: vehiculosConStats.filter(v => v.semaforo === "verde").length,
    amarillos: vehiculosConStats.filter(v => v.semaforo === "amarillo").length,
    rojos: vehiculosConStats.filter(v => v.semaforo === "rojo").length,
    grises: vehiculosConStats.filter(v => v.semaforo === "gris").length,
    conPendientes: vehiculosConStats.filter(v => v.pendientes.length > 0).length,
    totalPendientes: vehiculosConStats.reduce((s, v) => s + v.pendientes.length, 0),
    conVencidos: vehiculosConStats.filter(v => v.docsVencidos.length > 0).length,
  }), [vehiculosConStats]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Cargando vehículos...</div>;
  if (!vehiculos.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos de vehículos en certronic_vehiculos_detalle.
    </div>
  );

  // Helpers
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
            🚗 Vehículos — Vista detallada
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {vehiculos.length} vehículos · Snapshot: {snapshotUsado || "—"}
          </div>
        </div>
        <BotonDescargarExcel onClick={() => {
          // Hoja Resumen
          const headersRes = ["Dominio", "Marca", "Modelo", "Año", "Tipo", "Tipo Certificación", "Tipo Energía", "N° Motor", "N° Chasis", "Cía. Seguros", "Categoría", "Operación", "Servicio", "Contratista", "Planta", "Cumple", "Total Docs", "% Cumplim.", "Semáforo", "Pendientes", "Por Vencer ≤30d", "Vencidos"];
          const filasRes = vehiculosConStats.map(v => [
            v.dominio || "",
            v.marca || "",
            v.modelo || "",
            v.anio_vehiculo || "",
            v.tipo || "",
            v.tipo_certificacion || "",
            v.tipo_energia || "",
            v.numero_motor || "",
            v.numero_chasis || "",
            v.cia_seguros || "",
            v.categoria || "",
            v.operacion || "",
            v.servicio || "",
            v.contratista || "",
            v.planta || "",
            v.cumplenDocs,
            v.totalDocs,
            v.pctDocs + "%",
            v.semaforo.toUpperCase(),
            v.pendientes.length,
            v.docsPorVencer.length,
            v.docsVencidos.length,
          ]);
          
          // Hoja Docs detalle
          const headersDoc = ["Dominio", "Marca/Modelo", "Contratista", "Origen", "Documento", "Cumple", "Vencimiento", "Impide Pago", "Impide Acceso"];
          const filasDoc = [];
          for (const v of vehiculosConStats) {
            for (const d of v.sus_docs) {
              filasDoc.push([
                v.dominio || "",
                `${v.marca || ""} ${v.modelo || ""}`.trim(),
                v.contratista || "",
                d.origen,
                d.documento,
                d.cumple === true ? "Sí" : d.cumple === false ? "No" : "?",
                d.vencimiento || d.vencimiento_raw || "",
                d.impide_pago ? "Sí" : "No",
                d.impide_acceso ? "Sí" : "No",
              ]);
            }
          }
          
          // Hoja Vencidos
          const headersVenc = ["Dominio", "Marca/Modelo", "Contratista", "Documento", "Vencimiento", "Días vencido"];
          const filasVenc = [];
          const hoy = new Date();
          for (const v of vehiculosConStats) {
            for (const d of v.docsVencidos) {
              const dias = Math.floor((hoy - new Date(d.vencimiento)) / (1000 * 60 * 60 * 24));
              filasVenc.push([
                v.dominio || "",
                `${v.marca || ""} ${v.modelo || ""}`.trim(),
                v.contratista || "",
                d.documento,
                d.vencimiento,
                dias,
              ]);
            }
          }
          
          descargarExcelMultihoja([
            { nombre: "Resumen", datos: [headersRes, ...filasRes] },
            { nombre: "Docs Detalle", datos: [headersDoc, ...filasDoc] },
            { nombre: "Vencidos", datos: [headersVenc, ...filasVenc] },
          ], "Vehiculos");
        }} disabled={vehiculos.length === 0} />
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
        {statsGlobales.conVencidos > 0 && (
          <div style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5",
          }}>
            ⛔ {statsGlobales.conVencidos} vehículos con docs vencidos
          </div>
        )}
        {statsGlobales.totalPendientes > 0 && (
          <div style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600,
            background: "#fef3c7", color: "#92400e", border: "1px solid #fbbf24",
          }}>
            ⚠ {statsGlobales.totalPendientes} pendientes
          </div>
        )}
      </div>

      {/* Filtros adicionales */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Buscar dominio, marca, modelo, contratista, motor, chasis..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, flex: 1, minWidth: 250 }}
        />
        <select
          value={filtroContratista}
          onChange={e => setFiltroContratista(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, minWidth: 180 }}
        >
          <option value="todos">Todos los contratistas ({contratistasUnicos.length})</option>
          {contratistasUnicos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {energiasUnicas.length > 1 && (
          <select
            value={filtroEnergia}
            onChange={e => setFiltroEnergia(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11 }}
          >
            <option value="todos">Toda energía</option>
            {energiasUnicas.map(en => <option key={en} value={en}>{en}</option>)}
          </select>
        )}
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Mostrando: <strong>{vehiculosFiltrados.length}</strong> / {vehiculos.length}
        </span>
      </div>

      {/* Tabla principal */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#002E5D", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, width: 30 }}></th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Vehículo</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Contratista / Planta</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Tipo / Energía</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Cumplim.</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Pendientes</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>Vencen ≤30d</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Vencidos</th>
            </tr>
          </thead>
          <tbody>
            {vehiculosFiltrados.map((v, i) => {
              const expandido = expandidoToken === v.token_certronic;
              return (
                <Fragment key={v.token_certronic}>
                  <tr 
                    onClick={() => setExpandidoToken(expandido ? null : v.token_certronic)}
                    style={{ 
                      borderTop: "1px solid #f1f5f9", 
                      background: expandido ? "#eff6ff" : (v.docsVencidos.length > 0 ? "#fef2f2" : (i % 2 === 0 ? "#fff" : "#fafbfc")),
                      cursor: "pointer",
                    }}>
                    <td style={{ padding: "8px", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
                      {expandido ? "▼" : "▶"}
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontWeight: 700, color: "#1f2937", fontSize: 12 }}>
                        {v.dominio || "(sin dominio)"}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                        {v.marca || "—"} {v.modelo || ""}
                        {v.anio_vehiculo && <span> · {v.anio_vehiculo}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontSize: 11 }}>{v.contratista || "—"}</div>
                      {v.planta && <div style={{ fontSize: 9, color: "#94a3b8" }}>{v.planta}</div>}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.tipo_certificacion && (
                        <div style={{ fontSize: 10, color: "#475569" }}>
                          {v.tipo_certificacion}
                        </div>
                      )}
                      {v.tipo_energia && (
                        <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>
                          {v.tipo_energia}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <span style={{
                        padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: bgSemaforo(v.semaforo), color: colorSemaforo(v.semaforo),
                        whiteSpace: "nowrap", display: "inline-block",
                      }}>
                        {v.cumplenDocs}/{v.totalDocs} ({v.pctDocs}%)
                      </span>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.pendientes.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>
                          {v.pendientes.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.docsPorVencer.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
                          {v.docsPorVencer.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {v.docsVencidos.length > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#dc2626", color: "#fff", fontWeight: 700 }}>
                          {v.docsVencidos.length}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                  </tr>
                  {/* Fila expandida */}
                  {expandido && (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, background: "#f8fafc", borderTop: "1px solid #e4e7ec" }}>
                        <DetalleVehiculo 
                          vehiculo={v}
                          contratos={contratosPorVehiculo.get(v.token_certronic) || []}
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
        {vehiculosFiltrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún vehículo coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
        💡 Click en cualquier fila para ver el detalle (docs, vencimientos, contratos). Vehículos con docs vencidos están resaltados en rojo.
      </div>
    </div>
  );
}

// ─── Sub-componente: detalle expandido del vehículo ───────────────
function DetalleVehiculo({ vehiculo, contratos, fmtFecha, renderCumple }) {
  const v = vehiculo;
  
  return (
    <div>
      {/* Datos generales del vehículo */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14, padding: 10, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6 }}>
        {v.numero_motor && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Motor:</strong> {v.numero_motor}</div>}
        {v.numero_chasis && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Chasis:</strong> {v.numero_chasis}</div>}
        {v.cia_seguros && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Seguros:</strong> {v.cia_seguros}</div>}
        {v.categoria && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Categoría:</strong> {v.categoria}</div>}
        {v.operacion && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Operación:</strong> {v.operacion}</div>}
        {v.servicio && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Servicio:</strong> {v.servicio}</div>}
        {v.tipo && <div style={{ fontSize: 11 }}><strong style={{ color: "#64748b" }}>Tipo:</strong> {v.tipo}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Columna izquierda: Doc.Vehículo */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
            🚗 Documentos del Vehículo ({v.docVeh.length})
          </h4>
          {v.docVeh.length === 0 ? (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin documentos del vehículo</div>
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
                {v.docVeh.map((d, j) => {
                  const hoy = new Date();
                  const vencido = d.vencimiento && new Date(d.vencimiento) < hoy;
                  return (
                    <tr key={j} style={{ borderTop: "1px solid #f1f5f9", background: vencido ? "#fef2f2" : undefined }}>
                      <td style={{ padding: "4px 6px", fontWeight: 500 }}>
                        {d.documento}
                        {vencido && <span style={{ marginLeft: 4, color: "#dc2626", fontWeight: 700, fontSize: 9 }}>VENCIDO</span>}
                      </td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>{renderCumple(d.cumple)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "center", color: vencido ? "#991b1b" : (d.vencimiento ? "#475569" : "#cbd5e1"), fontWeight: vencido ? 700 : 400 }}>
                        {d.vencimiento ? fmtFecha(d.vencimiento) : (d.vencimiento_raw || "—")}
                      </td>
                      <td style={{ padding: "4px 6px", textAlign: "center" }}>
                        {d.impide_pago && <span title="Impide Pago" style={{ color: "#f59e0b", fontSize: 14 }}>🟡</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Columna derecha */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Pendientes */}
          {v.pendientes.length > 0 && (
            <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 6, padding: 10 }}>
              <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>
                ⚠ Pendientes ({v.pendientes.length})
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
                  {v.pendientes.map((p, j) => (
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

      {/* Doc.Contratista */}
      {v.docCont.length > 0 && (
        <div style={{ marginTop: 14, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
            🏢 Documentos del Contratista ({v.docCont.length})
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {v.docCont.map((d, j) => (
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
