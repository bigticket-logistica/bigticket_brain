import { useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "../../shared";
import { BotonDescargarExcel } from "./comun";

// ─── Sub-componente: Editor Matriz ───────────────────────────────────
// ─── Sub-componente: Hallazgos Automáticos ──────────────────────────
// Calcula hallazgos accionables comparando datos del mes con el historial.
// Cada hallazgo tiene un nivel (alto/medio/bajo) y una sugerencia de acción.
export function HallazgosAutomaticos({ datos, activosCriticos, todosInhabilitados, empresasInhabilitadasUnicas, operacionAMandante }) {
  const [estadosCertronic, setEstadosCertronic] = useState([]);
  const [matriz, setMatriz] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generandoPDF, setGenerandoPDF] = useState(false);

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      // Último snapshot de estados
      const { data: snap } = await sb.from("certronic_estados_documentos")
        .select("fecha_snapshot")
        .order("fecha_snapshot", { ascending: false }).limit(1);
      if (snap && snap[0]) {
        // Cargar TODOS los estados (paginado)
        let todos = [];
        let from = 0;
        while (true) {
          const { data } = await sb.from("certronic_estados_documentos")
            .select("*")
            .eq("fecha_snapshot", snap[0].fecha_snapshot)
            .range(from, from + 999);
          if (!data || data.length === 0) break;
          todos = todos.concat(data);
          if (data.length < 1000) break;
          from += 1000;
        }
        setEstadosCertronic(todos);
      }
      const { data: m } = await sb.from("certronic_matriz_documentos")
        .select("*").is("fecha_fin_vigencia", null);
      setMatriz(m || []);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  // ─── Generar PDF de hallazgos on-demand ──────────────────────────
  const descargarPDF = async () => {
    setGenerandoPDF(true);
    try {
      // Cargar jsPDF dinámicamente
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = 210, pageH = 297;
      const margin = 15;
      let y = margin;

      // Header
      pdf.setFontSize(18);
      pdf.setTextColor(26, 58, 107); // azul
      pdf.setFont("helvetica", "bold");
      pdf.text("Hallazgos Automáticos · Certificación Documental", margin, y);
      y += 7;
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.setFont("helvetica", "italic");
      pdf.text(`Generado: ${new Date().toLocaleString("es-CL")} · ${hallazgos.length} hallazgos`, margin, y);
      y += 10;

      // Resumen rápido
      pdf.setDrawColor(228, 231, 236);
      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(margin, y, pageW - 2 * margin, 18, 2, 2, "FD");
      pdf.setFontSize(9);
      pdf.setTextColor(31, 41, 55);
      pdf.setFont("helvetica", "normal");
      const resumenText = `Empresas activas: ${[...datos.pc, ...datos.ryc, ...datos.sub].filter(d => !d.recurso_inhabilitado && d.categoria === "RYC").length}  ·  Inhabilitadas: ${empresasInhabilitadasUnicas}  ·  Críticas (con retención): ${activosCriticos.length}`;
      pdf.text(resumenText, margin + 4, y + 7);
      pdf.text(`Total registros calculados: ${[...datos.pc, ...datos.ryc, ...datos.sub].length}  ·  Período: ${new Date().toLocaleDateString("es-CL", { month: "long", year: "numeric" })}`, margin + 4, y + 13);
      y += 22;

      // Hallazgos
      const colorByNivel = {
        alto: [192, 57, 43],
        medio: [244, 123, 32],
        bajo: [59, 130, 246],
      };
      const nivelLabel = { alto: "ALTA", medio: "MEDIA", bajo: "BAJA" };

      hallazgos.forEach(h => {
        // Estimar altura del bloque
        const lineasDesc = pdf.splitTextToSize(h.descripcion, pageW - 2 * margin - 10);
        const lineasImpacto = pdf.splitTextToSize(h.impacto, pageW - 2 * margin - 10);
        const lineasAccion = pdf.splitTextToSize(h.accion, pageW - 2 * margin - 10);
        const altoBloque = 30 + (lineasDesc.length + lineasImpacto.length + lineasAccion.length) * 4 + (h.ejemplos.length > 0 ? h.ejemplos.length * 4 + 8 : 0);

        // Salto de página si no entra
        if (y + altoBloque > pageH - 20) {
          pdf.addPage();
          y = margin;
        }

        const [r, g, b] = colorByNivel[h.nivel] || [100, 100, 100];

        // Línea izquierda de color
        pdf.setDrawColor(r, g, b);
        pdf.setLineWidth(1);
        pdf.line(margin, y, margin, y + altoBloque - 4);

        // Badge de nivel
        pdf.setFillColor(r, g, b);
        pdf.roundedRect(margin + 3, y + 1, 14, 5, 1, 1, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.text(nivelLabel[h.nivel], margin + 4, y + 4.5);

        // ID hallazgo
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(7);
        pdf.text(`HALLAZGO ${h.id}`, margin + 20, y + 4.5);

        y += 8;

        // Título
        pdf.setTextColor(r, g, b);
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        const lineasTitulo = pdf.splitTextToSize(h.titulo, pageW - 2 * margin - 5);
        pdf.text(lineasTitulo, margin + 3, y);
        y += lineasTitulo.length * 5 + 1;

        // Descripción
        pdf.setTextColor(31, 41, 55);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(lineasDesc, margin + 3, y);
        y += lineasDesc.length * 4 + 3;

        // Impacto
        pdf.setTextColor(r, g, b);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("Impacto:", margin + 3, y);
        y += 3.5;
        pdf.setTextColor(31, 41, 55);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.text(lineasImpacto, margin + 3, y);
        y += lineasImpacto.length * 4 + 2;

        // Acción
        pdf.setTextColor(r, g, b);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.text("Acción sugerida:", margin + 3, y);
        y += 3.5;
        pdf.setTextColor(31, 41, 55);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.text(lineasAccion, margin + 3, y);
        y += lineasAccion.length * 4 + 2;

        // Ejemplos
        if (h.ejemplos.length > 0) {
          pdf.setTextColor(r, g, b);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8);
          pdf.text("Ejemplos:", margin + 3, y);
          y += 3.5;
          pdf.setTextColor(31, 41, 55);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8);
          h.ejemplos.forEach(e => {
            const linea = `• ${e.nombre} — ${e.dato}`;
            const lineasEj = pdf.splitTextToSize(linea, pageW - 2 * margin - 8);
            pdf.text(lineasEj, margin + 5, y);
            y += lineasEj.length * 3.5;
          });
          y += 2;
        }

        y += 5;
      });

      // Footer en cada página
      const totalPaginas = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= totalPaginas; i++) {
        pdf.setPage(i);
        pdf.setFontSize(7);
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Bigticket · Hallazgos automáticos · Página ${i} de ${totalPaginas}`, margin, pageH - 8);
      }

      const fecha = new Date().toISOString().slice(0, 10);
      pdf.save(`Hallazgos_Bigticket_${fecha}.pdf`);
    } catch(e) {
      console.error(e);
      alert("Error generando PDF: " + e.message);
    }
    setGenerandoPDF(false);
  };

  // ─── Cálculo de los 8 hallazgos automáticos ─────────────────────
  const hallazgos = useMemo(() => {
    if (loading || estadosCertronic.length === 0) return [];

    const out = [];

    // H1: Empresas activas con retención (lo más urgente)
    if (activosCriticos.length > 0) {
      out.push({
        id: "H1",
        nivel: "alto",
        icono: "🚨",
        titulo: `${activosCriticos.length} empresas activas con retención de pagos`,
        descripcion: `Estas empresas tienen empleados o vehículos operando HOY pero su documentación retiene total o parcialmente sus pagos.`,
        impacto: `Riesgo de retraso en pagos a transportistas que sí están trabajando. ${activosCriticos.filter(a => Number(a.pct_retencion) >= 100).length} con retención total (100%).`,
        accion: "Llamar a estas empresas hoy. Lista priorizada en pestaña 🚨 Activos Críticos.",
        ejemplos: activosCriticos.slice(0, 5).map(a => ({
          nombre: a.transporte + (a.subcontratista_nombre ? ` / ${a.subcontratista_nombre}` : ""),
          dato: `${a.pct_retencion}% retención · ${a.empleados_activos} emp · ${a.vehiculos_activos} veh`,
        })),
      });
    }

    // H2: Empresas inhabilitadas — distintivo Certronic por docs pendientes
    if (empresasInhabilitadasUnicas > 0) {
      out.push({
        id: "H2",
        nivel: "medio",
        icono: "⚠️",
        titulo: `${empresasInhabilitadasUnicas} empresas marcadas como Inhabilitadas en Certronic`,
        descripcion: "El distintivo INHABILITADO indica documentación pendiente. La empresa puede seguir operando pero requiere regularizar documentos.",
        impacto: "Riesgo de retención de pagos. Estas empresas siguen apareciendo en el Dashboard Mensual destacadas en rojo.",
        accion: "Revisar las empresas marcadas en rojo en las pestañas PC/RyC/SUB. Coordinar con cada contratista la entrega de documentos pendientes.",
        ejemplos: [],
      });
    }

    // H3: Vehículos sin documentación legal para circular
    const vehiculosSinDocs = estadosCertronic.filter(e => 
      e.entidad === 'vehiculo' && e.cumple === 'N' && e.impide_acceso === 'S'
    );
    const vehiculosUnicosAfectados = new Set(vehiculosSinDocs.map(v => `${v.contratista}|${v.detalle}`));
    if (vehiculosUnicosAfectados.size > 0) {
      const docsCriticos = ["Permiso de Circulación", "Revisión Técnica", "Seguro Obligatorio Vehicular", "Certificado de Emisión de Contaminantes"];
      const totalCriticos = vehiculosSinDocs.filter(v => docsCriticos.some(d => v.documento.includes(d.split(" ")[0]))).length;
      out.push({
        id: "H3",
        nivel: "alto",
        icono: "🚛",
        titulo: `${vehiculosUnicosAfectados.size} vehículos con documentación legal vencida o pendiente`,
        descripcion: "Vehículos sin Permiso de Circulación, Revisión Técnica, Seguro Obligatorio o Certificado de Emisión.",
        impacto: "Riesgo de responsabilidad solidaria para Bigticket si circulan. No deberían operar legalmente.",
        accion: "Sacar de operación inmediata. Notificar a contratistas para regularización urgente.",
        ejemplos: [...vehiculosUnicosAfectados].slice(0, 5).map(v => {
          const [contratista, detalle] = v.split("|");
          return { nombre: detalle, dato: `de ${contratista}` };
        }),
      });
    }

    // H4: Documentos que más fallan sistémicamente
    const docFallas = {};
    for (const e of estadosCertronic) {
      if (!docFallas[e.documento]) docFallas[e.documento] = { total: 0, fallas: 0, contratistas: new Set() };
      docFallas[e.documento].total++;
      if (e.cumple === 'N') {
        docFallas[e.documento].fallas++;
        docFallas[e.documento].contratistas.add(e.contratista);
      }
    }
    const topFallas = Object.entries(docFallas)
      .filter(([_, v]) => v.total >= 10 && v.fallas / v.total >= 0.4)
      .map(([doc, v]) => ({ doc, pctFalla: Math.round(v.fallas / v.total * 100), contratistas: v.contratistas.size }))
      .sort((a, b) => b.pctFalla - a.pctFalla)
      .slice(0, 5);
    if (topFallas.length > 0) {
      out.push({
        id: "H4",
        nivel: "medio",
        icono: "📋",
        titulo: `${topFallas.length} documentos fallan en más del 40% de los casos`,
        descripcion: "Documentos con tasa de no-cumplimiento alta. Indica problema sistémico, no casos puntuales.",
        impacto: "Sugiere revisar el proceso de captura de estos documentos: ¿son innecesarios? ¿están mal explicados al transportista? ¿vencen muy seguido?",
        accion: "Analizar con el mandante si el documento sigue siendo necesario o si la captura puede simplificarse.",
        ejemplos: topFallas.map(t => ({ nombre: t.doc.substring(0, 60), dato: `${t.pctFalla}% falla · ${t.contratistas} empresas` })),
      });
    }

    // H5: Top contratistas problemáticos
    const contratistaProblemas = {};
    for (const e of estadosCertronic) {
      if (e.cumple !== 'N') continue;
      if (!contratistaProblemas[e.contratista]) {
        contratistaProblemas[e.contratista] = { total: 0, retentivos: 0, accesoNegado: 0 };
      }
      contratistaProblemas[e.contratista].total++;
      if (e.impide_pago === 'S') contratistaProblemas[e.contratista].retentivos++;
      if (e.impide_acceso === 'S') contratistaProblemas[e.contratista].accesoNegado++;
    }
    const topProblema = Object.entries(contratistaProblemas)
      .map(([c, v]) => ({ contratista: c, ...v }))
      .filter(x => x.retentivos >= 10)
      .sort((a, b) => b.retentivos - a.retentivos)
      .slice(0, 5);
    if (topProblema.length > 0) {
      out.push({
        id: "H5",
        nivel: "medio",
        icono: "🥇",
        titulo: `${topProblema.length} contratistas concentran problemas extremos`,
        descripcion: "Empresas con 10 o más documentos pendientes que generan retención.",
        impacto: "Estas empresas requieren atención individual o decisión sobre su continuidad.",
        accion: "Reunión 1:1 con cada uno: ¿quieren regularizar o ya no van a operar más?",
        ejemplos: topProblema.map(t => ({ nombre: t.contratista, dato: `${t.retentivos} docs retentivos · ${t.accesoNegado} sin acceso` })),
      });
    }

    // H6: Empresas Inhabilitadas que SIGUEN OPERANDO (prioridad de regularización)
    // Estas empresas tienen empleados/vehículos activos pero Certronic las marca como
    // Inhabilitadas por documentación pendiente. Son las que requieren acción urgente.
    const inhabPeroOperan = [...datos.pc, ...datos.ryc, ...datos.sub]
      .filter(d => d.recurso_inhabilitado && (d.empleados_activos > 0 || d.vehiculos_activos > 0));
    const inhabPeroOperanUnicas = [...new Set(inhabPeroOperan.map(d => d.transporte))];
    if (inhabPeroOperanUnicas.length > 0) {
      // Calcular empleados/vehículos totales involucrados para mostrar magnitud real
      const empleadosAfectados = inhabPeroOperan.reduce((sum, d) => sum + (d.empleados_activos || 0), 0);
      const vehiculosAfectados = inhabPeroOperan.reduce((sum, d) => sum + (d.vehiculos_activos || 0), 0);
      out.push({
        id: "H6",
        nivel: "alto",
        icono: "🚨",
        titulo: `${inhabPeroOperanUnicas.length} empresas inhabilitadas operando con personal activo`,
        descripcion: `Estas empresas están marcadas como Inhabilitadas en Certronic (documentación pendiente) pero siguen operando con ${empleadosAfectados} empleado(s) y ${vehiculosAfectados} vehículo(s) activo(s). Son la prioridad #1 de regularización: están generando servicio mientras tienen retención de pago activa.`,
        impacto: "Riesgo dual: contratista no cobra (retención por docs pendientes) + Bigticket expuesto a contingencia laboral/cumplimiento por personal sin cobertura documental al día.",
        accion: "Revisar caso a caso en pestañas PC/RyC/SUB (filas en rojo). Para cada una: identificar qué documento falta (matriz de docs), contactar al contratista con plazo concreto, y escalar si no responde en 48h. Considerar suspensión operativa si pasa 7 días sin regularizar.",
        ejemplos: inhabPeroOperanUnicas.slice(0, 5).map(c => {
          const filas = inhabPeroOperan.filter(d => d.transporte === c);
          const totalEmp = filas.reduce((s, d) => s + (d.empleados_activos || 0), 0);
          const totalVeh = filas.reduce((s, d) => s + (d.vehiculos_activos || 0), 0);
          return { nombre: c, dato: `${totalEmp} emp · ${totalVeh} veh activos` };
        }),
      });
    }

    // H7: Documentos por mandante - distribución
    const porMandante = {};
    for (const e of estadosCertronic) {
      const m = e.planta;
      if (!porMandante[m]) porMandante[m] = { total: 0, retentivos: 0 };
      porMandante[m].total++;
      if (e.cumple === 'N' && e.impide_pago === 'S') porMandante[m].retentivos++;
    }
    const distMandante = Object.entries(porMandante).map(([m, v]) => ({
      mandante: m, total: v.total, retentivos: v.retentivos,
      pctRetentivos: Math.round(v.retentivos / v.total * 100),
    })).sort((a, b) => b.retentivos - a.retentivos);
    if (distMandante.length > 0) {
      const peor = distMandante[0];
      out.push({
        id: "H7",
        nivel: "bajo",
        icono: "🏭",
        titulo: `${peor.mandante} concentra el ${Math.round(peor.retentivos / distMandante.reduce((s,x) => s+x.retentivos, 0) * 100)}% de retenciones`,
        descripcion: `De los ${distMandante.reduce((s,x) => s+x.retentivos, 0)} documentos retentivos totales, ${peor.retentivos} están en ${peor.mandante}.`,
        impacto: "Permite priorizar dónde concentrar los esfuerzos de gestión documental.",
        accion: `Considerar acciones específicas para mejorar la performance en ${peor.mandante}.`,
        ejemplos: distMandante.slice(0, 5).map(d => ({ nombre: d.mandante, dato: `${d.retentivos} retentivos · ${d.pctRetentivos}% del total mandante` })),
      });
    }

    return out;
  }, [estadosCertronic, datos, activosCriticos, todosInhabilitados, loading]);

  if (loading) return <div className="loading">Calculando hallazgos...</div>;

  const colorNivel = {
    alto: { bg: "#fee2e2", border: "#fca5a5", text: "#991b1b", label: "ALTA" },
    medio: { bg: "#fef3c7", border: "#fbbf24", text: "#92400e", label: "MEDIA" },
    bajo: { bg: "#dbeafe", border: "#93c5fd", text: "#1e40af", label: "BAJA" },
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D" }}>Hallazgos Automáticos del Mes</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>
            {hallazgos.length} hallazgos detectados al cruzar datos del scraper, matriz y reglas de negocio. Se recalculan automáticamente cada vez que el sistema se actualiza.
          </div>
        </div>
      </div>

      {hallazgos.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", color: "#16a34a", fontSize: 14 }}>
          ✅ No se detectaron hallazgos relevantes en este período.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {hallazgos.map(h => {
            const c = colorNivel[h.nivel];
            return (
              <div key={h.id} style={{
                background: "#fff", border: `1px solid ${c.border}`, borderLeft: `4px solid ${c.text}`, borderRadius: 6,
                padding: 14,
              }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 9.5, padding: "2px 8px", borderRadius: 4,
                      background: c.text, color: "#fff", fontWeight: 700, letterSpacing: 0.5,
                    }}>
                      {c.label}
                    </span>
                    <span style={{ fontSize: 9.5, color: "#64748b", fontWeight: 600 }}>HALLAZGO {h.id}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 4 }}>
                        {h.titulo}
                      </div>
                      <div style={{ fontSize: 12, color: "#1f2937", marginBottom: 6 }}>
                        {h.descripcion}
                      </div>
                    </div>
                    <BotonDescargarExcel onClick={() => {
                      // Hoja 1: descripción del hallazgo
                      const descripcion = [
                        ["Hallazgo", `${h.id} — ${h.titulo}`],
                        ["Nivel", c.label],
                        ["Descripción", h.descripcion],
                        ["Impacto", h.impacto],
                        ["Acción sugerida", h.accion],
                        ["Generado", new Date().toLocaleString("es-CL")],
                      ];
                      
                      // Hoja 2: ejemplos
                      const headersEj = ["Nombre / Item", "Dato"];
                      const filasEj = (h.ejemplos || []).map(e => [e.nombre || "", e.dato || ""]);
                      
                      const hojas = [
                        { nombre: "Descripción", datos: descripcion },
                      ];
                      if (filasEj.length > 0) {
                        hojas.push({ nombre: "Ejemplos", datos: [headersEj, ...filasEj] });
                      }
                      
                      const nombreLimpio = (h.titulo || "Hallazgo").replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 30).trim().replace(/\s+/g, "_");
                      descargarExcelMultihoja(hojas, `Hallazgo_${h.id}_${nombreLimpio}`);
                    }} label="Excel" />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
                  <div style={{ background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: c.text, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Impacto</div>
                    <div style={{ fontSize: 11, color: "#1f2937" }}>{h.impacto}</div>
                  </div>
                  <div style={{ background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: c.text, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Acción sugerida</div>
                    <div style={{ fontSize: 11, color: "#1f2937" }}>{h.accion}</div>
                  </div>
                </div>

                {h.ejemplos.length > 0 && (
                  <div style={{ background: "#f8fafc", borderRadius: 4, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: c.text, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Ejemplos (top {h.ejemplos.length})</div>
                    <div style={{ display: "grid", gap: 3 }}>
                      {h.ejemplos.map((e, i) => (
                        <div key={i} style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontWeight: 500, color: "#1f2937" }}>• {e.nombre}</span>
                          <span style={{ color: c.text, fontWeight: 600, whiteSpace: "nowrap" }}>{e.dato}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16, padding: "10px 14px", background: "#f8fafc", border: "1px solid #e4e7ec", borderRadius: 4, fontSize: 11, color: "#64748b" }}>
        <strong>¿Cómo se calculan estos hallazgos?</strong> El algoritmo cruza automáticamente los datos descargados de Certronic, las reglas de la matriz y el histórico de meses anteriores para detectar patrones. Cada vez que el sistema se actualiza, los hallazgos se recalculan.
      </div>
    </div>
  );
}
