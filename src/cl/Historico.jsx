import { useEffect, useMemo, useState } from "react";
import { sb } from "../../shared";

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 DASHBOARD HISTÓRICO — Sprint 3 Fase B.2
// 4 sub-tabs: Resumen | Heatmap | Top Deudores | Desaparecidos
// Lee de las vistas: vw_historico_evolucion_contratista,
// vw_deudores_historicos_actuales_resumen, vw_historico_desaparecidos,
// vw_historico_morosos_arrastre
// ═══════════════════════════════════════════════════════════════════════════
export function DashboardHistorico({ operacionAMandante }) {
  const [subtab, setSubtab] = useState("resumen");
  const [loading, setLoading] = useState(true);
  const [evolucion, setEvolucion] = useState([]);          // por contratista × período
  const [resumenGeneral, setResumenGeneral] = useState(null); // KPIs globales
  const [deudoresResumen, setDeudoresResumen] = useState([]); // top deudores activos
  const [desaparecidos, setDesaparecidos] = useState([]);
  const [arrastrados, setArrastrados] = useState([]);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1) Evolución por contratista (todos los registros) - paginado
        let allEvol = [];
        let from = 0;
        const limite = 1000;
        while (true) {
          const { data, error } = await sb.from("vw_historico_evolucion_contratista")
            .select("contratista_norm, contratista, periodo, total_docs, docs_cumplidos, docs_pendientes, pct_cumplimiento, delta_pct_vs_mes_anterior, identificadores_unicos")
            .order("contratista_norm", { ascending: true })
            .order("periodo", { ascending: true })
            .range(from, from + limite - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          allEvol = allEvol.concat(data);
          if (data.length < limite) break;
          from += limite;
        }
        setEvolucion(allEvol);

        // 2) Resumen general del histórico
        const periodosUnicos = [...new Set(allEvol.map(e => e.periodo))].sort();
        const ultPeriodo = periodosUnicos[periodosUnicos.length - 1];
        const primPeriodo = periodosUnicos[0];

        // KPIs globales: total deudas y personas (de la vista resumen)
        const { count: totalDeudas } = await sb.from("vw_deudores_historicos_actuales")
          .select("*", { count: "exact", head: true });
        const { count: totalPersonas } = await sb.from("vw_deudores_historicos_actuales_resumen")
          .select("*", { count: "exact", head: true });

        // % cumplimiento promedio por período (de evolucion)
        const promedioPorPeriodo = {};
        for (const p of periodosUnicos) {
          const delPeriodo = allEvol.filter(e => e.periodo === p);
          const sumDocs = delPeriodo.reduce((a, b) => a + (b.total_docs || 0), 0);
          const sumCumple = delPeriodo.reduce((a, b) => a + (b.docs_cumplidos || 0), 0);
          promedioPorPeriodo[p] = sumDocs > 0 ? (sumCumple / sumDocs * 100) : 0;
        }

        setResumenGeneral({
          totalPeriodos: periodosUnicos.length,
          primerPeriodo: primPeriodo,
          ultimoPeriodo: ultPeriodo,
          totalDeudas: totalDeudas || 0,
          totalPersonas: totalPersonas || 0,
          contratistasUnicos: new Set(allEvol.map(e => e.contratista_norm)).size,
          promedioPorPeriodo,
        });

        // 3) Top deudores (resumen)
        let allDeudores = [];
        from = 0;
        while (true) {
          const { data } = await sb.from("vw_deudores_historicos_actuales_resumen")
            .select("identificador, rut, contratista, detalle, total_deudas, meses_con_deuda, docs_distintos_adeudados, deuda_mas_antigua, deuda_mas_reciente")
            .order("total_deudas", { ascending: false })
            .range(from, from + limite - 1);
          if (!data || data.length === 0) break;
          allDeudores = allDeudores.concat(data);
          if (data.length < limite) break;
          from += limite;
        }
        setDeudoresResumen(allDeudores);

        // 4) Desaparecidos
        const { data: desapData } = await sb.from("vw_historico_desaparecidos")
          .select("identificador, rut, contratista, detalle, entidad, ultimo_periodo_visto, docs_totales_ultimo_mes, docs_pendientes_al_irse, meses_presentes")
          .order("docs_pendientes_al_irse", { ascending: false })
          .limit(500);
        setDesaparecidos(desapData || []);

        // 5) Morosos arrastrados (los que llevan más meses)
        const { data: arrData } = await sb.from("vw_historico_morosos_arrastre")
          .select("contratista, detalle, documento, pendiente_desde, pendiente_hasta, meses_pendiente, sigue_pendiente_en_ultimo")
          .order("meses_pendiente", { ascending: false })
          .limit(500);
        setArrastrados(arrData || []);

      } catch (e) {
        console.error("[Historico] Error:", e);
      }
      setLoading(false);
    })();
  }, []);

  // Construir matriz para heatmap: contratista × período → pct
  const heatmapData = useMemo(() => {
    if (!evolucion.length) return { contratistas: [], periodos: [], celdas: {} };
    const periodos = [...new Set(evolucion.map(e => e.periodo))].sort();
    const contratistasMap = new Map();
    for (const e of evolucion) {
      const key = e.contratista_norm;
      if (!contratistasMap.has(key)) {
        contratistasMap.set(key, {
          contratista_norm: key,
          contratista: e.contratista,
          promedio: 0,
          totalDocs: 0,
          totalCumple: 0,
        });
      }
      const c = contratistasMap.get(key);
      c.totalDocs += (e.total_docs || 0);
      c.totalCumple += (e.docs_cumplidos || 0);
    }
    // Calcular promedio
    for (const [k, c] of contratistasMap.entries()) {
      c.promedio = c.totalDocs > 0 ? (c.totalCumple / c.totalDocs * 100) : 0;
    }
    // Celdas: { "contratista_norm|periodo": { pct, total, pendientes, delta } }
    const celdas = {};
    for (const e of evolucion) {
      celdas[`${e.contratista_norm}|${e.periodo}`] = {
        pct: parseFloat(e.pct_cumplimiento) || 0,
        total: e.total_docs || 0,
        pendientes: e.docs_pendientes || 0,
        delta: e.delta_pct_vs_mes_anterior != null ? parseFloat(e.delta_pct_vs_mes_anterior) : null,
      };
    }
    const contratistas = [...contratistasMap.values()].sort((a, b) => a.promedio - b.promedio);
    return { contratistas, periodos, celdas };
  }, [evolucion]);

  // Filtrar heatmap por búsqueda
  const heatmapFiltrado = useMemo(() => {
    if (!busqueda) return heatmapData.contratistas;
    const q = busqueda.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return heatmapData.contratistas.filter(c =>
      (c.contratista || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").includes(q)
    );
  }, [heatmapData.contratistas, busqueda]);

  // Top movers (mayor delta + y -) en el último período disponible
  const topMovers = useMemo(() => {
    if (!evolucion.length) return { mejoraron: [], empeoraron: [] };
    const periodos = [...new Set(evolucion.map(e => e.periodo))].sort();
    const ultimo = periodos[periodos.length - 1];
    const conDelta = evolucion.filter(e => e.periodo === ultimo && e.delta_pct_vs_mes_anterior != null);
    const mejoraron = [...conDelta].sort((a, b) =>
      parseFloat(b.delta_pct_vs_mes_anterior) - parseFloat(a.delta_pct_vs_mes_anterior)
    ).slice(0, 10);
    const empeoraron = [...conDelta].sort((a, b) =>
      parseFloat(a.delta_pct_vs_mes_anterior) - parseFloat(b.delta_pct_vs_mes_anterior)
    ).slice(0, 10);
    return { mejoraron, empeoraron, ultimo };
  }, [evolucion]);

  const fmtPeriodo = (p) => p ? p.substring(0, 7) : "—";

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Cargando datos históricos...</div>;
  }

  const subTabs = [
    { id: "resumen", label: "📈 Resumen", desc: "KPIs globales + tendencia" },
    { id: "heatmap", label: "🔥 Heatmap", desc: "Contratistas × meses" },
    { id: "deudores", label: "🚨 Top Deudores", desc: "Activos con deudas históricas" },
    { id: "desaparecidos", label: "👻 Desaparecidos", desc: "Pasaron y ya no están" },
  ];

  return (
    <div style={{ padding: 0 }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e4e7ec", padding: "12px 16px", marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
          📊 Análisis Histórico
        </div>
        <div style={{ display: "flex", gap: 0, flexWrap: "wrap", borderBottom: "1px solid #e4e7ec" }}>
          {subTabs.map(t => (
            <button key={t.id} onClick={() => setSubtab(t.id)}
              style={{
                background: "transparent", border: "none", padding: "8px 14px",
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                color: subtab === t.id ? "#002E5D" : "#64748b",
                borderBottom: subtab === t.id ? "2px solid #002E5D" : "2px solid transparent",
                marginBottom: -1,
              }}>
              <div>{t.label}</div>
              <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 400, marginTop: 1 }}>{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "0 16px 20px" }}>

        {/* ───── SUB-TAB: RESUMEN ───── */}
        {subtab === "resumen" && resumenGeneral && (
          <div>
            {/* Bloque info */}
            <div style={{ background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 11, color: "#312e81" }}>
              <strong>Histórico de {resumenGeneral.primerPeriodo?.substring(0,7)} a {resumenGeneral.ultimoPeriodo?.substring(0,7)}</strong> ·
              Capturado el 2026-05-08 · {resumenGeneral.totalPeriodos} períodos cargados
            </div>

            {/* KPIs grandes */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Períodos cargados</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#002E5D", marginTop: 4 }}>{resumenGeneral.totalPeriodos}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Contratistas en histórico</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#002E5D", marginTop: 4 }}>{resumenGeneral.contratistasUnicos}</div>
              </div>
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#9a3412", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Deudas históricas activas</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#9a3412", marginTop: 4 }}>{resumenGeneral.totalDeudas.toLocaleString("es-CL")}</div>
              </div>
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#9a3412", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Personas con deuda</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#9a3412", marginTop: 4 }}>{resumenGeneral.totalPersonas.toLocaleString("es-CL")}</div>
              </div>
              <div style={{ background: "#f3e8ff", border: "1px solid #d8b4fe", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#6b21a8", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Desaparecidos en histórico</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#6b21a8", marginTop: 4 }}>{desaparecidos.length}</div>
              </div>
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, color: "#991b1b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Docs crónicamente pendientes</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#991b1b", marginTop: 4 }}>{arrastrados.filter(a => a.meses_pendiente >= 3).length}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>≥ 3 meses sin resolver</div>
              </div>
            </div>

            {/* Gráfico tendencia global */}
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>
                Evolución del cumplimiento global
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 140, padding: "0 20px" }}>
                {Object.entries(resumenGeneral.promedioPorPeriodo).map(([periodo, pct], i, arr) => {
                  const altura = Math.max(8, (pct / 100) * 120);
                  const color = pct >= 85 ? "#16a34a" : pct >= 70 ? "#f59e0b" : "#dc2626";
                  const prev = i > 0 ? arr[i-1][1] : null;
                  const delta = prev != null ? pct - prev : null;
                  return (
                    <div key={periodo} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color }}>{pct.toFixed(1)}%</div>
                      {delta != null && (
                        <div style={{ fontSize: 10, fontWeight: 600, color: delta > 0 ? "#16a34a" : delta < 0 ? "#dc2626" : "#94a3b8" }}>
                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta).toFixed(1)}
                        </div>
                      )}
                      <div style={{ width: "70%", height: altura, background: color, borderRadius: "4px 4px 0 0" }} />
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{periodo.substring(0,7)}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top mejoraron / empeoraron */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 8 }}>
                  ▲ Top 10 mejoraron ({topMovers.ultimo?.substring(0,7) || "—"})
                </div>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>%</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMovers.mejoraron.map((m, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "3px 6px", fontWeight: 500 }}>{(m.contratista || "—").substring(0, 38)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right" }}>{parseFloat(m.pct_cumplimiento).toFixed(1)}%</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", color: "#16a34a", fontWeight: 700 }}>
                          +{parseFloat(m.delta_pct_vs_mes_anterior).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 8 }}>
                  ▼ Top 10 empeoraron ({topMovers.ultimo?.substring(0,7) || "—"})
                </div>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>%</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", color: "#64748b", fontSize: 10, fontWeight: 600 }}>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMovers.empeoraron.map((m, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "3px 6px", fontWeight: 500 }}>{(m.contratista || "—").substring(0, 38)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right" }}>{parseFloat(m.pct_cumplimiento).toFixed(1)}%</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", color: "#dc2626", fontWeight: 700 }}>
                          {parseFloat(m.delta_pct_vs_mes_anterior).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ───── SUB-TAB: HEATMAP ───── */}
        {subtab === "heatmap" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input type="text" placeholder="Buscar contratista..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ flex: 1, minWidth: 240, padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 4 }} />
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {heatmapFiltrado.length} contratista(s) · ordenados por peor cumplimiento promedio
              </div>
            </div>
            {/* Leyenda */}
            <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 11, color: "#64748b" }}>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#16a34a", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />≥85%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#84cc16", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />70-85%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#f59e0b", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />50-70%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#dc2626", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />&lt;50%</span>
              <span><span style={{ display: "inline-block", width: 14, height: 14, background: "#f1f5f9", borderRadius: 2, marginRight: 4, verticalAlign: "middle", border: "1px solid #cbd5e1" }} />Sin datos</span>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: 600 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#002E5D", color: "#fff", zIndex: 2 }}>
                  <tr>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600 }}>Contratista</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Prom.</th>
                    {heatmapData.periodos.map(p => (
                      <th key={p} style={{ padding: "8px 6px", textAlign: "center", fontSize: 10, fontWeight: 600, minWidth: 80 }}>
                        {p.substring(0, 7)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmapFiltrado.slice(0, 250).map((c, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "4px 10px", fontWeight: 500, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={c.contratista}>
                        {c.contratista}
                      </td>
                      <td style={{ padding: "4px 10px", textAlign: "right", fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                        {c.promedio.toFixed(1)}%
                      </td>
                      {heatmapData.periodos.map(p => {
                        const celda = heatmapData.celdas[`${c.contratista_norm}|${p}`];
                        if (!celda) {
                          return (
                            <td key={p} style={{ padding: 0, textAlign: "center", background: "#f1f5f9", color: "#cbd5e1", fontSize: 10 }}>
                              —
                            </td>
                          );
                        }
                        const color = celda.pct >= 85 ? "#16a34a" : celda.pct >= 70 ? "#84cc16" : celda.pct >= 50 ? "#f59e0b" : "#dc2626";
                        return (
                          <td key={p}
                            title={`${p.substring(0,7)} — ${celda.pct.toFixed(1)}% — ${celda.total} docs · ${celda.pendientes} pendientes${celda.delta != null ? ` · Δ ${celda.delta > 0 ? "+" : ""}${celda.delta.toFixed(1)}` : ""}`}
                            style={{
                              padding: "6px 4px", textAlign: "center",
                              background: color, color: "#fff", fontSize: 10, fontWeight: 700, cursor: "help",
                            }}>
                            {celda.pct.toFixed(0)}%
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {heatmapFiltrado.length > 250 && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, textAlign: "center" }}>
                Mostrando 250 de {heatmapFiltrado.length}. Usá el buscador para filtrar.
              </div>
            )}
          </div>
        )}

        {/* ───── SUB-TAB: TOP DEUDORES ───── */}
        {subtab === "deudores" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input type="text" placeholder="Buscar persona o contratista..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ flex: 1, minWidth: 240, padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 4 }} />
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {deudoresResumen.length} personas activas con deudas históricas
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: 640 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#002E5D", color: "#fff", zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Persona/Recurso</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Total deudas</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Meses</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Docs distintos</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Más antigua</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Más reciente</th>
                  </tr>
                </thead>
                <tbody>
                  {deudoresResumen
                    .filter(d => {
                      if (!busqueda) return true;
                      const q = busqueda.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const c = (d.contratista || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const dt = (d.detalle || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      return c.includes(q) || dt.includes(q);
                    })
                    .slice(0, 300)
                    .map((d, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 10px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.contratista}>
                          {(d.contratista || "—").substring(0, 35)}
                        </td>
                        <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right" }}>
                          <span style={{
                            background: d.total_deudas >= 30 ? "#fee2e2" : d.total_deudas >= 10 ? "#fef3c7" : "#f1f5f9",
                            color: d.total_deudas >= 30 ? "#991b1b" : d.total_deudas >= 10 ? "#92400e" : "#475569",
                            padding: "2px 8px", borderRadius: 10, fontWeight: 700, fontSize: 10,
                          }}>
                            {d.total_deudas}
                          </span>
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.meses_con_deuda}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.docs_distintos_adeudados || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, fontFamily: "monospace", color: "#64748b" }}>
                          {d.deuda_mas_antigua ? d.deuda_mas_antigua.substring(0,7) : "—"}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "center", fontSize: 10, fontFamily: "monospace", color: "#64748b" }}>
                          {d.deuda_mas_reciente ? d.deuda_mas_reciente.substring(0,7) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ───── SUB-TAB: DESAPARECIDOS ───── */}
        {subtab === "desaparecidos" && (
          <div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <input type="text" placeholder="Buscar persona o contratista..." value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ flex: 1, minWidth: 240, padding: "6px 10px", fontSize: 12, border: "1px solid #e4e7ec", borderRadius: 4 }} />
              <div style={{ fontSize: 11, color: "#64748b" }}>
                {desaparecidos.length} empleados/vehículos/contratistas que pasaron por el sistema y ya no están
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: 640 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, background: "#6b21a8", color: "#fff", zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Contratista</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontSize: 10, fontWeight: 600 }}>Quién</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Tipo</th>
                    <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, fontWeight: 600 }}>Último mes visto</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Meses presente</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Total docs</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontSize: 10, fontWeight: 600 }}>Pendientes al irse</th>
                  </tr>
                </thead>
                <tbody>
                  {desaparecidos
                    .filter(d => {
                      if (!busqueda) return true;
                      const q = busqueda.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const c = (d.contratista || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      const dt = (d.detalle || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
                      return c.includes(q) || dt.includes(q);
                    })
                    .slice(0, 400)
                    .map((d, i) => (
                      <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "5px 10px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.contratista}>
                          {(d.contratista || "—").substring(0, 35)}
                        </td>
                        <td style={{ padding: "5px 10px", fontWeight: 500 }}>{d.detalle || "—"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center" }}>
                          <span style={{
                            fontSize: 9, padding: "1px 6px", borderRadius: 3, fontWeight: 600, textTransform: "uppercase",
                            background: d.entidad === "empleado" ? "#dbeafe" : d.entidad === "vehiculo" ? "#fef3c7" : "#f3e8ff",
                            color: d.entidad === "empleado" ? "#1e40af" : d.entidad === "vehiculo" ? "#92400e" : "#6b21a8",
                          }}>{d.entidad || "—"}</span>
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "center", fontFamily: "monospace", fontSize: 10, color: "#64748b" }}>
                          {d.ultimo_periodo_visto ? d.ultimo_periodo_visto.substring(0,7) : "—"}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.meses_presentes}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", color: "#475569" }}>{d.docs_totales_ultimo_mes}</td>
                        <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 700, color: d.docs_pendientes_al_irse > 0 ? "#991b1b" : "#94a3b8" }}>
                          {d.docs_pendientes_al_irse}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
