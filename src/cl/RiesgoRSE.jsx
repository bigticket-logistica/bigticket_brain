import { Fragment, useEffect, useMemo, useState } from "react";
import { descargarExcelMultihoja, sb } from "../../shared";
import { BotonDescargarExcel, traerTodo } from "./comun";

// ═══════════════════════════════════════════════════════════════
// 🆕 DASHBOARD RIESGO RSE — Score de responsabilidad subsidiaria
// ═══════════════════════════════════════════════════════════════
export function DashboardRiesgoRSE() {
  const [config, setConfig] = useState(null);
  const [datos, setDatos] = useState({ docsContratista: [], detalles: [], cumplMensual: [], inhabilitados: new Set() });
  const [loading, setLoading] = useState(true);
  const [snapshotUsado, setSnapshotUsado] = useState(null);
  const [editandoPesos, setEditandoPesos] = useState(false);
  const [pesosTemp, setPesosTemp] = useState(null);
  const [motivoEdicion, setMotivoEdicion] = useState("");
  const [guardando, setGuardando] = useState(false);
  
  const [busqueda, setBusqueda] = useState("");
  const [filtroNivel, setFiltroNivel] = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("todos"); // todos | activo | inhabilitado
  const [expandidoContr, setExpandidoContr] = useState(null);

  useEffect(() => { cargarTodo(); }, []);

  const cargarTodo = async () => {
    setLoading(true);
    try {
      // 1. Config activa
      const { data: cfg } = await sb.from("certronic_rse_config")
        .select("*").eq("activo", true).limit(1);
      const configActiva = (cfg && cfg[0]) || {
        peso_docs_iniciales: 35, peso_cumpl_mensual: 25, peso_pendientes: 15,
        peso_atraso_f30: 10, peso_inhabilitado: 8, peso_recencia: 7,
        umbral_bajo: 30, umbral_medio: 60, umbral_alto: 80,
      };
      setConfig(configActiva);
      setPesosTemp(configActiva);

      // 2. Snapshot más reciente de docs
      const { data: snap } = await sb.from("certronic_empleados_docs")
        .select("fecha_snapshot")
        .order("fecha_snapshot", { ascending: false }).limit(1);
      const fechaSnap = snap && snap[0] ? snap[0].fecha_snapshot : null;
      setSnapshotUsado(fechaSnap);

      if (!fechaSnap) { setDatos({ docsContratista: [], detalles: [], cumplMensual: [], inhabilitados: new Set() }); setLoading(false); return; }

      // 3. Cargar DOC_CONTRATISTA + MIS_PENDIENTES (paginado)
      let docsContr = [];
      let from = 0;
      while (true) {
        const { data, error } = await sb.from("certronic_empleados_docs")
          .select("token_certronic, origen, documento, cumple, vencimiento, impide_pago")
          .eq("fecha_snapshot", fechaSnap)
          .in("origen", ["DOC_CONTRATISTA", "MIS_PENDIENTES"])
          .range(from, from + 999);
        if (error || !data || data.length === 0) break;
        docsContr = docsContr.concat(data);
        if (data.length < 1000) break;
        from += 1000;
      }

      // 4. Mapping token → contratista
      const detalles = await traerTodo(() => sb.from("certronic_empleados_detalle")
        .select("token_certronic, contratista, planta")
        .eq("fecha_snapshot", fechaSnap)
        .order("id"));

      // 5. Cumplimiento mensual de los últimos 6 períodos (paginado).
      // Antes se pedía todo el histórico sin paginar: Supabase lo cortaba en
      // 1.000 filas y en la práctica solo se veían 2 a 3 meses.
      const { data: pers } = await sb.from("vw_certificacion_periodos")
        .select("anio, mes")
        .order("anio", { ascending: false }).order("mes", { ascending: false });
      const ultimos6 = [...new Set((pers || []).map(p => p.anio * 100 + p.mes))].slice(0, 6);
      let cumplMen = [];
      if (ultimos6.length) {
        const minAnio = Math.floor(Math.min(...ultimos6) / 100);
        const filasMen = await traerTodo(() => sb.from("certronic_certificacion_mensual")
          .select("transporte, anio, mes, pct_avance, pct_retencion, estado_final, recurso_inhabilitado")
          .gte("anio", minAnio)
          .order("id"));
        const set6 = new Set(ultimos6);
        cumplMen = filasMen.filter(c => set6.has(c.anio * 100 + c.mes));
      }

      // 6. Inhabilitados: estuvo inhabilitado en alguno de los últimos 6 períodos
      const inhabilitadosSet = new Set();
      for (const c of cumplMen) {
        if (c.recurso_inhabilitado) inhabilitadosSet.add(c.transporte);
      }

      setDatos({
        docsContratista: docsContr,
        detalles,
        cumplMensual: cumplMen,
        inhabilitados: inhabilitadosSet,
      });
    } catch (e) {
      console.error("[RSE] Error cargando:", e);
    }
    setLoading(false);
  };

  // Calcular score por contratista (en base a config y datos)
  const contratistasConScore = useMemo(() => {
    if (!config) return [];
    // Si no hay datos de docs ni de cumpl mensual, no podemos calcular nada
    if (!datos.docsContratista.length && !datos.cumplMensual.length) return [];

    // Mapping token → contratista (de empleados detalle)
    const tokenAContr = new Map();
    const tokenAPlanta = new Map();
    for (const d of datos.detalles) {
      if (d.contratista) tokenAContr.set(d.token_certronic, d.contratista);
      if (d.planta) tokenAPlanta.set(d.token_certronic, d.planta);
    }

    // 🆕 Inicializar porContratista con TODOS los contratistas conocidos
    // (los que están en certificación mensual, aunque no tengan empleados)
    const porContratista = new Map();
    for (const c of datos.cumplMensual) {
      if (!c.transporte) continue;
      if (!porContratista.has(c.transporte)) {
        porContratista.set(c.transporte, {
          contratista: c.transporte,
          planta: null,
          docsIniciales: new Map(),
          pendientes: [],
          tieneEmpleadosScrapeados: false,
        });
      }
    }

    // Agregar los datos de docs cuando los haya
    for (const d of datos.docsContratista) {
      const c = tokenAContr.get(d.token_certronic);
      if (!c) continue;
      if (!porContratista.has(c)) {
        // Edge case: empleado existe pero contratista no figura en certif mensual
        porContratista.set(c, {
          contratista: c,
          planta: tokenAPlanta.get(d.token_certronic) || null,
          docsIniciales: new Map(),
          pendientes: [],
          tieneEmpleadosScrapeados: true,
        });
      }
      const grupo = porContratista.get(c);
      grupo.tieneEmpleadosScrapeados = true;
      if (!grupo.planta) grupo.planta = tokenAPlanta.get(d.token_certronic) || null;
      
      if (d.origen === "DOC_CONTRATISTA") {
        if (!grupo.docsIniciales.has(d.documento)) {
          grupo.docsIniciales.set(d.documento, { cumple: d.cumple, vencimiento: d.vencimiento });
        }
      } else if (d.origen === "MIS_PENDIENTES") {
        grupo.pendientes.push(d);
      }
    }

    // Mapping cumplimiento mensual
    const cumplPorContr = new Map();
    for (const c of datos.cumplMensual) {
      if (!cumplPorContr.has(c.transporte)) cumplPorContr.set(c.transporte, []);
      cumplPorContr.get(c.transporte).push(c);
    }

    // Calcular scores
    const lista = [];
    const totalPesos = config.peso_docs_iniciales + config.peso_cumpl_mensual + config.peso_pendientes 
                     + config.peso_atraso_f30 + config.peso_inhabilitado + config.peso_recencia;
    const factor = totalPesos > 0 ? 100 / totalPesos : 1;

    for (const [contratista, grupo] of porContratista.entries()) {
      // Determinar si el contratista tiene datos para calcular score
      const cumplMen = cumplPorContr.get(contratista) || [];
      
      // 🆕 Agrupar por (anio, mes) — un contratista puede tener varias filas por mes
      // (una por categoría: PC, RyC, SUB). Promediamos el pct_avance del mes.
      const porMes = new Map();
      for (const c of cumplMen) {
        const key = `${c.anio}-${String(c.mes).padStart(2, '0')}`;
        if (!porMes.has(key)) {
          porMes.set(key, { anio: c.anio, mes: c.mes, pcts: [] });
        }
        if (c.pct_avance != null) porMes.get(key).pcts.push(c.pct_avance);
      }
      const cumplMenAgrupado = Array.from(porMes.values())
        .map(g => ({
          anio: g.anio,
          mes: g.mes,
          pct_avance: g.pcts.length > 0 ? g.pcts.reduce((s, x) => s + x, 0) / g.pcts.length : 0,
        }))
        .sort((a, b) => (b.anio - a.anio) || (b.mes - a.mes));  // más reciente primero
      
      const tieneDocsIniciales = grupo.docsIniciales.size > 0;
      const tieneCumplMensual = cumplMenAgrupado.length > 0;
      const sinDatos = !tieneDocsIniciales && !tieneCumplMensual;

      // Factor 1: % docs iniciales (a más cumplimiento, menor riesgo)
      const totalDocs = grupo.docsIniciales.size;
      const cumplenDocs = Array.from(grupo.docsIniciales.values()).filter(v => v.cumple === true).length;
      const pctIniciales = totalDocs > 0 ? cumplenDocs / totalDocs : 0;
      const f1 = tieneDocsIniciales ? (1 - pctIniciales) * config.peso_docs_iniciales : 0;

      // Factor 2: cumplimiento mensual promedio últimos 6 meses
      const ultimos6 = cumplMenAgrupado.slice(0, 6);
      const promPctAvance = ultimos6.length > 0
        ? ultimos6.reduce((s, c) => s + (c.pct_avance || 0), 0) / ultimos6.length / 100
        : 0;
      const f2 = tieneCumplMensual ? (1 - promPctAvance) * config.peso_cumpl_mensual : 0;

      // Factor 3: cantidad de pendientes acumulados (max 10 = peso completo)
      const f3 = Math.min(1, grupo.pendientes.length / 10) * config.peso_pendientes;

      // Factor 4: atraso F30 (basado en pendientes que mencionan F30)
      const f30Pendientes = grupo.pendientes.filter(p => 
        (p.documento || "").includes("F30") || (p.documento || "").toLowerCase().includes("cotiz")
      ).reduce((s, p) => s + (p.periodos_pendientes || 1), 0);
      const f4 = Math.min(1, f30Pendientes / 6) * config.peso_atraso_f30;

      // Factor 5: estuvo inhabilitado en alguno de los últimos 6 períodos
      const estuvoInhabilitado = datos.inhabilitados.has(contratista);
      const f5 = (estuvoInhabilitado ? 1 : 0) * config.peso_inhabilitado;

      // Factor 6: recencia del último doc OK (si hay muchos docs vencidos hace tiempo, suma riesgo)
      const hoy = new Date();
      const docsVencidos = Array.from(grupo.docsIniciales.values())
        .filter(v => v.vencimiento && new Date(v.vencimiento) < hoy).length;
      const f6 = totalDocs > 0 ? (docsVencidos / totalDocs) * config.peso_recencia : 0;

      // Score final 0-100
      const sumaFactores = f1 + f2 + f3 + f4 + f5 + f6;
      const score = Math.min(100, Math.round(sumaFactores * factor));

      // Determinar nivel
      let nivel, colorNivel, bgNivel;
      if (sinDatos) { nivel = "SIN DATOS"; colorNivel = "#64748b"; bgNivel = "#f1f5f9"; }
      else if (score < config.umbral_bajo) { nivel = "BAJO"; colorNivel = "#16a34a"; bgNivel = "#dcfce7"; }
      else if (score < config.umbral_medio) { nivel = "MEDIO"; colorNivel = "#f59e0b"; bgNivel = "#fef3c7"; }
      else if (score < config.umbral_alto) { nivel = "ALTO"; colorNivel = "#dc2626"; bgNivel = "#fee2e2"; }
      else { nivel = "CRÍTICO"; colorNivel = "#7f1d1d"; bgNivel = "#fecaca"; }

      // Empleados activos del contratista (cuenta de los que tienen ficha)
      const empleadosActivos = datos.detalles.filter(d => d.contratista === contratista).length;

      lista.push({
        contratista,
        planta: grupo.planta,
        score: sinDatos ? null : score,
        nivel, colorNivel, bgNivel,
        sinDatos,
        tieneDocsIniciales,
        tieneCumplMensual,
        // Detalle de factores
        factores: {
          docsIniciales: { val: pctIniciales, peso: config.peso_docs_iniciales, contrib: Math.round(f1 * factor), label: "Docs iniciales" },
          cumplMensual: { val: promPctAvance, peso: config.peso_cumpl_mensual, contrib: Math.round(f2 * factor), label: "Cumplim. mensual 6m" },
          pendientes: { val: grupo.pendientes.length, peso: config.peso_pendientes, contrib: Math.round(f3 * factor), label: "Pendientes acumulados" },
          atrasoF30: { val: f30Pendientes, peso: config.peso_atraso_f30, contrib: Math.round(f4 * factor), label: "Atraso F30/cotizaciones" },
          inhabilitado: { val: estuvoInhabilitado, peso: config.peso_inhabilitado, contrib: Math.round(f5 * factor), label: "Inhabilitado histórico" },
          recencia: { val: docsVencidos, peso: config.peso_recencia, contrib: Math.round(f6 * factor), label: "Docs vencidos" },
        },
        empleadosActivos,
        estaInhabilitado: estuvoInhabilitado,
        pctIniciales: Math.round(pctIniciales * 100),
        pctMensual: Math.round(promPctAvance * 100),
        pendientes: grupo.pendientes.length,
        docsCriticosFaltantes: Array.from(grupo.docsIniciales.entries())
          .filter(([_, v]) => v.cumple === false)
          .map(([nombre]) => nombre),
        cumplMen6m: ultimos6,
      });
    }

    // Ordenar: con score primero (de mayor a menor), sin datos al final
    lista.sort((a, b) => {
      if (a.sinDatos && !b.sinDatos) return 1;
      if (!a.sinDatos && b.sinDatos) return -1;
      if (a.sinDatos && b.sinDatos) return a.contratista.localeCompare(b.contratista);
      return (b.score || 0) - (a.score || 0);
    });
    return lista;
  }, [datos, config]);

  // Filtros
  const filtrados = useMemo(() => {
    let r = contratistasConScore;
    if (busqueda) {
      const q = busqueda.toLowerCase();
      r = r.filter(c => c.contratista.toLowerCase().includes(q));
    }
    if (filtroNivel !== "todos") {
      r = r.filter(c => c.nivel === filtroNivel);
    }
    if (filtroEstado === "activo") {
      r = r.filter(c => !c.estaInhabilitado);
    } else if (filtroEstado === "inhabilitado") {
      r = r.filter(c => c.estaInhabilitado);
    }
    return r;
  }, [contratistasConScore, busqueda, filtroNivel, filtroEstado]);

  const stats = useMemo(() => ({
    total: contratistasConScore.length,
    bajo: contratistasConScore.filter(c => c.nivel === "BAJO").length,
    medio: contratistasConScore.filter(c => c.nivel === "MEDIO").length,
    alto: contratistasConScore.filter(c => c.nivel === "ALTO").length,
    critico: contratistasConScore.filter(c => c.nivel === "CRÍTICO").length,
    sinDatos: contratistasConScore.filter(c => c.sinDatos).length,
    activos: contratistasConScore.filter(c => !c.estaInhabilitado).length,
    inhab: contratistasConScore.filter(c => c.estaInhabilitado).length,
  }), [contratistasConScore]);

  // Validación de pesos editados
  const sumaPesos = pesosTemp ? (
    pesosTemp.peso_docs_iniciales + pesosTemp.peso_cumpl_mensual + pesosTemp.peso_pendientes +
    pesosTemp.peso_atraso_f30 + pesosTemp.peso_inhabilitado + pesosTemp.peso_recencia
  ) : 100;

  const guardarPesos = async () => {
    if (sumaPesos !== 100) { alert(`Los pesos deben sumar 100. Actualmente suman ${sumaPesos}.`); return; }
    if (!motivoEdicion.trim()) { alert("Indicá un motivo del cambio (para auditoría)"); return; }
    setGuardando(true);
    try {
      // Desactivar config anterior
      await sb.from("certronic_rse_config").update({ activo: false }).eq("activo", true);
      // Insertar nueva
      const { error } = await sb.from("certronic_rse_config").insert({
        peso_docs_iniciales: pesosTemp.peso_docs_iniciales,
        peso_cumpl_mensual: pesosTemp.peso_cumpl_mensual,
        peso_pendientes: pesosTemp.peso_pendientes,
        peso_atraso_f30: pesosTemp.peso_atraso_f30,
        peso_inhabilitado: pesosTemp.peso_inhabilitado,
        peso_recencia: pesosTemp.peso_recencia,
        umbral_bajo: pesosTemp.umbral_bajo,
        umbral_medio: pesosTemp.umbral_medio,
        umbral_alto: pesosTemp.umbral_alto,
        motivo_cambio: motivoEdicion,
        editado_por: 'analista',
        activo: true,
      });
      if (error) { alert("Error guardando: " + error.message); setGuardando(false); return; }
      setConfig(pesosTemp);
      setEditandoPesos(false);
      setMotivoEdicion("");
    } catch (e) {
      alert("Error: " + e.message);
    }
    setGuardando(false);
  };

  if (loading) return <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Calculando scores de riesgo...</div>;
  if (!contratistasConScore.length) return (
    <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
      Sin datos para calcular riesgo. Esperá al próximo run del scraper.
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#002E5D" }}>
            🛡️ Riesgo RSE — Responsabilidad Subsidiaria
          </h2>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
            {contratistasConScore.length} contratistas evaluados · Snapshot: {snapshotUsado || "—"} · 
            Score 0-100 (mayor = más riesgo de generar pasivo legal)
          </div>
        </div>
        <button onClick={() => setEditandoPesos(!editandoPesos)} style={{
          padding: "7px 14px", background: editandoPesos ? "#dc2626" : "#002E5D", color: "#fff",
          border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
        }}>
          {editandoPesos ? "Cancelar" : "⚙ Ajustar pesos"}
        </button>
      </div>

      {/* Panel de edición de pesos */}
      {editandoPesos && pesosTemp && (
        <div style={{ background: "#f8fafc", border: "1px solid #002E5D", borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#002E5D", marginBottom: 10 }}>
            Pesos del algoritmo (deben sumar 100)
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
            {[
              { key: "peso_docs_iniciales", label: "Docs iniciales del contratista" },
              { key: "peso_cumpl_mensual", label: "Cumplimiento mensual 6m" },
              { key: "peso_pendientes", label: "Pendientes acumulados" },
              { key: "peso_atraso_f30", label: "Atraso F30/cotizaciones" },
              { key: "peso_inhabilitado", label: "Inhabilitado histórico" },
              { key: "peso_recencia", label: "Docs vencidos" },
            ].map(p => (
              <div key={p.key} style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{p.label}</div>
                <input type="number" min="0" max="100" value={pesosTemp[p.key]}
                  onChange={e => setPesosTemp({ ...pesosTemp, [p.key]: parseInt(e.target.value) || 0 })}
                  style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
                <span style={{ marginLeft: 6, fontSize: 11, color: "#94a3b8" }}>%</span>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 10, padding: "6px 10px", background: sumaPesos === 100 ? "#dcfce7" : "#fee2e2", borderRadius: 4, fontSize: 11, fontWeight: 700, color: sumaPesos === 100 ? "#166534" : "#991b1b" }}>
            Suma actual: {sumaPesos} {sumaPesos === 100 ? "✓" : `(falta ${100 - sumaPesos > 0 ? (100 - sumaPesos) : ""}, sobra ${100 - sumaPesos < 0 ? (sumaPesos - 100) : ""})`}
          </div>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#002E5D", marginBottom: 10, marginTop: 14 }}>
            Umbrales del semáforo
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 10 }}>
            <div style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
              <div style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, marginBottom: 3 }}>BAJO  ≤  X</div>
              <input type="number" min="1" max="99" value={pesosTemp.umbral_bajo}
                onChange={e => setPesosTemp({ ...pesosTemp, umbral_bajo: parseInt(e.target.value) || 0 })}
                style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
            </div>
            <div style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
              <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 3 }}>MEDIO  ≤  X</div>
              <input type="number" min="1" max="99" value={pesosTemp.umbral_medio}
                onChange={e => setPesosTemp({ ...pesosTemp, umbral_medio: parseInt(e.target.value) || 0 })}
                style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
            </div>
            <div style={{ background: "#fff", padding: 8, borderRadius: 6, border: "1px solid #e4e7ec" }}>
              <div style={{ fontSize: 10, color: "#dc2626", fontWeight: 700, marginBottom: 3 }}>ALTO  ≤  X · CRÍTICO  &gt;  X</div>
              <input type="number" min="1" max="99" value={pesosTemp.umbral_alto}
                onChange={e => setPesosTemp({ ...pesosTemp, umbral_alto: parseInt(e.target.value) || 0 })}
                style={{ width: 60, padding: "4px 6px", border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 12, fontWeight: 700 }} />
            </div>
          </div>
          <textarea
            placeholder="Motivo del cambio (queda en auditoría)..."
            value={motivoEdicion}
            onChange={e => setMotivoEdicion(e.target.value)}
            style={{ width: "100%", padding: 8, border: "1px solid #cbd5e1", borderRadius: 4, fontSize: 11, fontFamily: "Open Sans", resize: "vertical", minHeight: 50, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={guardarPesos} disabled={guardando || sumaPesos !== 100 || !motivoEdicion.trim()} style={{
              padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6,
              fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: (guardando || sumaPesos !== 100 || !motivoEdicion.trim()) ? 0.5 : 1,
            }}>
              {guardando ? "Guardando..." : "✓ Guardar y recalcular"}
            </button>
            <button onClick={() => { setPesosTemp(config); setMotivoEdicion(""); }} style={{
              padding: "8px 16px", background: "#fff", color: "#64748b", border: "1px solid #cbd5e1", borderRadius: 6,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              Restaurar
            </button>
          </div>
        </div>
      )}

      {/* KPIs filtrables */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setFiltroNivel("todos")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "todos" ? "#002E5D" : "#fff",
          color: filtroNivel === "todos" ? "#fff" : "#002E5D",
          border: "1px solid #002E5D",
        }}>Todos ({stats.total})</button>
        <button onClick={() => setFiltroNivel("BAJO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "BAJO" ? "#16a34a" : "#dcfce7", color: filtroNivel === "BAJO" ? "#fff" : "#166534",
          border: "1px solid #16a34a",
        }}>🟢 Bajo ({stats.bajo})</button>
        <button onClick={() => setFiltroNivel("MEDIO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "MEDIO" ? "#f59e0b" : "#fef3c7", color: filtroNivel === "MEDIO" ? "#fff" : "#92400e",
          border: "1px solid #f59e0b",
        }}>🟡 Medio ({stats.medio})</button>
        <button onClick={() => setFiltroNivel("ALTO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
          background: filtroNivel === "ALTO" ? "#dc2626" : "#fee2e2", color: filtroNivel === "ALTO" ? "#fff" : "#991b1b",
          border: "1px solid #dc2626",
        }}>🔴 Alto ({stats.alto})</button>
        <button onClick={() => setFiltroNivel("CRÍTICO")} style={{
          padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
          background: filtroNivel === "CRÍTICO" ? "#7f1d1d" : "#fecaca", color: filtroNivel === "CRÍTICO" ? "#fff" : "#7f1d1d",
          border: "1px solid #7f1d1d",
        }}>⚫ Crítico ({stats.critico})</button>
        {stats.sinDatos > 0 && (
          <button onClick={() => setFiltroNivel("SIN DATOS")} style={{
            padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
            background: filtroNivel === "SIN DATOS" ? "#64748b" : "#f1f5f9", color: filtroNivel === "SIN DATOS" ? "#fff" : "#475569",
            border: "1px solid #cbd5e1",
          }}>○ Sin datos ({stats.sinDatos})</button>
        )}
      </div>

      {/* Filtros adicionales */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Buscar contratista..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11, flex: 1 }}
        />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #e4e7ec", fontSize: 11 }}>
          <option value="todos">Todos ({stats.total})</option>
          <option value="activo">Solo activos ({stats.activos})</option>
          <option value="inhabilitado">Solo inhabilitados ({stats.inhab})</option>
        </select>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Mostrando: <strong>{filtrados.length}</strong>
        </span>
        <BotonDescargarExcel onClick={() => {
          const headers = ["Contratista", "Score", "Nivel", "Estado", "Empleados Activos", "% Docs Iniciales", "% Cumpl. Mensual", "Pendientes", "F30 atrasado", "Inhabilitado", "Docs Vencidos", "Docs Críticos Faltantes"];
          const filas = contratistasConScore.map(c => [
            c.contratista,
            c.score,
            c.nivel,
            c.estaInhabilitado ? "Inhabilitado" : "Activo",
            c.empleadosActivos,
            c.pctIniciales + "%",
            c.pctMensual + "%",
            c.pendientes,
            c.factores.atrasoF30.val,
            c.factores.inhabilitado.val ? "Sí" : "No",
            c.factores.recencia.val,
            c.docsCriticosFaltantes.join(" | "),
          ]);
          descargarExcelMultihoja([
            { nombre: "Riesgo RSE", datos: [headers, ...filas] },
          ], "Riesgo_RSE");
        }} disabled={contratistasConScore.length === 0} />
      </div>

      {/* Tabla principal */}
      <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead style={{ position: "sticky", top: 0, background: "#002E5D", color: "#fff", zIndex: 2 }}>
            <tr>
              <th style={{ padding: "10px 8px", textAlign: "center", width: 30 }}></th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, width: 80 }}>Score</th>
              <th style={{ padding: "10px 8px", textAlign: "left", fontSize: 10, fontWeight: 700 }}>Contratista</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Empleados</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>% Iniciales</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>% Mensual 6m</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Pendientes</th>
              <th style={{ padding: "10px 8px", textAlign: "center", fontSize: 10, fontWeight: 700 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((c, i) => {
              const expandido = expandidoContr === c.contratista;
              return (
                <Fragment key={c.contratista}>
                  <tr 
                    onClick={() => setExpandidoContr(expandido ? null : c.contratista)}
                    style={{ 
                      borderTop: "1px solid #f1f5f9", 
                      background: c.bgNivel,
                      cursor: "pointer",
                    }}>
                    <td style={{ padding: "8px", textAlign: "center", color: "#64748b", fontSize: 14 }}>
                      {expandido ? "▼" : "▶"}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <div style={{ 
                        display: "inline-block", padding: "6px 12px", borderRadius: 6,
                        background: c.colorNivel, color: "#fff", fontWeight: 800, fontSize: 14, minWidth: 50,
                      }}>
                        {c.sinDatos ? "—" : c.score}
                      </div>
                    </td>
                    <td style={{ padding: "8px" }}>
                      <div style={{ fontWeight: 600, color: "#1f2937" }}>{c.contratista}</div>
                      <div style={{ fontSize: 9, marginTop: 2 }}>
                        <span style={{ padding: "1px 6px", borderRadius: 4, background: c.colorNivel, color: "#fff", fontWeight: 700 }}>
                          {c.nivel}
                        </span>
                        {c.planta && <span style={{ marginLeft: 6, color: "#64748b" }}>{c.planta}</span>}
                      </div>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", fontWeight: 600 }}>{c.empleadosActivos}</td>
                    <td style={{ padding: "8px", textAlign: "center", color: c.pctIniciales < 70 ? "#dc2626" : "#475569", fontWeight: c.pctIniciales < 70 ? 700 : 400 }}>
                      {c.pctIniciales}%
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", color: c.pctMensual < 80 ? "#dc2626" : "#475569" }}>
                      {c.pctMensual}%
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {c.pendientes > 0 ? (
                        <span style={{ padding: "2px 8px", borderRadius: 10, background: "#fee2e2", color: "#991b1b", fontWeight: 700 }}>
                          {c.pendientes}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      {c.estaInhabilitado ? (
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#fee2e2", color: "#991b1b", fontWeight: 700 }}>
                          INHABILITADO
                        </span>
                      ) : (
                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>
                          ACTIVO
                        </span>
                      )}
                    </td>
                  </tr>
                  {expandido && (
                    <tr>
                      <td colSpan={8} style={{ padding: 14, background: "#f8fafc", borderTop: "1px solid #e4e7ec" }}>
                        <DetalleRiesgoRSE contratista={c} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filtrados.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            Ningún contratista coincide con los filtros
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, padding: "10px 14px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 4, fontSize: 11, color: "#075985" }}>
        <strong>💡 ¿Qué significa cada nivel?</strong>
        <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
          <li><strong style={{ color: "#16a34a" }}>BAJO ({"<"}{config.umbral_bajo}):</strong> Cumple sus obligaciones. Riesgo legal mínimo para Bigticket.</li>
          <li><strong style={{ color: "#f59e0b" }}>MEDIO ({config.umbral_bajo}-{config.umbral_medio}):</strong> Algunas observaciones. Hacer seguimiento.</li>
          <li><strong style={{ color: "#dc2626" }}>ALTO ({config.umbral_medio}-{config.umbral_alto}):</strong> Genera retraso constante. Posible exposición legal. Reunión de gestión.</li>
          <li><strong style={{ color: "#7f1d1d" }}>CRÍTICO ({">"}{config.umbral_alto}):</strong> Alta probabilidad de generar pasivo legal. Escalar a gerencia.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Sub-componente: detalle del contratista en RSE ───────────────
function DetalleRiesgoRSE({ contratista }) {
  const c = contratista;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* Desglose del score */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
            🔍 Desglose del score ({c.score}/100)
          </h4>
          <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e4e7ec" }}>
                <th style={{ textAlign: "left", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Factor</th>
                <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Peso</th>
                <th style={{ textAlign: "center", padding: "4px 6px", color: "#64748b", fontWeight: 600 }}>Aporta</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(c.factores).map(([k, f]) => (
                <tr key={k} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "4px 6px", fontWeight: 500 }}>{f.label}</td>
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#94a3b8" }}>{f.peso}%</td>
                  <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 700, color: f.contrib > 10 ? "#dc2626" : f.contrib > 5 ? "#f59e0b" : "#16a34a" }}>
                    +{f.contrib}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #002E5D" }}>
                <td colSpan={2} style={{ padding: "6px", fontWeight: 700, color: "#002E5D" }}>SCORE FINAL</td>
                <td style={{ padding: "6px", textAlign: "center", fontWeight: 800, color: c.colorNivel, fontSize: 14 }}>{c.score}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Histórico mensual */}
        <div style={{ background: "#fff", border: "1px solid #e4e7ec", borderRadius: 6, padding: 10 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#002E5D", marginBottom: 8 }}>
            📈 Cumplimiento mensual (últimos 6 meses)
          </h4>
          {c.cumplMen6m.length === 0 ? (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Sin histórico mensual</div>
          ) : (
            <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80, marginTop: 10 }}>
              {[...c.cumplMen6m].reverse().map((m, i) => {
                const altura = Math.round(m.pct_avance || 0);
                const color = altura >= 80 ? "#16a34a" : altura >= 50 ? "#f59e0b" : "#dc2626";
                const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
                const mesIdx = (m.mes && m.mes >= 1 && m.mes <= 12) ? m.mes - 1 : null;
                const labelMes = mesIdx !== null ? `${meses[mesIdx]}-${String(m.anio).slice(2)}` : "?";
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div title={`${labelMes}: ${altura}%`} style={{ width: "100%", height: `${Math.max(altura * 0.6, 5)}px`, background: color, borderRadius: 3, transition: "height 0.3s" }} />
                    <div style={{ fontSize: 9, color: "#64748b", fontWeight: 600 }}>{labelMes}</div>
                    <div style={{ fontSize: 8, color: "#94a3b8" }}>{altura}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Docs críticos faltantes */}
      {c.docsCriticosFaltantes.length > 0 && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, padding: 10, marginBottom: 14 }}>
          <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 8 }}>
            ⚠ Documentos críticos faltantes ({c.docsCriticosFaltantes.length})
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {c.docsCriticosFaltantes.map((doc, i) => (
              <span key={i} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#fff", color: "#991b1b", border: "1px solid #fca5a5", fontWeight: 600 }}>
                ✗ {doc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recomendación */}
      <div style={{ background: c.bgNivel, border: `1px solid ${c.colorNivel}`, borderLeft: `4px solid ${c.colorNivel}`, borderRadius: 6, padding: 10 }}>
        <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: c.colorNivel, marginBottom: 6 }}>
          🎯 Recomendación de acción
        </h4>
        <div style={{ fontSize: 11, color: "#1f2937" }}>
          {c.nivel === "CRÍTICO" && (
            <>Escalar inmediatamente a gerencia. Considerar suspensión preventiva del contratista. {c.empleadosActivos > 0 ? `${c.empleadosActivos} empleados activos exponen a Bigticket a responsabilidad solidaria.` : ""}</>
          )}
          {c.nivel === "ALTO" && (
            <>Reunión urgente de gestión con el contratista. Plan de regularización con plazo de 30 días. Si no cumple, considerar inhabilitación.</>
          )}
          {c.nivel === "MEDIO" && (
            <>Hacer seguimiento mensual. Notificar al contratista los documentos pendientes. Reagendar revisión en 60 días.</>
          )}
          {c.nivel === "BAJO" && (
            <>Sin acción requerida. Monitoreo de rutina.</>
          )}
        </div>
      </div>
    </div>
  );
}
