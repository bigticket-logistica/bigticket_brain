import { useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "../../shared";
import { BotonDescargarExcel, traerTodo } from "./comun";

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD INICIAL — Una fila por contratista, columnas por doc
// ═══════════════════════════════════════════════════════════════
export function DashboardInicial() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  const [snapshotDetalle, setSnapshotDetalle] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos"); // todos | verde | amarillo | rojo

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        // 1. Snapshot más reciente de empleados_docs (la fuente de los DOC_CONTRATISTA)
        const { data: snap } = await sb.from("certronic_empleados_docs")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        if (!snap || snap.length === 0) {
          if (!cancel) { setDocs([]); setLoading(false); }
          return;
        }
        const fechaSnap = snap[0].fecha_snapshot;
        if (!cancel) setSnapshotUsado(fechaSnap);

        // 2. Cargar todos los DOC_CONTRATISTA del snapshot (paginado)
        let resultado = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          const { data, error } = await sb.from("certronic_empleados_docs")
            .select("token_certronic, documento, cumple, vencimiento, impide_pago")
            .eq("fecha_snapshot", fechaSnap)
            .eq("origen", "DOC_CONTRATISTA")
            .range(from, from + limite - 1);
          if (cancel) return;
          if (error) throw error;
          if (!data || data.length === 0) break;
          resultado = resultado.concat(data);
          if (data.length < limite) break;
          from += limite;
        }

        // 3. 🆕 Buscar el snapshot MÁS RECIENTE de empleados_detalle INDEPENDIENTEMENTE
        //    No asumir que tiene la misma fecha que empleados_docs.
        //    El scraper de detalle puede fallar/atrasarse mientras docs sí se actualiza.
        const { data: snapDet } = await sb.from("certronic_empleados_detalle")
          .select("fecha_snapshot")
          .order("fecha_snapshot", { ascending: false })
          .limit(1);
        const fechaSnapDet = snapDet && snapDet[0] ? snapDet[0].fecha_snapshot : null;
        if (!cancel) setSnapshotDetalle(fechaSnapDet);

        // Cargar mapping token → contratista (de empleados_detalle, con su snapshot independiente)
        const tokenAContratista = new Map();
        const tokenAPlanta = new Map();
        if (fechaSnapDet) {
          const detalles = await traerTodo(() => sb.from("certronic_empleados_detalle")
            .select("token_certronic, contratista, planta")
            .eq("fecha_snapshot", fechaSnapDet)
            .order("id"));
          for (const d of detalles || []) {
            if (d.contratista) tokenAContratista.set(d.token_certronic, d.contratista);
            if (d.planta) tokenAPlanta.set(d.token_certronic, d.planta);
          }
        }

        if (!cancel) setDocs(resultado.map(r => ({
          ...r,
          contratista: tokenAContratista.get(r.token_certronic) || "(sin contratista)",
          planta: tokenAPlanta.get(r.token_certronic) || null,
        })));
      } catch (e) {
        console.error("[DashboardInicial] Error:", e);
        if (!cancel) setDocs([]);
      }
      if (!cancel) setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  // Procesar: agrupar por contratista
  const { contratistas, todosDocsUnicos } = useMemo(() => {
    if (!docs.length) return { contratistas: [], todosDocsUnicos: [] };
    
    // 1. Lista única de docs (columnas dinámicas, ordenadas por frecuencia)
    const cuentaDocs = {};
    for (const d of docs) {
      cuentaDocs[d.documento] = (cuentaDocs[d.documento] || 0) + 1;
    }
    const todosDocsUnicos = Object.entries(cuentaDocs)
      .sort((a, b) => b[1] - a[1])
      .map(([nombre]) => nombre);
    
    // 2. Agrupar por contratista
    const porContratista = new Map();
    for (const d of docs) {
      const c = d.contratista;
      if (!porContratista.has(c)) {
        porContratista.set(c, { contratista: c, planta: d.planta, docs: new Map() });
      }
      const grupo = porContratista.get(c);
      // Tomar el primer cumple que aparezca (todos los empleados del mismo contratista
      // deberían tener el mismo estado del doc del contratista)
      if (!grupo.docs.has(d.documento)) {
        grupo.docs.set(d.documento, {
          cumple: d.cumple,
          vencimiento: d.vencimiento,
          impide_pago: d.impide_pago,
        });
      }
    }
    
    // 3. Calcular % cumplimiento por contratista
    const lista = [];
    for (const [contratista, grupo] of porContratista.entries()) {
      const totalDocs = grupo.docs.size;
      const cumplen = Array.from(grupo.docs.values()).filter(d => d.cumple === true).length;
      const porcentaje = totalDocs > 0 ? Math.round((cumplen * 100) / totalDocs) : 0;
      let semaforo = "rojo";
      if (porcentaje === 100) semaforo = "verde";
      else if (porcentaje >= 50) semaforo = "amarillo";
      
      lista.push({
        contratista,
        planta: grupo.planta,
        totalDocs,
        cumplen,
        porcentaje,
        semaforo,
        docs: grupo.docs,
      });
    }
    
    // Ordenar: rojos primero (peores), después amarillos, después verdes
    lista.sort((a, b) => {
      const orden = { rojo: 0, amarillo: 1, verde: 2 };
      if (orden[a.semaforo] !== orden[b.semaforo]) return orden[a.semaforo] - orden[b.semaforo];
      return a.contratista.localeCompare(b.contratista);
    });
    
    return { contratistas: lista, todosDocsUnicos };
  }, [docs]);

  // Filtrar
  const contratistasFiltrados = useMemo(() => {
    let r = contratistas;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(c => c.contratista.toLowerCase().includes(q));
    }
    if (filtroEstado !== "todos") {
      r = r.filter(c => c.semaforo === filtroEstado);
    }
    return r;
  }, [contratistas, busqueda, filtroEstado]);

  const stats = useMemo(() => ({
    total: contratistas.length,
    verdes: contratistas.filter(c => c.semaforo === "verde").length,
    amarillos: contratistas.filter(c => c.semaforo === "amarillo").length,
    rojos: contratistas.filter(c => c.semaforo === "rojo").length,
  }), [contratistas]);

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Cargando docs iniciales...</div>;
  if (!contratistas.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos de docs iniciales en certronic_empleados_docs.
      <br />Verificá que el scraper de empleados haya corrido.
    </div>
  );

  // Render del ícono de cumplimiento
  const renderCumple = (cumple) => {
    if (cumple === true) return <span style={{ color: "#16a34a", fontWeight: 700, fontSize: 14 }}>✓</span>;
    if (cumple === false) return <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 14 }}>✗</span>;
    return <span style={{ color: "#cbd5e1", fontSize: 11 }}>—</span>;
  };

  // Render del semáforo
  const colorSemaforo = (s) => s === "verde" ? "#16a34a" : s === "amarillo" ? "#f59e0b" : "#dc2626";
  const bgSemaforo = (s) => s === "verde" ? "#dcfce7" : s === "amarillo" ? "#fef3c7" : "#fee2e2";

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#002E5D" }}>
            📋 Dashboard Inicial — Documentación del Contratista
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {contratistas.length} contratistas · Snapshot: {snapshotUsado || "—"} · 
            {todosDocsUnicos.length} tipos de documento detectados
          </div>
          {/* 🆕 Warning si los dos snapshots están desincronizados */}
          {snapshotDetalle && snapshotUsado && snapshotDetalle !== snapshotUsado && (
            <div style={{
              marginTop: 6, padding: "6px 10px", fontSize: 10.5,
              background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4,
              color: "#92400e", display: "inline-block",
            }}>
              ⚠️ <strong>Desincronización detectada:</strong> documentos del <strong>{snapshotUsado}</strong> pero mapping de contratistas del <strong>{snapshotDetalle}</strong>. Algunos contratistas nuevos pueden aparecer como "(sin contratista)" hasta que el próximo scraper completo se ejecute.
            </div>
          )}
        </div>
        <BotonDescargarExcel onClick={() => {
          // Hoja 1: matriz contratista x doc
          const headers = ["Contratista", "Planta", "Cumple", "Total", "% Cumplimiento", "Semáforo", ...todosDocsUnicos];
          const filas = contratistas.map(c => {
            const row = [
              c.contratista,
              c.planta || "",
              c.cumplen,
              c.totalDocs,
              c.porcentaje + "%",
              c.semaforo === "verde" ? "VERDE 100%" : c.semaforo === "amarillo" ? "AMARILLO 50-99%" : "ROJO <50%",
            ];
            for (const doc of todosDocsUnicos) {
              const dato = c.docs.get(doc);
              if (!dato) row.push("N/A");
              else if (dato.cumple === true) row.push("CUMPLE");
              else if (dato.cumple === false) row.push("NO CUMPLE");
              else row.push("?");
            }
            return row;
          });
          
          // Hoja 2: detalle por documento
          const headersDet = ["Contratista", "Documento", "Cumple", "Vencimiento", "Impide Pago"];
          const filasDet = [];
          for (const c of contratistas) {
            for (const [doc, dato] of c.docs.entries()) {
              filasDet.push([
                c.contratista,
                doc,
                dato.cumple === true ? "Sí" : dato.cumple === false ? "No" : "?",
                dato.vencimiento || "",
                dato.impide_pago ? "Sí" : "No",
              ]);
            }
          }
          
          descargarExcelMultihoja([
            { nombre: "Matriz", datos: [headers, ...filas] },
            { nombre: "Detalle", datos: [headersDet, ...filasDet] },
          ], "Dashboard_Inicial");
        }} disabled={contratistas.length === 0} />
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => setFiltroEstado("todos")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "todos" ? "#002E5D" : "#fff",
          color: filtroEstado === "todos" ? "#fff" : "#002E5D",
          border: "1px solid #002E5D",
        }}>Todos ({stats.total})</button>
        <button onClick={() => setFiltroEstado("verde")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "verde" ? "#16a34a" : "#dcfce7",
          color: filtroEstado === "verde" ? "#fff" : "#166534",
          border: "1px solid #16a34a",
        }}>✓ Cumple 100% ({stats.verdes})</button>
        <button onClick={() => setFiltroEstado("amarillo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "amarillo" ? "#f59e0b" : "#fef3c7",
          color: filtroEstado === "amarillo" ? "#fff" : "#92400e",
          border: "1px solid #f59e0b",
        }}>⚠ Parcial 50-99% ({stats.amarillos})</button>
        <button onClick={() => setFiltroEstado("rojo")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroEstado === "rojo" ? "#dc2626" : "#fee2e2",
          color: filtroEstado === "rojo" ? "#fff" : "#991b1b",
          border: "1px solid #dc2626",
        }}>✗ Crítico &lt;50% ({stats.rojos})</button>
        <input
          type="text"
          placeholder="Buscar contratista..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, width: 200, marginLeft: "auto" }}
        />
      </div>

      {/* Tabla */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#002E5D", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700, position: "sticky", left: 0, background: "#002E5D", zIndex: 3, minWidth: 220 }}>Contratista</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, minWidth: 110, whiteSpace: "nowrap" }}>Cumplimiento</th>
              {todosDocsUnicos.map(doc => {
                // Generar abreviación corta del documento (3-4 palabras max)
                const abrev = doc
                  .replace(/Recepción /i, "Recep. ")
                  .replace(/Actualización /i, "Act. ")
                  .replace(/Certificado de /i, "Cert. ")
                  .replace(/Declaración Jurada /i, "Decl.J. ")
                  .replace(/Aceptación de términos y condiciones del /i, "Acept. ")
                  .replace(/Pago Cotizaciones Previsionales /i, "Cotiz. ")
                  .replace(/Procedimiento de /i, "Proc. ");
                return (
                  <th key={doc} style={{ 
                    padding: "10px 6px", textAlign: "center", fontSize: 9, fontWeight: 600,
                    minWidth: 90, maxWidth: 130, lineHeight: 1.25, verticalAlign: "middle",
                  }} title={doc}>
                    {abrev}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {contratistasFiltrados.map((c, i) => (
              <tr key={i} style={{ borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafbfc" }}>
                <td style={{ padding: "8px", fontWeight: 600, color: "#1f2937", position: "sticky", left: 0, background: i % 2 === 0 ? "#fff" : "#fafbfc", zIndex: 1, borderRight: "1px solid #e4e7ec" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorSemaforo(c.semaforo), flexShrink: 0 }} />
                    <span>{c.contratista}</span>
                  </div>
                  {c.planta && <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{c.planta}</div>}
                </td>
                <td style={{ padding: "8px", textAlign: "center" }}>
                  <span style={{
                    padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                    background: bgSemaforo(c.semaforo), color: colorSemaforo(c.semaforo),
                    whiteSpace: "nowrap", display: "inline-block",
                  }}>
                    {c.cumplen}/{c.totalDocs} ({c.porcentaje}%)
                  </span>
                </td>
                {todosDocsUnicos.map(doc => {
                  const dato = c.docs.get(doc);
                  return (
                    <td key={doc} style={{ padding: "8px 4px", textAlign: "center" }}>
                      {dato ? renderCumple(dato.cumple) : <span style={{ color: "#e2e8f0", fontSize: 10 }}>n/a</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {contratistasFiltrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún contratista coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
        💡 Cada fila es 1 contratista. <strong style={{ color: "#16a34a" }}>✓</strong> = cumple · <strong style={{ color: "#dc2626" }}>✗</strong> = no cumple · <span style={{ color: "#94a3b8" }}>n/a</span> = no aplica para ese contratista.
        <br />
        Tooltip en encabezados: pasá el mouse para ver el nombre completo del documento.
      </div>
    </div>
  );
}
